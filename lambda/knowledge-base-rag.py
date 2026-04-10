import json
import boto3
import logging
from typing import Dict, Any

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    try:
        # CORS headers
        headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'POST,OPTIONS',
            'Access-Control-Allow-Credentials': 'false'
        }

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
        model_id = 'apac.anthropic.claude-sonnet-4-20250514-v1:0'

        # Bedrock Knowledge Base から関連文書を検索
        try:
            knowledge_base_id = 'KJWX0LVKWH'
            logger.info(f"Knowledge Base RAG search for: {user_message}")

            # Knowledge Base から関連文書を取得
            retrieve_response = bedrock_agent.retrieve(
                knowledgeBaseId=knowledge_base_id,
                retrievalQuery={
                    'text': user_message
                },
                retrievalConfiguration={
                    'vectorSearchConfiguration': {
                        'numberOfResults': 5,
                        'overrideSearchType': 'HYBRID'  # ベクトル検索とキーワード検索の組み合わせ
                    }
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
            logger.info(f"Knowledge Base RAG search failed, using standard Claude: {str(e)}")
            system_prompt = """あなたは「無機RAG」という名前のISK社内向けAIアシスタントです。
ISKは「Local Insight, Global Impact」をスローガンとする会社です。

以下の特徴で回答してください：
- 丁寧で親しみやすい日本語で対応
- 技術的な質問には詳細かつ正確に回答
- ISKの企業理念である「地域に根ざした洞察で世界にインパクトを与える」精神を体現
- 必要に応じて具体的で実用的なアドバイスを提供
- 常にユーザーの業務効率向上をサポートする姿勢で接する
- 回答の最後に「※この回答は一般知識から生成されており、ISK社内文書は参照していません」と明記する"""

            model_description = "Claude Sonnet 4（一般知識）"
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
        logger.error(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': headers if 'headers' in locals() else {},
            'body': json.dumps({
                'error': 'Internal server error',
                'details': str(e)
            })
        }