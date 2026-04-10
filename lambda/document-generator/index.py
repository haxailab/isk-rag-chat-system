import json
import boto3
import logging
import os
import io
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from urllib.parse import quote
import html

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ISK Brand Colors
ISK_RED = "#C8102E"
ISK_RED_RGB = (200, 16, 46)
ISK_DARK_GRAY = "#333333"
ISK_LIGHT_GRAY = "#F5F5F5"

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda function to generate simple HTML documents from RAG responses
    """
    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Credentials': 'false'
    }

    try:
        logger.info(f"Document generator started. Request ID: {context.aws_request_id}")
        logger.info(f"Event: {json.dumps(event, default=str, ensure_ascii=False)}")

        # Handle preflight request
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({})
            }

        # Parse request body
        body = json.loads(event['body'])
        content = body.get('content', '')
        title = body.get('title', '無機RAG資料')
        format_type = body.get('format', 'html').lower()  # html for now
        sources = body.get('sources', [])
        source_links = body.get('source_links', [])

        if not content:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'Content is required'})
            }

        logger.info(f"Generating {format_type} document: {title}")

        # Generate document based on format
        if format_type == 'excel' or format_type == 'xlsx':
            csv_data = body.get('csv_data', '')
            file_buffer, filename, content_type_header = generate_excel_from_csv(csv_data or content, title)
        else:
            file_buffer, filename = generate_html_document(content, title, sources, source_links)
            content_type_header = 'text/html; charset=utf-8'

        # Upload to S3
        s3_client = boto3.client('s3')
        bucket_name = os.environ.get('TEMP_FILES_BUCKET') or os.environ.get('TEMP_BUCKET_NAME')

        if not bucket_name:
            logger.error("TEMP_BUCKET_NAME environment variable not set")
            return {
                'statusCode': 500,
                'headers': headers,
                'body': json.dumps({'error': 'Server configuration error'})
            }

        # Generate unique filename
        unique_id = str(uuid.uuid4())[:8]
        s3_key = f"documents/{unique_id}_{filename}"

        # Upload to S3
        file_buffer.seek(0)  # Ensure we're at the beginning of the buffer
        s3_client.upload_fileobj(
            file_buffer,
            bucket_name,
            s3_key,
            ExtraArgs={
                'ContentType': content_type_header,
                'ContentDisposition': f'attachment; filename="{filename}"'
            }
        )

        # Generate presigned URL (15 minutes expiration)
        download_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket_name, 'Key': s3_key},
            ExpiresIn=900  # 15 minutes
        )

        logger.info(f"Document generated and uploaded: {s3_key}")

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'message': f'{format_type.upper()}文書を生成しました',
                'download_url': download_url,
                'filename': filename,
                'format': format_type,
                'expires_in': '15分',
                'file_size': len(file_buffer.getvalue())
            }, ensure_ascii=False)
        }

    except Exception as e:
        logger.error(f"Error in document generator: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")

        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': '文書生成でエラーが発生しました',
                'details': str(e)
            }, ensure_ascii=False)
        }


def generate_excel_from_csv(csv_text: str, title: str) -> tuple[io.BytesIO, str, str]:
    """CSVテキストからExcel XML (SpreadsheetML) を生成。Excelで直接開ける形式。"""
    import csv as csv_module

    # CSVパース
    lines = csv_text.strip().split('\n')
    reader = csv_module.reader(lines)
    rows = list(reader)

    if not rows:
        # データがない場合はヘッダー行だけでも探す
        rows = [['データなし']]

    # Excel XML (SpreadsheetML) 生成
    xml_rows = []
    for i, row in enumerate(rows):
        cells = []
        for cell_value in row:
            escaped = html.escape(str(cell_value))
            # 数値判定
            try:
                float(cell_value.replace(',', ''))
                cells.append(f'   <Cell><Data ss:Type="Number">{escaped}</Data></Cell>')
            except (ValueError, AttributeError):
                cells.append(f'   <Cell><Data ss:Type="String">{escaped}</Data></Cell>')
        xml_rows.append('  <Row>\n' + '\n'.join(cells) + '\n  </Row>')

    xml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Font ss:Size="11"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Size="11" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#C8102E" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="{html.escape(title[:31])}">
  <Table>
{chr(10).join(xml_rows)}
  </Table>
 </Worksheet>
</Workbook>"""

    content_bytes = xml_content.encode('utf-8')
    buffer = io.BytesIO(content_bytes)
    buffer.seek(0)

    safe_title = "".join(c for c in title if c.isalnum() or c in "._- ").replace(" ", "_")[:50]
    filename = f"{safe_title}_{datetime.now().strftime('%Y%m%d_%H%M')}.xml"

    return buffer, filename, 'application/vnd.ms-excel'


