# ISK RAGチャットシステム アーキテクチャ詳細

## 概要図

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   ユーザー    │────│   WAF + IP   │────│ CloudFront  │
│  (ブラウザ)   │    │   制限       │    │ Distribution│
└─────────────┘    └─────────────┘    └─────────────┘
                                              │
                   ┌─────────────────────────┼─────────────────────────┐
                   │                         │                         │
            ┌─────────────┐           ┌─────────────┐         ┌─────────────┐
            │     S3      │           │   Cognito   │         │ API Gateway │
            │ (Frontend)  │           │ User Pool   │         │     API     │
            └─────────────┘           └─────────────┘         └─────────────┘
                                              │                         │
                                              └─────────────────────────┤
                                                              ┌─────────────┐
                                                              │   Lambda    │
                                                              │ (Chat API)  │
                                                              └─────────────┘
                                                                      │
                                              ┌───────────────────────┼───────────────────────┐
                                              │                       │                       │
                                    ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
                                    │   Bedrock   │         │   Bedrock   │         │     S3      │
                                    │Claude Sonnet│         │ Knowledge   │         │ Documents   │
                                    │     4       │         │    Base     │         │   Storage   │
                                    └─────────────┘         └─────────────┘         └─────────────┘
                                                                    │
                                                          ┌─────────────┐
                                                          │ OpenSearch  │
                                                          │ Serverless  │
                                                          └─────────────┘
```

## コンポーネント詳細

### フロントエンド層

#### CloudFront Distribution
- **目的**: 静的ファイルの配信とキャッシング
- **設定**: 
  - Price Class 200（日本・アジア・北米・欧州）
  - HTTPS強制リダイレクト
  - Gzip圧縮有効
  - SPA対応（404/403 → index.html）

#### S3 Website Bucket
- **目的**: Reactアプリケーションのホスティング
- **設定**:
  - パブリックアクセスブロック（OAIのみアクセス許可）
  - バージョニング有効
  - サーバーサイド暗号化

#### WAF Web ACL
- **目的**: セキュリティとアクセス制御
- **ルール**:
  - ISK社IPアドレス許可
  - AWS Managed Rules適用
  - 悪意のある入力ブロック

### 認証層

#### Cognito User Pool
- **目的**: ユーザー認証・認可
- **設定**:
  - メール・ユーザー名ログイン対応
  - 強力なパスワードポリシー
  - メール確認必須
  - OAuth2対応

### API層

#### API Gateway REST API
- **目的**: RESTful APIの提供
- **エンドポイント**:
  - `POST /chat` - チャット機能
  - `GET /health` - ヘルスチェック
- **認証**: Cognito User Pool Authorizer

#### Lambda Function (Chat API)
- **Runtime**: Python 3.12
- **メモリ**: 1024MB
- **タイムアウト**: 5分
- **機能**:
  - Bedrock Claude Sonnet 4連携
  - Knowledge Base RAG機能
  - CORS対応

### AI・RAG層

#### Bedrock Claude Sonnet 4
- **モデルID**: `apac.anthropic.claude-sonnet-4-20250514-v1:0`
- **用途**: 対話型AI・文書理解

#### Bedrock Knowledge Base
- **目的**: RAG（検索拡張生成）機能
- **埋め込みモデル**: Amazon Titan Embed Text v2
- **チャンクサイズ**: 1000トークン
- **オーバーラップ**: 20%

#### OpenSearch Serverless
- **目的**: ベクトル検索エンジン
- **コレクション**: Vector Search対応
- **インデックス**: 文書ベクトルとメタデータ保存

#### S3 Document Bucket
- **目的**: RAG用ドキュメント保存
- **対応形式**: PDF, DOCX, TXT, MD, HTML, JSON, CSV
- **設定**: バージョニング・ライフサイクル管理

## セキュリティ設計

### ネットワークセキュリティ
- WAFによるIP制限
- HTTPS通信の強制
- CORS適切な設定

### 認証・認可
- Cognito User Poolによるユーザー管理
- JWTトークンによるAPI認証
- IAMロールベースのアクセス制御

### データ保護
- S3暗号化（SSE-S3）
- 通信暗号化（TLS 1.2以上）
- 機密情報のログ出力防止

## スケーラビリティ設計

### 水平スケーリング
- Lambda同時実行数の自動調整
- OpenSearch Serverlessの自動スケーリング
- CloudFrontによる地理的分散

### 垂直スケーリング
- Lambdaメモリサイズの調整可能
- Knowledge Baseのチャンク設定最適化

## 可用性設計

### 冗長化
- CloudFrontのマルチエッジロケーション
- OpenSearch Serverlessの自動冗長化
- S3の99.999999999%耐久性

### 障害対応
- API Gatewayのリトライ機能
- Lambdaのデッドレターキュー
- CloudWatch監視・アラート

## コスト最適化

### 使用量ベース課金
- Lambda実行時間ベース
- OpenSearch Serverless使用量ベース
- Bedrock推論時間ベース

### 効率化施策
- CloudFrontキャッシング
- Lambda実行時間最適化
- S3 Intelligent Tiering

## 監視・運用

### ログ収集
- CloudWatch Logs
- API Gateway実行ログ
- Lambda関数ログ
- WAFアクセスログ

### メトリクス監視
- API Gateway レスポンス時間・エラー率
- Lambda 実行回数・エラー数・実行時間
- WAF ブロック・許可リクエスト数
- Cognito ユーザー認証状況

### アラート設定
- API Gateway 5xx エラー
- Lambda タイムアウト・エラー
- WAF 異常アクセス検知

## デプロイ・CI/CD

### Infrastructure as Code
- AWS CDK（TypeScript）
- 3つのスタック分離
- 環境別デプロイ対応

### デプロイ戦略
- ステージング環境でのテスト
- Blue-Green デプロイ対応
- ロールバック機能

## 今後の拡張可能性

### 機能拡張
- マルチモーダル対応（画像・音声）
- リアルタイムチャット（WebSocket）
- チャット履歴の永続化

### 技術拡張
- 複数Knowledge Baseの統合
- カスタムプロンプトテンプレート
- 外部システム連携（Slack、Teams）

### 運用拡張
- 詳細なユーザー分析
- A/Bテスト基盤
- 自動的な品質評価