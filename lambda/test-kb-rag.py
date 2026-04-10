import json
import boto3
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    try:
        headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'POST,OPTIONS'
        }

        if event['httpMethod'] == 'OPTIONS':
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({})}

        body = json.loads(event['body'])
        user_message = body.get('message', '')

        if not user_message:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Message required'})}

        # Knowledge Base RAG
        bedrock_agent = boto3.client('bedrock-agent-runtime', region_name='ap-northeast-1')
        bedrock_runtime = boto3.client('bedrock-runtime', region_name='ap-northeast-1')

        # Knowledge Base検索
        retrieve_response = bedrock_agent.retrieve(
            knowledgeBaseId='KJWX0LVKWH',
            retrievalQuery={'text': user_message},
            retrievalConfiguration={'vectorSearchConfiguration': {'numberOfResults': 3}}
        )

        retrieved_docs = []
        source_links = []

        for result in retrieve_response.get('retrievalResults', []):
            if 'content' in result:
                retrieved_docs.append(result['content']['text'])

                if 'location' in result and 's3Location' in result['location']:
                    uri = result['location']['s3Location']['uri']
                    filename = uri.split('/')[-1]
                    s3_link = f"https://s3.ap-northeast-1.amazonaws.com/isk-rag-documents-144828520862-ap-northeast-1/{filename}"
                    source_links.append({'filename': filename, 'url': s3_link})

        if retrieved_docs:
            context = "\n\n".join([f"【文書{i+1}】\n{doc[:500]}" for i, doc in enumerate(retrieved_docs)])

            system_prompt = f"""あなたは「無機RAG」です。以下のISK社内文書を参考に回答してください：

{context}

※この回答はISK社内Knowledge Baseを検索して生成されました（{len(retrieved_docs)}件の関連文書を参照）"""

            response = bedrock_runtime.invoke_model(
                modelId='apac.anthropic.claude-sonnet-4-20250514-v1:0',
                body=json.dumps({
                    'anthropic_version': 'bedrock-2023-05-31',
                    'max_tokens': 1500,
                    'system': system_prompt,
                    'messages': [{'role': 'user', 'content': user_message}],
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
                    'source_links': source_links,
                    'is_rag_response': True,
                    'model': 'Knowledge Base RAG対応 Claude Sonnet 4',
                    'kb_results': len(retrieved_docs)
                }, ensure_ascii=False)
            }
        else:
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'answer': 'Knowledge Baseで関連文書が見つかりませんでした。',
                    'source_links': [],
                    'is_rag_response': False
                })
            }

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': headers if 'headers' in locals() else {},
            'body': json.dumps({'error': str(e)})
        }