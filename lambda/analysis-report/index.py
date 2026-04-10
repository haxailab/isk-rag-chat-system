import json
import boto3
import logging
import traceback
import os
from typing import Dict, Any, List, Optional
from datetime import datetime
import re

# 構造化ログ設定
logger = logging.getLogger()
logger.setLevel(logging.DEBUG if os.getenv('LOG_LEVEL') == 'DEBUG' else logging.INFO)

# AWS クライアント初期化
s3_client = boto3.client('s3')
bedrock_runtime = boto3.client('bedrock-runtime', region_name='ap-northeast-1')
bedrock_agent = boto3.client('bedrock-agent-runtime', region_name='ap-northeast-1')

# 設定
KNOWLEDGE_BASE_ID = os.getenv('KNOWLEDGE_BASE_ID', 'LK9Z59ROMF')
TEMP_FILES_BUCKET = os.getenv('TEMP_FILES_BUCKET')
MODEL_ID = 'jp.anthropic.claude-sonnet-4-6'
RAG_DOCUMENTS_BUCKET = 'isk-rag-documents-144828520862-ap-northeast-1'

# 分析テーマのテンプレート
ANALYSIS_THEMES = {
    'trend_analysis': {
        'name': '技術トレンド変遷分析',
        'description': '時系列での技術発展や手法の変化を分析',
        'prompt_template': """以下の文書群から技術トレンドの変遷を分析してください：
- 時系列での技術発展
- 新しい手法の導入時期
- 技術の成熟度の変化
- 将来の技術動向の予測"""
    },
    'comparative_analysis': {
        'name': '製品・プロセス比較分析',
        'description': '異なる製品やプロセス間の差異を比較分析',
        'prompt_template': """以下の文書群から製品・プロセスの比較分析を行ってください：
- 各製品/プロセスの特徴と利点
- 性能や品質の違い
- コストや効率性の比較
- 適用場面の違い"""
    },
    'research_synthesis': {
        'name': '研究成果統合分析',
        'description': '複数の研究結果から共通点や相違点を抽出',
        'prompt_template': """以下の研究文書群から統合分析を行ってください：
- 研究結果の共通点と相違点
- 実験条件や方法論の違い
- 結果の再現性と信頼性
- 統合的な結論と示唆"""
    },
    'custom_analysis': {
        'name': 'カスタム分析',
        'description': 'ユーザー指定のテーマで自由分析',
        'prompt_template': """ユーザー指定のテーマに基づいて文書群を分析してください：
{custom_theme}

分析観点：
{analysis_points}"""
    }
}


