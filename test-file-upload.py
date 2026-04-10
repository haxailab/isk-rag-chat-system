#!/usr/bin/env python3
"""
独立したファイルアップロード機能テスト
"""
import json
import base64
import boto3
import os
from lambda_function import lambda_file_upload

def test_file_upload():
    """ファイルアップロード機能の単体テスト"""

    # テスト用のサンプルファイル（小さなテキストファイル）
    test_content = "これはテスト用のファイルです。\nアップロード機能の動作確認を行います。"
    test_filename = "test_document.txt"

    # Base64エンコード
    encoded_content = base64.b64encode(test_content.encode('utf-8')).decode('utf-8')

    # モックイベント作成
    event = {
        "httpMethod": "POST",
        "requestContext": {
            "authorizer": {
                "claims": {
                    "sub": "test-user-123",
                    "cognito:username": "testuser"
                }
            }
        },
        "body": json.dumps({
            "files": [
                {
                    "filename": test_filename,
                    "content": encoded_content,
                    "contentType": "text/plain"
                }
            ],
            "session_name": "テストセッション"
        })
    }

    # モックコンテキスト
    class MockContext:
        def __init__(self):
            self.aws_request_id = "test-request-123"
            self.function_name = "test-file-upload-function"

    context = MockContext()

    # 環境変数設定
    os.environ['TEMP_FILES_BUCKET'] = 'isk-rag-temp-files-144828520862-ap-northeast-1'
    os.environ['LOG_LEVEL'] = 'DEBUG'

    try:
        # Lambda関数実行
        result = lambda_file_upload.handler(event, context)

        print("=== ファイルアップロードテスト結果 ===")
        print(f"Status Code: {result['statusCode']}")

        if result['statusCode'] == 200:
            body = json.loads(result['body'])
            print(f"Session ID: {body.get('session_id')}")
            print(f"Uploaded Files: {len(body.get('uploaded_files', []))}")
            print(f"Errors: {len(body.get('errors', []))}")

            if body.get('uploaded_files'):
                file_info = body['uploaded_files'][0]
                print(f"File ID: {file_info.get('file_id')}")
                print(f"Filename: {file_info.get('filename')}")
                print(f"Size: {file_info.get('size')} bytes")
                print(f"Processing Status: {file_info.get('processing_status')}")
        else:
            print(f"Error Response: {result['body']}")

        return result['statusCode'] == 200

    except Exception as e:
        print(f"テスト実行エラー: {e}")
        return False

def test_api_endpoint():
    """API Gatewayエンドポイントの疎通テスト"""
    import requests

    api_url = "https://jztwgpdqe8.execute-api.ap-northeast-1.amazonaws.com/prod"

    # ヘルスチェック
    try:
        response = requests.get(f"{api_url}/health", timeout=10)
        print(f"Health Check - Status: {response.status_code}")
        print(f"Response: {response.text}")

        # アップロードエンドポイントのOPTIONSテスト
        response = requests.options(f"{api_url}/upload", timeout=10)
        print(f"Upload OPTIONS - Status: {response.status_code}")
        print(f"CORS Headers: {dict(response.headers)}")

        return True

    except Exception as e:
        print(f"API疎通テストエラー: {e}")
        return False

if __name__ == "__main__":
    print("=== 無機RAGシステム ファイルアップロード機能テスト ===\n")

    # API疎通テスト
    api_test = test_api_endpoint()
    print(f"\nAPI疎通テスト: {'✅ PASS' if api_test else '❌ FAIL'}")

    # Lambda単体テスト
    # Note: これは実際のLambda関数ファイルが必要
    print("\n注意: Lambda単体テストは実装後に実行してください")