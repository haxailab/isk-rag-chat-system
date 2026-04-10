#!/usr/bin/env python3
import boto3
import json
import requests
from botocore.exceptions import ClientError

# AWS Cognito settings
REGION = 'ap-northeast-1'
USER_POOL_ID = 'ap-northeast-1_i2AeoNWra'
CLIENT_ID = '66d8jukea24p01u1bfrjmq01r0'
API_URL = 'https://ca65otj198.execute-api.ap-northeast-1.amazonaws.com/prod/chat'

def get_jwt_token(username, password):
    """Get valid JWT token from Cognito"""
    print(f"Getting token for: {username}")

    try:
        client = boto3.client('cognito-idp', region_name=REGION)

        response = client.admin_initiate_auth(
            UserPoolId=USER_POOL_ID,
            ClientId=CLIENT_ID,
            AuthFlow='ADMIN_NO_SRP_AUTH',
            AuthParameters={
                'USERNAME': username,
                'PASSWORD': password
            }
        )

        access_token = response['AuthenticationResult']['AccessToken']
        id_token = response['AuthenticationResult']['IdToken']

        print(f"SUCCESS: Token acquired")
        print(f"Access Token: {access_token[:50]}...")
        print(f"ID Token: {id_token[:50]}...")

        return access_token, id_token

    except ClientError as e:
        print(f"ERROR: Authentication failed: {e}")
        return None, None
    except Exception as e:
        print(f"ERROR: {e}")
        return None, None

def test_api_with_token(token, message="Hello Claude"):
    """Test API with JWT authentication"""
    print(f"API test with message: '{message}'")

    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {token}',
        'Origin': 'https://d3hwl9tcru7yod.cloudfront.net'
    }

    data = {
        'message': message
    }

    try:
        print(f"Sending request...")
        response = requests.post(API_URL,
                               headers=headers,
                               json=data,
                               timeout=30)

        print(f"Response: {response.status_code} {response.reason}")
        print(f"Response Headers:")
        for key, value in response.headers.items():
            print(f"  {key}: {value}")

        if response.status_code == 200:
            result = response.json()
            print(f"SUCCESS: API call worked!")
            print(f"Claude response: {result.get('answer', 'No answer')[:200]}...")
            return True
        else:
            print(f"FAILED: API error")
            print(f"Response Body: {response.text}")
            return False

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Network error: {e}")
        return False
    except Exception as e:
        print(f"ERROR: {e}")
        return False

def main():
    print("ISK RAG System Authentication Test")
    print("=" * 50)

    # Authentication test
    username = "admin1775453217"
    password = "IskDemo123!"

    access_token, id_token = get_jwt_token(username, password)

    if not access_token:
        print("FAILED: Authentication failed. Test stopped.")
        return

    print("\n" + "=" * 50)
    print("Testing with ID Token (API Gateway expects ID Token)")

    # API call test using ID Token
    success = test_api_with_token(id_token)

    print("\n" + "=" * 50)
    if success:
        print("SUCCESS: All tests passed! JWT auth system working")
    else:
        print("FAILED: API test failed. Possible CORS issue")

        # CORS detailed test
        print("\nCORS Details...")
        try:
            # Preflight test
            preflight_headers = {
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'Authorization,Content-Type',
                'Origin': 'https://d3hwl9tcru7yod.cloudfront.net'
            }

            preflight_response = requests.options(API_URL, headers=preflight_headers)
            print(f"CORS Preflight: {preflight_response.status_code}")
            print(f"CORS Headers:")
            for key, value in preflight_response.headers.items():
                if 'access-control' in key.lower():
                    print(f"  {key}: {value}")

        except Exception as e:
            print(f"ERROR: CORS test failed: {e}")

if __name__ == "__main__":
    main()