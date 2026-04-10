import json
import boto3
import logging
import os
import traceback
from typing import Dict, Any

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    # CORS headers
    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Credentials': 'false'
    }

    try:
        logger.info(f"Lambda function started. Request ID: {context.aws_request_id}")
        logger.info(f"Event: {json.dumps(event, default=str, ensure_ascii=False)}")

        # Handle preflight request
        if event['httpMethod'] == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({})
            }

        # Parse request body
        body = json.loads(event['body'])
        user_message = body.get('message', '')

        if not user_message:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'Message is required'})
            }

        # 本格Knowledge Base RAG機能
        bedrock_runtime = boto3.client('bedrock-runtime', region_name='ap-northeast-1')
        bedrock_agent = boto3.client('bedrock-agent-runtime', region_name='ap-northeast-1')
        model_id = os.environ.get('CLAUDE_MODEL_ID', 'global.anthropic.claude-sonnet-4-6')

        # Bedrock Knowledge Base から関連文書を検索
        try:
            knowledge_base_id = os.environ.get('KNOWLEDGE_BASE_ID', 'LK9Z59ROMF')
            logger.info(f"Knowledge Base RAG search for: {user_message}")
            logger.info(f"Using Knowledge Base ID: {knowledge_base_id}")
            logger.info(f"Using Model ID: {model_id}")

            # Knowledge Base から関連文書を取得
            retrieve_response = bedrock_agent.retrieve(
                knowledgeBaseId=knowledge_base_id,
                retrievalQuery={
                    'text': user_message
                }
            )

            # 検索結果から文書を抽出
            retrieved_docs = []
            sources = []
            source_links = []
            bucket_name = 'isk-rag-documents-144828520862-ap-northeast-1'

            logger.info(f"Retrieved {len(retrieve_response.get('retrievalResults', []))} results from Knowledge Base")

            for result in retrieve_response.get('retrievalResults', []):
                if 'content' in result and 'text' in result['content']:
                    # 文書内容を取得
                    content = result['content']['text']
                    retrieved_docs.append(content)

                    # メタデータからソース情報を取得
                    if 'location' in result and 's3Location' in result['location']:
                        source_uri = result['location']['s3Location']['uri']
                        # S3 URIからファイル名を抽出
                        if source_uri.startswith('s3://'):
                            filename = source_uri.split('/')[-1]
                            sources.append(filename)

                            # S3リンクを生成
                            s3_link = f"https://s3.ap-northeast-1.amazonaws.com/{bucket_name}/{filename}"
                            source_links.append({
                                'filename': filename,
                                'url': s3_link,
                                'score': result.get('score', 0)
                            })

            # RAGプロンプトの構築
            if retrieved_docs:
                context_text = "\n\n".join([f"【文書{i+1}】\n{doc}" for i, doc in enumerate(retrieved_docs[:3])])

                system_prompt = f"""あなたは「無機RAG」という名前のISK社内向けAIアシスタントです。
ISKは「Local Insight, Global Impact」をスローガンとする会社です。

以下のISK社内文書から得られた情報を基に、丁寧で正確な日本語で回答してください：

=== 参考文書（Knowledge Base検索結果） ===
{context_text}
==================================================

以下の特徴で回答してください：
- 上記の参考文書の内容を最優先で活用する
- 技術的な質問には詳細かつ正確に回答
- ISKの企業理念である「地域に根ざした洞察で世界にインパクトを与える」精神を体現
- 必要に応じて具体的で実用的なアドバイスを提供
- 参考文書に記載されていない内容については「文書には記載がありませんが...」として回答
- 回答の最後に「※この回答はISK社内Knowledge Baseを検索して生成されました（{len(retrieved_docs)}件の関連文書を参照）」と明記する"""

                model_description = "Knowledge Base RAG対応 Claude Sonnet 4"
                logger.info(f"Using Knowledge Base RAG with {len(retrieved_docs)} documents from {len(source_links)} sources")
            else:
                raise Exception("No relevant documents found in Knowledge Base")

        except Exception as e:
            # RAG検索に失敗した場合は通常のClaude呼び出し
            logger.error(f"Knowledge Base RAG search failed: {str(e)}")
            logger.error(f"Error type: {type(e).__name__}")

            # エラー詳細をログ記録
            import traceback
            logger.error(f"KB search traceback: {traceback.format_exc()}")

            error_details = str(e)
            if 'AccessDeniedException' in error_details:
                logger.error("Access denied to Knowledge Base - check IAM permissions")
                error_msg = "アクセス権限エラー"
            elif 'ResourceNotFoundException' in error_details:
                logger.error(f"Knowledge Base {knowledge_base_id} not found")
                error_msg = "Knowledge Base見つからず"
            else:
                error_msg = f"KB検索エラー: {type(e).__name__}"

            system_prompt = f"""あなたは「無機RAG」という名前のISK社内向けAIアシスタントです。
ISKは「Local Insight, Global Impact」をスローガンとする会社です。

現在、社内Knowledge Base検索システムでエラーが発生しています（{error_msg}）。
一般的な知識から回答を提供します。

以下の特徴で回答してください：
- 丁寧で親しみやすい日本語で対応
- 技術的な質問には詳細かつ正確に回答
- ISKの企業理念である「地域に根ざした洞察で世界にインパクトを与える」精神を体現
- 必要に応じて具体的で実用的なアドバイスを提供
- 特に透明酸化チタンに関する質問には、一般的な知識から詳細な情報を提供
- 回答の最後に「※この回答は一般知識から生成されており、ISK社内文書は参照していません（エラー詳細: {error_msg}）」と明記する"""

            model_description = f"Claude Sonnet 4.6（一般知識・{error_msg}）"
            sources = []
            source_links = []

        # Claude Sonnet 4 を呼び出し
        response = bedrock_runtime.invoke_model(
            modelId=model_id,
            body=json.dumps({
                'anthropic_version': 'bedrock-2023-05-31',
                'max_tokens': 2000,
                'system': system_prompt,
                'messages': [
                    {
                        'role': 'user',
                        'content': user_message
                    }
                ],
                'temperature': 0.7
            })
        )

        response_body = json.loads(response['body'].read())
        answer = response_body['content'][0]['text']

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'answer': answer,
                'sources': sources if 'sources' in locals() else [],
                'source_links': source_links if 'source_links' in locals() else [],
                'model': f"無機RAG powered by {model_description if 'model_description' in locals() else 'Claude Sonnet 4'}",
                'is_rag_response': len(source_links) > 0 if 'source_links' in locals() else False,
                'timestamp': context.aws_request_id
            }, ensure_ascii=False)
        }

    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        logger.error(f"Error in Knowledge Base RAG handler: {str(e)}")
        logger.error(f"Full traceback: {error_details}")

        # より詳細なエラー情報を提供
        error_message = str(e)
        if 'AccessDeniedException' in error_message:
            error_message = f"Knowledge Base access denied. Check IAM permissions for KB {os.environ.get('KNOWLEDGE_BASE_ID', 'LK9Z59ROMF')}"
        elif 'ResourceNotFoundException' in error_message:
            error_message = f"Knowledge Base {os.environ.get('KNOWLEDGE_BASE_ID', 'LK9Z59ROMF')} not found"
        elif 'ValidationException' in error_message:
            error_message = f"Invalid request: {error_message}"

        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': 'Knowledge Base RAG error',
                'details': error_message,
                'function': 'knowledge-base-rag',
                'model_id': os.environ.get('CLAUDE_MODEL_ID', 'global.anthropic.claude-sonnet-4-6'),
                'kb_id': os.environ.get('KNOWLEDGE_BASE_ID', 'LK9Z59ROMF'),
                'timestamp': context.aws_request_id if 'context' in locals() else 'unknown'
            }, ensure_ascii=False)
        }