def generate_html_document(content: str, title: str, sources: list, source_links: list) -> tuple[io.BytesIO, str]:
    """Generate HTML document with ISK branding"""

    # Escape content for HTML
    escaped_content = html.escape(content).replace('\n', '<br>')
    escaped_title = html.escape(title)

    # Generate sources HTML
    sources_html = ""
    if sources:
        sources_html = "<h2 style='color: #C8102E; border-bottom: 2px solid #C8102E; padding-bottom: 10px;'>参考文書</h2><ul>"
        for i, source in enumerate(sources, 1):
            sources_html += f"<li>{html.escape(source)}</li>"
        sources_html += "</ul>"

    # Source links HTML
    source_links_html = ""
    if source_links:
        source_links_html = "<h2 style='color: #C8102E; border-bottom: 2px solid #C8102E; padding-bottom: 10px;'>参考リンク</h2><ul>"
        for link in source_links:
            if isinstance(link, dict) and 'filename' in link and 'url' in link:
                source_links_html += f"<li><a href='{html.escape(link['url'])}' target='_blank' style='color: #C8102E;'>{html.escape(link['filename'])}</a></li>"
            elif isinstance(link, str):
                source_links_html += f"<li><a href='{html.escape(link)}' target='_blank' style='color: #C8102E;'>{html.escape(link)}</a></li>"
        source_links_html += "</ul>"

    html_content = f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{escaped_title}</title>
    <style>
        body {{
            font-family: 'Yu Gothic', 'Hiragino Kaku Gothic ProN', 'Meiryo', sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            color: #333;
        }}
        .header {{
            text-align: center;
            border-bottom: 3px solid #C8102E;
            margin-bottom: 30px;
            padding-bottom: 20px;
        }}
        .logo {{
            color: #C8102E;
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
        }}
        .subtitle {{
            color: #666;
            font-size: 16px;
            margin-bottom: 10px;
        }}
        .date {{
            color: #999;
            font-size: 14px;
        }}
        h1 {{
            color: #C8102E;
            font-size: 28px;
            margin-bottom: 20px;
        }}
        h2 {{
            color: #C8102E;
            border-bottom: 2px solid #C8102E;
            padding-bottom: 10px;
            margin-top: 30px;
        }}
        .content {{
            margin: 20px 0;
            padding: 20px;
            background-color: #F9F9F9;
            border-left: 5px solid #C8102E;
        }}
        .footer {{
            text-align: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            color: #666;
            font-size: 14px;
        }}
        ul li {{
            margin: 10px 0;
        }}
        a {{
            color: #C8102E;
            text-decoration: none;
        }}
        a:hover {{
            text-decoration: underline;
        }}
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">ISK</div>
        <div class="subtitle">Local Insight, Global Impact</div>
        <div class="date">{datetime.now().strftime('%Y年%m月%d日 %H:%M')}</div>
    </div>

    <h1>{escaped_title}</h1>

    <div class="content">
        <h2>内容</h2>
        <p>{escaped_content}</p>
    </div>

    {sources_html}

    {source_links_html}

    <div class="footer">
        <p>無機RAG powered by Claude Sonnet 4.6</p>
        <p>This document was automatically generated by ISK RAG Chat System</p>
    </div>
</body>
</html>"""

    # Create buffer with HTML content
    content_bytes = html_content.encode('utf-8')
    buffer = io.BytesIO(content_bytes)
    buffer.seek(0)

    filename = f"{title[:50]}_{datetime.now().strftime('%Y%m%d_%H%M')}.html"
    # Clean filename for safety
    filename = "".join(c for c in filename if c.isalnum() or c in "._- ").replace(" ", "_")

    return buffer, filename