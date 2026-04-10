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
            headers={
                'Content-Type': 'application/json',
                'Host': 'o1o29hmx73k7m2fk14kb.ap-northeast-1.aoss.amazonaws.com'
            }
        )

        # AWS Signature V4で署名
        SigV4Auth(credentials, service, region).add_auth(request)

        print("Sending request to create vector index...")
        print(f"Headers: {dict(request.headers)}")

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
            print("✅ Vector index created successfully!")
            return True
        else:
            print(f"❌ Failed to create vector index: {response.status_code}")
            print(f"Error: {response.text}")
            return False

    except Exception as e:
        print(f"❌ Exception occurred: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = create_vector_index()
    if success:
        print("\n🎉 Vector index creation completed!")
        print("Next step: Create Knowledge Base")
    else:
        print("\n💥 Vector index creation failed!")