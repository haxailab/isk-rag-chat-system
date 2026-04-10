#!/usr/bin/env python3
"""
ISK RAG Chat System モニタリングスクリプト
システムの健全性をチェックし、基本的なメトリクスを表示
"""

import boto3
import json
import datetime
from botocore.exceptions import ClientError

def check_stack_status(stack_name, region='ap-northeast-1'):
    """CDKスタックのステータスをチェック"""
    cloudformation = boto3.client('cloudformation', region_name=region)

    try:
        response = cloudformation.describe_stacks(StackName=stack_name)
        stack = response['Stacks'][0]
        return {
            'name': stack_name,
            'status': stack['StackStatus'],
            'last_updated': stack.get('LastUpdatedTime', stack.get('CreationTime')).isoformat()
        }
    except ClientError as e:
        return {
            'name': stack_name,
            'status': 'NOT_FOUND',
            'error': str(e)
        }

def check_cognito_users(user_pool_id, region='ap-northeast-1'):
    """Cognitoユーザー数をチェック"""
    cognito = boto3.client('cognito-idp', region_name=region)

    try:
        response = cognito.list_users(UserPoolId=user_pool_id)
        users = response['Users']

        total_users = len(users)
        enabled_users = len([u for u in users if u['Enabled']])

        return {
            'total_users': total_users,
            'enabled_users': enabled_users,
            'status': 'OK'
        }
    except ClientError as e:
        return {
            'status': 'ERROR',
            'error': str(e)
        }

def check_api_gateway_health(api_id, region='ap-northeast-1'):
    """API Gatewayのヘルスチェック"""
    import requests
    import time

    try:
        # ヘルスチェックエンドポイントを呼び出し
        health_url = f"https://{api_id}.execute-api.{region}.amazonaws.com/prod/health"

        start_time = time.time()
        response = requests.get(health_url, timeout=10)
        response_time = (time.time() - start_time) * 1000

        return {
            'status': 'OK' if response.status_code == 200 else 'ERROR',
            'status_code': response.status_code,
            'response_time_ms': round(response_time, 2),
            'url': health_url
        }
    except Exception as e:
        return {
            'status': 'ERROR',
            'error': str(e)
        }

def get_cloudwatch_metrics(namespace, metric_name, dimensions, region='ap-northeast-1'):
    """CloudWatchメトリクスを取得"""
    cloudwatch = boto3.client('cloudwatch', region_name=region)

    end_time = datetime.datetime.utcnow()
    start_time = end_time - datetime.timedelta(hours=1)

    try:
        response = cloudwatch.get_metric_statistics(
            Namespace=namespace,
            MetricName=metric_name,
            Dimensions=dimensions,
            StartTime=start_time,
            EndTime=end_time,
            Period=300,
            Statistics=['Sum', 'Average']
        )

        datapoints = response['Datapoints']
        if datapoints:
            latest = max(datapoints, key=lambda x: x['Timestamp'])
            return {
                'value': latest.get('Sum', latest.get('Average', 0)),
                'timestamp': latest['Timestamp'].isoformat(),
                'status': 'OK'
            }
        else:
            return {
                'value': 0,
                'status': 'NO_DATA'
            }
    except ClientError as e:
        return {
            'status': 'ERROR',
            'error': str(e)
        }

def get_lambda_metrics(function_name, region='ap-northeast-1'):
    """Lambda関数のメトリクスを取得"""
    metrics = {}

    # 実行回数
    invocations = get_cloudwatch_metrics(
        'AWS/Lambda',
        'Invocations',
        [{'Name': 'FunctionName', 'Value': function_name}],
        region
    )
    metrics['invocations'] = invocations

    # エラー数
    errors = get_cloudwatch_metrics(
        'AWS/Lambda',
        'Errors',
        [{'Name': 'FunctionName', 'Value': function_name}],
        region
    )
    metrics['errors'] = errors

    # 実行時間
    duration = get_cloudwatch_metrics(
        'AWS/Lambda',
        'Duration',
        [{'Name': 'FunctionName', 'Value': function_name}],
        region
    )
    metrics['duration'] = duration

    return metrics

