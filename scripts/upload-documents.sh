#!/bin/bash

# ドキュメントアップロードスクリプト

set -e

# 引数チェック
if [ $# -ne 1 ]; then
    echo "使用方法: $0 <documents_directory>"
    echo "例: $0 ./documents"
    exit 1
fi

DOCS_DIR=$1

if [ ! -d "$DOCS_DIR" ]; then
    echo "エラー: ディレクトリ '$DOCS_DIR' が見つかりません"
    exit 1
fi

echo "========================================="
echo "ドキュメントアップロード"
echo "========================================="

# S3バケット名を取得
echo "S3バケット名を取得中..."
BUCKET_NAME=$(aws cloudformation describe-stacks \
    --stack-name IskRagChatSystemBackend \
    --region ap-northeast-1 \
    --query 'Stacks[0].Outputs[?OutputKey==`DocumentBucketName`].OutputValue' \
    --output text)

if [ -z "$BUCKET_NAME" ]; then
    echo "エラー: S3バケット名が取得できませんでした"
    echo "CDKスタックがデプロイされているか確認してください"
    exit 1
fi

echo "バケット名: $BUCKET_NAME"

# サポートされるファイル形式
SUPPORTED_EXTENSIONS="*.txt *.md *.pdf *.docx *.html *.json *.csv"

echo ""
echo "アップロード対象のファイル:"
for ext in $SUPPORTED_EXTENSIONS; do
    find "$DOCS_DIR" -name "$ext" -type f 2>/dev/null | head -5
done

echo ""
read -p "これらのファイルをアップロードしますか？ (y/N): " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "アップロードを中止しました"
    exit 1
fi

# ファイルをアップロード
echo ""
echo "アップロード中..."

UPLOAD_COUNT=0
for ext in $SUPPORTED_EXTENSIONS; do
    for file in $(find "$DOCS_DIR" -name "$ext" -type f); do
        echo "アップロード中: $file"
        aws s3 cp "$file" "s3://$BUCKET_NAME/" --region ap-northeast-1
        ((UPLOAD_COUNT++))
    done
done

echo ""
echo "========================================="
echo "アップロード完了"
echo "========================================="
echo "アップロード済みファイル数: $UPLOAD_COUNT"

if [ $UPLOAD_COUNT -gt 0 ]; then
    echo ""
    echo "次のステップ:"
    echo "1. Knowledge Baseでデータソースの同期を実行"
    echo "2. 同期完了後、チャットで質問をテスト"
    echo ""
    echo "データソース同期コマンド:"
    echo "python3 scripts/sync-knowledge-base.py"
else
    echo "アップロードされたファイルがありません"
fi