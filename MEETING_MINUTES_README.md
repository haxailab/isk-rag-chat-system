# 📝 議事録自動生成機能

## 概要

リアルタイムマイク録音と文字起こしから自動的に議事録を生成する機能です。AWS Transcribe + Bedrock Claudeを使用しています。

## 実装内容

### 🏗️ インフラ（CDK）

#### S3バケット
- **バケット名**: `isk-meeting-minutes-{account}-{region}`
- **用途**: 音声ファイルと議事録の永続保存
- **機能**:
  - バージョニング有効
  - 90日後にGlacier自動アーカイブ
  - サーバーサイド暗号化（AES256）

#### Lambda関数
- **関数名**: MeetingMinutesFunction
- **ランタイム**: Python 3.12
- **タイムアウト**: 5分
- **メモリ**: 2048MB
- **環境変数**:
  - `MEETING_MINUTES_BUCKET`: S3バケット名
  - `CLAUDE_MODEL_ID`: global.anthropic.claude-sonnet-4-6
  - `ACCESS_LOG_TABLE`: アクセスログテーブル

#### API Gateway
- **エンドポイント**: `/meeting-minutes`
- **メソッド**: GET, POST
- **認証**: Cognito User Pool Authorizer
- **CORS**: 有効

#### Cognito Identity Pool
- **用途**: AWS Transcribe Streamingの認証
- **ID**: `ap-northeast-1:eaa732a1-67a7-4047-9f87-78e52017c701`
- **権限**: TranscribeStreamingAccess

### 💻 フロントエンド

#### meeting-minutes.html
独立した議事録生成ページ：

**機能**:
1. **録音・文字起こし**
   - リアルタイムマイク録音
   - AWS Transcribe Streaming連携
   - 言語選択（日本語/英語/中国語/韓国語）
   - 手動テキスト入力対応

2. **議事録生成**
   - 3つのスタイル選択:
     - 📝 **summary**: 簡潔なサマリー
     - 📄 **detail**: 詳細な会議記録  
     - 📰 **newspaper**: 記事風
   - リアルタイム生成
   - Markdown表示

3. **保存・管理**
   - S3への自動保存
   - 過去の議事録一覧表示
   - コピー・ダウンロード機能

#### dev-index.html
- メニューに「📝 議事録自動生成」ボタン追加
- 新規タブでmeeting-minutes.htmlを開く

### 🔧 Lambda API仕様

#### POST /meeting-minutes
議事録を生成してS3に保存

**リクエスト**:
```json
{
  "transcript": "会議の文字起こしテキスト",
  "style": "summary | detail | newspaper",
  "audioData": "base64エンコードされた音声データ（オプション）"
}
```

**レスポンス**:
```json
{
  "minutes": "生成された議事録テキスト",
  "minutesKey": "s3://bucket/users/{username}/minutes/{timestamp}_{id}.txt",
  "transcriptKey": "s3://bucket/users/{username}/transcripts/{timestamp}_{id}.txt",
  "audioKey": "s3://bucket/users/{username}/audio/{timestamp}_{id}.webm",
  "minutesId": "uuid",
  "timestamp": "20260427_160000"
}
```

#### GET /meeting-minutes
過去の議事録一覧を取得

**クエリパラメータ**:
- `limit`: 取得件数（デフォルト: 20）
- `key`: 特定の議事録を取得

**レスポンス**:
```json
{
  "items": [
    {
      "key": "users/{username}/minutes/...",
      "size": 1234,
      "lastModified": "2026-04-27T16:00:00.000Z",
      "metadata": {
        "username": "test-user",
        "style": "summary",
        "timestamp": "20260427_160000",
        "minutes_id": "uuid"
      }
    }
  ]
}
```

### 📋 議事録スタイル

#### summary（サマリー）
- 主な議論トピックとその背景
- 決定事項とその理由
- アクションアイテム
- 重要な期限や次のステップ
- 未解決の問題

#### detail（詳細）
- 会議概要（目的、参加者、日時）
- 発言者の属性を含む詳細な議論の流れ
- 決定の背景と理由
- すべてのアクションアイテム、決定事項
- 提起された質問とその回答
- 懸念事項、リスク、ブロッカー

#### newspaper（記事風）
- ジャーナリスト視点での記事作成
- 読者に包括的な情報を提供
- 元のコンテンツ量を保持

## 設定情報

