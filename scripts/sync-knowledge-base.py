#!/usr/bin/env python3
"""
Knowledge Base 同期スクリプト
S3にアップロードされたドキュメントをKnowledge Baseに取り込む
"""

import boto3
import time
import sys
from botocore.exceptions import ClientError

def get_knowledge_base_info(region='ap-northeast-1'):
    """Knowledge BaseとData Sourceの情報を取得"""
    bedrock = boto3.client('bedrock-agent', region_name=region)

    try:
        # Knowledge Base一覧を取得
        kb_response = bedrock.list_knowledge_bases()
        isk_kb = None

        for kb in kb_response['knowledgeBaseSummaries']:
            if 'isk' in kb['name'].lower():
                isk_kb = kb
                break

        if not isk_kb:
            print("エラー: ISK Knowledge Baseが見つかりませんでした")
            return None, None

        kb_id = isk_kb['knowledgeBaseId']

        # Data Source一覧を取得
        ds_response = bedrock.list_data_sources(knowledgeBaseId=kb_id)
        ds_id = None

        if ds_response['dataSourceSummaries']:
            ds_id = ds_response['dataSourceSummaries'][0]['dataSourceId']

        return kb_id, ds_id

    except ClientError as e:
        print(f"エラー: Knowledge Base情報の取得に失敗しました: {e}")
        return None, None

def start_ingestion_job(kb_id, ds_id, region='ap-northeast-1'):
    """データ取り込みジョブを開始"""
    bedrock = boto3.client('bedrock-agent', region_name=region)

    try:
        response = bedrock.start_ingestion_job(
            knowledgeBaseId=kb_id,
            dataSourceId=ds_id,
            description=f'手動同期 - {time.strftime("%Y-%m-%d %H:%M:%S")}'
        )

        return response['ingestionJob']['ingestionJobId']

    except ClientError as e:
        print(f"エラー: データ取り込みジョブの開始に失敗しました: {e}")
        return None

def wait_for_job_completion(kb_id, ds_id, job_id, region='ap-northeast-1'):
    """ジョブ完了まで待機"""
    bedrock = boto3.client('bedrock-agent', region_name=region)

    print("データ取り込み中...")
    start_time = time.time()

    while True:
        try:
            response = bedrock.get_ingestion_job(
                knowledgeBaseId=kb_id,
                dataSourceId=ds_id,
                ingestionJobId=job_id
            )

            job = response['ingestionJob']
            status = job['status']
            elapsed_time = int(time.time() - start_time)

            print(f"状況: {status} ({elapsed_time}秒経過)")

            if status == 'COMPLETE':
                print("データ取り込み完了！")
                return True
            elif status == 'FAILED':
                print(f"データ取り込み失敗: {job.get('failureReasons', 'Unknown error')}")
                return False

            time.sleep(30)  # 30秒待機

        except ClientError as e:
            print(f"エラー: ジョブ状況の取得に失敗しました: {e}")
            return False
        except KeyboardInterrupt:
            print("\n中断されました")
            return False

def get_job_statistics(kb_id, ds_id, job_id, region='ap-northeast-1'):
    """ジョブの統計情報を取得"""
    bedrock = boto3.client('bedrock-agent', region_name=region)

    try:
        response = bedrock.get_ingestion_job(
            knowledgeBaseId=kb_id,
            dataSourceId=ds_id,
            ingestionJobId=job_id
        )

        job = response['ingestionJob']
        stats = job.get('statistics', {})

        return {
            'documents_scanned': stats.get('numberOfDocumentsScanned', 0),
            'documents_modified': stats.get('numberOfModifiedDocuments', 0),
            'documents_deleted': stats.get('numberOfDeletedDocuments', 0),
            'documents_failed': stats.get('numberOfDocumentsFailed', 0)
        }

    except ClientError as e:
        print(f"統計情報の取得に失敗しました: {e}")
        return {}

def list_recent_jobs(kb_id, ds_id, region='ap-northeast-1'):
    """最近のジョブ履歴を表示"""
    bedrock = boto3.client('bedrock-agent', region_name=region)

    try:
        response = bedrock.list_ingestion_jobs(
            knowledgeBaseId=kb_id,
            dataSourceId=ds_id,
            maxResults=5
        )

        jobs = response['ingestionJobSummaries']

        if jobs:
            print("\n最近の同期履歴:")
            for job in jobs:
                start_time = job['startedAt'].strftime('%Y-%m-%d %H:%M:%S')
                print(f"  {start_time}: {job['status']} ({job['ingestionJobId'][:8]}...)")
        else:
            print("同期履歴がありません")

    except ClientError as e:
        print(f"履歴の取得に失敗しました: {e}")

def main():
    print("========================================")
    print("Knowledge Base データ同期")
    print("========================================")

    # Knowledge Base情報の取得
    print("Knowledge Base情報を取得中...")
    kb_id, ds_id = get_knowledge_base_info()

    if not kb_id or not ds_id:
        print("Knowledge BaseまたはData Sourceが見つかりませんでした")
        print("先に setup-knowledge-base.py を実行してください")
        sys.exit(1)

    print(f"Knowledge Base ID: {kb_id}")
    print(f"Data Source ID: {ds_id}")

    # 最近の履歴表示
    list_recent_jobs(kb_id, ds_id)

    # 同期開始確認
    print(f"\nS3バケットの新しいドキュメントをKnowledge Baseに取り込みますか？")
    response = input("続行しますか？ (y/N): ")

    if response.lower() not in ['y', 'yes']:
        print("同期を中止しました")
        sys.exit(0)

    # データ取り込みジョブ開始
    print("\nデータ取り込みジョブを開始中...")
    job_id = start_ingestion_job(kb_id, ds_id)

    if not job_id:
        print("ジョブの開始に失敗しました")
        sys.exit(1)

    print(f"ジョブID: {job_id}")

    # ジョブ完了まで待機
    if wait_for_job_completion(kb_id, ds_id, job_id):
        # 統計情報を表示
        print("\n同期結果:")
        stats = get_job_statistics(kb_id, ds_id, job_id)
        for key, value in stats.items():
            print(f"  {key}: {value}")

        print("\n========================================")
        print("同期完了！")
        print("========================================")
        print("これでチャットでドキュメントに関する質問ができます")
    else:
        print("同期に失敗しました")
        sys.exit(1)

if __name__ == "__main__":
    main()