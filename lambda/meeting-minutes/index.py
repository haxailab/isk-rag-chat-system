import json
import boto3
import os
from datetime import datetime
import uuid
import base64

bedrock_runtime = boto3.client('bedrock-runtime', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

MEETING_MINUTES_BUCKET = os.environ.get('MEETING_MINUTES_BUCKET')
CLAUDE_MODEL_ID = os.environ.get('CLAUDE_MODEL_ID', 'global.anthropic.claude-sonnet-4-6')
ACCESS_LOG_TABLE = os.environ.get('ACCESS_LOG_TABLE', 'isk-rag-access-log')

# 議事録生成プロンプト（3つのスタイル）
PROMPTS = {
    'summary': """プロフェッショナルな会議ファシリテーターとして、会議の簡潔なサマリーを作成してください：
- 主な議論トピックとその背景
- 決定事項とその理由
- アクションアイテム（担当者が言及されている場合）
- 重要な期限や次のステップ
- 未解決の問題やフォローアップが必要な事項

構造化され、スキャンしやすいサマリーにしてください。受け取った文字起こしと同じ言語で記述してください。""",

    'detail': """プロフェッショナルな秘書として、包括的な会議記録を作成してください：
- 会議概要（目的、参加者（言及されている場合）、日時（言及されている場合））
- 発言者の属性を含む詳細な議論の流れ
- 決定の背景と理由
- すべてのアクションアイテム、決定事項、コミットメント
- 提起された質問とその回答
- 議論された懸念事項、リスク、ブロッカー
- 次のステップとフォローアップアクション

議論の深さとニュアンスを保ちながら、内容を論理的に整理してください。受け取った文字起こしと同じ言語で記述してください。""",

    'newspaper': """プロフェッショナルなジャーナリストとして記事を作成してください。レポーターから文字起こしされたテキストを受け取り、読者に包括的な情報を提供するために、元のコンテンツの量をできるだけ保持しながら記事を作成してください。読者のために、受け取ったテキストと同じ言語で記事を書いてください。"""
}

def log_access(username, endpoint, metadata=None):
    """DynamoDBにアクセスログを記録"""
    try:
        table = dynamodb.Table(ACCESS_LOG_TABLE)
        timestamp = datetime.utcnow().isoformat() + 'Z'
        ttl = int(datetime.utcnow().timestamp()) + (90 * 24 * 60 * 60)  # 90日後に削除

        item = {
            'username': username,
            'timestamp': timestamp,
            'endpoint': endpoint,
            'ttl': ttl
        }

        if metadata:
            item['metadata'] = json.dumps(metadata, ensure_ascii=False)

        table.put_item(Item=item)
    except Exception as e:
        print(f"Failed to log access: {str(e)}")

def generate_minutes_with_bedrock(transcript, style):
    """Bedrockを使って議事録を生成"""

    prompt = PROMPTS.get(style, PROMPTS['summary'])

    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 4096,
        "messages": [
            {
                "role": "user",
                "content": f"{prompt}\n\n以下は会議の文字起こしです：\n\n{transcript}"
            }
        ]
    }

    response = bedrock_runtime.invoke_model(
        modelId=CLAUDE_MODEL_ID,
        body=json.dumps(request_body)
    )

    response_body = json.loads(response['body'].read())
    return response_body['content'][0]['text']

def save_to_s3(bucket, key, content, content_type='text/plain'):
    """S3にファイルを保存"""
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=content,
        ContentType=content_type,
        ServerSideEncryption='AES256'
    )
    return f"s3://{bucket}/{key}"

def list_minutes(username, limit=20):
    """ユーザーの議事録一覧を取得"""
    prefix = f"users/{username}/minutes/"

    response = s3_client.list_objects_v2(
        Bucket=MEETING_MINUTES_BUCKET,
        Prefix=prefix,
        MaxKeys=limit
    )

    items = []
    for obj in response.get('Contents', []):
        # メタデータを取得
        metadata_response = s3_client.head_object(
            Bucket=MEETING_MINUTES_BUCKET,
            Key=obj['Key']
        )

        items.append({
            'key': obj['Key'],
            'size': obj['Size'],
            'lastModified': obj['LastModified'].isoformat(),
            'metadata': metadata_response.get('Metadata', {})
        })

    return items

def get_minutes(key):
    """S3から議事録を取得（音声ファイルも含む）"""
    response = s3_client.get_object(
        Bucket=MEETING_MINUTES_BUCKET,
        Key=key
    )

    content = response['Body'].read().decode('utf-8')
    metadata = response.get('Metadata', {})

    # 音声ファイルを探す
    audio_files = []
    if 'minutes_id' in metadata:
        minutes_id = metadata['minutes_id']
        timestamp = metadata.get('timestamp', '')
        username = key.split('/')[1]  # users/{username}/minutes/...

        # 音声ファイルのプレフィックス
        audio_prefix = f"users/{username}/audio/{timestamp}_{minutes_id}"

        try:
            audio_response = s3_client.list_objects_v2(
                Bucket=MEETING_MINUTES_BUCKET,
                Prefix=audio_prefix
            )

            for obj in audio_response.get('Contents', []):
                audio_files.append({
                    'key': obj['Key'],
                    'size': obj['Size'],
                    'url': f"s3://{MEETING_MINUTES_BUCKET}/{obj['Key']}"
                })
        except Exception as e:
            print(f"Failed to list audio files: {str(e)}")

    return {
        'content': content,
        'metadata': metadata,
        'lastModified': response['LastModified'].isoformat(),
        'audioFiles': audio_files
    }

