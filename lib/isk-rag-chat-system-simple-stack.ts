import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Duration } from 'aws-cdk-lib';

interface IskRagChatSystemSimpleStackProps extends cdk.StackProps {
  allowedIpRanges: string[];
}

export class IskRagChatSystemSimpleStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly apiGatewayUrl: string;
  public readonly tempFilesBucket: s3.Bucket;
  public readonly userPoolIdOutput: string;
  public readonly userPoolClientIdOutput: string;
  public readonly apiGatewayUrlOutput: string;
  public readonly tempFilesBucketOutput: string;

  constructor(scope: Construct, id: string, props: IskRagChatSystemSimpleStackProps) {
    super(scope, id, props);

    // CORS許可オリジン（デプロイ時に設定可能）
    const allowedOrigins = this.node.tryGetContext('allowedOrigins') as string[] || ['*'];

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'isk-rag-chat-users-simple',
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
      userPoolClientName: 'isk-rag-chat-client-simple',
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

    // S3一時ファイルバケット（7日間TTL、CORS設定付き）
    const tempFilesBucket = new s3.Bucket(this, 'TempFilesBucket', {
      bucketName: `isk-rag-temp-files-${this.account}-${this.region}`,
      // 7日間の自動削除設定
      lifecycleRules: [{
        id: 'DeleteTempFilesAfter7Days',
        expiration: Duration.days(7),
        prefix: 'sessions/',
        enabled: true
      }],
      // CORS設定（フロントエンドからの直接アップロード用）
      cors: [{
        allowedOrigins: allowedOrigins, // CDK Contextから取得した特定ドメインに制限
        allowedMethods: [
          s3.HttpMethods.GET,
          s3.HttpMethods.PUT,
          s3.HttpMethods.POST,
          s3.HttpMethods.DELETE,
          s3.HttpMethods.HEAD
        ],
        allowedHeaders: [
          'Content-Type',
          'Content-Length',
          'Authorization',
          'x-amz-date',
          'x-amz-security-token',
          'x-amz-meta-*'
        ],
        exposedHeaders: ['ETag'],
        maxAge: 3000
      }],
      // 暗号化設定
      encryption: s3.BucketEncryption.S3_MANAGED,
      // バージョニング無効（一時ファイルのため）
      versioned: false,
      // パブリックアクセス禁止
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // スタック削除時にバケットも削除（開発環境用）
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // chatFunction用IAMロール（Bedrock + S3 KB docs/temp + Textract/Comprehend）
    const chatRole = new iam.Role(this, 'ChatLambdaRole', {
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
                `arn:aws:s3:::isk-rag-documents-${this.account}-${this.region}`,
                `arn:aws:s3:::isk-rag-documents-${this.account}-${this.region}/*`
              ]
            }),
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
                `${tempFilesBucket.bucketArn}/*`
              ]
            })
          ]
        }),
        TextractComprehendAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'textract:DetectDocumentText',
                'textract:AnalyzeDocument',
                'comprehend:DetectLanguage',
                'comprehend:DetectSentiment'
              ],
              // Textract/Comprehend do not support resource-level permissions
              resources: ['*']
            })
          ]
        })
      }
    });

    // fileUploadFunction用IAMロール（S3 temp + Textract/Comprehend）
    const fileUploadRole = new iam.Role(this, 'FileUploadLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
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
                `${tempFilesBucket.bucketArn}/*`
              ]
            })
          ]
        }),
        TextractComprehendAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'textract:DetectDocumentText',
                'textract:AnalyzeDocument',
                'comprehend:DetectLanguage',
                'comprehend:DetectSentiment'
              ],
              // Textract/Comprehend do not support resource-level permissions
              resources: ['*']
            })
          ]
        })
      }
    });

    // analysisReportFunction用IAMロール（Bedrock + S3 KB docs/temp + Textract/Comprehend）
    const analysisReportRole = new iam.Role(this, 'AnalysisReportLambdaRole', {
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
                `arn:aws:s3:::isk-rag-documents-${this.account}-${this.region}`,
                `arn:aws:s3:::isk-rag-documents-${this.account}-${this.region}/*`
              ]
            }),
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
                `${tempFilesBucket.bucketArn}/*`
              ]
            })
          ]
        }),
        TextractComprehendAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'textract:DetectDocumentText',
                'textract:AnalyzeDocument',
                'comprehend:DetectLanguage',
                'comprehend:DetectSentiment'
              ],
              // Textract/Comprehend do not support resource-level permissions
              resources: ['*']
            })
          ]
        })
      }
    });

    // sessionManagement用の最小権限IAMロール
    const sessionManagementRole = new iam.Role(this, 'SessionManagementLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
                's3:HeadObject'
              ],
              resources: [
                tempFilesBucket.bucketArn,
                `${tempFilesBucket.bucketArn}/*`
              ]
            })
          ]
        })
      }
    });

    // getAnalysisThemes用の最小権限IAMロール
    const analysisThemesRole = new iam.Role(this, 'AnalysisThemesLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    // Dead Letter Queues for Lambda functions
    const chatDLQ = new sqs.Queue(this, 'ChatFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });
    const fileUploadDLQ = new sqs.Queue(this, 'FileUploadFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });
    const analysisReportDLQ = new sqs.Queue(this, 'AnalysisReportFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });
    const sessionManagementDLQ = new sqs.Queue(this, 'SessionManagementFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });

    // Lambda関数（チャット処理） Enhanced版（ハイブリッド検索対応）
    const chatFunction = new lambda.Function(this, 'ChatFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/enhanced-chat'),
      role: chatRole,
      timeout: Duration.minutes(5), // ハイブリッド検索用に拡張
      memorySize: 2048, // ハイブリッド検索用に拡張
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: chatDLQ,
      reservedConcurrentExecutions: 10,
      environment: {
        KNOWLEDGE_BASE_ID: 'LK9Z59ROMF',
        KNOWLEDGE_BASE_VERSION: '3.0-hybrid',
        TEMP_FILES_BUCKET: tempFilesBucket.bucketName,
        LOG_LEVEL: 'INFO'
      },
      // X-Ray トレーシング有効化
      tracing: lambda.Tracing.ACTIVE
    });

    // ファイルアップロード用Lambda関数（新規）
    const fileUploadFunction = new lambda.Function(this, 'FileUploadFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/file-upload'),
      role: fileUploadRole, // ファイルアップロード専用ロール
      timeout: Duration.minutes(5), // ファイル処理用
      memorySize: 2048, // Textract処理用
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: fileUploadDLQ,
      reservedConcurrentExecutions: 5,
      environment: {
        TEMP_FILES_BUCKET: tempFilesBucket.bucketName,
        LOG_LEVEL: 'INFO'
      },
      // X-Ray トレーシング有効化
      tracing: lambda.Tracing.ACTIVE
    });

    // 比較分析レポート生成用Lambda関数（新規）
    const analysisReportFunction = new lambda.Function(this, 'AnalysisReportFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/analysis-report'),
      role: analysisReportRole, // 分析レポート専用ロール
      timeout: Duration.minutes(5), // 分析処理に適切なタイムアウト
      memorySize: 2048, // 分析処理に適切なメモリ
      logRetention: logs.RetentionDays.ONE_WEEK,
      deadLetterQueue: analysisReportDLQ,
      reservedConcurrentExecutions: 3,
      environment: {
        KNOWLEDGE_BASE_ID: 'LK9Z59ROMF',
        TEMP_FILES_BUCKET: tempFilesBucket.bucketName,
        LOG_LEVEL: 'INFO'
      },
      // X-Ray トレーシング有効化
      tracing: lambda.Tracing.ACTIVE
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'ChatApi', {
      restApiName: 'isk-rag-chat-api-simple',
      description: 'ISK RAGチャットシステム シンプル版API',
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

    // ファイルアップロード用エンドポイント（認証付き）
    const uploadResource = api.root.addResource('upload', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });
    uploadResource.addMethod('POST', new apigateway.LambdaIntegration(fileUploadFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      // 大きなファイル対応のため、より大きなPayloadを許可
      requestParameters: {
        'method.request.header.Content-Type': true
      }
    });

    // セッション管理エンドポイント（認証付き）
    const sessionsResource = api.root.addResource('sessions', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });

    // セッション内ファイル管理のLambda関数（軽量版）
    const sessionManagementFunction = new lambda.Function(this, 'SessionManagementFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import json
import boto3
import logging
from typing import Dict, Any
from datetime import datetime, timedelta

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client('s3')
TEMP_BUCKET = '${tempFilesBucket.bucketName}'

def get_cors_headers():
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Credentials': 'false'
    }

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    try:
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

        path_parameters = event.get('pathParameters', {})
        session_id = path_parameters.get('sessionId')
        file_id = path_parameters.get('fileId')

        method = event['httpMethod']

        if method == 'GET' and session_id and not file_id:
            # GET /sessions/{sessionId}/files - ファイル一覧取得
            return get_session_files(session_id, user_sub)

        elif method == 'DELETE' and session_id and file_id:
            # DELETE /sessions/{sessionId}/files/{fileId} - ファイル削除
            return delete_session_file(session_id, file_id, user_sub)

        elif method == 'GET' and session_id and not file_id:
            # GET /sessions/{sessionId} - セッション情報取得
            return get_session_info(session_id, user_sub)

        else:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Endpoint not found'})
            }

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Internal server error',
                'details': str(e)
            })
        }

