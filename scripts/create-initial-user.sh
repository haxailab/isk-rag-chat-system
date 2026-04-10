#!/bin/bash

# 初期ユーザー作成スクリプト

set -e

# 引数チェック
if [ $# -ne 2 ]; then
    echo "使用方法: $0 <email> <temporary_password>"
    echo "例: $0 admin@isk-company.com TempPass123!"
    exit 1
fi

EMAIL=$1
TEMP_PASSWORD=$2

echo "========================================="
echo "初期ユーザー作成"
echo "========================================="

# User Pool IDを取得
echo "User Pool IDを取得中..."
USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name IskRagChatSystemBackend \
    --region ap-northeast-1 \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
    --output text)

if [ -z "$USER_POOL_ID" ]; then
    echo "エラー: User Pool IDが取得できませんでした"
    echo "CDKスタックがデプロイされているか確認してください"
    exit 1
fi

echo "User Pool ID: $USER_POOL_ID"

# ユーザー作成
echo "ユーザーを作成中..."
aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$EMAIL" \
    --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
    --temporary-password "$TEMP_PASSWORD" \
    --message-action SUPPRESS \
    --region ap-northeast-1

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================="
    echo "ユーザー作成完了！"
    echo "========================================="
    echo "メールアドレス: $EMAIL"
    echo "初回パスワード: $TEMP_PASSWORD"
    echo ""
    echo "注意:"
    echo "- 初回ログイン時にパスワード変更が必要です"
    echo "- パスワードは8文字以上で大文字、小文字、数字、記号を含める必要があります"
    echo ""

    # CloudFront URLを取得して表示
    CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
        --stack-name IskRagChatSystemFrontend \
        --region ap-northeast-1 \
        --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontUrl`].OutputValue' \
        --output text 2>/dev/null)

    if [ -n "$CLOUDFRONT_URL" ]; then
        echo "アクセスURL: $CLOUDFRONT_URL"
    fi
else
    echo "エラー: ユーザー作成に失敗しました"
    exit 1
fi