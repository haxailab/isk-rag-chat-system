import boto3
import json
import requests
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

def test_opensearch_access():
    # AWS設定
    session = boto3.Session()
    credentials = session.get_credentials()
    region = 'ap-northeast-1'
    service = 'aoss'

    # OpenSearch Serverless エンドポイント
    endpoint = 'https://o1o29hmx73k7m2fk14kb.ap-northeast-1.aoss.amazonaws.com'

    print("Testing OpenSearch Serverless access...")
    print(f"Endpoint: {endpoint}")

    try:
        # 1. インデックス一覧取得テスト（GET /_cat/indices）
        url = f"{endpoint}/_cat/indices"

        request = AWSRequest(
            method='GET',
            url=url,
            headers={'Accept': 'application/json'}
        )

        # AWS Signature V4で署名
        SigV4Auth(credentials, service, region).add_auth(request)

        print("Sending GET /_cat/indices request...")

        # HTTPリクエスト送信
        response = requests.get(
            url=url,
            headers=dict(request.headers),
            timeout=10
        )

        print(f"Response Status: {response.status_code}")
        print(f"Response Text: {response.text[:500]}...")  # 最初の500文字のみ

        if response.status_code == 200:
            print("SUCCESS: OpenSearch access is working!")
            return True
        elif response.status_code == 403:
            print("FORBIDDEN: Access policy not yet active. Waiting for propagation...")
            return False
        else:
            print(f"UNEXPECTED: Status {response.status_code}")
            return False

    except Exception as e:
        print(f"ERROR: {str(e)}")
        return False

if __name__ == "__main__":
    success = test_opensearch_access()
    if success:
        print("Ready to create vector index!")
    else:
        print("Access not ready yet. Please wait and retry.")