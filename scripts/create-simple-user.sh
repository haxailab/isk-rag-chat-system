#!/bin/bash

# ISK RAGチャットシステム（シンプル版）初期ユーザー作成スクリプト

set -e

USER_POOL_ID="ap-northeast-1_TRqpo3mOq"

# 引数チェック
if [ $# -ne 2 ]; then
    echo "使用方法: $0 <email> <temporary_password>"
    echo "例: $0 admin@isk-company.com TempPass123!"
    exit 1
fi

EMAIL=$1
TEMP_PASSWORD=$2

echo "========================================="
echo "ISK RAG チャットシステム（シンプル版）"
echo "初期ユーザー作成"
echo "========================================="

echo "User Pool ID: $USER_POOL_ID"
echo "作成するユーザー: $EMAIL"

# ユーザー名を生成（メール形式ではなく）
USERNAME=$(echo "$EMAIL" | sed 's/@.*//g' | sed 's/[^a-zA-Z0-9]//g' | tr '[:upper:]' '[:lower:]')$(date +%s)

echo "生成されたユーザー名: $USERNAME"

# ユーザー作成
echo "ユーザーを作成中..."
aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$USERNAME" \
    --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
    --temporary-password "$TEMP_PASSWORD" \
    --message-action SUPPRESS \
    --region ap-northeast-1

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================="
    echo "ユーザー作成完了！"
    echo "========================================="
    echo "ユーザー名: $USERNAME"
    echo "メールアドレス: $EMAIL"
    echo "初回パスワード: $TEMP_PASSWORD"
    echo ""
    echo "⚠️ 重要な注意事項:"
    echo "- 初回ログイン時にパスワード変更が必要です"
    echo "- パスワードは8文字以上で大文字、小文字、数字、記号を含める必要があります"
    echo ""
    echo "📱 アクセス方法:"
    echo "1. CloudFrontデプロイ完了後、提供されるURLにアクセス"
    echo "2. 上記の認証情報でログイン"
    echo "3. パスワード変更後、Claude Sonnet 4とチャット開始"
    echo ""
    echo "🤖 機能:"
    echo "- Claude Sonnet 4による高品質な回答"
    echo "- 日本語完全対応"
    echo "- ISK社向けカスタマイズ"
    echo "- セキュアな認証（Cognito）"
    echo ""
else
    echo "エラー: ユーザー作成に失敗しました"
    exit 1
fi