def enhanced_error_handler(func):
    """拡張エラーハンドリングデコレーター"""
    def wrapper(event, context):
        try:
            logger.info(f"Analysis Report Function start: {func.__name__}", extra={
                "requestId": context.aws_request_id,
                "functionName": context.function_name,
                "eventType": event.get('httpMethod', 'UNKNOWN')
            })

            result = func(event, context)

            logger.info("Analysis Report Function success", extra={
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

            logger.error("Analysis Report Function error", extra=error_details)

            return {
                'statusCode': 500,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'error': 'Internal server error',
                    'requestId': context.aws_request_id,
                    'details': str(e) if os.getenv('LOG_LEVEL') == 'DEBUG' else '分析レポート生成でエラーが発生しました',
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
        'Access-Control-Allow-Methods': 'POST,OPTIONS,GET',
        'Access-Control-Allow-Credentials': 'false'
    }


def gather_analysis_documents(query: str, session_id: Optional[str] = None, num_results: int = 10) -> Dict[str, Any]:
    """分析用文書を収集（Knowledge Base + セッションファイル）"""

    all_documents = []
    all_source_links = []

    # 1. Knowledge Base検索（より多くの文書を取得）
    try:
        logger.info(f"Knowledge Base search for analysis: {query}")

        retrieve_response = bedrock_agent.retrieve(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            retrievalQuery={'text': query},
            retrievalConfiguration={
                'vectorSearchConfiguration': {
                    'numberOfResults': num_results,
                    'overrideSearchType': 'HYBRID'
                }
            }
        )

        for result in retrieve_response.get('retrievalResults', []):
            if 'content' in result and 'text' in result['content']:
                content = result['content']['text']

                # メタデータ取得
                metadata = {}
                if 'location' in result and 's3Location' in result['location']:
                    source_uri = result['location']['s3Location']['uri']
                    if source_uri.startswith('s3://'):
                        filename = source_uri.split('/')[-1]
                        metadata = {
                            'filename': filename,
                            'source_type': 'knowledge_base',
                            'url': f"https://s3.ap-northeast-1.amazonaws.com/{RAG_DOCUMENTS_BUCKET}/{filename}"
                        }

                        all_source_links.append({
                            'filename': filename,
                            'url': metadata['url'],
                            'source': 'knowledge_base',
                            'score': result.get('score', 0)
                        })

                # 文書追加
                all_documents.append({
                    'content': content,
                    'source_type': 'knowledge_base',
                    'score': result.get('score', 0),
                    'metadata': metadata,
                    # 日付抽出の試行
                    'extracted_date': extract_date_from_content(content, metadata.get('filename', ''))
                })

        logger.info(f"Knowledge Base: {len(all_documents)} documents retrieved")

    except Exception as e:
        logger.error(f"Knowledge Base search failed: {e}")

    # 2. セッションファイル検索
    if session_id and TEMP_FILES_BUCKET:
        try:
            logger.info(f"Session file search for analysis: {session_id}")

            prefix = f"sessions/{session_id}/extracted/"
            response = s3_client.list_objects_v2(
                Bucket=TEMP_FILES_BUCKET,
                Prefix=prefix
            )

            for obj in response.get('Contents', []):
                try:
                    # 抽出済みテキストファイル取得
                    file_response = s3_client.get_object(
                        Bucket=TEMP_FILES_BUCKET,
                        Key=obj['Key']
                    )
                    content = file_response['Body'].read().decode('utf-8')
                    extracted_data = json.loads(content)
                    extracted_text = extracted_data.get('text', '')

                    # キーワードマッチング（分析では緩い条件）
                    if len(extracted_text) > 100:  # 最低限の内容があるファイル
                        file_id = obj['Key'].split('/')[-1].replace('.json', '')

                        # オリジナルファイル名取得
                        original_filename = f'session-file-{file_id}'
                        try:
                            original_prefix = f"sessions/{session_id}/original/"
                            original_response = s3_client.list_objects_v2(
                                Bucket=TEMP_FILES_BUCKET,
                                Prefix=original_prefix
                            )

                            for orig_obj in original_response.get('Contents', []):
                                if file_id in orig_obj['Key']:
                                    head_response = s3_client.head_object(
                                        Bucket=TEMP_FILES_BUCKET,
                                        Key=orig_obj['Key']
                                    )
                                    original_filename = head_response.get('Metadata', {}).get('original-filename', original_filename)
                                    break
                        except Exception:
                            pass

                        metadata = {
                            'filename': original_filename,
                            'source_type': 'session_file',
                            'file_id': file_id,
                            'session_id': session_id
                        }

                        all_documents.append({
                            'content': extracted_text,
                            'source_type': 'session_file',
                            'score': 1.0,
                            'metadata': metadata,
                            'extracted_date': extract_date_from_content(extracted_text, original_filename)
                        })

                        all_source_links.append({
                            'filename': original_filename,
                            'url': f"session-file://{session_id}/{file_id}",
                            'source': 'session_file',
                            'file_id': file_id,
                            'score': 1.0
                        })

                except Exception as file_error:
                    logger.warning(f"Failed to process session file {obj['Key']}: {file_error}")

            logger.info(f"Session files: {len([d for d in all_documents if d['source_type'] == 'session_file'])} documents retrieved")

        except Exception as e:
            logger.error(f"Session file search failed: {e}")

    return {
        'documents': all_documents,
        'source_links': all_source_links,
        'total_documents': len(all_documents),
        'kb_count': len([d for d in all_documents if d['source_type'] == 'knowledge_base']),
        'session_count': len([d for d in all_documents if d['source_type'] == 'session_file'])
    }


def extract_date_from_content(content: str, filename: str) -> Optional[str]:
    """文書から日付を抽出（簡易版）"""

    # ファイル名からの日付抽出
    filename_date_patterns = [
        r'(\d{4})(\d{2})(\d{2})',  # 20240301
        r'(\d{4})-(\d{2})-(\d{2})',  # 2024-03-01
        r'(\d{4})/(\d{2})/(\d{2})',  # 2024/03/01
    ]

    for pattern in filename_date_patterns:
        match = re.search(pattern, filename)
        if match:
            year, month, day = match.groups()
            return f"{year}-{month}-{day}"

    # 文書内容からの日付抽出（簡易版）
    content_date_patterns = [
        r'令和(\d+)年(\d+)月',
        r'平成(\d+)年(\d+)月',
        r'(\d{4})年(\d+)月(\d+)日',
        r'(\d{4})/(\d+)/(\d+)',
    ]

    for pattern in content_date_patterns:
        match = re.search(pattern, content[:1000])  # 最初の1000文字から検索
        if match:
            # 簡易的な変換（和暦は大体の変換）
            if '令和' in pattern:
                reiwa_year = int(match.groups()[0])
                year = 2018 + reiwa_year  # 令和元年=2019年
                month = match.groups()[1]
                return f"{year}-{month:0>2}-01"
            elif '平成' in pattern:
                heisei_year = int(match.groups()[0])
                year = 1988 + heisei_year  # 平成元年=1989年
                month = match.groups()[1]
                return f"{year}-{month:0>2}-01"
            elif len(match.groups()) >= 3:
                year, month, day = match.groups()[:3]
                return f"{year}-{month:0>2}-{day:0>2}"

    return None


def build_analysis_prompt(theme: str, custom_theme: str, analysis_points: List[str], documents: List[Dict], session_id: Optional[str]) -> str:
    """分析用プロンプトを構築"""

    # テーマ選択
    if theme in ANALYSIS_THEMES:
        theme_config = ANALYSIS_THEMES[theme]
        if theme == 'custom_analysis':
            analysis_template = theme_config['prompt_template'].format(
                custom_theme=custom_theme or "特定のテーマでの分析",
                analysis_points="\n".join([f"- {point}" for point in analysis_points]) if analysis_points else "- 主要な特徴\n- 比較・対比\n- 結論・示唆"
            )
        else:
            analysis_template = theme_config['prompt_template']
    else:
        analysis_template = ANALYSIS_THEMES['custom_analysis']['prompt_template'].format(
            custom_theme=custom_theme or "総合分析",
            analysis_points="\n".join([f"- {point}" for point in analysis_points]) if analysis_points else "- 主要な特徴\n- 比較・対比\n- 結論・示唆"
        )

    # 文書セクション構築
    kb_documents = [doc for doc in documents if doc['source_type'] == 'knowledge_base']
    session_documents = [doc for doc in documents if doc['source_type'] == 'session_file']

    document_sections = []

    # Knowledge Base文書
    if kb_documents:
        kb_docs_text = []
        for i, doc in enumerate(kb_documents[:7]):  # 最大7件
            doc_info = f"【KB文書{i+1}】ファイル: {doc['metadata'].get('filename', 'unknown')}"
            if doc.get('extracted_date'):
                doc_info += f" (推定日付: {doc['extracted_date']})"
            doc_info += f"\n{doc['content'][:2000]}"  # 2000文字制限
            kb_docs_text.append(doc_info)

        document_sections.append(f"=== ISK社内Knowledge Base文書 ({len(kb_documents)}件) ===\n" + "\n\n".join(kb_docs_text))

    # セッションファイル
    if session_documents:
        session_docs_text = []
        for i, doc in enumerate(session_documents[:5]):  # 最大5件
            doc_info = f"【セッションファイル{i+1}】ファイル: {doc['metadata'].get('filename', 'unknown')}"
            if doc.get('extracted_date'):
                doc_info += f" (推定日付: {doc['extracted_date']})"
            doc_info += f"\n{doc['content'][:2000]}"  # 2000文字制限
            session_docs_text.append(doc_info)

        document_sections.append(f"=== セッション内アップロードファイル ({len(session_documents)}件) ===\n" + "\n\n".join(session_docs_text))

    # 完全プロンプト構築
    system_prompt = f"""あなたは「無機RAG」の高度な分析エージェントです。以下の文書群に基づいて詳細な比較分析レポートを作成してください。

{analysis_template}

## 利用可能文書
{chr(10).join(document_sections)}

## 分析レポート作成指示

**構造化されたレポートを以下の形式で作成してください：**

# 📊 分析レポート
## 🔍 分析概要
- 分析対象: [文書数とソース]
- 分析テーマ: [選択されたテーマ]
- 分析期間: [推定される時間範囲]

## 📋 主要な発見事項
### 1. [発見事項1のタイトル]
- [具体的な内容]
- [根拠となる文書]

### 2. [発見事項2のタイトル]
- [具体的な内容]
- [根拠となる文書]

## 🔄 比較・対比分析
### 共通点
- [共通する特徴や傾向]

### 相違点
- [重要な違いや変化]

### 時系列変化（該当する場合）
- [技術や手法の変遷]

## 💡 洞察と示唆
### 重要な洞察
- [分析から得られた重要な理解]

### ISKへの示唆
- [ISKの事業や技術開発への影響]
- [推奨される行動]

## 📚 参考文書一覧
[使用した文書の一覧と重要度]

## ⚠️ 分析の限界
[分析の限界や注意点]

---
※この分析レポートはISK社内Knowledge Base（{len(kb_documents)}件）とセッション内ファイル（{len(session_documents)}件）を基に生成されました。
※分析結果は提供された文書の範囲内での洞察であり、包括的な調査や専門家の判断を代替するものではありません。
"""

    return system_prompt


@enhanced_error_handler
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """分析レポート生成メインハンドラー"""

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

    logger.info(f"Analysis report request from user: {user_name} (sub: {user_sub})")

    # リクエストボディ解析
    try:
        body = json.loads(event['body'])

        # リクエストパラメータ
        query = body.get('query', '').strip()
        theme = body.get('theme', 'custom_analysis')
        custom_theme = body.get('custom_theme', '').strip()
        analysis_points = body.get('analysis_points', [])
        session_id = body.get('session_id')
        num_documents = body.get('num_documents', 15)  # 分析用にデフォルトを多めに

        if not query:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'error': 'Query is required for analysis',
                    'required_fields': ['query']
                }, ensure_ascii=False)
            }

        logger.info(f"Analysis request: theme={theme}, query='{query[:50]}...', session_id={session_id}")

    except Exception as e:
        return {
            'statusCode': 400,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Invalid request format',
                'details': str(e)
            }, ensure_ascii=False)
        }

    # 分析用文書収集
    try:
        document_data = gather_analysis_documents(query, session_id, num_documents)

        if document_data['total_documents'] == 0:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({
                    'error': 'No relevant documents found for analysis',
                    'message': 'クエリに関連する文書が見つかりませんでした。別のキーワードで試してみてください。'
                }, ensure_ascii=False)
            }

        logger.info(f"Analysis documents: total={document_data['total_documents']}, kb={document_data['kb_count']}, session={document_data['session_count']}")

    except Exception as e:
        logger.error(f"Document gathering failed: {e}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Failed to gather analysis documents',
                'details': str(e) if os.getenv('LOG_LEVEL') == 'DEBUG' else '文書収集でエラーが発生しました'
            }, ensure_ascii=False)
        }

    # 分析プロンプト構築
    try:
        analysis_prompt = build_analysis_prompt(
            theme, custom_theme, analysis_points,
            document_data['documents'], session_id
        )

        logger.info(f"Analysis prompt built: {len(analysis_prompt)} characters")

    except Exception as e:
        logger.error(f"Prompt building failed: {e}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Failed to build analysis prompt',
                'details': str(e) if os.getenv('LOG_LEVEL') == 'DEBUG' else 'プロンプト構築でエラーが発生しました'
            }, ensure_ascii=False)
        }

    # Claude Sonnet 4.6で分析実行
    try:
        logger.info("Starting analysis with Claude Sonnet 4.6...")

        response = bedrock_runtime.invoke_model(
            modelId=MODEL_ID,
            body=json.dumps({
                'anthropic_version': 'bedrock-2023-05-31',
                'max_tokens': 4000,  # 分析レポート用に拡張
                'system': analysis_prompt,
                'messages': [
                    {
                        'role': 'user',
                        'content': f"以下の観点で詳細な比較分析レポートを作成してください：\n\nクエリ: {query}\n分析テーマ: {theme}\n\n構造化された分析レポートを生成してください。"
                    }
                ],
                'temperature': 0.3  # 分析の一貫性のため低めに設定
            })
        )

        response_body = json.loads(response['body'].read())
        analysis_report = response_body['content'][0]['text']

        logger.info(f"Analysis completed: {len(analysis_report)} characters generated")

        # レスポンス構築
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'analysis_report': analysis_report,
                'analysis_metadata': {
                    'theme': theme,
                    'custom_theme': custom_theme,
                    'query': query,
                    'total_documents': document_data['total_documents'],
                    'knowledge_base_documents': document_data['kb_count'],
                    'session_file_documents': document_data['session_count'],
                    'analysis_points': analysis_points,
                    'session_id': session_id
                },
                'source_links': document_data['source_links'],
                'model': "分析エージェント powered by Claude Sonnet 4.6",
                'generated_at': datetime.utcnow().isoformat(),
                'request_id': context.aws_request_id
            }, ensure_ascii=False)
        }

    except Exception as e:
        logger.error(f"Analysis generation failed: {e}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Analysis generation failed',
                'details': str(e) if os.getenv('LOG_LEVEL') == 'DEBUG' else 'Claude Sonnet 4.6での分析生成でエラーが発生しました',
                'requestId': context.aws_request_id
            }, ensure_ascii=False)
        }