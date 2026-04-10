import boto3
import json
import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
import time

def create_vector_index_with_role():
    print("Assuming Knowledge Base role for index creation...")

    # STSクライアントで役割を引き受ける
    sts_client = boto3.client('sts')

    try:
        # Knowledge Baseロールを引き受ける
        assumed_role = sts_client.assume_role(
            RoleArn='arn:aws:iam::144828520862:role/ISK-RAG-KnowledgeBase-Role',
            RoleSessionName='VectorIndexCreation'
        )

        # 一時的な認証情報を取得
        credentials = assumed_role['Credentials']
        temp_access_key = credentials['AccessKeyId']
        temp_secret_key = credentials['SecretAccessKey']
        temp_session_token = credentials['SessionToken']

        print("Successfully assumed Knowledge Base role")

        # 一時的な認証情報でセッション作成
        temp_session = boto3.Session(
            aws_access_key_id=temp_access_key,
            aws_secret_access_key=temp_secret_key,
            aws_session_token=temp_session_token
        )

        region = 'ap-northeast-1'
        service = 'aoss'

        # OpenSearch Serverless エンドポイント
        endpoint = 'https://o1o29hmx73k7m2fk14kb.ap-northeast-1.aoss.amazonaws.com'
        index_name = 'isk-vector-index'

        print(f"Creating vector index: {index_name}")

        # ベクターインデックスの設定
        index_body = {
            "settings": {
                "index": {
                    "knn": True,
                    "knn.algo_param.ef_search": 512,
                    "knn.algo_param.ef_construction": 512
                }
            },
            "mappings": {
                "properties": {
                    "vector-field": {
                        "type": "knn_vector",
                        "dimension": 1536,
                        "method": {
                            "name": "hnsw",
                            "space_type": "cosinesimil",
                            "engine": "nmslib",
                            "parameters": {
                                "ef_construction": 512,
                                "ef_search": 512
                            }
                        }
                    },
                    "text-field": {
                        "type": "text"
                    },
                    "metadata-field": {
                        "type": "object"
                    }
                }
            }
        }

        # AWS署名付きリクエストの作成
        url = f"{endpoint}/{index_name}"
        body_str = json.dumps(index_body)

        # 一時的な認証情報を使用
        temp_credentials = temp_session.get_credentials()

        request = AWSRequest(
            method='PUT',
            url=url,
            data=body_str,
            headers={'Content-Type': 'application/json'}
        )

        # AWS Signature V4で署名（一時的な認証情報使用）
        SigV4Auth(temp_credentials, service, region).add_auth(request)

        print("Sending request with assumed role credentials...")

        # HTTPリクエスト送信
        response = requests.put(
            url=url,
            data=body_str,
            headers=dict(request.headers),
            timeout=30
        )

        print(f"Response Status: {response.status_code}")
        print(f"Response Text: {response.text}")

        if response.status_code in [200, 201]:
            print("SUCCESS: Vector index created with assumed role!")
            return True
        else:
            print(f"FAILED: Status {response.status_code}")
            return False

    except Exception as e:
        print(f"EXCEPTION: {str(e)}")
        return False

if __name__ == "__main__":
    success = create_vector_index_with_role()
    if success:
        print("\nVector index ready! Now creating Knowledge Base...")
    else:
        print("\nTrying alternative approach...")