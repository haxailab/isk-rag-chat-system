import json
import boto3
import os
from datetime import datetime
import asyncio
from concurrent.futures import ThreadPoolExecutor
import base64

bedrock_runtime = boto3.client('bedrock-runtime', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
bedrock_agent_runtime = boto3.client('bedrock-agent-runtime', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
dynamodb = boto3.resource('dynamodb')

CLAUDE_MODEL_ID = os.environ.get('CLAUDE_MODEL_ID', 'global.anthropic.claude-sonnet-4-6')
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', '')
ACCESS_LOG_TABLE = os.environ.get('ACCESS_LOG_TABLE', 'isk-rag-access-log')
USER_POOL_ID = os.environ.get('USER_POOL_ID', '')
REGION = os.environ.get('AWS_REGION', 'ap-northeast-1')

# 7つのエージェント定義
AGENTS = {
    'market_strategist': {
        'name': '市場戦略家',
        'emoji': '📊',
        'bias': '王道寄り',
        'color': 'blue',
        'prompt': '''あなたはISKの市場戦略家です。

【役割】
- 顧客ニーズ、市場規模、競合分析を重視
- 既存市場の深掘りと確実な成長を優先
- データドリブンな意思決定

【思考軸】
- 市場規模は十分か？
- 顧客は誰で、なぜ買うのか？
- 競合優位性は何か？

王道寄りの視点で、堅実な市場戦略を提案してください。'''
    },
    'engineer': {
        'name': '技術者（材料屋）',
        'emoji': '🔬',
        'bias': '王道寄り',
        'color': 'green',
        'prompt': '''あなたはISKの材料開発技術者です。

【役割】
- 製造プロセス、物性、スケーラビリティを重視
- 技術の連続性と既存設備の活用を優先
- 実現可能性を厳しく評価

【思考軸】
- 現在の技術で実現可能か？
- 既存設備を活用できるか？
- 量産時の品質は保証できるか？

技術的観点から現実的な提案をしてください。'''
    },
    'finance': {
        'name': '財務・投資家',
        'emoji': '💰',
        'bias': '王道寄り',
        'color': 'yellow',
        'prompt': '''あなたはISKの財務担当・投資家視点の分析者です。

【役割】
- ROI、CAPEX、撤退判断を重視
- 数字で語り、リスクを定量化
- 株主価値の最大化を追求

【思考軸】
- 投資回収期間は？
- 失敗時の損失は？
- 既存事業とのシナジーは？

財務的観点から厳しく評価してください。'''
    },
    'cross_industry': {
        'name': '異業種転用者',
        'emoji': '🌐',
        'bias': '脇道寄り',
        'color': 'purple',
        'prompt': '''あなたは異業種の用途転用を専門とするイノベーターです。

【役割】
- 他業界の用途横展開を発想
- アナロジー思考で新しい市場を発見
- 「当社の技術が意外な場所で使えないか？」を常に考える

【思考軸】
- 他業界で似た課題はないか？
- 技術の本質的価値は何か？
- まだ誰も気づいていない用途は？

脇道寄りの発想で、大胆な転用案を提案してください。'''
    },
    'esg_regulatory': {
        'name': '規制・ESG専門家',
        'emoji': '🌱',
        'bias': '脇道トリガー',
        'color': 'teal',
        'prompt': '''あなたは環境規制・サーキュラーエコノミーの専門家です。

【役割】
- 環境規制、SDGs、サーキュラーエコノミーの観点
- 規制起点の新事業機会を発見
- 社会課題解決と事業性の両立を追求

【思考軸】
- どんな規制が近づいているか？
- 環境問題を事業機会に変えられないか？
- 廃棄物を資源化できないか？

規制トレンドから新しい事業機会を提案してください。'''
    },
    'contrarian': {
        'name': '逆張りスタートアップ',
        'emoji': '🚀',
        'bias': '脇道専門',
        'color': 'red',
        'prompt': '''あなたは大手が嫌う/見逃す領域を狙う逆張り思考の起業家です。

【役割】
- 大手が参入しない理由を逆手に取る
- ニッチ・少量多品種・カスタマイズを強みに
- 「なぜ誰もやらないのか？」を問い続ける

【思考軸】
- 大手が手を出さない理由は何か？
- その理由は本当に障壁か、それとも思い込みか？
- 小さく始めて独占できないか？

脇道専門の視点で、ブルーオーシャンを提案してください。'''
    },
    'historian': {
        'name': '歴史・失敗学',
        'emoji': '📚',
        'bias': '中立',
        'color': 'gray',
        'prompt': '''あなたは過去の撤退事業・ピボット事例から学ぶ歴史家です。

【役割】
- 過去の失敗パターンを指摘
- 成功事例のエッセンスを抽出
- バイアスを補正し、冷静な視点を提供

【思考軸】
- 過去に似た試みはなかったか？
- なぜ失敗/成功したのか？
- 今回は何が違うのか？

中立的観点から、過去の教訓を提示してください。'''
    }
}

# ファシリテーター
FACILITATOR_PROMPT = '''あなたは議論のファシリテーターです。

【役割】
- 議論を整理し、論点を明確化
- エージェント間の対立を促進
- 深掘り質問で議論を活性化

冷静かつ建設的に議論を進行してください。'''

# 評価者
EVALUATOR_PROMPT = '''あなたはメタ分析者として、各提案を客観的に評価します。

【評価軸】
1. 王道度（0-10）: 既存事業との連続性
2. 実現可能性（0-10）: 技術・リソース的実現性
3. 市場規模（0-10）: 潜在的市場の大きさ
4. 競合密度（0-10）: 競合の少なさ（10が最も空いている）

各提案を4軸でスコアリングしてください。'''

def log_access(username, endpoint, metadata=None):
    """DynamoDBにアクセスログを記録"""
    try:
        table = dynamodb.Table(ACCESS_LOG_TABLE)
        timestamp = datetime.utcnow().isoformat() + 'Z'
        ttl = int(datetime.utcnow().timestamp()) + (90 * 24 * 60 * 60)

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

def call_claude(prompt, system_prompt=None, max_tokens=4096):
    """Bedrock Claude APIを呼び出し"""
    messages = [{"role": "user", "content": prompt}]

    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "messages": messages
    }

    if system_prompt:
        request_body["system"] = system_prompt

    response = bedrock_runtime.invoke_model(
        modelId=CLAUDE_MODEL_ID,
        body=json.dumps(request_body)
    )

    response_body = json.loads(response['body'].read())
    return response_body['content'][0]['text']

def retrieve_rag_context(query, knowledge_base_id):
    """Knowledge Baseから関連情報を取得（高速化版）"""
    if not knowledge_base_id:
        return []

    try:
        print(f"RAG retrieval starting for: {query[:50]}...")
        response = bedrock_agent_runtime.retrieve(
            knowledgeBaseId=knowledge_base_id,
            retrievalQuery={'text': query},
            retrievalConfiguration={
                'vectorSearchConfiguration': {
                    'numberOfResults': 3  # 5→3に削減
                }
            }
        )

        results = []
        for item in response.get('retrievalResults', []):
            content = item['content']['text']
            # コンテンツを300文字に制限（元は500文字）
            results.append({
                'content': content[:300] if len(content) > 300 else content,
                'source': item.get('location', {}).get('s3Location', {}).get('uri', 'Unknown')
            })

        print(f"RAG retrieval completed: {len(results)} results")
        return results
    except Exception as e:
        print(f"RAG retrieval error: {str(e)}")
        return []

def run_single_agent(theme, agent_id, agent, rag_context_text=''):
    """単一エージェントの意見を取得"""
    base_prompt = f"""【議論テーマ】
{theme}

"""

    if rag_context_text:
        base_prompt += f"""【参考情報（社内資料より）】
{rag_context_text}

"""

    base_prompt += """あなたの専門的視点から、このテーマについて簡潔に意見を述べてください（100-150文字程度）：
1. 提案内容（1文）
2. 重要ポイント（1-2文）
3. 主なリスク（1文）"""

    try:
        response = call_claude(
            base_prompt,
            system_prompt=agent['prompt'],
            max_tokens=400
        )
        print(f"✅ {agent['name']} completed")
        return {
            'agent_id': agent_id,
            'agent_name': agent['name'],
            'emoji': agent['emoji'],
            'bias': agent['bias'],
            'color': agent['color'],
            'opinion': response
        }
    except Exception as e:
        print(f"❌ {agent['name']} failed: {str(e)}")
        return {
            'agent_id': agent_id,
            'agent_name': agent['name'],
            'emoji': agent['emoji'],
            'bias': agent['bias'],
            'color': agent['color'],
            'opinion': f"（エラー: {str(e)}）"
        }


def run_round1_divergence(theme, mode, rag_context_text=''):
    """Round 1: 拡散フェーズ - 各エージェントが独立に意見を提示"""
    opinions = []

    base_prompt = f"""【議論テーマ】
{theme}

"""

    if rag_context_text:
        base_prompt += f"""【参考情報（社内資料より）】
{rag_context_text}

"""

    base_prompt += """あなたの専門的視点から、このテーマについて簡潔に意見を述べてください（100-150文字程度）：
1. 提案内容（1文）
2. 重要ポイント（1-2文）
3. 主なリスク（1文）"""

    # 順次実行（並列実行よりも安定）
    opinions = []
    for agent_id, agent in AGENTS.items():
        try:
            response = call_claude(
                base_prompt,
                system_prompt=agent['prompt'],
                max_tokens=400  # 大幅削減で高速化
            )
            print(f"✅ {agent['name']} completed")
            opinions.append({
                'agent_id': agent_id,
                'agent_name': agent['name'],
                'emoji': agent['emoji'],
                'bias': agent['bias'],
                'color': agent['color'],
                'opinion': response
            })
        except Exception as e:
            print(f"❌ {agent['name']} failed: {str(e)}")
            # エラーでも続行
            continue

    return opinions

def run_round2_confrontation(theme, round1_opinions):
    """Round 2: 衝突フェーズ - 対立する意見の応酬"""

    # 全意見をまとめる
    all_opinions = "\n\n".join([
        f"【{op['agent_name']}（{op['bias']}）】\n{op['opinion']}"
        for op in round1_opinions
    ])

    # ファシリテーターが対立点を抽出
    facilitator_prompt = f"""【議論テーマ】
{theme}

【Round 1で出た意見】
{all_opinions}

この7つの意見の中から、最も対立している2つの立場を特定してください。
「王道 vs 脇道」「保守 vs 革新」など、議論が深まる対立軸を選んでください。

以下の形式で回答してください：
1. 対立軸のタイトル
2. 立場A（どのエージェント・どんな主張）
3. 立場B（どのエージェント・どんな主張）
4. なぜこの対立が重要か"""

    try:
        conflict_analysis = call_claude(facilitator_prompt, system_prompt=FACILITATOR_PROMPT, max_tokens=1024)
    except Exception as e:
        conflict_analysis = f"（分析エラー: {str(e)}）"

    return {
        'conflict_analysis': conflict_analysis,
        'all_opinions_summary': all_opinions
    }

def run_round3_convergence(theme, round1_opinions, round2_result):
    """Round 3: 収束フェーズ - 最終レポート生成（高速化版）"""

    all_content = f"""【議論テーマ】
{theme}

【Round 1: 各エージェントの意見】
{round2_result['all_opinions_summary']}

【Round 2: 対立分析】
{round2_result['conflict_analysis']}
"""

    # 評価とレポートを1回で生成（高速化）
    report_prompt = f"""{all_content}

上記の議論をもとに、以下の形式で簡潔な最終レポートを作成してください：

# 議論サマリー: {theme}

## 王道戦略 TOP3
王道度・実現可能性が高い提案を3つ選び、各案を1-2文で説明

## 脇道（ブルーオーシャン候補）TOP3
新規性が高く競合が少ない提案を3つ選び、各案について：
- 提案内容（1文）
- なぜ大手が手を出さないか（1文）

## 重要な対立点
Round 2の対立分析から最も重要な点を1つ（2-3文）

## 推奨アクション
次に検証すべきことを3つ箇条書きで

簡潔に、要点のみをMarkdown形式で。"""

    try:
        final_report = call_claude(report_prompt, max_tokens=1536)
    except Exception as e:
        final_report = f"（レポート生成エラー: {str(e)}）"

    return {
        'final_report': final_report
    }

def verify_cognito_token(id_token):
    """Cognito ID トークンを検証"""
    try:
        # トークンのペイロード部分をデコード（簡易検証）
        parts = id_token.split('.')
        if len(parts) != 3:
            return None

        payload = base64.urlsafe_b64decode(parts[1] + '==')
        claims = json.loads(payload)

        # 有効期限チェック
        if claims.get('exp', 0) < datetime.now().timestamp():
            return None

        return claims.get('cognito:username') or claims.get('email') or 'anonymous'
    except Exception as e:
        print(f"Token verification error: {e}")
        return None


def handler(event, context):
    """Lambda ハンドラー - ラウンド分割対応"""

    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS'
    }

    # CORS preflight
    http_method = event.get('requestContext', {}).get('http', {}).get('method') or event.get('httpMethod')
    if http_method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': headers,
            'body': '{}'
        }

    try:
        # イベント構造をログ出力（デバッグ用）
        print(f"Event keys: {list(event.keys())}")
        if 'headers' in event:
            print(f"Headers: {list(event['headers'].keys())}")

        # トークン検証
        username = 'anonymous'
        auth_header = None

        # Function URL形式
        if 'headers' in event and isinstance(event['headers'], dict):
            auth_header = event['headers'].get('authorization') or event['headers'].get('Authorization')

        # トークンがある場合のみ検証（なくても動作する）
        if auth_header:
            verified_username = verify_cognito_token(auth_header)
            if verified_username:
                username = verified_username
            else:
                print(f"Token verification failed, continuing as anonymous")

        # ボディ取得 (Function URL形式とAPI Gateway形式の両方に対応)
        body_str = event.get('body', '{}')
        if event.get('isBase64Encoded'):
            body_str = base64.b64decode(body_str).decode('utf-8')

        body = json.loads(body_str)
        theme = body.get('theme', '')
        mode = body.get('mode', 'normal')  # 'normal' or 'rag'
        round_num = body.get('round', 'all')  # 'all', '1', '2', '3'
        agent_id = body.get('agent_id')  # 特定エージェントのみ実行
        round1_data = body.get('round1_data')  # Round 2/3用
        round2_data = body.get('round2_data')  # Round 3用

        if not theme:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': '議論テーマが必要です'})
            }

        print(f"Starting discussion: {theme} (mode: {mode}, round: {round_num})")

        # RAGモードの場合、関連情報を取得（Round 1のみ）
        rag_context_text = ''
        if round_num in ['all', '1'] and mode == 'rag' and KNOWLEDGE_BASE_ID:
            rag_results = retrieve_rag_context(theme, KNOWLEDGE_BASE_ID)
            if rag_results:
                rag_context_text = "\n".join([
                    f"[{i+1}] {r['content']}"  # 既に300文字に制限済み
                    for i, r in enumerate(rag_results)
                ])
                print(f"RAG context prepared: {len(rag_context_text)} characters")

        # 特定エージェントのみ実行（Round 1用）
        if agent_id:
            if agent_id not in AGENTS:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': f'無効なagent_id: {agent_id}'})
                }

            agent = AGENTS[agent_id]
            opinion = run_single_agent(theme, agent_id, agent, rag_context_text)

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'agent_id': agent_id,
                    'opinion': opinion
                }, ensure_ascii=False)
            }

        # ラウンド別実行
        if round_num == '1':
            # Round 1のみ（全エージェント）
            round1_opinions = run_round1_divergence(theme, mode, rag_context_text)
            log_access(username, '/multi-agent-discussion/round1', {'theme': theme})
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'round': 1,
                    'round1': round1_opinions
                }, ensure_ascii=False)
            }

        elif round_num == '2':
            # Round 2のみ
            if not round1_data:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Round 1のデータが必要です'})
                }
            round2_result = run_round2_confrontation(theme, round1_data)
            log_access(username, '/multi-agent-discussion/round2', {'theme': theme})
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'round': 2,
                    'round2': round2_result
                }, ensure_ascii=False)
            }

        elif round_num == '3':
            # Round 3のみ
            if not round1_data or not round2_data:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Round 1とRound 2のデータが必要です'})
                }
            round3_result = run_round3_convergence(theme, round1_data, round2_data)
            log_access(username, '/multi-agent-discussion/round3', {'theme': theme})
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'round': 3,
                    'round3': round3_result
                }, ensure_ascii=False)
            }

        else:
            # 全ラウンド一括実行（後方互換性のため残す）
            round1_opinions = run_round1_divergence(theme, mode, rag_context_text)
            round2_result = run_round2_confrontation(theme, round1_opinions)
            round3_result = run_round3_convergence(theme, round1_opinions, round2_result)

            log_access(username, '/multi-agent-discussion', {
                'theme': theme,
                'mode': mode,
                'agents_count': len(round1_opinions)
            })

            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'round1': round1_opinions,
                    'round2': round2_result,
                    'round3': round3_result
                }, ensure_ascii=False)
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
