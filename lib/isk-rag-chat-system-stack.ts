import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
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

    // S3バケット（一時ファイル用）- 文書生成用に24時間TTL
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
                'bedrock-runtime:InvokeModel',
                'bedrock-runtime:InvokeModelWithResponseStream'
              ],
              resources: [
                '*',
                'arn:aws:bedrock:ap-northeast-1:*:inference-profile/global.anthropic.claude-sonnet-4-6'
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
              resources: ['*']  // BedrockAgentではワイルドカードが推奨
            }),
            // Knowledge Base固有の権限を追加
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:Retrieve',
                'bedrock:RetrieveAndGenerate'
              ],
              resources: [
                'arn:aws:bedrock:ap-northeast-1:144828520862:knowledge-base/LK9Z59ROMF'
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
                'arn:aws:s3:::isk-rag-documents-*',  // Knowledge Base用S3バケット
                'arn:aws:s3:::isk-rag-documents-*/*'
              ]
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
              resources: ['*']
            })
          ]
        })
      }
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
      environment: {
        TEMP_FILES_BUCKET: tempFilesBucket.bucketName,
        CLAUDE_MODEL_ID: 'global.anthropic.claude-sonnet-4-6'
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
      environment: {
        KNOWLEDGE_BASE_ID: 'LK9Z59ROMF',
        TEMP_FILES_BUCKET: tempFilesBucket.bucketName,
        CLAUDE_MODEL_ID: 'global.anthropic.claude-sonnet-4-6'
      }
    });

    // Lambda関数（チャット処理）- 既存
    const chatFunction = new lambda.Function(this, 'ChatFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/knowledge-base-rag'),
      role: lambdaRole,
      timeout: Duration.minutes(3),
      memorySize: 1024,
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        KNOWLEDGE_BASE_ID: 'LK9Z59ROMF',
        CLAUDE_MODEL_ID: 'global.anthropic.claude-sonnet-4-6'
      }
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'ChatApi', {
      restApiName: 'isk-rag-chat-api-minimal',
      description: 'ISK RAGチャットシステム最小構成API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization']
      },
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true
      }
    });

    // Cognito認証
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ApiAuthorizer', {
      cognitoUserPools: [this.userPool],
      authorizerName: 'isk-chat-authorizer'
    });

    // 認証付きチャットエンドポイント
    const chatResource = api.root.addResource('chat', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
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
        allowOrigins: ['*'],
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
        allowOrigins: ['*'],
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });
    enhancedChatResource.addMethod('POST', new apigateway.LambdaIntegration(enhancedChatFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // セッション管理エンドポイント（認証付き）
    const sessionResource = api.root.addResource('session', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
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
      environment: {
        TEMP_FILES_BUCKET: tempFilesBucket.bucketName
      }
    });

    // シンプルテスト関数（診断用）
    const simpleTestFunction = new lambda.Function(this, 'SimpleTestFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/simple-test'),
      role: lambdaRole,
      timeout: Duration.minutes(3),
      memorySize: 512,
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        KNOWLEDGE_BASE_ID: 'LK9Z59ROMF',
        CLAUDE_MODEL_ID: 'global.anthropic.claude-sonnet-4-6',
        TEMP_FILES_BUCKET: tempFilesBucket.bucketName
      }
    });

    // シンプルテストエンドポイント（認証なし・診断用）
    const testSimpleResource = api.root.addResource('test-simple', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'X-Api-Key'],
        allowCredentials: false
      }
    });
    testSimpleResource.addMethod('POST', new apigateway.LambdaIntegration(simpleTestFunction));

    // テスト用チャットエンドポイント（認証なし）
    const testChatResource = api.root.addResource('test-chat', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'X-Api-Key'],
        allowCredentials: false
      }
    });
    testChatResource.addMethod('POST', new apigateway.LambdaIntegration(chatFunction));

    // テスト用ファイルアップロードエンドポイント（認証なし）
    const testFileUploadResource = api.root.addResource('test-file-upload', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowMethods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'X-Api-Key'],
        allowCredentials: false
      }
    });
    testFileUploadResource.addMethod('POST', new apigateway.LambdaIntegration(fileUploadFunction));
    testFileUploadResource.addMethod('GET', new apigateway.LambdaIntegration(fileUploadFunction));
    testFileUploadResource.addMethod('DELETE', new apigateway.LambdaIntegration(fileUploadFunction));

    // テスト用拡張チャットエンドポイント（認証なし）
    const testEnhancedChatResource = api.root.addResource('test-enhanced-chat', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'X-Api-Key'],
        allowCredentials: false
      }
    });
    testEnhancedChatResource.addMethod('POST', new apigateway.LambdaIntegration(enhancedChatFunction));

    // 文書生成エンドポイント（認証なし）
    const documentGeneratorResource = api.root.addResource('generate-document', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'X-Api-Key'],
        allowCredentials: false
      }
    });
    documentGeneratorResource.addMethod('POST', new apigateway.LambdaIntegration(documentGeneratorFunction));

    // ヘルスチェック用（認証不要・CORS対応）
    const healthResource = api.root.addResource('health', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
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
  }
}