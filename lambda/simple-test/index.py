import json
import boto3
import logging
import os
import urllib.parse

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def should_suggest_document_generation(content: str, is_rag_response: bool = False) -> bool:
    """回答に文書生成の案内を付加すべきかを判定"""
    # 300文字以上の場合
    if len(content) >= 300:
        return True

    # RAG応答の場合（社内文書を参照した回答）
    if is_rag_response:
        return True

    # 技術的なキーワードを含む場合
    technical_keywords = [
        '技術', '開発', '研究', '実験', '試験', '分析', '評価',
        '製造', '生産', '工程', '材料', '化合物', '物質',
        '温度', '圧力', '濃度', 'pH', '時間', '条件'
    ]

    return any(keyword in content for keyword in technical_keywords)

def generate_document_suggestion(content: str, is_rag_response: bool = False) -> str:
    """文書生成の案内文を生成"""
    if should_suggest_document_generation(content, is_rag_response):
        return "\n\n💾 この内容はWord・PDF・PowerPoint形式でダウンロードできます。ご希望の場合は『資料を作って』とお伝えください。"
    return ""

def call_document_generator(content: str, title: str, format_type: str, sources: list, source_links: list) -> dict:
    """文書生成APIを呼び出し（一時的に無効化）"""
    logger.info("Document generation temporarily disabled")
    return None

