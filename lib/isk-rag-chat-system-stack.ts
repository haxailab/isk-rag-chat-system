import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Duration } from 'aws-cdk-lib';

interface IskRagChatSystemStackProps extends cdk.StackProps {
  allowedIpRanges: string[];
}

export class IskRagChatSystemStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly apiGatewayUrl: string;
  public readonly userPoolIdOutput: string;
  public readonly userPoolClientIdOutput: string;
  public readonly apiGatewayUrlOutput: string;

  constructor(scope: Construct, id: string, props: IskRagChatSystemStackProps) {
    super(scope, id, props);

    // CORS許可オリジン（デプロイ時に設定可能）
    const allowedOrigins = this.node.tryGetContext('allowedOrigins') as string[] || ['*'];

    // S3バケット（一時ファイル用） 文書生成用に24時間TTL
    const tempFilesBucket = new s3.Bucket(this, 'TempFilesBucket', {
      bucketName: `isk-rag-temp-files-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{
        id: 'delete-temp-files',
        expiration: Duration.days(1) // 24時間で削除
      }],
      removalPolicy: cdk.RemovalPolicy.DESTROY // 開発用
    });

    // S3バケット（議事録保存用） 音声ファイルと議事録を永続保存
    const meetingMinutesBucket = new s3.Bucket(this, 'MeetingMinutesBucket', {
      bucketName: `isk-meeting-minutes-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true, // バージョニング有効
      lifecycleRules: [{
        id: 'archive-old-minutes',
        transitions: [{
          storageClass: s3.StorageClass.GLACIER,
          transitionAfter: Duration.days(90) // 90日後にGlacierへ
        }]
      }],
      removalPolicy: cdk.RemovalPolicy.RETAIN // 本番用：削除しない
    });

    // DynamoDB アクセスログテーブル
    const accessLogTable = new dynamodb.Table(this, 'AccessLogTable', {
      tableName: 'isk-rag-access-log',
      partitionKey: { name: 'username', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'isk-rag-chat-users-minimal',
      signInAliases: {
        email: true,
        username: true
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        }
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Cognito User Pool Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: 'isk-rag-chat-client-minimal',
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true,
        adminUserPassword: true
      },
      refreshTokenValidity: Duration.days(30),
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1)
    });

    // Cognito Identity Pool (Transcribe Streaming用)
    const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: 'isk-rag-identity-pool',
      allowUnauthenticatedIdentities: true,  // 未認証アクセスを許可（開発用）
      cognitoIdentityProviders: [{
        clientId: this.userPoolClient.userPoolClientId,
        providerName: this.userPool.userPoolProviderName
      }]
    });

    // Identity Pool用の認証ロール
    const authenticatedRole = new iam.Role(this, 'IdentityPoolAuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
        StringEquals: {
          'cognito-identity.amazonaws.com:aud': identityPool.ref
        },
        'ForAnyValue:StringLike': {
          'cognito-identity.amazonaws.com:amr': 'authenticated'
        }
      }, 'sts:AssumeRoleWithWebIdentity'),
      inlinePolicies: {
        TranscribeStreamingAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'transcribe:StartStreamTranscription',
                'transcribe:StartStreamTranscriptionWebSocket'  // WebSocket用の権限を追加
              ],
              resources: ['*']
            })
          ]
        })
      }
    });

    // 未認証ロール
    const unauthenticatedRole = new iam.Role(this, 'IdentityPoolUnauthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
        StringEquals: {
          'cognito-identity.amazonaws.com:aud': identityPool.ref
        },
        'ForAnyValue:StringLike': {
          'cognito-identity.amazonaws.com:amr': 'unauthenticated'
        }
      }, 'sts:AssumeRoleWithWebIdentity'),
      inlinePolicies: {
        TranscribeStreamingAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'transcribe:StartStreamTranscription',
                'transcribe:StartStreamTranscriptionWebSocket'  // WebSocket用の権限を追加
              ],
              resources: ['*']
            })
          ]
        })
      }
    });

    // Identity Poolにロールをアタッチ
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
        unauthenticated: unauthenticatedRole.roleArn
      }
    });

    // Lambda関数用のIAMロール（拡張版）
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
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
                'bedrock:InvokeModelWithResponseStream',
                'bedrock-runtime:InvokeModel',
                'bedrock-runtime:InvokeModelWithResponseStream'
              ],
              resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,
                `arn:aws:bedrock:${this.region}:*:inference-profile/global.anthropic.claude-sonnet-4-6`,
                `arn:aws:bedrock:*::foundation-model/anthropic.claude-*`,
                `arn:aws:bedrock:*:*:inference-profile/global.anthropic.claude-*`
              ]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:Retrieve',
                'bedrock:RetrieveAndGenerate',
                'bedrock-agent:Retrieve',
                'bedrock-agent:GetKnowledgeBase',
                'bedrock-agent:ListKnowledgeBases',
                'bedrock-agent-runtime:Retrieve',
                'bedrock-agent-runtime:RetrieveAndGenerate'
              ],
              resources: [
                `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`
              ]
            }),
            // Knowledge Base固有の権限を追加
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:Retrieve',
                'bedrock:RetrieveAndGenerate'
              ],
              resources: [
                `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/LK9Z59ROMF`
              ]
            })
          ]
        }),
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket'
              ],
              resources: [
                tempFilesBucket.bucketArn,
                `${tempFilesBucket.bucketArn}/*`,
                meetingMinutesBucket.bucketArn,
                `${meetingMinutesBucket.bucketArn}/*`,
                'arn:aws:s3:::isk-rag-documents-*',  // Knowledge Base用S3バケット
                'arn:aws:s3:::isk-rag-documents-*/*'
              ]
            })
          ]
        }),
        TranscribeAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'transcribe:StartStreamTranscription',
                'transcribe:StartTranscriptionJob',
                'transcribe:GetTranscriptionJob'
              ],
              resources: ['*'] // Transcribeはリソースレベル権限をサポートしない
            })
          ]
        }),
        DocumentProcessingAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'textract:DetectDocumentText',
                'textract:AnalyzeDocument',
                'comprehend:DetectSentiment',
                'comprehend:DetectEntities',
                'comprehend:DetectKeyPhrases'
              ],
              // Textract/Comprehend do not support resource-level permissions
              resources: ['*']
            })
          ]
        }),
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:PutItem',
                'dynamodb:Query',
                'dynamodb:Scan'
              ],
              resources: [accessLogTable.tableArn]
            })
          ]
        })
      }
    });

    // Dead Letter Queues for Lambda functions
    const fileUploadDLQ = new sqs.Queue(this, 'FileUploadFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });
    const enhancedChatDLQ = new sqs.Queue(this, 'EnhancedChatFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });
    const chatDLQ = new sqs.Queue(this, 'ChatFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });
    const documentGeneratorDLQ = new sqs.Queue(this, 'DocumentGeneratorFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });
    const accessLogDLQ = new sqs.Queue(this, 'AccessLogFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });
    const meetingMinutesDLQ = new sqs.Queue(this, 'MeetingMinutesFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });

    // Lambda関数（ファイルアップロード処理）
    const fileUploadFunction = new lambda.Function(this, 'FileUploadFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/file-upload'),
      role: lambdaRole,
      timeout: Duration.minutes(5),
      memorySize: 2048,
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: fileUploadDLQ,
      reservedConcurrentExecutions: 5,
      environment: {
        TEMP_FILES_BUCKET: tempFilesBucket.bucketName,
        CLAUDE_MODEL_ID: 'global.anthropic.claude-sonnet-4-6',
        ACCESS_LOG_TABLE: accessLogTable.tableName
      }
    });

    // Lambda関数（拡張チャット処理）
    const enhancedChatFunction = new lambda.Function(this, 'EnhancedChatFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/enhanced-chat'),
      role: lambdaRole,
      timeout: Duration.minutes(5),
      memorySize: 2048,
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: enhancedChatDLQ,
      reservedConcurrentExecutions: 10,
      environment: {
        KNOWLEDGE_BASE_ID: 'LK9Z59ROMF',
        TEMP_FILES_BUCKET: tempFilesBucket.bucketName,
        CLAUDE_MODEL_ID: 'global.anthropic.claude-sonnet-4-6',
        ACCESS_LOG_TABLE: accessLogTable.tableName
      }
    });

    // ========== 開発環境用 Lambda関数（実験用・本番と並列） ==========
    const enhancedChatDevDLQ = new sqs.Queue(this, 'EnhancedChatDevFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });

    const enhancedChatDevFunction = new lambda.Function(this, 'EnhancedChatDevFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/enhanced-chat-dev'),
      role: lambdaRole,
      timeout: Duration.minutes(5),
      memorySize: 2048,
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: enhancedChatDevDLQ,
      reservedConcurrentExecutions: 5,
      environment: {
        KNOWLEDGE_BASE_ID: 'LK9Z59ROMF',
        TEMP_FILES_BUCKET: tempFilesBucket.bucketName,
        CLAUDE_MODEL_ID: 'global.anthropic.claude-sonnet-4-6',
        ACCESS_LOG_TABLE: accessLogTable.tableName,
        ENVIRONMENT: 'dev'
      }
    });

    // Lambda関数（チャット処理） 既存
    const chatFunction = new lambda.Function(this, 'ChatFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/knowledge-base-rag'),
      role: lambdaRole,
      timeout: Duration.minutes(3),
      memorySize: 1024,
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: chatDLQ,
      reservedConcurrentExecutions: 10,
      environment: {
        KNOWLEDGE_BASE_ID: 'LK9Z59ROMF',
        CLAUDE_MODEL_ID: 'global.anthropic.claude-sonnet-4-6',
        ACCESS_LOG_TABLE: accessLogTable.tableName
      }
    });

    // マルチエージェント議論システムLambda
    const multiAgentFunction = new lambda.Function(this, 'MultiAgentDiscussionFunction', {
      functionName: 'MultiAgentDiscussionFunction',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/multi-agent-discussion'),
      role: lambdaRole,
      timeout: Duration.minutes(5),  // 複数エージェント実行のため長めに設定
      memorySize: 2048,
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: chatDLQ,
      reservedConcurrentExecutions: 5,  // 並列実行数制限
      environment: {
        KNOWLEDGE_BASE_ID: 'LK9Z59ROMF',
        CLAUDE_MODEL_ID: 'global.anthropic.claude-sonnet-4-6',
        ACCESS_LOG_TABLE: accessLogTable.tableName,
        USER_POOL_ID: this.userPool.userPoolId,
        AWS_REGION: this.region
      }
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'ChatApi', {
      restApiName: 'isk-rag-chat-api-minimal',
      description: 'ISK RAGチャットシステム最小構成API',
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization']
      },
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200
      }
    });

    // 認証エラー(401)などのデフォルトレスポンスにも CORS ヘッダーを付与
    // (ブラウザが「CORS エラー」として表示するのを防ぎ、実際のエラー内容を見えるようにする)
    const corsGatewayHeaders = {
      'Access-Control-Allow-Origin': "'*'",
      'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
      'Access-Control-Allow-Methods': "'POST,GET,DELETE,OPTIONS'"
    };
    api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      statusCode: '401',
      responseHeaders: corsGatewayHeaders
    });
    api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      statusCode: '403',
      responseHeaders: corsGatewayHeaders
    });
    api.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: corsGatewayHeaders
    });
    api.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: corsGatewayHeaders
    });

    // リクエストバリデーション
    const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
      restApi: api,
      validateRequestBody: true,
      validateRequestParameters: true
    });

    // Cognito認証
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ApiAuthorizer', {
      cognitoUserPools: [this.userPool],
      authorizerName: 'isk-chat-authorizer'
    });

    // 認証付きチャットエンドポイント
    const chatResource = api.root.addResource('chat', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });
    chatResource.addMethod('POST', new apigateway.LambdaIntegration(chatFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // ファイルアップロードエンドポイント（認証付き）
    const fileUploadResource = api.root.addResource('file-upload', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });
    fileUploadResource.addMethod('POST', new apigateway.LambdaIntegration(fileUploadFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // 拡張チャットエンドポイント（認証付き）
    const enhancedChatResource = api.root.addResource('enhanced-chat', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });
    enhancedChatResource.addMethod('POST', new apigateway.LambdaIntegration(enhancedChatFunction, {
      timeout: Duration.seconds(29)
    }), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // ========== 開発環境用エンドポイント（本番と同じ Cognito User Pool を共有） ==========
    const enhancedChatDevResource = api.root.addResource('enhanced-chat-dev', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });
    enhancedChatDevResource.addMethod('POST', new apigateway.LambdaIntegration(enhancedChatDevFunction, {
      timeout: Duration.seconds(29)
    }), {
      authorizer,  // 本番と同じ authorizer を共有
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // セッション管理エンドポイント（認証付き）
    const sessionResource = api.root.addResource('session', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['GET', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });

    // セッションファイル一覧取得
    sessionResource.addMethod('GET', new apigateway.LambdaIntegration(fileUploadFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // セッション削除
    sessionResource.addMethod('DELETE', new apigateway.LambdaIntegration(fileUploadFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // 文書生成関数
    const documentGeneratorFunction = new lambda.Function(this, 'DocumentGeneratorFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/document-generator'),
      role: lambdaRole,
      timeout: Duration.minutes(5),
      memorySize: 1024,
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: documentGeneratorDLQ,
      reservedConcurrentExecutions: 5,
      environment: {
        TEMP_FILES_BUCKET: tempFilesBucket.bucketName
      }
    });

    // 議事録生成関数
    const meetingMinutesFunction = new lambda.Function(this, 'MeetingMinutesFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/meeting-minutes'),
      role: lambdaRole,
      timeout: Duration.minutes(5),
      memorySize: 2048,
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: meetingMinutesDLQ,
      reservedConcurrentExecutions: 5,
      environment: {
        MEETING_MINUTES_BUCKET: meetingMinutesBucket.bucketName,
        CLAUDE_MODEL_ID: 'global.anthropic.claude-sonnet-4-6',
        ACCESS_LOG_TABLE: accessLogTable.tableName
      }
    });

    const accessLogFunction = new lambda.Function(this, 'AccessLogFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import json
import boto3
import os
from datetime import datetime, timedelta

dynamodb = boto3.resource('dynamodb')
TABLE_NAME = os.environ.get('ACCESS_LOG_TABLE', 'isk-rag-access-log')

def handler(event, context):
    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
    }
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': headers, 'body': '{}'}

    try:
        table = dynamodb.Table(TABLE_NAME)
        params = event.get('queryStringParameters') or {}
        username = params.get('username')
        days = int(params.get('days', '30'))

        since = (datetime.utcnow() - timedelta(days=days)).isoformat() + 'Z'

        if username:
            resp = table.query(
                KeyConditionExpression='username = :u AND #ts >= :since',
                ExpressionAttributeNames={'#ts': 'timestamp'},
                ExpressionAttributeValues={':u': username, ':since': since},
                ScanIndexForward=False,
                Limit=100
            )
        else:
            resp = table.scan(
                FilterExpression='#ts >= :since',
                ExpressionAttributeNames={'#ts': 'timestamp'},
                ExpressionAttributeValues={':since': since},
                Limit=500
            )

        items = resp.get('Items', [])

        # ユーザー別集計
        summary = {}
        for item in items:
            u = item['username']
            if u not in summary:
                summary[u] = {'username': u, 'count': 0, 'last_access': '', 'endpoints': {}}
            summary[u]['count'] += 1
            if item['timestamp'] > summary[u]['last_access']:
                summary[u]['last_access'] = item['timestamp']
            ep = item.get('endpoint', 'unknown')
            summary[u]['endpoints'][ep] = summary[u]['endpoints'].get(ep, 0) + 1

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'logs': items[:100],
                'summary': sorted(summary.values(), key=lambda x: x['last_access'], reverse=True),
                'total': len(items),
                'period_days': days
            }, ensure_ascii=False, default=str)
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({'error': str(e)})
        }
`),
      role: lambdaRole,
      timeout: Duration.seconds(30),
      memorySize: 256,
      deadLetterQueue: accessLogDLQ,
      reservedConcurrentExecutions: 5,
      environment: {
        ACCESS_LOG_TABLE: accessLogTable.tableName
      }
    });

    // アクセスログエンドポイント（認証付き）
    const accessLogResource = api.root.addResource('access-log', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['GET', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });
    accessLogResource.addMethod('GET', new apigateway.LambdaIntegration(accessLogFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // 議事録エンドポイント（認証付き）
    const meetingMinutesResource = api.root.addResource('meeting-minutes', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });
    meetingMinutesResource.addMethod('GET', new apigateway.LambdaIntegration(meetingMinutesFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });
    meetingMinutesResource.addMethod('POST', new apigateway.LambdaIntegration(meetingMinutesFunction, {
      timeout: Duration.seconds(29)
    }), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // マルチエージェント議論システムエンドポイント
    const multiAgentResource = api.root.addResource('multi-agent-discussion', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });
    // マルチエージェント議論は長時間実行のため、Lambda Function URLを使用
    const multiAgentFunctionUrl = multiAgentFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,  // 認証はトークン検証で実施
      cors: {
        allowedOrigins: allowedOrigins,
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: Duration.seconds(300)
      },
      invokeMode: lambda.InvokeMode.BUFFERED  // 5分まで対応
    });

    // 出力用
    new cdk.CfnOutput(this, 'MultiAgentFunctionUrl', {
      value: multiAgentFunctionUrl.url,
      description: 'マルチエージェント議論Lambda Function URL'
    });

    // ヘルスチェック用（認証不要、CORS対応）
    const healthResource = api.root.addResource('health', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['GET', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
        allowCredentials: false
      }
    });

    healthResource.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseTemplates: {
          'application/json': '{"status": "healthy", "timestamp": "$context.requestTime", "version": "minimal"}'
        },
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'*'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type'",
          'method.response.header.Access-Control-Allow-Methods': "'GET,OPTIONS'"
        }
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': false,
          'method.response.header.Access-Control-Allow-Headers': false,
          'method.response.header.Access-Control-Allow-Methods': false
        }
      }]
    });

    this.apiGatewayUrl = api.url;

    // Export values for cross-region reference
    const userPoolIdExport = new cdk.CfnOutput(this, 'UserPoolIdExport', {
      value: this.userPool.userPoolId,
      exportName: 'IskRagChatSystemBackend:UserPoolId'
    });

    const userPoolClientIdExport = new cdk.CfnOutput(this, 'UserPoolClientIdExport', {
      value: this.userPoolClient.userPoolClientId,
      exportName: 'IskRagChatSystemBackend:UserPoolClientId'
    });

    const apiGatewayUrlExport = new cdk.CfnOutput(this, 'ApiGatewayUrlExport', {
      value: this.apiGatewayUrl,
      exportName: 'IskRagChatSystemBackend:ApiGatewayUrl'
    });

    this.userPoolIdOutput = userPoolIdExport.value;
    this.userPoolClientIdOutput = userPoolClientIdExport.value;
    this.apiGatewayUrlOutput = apiGatewayUrlExport.value;

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID'
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID'
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.apiGatewayUrl,
      description: 'API Gateway URL'
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: identityPool.ref,
      description: 'Cognito Identity Pool ID for Transcribe Streaming'
    });

  }
}
