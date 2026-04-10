#!/usr/bin/env python3
import json
import base64

def decode_jwt_payload(token):
    """Decode JWT payload for inspection"""
    try:
        # JWT format: header.payload.signature
        parts = token.split('.')
        if len(parts) != 3:
            return None

        # Decode payload (base64 with padding if needed)
        payload_b64 = parts[1]
        # Add padding if needed
        missing_padding = len(payload_b64) % 4
        if missing_padding:
            payload_b64 += '=' * (4 - missing_padding)

        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        payload_json = payload_bytes.decode('utf-8')
        return json.loads(payload_json)

    except Exception as e:
        print(f"Error decoding JWT: {e}")
        return None

# Test with dummy token structure - replace with actual token
if __name__ == "__main__":
    print("JWT Token Decoder")
    print("Enter JWT token to decode:")
    token = input().strip()

    if token:
        payload = decode_jwt_payload(token)
        if payload:
            print("\nJWT Payload:")
            print(json.dumps(payload, indent=2))

            # Check important fields
            print("\nKey Fields:")
            print(f"  Issuer (iss): {payload.get('iss', 'N/A')}")
            print(f"  Audience (aud): {payload.get('aud', 'N/A')}")
            print(f"  Subject (sub): {payload.get('sub', 'N/A')}")
            print(f"  Username: {payload.get('cognito:username', 'N/A')}")
            print(f"  Expiry: {payload.get('exp', 'N/A')}")
            print(f"  Token Use: {payload.get('token_use', 'N/A')}")
        else:
            print("Failed to decode JWT")
    else:
        print("No token provided")