def get_session_files(session_id: str, user_sub: str) -> Dict[str, Any]:
    \"\"\"セッション内ファイル一覧を取得\"\"\"
    try:
        # セッションIDにuser_subが含まれているか確認（セキュリティ）
        if not session_id.startswith(f'user-{user_sub}'):
            return {
                'statusCode': 403,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Access denied to this session'})
            }

        prefix = f"sessions/{session_id}/original/"

        response = s3_client.list_objects_v2(
            Bucket=TEMP_BUCKET,
            Prefix=prefix
        )

        files = []
        for obj in response.get('Contents', []):
            key = obj['Key']
            filename = key.split('/')[-1]  # ファイル名部分を抽出

            # メタデータ取得
            try:
                head_response = s3_client.head_object(Bucket=TEMP_BUCKET, Key=key)
                metadata = head_response.get('Metadata', {})

                files.append({
                    'file_id': metadata.get('file-id', 'unknown'),
                    'filename': metadata.get('original-filename', filename),
                    'size': obj['Size'],
                    'last_modified': obj['LastModified'].isoformat(),
                    'upload_time': metadata.get('upload-time', obj['LastModified'].isoformat()),
                    's3_key': key
                })
            except Exception as e:
                logger.warning(f"Failed to get metadata for {key}: {e}")

        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'session_id': session_id,
                'files': files,
                'total_files': len(files),
                'expires_at': (datetime.utcnow() + timedelta(days=7)).isoformat()
            }, ensure_ascii=False)
        }

    except Exception as e:
        logger.error(f"Failed to get session files: {e}")
        raise e

