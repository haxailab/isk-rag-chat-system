import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';

interface IskRagChatSystemFrontendStackProps extends cdk.StackProps {
  webAclArn?: string; // オプショナルに変更
  userPoolId: string;
  userPoolClientId: string;
  apiGatewayUrl: string;
}

export class IskRagChatSystemFrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IskRagChatSystemFrontendStackProps) {
    super(scope, id, props);

    // S3バケット（Webサイトホスティング用）
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `isk-rag-frontend-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // CloudFront Origin Access Identity
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OriginAccessIdentity', {
      comment: 'ISK RAG Chat System OAI'
    });

    // S3バケットポリシー（CloudFrontからのアクセスのみ許可）
    websiteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [websiteBucket.arnForObjects('*')],
        principals: [originAccessIdentity.grantPrincipal]
      })
    );

    // CloudFront Distribution
    const distributionConfig: any = {
      comment: 'ISK RAG Chat System Distribution',
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
    };

    // WAFが指定されている場合のみ設定
    if (props.webAclArn && props.webAclArn.trim() !== '') {
      distributionConfig.webAclId = props.webAclArn;
    }

    const distribution = new cloudfront.Distribution(this, 'Distribution', distributionConfig);

    // React アプリケーションの設定ファイル生成
    const appConfig = {
      region: 'ap-northeast-1', // バックエンドリソースのリージョンを指定
      userPoolId: props.userPoolId,
      userPoolClientId: props.userPoolClientId,
      apiGatewayUrl: props.apiGatewayUrl,
      distributionDomain: distribution.distributionDomainName
    };

    // React アプリケーション用のファイル作成
    this.createReactApp(websiteBucket, appConfig);

    // Outputs
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront Distribution URL'
    });

    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: websiteBucket.bucketName,
      description: 'Website S3 Bucket Name'
    });
  }

  private createReactApp(bucket: s3.Bucket, config: any) {
    // index.html
    const indexHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ISK RAG チャットシステム</title>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://unpkg.com/aws-amplify@6/dist/aws-amplify.min.js"></script>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <style>
        .chat-container {
            height: calc(100vh - 140px);
        }
        .message-bubble {
            max-width: 70%;
            word-wrap: break-word;
        }
        .file-drop-zone {
            transition: all 0.3s ease;
        }
        .file-drop-zone.dragover {
            background-color: #dbeafe;
            border: 2px dashed #3b82f6;
        }
        .sidebar-transition {
            transition: width 0.3s ease;
        }
        .file-item:hover {
            background-color: #4b5563;
        }
        /* スクロールバーカスタマイズ */
        .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
            background: #f1f5f9;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: #94a3b8;
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
                            <h2 className="text-2xl font-bold text-center">確認コード入力</h2>
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
                        <h2 className="text-2xl font-bold text-center">
                            {isSignUp ? 'サインアップ' : 'ログイン'}
                        </h2>
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

        // 拡張チャットインターフェース（ファイルアップロード機能付き）
        function ChatInterface({ user, onSignOut }) {
            const [messages, setMessages] = useState([]);
            const [inputMessage, setInputMessage] = useState('');
            const [loading, setLoading] = useState(false);
            const [currentSession, setCurrentSession] = useState(null);
            const [sessionFiles, setSessionFiles] = useState([]);
            const [uploadingFiles, setUploadingFiles] = useState([]);
            const [dragOver, setDragOver] = useState(false);
            const [showSidebar, setShowSidebar] = useState(true);
            const [useEnhancedChat, setUseEnhancedChat] = useState(true);

            // ファイルアップロード処理
            const handleFileUpload = async (files) => {
                if (!files || files.length === 0) return;

                const fileArray = Array.from(files);
                const uploadPromises = fileArray.map(file => uploadSingleFile(file));

                setUploadingFiles(prev => [...prev, ...fileArray.map(f => ({ name: f.name, progress: 0 }))]);

                try {
                    const results = await Promise.all(uploadPromises);
                    const successfulUploads = results.filter(r => r.success);

                    if (successfulUploads.length > 0) {
                        const newSessionId = successfulUploads[0].session_id;
                        setCurrentSession(newSessionId);
                        await loadSessionFiles(newSessionId);

                        // 成功メッセージを表示
                        setMessages(prev => [...prev, {
                            type: 'system',
                            content: \`\${successfulUploads.length}個のファイルがアップロードされました。これらのファイルを参照してチャットできます。\`,
                            timestamp: new Date(),
                            files: successfulUploads.map(r => r.file_name)
                        }]);
                    }
                } catch (error) {
                    setMessages(prev => [...prev, {
                        type: 'error',
                        content: \`ファイルアップロードエラー: \${error.message}\`,
                        timestamp: new Date()
                    }]);
                } finally {
                    setUploadingFiles([]);
                }
            };

            const uploadSingleFile = async (file) => {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        try {
                            const session = await Auth.currentSession();
                            const token = session.getIdToken().getJwtToken();

                            const base64Content = e.target.result.split(',')[1];

                            const response = await fetch('${config.apiGatewayUrl}file-upload', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': token
                                },
                                body: JSON.stringify({
                                    files: [{
                                        filename: file.name,
                                        content: base64Content,
                                        contentType: file.type
                                    }]
                                })
                            });

                            const data = await response.json();

                            if (response.ok && data.uploaded_files && data.uploaded_files.length > 0) {
                                resolve({
                                    success: true,
                                    session_id: data.session_id,
                                    file_name: file.name,
                                    file_id: data.uploaded_files[0].file_id
                                });
                            } else {
                                reject(new Error(data.error || 'アップロードに失敗しました'));
                            }
                        } catch (error) {
                            reject(error);
                        }
                    };
                    reader.readAsDataURL(file);
                });
            };

            // セッションファイル一覧を取得
            const loadSessionFiles = async (sessionId) => {
                try {
                    const session = await Auth.currentSession();
                    const token = session.getIdToken().getJwtToken();

                    const response = await fetch('${config.apiGatewayUrl}session', {
                        method: 'GET',
                        headers: {
                            'Authorization': token
                        }
                    });

                    if (response.ok) {
                        const data = await response.json();
                        setSessionFiles(data.files || []);
                    }
                } catch (error) {
                    console.error('Failed to load session files:', error);
                }
            };

            // 拡張チャット送信
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

                    const endpoint = useEnhancedChat && currentSession ? 'enhanced-chat' : 'chat';
                    const requestBody = useEnhancedChat && currentSession
                        ? {
                            message: inputMessage,
                            session_id: currentSession,
                            use_session_files: true
                          }
                        : {
                            message: inputMessage,
                            knowledgeBaseId: ''
                          };

                    const response = await fetch(\`\${config.apiGatewayUrl}\${endpoint}\`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': token
                        },
                        body: JSON.stringify(requestBody)
                    });

                    const data = await response.json();

                    if (response.ok) {
                        const aiMessage = {
                            type: 'assistant',
                            content: data.answer,
                            sources: data.sources || data.source_links || [],
                            model: data.model || 'Unknown',
                            isEnhanced: !!data.is_hybrid_response,
                            searchStats: data.search_stats,
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

            // ドラッグ＆ドロップハンドラー
            const handleDragOver = (e) => {
                e.preventDefault();
                setDragOver(true);
            };

            const handleDragLeave = (e) => {
                e.preventDefault();
                setDragOver(false);
            };

            const handleDrop = (e) => {
                e.preventDefault();
                setDragOver(false);
                const files = e.dataTransfer.files;
                handleFileUpload(files);
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
                <div className="h-screen flex">
                    {/* サイドバー */}
                    {showSidebar && (
                        <div className="w-80 bg-gray-800 text-white flex flex-col">
                            <div className="p-4 border-b border-gray-700">
                                <h2 className="text-lg font-semibold">セッション管理</h2>
                                <div className="mt-2 text-sm text-gray-300">
                                    {currentSession ? \`現在のセッション: \${currentSession.split('-')[3] || 'session'}\` : '新しいセッション'}
                                </div>
                            </div>

                            {/* ファイル一覧 */}
                            <div className="flex-1 overflow-y-auto p-4">
                                <h3 className="text-sm font-medium mb-2">アップロード済みファイル ({sessionFiles.length})</h3>
                                {sessionFiles.length > 0 ? (
                                    <ul className="space-y-2">
                                        {sessionFiles.map((file, index) => (
                                            <li key={index} className="text-sm bg-gray-700 p-2 rounded">
                                                <div className="font-medium truncate">{file.file_name}</div>
                                                <div className="text-xs text-gray-400">
                                                    {(file.size / 1024).toFixed(1)}KB • {file.processing_status}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="text-sm text-gray-400">ファイルがありません</div>
                                )}

                                {/* アップロード中ファイル */}
                                {uploadingFiles.length > 0 && (
                                    <div className="mt-4">
                                        <h4 className="text-sm font-medium mb-2">アップロード中...</h4>
                                        {uploadingFiles.map((file, index) => (
                                            <div key={index} className="text-sm bg-blue-700 p-2 rounded mb-2">
                                                <div className="flex items-center">
                                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                                                    <span className="truncate">{file.name}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* 設定 */}
                            <div className="p-4 border-t border-gray-700">
                                <label className="flex items-center text-sm">
                                    <input
                                        type="checkbox"
                                        checked={useEnhancedChat}
                                        onChange={(e) => setUseEnhancedChat(e.target.checked)}
                                        className="mr-2"
                                    />
                                    拡張検索（ファイル+KB）
                                </label>
                            </div>
                        </div>
                    )}

                    {/* メインチャットエリア */}
                    <div className="flex-1 flex flex-col">
                        {/* ヘッダー */}
                        <header className="bg-blue-600 text-white p-4 flex justify-between items-center">
                            <div className="flex items-center space-x-4">
                                <button
                                    onClick={() => setShowSidebar(!showSidebar)}
                                    className="text-white hover:text-blue-200"
                                >
                                    ☰
                                </button>
                                <h1 className="text-xl font-bold">ISK RAG チャットシステム</h1>
                                {useEnhancedChat && currentSession && (
                                    <span className="text-sm bg-green-500 px-2 py-1 rounded">拡張モード</span>
                                )}
                            </div>
                            <div className="flex items-center space-x-4">
                                <span className="text-sm">こんにちは、{user.attributes?.email}</span>
                                <button
                                    onClick={signOut}
                                    className="bg-blue-500 hover:bg-blue-700 px-4 py-2 rounded text-sm"
                                >
                                    ログアウト
                                </button>
                            </div>
                        </header>

                        {/* チャットメッセージエリア */}
                        <div
                            className={\`flex-1 overflow-y-auto p-4 space-y-4 \${dragOver ? 'bg-blue-50 border-2 border-dashed border-blue-300' : ''}\`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                        >
                            {messages.length === 0 && (
                                <div className="text-center text-gray-500 mt-8">
                                    <div className="mb-4 text-lg">ISK RAG チャットシステムへようこそ</div>
                                    <div className="text-sm space-y-2">
                                        <div>• メッセージを入力してナレッジベースを検索</div>
                                        <div>• ファイルをドラッグ&ドロップしてアップロード</div>
                                        <div>• 拡張モードでファイルとナレッジベースを同時検索</div>
                                    </div>
                                </div>
                            )}

                            {dragOver && (
                                <div className="text-center py-8">
                                    <div className="text-2xl mb-2">📄</div>
                                    <div className="text-lg font-medium text-blue-600">ファイルをここにドロップ</div>
                                    <div className="text-sm text-gray-600">PDF, 画像, テキスト, Office文書に対応</div>
                                </div>
                            )}

                            {messages.map((message, index) => (
                                <div
                                    key={index}
                                    className={\`flex \${message.type === 'user' ? 'justify-end' : 'justify-start'}\`}
                                >
                                    <div
                                        className={\`max-w-3xl p-4 rounded-lg \${
                                            message.type === 'user'
                                                ? 'bg-blue-500 text-white'
                                                : message.type === 'error'
                                                ? 'bg-red-100 text-red-800 border border-red-300'
                                                : message.type === 'system'
                                                ? 'bg-green-100 text-green-800 border border-green-300'
                                                : 'bg-white border border-gray-200 shadow-sm'
                                        }\`}
                                    >
                                        <div className="whitespace-pre-wrap">{message.content}</div>

                                        {/* ファイル情報表示 */}
                                        {message.files && (
                                            <div className="mt-2 text-sm">
                                                <strong>アップロードファイル:</strong>
                                                <ul className="list-disc list-inside mt-1">
                                                    {message.files.map((file, idx) => (
                                                        <li key={idx}>{file}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {/* ソース情報表示 */}
                                        {message.sources && message.sources.knowledge_base && message.sources.knowledge_base.length > 0 && (
                                            <div className="mt-3 text-sm">
                                                <strong>📚 ナレッジベース参照:</strong>
                                                <ul className="list-disc list-inside mt-1 space-y-1">
                                                    {message.sources.knowledge_base.map((source, idx) => (
                                                        <li key={idx} className="text-xs">
                                                            {source.content && source.content.substring(0, 100)}...
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {message.sources && message.sources.session_files && message.sources.session_files.length > 0 && (
                                            <div className="mt-3 text-sm">
                                                <strong>📄 セッションファイル参照:</strong>
                                                <ul className="list-disc list-inside mt-1 space-y-1">
                                                    {message.sources.session_files.map((source, idx) => (
                                                        <li key={idx} className="text-xs">
                                                            <span className="font-medium">{source.filename}:</span> {source.content && source.content.substring(0, 100)}...
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {/* モデル情報表示 */}
                                        {message.model && message.type === 'assistant' && (
                                            <div className="mt-2 text-xs opacity-70">
                                                {message.model} {message.isEnhanced && '(ハイブリッド検索)'}
                                            </div>
                                        )}

                                        <div className="text-xs opacity-50 mt-2">
                                            {message.timestamp.toLocaleTimeString()}
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {loading && (
                                <div className="flex justify-start">
                                    <div className="bg-gray-200 p-4 rounded-lg max-w-md">
                                        <div className="flex items-center space-x-2">
                                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
                                            <span>
                                                {useEnhancedChat && currentSession
                                                    ? 'ファイルとナレッジベースを検索中...'
                                                    : '回答を生成中...'
                                                }
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 入力エリア */}
                        <footer className="border-t bg-white p-4">
                            <div className="flex space-x-2 items-end">
                                {/* ファイル選択ボタン */}
                                <label className="cursor-pointer">
                                    <input
                                        type="file"
                                        multiple
                                        accept=".pdf,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.gif,.docx,.xlsx,.pptx"
                                        onChange={(e) => handleFileUpload(e.target.files)}
                                        className="hidden"
                                    />
                                    <div className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 text-sm">
                                        📎 ファイル
                                    </div>
                                </label>

                                {/* メッセージ入力フォーム */}
                                <form onSubmit={sendMessage} className="flex-1 flex space-x-2">
                                    <input
                                        type="text"
                                        value={inputMessage}
                                        onChange={(e) => setInputMessage(e.target.value)}
                                        placeholder={useEnhancedChat && currentSession
                                            ? "ファイルやナレッジベースについて質問してください..."
                                            : "メッセージを入力してください..."
                                        }
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
                            </div>
                        </footer>
                    </div>
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
      destinationBucket: bucket,
      distribution: undefined // CloudFrontは後でキャッシュ無効化
    });
  }
}