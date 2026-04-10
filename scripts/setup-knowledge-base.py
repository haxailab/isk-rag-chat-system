#!/usr/bin/env python3
"""
Bedrock Knowledge Base セットアップスクリプト
CDKデプロイ後にKnowledge Baseを作成し、設定する
"""

import boto3
import json
import time
import sys
from botocore.exceptions import ClientError

def get_stack_outputs(stack_name, region='ap-northeast-1'):
    """CDKスタックの出力値を取得"""
    cloudformation = boto3.client('cloudformation', region_name=region)

    try:
        response = cloudformation.describe_stacks(StackName=stack_name)
        outputs = {}

        for output in response['Stacks'][0].get('Outputs', []):
            outputs[output['OutputKey']] = output['OutputValue']

        return outputs
    except ClientError as e:
        print(f"エラー: スタック {stack_name} の情報取得に失敗しました: {e}")
        return None

def create_knowledge_base(
    name,
    role_arn,
    collection_arn,
    bucket_name,
    region='ap-northeast-1'
):
    """Knowledge Baseを作成"""
    bedrock = boto3.client('bedrock-agent', region_name=region)

    try:
        # Knowledge Base作成
        kb_response = bedrock.create_knowledge_base(
            name=name,
            description='ISK社内RAGチャットシステム用ナレッジベース',
            roleArn=role_arn,
            knowledgeBaseConfiguration={
                'type': 'VECTOR',
                'vectorKnowledgeBaseConfiguration': {
                    'embeddingModelArn': f'arn:aws:bedrock:{region}::foundation-model/amazon.titan-embed-text-v2:0'
                }
            },
            storageConfiguration={
                'type': 'OPENSEARCH_SERVERLESS',
                'opensearchServerlessConfiguration': {
                    'collectionArn': collection_arn,
                    'vectorIndexName': 'isk-rag-index',
                    'fieldMapping': {
                        'vectorField': 'vector',
                        'textField': 'text',
                        'metadataField': 'metadata'
                    }
                }
            }
        )

        knowledge_base_id = kb_response['knowledgeBase']['knowledgeBaseId']
        print(f"Knowledge Base作成完了: {knowledge_base_id}")

        # データソース作成
        ds_response = bedrock.create_data_source(
            knowledgeBaseId=knowledge_base_id,
            name=f'{name}-data-source',
            description='S3ドキュメントデータソース',
            dataSourceConfiguration={
                'type': 'S3',
                's3Configuration': {
                    'bucketArn': f'arn:aws:s3:::{bucket_name}',
                    'inclusionPrefixes': []
                }
            },
            vectorIngestionConfiguration={
                'chunkingConfiguration': {
                    'chunkingStrategy': 'FIXED_SIZE',
                    'fixedSizeChunkingConfiguration': {
                        'maxTokens': 1000,
                        'overlapPercentage': 20
                    }
                }
            }
        )

        data_source_id = ds_response['dataSource']['dataSourceId']
        print(f"データソース作成完了: {data_source_id}")

        return knowledge_base_id, data_source_id

    except ClientError as e:
        print(f"エラー: Knowledge Base作成に失敗しました: {e}")
        return None, None

def sync_data_source(knowledge_base_id, data_source_id, region='ap-northeast-1'):
    """データソースの同期を開始"""
    bedrock = boto3.client('bedrock-agent', region_name=region)

    try:
        response = bedrock.start_ingestion_job(
            knowledgeBaseId=knowledge_base_id,
            dataSourceId=data_source_id,
            description='初回データ取り込み'
        )

        job_id = response['ingestionJob']['ingestionJobId']
        print(f"データ取り込みジョブ開始: {job_id}")

        # ジョブの完了を待機
        print("データ取り込み中...")
        while True:
            job_response = bedrock.get_ingestion_job(
                knowledgeBaseId=knowledge_base_id,
                dataSourceId=data_source_id,
                ingestionJobId=job_id
            )

            status = job_response['ingestionJob']['status']
            print(f"ジョブ状況: {status}")

            if status in ['COMPLETE', 'FAILED']:
                break

            time.sleep(30)

        if status == 'COMPLETE':
            print("データ取り込み完了！")
            return True
        else:
            print("データ取り込みに失敗しました")
            return False

    except ClientError as e:
        print(f"エラー: データソース同期に失敗しました: {e}")
        return False