def delete_session_file(session_id: str, file_id: str, user_sub: str) -> Dict[str, Any]:
    \"\"\"セッション内の特定ファイルを削除\"\"\"
    try:
        # セキュリティチェック
        if not session_id.startswith(f'user-{user_sub}'):
            return {
                'statusCode': 403,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Access denied to this session'})
            }

        # 削除するファイルを検索
        prefix = f"sessions/{session_id}/"

        response = s3_client.list_objects_v2(
            Bucket=TEMP_BUCKET,
            Prefix=prefix
        )

        files_to_delete = []
        for obj in response.get('Contents', []):
            key = obj['Key']
            if file_id in key:  # file_idを含むファイル（original, extracted両方）
                files_to_delete.append({'Key': key})

        if not files_to_delete:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'File not found'})
            }

        # ファイル削除
        s3_client.delete_objects(
            Bucket=TEMP_BUCKET,
            Delete={'Objects': files_to_delete}
        )

        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'message': 'File deleted successfully',
                'deleted_files': len(files_to_delete),
                'file_id': file_id
            })
        }

    except Exception as e:
        logger.error(f"Failed to delete file: {e}")
        raise e

def get_session_info(session_id: str, user_sub: str) -> Dict[str, Any]:
    \"\"\"セッション情報を取得\"\"\"
    try:
        # セキュリティチェック
        if not session_id.startswith(f'user-{user_sub}'):
            return {
                'statusCode': 403,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Access denied to this session'})
            }

        # セッション内のファイル数をカウント
        prefix = f"sessions/{session_id}/original/"

        response = s3_client.list_objects_v2(
            Bucket=TEMP_BUCKET,
            Prefix=prefix
        )

        file_count = len(response.get('Contents', []))

        # セッション名をsession_idから抽出
        parts = session_id.split('-')
        session_name = '-'.join(parts[3:-1]) if len(parts) > 4 else 'default'

        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'session_id': session_id,
                'session_name': session_name,
                'file_count': file_count,
                'created_at': parts[1] + '-' + parts[2] if len(parts) > 2 else 'unknown',
                'expires_at': (datetime.utcnow() + timedelta(days=7)).isoformat()
            })
        }

    except Exception as e:
        logger.error(f"Failed to get session info: {e}")
        raise e
      `),
      role: sessionManagementRole,
      timeout: Duration.minutes(2),
      memorySize: 512, // 軽量処理用
      deadLetterQueue: sessionManagementDLQ,
      reservedConcurrentExecutions: 5,
      environment: {
        TEMP_FILES_BUCKET: tempFilesBucket.bucketName
      }
    });

    // セッションファイル一覧取得エンドポイント
    const sessionIdResource = sessionsResource.addResource('{sessionId}');
    const filesResource = sessionIdResource.addResource('files');
    filesResource.addMethod('GET', new apigateway.LambdaIntegration(sessionManagementFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // 個別ファイル削除エンドポイント
    const fileIdResource = filesResource.addResource('{fileId}');
    fileIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(sessionManagementFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // セッション情報取得エンドポイント
    sessionIdResource.addMethod('GET', new apigateway.LambdaIntegration(sessionManagementFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // 比較分析レポート生成エンドポイント（認証付き）
    const analyzeResource = api.root.addResource('analyze', {
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false
      }
    });
    analyzeResource.addMethod('POST', new apigateway.LambdaIntegration(analysisReportFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      // リクエストサイズ制限を緩和
      requestParameters: {
        'method.request.header.Content-Type': true
      }
    });

    // 分析テーマ一覧取得エンドポイント（認証付き）
    const analyzeThemesResource = analyzeResource.addResource('themes');
    const getAnalysisThemesDLQ = new sqs.Queue(this, 'GetAnalysisThemesFunctionDLQ', {
      retentionPeriod: Duration.days(14)
    });
    const getAnalysisThemesFunction = new lambda.Function(this, 'GetAnalysisThemesFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import json

def handler(event, context):
    themes = {
        'trend_analysis': {
            'name': '技術トレンド変化分析',
            'description': '時系列での技術発展や手法の変化を分析',
            'icon': '📈'
        },
        'comparative_analysis': {
            'name': '製品・プロセス比較分析',
            'description': '異なる製品やプロセス間の差異を比較分析',
            'icon': '⚖️'
        },
        'research_synthesis': {
            'name': '研究成果統合分析',
            'description': '複数の研究結果から共通点や相違点を抽出',
            'icon': '🔬'
        },
        'custom_analysis': {
            'name': 'カスタム分析',
            'description': 'ユーザー指定のテーマで自由分析',
            'icon': '🎯'
        }
    }

    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'GET,OPTIONS'
        },
        'body': json.dumps({
            'themes': themes,
            'default_theme': 'custom_analysis'
        }, ensure_ascii=False)
    }
      `),
      timeout: Duration.seconds(30),
      memorySize: 128,
      role: analysisThemesRole,
      deadLetterQueue: getAnalysisThemesDLQ,
      reservedConcurrentExecutions: 5
    });

    analyzeThemesResource.addMethod('GET', new apigateway.LambdaIntegration(getAnalysisThemesFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // ヘルスチェック用（認証不要）
    const healthResource = api.root.addResource('health');
    healthResource.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseTemplates: {
          'application/json': '{"status": "healthy", "version": "simple", "timestamp": "$context.requestTime"}'
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
    this.tempFilesBucket = tempFilesBucket;

    // Export values for cross-region reference
    this.userPoolIdOutput = this.userPool.userPoolId;
    this.userPoolClientIdOutput = this.userPoolClient.userPoolClientId;
    this.apiGatewayUrlOutput = this.apiGatewayUrl;
    this.tempFilesBucketOutput = tempFilesBucket.bucketName;

    // CloudWatch 監視・アラートシステム
    this.setupMonitoring(chatFunction, fileUploadFunction, analysisReportFunction, api);

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID (Simple Version)'
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID (Simple Version)'
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.apiGatewayUrl,
      description: 'API Gateway URL (Simple Version)'
    });

    new cdk.CfnOutput(this, 'TempFilesBucketName', {
      value: tempFilesBucket.bucketName,
      description: 'S3 Temporary Files Bucket Name (7-day TTL)'
    });

    new cdk.CfnOutput(this, 'TempFilesBucketArn', {
      value: tempFilesBucket.bucketArn,
      description: 'S3 Temporary Files Bucket ARN'
    });

    new cdk.CfnOutput(this, 'NextSteps', {
      value: 'Enhanced version with file upload capability! S3 temp bucket configured.',
      description: 'Deployment Status'
    });
  }

  private setupMonitoring(
    chatFunction: lambda.Function,
    fileUploadFunction: lambda.Function,
    analysisReportFunction: lambda.Function,
    api: apigateway.RestApi
  ) {
    // SNS通知トピック（オプション）
    const alertTopic = new sns.Topic(this, 'SystemAlerts', {
      topicName: 'isk-rag-system-alerts',
      displayName: 'ISK RAG System Alerts'
    });

    // SNSサブスクリプション（メール通知）
    alertTopic.addSubscription(
      new sns_subscriptions.EmailSubscription(
        this.node.tryGetContext('alertEmail') || 'admin@example.com'
      )
    );

    // Lambda関数のエラーアラーム
    const lambdaFunctions = [
      { name: 'Chat', func: chatFunction },
      { name: 'FileUpload', func: fileUploadFunction },
      { name: 'AnalysisReport', func: analysisReportFunction }
    ];

    const snsAction = new cloudwatch_actions.SnsAction(alertTopic);

    lambdaFunctions.forEach(({ name, func }) => {
      // エラーアラーム
      new cloudwatch.Alarm(this, `${name}LambdaErrors`, {
        alarmName: `ISK-RAG-${name}-Errors`,
        metric: func.metricErrors({
          period: Duration.minutes(5)
        }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `${name} Lambda function errors detected`,
        alarmActions: [snsAction],
        okActions: [snsAction]
      });

      // 実行時間アラーム
      const timeoutThreshold = name === 'AnalysisReport' ? 6 : 3; // 分析は長時間許可
      new cloudwatch.Alarm(this, `${name}LambdaDuration`, {
        alarmName: `ISK-RAG-${name}-Duration`,
        metric: func.metricDuration({
          period: Duration.minutes(5)
        }),
        threshold: timeoutThreshold * 60 * 1000, // ミリ私E        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `${name} Lambda function duration exceeds threshold`,
        alarmActions: [snsAction],
        okActions: [snsAction]
      });

      // スロットリングアラーム
      new cloudwatch.Alarm(this, `${name}LambdaThrottles`, {
        alarmName: `ISK-RAG-${name}-Throttles`,
        metric: func.metricThrottles({
          period: Duration.minutes(5)
        }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `${name} Lambda function throttling detected`,
        alarmActions: [snsAction],
        okActions: [snsAction]
      });
    });

    // API Gateway アラーム
    const apiAlarms = [
      {
        name: 'API-4XXErrors',
        metric: api.metricClientError(),
        threshold: 10,
        description: 'High client error rate detected'
      },
      {
        name: 'API-5XXErrors',
        metric: api.metricServerError(),
        threshold: 5,
        description: 'Server errors detected'
      },
      {
        name: 'API-Latency',
        metric: api.metricLatency(),
        threshold: 10000, // 10私E        description: 'High API latency detected'
      }
    ];

    apiAlarms.forEach(({ name, metric, threshold, description }) => {
      new cloudwatch.Alarm(this, name.replace('-', ''), {
        alarmName: `ISK-RAG-${name}`,
        metric: metric.with({ period: Duration.minutes(5) }),
        threshold,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: description,
        alarmActions: [snsAction],
        okActions: [snsAction]
      });
    });

    // CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'SystemDashboard', {
      dashboardName: 'ISK-RAG-System-Monitoring'
    });

    // Lambda メトリクス
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: [
          chatFunction.metricInvocations(),
          fileUploadFunction.metricInvocations(),
          analysisReportFunction.metricInvocations()
        ],
        period: Duration.minutes(5)
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [
          chatFunction.metricErrors(),
          fileUploadFunction.metricErrors(),
          analysisReportFunction.metricErrors()
        ],
        period: Duration.minutes(5)
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration',
        left: [
          chatFunction.metricDuration(),
          fileUploadFunction.metricDuration(),
          analysisReportFunction.metricDuration()
        ],
        period: Duration.minutes(5)
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway Metrics',
        left: [api.metricCount(), api.metricLatency()],
        right: [api.metricClientError(), api.metricServerError()],
        period: Duration.minutes(5)
      })
    );

    // S3 メトリクス
    dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: 'System Health Summary',
        metrics: [
          chatFunction.metricInvocations({ period: Duration.hours(1) }),
          fileUploadFunction.metricInvocations({ period: Duration.hours(1) }),
          api.metricCount({ period: Duration.hours(1) })
        ],
        period: Duration.hours(1)
      })
    );

    // Custom Log Groups with structured logging
    const customLogGroup = new logs.LogGroup(this, 'EnhancedSystemLogs', {
      logGroupName: '/aws/lambda/isk-rag-enhanced-system',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Log Insights クエリ（サンプル）
    const logInsightsQueries = [
      {
        name: 'Error Analysis',
        query: `
          fields @timestamp, @message
          | filter @message like /ERROR/
          | sort @timestamp desc
          | limit 100
        `
      },
      {
        name: 'Performance Analysis',
        query: `
          fields @timestamp, @duration
          | filter @type = "REPORT"
          | sort @timestamp desc
          | limit 100
        `
      },
      {
        name: 'User Activity',
        query: `
          fields @timestamp, user_name, session_id
          | filter ispresent(user_name)
          | stats count() by user_name
          | sort count() desc
        `
      }
    ];

    // Outputs for monitoring
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL'
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: alertTopic.topicArn,
      description: 'SNS Alert Topic ARN'
    });
  }
}