def handler(event, context):
    logger.info("=== Simple Test Function Started ===")
    logger.info(f"Event: {json.dumps(event, default=str)}")

    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Credentials': 'false'
    }

    try:
        # CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'message': 'CORS preflight OK'})
            }

        # Parse body
        body = json.loads(event.get('body', '{}'))
        message = body.get('message', '')
        logger.info(f"Message: {message}")

        # Environment variables check
        kb_id = os.environ.get('KNOWLEDGE_BASE_ID', 'LK9Z59ROMF')
        model_id = os.environ.get('CLAUDE_MODEL_ID', 'global.anthropic.claude-sonnet-4-6')
        logger.info(f"KB_ID: {kb_id}, Model_ID: {model_id}")

        # 質問内容の判定（挨拶や関係ない質問かチェック）
        def is_technical_query(query):
            """技術的・業務的な質問かどうかを判定"""
            if not query:
                return False

            query_lower = query.lower().strip()

            # 挨拶や一般的な会話
            greeting_patterns = [
                'こんにちは', 'こんにちわ', 'こんばんは', 'おはよう', 'hello', 'hi', 'good morning',
                'はじめまして', 'よろしく', 'ありがとう', 'thank you', 'thanks',
                'すみません', 'お疲れ様', '元気', 'how are you', 'テスト', 'test'
            ]

            # 短すぎる質問（3文字以下）
            if len(query.strip()) <= 3:
                return False

            # 挨拶パターンに該当する場合
            for pattern in greeting_patterns:
                if pattern in query_lower:
                    return False

            return True

        should_search_kb = is_technical_query(message)
        logger.info(f"Query: '{message}', Technical query: {should_search_kb}")

        # wants_document を条件分岐の前に初期化
        def wants_document_generation(query):
            """ユーザーが文書生成を求めているかどうかを判定"""
            doc_keywords = [
                '資料', 'レポート', '報告書', 'まとめて', 'ドキュメント',
                'word', 'pdf', 'powerpoint', 'プレゼン', '作って',
                '出力', 'ダウンロード', 'ファイル', '文書'
            ]
            query_lower = query.lower().strip()
            return any(keyword in query_lower for keyword in doc_keywords)

        wants_document = wants_document_generation(message)

        if not should_search_kb:
            # Knowledge Base 検索をスキップして、直接 Claude に質問
            logger.info("Skipping Knowledge Base search for non-technical query")

            # Bedrock Runtime クライアント
            bedrock_runtime = boto3.client('bedrock-runtime', region_name=os.environ.get('BEDROCK_REGION', 'ap-northeast-1'))

            simple_prompt = f"""あなたは「無機RAG」という名前のISK社内向けAIアシスタントです。
ISKは「Local Insight, Global Impact」をスローガンとする会社です。

ユーザーからの挨拶や一般的な質問に対して、親しみやすく、かつ専門的なサポートが可能なことを伝えてください。

以下の特徴で回答してください：
- 丁寧で親しみやすい日本語で対応（2-3行程度）
- ISKの企業理念を簡潔に表現
- 技術的な質問や業務サポートが可能であることを端的に案内
- 社内資料の検索が必要な場合は「社内資料を検索いたしましょうか？」と確認を求める
- 非常に簡潔で要点のみの回答（冗長な説明は避ける）"""

            response = bedrock_runtime.invoke_model(
                modelId=model_id,
                body=json.dumps({
                    'anthropic_version': 'bedrock-2023-05-31',
                    'max_tokens': 500,
                    'system': simple_prompt,
                    'messages': [
                        {
                            'role': 'user',
                            'content': message
                        }
                    ],
                    'temperature': 0.7
                })
            )

            response_body = json.loads(response['body'].read())
            answer = response_body['content'][0]['text']

            # 文書生成が要求されている場合（挨拶でも対応）
            document_url = None
            if wants_document:
                logger.info("User requested document generation for greeting response")
                title = message[:50] + "..." if len(message) > 50 else message

                try:
                    doc_result = call_document_generator(
                        content=answer,
                        title=title,
                        format_type='word',  # デフォルトはWord
                        sources=[],
                        source_links=[]
                    )

                    if doc_result and 'download_url' in doc_result:
                        document_url = doc_result['download_url']
                        answer += f"\n\n📄 **資料生成完了**\n[{doc_result['filename']}をダウンロード]({document_url})\n（リンク有効期限：{doc_result.get('expires_in', '15分')}）"
                    else:
                        answer += "\n\n⚠️ 資料生成でエラーが発生しました。"

                except Exception as doc_error:
                    logger.error(f"Document generation error: {str(doc_error)}")
                    answer += "\n\n⚠️ 資料生成でエラーが発生しました。"

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'answer': answer,
                    'sources': [],
                    'source_links': [],
                    'model': f'無機RAG powered by Claude Sonnet 4.6 (direct)',
                    'is_rag_response': False,
                    'document_count': 0,
                    'function': 'simple-test-direct',
                    'document_url': document_url
                }, ensure_ascii=False)
            }

        # Test Bedrock client creation
        try:
            bedrock_agent = boto3.client('bedrock-agent-runtime', region_name='ap-northeast-1')
            logger.info("Bedrock agent client created successfully")
        except Exception as e:
            logger.error(f"Failed to create Bedrock agent client: {e}")
            raise

        # ユーザーが詳細を求めているかチェック
        def wants_detailed_response(query):
            """ユーザーが詳細な回答を求めているかどうかを判定"""
            detail_keywords = [
                '詳しく', '詳細', 'くわしく', '詳しい', '詳しい説明',
                'もっと', 'さらに', '具体的', '具体例', '例',
                'どのように', 'なぜ', 'どうして', '理由',
                '教えて', 'おしえて', '説明して', '解説',
                '詳細に', '詳しく教えて', 'もっと詳しく'
            ]
            query_lower = query.lower().strip()
            return any(keyword in query_lower for keyword in detail_keywords)

        wants_detail = wants_detailed_response(message)
        logger.info(f"User wants detailed response: {wants_detail}, wants document: {wants_document}")

        # Knowledge Base RAG機能（技術的質問のみ）
        try:
            logger.info(f"Starting RAG process with KB ID: {kb_id}")
            retrieve_response = bedrock_agent.retrieve(
                knowledgeBaseId=kb_id,
                retrievalQuery={'text': message or 'test query'}
            )
            results_count = len(retrieve_response.get('retrievalResults', []))
            logger.info(f"KB retrieve successful: {results_count} results")

            # 検索結果から文書を抽出
            retrieved_docs = []
            sources = []
            source_links = []
            bucket_name = 'isk-rag-documents-144828520862-ap-northeast-1'

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
                            raw_filename = source_uri.split('/')[-1]

                            # ファイル名のクリーンアップ
                            # URLデコード
                            filename = urllib.parse.unquote(raw_filename)

                            # 重複部分を除去（~.txt)~.txt)のような重複）
                            if ')' in filename and filename.count('~') > 1:
                                # 最初の.txtまでを取得
                                if '.txt' in filename:
                                    first_txt_pos = filename.find('.txt')
                                    filename = filename[:first_txt_pos + 4]  # .txtを含める

                            # 末尾の余分な文字を削除
                            filename = filename.rstrip(')')

                            sources.append(filename)

                            # S3リンクを生成（オリジナルのraw_filenameを使用）
                            s3_link = f"https://s3.ap-northeast-1.amazonaws.com/{bucket_name}/{raw_filename}"
                            source_links.append({
                                'filename': filename,
                                'url': s3_link,
                                'score': result.get('score', 0)
                            })

            # Claude Sonnet 4.6でRAG回答生成
            if retrieved_docs:
                # Bedrock Runtime クライアント
                bedrock_runtime = boto3.client('bedrock-runtime', region_name=os.environ.get('BEDROCK_REGION', 'ap-northeast-1'))

                # RAGプロンプトの構築
                context_text = "\n\n".join([f"【文書{i+1}】\n{doc}" for i, doc in enumerate(retrieved_docs[:5])])

                # 参考文書リストを作成（S3リンク付き）
                reference_links = []
                for i, link in enumerate(source_links[:5]):
                    reference_links.append(f"{i+1}. [{link['filename']}]({link['url']})")

                reference_text = "\n".join(reference_links)

                # 詳細要求に応じてプロンプトを調整
                if wants_detail:
                    response_style = "- 技術的な質問には詳細で包括的に回答\n- 具体的な数値、条件、手順を含める\n- 背景情報や関連する詳細情報も提供"
                    max_response_tokens = 2000
                    response_note = "詳細版"
                else:
                    response_style = "- 要点を簡潔にまとめて回答（3-5行程度）\n- 最も重要なポイントのみに絞る\n- 冗長な説明は避け、核心部分だけを記載"
                    max_response_tokens = 1000
                    response_note = "簡潔版"

                system_prompt = f"""あなたは「無機RAG」という名前のISK社内向けAIアシスタントです。
ISKは「Local Insight, Global Impact」をスローガンとする会社です。

以下のISK社内文書から得られた情報を基に、丁寧で正確な日本語で回答してください：

=== 参考文書（Knowledge Base検索結果） ===
{context_text}
==================================================

以下の特徴で回答してください：
- 上記の参考文書の内容を最優先で活用する
{response_style}
- ISKの企業理念である「地域に根ざした洞察で世界にインパクトを与える」精神を体現
- 参考文書に記載されていない内容については「文書には記載がありませんが...」として回答
- 回答の最後に必ず以下の形式で参考文書を明記する：

※この回答はISK社内Knowledge Baseを検索して生成されました（{len(retrieved_docs)}件の関連文書を参照・{response_note}）

**参考文書（S3リンク）：**
{reference_text}"""

                # Claude Sonnet 4.6 を呼び出し
                logger.info(f"Calling Claude Sonnet 4.6 with model_id: {model_id}, max_tokens: {max_response_tokens}")
                response = bedrock_runtime.invoke_model(
                    modelId=model_id,
                    body=json.dumps({
                        'anthropic_version': 'bedrock-2023-05-31',
                        'max_tokens': max_response_tokens,
                        'system': system_prompt,
                        'messages': [
                            {
                                'role': 'user',
                                'content': message
                            }
                        ],
                        'temperature': 0.7
                    })
                )

                response_body = json.loads(response['body'].read())
                answer = response_body['content'][0]['text']

                logger.info(f"RAG response generated successfully with {len(retrieved_docs)} documents")

                # 文書生成が要求されている場合
                document_url = None
                if wants_document:
                    logger.info("User requested document generation")
                    # 最初のユーザーメッセージからタイトルを生成
                    title = message[:50] + "..." if len(message) > 50 else message

                    try:
                        doc_result = call_document_generator(
                            content=answer,
                            title=title,
                            format_type='word',  # デフォルトはWord
                            sources=sources,
                            source_links=[link['url'] for link in source_links] if source_links else []
                        )

                        if doc_result and 'download_url' in doc_result:
                            document_url = doc_result['download_url']
                            answer += f"\n\n📄 **資料生成完了**\n[{doc_result['filename']}をダウンロード]({document_url})\n（リンク有効期限：{doc_result.get('expires_in', '15分')}）"
                        else:
                            answer += "\n\n⚠️ 資料生成でエラーが発生しました。"

                    except Exception as doc_error:
                        logger.error(f"Document generation error: {str(doc_error)}")
                        answer += "\n\n⚠️ 資料生成でエラーが発生しました。"

                # プロアクティブな文書生成案内を付加
                if not wants_document:
                    doc_suggestion = generate_document_suggestion(answer, is_rag_response=True)
                    answer += doc_suggestion

                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'answer': answer,
                        'sources': sources,
                        'source_links': source_links,
                        'model': f'無機RAG powered by Claude Sonnet 4.6 (jp.anthropic.claude-sonnet-4-6)',
                        'is_rag_response': True,
                        'document_count': len(retrieved_docs),
                        'function': 'simple-test-rag',
                        'document_url': document_url
                    }, ensure_ascii=False)
                }
            else:
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({
                        'answer': 'Knowledge Base検索で関連文書が見つかりませんでした。',
                        'sources': [],
                        'source_links': [],
                        'is_rag_response': False,
                        'function': 'simple-test-rag'
                    }, ensure_ascii=False)
                }

        except Exception as kb_error:
            logger.error(f"RAG process failed: {kb_error}")
            logger.error(f"RAG error type: {type(kb_error).__name__}")
            import traceback
            logger.error(f"RAG error traceback: {traceback.format_exc()}")

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'answer': f'RAG機能でエラーが発生しました: {str(kb_error)}',
                    'error_type': type(kb_error).__name__,
                    'sources': [],
                    'source_links': [],
                    'is_rag_response': False,
                    'kb_id': kb_id,
                    'model_id': model_id,
                    'function': 'simple-test-rag'
                }, ensure_ascii=False)
            }

    except Exception as e:
        logger.error(f"General error: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")

        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': str(e),
                'error_type': type(e).__name__,
                'function': 'simple-test'
            })
        }