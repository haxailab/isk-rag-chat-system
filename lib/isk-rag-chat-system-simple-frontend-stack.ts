import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';

interface IskRagChatSystemSimpleFrontendStackProps extends cdk.StackProps {
  userPoolId: string;
  userPoolClientId: string;
  apiGatewayUrl: string;
}

export class IskRagChatSystemSimpleFrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IskRagChatSystemSimpleFrontendStackProps) {
    super(scope, id, props);

    // S3バケット（Webサイトホスティング用）
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `isk-rag-frontend-simple-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY // 開発用なので削除可能
    });

    // CloudFront Origin Access Identity
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OriginAccessIdentity', {
      comment: 'ISK RAG Chat System Simple OAI'
    });

    // S3バケットポリシー（CloudFrontからのアクセスのみ許可）
    websiteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [websiteBucket.arnForObjects('*')],
        principals: [originAccessIdentity.grantPrincipal]
      })
    );

    // CloudFront Distribution（WAFなし）
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'ISK RAG Chat System Simple Distribution',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(websiteBucket, {
          originAccessIdentity
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5)
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5)
        }
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // 日本・アジア・北米・欧州
      httpVersion: cloudfront.HttpVersion.HTTP2
    });

    // React アプリケーションの設定ファイル生成
    const appConfig = {
      region: 'ap-northeast-1', // バックエンドリソースのリージョンを指定
      userPoolId: props.userPoolId,
      userPoolClientId: props.userPoolClientId,
      apiGatewayUrl: props.apiGatewayUrl,
      distributionDomain: distribution.distributionDomainName,
      version: 'simple'
    };

    // React アプリケーション用のファイル作成
    this.createReactApp(websiteBucket, appConfig);

    // Outputs
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront Distribution URL (Simple Version)'
    });

    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: websiteBucket.bucketName,
      description: 'Website S3 Bucket Name'
    });
  }

  private createReactApp(bucket: s3.Bucket, config: any) {
    // index.html - シンプル版
    const indexHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ISK RAG チャットシステム (Simple)</title>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://unpkg.com/aws-amplify@6/dist/aws-amplify.min.js"></script>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <style>
        .chat-container {
            height: calc(100vh - 180px);
        }
        .message-bubble {
            max-width: 80%;
            word-wrap: break-word;
        }
        .version-badge {
            background: linear-gradient(45deg, #4f46e5, #06b6d4);
        }
    </style>
</head>
<body class="bg-gray-100">
    <div id="root"></div>

    <script type="text/babel">
        const { useState, useEffect } = React;
        const { Amplify } = window.aws_amplify_core;
        const { Auth } = window.aws_amplify_auth;

        // AWS Amplify設定
        Amplify.configure({
            Auth: {
                region: '${config.region}',
                userPoolId: '${config.userPoolId}',
                userPoolWebClientId: '${config.userPoolClientId}'
            }
        });

        // メインアプリケーション
        function App() {
            const [user, setUser] = useState(null);
            const [loading, setLoading] = useState(true);

            useEffect(() => {
                checkAuthState();
            }, []);

            const checkAuthState = async () => {
                try {
                    const currentUser = await Auth.currentAuthenticatedUser();
                    setUser(currentUser);
                } catch {
                    setUser(null);
                }
                setLoading(false);
            };

            if (loading) {
                return (
                    <div className="flex items-center justify-center h-screen">
                        <div className="text-xl">読み込み中...</div>
                    </div>
                );
            }

            return user ? <ChatInterface user={user} onSignOut={() => setUser(null)} /> : <LoginForm onLogin={setUser} />;
        }

        // ログインフォーム
        function LoginForm({ onLogin }) {
            const [email, setEmail] = useState('');
            const [password, setPassword] = useState('');
            const [error, setError] = useState('');
            const [isSignUp, setIsSignUp] = useState(false);
            const [confirmationCode, setConfirmationCode] = useState('');
            const [showConfirmation, setShowConfirmation] = useState(false);

            const handleSignIn = async (e) => {
                e.preventDefault();
                setError('');
                try {
                    const user = await Auth.signIn(email, password);
                    onLogin(user);
                } catch (error) {
                    setError(error.message || 'ログインに失敗しました');
                }
            };

            const handleSignUp = async (e) => {
                e.preventDefault();
                setError('');
                try {
                    await Auth.signUp({
                        username: email,
                        password,
                        attributes: {
                            email
                        }
                    });
                    setShowConfirmation(true);
                } catch (error) {
                    setError(error.message || 'サインアップに失敗しました');
                }
            };

            const handleConfirmSignUp = async (e) => {
                e.preventDefault();
                setError('');
                try {
                    await Auth.confirmSignUp(email, confirmationCode);
                    const user = await Auth.signIn(email, password);
                    onLogin(user);
                } catch (error) {
                    setError(error.message || '確認に失敗しました');
                }
            };

            if (showConfirmation) {
                return (
                    <div className="min-h-screen flex items-center justify-center">
                        <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-md">
                            <div className="text-center">
                                <h2 className="text-2xl font-bold">確認コード入力</h2>
                                <div className="mt-2 version-badge text-white px-3 py-1 rounded-full text-sm inline-block">
                                    Simple Version
                                </div>
                            </div>
                            <form onSubmit={handleConfirmSignUp} className="space-y-4">
                                <input
                                    type="text"
                                    placeholder="確認コード"
                                    value={confirmationCode}
                                    onChange={(e) => setConfirmationCode(e.target.value)}
                                    className="w-full px-3 py-2 border rounded-md"
                                    required
                                />
                                {error && <div className="text-red-500 text-sm">{error}</div>}
                                <button
                                    type="submit"
                                    className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                >
                                    確認
                                </button>
                            </form>
                        </div>
                    </div>
                );
            }

            return (
                <div className="min-h-screen flex items-center justify-center">
                    <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-md">
                        <div className="text-center">
                            <h2 className="text-2xl font-bold">
                                {isSignUp ? 'サインアップ' : 'ログイン'}
                            </h2>
                            <div className="mt-2 version-badge text-white px-3 py-1 rounded-full text-sm inline-block">
                                Simple Version - No RAG
                            </div>
                        </div>
                        <form onSubmit={isSignUp ? handleSignUp : handleSignIn} className="space-y-4">
                            <input
                                type="email"
                                placeholder="メールアドレス"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-3 py-2 border rounded-md"
                                required
                            />
                            <input
                                type="password"
                                placeholder="パスワード"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-3 py-2 border rounded-md"
                                required
                            />
                            {error && <div className="text-red-500 text-sm">{error}</div>}
                            <button
                                type="submit"
                                className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                            >
                                {isSignUp ? 'サインアップ' : 'ログイン'}
                            </button>
                        </form>
                        <div className="text-center">
                            <button
                                type="button"
                                onClick={() => setIsSignUp(!isSignUp)}
                                className="text-blue-600 hover:text-blue-800"
                            >
                                {isSignUp ? 'ログインはこちら' : 'サインアップはこちら'}
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        // チャットインターフェース
        function ChatInterface({ user, onSignOut }) {
            const [messages, setMessages] = useState([]);
            const [inputMessage, setInputMessage] = useState('');
            const [loading, setLoading] = useState(false);

            const sendMessage = async (e) => {
                e.preventDefault();
                if (!inputMessage.trim() || loading) return;

                const userMessage = { type: 'user', content: inputMessage, timestamp: new Date() };
                setMessages(prev => [...prev, userMessage]);
                setInputMessage('');
                setLoading(true);

                try {
                    const session = await Auth.currentSession();
                    const token = session.getIdToken().getJwtToken();

                    const response = await fetch('${config.apiGatewayUrl}chat', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': token
                        },
                        body: JSON.stringify({
                            message: inputMessage
                        })
                    });

                    const data = await response.json();

                    if (response.ok) {
                        const aiMessage = {
                            type: 'assistant',
                            content: data.answer,
                            model: data.model || 'Claude Sonnet 4',
                            timestamp: new Date()
                        };
                        setMessages(prev => [...prev, aiMessage]);
                    } else {
                        throw new Error(data.error || 'エラーが発生しました');
                    }
                } catch (error) {
                    const errorMessage = {
                        type: 'error',
                        content: error.message || 'エラーが発生しました',
                        timestamp: new Date()
                    };
                    setMessages(prev => [...prev, errorMessage]);
                }

                setLoading(false);
            };

            const signOut = async () => {
                try {
                    await Auth.signOut();
                    onSignOut();
                } catch (error) {
                    console.error('Sign out error:', error);
                }
            };

            return (
                <div className="h-screen flex flex-col">
                    {/* ヘッダー */}
                    <header className="bg-blue-600 text-white p-4 flex justify-between items-center">
                        <div className="flex items-center space-x-4">
                            <h1 className="text-xl font-bold">ISK RAG チャットシステム</h1>
                            <div className="version-badge text-xs px-2 py-1 rounded-full bg-green-500">
                                Simple v1.0
                            </div>
                        </div>
                        <div className="flex items-center space-x-4">
                            <span>こんにちは、{user.attributes?.email}</span>
                            <button
                                onClick={signOut}
                                className="bg-blue-500 hover:bg-blue-700 px-4 py-2 rounded"
                            >
                                ログアウト
                            </button>
                        </div>
                    </header>

                    {/* チャットエリア */}
                    <div className="flex-1 chat-container overflow-y-auto p-4 space-y-4">
                        {messages.length === 0 && (
                            <div className="text-center text-gray-500 mt-8">
                                <div className="text-lg mb-2">🤖 ISK RAG アシスタント (Simple版)</div>
                                <div className="text-sm">
                                    Claude Sonnet 4による直接回答 | RAG機能は次のバージョンで追加予定
                                </div>
                                <div className="mt-4 text-gray-400">
                                    メッセージを入力してチャットを開始してください
                                </div>
                            </div>
                        )}

                        {messages.map((message, index) => (
                            <div
                                key={index}
                                className={\`flex \${message.type === 'user' ? 'justify-end' : 'justify-start'}\`}
                            >
                                <div
                                    className={\`message-bubble p-3 rounded-lg \${
                                        message.type === 'user'
                                            ? 'bg-blue-500 text-white'
                                            : message.type === 'error'
                                            ? 'bg-red-100 text-red-800'
                                            : 'bg-white border'
                                    }\`}
                                >
                                    <div>{message.content}</div>
                                    {message.model && (
                                        <div className="text-xs opacity-70 mt-1">
                                            モデル: {message.model}
                                        </div>
                                    )}
                                    <div className="text-xs opacity-50 mt-1">
                                        {message.timestamp.toLocaleTimeString()}
                                    </div>
                                </div>
                            </div>
                        ))}

                        {loading && (
                            <div className="flex justify-start">
                                <div className="bg-gray-200 p-3 rounded-lg message-bubble">
                                    <div className="flex items-center space-x-2">
                                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                                        <span>Claude Sonnet 4が回答を生成中...</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 入力エリア */}
                    <footer className="border-t bg-white p-4">
                        <form onSubmit={sendMessage} className="flex space-x-2">
                            <input
                                type="text"
                                value={inputMessage}
                                onChange={(e) => setInputMessage(e.target.value)}
                                placeholder="メッセージを入力してください..."
                                className="flex-1 px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                disabled={loading}
                            />
                            <button
                                type="submit"
                                disabled={loading || !inputMessage.trim()}
                                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                            >
                                送信
                            </button>
                        </form>
                        <div className="text-xs text-gray-500 mt-2 text-center">
                            Simple Version - Direct Claude Sonnet 4 | Knowledge Base機能は開発中
                        </div>
                    </footer>
                </div>
            );
        }

        // アプリケーションをレンダリング
        ReactDOM.render(<App />, document.getElementById('root'));
    </script>
</body>
</html>`;

    // S3に直接デプロイ
    new s3deploy.BucketDeployment(this, 'WebsiteDeployment', {
      sources: [s3deploy.Source.data('index.html', indexHtml)],
      destinationBucket: bucket
    });
  }
}