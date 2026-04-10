# ISK社内向けRAGチャットシステム

## 概要

このプロジェクトは、ISK社内向けのRAG（Retrieval-Augmented Generation）チャットシステムをAWS CDKで構築するためのInfrastructure as Codeです。

## アーキテクチャ

```
[ユーザー] → [CloudFront + WAF] → [S3 (React App)] 
                    ↓
[Cognito認証] → [API Gateway] → [Lambda] → [Bedrock Claude Sonnet 4]
                                   ↓
                         [Knowledge Base] → [OpenSearch Serverless]
                                   ↓
                            [S3 (Documents)]
```

### 主要コンポーネント

- **認証**: Amazon Cognito User Pool
- **フロントエンド**: React SPA (S3 + CloudFront配信)
- **API**: API Gateway + Lambda (Python 3.12)
- **AI モデル**: Claude Sonnet 4 (apac.anthropic.claude-sonnet-4-20250514-v1:0)
- **RAG**: Bedrock Knowledge Base + OpenSearch Serverless
- **セキュリティ**: WAF (IP制限)
- **ドキュメント保存**: S3

## 前提条件

1. AWS CLI設定済み
2. Node.js 18.x以上
3. AWS CDK CLI (`npm install -g aws-cdk`)
4. 適切なAWS権限

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. CDK Bootstrap（初回のみ）

```bash
npx cdk bootstrap aws://ACCOUNT-NUMBER/ap-northeast-1
npx cdk bootstrap aws://ACCOUNT-NUMBER/us-east-1  # WAF用
```

### 3. IP制限設定の編集

`bin/isk-rag-chat-system.ts`の`iskAllowedIpRanges`を実際のISK社のIP範囲に変更：

```typescript
const iskAllowedIpRanges = [
  'YOUR_OFFICE_IP/32',    // ISK社オフィスIP
  'YOUR_VPN_RANGE/24'     // VPNのIPレンジ
];
```

### 4. デプロイ

```bash
# 全スタックのデプロイ
npm run deploy

# 個別デプロイの場合
npx cdk deploy IskRagChatSystemWaf
npx cdk deploy IskRagChatSystemBackend
npx cdk deploy IskRagChatSystemFrontend
```

## デプロイ後の設定

### 1. Cognito User Poolの初期ユーザー作成

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <USER_POOL_ID> \
  --username admin@isk-company.com \
  --user-attributes Name=email,Value=admin@isk-company.com \
  --temporary-password TempPass123! \
  --message-action SUPPRESS \
  --region ap-northeast-1
```

### 2. Bedrock Knowledge Baseの設定

1. AWSコンソールでBedrock Knowledge Baseを作成
2. OpenSearch Serverlessコレクション（isk-rag-collection）を指定
3. S3ドキュメントバケットをデータソースとして追加
4. Lambda関数のコードでKnowledge Base IDを設定

### 3. ドキュメントのアップロード

RAG用のドキュメントをS3バケット（isk-rag-documents-*）にアップロード：

```bash
aws s3 cp your-documents/ s3://isk-rag-documents-ACCOUNT-REGION/ --recursive
```

## 利用方法

1. CloudFrontのURLにアクセス
2. Cognitoでサインアップ/ログイン
3. チャット画面でメッセージを送信
4. Claude Sonnet 4がRAG機能を使用して回答

## セキュリティ機能

- **IP制限**: WAFによるオフィス/VPN IPのみアクセス許可
- **認証**: Cognito User Poolによるユーザー認証
- **HTTPS強制**: CloudFrontで全通信暗号化
- **AWS Managed Rules**: 基本的なセキュリティ脅威をブロック

## 監視・ログ

- **API Gateway**: アクセスログとメトリクス
- **Lambda**: CloudWatch Logs
- **WAF**: ブロック/許可のメトリクス
- **CloudFront**: アクセスログ

## コスト最適化

- **OpenSearch Serverless**: 使用量ベースの課金
- **CloudFront**: 日本・アジア・北米・欧州のみ（PriceClass 200）
- **Lambda**: 短時間実行でコスト削減
- **S3**: Intelligent Tiering対応

## トラブルシューティング

### よくある問題

1. **WAFでブロックされる**
   - IPアドレスが許可リストに含まれているか確認
   - WAF Web ACLの設定を確認

2. **Cognito認証エラー**
   - User Pool ClientのOAuth設定確認
   - フロントエンドのAmplify設定確認

3. **API呼び出しエラー**
   - Lambda関数のIAM権限確認
   - Bedrock Model Accessの有効化確認

### ログの確認

```bash
# Lambda関数のログ
aws logs tail /aws/lambda/IskRagChatSystemBackend-ChatFunction* --follow

# API Gatewayのログ
aws logs tail API-Gateway-Execution-Logs_*/prod --follow
```

## アップデート

```bash
# コードの変更後
npm run build
npm run deploy
```

## クリーンアップ

```bash
# 全リソースの削除（注意：データも削除されます）
npm run destroy
```

## サポート

- 技術的な問題: [社内Slack #it-support]
- 機能要望: [社内Slack #rag-chat]

## ライセンス

社内利用専用