import boto3
import json
import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
import time

def create_vector_index():
    # AWS設定
    session = boto3.Session()
    credentials = session.get_credentials()
    region = 'ap-northeast-1'
    service = 'aoss'

    # OpenSearch Serverless エンドポイント
    endpoint = 'https://o1o29hmx73k7m2fk14kb.ap-northeast-1.aoss.amazonaws.com'
    index_name = 'isk-vector-index'

    print(f"Creating vector index: {index_name}")
    print(f"Endpoint: {endpoint}")

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

    try:
        # AWS署名付きリクエストの作成
        url = f"{endpoint}/{index_name}"
        body_str = json.dumps(index_body)

        request = AWSRequest(
            method='PUT',
            url=url,
            data=body_str,
            headers={'Content-Type': 'application/json'}
        )

        # AWS Signature V4で署名
        SigV4Auth(credentials, service, region).add_auth(request)

        print("Sending request to create vector index...")

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
            print("SUCCESS: Vector index created successfully!")

            # インデックス作成確認
            print("Verifying index creation...")
            time.sleep(2)  # 少し待機

            # GET request for verification
            get_request = AWSRequest(method='GET', url=url)
            SigV4Auth(credentials, service, region).add_auth(get_request)

            verify_response = requests.get(url, headers=dict(get_request.headers))
            print(f"Verification Status: {verify_response.status_code}")
            if verify_response.status_code == 200:
                print("INDEX VERIFIED: Vector index is active!")

            return True
        else:
            print(f"FAILED: Status {response.status_code}")
            print(f"Error: {response.text}")
            return False

    except Exception as e:
        print(f"EXCEPTION: {str(e)}")
        return False

if __name__ == "__main__":
    success = create_vector_index()
    if success:
        print("\nNext step: Create Knowledge Base")
    else:
        print("\nVector index creation failed!")