def get_waf_metrics(web_acl_name, region='us-east-1'):
    """WAFメトリクスを取得"""
    metrics = {}

    # ブロックされたリクエスト
    blocked = get_cloudwatch_metrics(
        'AWS/WAFV2',
        'BlockedRequests',
        [{'Name': 'WebACL', 'Value': web_acl_name}, {'Name': 'Region', 'Value': 'CloudFront'}],
        region
    )
    metrics['blocked_requests'] = blocked

    # 許可されたリクエスト
    allowed = get_cloudwatch_metrics(
        'AWS/WAFV2',
        'AllowedRequests',
        [{'Name': 'WebACL', 'Value': web_acl_name}, {'Name': 'Region', 'Value': 'CloudFront'}],
        region
    )
    metrics['allowed_requests'] = allowed

    return metrics

def main():
    print("========================================")
    print("ISK RAG Chat System 監視レポート")
    print("========================================")

    print(f"生成日時: {datetime.datetime.now().isoformat()}")
    print()

    # スタック状態
    print("■ CDKスタック状態")
    stacks = [
        ('IskRagChatSystemWaf', 'us-east-1'),
        ('IskRagChatSystemBackend', 'ap-northeast-1'),
        ('IskRagChatSystemFrontend', 'ap-northeast-1')
    ]

    for stack_name, region in stacks:
        status = check_stack_status(stack_name, region)
        print(f"  {stack_name}: {status['status']}")
        if status['status'] != 'CREATE_COMPLETE':
            print(f"    詳細: {status}")
    print()

    # スタック出力の取得
    try:
        cloudformation = boto3.client('cloudformation', region_name='ap-northeast-1')
        backend_response = cloudformation.describe_stacks(StackName='IskRagChatSystemBackend')
        backend_outputs = {}
        for output in backend_response['Stacks'][0].get('Outputs', []):
            backend_outputs[output['OutputKey']] = output['OutputValue']
    except:
        print("警告: バックエンドスタック情報の取得に失敗")
        return

    # Cognitoユーザー
    if 'UserPoolId' in backend_outputs:
        print("■ Cognito User Pool")
        user_status = check_cognito_users(backend_outputs['UserPoolId'])
        if user_status['status'] == 'OK':
            print(f"  総ユーザー数: {user_status['total_users']}")
            print(f"  有効ユーザー数: {user_status['enabled_users']}")
        else:
            print(f"  エラー: {user_status['error']}")
        print()

    # API Gateway
    if 'ApiGatewayUrl' in backend_outputs:
        api_url = backend_outputs['ApiGatewayUrl']
        # URLからAPI IDを抽出
        api_id = api_url.split('//')[1].split('.')[0]

        print("■ API Gateway")
        health = check_api_gateway_health(api_id)
        print(f"  ヘルスチェック: {health['status']}")
        if health['status'] == 'OK':
            print(f"  レスポンス時間: {health['response_time_ms']}ms")
        else:
            print(f"  エラー: {health.get('error', 'Unknown error')}")
        print()

    # Lambda メトリクス
    print("■ Lambda 関数メトリクス (過去1時間)")
    lambda_functions = [
        'IskRagChatSystemBackend-ChatFunction'
    ]

    # Lambda関数名を動的に取得
    try:
        lambda_client = boto3.client('lambda', region_name='ap-northeast-1')
        functions = lambda_client.list_functions()['Functions']
        chat_functions = [f['FunctionName'] for f in functions if 'ChatFunction' in f['FunctionName']]

        for func_name in chat_functions:
            print(f"  {func_name}:")
            metrics = get_lambda_metrics(func_name)

            if metrics['invocations']['status'] == 'OK':
                print(f"    実行回数: {metrics['invocations']['value']}")

            if metrics['errors']['status'] == 'OK':
                print(f"    エラー数: {metrics['errors']['value']}")

            if metrics['duration']['status'] == 'OK':
                print(f"    平均実行時間: {metrics['duration']['value']:.2f}ms")
            print()
    except Exception as e:
        print(f"  Lambda情報取得エラー: {e}")
        print()

    # WAF メトリクス
    print("■ WAF メトリクス (過去1時間)")
    try:
        waf_metrics = get_waf_metrics('isk-rag-chat-waf', 'us-east-1')

        if waf_metrics['allowed_requests']['status'] == 'OK':
            print(f"  許可されたリクエスト: {waf_metrics['allowed_requests']['value']}")

        if waf_metrics['blocked_requests']['status'] == 'OK':
            print(f"  ブロックされたリクエスト: {waf_metrics['blocked_requests']['value']}")

        print()
    except Exception as e:
        print(f"  WAF情報取得エラー: {e}")
        print()

    print("========================================")
    print("レポート完了")
    print("========================================")

if __name__ == "__main__":
    main()