def handler(event, context):
    """Lambda ハンドラー"""

    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }

    # CORS preflight
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': headers,
            'body': '{}'
        }

    try:
        # ユーザー情報を取得（Cognito Authorizer経由）
        username = 'anonymous'
        if 'requestContext' in event and 'authorizer' in event['requestContext']:
            claims = event['requestContext']['authorizer'].get('claims', {})
            username = claims.get('cognito:username', claims.get('email', 'anonymous'))

        http_method = event.get('httpMethod', 'POST')

        # GET: 議事録一覧取得
        if http_method == 'GET':
            query_params = event.get('queryStringParameters') or {}

            # 特定の議事録を取得
            if 'key' in query_params:
                minutes = get_minutes(query_params['key'])
                log_access(username, '/meeting-minutes', {'action': 'get', 'key': query_params['key']})

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps(minutes, ensure_ascii=False)
                }

            # 一覧取得
            limit = int(query_params.get('limit', 20))
            items = list_minutes(username, limit)
            log_access(username, '/meeting-minutes', {'action': 'list'})

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'items': items}, ensure_ascii=False)
            }

        # POST: 議事録生成または保存
        if http_method == 'POST':
            body = json.loads(event.get('body', '{}'))
            path = event.get('path', '/meeting-minutes')

            # パスからアクションを判定
            action = body.get('action', 'generate')  # generate or save
            if '/save' in path:
                action = 'save'
            elif '/generate' in path:
                action = 'generate'

            transcript = body.get('transcript', '')
            style = body.get('style', 'summary')  # summary, detail, newspaper

            if not transcript:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': '文字起こしテキストが必要です'})
                }

            if style not in PROMPTS:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': f'無効なスタイルです: {style}'})
                }

            # 議事録生成
            minutes = generate_minutes_with_bedrock(transcript, style)

            # 生成のみの場合はここで返す
            if action == 'generate':
                log_access(username, '/meeting-minutes/generate', {
                    'action': 'generate',
                    'style': style,
                    'transcript_length': len(transcript)
                })

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'minutes': minutes
                    }, ensure_ascii=False)
                }

            # 保存の場合
            if action == 'save':
                audio_files = body.get('audioFiles', [])  # 複数音声ファイル対応
                minutes_text = body.get('minutes', minutes)  # 既に生成済みの議事録も受け取れる

                # 一意のIDを生成
                minutes_id = str(uuid.uuid4())
                timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')

                # S3に保存
                minutes_key = f"users/{username}/minutes/{timestamp}_{minutes_id}.txt"
                transcript_key = f"users/{username}/transcripts/{timestamp}_{minutes_id}.txt"

                # 議事録を保存
                s3_client.put_object(
                    Bucket=MEETING_MINUTES_BUCKET,
                    Key=minutes_key,
                    Body=minutes_text.encode('utf-8'),
                    ContentType='text/plain',
                    ServerSideEncryption='AES256',
                    Metadata={
                        'username': username,
                        'style': style,
                        'timestamp': timestamp,
                        'minutes_id': minutes_id,
                        'audio_count': str(len(audio_files))
                    }
                )

                # 文字起こしを保存
                save_to_s3(MEETING_MINUTES_BUCKET, transcript_key, transcript.encode('utf-8'))

                # 音声ファイルを保存（複数対応）
                audio_keys = []
                for i, audio_data in enumerate(audio_files):
                    if audio_data:
                        try:
                            audio_bytes = base64.b64decode(audio_data)
                            audio_key = f"users/{username}/audio/{timestamp}_{minutes_id}_{i+1}.webm"
                            save_to_s3(MEETING_MINUTES_BUCKET, audio_key, audio_bytes, 'audio/webm')
                            audio_keys.append(audio_key)
                        except Exception as e:
                            print(f"Failed to save audio {i+1}: {str(e)}")

                # アクセスログ記録
                log_access(username, '/meeting-minutes/save', {
                    'action': 'save',
                    'style': style,
                    'transcript_length': len(transcript),
                    'minutes_id': minutes_id,
                    'audio_count': len(audio_keys)
                })

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'minutes': minutes_text,
                        'minutesKey': minutes_key,
                        'transcriptKey': transcript_key,
                        'audioKeys': audio_keys,
                        'minutesId': minutes_id,
                        'timestamp': timestamp
                    }, ensure_ascii=False)
                }

        return {
            'statusCode': 405,
            'headers': headers,
            'body': json.dumps({'error': 'メソッドが許可されていません'})
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()

        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': 'サーバーエラーが発生しました',
                'details': str(e)
            })
        }