def update_lambda_with_kb_id(kb_id, region='ap-northeast-1'):
    """Lambda関数にKnowledge Base IDを設定"""
    lambda_client = boto3.client('lambda', region_name=region)

    # Lambda関数名を推定（実際の関数名に合わせて調整）
    function_names = [
        'IskRagChatSystemBackend-ChatFunction',
        f'IskRagChatSystemBackend-ChatFunction-*'
    ]

    for function_name in function_names:
        try:
            # 関数の環境変数を更新
            lambda_client.update_function_configuration(
                FunctionName=function_name,
                Environment={
                    'Variables': {
                        'KNOWLEDGE_BASE_ID': kb_id
                    }
                }
            )
            print(f"Lambda関数 {function_name} にKnowledge Base ID設定完了")
            return True
        except ClientError:
            continue

    print("警告: Lambda関数が見つかりませんでした。手動でKNOWLEDGE_BASE_IDを設定してください")
    return False

def main():
    print("========================================")
    print("Bedrock Knowledge Base セットアップ")
    print("========================================")

    # スタック情報の取得
    print("CDKスタック情報を取得中...")
    backend_outputs = get_stack_outputs('IskRagChatSystemBackend')

    if not backend_outputs:
        print("エラー: バックエンドスタックの情報を取得できませんでした")
        sys.exit(1)

    # 必要な情報の抽出
    bucket_name = backend_outputs.get('DocumentBucketName')
    opensearch_endpoint = backend_outputs.get('OpenSearchCollectionEndpoint')

    if not all([bucket_name, opensearch_endpoint]):
        print("エラー: 必要な出力値が見つかりません")
        print("必要な値:", ['DocumentBucketName', 'OpenSearchCollectionEndpoint'])
        print("取得した値:", backend_outputs)
        sys.exit(1)

    # Collection ARN作成
    account_id = boto3.client('sts').get_caller_identity()['Account']
    collection_arn = f"arn:aws:aoss:ap-northeast-1:{account_id}:collection/isk-rag-collection"

    # Knowledge Base用ロールARNを推定
    role_arn = f"arn:aws:iam::{account_id}:role/IskRagChatSystemBackend-KnowledgeBaseRole*"

    print(f"バケット名: {bucket_name}")
    print(f"コレクションARN: {collection_arn}")
    print(f"ロールARN: {role_arn}")

    # Knowledge Base作成
    print("\nKnowledge Baseを作成中...")
    kb_id, ds_id = create_knowledge_base(
        name='isk-rag-knowledge-base',
        role_arn=role_arn,
        collection_arn=collection_arn,
        bucket_name=bucket_name
    )

    if not kb_id:
        print("Knowledge Base作成に失敗しました")
        sys.exit(1)

    # データソース同期
    if ds_id:
        print(f"\nデータソース同期を開始中...")
        if sync_data_source(kb_id, ds_id):
            print("セットアップ完了！")
        else:
            print("データソース同期に失敗しましたが、Knowledge Baseは作成されました")

    # Lambda関数の更新
    print(f"\nLambda関数を更新中...")
    update_lambda_with_kb_id(kb_id)

    print(f"\n========================================")
    print(f"セットアップ完了")
    print(f"Knowledge Base ID: {kb_id}")
    print(f"データソース ID: {ds_id}")
    print(f"========================================")

    print(f"\n次のステップ:")
    print(f"1. S3バケット '{bucket_name}' にドキュメントをアップロード")
    print(f"2. 必要に応じてデータソースを再同期")
    print(f"3. Webアプリケーションでチャットをテスト")

if __name__ == "__main__":
    main()