#!/bin/bash

# ISK RAG Chat System デプロイスクリプト

set -e

echo "========================================="
echo "ISK RAG Chat System デプロイ開始"
echo "========================================="

# 環境変数チェック
if [ -z "$CDK_DEFAULT_ACCOUNT" ]; then
    echo "警告: CDK_DEFAULT_ACCOUNT が設定されていません"
    export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    echo "自動検出されたアカウント: $CDK_DEFAULT_ACCOUNT"
fi

# 依存関係のインストール
echo "依存関係のインストール中..."
npm install

# TypeScriptコンパイル
echo "TypeScriptコンパイル中..."
npm run build

# CDK差分確認
echo "CDK差分確認中..."
npx cdk diff

# デプロイ確認
echo ""
echo "以下のスタックがデプロイされます:"
echo "1. IskRagChatSystemWaf (us-east-1)"
echo "2. IskRagChatSystemBackend (ap-northeast-1)"
echo "3. IskRagChatSystemFrontend (ap-northeast-1)"
echo ""
read -p "デプロイを続行しますか？ (y/N): " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "デプロイを中止しました"
    exit 1
fi

# WAFスタックのデプロイ（us-east-1）
echo "WAFスタックをデプロイ中..."
npx cdk deploy IskRagChatSystemWaf --require-approval never

# バックエンドスタックのデプロイ
echo "バックエンドスタックをデプロイ中..."
npx cdk deploy IskRagChatSystemBackend --require-approval never

# フロントエンドスタックのデプロイ
echo "フロントエンドスタックをデプロイ中..."
npx cdk deploy IskRagChatSystemFrontend --require-approval never

echo ""
echo "========================================="
echo "デプロイが完了しました！"
echo "========================================="

# 出力値の表示
echo ""
echo "重要な情報:"
npx cdk list --long 2>/dev/null | grep -E "(CloudFrontUrl|UserPoolId|ApiGatewayUrl)" || echo "出力情報を取得中..."

echo ""
echo "次のステップ:"
echo "1. Cognitoで初期ユーザーを作成"
echo "2. Bedrock Knowledge Baseを設定"
echo "3. S3にドキュメントをアップロード"
echo ""
echo "詳細はREADME.mdを参照してください。"