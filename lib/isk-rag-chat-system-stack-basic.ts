import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Duration } from 'aws-cdk-lib';

interface IskRagChatSystemStackProps extends cdk.StackProps {
  allowedIpRanges: string[];
}

export class IskRagChatSystemStackBasic extends cdk.Stack {
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

    // S3バケット（RAGドキュメント用）
    const documentBucket = new s3.Bucket(this, 'DocumentBucket', {
      bucketName: `isk-rag-documents-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [{
        id: 'delete-old-versions',
        noncurrentVersionExpiration: Duration.days(30)
      }],
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // OpenSearch Serverless用のセキュリティポリシー
    const osSecurityPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'OpenSearchSecurityPolicy', {
      name: 'isk-rag-security-policy',
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [
          {
            ResourceType: 'collection',
            Resource: ['collection/isk-rag-collection']
          }
        ],
        AWSOwnedKey: true
      })
    });

    // OpenSearch Serverlessネットワークポリシー
    const osNetworkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'OpenSearchNetworkPolicy', {
      name: 'isk-rag-network-policy',
      type: 'network',
      policy: JSON.stringify([{
        Rules: [
          {
            ResourceType: 'collection',
            Resource: ['collection/isk-rag-collection']
          },
          {
            ResourceType: 'dashboard',
            Resource: ['collection/isk-rag-collection']
          }
        ],
        AllowFromPublic: true
      }])
    });

    // OpenSearch Serverlessコレクション
    const osCollection = new opensearchserverless.CfnCollection(this, 'OpenSearchCollection', {
      name: 'isk-rag-collection',
      type: 'VECTORSEARCH',
      description: 'ISK RAGチャットシステム用ベクトルサーチコレクション'
    });

    osCollection.addDependency(osSecurityPolicy);
    osCollection.addDependency(osNetworkPolicy);

    // Bedrockナレッジベース用のIAMロール
    const knowledgeBaseRole = new iam.Role(this, 'KnowledgeBaseRole', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:CreateKnowledgeBase',
                'bedrock:GetKnowledgeBase',
                'bedrock:ListKnowledgeBases'
              ],
              resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v1`,
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
                `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`
              ]
            })
          ]
        }),
        OpenSearchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aoss:APIAccessAll'
              ],
              resources: [`arn:aws:aoss:${this.region}:${this.account}:collection/*`]
            })
          ]
        }),
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:ListBucket'
              ],
              resources: [
                documentBucket.bucketArn,
                `${documentBucket.bucketArn}/*`
              ]
            })
          ]
        })
      }
    });

    // OpenSearch Serverlessアクセスポリシー
    new opensearchserverless.CfnAccessPolicy(this, 'OpenSearchAccessPolicy', {
      name: 'isk-rag-access-policy',
      type: 'data',
      policy: JSON.stringify([{
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/isk-rag-collection`],
            Permission: [
              'aoss:CreateCollectionItems',
              'aoss:DeleteCollectionItems',
              'aoss:UpdateCollectionItems',
              'aoss:DescribeCollectionItems'
            ]
          },
          {
            ResourceType: 'index',
            Resource: [`index/isk-rag-collection/*`],
            Permission: [
              'aoss:CreateIndex',
              'aoss:DeleteIndex',
              'aoss:UpdateIndex',
              'aoss:DescribeIndex',
              'aoss:ReadDocument',
              'aoss:WriteDocument'
            ]
          }
        ],
        Principal: [
          knowledgeBaseRole.roleArn,
          `arn:aws:sts::${this.account}:assumed-role/${knowledgeBaseRole.roleName}/*`
        ]
      }])
    });

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'isk-rag-chat-users',
      signInAliases: {
        email: true,
        username: true
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        },
        givenName: {
          required: true,
          mutable: true
        },
        familyName: {
          required: true,
          mutable: true
        }
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Cognito User Pool Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: 'isk-rag-chat-client',
      generateSecret: false, // SPAのため
      authFlows: {
        userSrp: true,
        userPassword: true,
        adminUserPassword: true
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE
        ]
      },
      refreshTokenValidity: Duration.days(30),
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1)
    });

    // Lambda関数用のIAMロール
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
                'bedrock-agent:Retrieve'
              ],
              resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,
                `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`
              ]
            })
          ]
        })
      }
    });

    // Dead Letter Queue for Lambda function
    const chatDLQ = new sqs.Queue(this, 'ChatFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });

    // Lambda関数（チャット処理）
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
        KNOWLEDGE_BASE_ID: 'KJWX0LVKWH'
      }
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'ChatApi', {
      restApiName: 'isk-rag-chat-api',
      description: 'ISK RAGチャットシステムAPI',
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

    // APIリソースとメソッド（認証付き）
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

    // ヘルスチェック用（認証不要）
    const healthResource = api.root.addResource('health');
    healthResource.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseTemplates: {
          'application/json': '{"status": "healthy", "timestamp": "$context.requestTime"}'
        }
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{
        statusCode: '200'
      }]
    });

    // Gateway Response for CORS on auth errors
    api.addGatewayResponse('UnauthorizedResponse', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      statusCode: '401',
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'POST,OPTIONS'",
        'Access-Control-Allow-Credentials': "'false'"
      }
    });

    api.addGatewayResponse('ForbiddenResponse', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      statusCode: '403',
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
        'Access-Control-Allow-Methods': "'POST,OPTIONS'",
        'Access-Control-Allow-Credentials': "'false'"
      }
    });

    this.apiGatewayUrl = api.url;

    // Export values for cross-region reference
    this.userPoolIdOutput = this.userPool.userPoolId;
    this.userPoolClientIdOutput = this.userPoolClient.userPoolClientId;
    this.apiGatewayUrlOutput = this.apiGatewayUrl;

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

    new cdk.CfnOutput(this, 'DocumentBucketName', {
      value: documentBucket.bucketName,
      description: 'S3 Document Bucket Name'
    });

    new cdk.CfnOutput(this, 'OpenSearchCollectionEndpoint', {
      value: `https://${osCollection.attrCollectionEndpoint}`,
      description: 'OpenSearch Serverless Collection Endpoint'
    });
  }
}
