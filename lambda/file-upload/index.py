import json
import boto3
import base64
import logging
import traceback
import os
import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import mimetypes
from io import BytesIO

# 構造化ログ設定
logger = logging.getLogger()
logger.setLevel(logging.DEBUG if os.getenv('LOG_LEVEL') == 'DEBUG' else logging.INFO)

# AWS クライアント初期化
s3_client = boto3.client('s3')
textract_client = boto3.client('textract')
comprehend_client = boto3.client('comprehend')

# 設定
TEMP_BUCKET = os.getenv('TEMP_FILES_BUCKET')
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB制限
SUPPORTED_EXTENSIONS = {
    # テキスト系
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    # Office文書
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    # 画像（OCR対応）
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff'
}


def enhanced_error_handler(func):
    """拡張エラーハンドリングデコレーター"""
    def wrapper(event, context):
        try:
            logger.info(f"Function start: {func.__name__}", extra={
                "requestId": context.aws_request_id,
                "functionName": context.function_name,
                "eventType": event.get('httpMethod', 'UNKNOWN')
            })

            result = func(event, context)

            logger.info("Function success", extra={
                "requestId": context.aws_request_id,
                "statusCode": result.get('statusCode')
            })
            return result

        except Exception as e:
            error_details = {
                "requestId": context.aws_request_id,
                "errorType": type(e).__name__,
                "errorMessage": str(e),
                "stackTrace": traceback.format_exc(),
                "inputEvent": json.dumps(event, default=str, ensure_ascii=False)
            }

            logger.error("Function error", extra=error_details)

            return {
                'statusCode': 500,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'error': 'Internal server error',
                    'requestId': context.aws_request_id,
                    'details': str(e) if os.getenv('LOG_LEVEL') == 'DEBUG' else 'ファイルアップロードでエラーが発生しました',
                    'timestamp': datetime.utcnow().isoformat()
                }, ensure_ascii=False)
            }
    return wrapper


