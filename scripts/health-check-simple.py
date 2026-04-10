#!/usr/bin/env python3
"""
ISK RAG Chat System Simple版 ヘルスチェックスクリプト
バックエンドAPIの動作確認を行う
"""

import requests
import json
import sys
from datetime import datetime

# 設定
API_BASE_URL = "https://jztwgpdqe8.execute-api.ap-northeast-1.amazonaws.com/prod"
HEALTH_ENDPOINT = f"{API_BASE_URL}/health"

def check_api_health():
    """APIヘルスチェック"""
    print("========================================")
    print("ISK RAG Chat System Simple版")
    print("ヘルスチェック")
    print("========================================")
    print(f"チェック時刻: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"API URL: {API_BASE_URL}")
    print()

    try:
        # ヘルスチェックエンドポイントをテスト
        print("🔍 ヘルスチェックエンドポイントをテスト中...")
        response = requests.get(HEALTH_ENDPOINT, timeout=10)

        print(f"   ステータスコード: {response.status_code}")
        print(f"   レスポンス時間: {response.elapsed.total_seconds():.2f}秒")

        if response.status_code == 200:
            try:
                data = response.json()
                print(f"   レスポンス内容: {json.dumps(data, indent=2, ensure_ascii=False)}")
                print("   ✅ ヘルスチェック: 正常")
            except json.JSONDecodeError:
                print(f"   レスポンス内容: {response.text}")
                print("   ⚠️  JSON解析エラー")
        else:
            print(f"   エラーレスポンス: {response.text}")
            print("   ❌ ヘルスチェック: 異常")
            return False

    except requests.exceptions.Timeout:
        print("   ❌ ヘルスチェック: タイムアウト")
        return False
    except requests.exceptions.ConnectionError:
        print("   ❌ ヘルスチェック: 接続エラー")
        return False
    except Exception as e:
        print(f"   ❌ ヘルスチェック: 不明なエラー - {str(e)}")
        return False

    print()
    return True

def check_cors_headers():
    """CORS設定確認"""
    print("🔍 CORS設定を確認中...")

    try:
        # OPTIONSリクエストでCORSヘッダーを確認
        response = requests.options(f"{API_BASE_URL}/chat", timeout=10)

        cors_headers = {
            'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
            'Access-Control-Allow-Methods': response.headers.get('Access-Control-Allow-Methods'),
            'Access-Control-Allow-Headers': response.headers.get('Access-Control-Allow-Headers')
        }

        print(f"   ステータスコード: {response.status_code}")
        for header, value in cors_headers.items():
            if value:
                print(f"   {header}: {value}")

        if all(cors_headers.values()):
            print("   ✅ CORS設定: 正常")
        else:
            print("   ⚠️  CORS設定: 一部のヘッダーが不足")

    except Exception as e:
        print(f"   ❌ CORS確認エラー: {str(e)}")

    print()

def display_system_info():
    """システム情報表示"""
    print("📊 システム情報:")
    print("   バージョン: Simple v1.0")
    print("   AIモデル: Claude Sonnet 4")
    print("   リージョン: ap-northeast-1 (東京)")
    print("   認証: Amazon Cognito")
    print("   機能: 直接AI対話（RAG機能は次版で追加予定）")
    print()

def display_next_steps():
    """次のステップ案内"""
    print("🚀 次のステップ:")
    print("   1. フロントエンド完成を待つ（CloudFront作成中）")
    print("   2. 初期ユーザー作成:")
    print("      chmod +x scripts/create-simple-user.sh")
    print("      ./scripts/create-simple-user.sh admin@isk.com TempPass123!")
    print("   3. WebアプリでClaude Sonnet 4とチャット開始")
    print("   4. Phase 2: Knowledge Base + RAG機能追加")
    print()

def main():
    """メイン処理"""
    # ヘルスチェック実行
    health_ok = check_api_health()

    # CORS確認
    check_cors_headers()

    # システム情報表示
    display_system_info()

    # 全体結果
    if health_ok:
        print("🎉 ISK RAG Chat System Simple版は正常に動作しています！")
    else:
        print("❌ システムに問題があります。ログを確認してください。")
        sys.exit(1)

    # 次のステップ案内
    display_next_steps()

if __name__ == "__main__":
    main()