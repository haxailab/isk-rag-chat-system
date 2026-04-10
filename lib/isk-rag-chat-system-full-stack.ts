import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Duration, CustomResource, custom_resources } from 'aws-cdk-lib';

interface IskRagChatSystemFullStackProps extends cdk.StackProps {
  allowedIpRanges: string[];
}

export class IskRagChatSystemFullStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly apiGatewayUrl: string;

  constructor(scope: Construct, id: string, props: IskRagChatSystemFullStackProps) {
    super(scope, id, props);

    // 既存のCognito User Pool参照
    this.userPool = cognito.UserPool.fromUserPoolId(this, 'ExistingUserPool', 'ap-northeast-1_i2AeoNWra');
    this.userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(this, 'ExistingUserPoolClient', '66d8jukea24p01u1bfrjmq01r0');

    // OpenSearch Serverless コレクション（既存のものを参照）
    const collectionArn = 'arn:aws:aoss:ap-northeast-1:144828520862:collection/o1o29hmx73k7m2fk14kb';

    // Bedrock Knowledge Base用IAMロール
    const knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [
                'arn:aws:s3:::isk-rag-documents-144828520862-ap-northeast-1',
                'arn:aws:s3:::isk-rag-documents-144828520862-ap-northeast-1/*'
              ]
            })
          ]
        }),
        OpenSearchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['aoss:APIAccessAll'],
              resources: [collectionArn]
            })
          ]
        }),
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['bedrock:InvokeModel'],
              resources: [
                'arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.titan-embed-text-v1',
                'arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.titan-embed-text-v2:0'
              ]
            })
          ]
        })
      }
    });

    // OpenSearchインデックス作成用カスタムリソース
    const indexCreationRole = new iam.Role(this, 'IndexCreationRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        OpenSearchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['aoss:APIAccessAll'],
              resources: [collectionArn]
            })
          ]
        })
      }
    });

    // インデックス作成Lambda
    const indexCreationFunction = new lambda.Function(this, 'IndexCreationFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      role: indexCreationRole,
      timeout: Duration.minutes(5),
      code: lambda.Code.fromInline(`
import json
import boto3
import urllib3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
import cfnresponse

def handler(event, context):
    try:
        print(f"Event: {json.dumps(event)}")

        if event['RequestType'] == 'Create':
            # OpenSearchエンドポイント
            endpoint = 'https://o1o29hmx73k7m2fk14kb.ap-northeast-1.aoss.amazonaws.com'
            index_name = 'bedrock-knowledge-base-index'

            # インデックス設定
            index_body = {
                "settings": {
                    "index": {
                        "knn": True,
                        "knn.algo_param.ef_search": 512,
                        "knn.algo_param.ef_construction": 512
                    }
                },
                "mappings": {
                    "properties": {
                        "bedrock-knowledge-base-default-vector": {
                            "type": "knn_vector",
                            "dimension": 1536,
                            "method": {
                                "name": "hnsw",
                                "space_type": "cosinesimil",
                                "engine": "nmslib",
                                "parameters": {
                                    "ef_construction": 512,
                                    "ef_search": 512
                                }
                            }
                        },
                        "AMAZON_BEDROCK_TEXT_CHUNK": {
                            "type": "text"
                        },
                        "AMAZON_BEDROCK_METADATA": {
                            "type": "object"
                        }
                    }
                }
            }

            # AWS署名付きリクエスト
            session = boto3.Session()
            credentials = session.get_credentials()
            region = 'ap-northeast-1'
            service = 'aoss'

            url = f"{endpoint}/{index_name}"
            request = AWSRequest(
                method='PUT',
                url=url,
                data=json.dumps(index_body),
                headers={'Content-Type': 'application/json'}
            )

            SigV4Auth(credentials, service, region).add_auth(request)

            # HTTPリクエストの送信
            http = urllib3.PoolManager()
            response = http.request(
                method=request.method,
                url=request.url,
                body=request.body,
                headers=dict(request.headers)
            )

            print(f"Index creation response: {response.status} - {response.data.decode()}")

            if response.status in [200, 201]:
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {"IndexName": index_name})
            else:
                cfnresponse.send(event, context, cfnresponse.FAILED, {"Error": response.data.decode()})

        elif event['RequestType'] == 'Delete':
            # インデックス削除処理（必要に応じて）
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})

        else:
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})

    except Exception as e:
        print(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {"Error": str(e)})
      `),
      logRetention: logs.RetentionDays.ONE_WEEK
    });

    // カスタムリソース
    const vectorIndexCreation = new CustomResource(this, 'VectorIndexCreation', {
      serviceToken: indexCreationFunction.functionArn
    });

    // Lambda関数用IAMロール（RAG機能付き）
    const lambdaRole = new iam.Role(this, 'RAGLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock-agent:Retrieve'
              ],
              resources: ['*']
            })
          ]
        })
      }
    });

    // RAG対応Lambda関数
    const ragChatFunction = new lambda.Function(this, 'RAGChatFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
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

        # Bedrock Agentクライアント
        bedrock_agent = boto3.client('bedrock-agent-runtime', region_name='ap-northeast-1')
        bedrock_runtime = boto3.client('bedrock-runtime', region_name='ap-northeast-1')

        # Knowledge Baseから関連文書を検索
        try:
            knowledge_base_id = "${vectorIndexCreation.getAttString('KnowledgeBaseId')}"
            retrieve_response = bedrock_agent.retrieve(
                knowledgeBaseId=knowledge_base_id,
                retrievalQuery={
                    'text': user_message
                },
                retrievalConfiguration={
                    'vectorSearchConfiguration': {
                        'numberOfResults': 5
                    }
                }
            )

            # 検索結果から文書を抽出
            retrieved_docs = []
            for result in retrieve_response.get('retrievalResults', []):
                if 'content' in result and 'text' in result['content']:
                    retrieved_docs.append(result['content']['text'])

            # RAGプロンプトの構築
            context_text = "\\n\\n".join(retrieved_docs[:3]) if retrieved_docs else "関連する文書が見つかりませんでした。"

            system_prompt = f'''あなたは「無機RAG」という名前のISK社内向けAIアシスタントです。
ISKは「Local Insight, Global Impact」をスローガンとする会社です。

以下の文書から得られた情報を基に、丁寧で正確な日本語で回答してください：

【参考文書】
{context_text}

以下の特徴で回答してください：
- 上記の参考文書の内容を優先して使用する
- 技術的な質問には詳細かつ正確に回答
- ISKの企業理念である「地域に根ざした洞察で世界にインパクトを与える」精神を体現
- 必要に応じて具体的で実用的なアドバイスを提供
- 参考文書に関連情報がない場合はその旨を明記'''

        except Exception as e:
            logger.warning(f"Knowledge Base retrieval failed: {str(e)}")
            # RAG検索に失敗した場合は通常のClaude呼び出し
            system_prompt = '''あなたは「無機RAG」という名前のISK社内向けAIアシスタントです。
ISKは「Local Insight, Global Impact」をスローガンとする会社です。

以下の特徴で回答してください：
- 丁寧で親しみやすい日本語で対応
- 技術的な質問には詳細かつ正確に回答
- ISKの企業理念である「地域に根ざした洞察で世界にインパクトを与える」精神を体現
- 必要に応じて具体的で実用的なアドバイスを提供
- 常にユーザーの業務効率向上をサポートする姿勢で接する'''

        # Claude Sonnet 4を呼び出し
        model_id = 'apac.anthropic.claude-sonnet-4-20250514-v1:0'

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
                'sources': retrieved_docs[:3] if 'retrieved_docs' in locals() else [],
                'model': '無機RAG powered by Claude Sonnet 4 + Knowledge Base',
                'timestamp': context.aws_request_id
            }, ensure_ascii=False)
        }

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'error': 'Internal server error',
                'details': str(e)
            })
        }
      `),
      role: lambdaRole,
      timeout: Duration.minutes(3),
      memorySize: 512,
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        'KNOWLEDGE_BASE_ID': vectorIndexCreation.getAttString('KnowledgeBaseId')
      }
    });

    // 既存APIの取得（既存のAPIを参照）
    const api = apigateway.RestApi.fromRestApiId(this, 'ExistingApi', 'ca65otj198');

    // 新しいRAGエンドポイントの追加
    const ragChatResource = api.root.addResource('rag-chat', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });

    const authorizer = apigateway.CognitoUserPoolsAuthorizer.fromCognitoUserPoolsAuthorizerAttributes(this, 'ExistingAuthorizer', {
      authorizerId: 'existing-authorizer-id', // 既存のauthorizer IDに置き換え
      userPools: [this.userPool]
    });

    ragChatResource.addMethod('POST', new apigateway.LambdaIntegration(ragChatFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    this.apiGatewayUrl = `https://${api.restApiId}.execute-api.ap-northeast-1.amazonaws.com/prod/`;

    // Outputs
    new cdk.CfnOutput(this, 'RAGApiEndpoint', {
      value: `${this.apiGatewayUrl}rag-chat`,
      description: 'RAG Chat API Endpoint'
    });

    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: vectorIndexCreation.getAttString('KnowledgeBaseId'),
      description: 'Bedrock Knowledge Base ID'
    });
  }
}