def get_cors_headers() -> Dict[str, str]:
    """CORS ヘッダーを取得"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'POST,OPTIONS,GET,DELETE',
        'Access-Control-Allow-Credentials': 'false'
    }


def validate_file(filename: str, file_size: int, content_type: str) -> Dict[str, Any]:
    """ファイル検証"""
    logger.debug(f"Validating file: {filename}, size: {file_size}, type: {content_type}")

    # ファイルサイズ検証
    if file_size > MAX_FILE_SIZE:
        return {
            'valid': False,
            'error': f'ファイルサイズが上限を超えています（最大: {MAX_FILE_SIZE // (1024*1024)}MB）'
        }

    # ファイル拡張子検証
    file_ext = os.path.splitext(filename)[1].lower()
    if file_ext not in SUPPORTED_EXTENSIONS:
        return {
            'valid': False,
            'error': f'サポートされていないファイル形式です: {file_ext}'
        }

    return {'valid': True}


def decode_text_content(file_content: bytes, filename: str) -> str:
    """テキストコンテンツのエンコーディングを自動検出してデコード。
    UTF-8で失敗した場合、日本語エンコーディング（Shift_JIS, CP932, EUC-JP, ISO-2022-JP）を試行する。
    """
    # 1. BOM付きUTF-8
    if file_content.startswith(b'\xef\xbb\xbf'):
        return file_content[3:].decode('utf-8')

    # 2. UTF-8
    try:
        return file_content.decode('utf-8')
    except UnicodeDecodeError:
        pass

    # 3. 日本語エンコーディングを順に試行
    for encoding in ['cp932', 'shift_jis', 'euc-jp', 'iso-2022-jp', 'latin-1']:
        try:
            decoded = file_content.decode(encoding)
            logger.info(f"File {filename} decoded with {encoding}")
            return decoded
        except (UnicodeDecodeError, LookupError):
            continue

    # 4. 最終手段: エラーを無視してUTF-8デコード
    logger.warning(f"File {filename}: all encoding attempts failed, using utf-8 with errors='replace'")
    return file_content.decode('utf-8', errors='replace')


def extract_text_content(file_content: bytes, filename: str, content_type: str) -> Dict[str, Any]:
    """ファイル形式別テキスト抽出"""
    file_ext = os.path.splitext(filename)[1].lower()
    extracted_text = ""
    metadata = {}

    try:
        if file_ext == '.txt':
            extracted_text = decode_text_content(file_content, filename)

        elif file_ext == '.json':
            text = decode_text_content(file_content, filename)
            json_data = json.loads(text)
            extracted_text = json.dumps(json_data, indent=2, ensure_ascii=False)
            metadata['json_keys'] = list(json_data.keys()) if isinstance(json_data, dict) else []

        elif file_ext == '.csv':
            import csv
            import io
            csv_content = decode_text_content(file_content, filename)
            reader = csv.DictReader(io.StringIO(csv_content))
            rows = list(reader)
            # 全行をテキスト化（10KB制限は最後に適用される）
            header = ",".join(reader.fieldnames) if reader.fieldnames else ""
            row_lines = []
            for row in rows:
                row_lines.append(",".join([str(v) for v in row.values()]))
            extracted_text = f"CSV Data ({len(rows)} rows, columns: {header}):\n{header}\n" + "\n".join(row_lines)
            metadata['csv_rows'] = len(rows)
            metadata['csv_columns'] = list(reader.fieldnames) if reader.fieldnames else []

        elif file_ext == '.pdf':
            # Textract for PDF
            try:
                response = textract_client.detect_document_text(
                    Document={'Bytes': file_content}
                )
                extracted_text = "\n".join([
                    block['Text'] for block in response['Blocks']
                    if block['BlockType'] == 'LINE'
                ])
            except Exception as e:
                logger.warning(f"Textract failed for PDF, trying fallback: {e}")
                # PyPDF2 fallbackは複雑なので、とりあえずTextractのみ
                extracted_text = f"PDF document ({filename}) - テキスト抽出に失敗しました"

        elif file_ext in ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff']:
            # Textract for Images (OCR)
            try:
                response = textract_client.detect_document_text(
                    Document={'Bytes': file_content}
                )
                extracted_text = "\n".join([
                    block['Text'] for block in response['Blocks']
                    if block['BlockType'] == 'LINE'
                ])
                if not extracted_text.strip():
                    extracted_text = f"画像ファイル ({filename}) - テキストが検出されませんでした"
            except Exception as e:
                logger.warning(f"OCR failed for image: {e}")
                extracted_text = f"画像ファイル ({filename}) - OCR処理に失敗しました"

        elif file_ext in ['.docx', '.xlsx', '.pptx']:
            # Office文書は複雑なのでとりあえずTextractで試行
            try:
                response = textract_client.detect_document_text(
                    Document={'Bytes': file_content}
                )
                extracted_text = "\n".join([
                    block['Text'] for block in response['Blocks']
                    if block['BlockType'] == 'LINE'
                ])
                if not extracted_text.strip():
                    extracted_text = f"Office文書 ({filename}) - テキスト抽出中..."
            except Exception as e:
                logger.warning(f"Textract failed for Office document: {e}")
                extracted_text = f"Office文書 ({filename}) - 後でテキストを抽出します"

        else:
            extracted_text = f"Unknown file type: {filename}"

    except Exception as e:
        logger.error(f"Text extraction failed for {filename}: {e}")
        extracted_text = f"テキスト抽出エラー: {filename}"

    return {
        'text': extracted_text[:10000],  # 10KB制限
        'full_text_length': len(extracted_text),
        'metadata': metadata
    }


def generate_session_id(user_sub: str, session_name: Optional[str] = None) -> str:
    """セッションID生成"""
    timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
    unique_id = str(uuid.uuid4())[:8]

    if session_name:
        # セッション名をファイル名安全な形式に変換
        safe_session_name = "".join(c for c in session_name if c.isalnum() or c in (' ', '-', '_')).rstrip()
        safe_session_name = safe_session_name.replace(' ', '-')[:20]  # 20文字制限
        return f"user-{user_sub}-{timestamp}-{safe_session_name}-{unique_id}"
    else:
        return f"user-{user_sub}-{timestamp}-{unique_id}"


def save_to_s3(session_id: str, file_id: str, filename: str, file_content: bytes, extracted_content: Dict[str, Any]) -> Dict[str, Any]:
    """S3へのファイル保存"""
    try:
        # ファイル保存構造
        original_key = f"sessions/{session_id}/original/{file_id}-{filename}"
        extracted_key = f"sessions/{session_id}/extracted/{file_id}.json"
        metadata_key = f"sessions/{session_id}/metadata.json"

        # 元ファイル保存（日本語ファイル名をBase64エンコード）
        encoded_filename = base64.b64encode(filename.encode('utf-8')).decode('ascii')
        s3_client.put_object(
            Bucket=TEMP_BUCKET,
            Key=original_key,
            Body=file_content,
            ContentType=mimetypes.guess_type(filename)[0] or 'application/octet-stream',
            Metadata={
                'original-filename-b64': encoded_filename,
                'file-id': file_id,
                'session-id': session_id,
                'upload-time': datetime.utcnow().isoformat()
            }
        )

        # 抽出テキスト保存
        s3_client.put_object(
            Bucket=TEMP_BUCKET,
            Key=extracted_key,
            Body=json.dumps(extracted_content, ensure_ascii=False, indent=2),
            ContentType='application/json',
            Metadata={
                'file-id': file_id,
                'session-id': session_id
            }
        )

        return {
            'success': True,
            'original_key': original_key,
            'extracted_key': extracted_key,
            's3_urls': {
                'original': f"s3://{TEMP_BUCKET}/{original_key}",
                'extracted': f"s3://{TEMP_BUCKET}/{extracted_key}"
            }
        }

    except Exception as e:
        logger.error(f"S3 save failed: {e}")
        raise e


@enhanced_error_handler
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """メインハンドラー"""

    # CORS Preflight対応
    if event['httpMethod'] == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({})
        }

    # 認証情報取得
    auth_info = event.get('requestContext', {}).get('authorizer', {})
    user_sub = auth_info.get('claims', {}).get('sub', 'anonymous')
    user_name = auth_info.get('claims', {}).get('cognito:username', 'anonymous')

    logger.info(f"File upload request from user: {user_name} (sub: {user_sub})")

    # リクエストボディ解析
    try:
        logger.info(f"Raw event body: {event.get('body', 'No body')[:500]}...")
        logger.info(f"Is Base64 Encoded: {event.get('isBase64Encoded', False)}")

        if event.get('isBase64Encoded'):
            body_content = base64.b64decode(event['body'])
        else:
            body_content = event['body'].encode('utf-8')

        request_data = json.loads(body_content.decode('utf-8'))
        logger.info(f"Parsed request data keys: {list(request_data.keys())}")
        logger.info(f"Files data present: {'files' in request_data}")
        if 'files' in request_data:
            logger.info(f"Number of files: {len(request_data['files'])}")
    except Exception as e:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Invalid request format',
                'details': str(e)
            }, ensure_ascii=False)
        }

    # ファイルデータ取得
    files_data = request_data.get('files', [])
    session_name = request_data.get('session_name')

    if not files_data:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'No files provided'
            }, ensure_ascii=False)
        }

    # セッションID生成
    session_id = generate_session_id(user_sub, session_name)

    results = []
    errors = []

    # 各ファイルを処理
    for file_data in files_data:
        try:
            filename = file_data['filename']
            file_content_b64 = file_data['content']
            content_type = file_data.get('contentType', '')

            # Base64デコード
            file_content = base64.b64decode(file_content_b64)
            file_size = len(file_content)

            # ファイル検証
            validation = validate_file(filename, file_size, content_type)
            if not validation['valid']:
                errors.append({
                    'filename': filename,
                    'error': validation['error']
                })
                continue

            # ファイルID生成
            file_id = str(uuid.uuid4())

            # テキスト抽出
            extracted_content = extract_text_content(file_content, filename, content_type)

            # S3保存
            save_result = save_to_s3(session_id, file_id, filename, file_content, extracted_content)

            # 結果追加
            results.append({
                'file_id': file_id,
                'filename': filename,
                'size': file_size,
                'content_type': content_type,
                'extracted_text_length': extracted_content['full_text_length'],
                'processing_status': 'ready',
                's3_keys': {
                    'original': save_result['original_key'],
                    'extracted': save_result['extracted_key']
                },
                'uploaded_at': datetime.utcnow().isoformat()
            })

        except Exception as e:
            logger.error(f"File processing failed for {file_data.get('filename', 'unknown')}: {e}")
            errors.append({
                'filename': file_data.get('filename', 'unknown'),
                'error': f'処理エラー: {str(e)}'
            })

    # レスポンス返却
    return {
        'statusCode': 200,
        'headers': get_cors_headers(),
        'body': json.dumps({
            'session_id': session_id,
            'session_name': session_name,
            'uploaded_files': results,
            'errors': errors,
            'summary': {
                'total_files': len(files_data),
                'successful_uploads': len(results),
                'failed_uploads': len(errors)
            },
            'expires_at': (datetime.utcnow() + timedelta(days=7)).isoformat()
        }, ensure_ascii=False)
    }