```javascript
region: 'ap-northeast-1'
userPoolId: 'ap-northeast-1_zG065zZXu'
clientId: '320evpoao9264eh5ounfq8c313'
identityPoolId: 'ap-northeast-1:eaa732a1-67a7-4047-9f87-78e52017c701'
apiEndpoint: 'https://s54esmcz1j.execute-api.ap-northeast-1.amazonaws.com/prod'
```

## 使い方

1. **dev-index.htmlから起動**
   - ログイン後、左サイドバーの「📝 議事録自動生成」をクリック

2. **録音して議事録生成**
   - 「録音開始」ボタンをクリック
   - 会議の音声を録音
   - 「録音停止」で文字起こし完了
   - スタイルを選択して「議事録を生成」

3. **手動テキストから生成**
   - 「または手動入力」エリアにテキストを貼り付け
   - スタイルを選択して「議事録を生成」

4. **過去の議事録を確認**
   - ページ下部の「過去の議事録」セクションで履歴を確認

## ファイル構成

```
aws/
├── lib/
│   └── isk-rag-chat-system-stack.ts  # CDKスタック定義（Identity Pool追加）
├── lambda/
│   └── meeting-minutes/
│       └── index.py                   # 議事録生成Lambda
├── meeting-minutes.html               # 議事録生成UI
├── meeting-minutes-transcribe.js     # Transcribe Streaming統合（ES Module）
├── dev-index.html                     # メニュー追加済み
└── MEETING_MINUTES_README.md         # このファイル
```

## 🎉 最新アップデート（2026-04-28）

### ✅ リアルタイム文字起こし実装完了！

GenUと同じ**AWS Transcribe Streaming**を使用したリアルタイム実装が完了しました：

#### 実装内容
- **AWS SDK v3**: `@aws-sdk/client-transcribe-streaming` を使用
- **microphone-stream**: ブラウザマイク入力をストリーム化
- **PCMエンコーディング**: 音声データを16-bit PCMに変換
- **リアルタイム処理**: 
  - 暫定結果（isPartial: true）をグレー・イタリック表示
  - 確定結果（isPartial: false）を黒色で表示
  - 自動スクロールで最新の文字起こしを追従

#### 技術仕様
```javascript
// 音声処理フロー
マイク入力 (48kHz)
  ↓
MicrophoneStream
  ↓
PCM エンコード (16-bit)
  ↓
TranscribeStreamingClient
  ↓
リアルタイム結果受信
  ↓
UI更新（暫定→確定）
```

#### 認証
- Cognito Identity Poolを使用
- ブラウザから直接Transcribe APIを呼び出し
- 一時クレデンシャルで安全にアクセス

## 今後の拡張案

- [x] **リアルタイム文字起こしの完全統合** ✅ 実装完了！
- [ ] 複数話者の識別と分離（ShowSpeakerLabel対応）
- [ ] 音声ファイルアップロード対応
- [ ] 議事録のPDF/Word出力
- [ ] チーム共有機能
- [ ] カスタムテンプレート作成
- [ ] 議事録の検索機能
- [ ] 多言語翻訳機能

## 注意事項

- AWS Transcribe Streamingは課金対象です（1分あたり$0.024）
- Bedrock Claude APIも課金対象です
- S3ストレージ費用が発生します
- Identity Poolを使用するため、適切なIAM権限設定が必要です

## トラブルシューティング

### マイクへのアクセスが拒否される
- ブラウザの設定でマイク権限を許可してください
- HTTPSが必要です（localhostは例外）

### 文字起こしが機能しない
- Identity Pool IDが正しく設定されているか確認
- Cognito認証が成功しているか確認
- ブラウザコンソールでエラーログを確認

### 議事録生成が失敗する
- API Gatewayエンドポイントが正しいか確認
- Cognito IDトークンが有効か確認
- Lambda関数のログを確認（CloudWatch Logs）

## 開発者向け

### デプロイ
```bash
cdk deploy IskRagChatSystemBackend --require-approval never
```

### Lambda関数の更新
```bash
# コードを編集後
cdk deploy IskRagChatSystemBackend
```

### ローカルテスト
```bash
# Lambda関数のテスト
cd lambda/meeting-minutes
python index.py
```

## 参考リンク

- [AWS Transcribe Streaming](https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html)
- [Bedrock Claude Models](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html)
- [Cognito Identity Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/identity-pools.html)
