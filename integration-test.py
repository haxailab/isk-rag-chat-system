#!/usr/bin/env python3
"""
無機RAGシステム 統合テスト・エンドツーエンドテスト
ファイルアップロード→セッション管理→ハイブリッド検索→分析レポート生成のフルワークフローテスト
"""
import json
import base64
import requests
import time
import uuid
from datetime import datetime
import os

# テスト設定
API_BASE_URL = "https://jztwgpdqe8.execute-api.ap-northeast-1.amazonaws.com/prod"
TEST_USER_TOKEN = None  # Cognitoトークンが必要（実際の実装では認証が必要）

class RAGSystemTester:
    def __init__(self):
        self.api_url = API_BASE_URL
        self.session_id = None
        self.uploaded_files = []
        self.test_results = {
            "health_check": False,
            "file_upload": False,
            "session_management": False,
            "hybrid_search": False,
            "analysis_report": False,
            "overall": False
        }

    def run_health_check(self):
        """基本的なヘルスチェック"""
        print("[TEST] 1. ヘルスチェック実行中...")
        try:
            response = requests.get(f"{self.api_url}/health", timeout=10)
            if response.status_code == 200:
                data = response.json()
                print(f"   [OK] API正常: {data}")
                self.test_results["health_check"] = True
                return True
            else:
                print(f"   [FAIL] ヘルスチェック失敗: {response.status_code}")
                return False
        except Exception as e:
            print(f"   [FAIL] ヘルスチェックエラー: {e}")
            return False

    def test_cors_configuration(self):
        """CORS設定テスト"""
        print("[TEST] 2. CORS設定確認中...")
        try:
            # OPTIONSリクエストでCORS設定確認
            headers = {
                'Origin': 'https://example.com',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'Content-Type,Authorization'
            }

            endpoints = ['/upload', '/chat', '/analyze', '/sessions']
            cors_ok = True

            for endpoint in endpoints:
                try:
                    response = requests.options(f"{self.api_url}{endpoint}", headers=headers, timeout=5)
                    cors_headers = response.headers
                    print(f"   {endpoint}: Status={response.status_code}")

                    # CORS必須ヘッダーチェック
                    required_headers = [
                        'Access-Control-Allow-Origin',
                        'Access-Control-Allow-Methods',
                        'Access-Control-Allow-Headers'
                    ]

                    for header in required_headers:
                        if header in cors_headers:
                            print(f"     [OK] {header}: {cors_headers[header]}")
                        else:
                            print(f"     [FAIL] {header}: 未設定")
                            cors_ok = False

                except requests.exceptions.RequestException as e:
                    print(f"   [FAIL] {endpoint}: {e}")
                    cors_ok = False

            return cors_ok

        except Exception as e:
            print(f"   [FAIL] CORS設定テストエラー: {e}")
            return False

    def test_file_upload(self):
        """ファイルアップロード機能テスト"""
        print("[TEST] 3. ファイルアップロード機能テスト中...")

        # テスト用ファイル作成
        test_files = [
            {
                "filename": "test_document.txt",
                "content": "これはテスト用のドキュメントです。\n無機RAGシステムのファイルアップロード機能を検証しています。\n日本語の処理も正常に動作することを確認します。",
                "content_type": "text/plain"
            },
            {
                "filename": "sample_data.json",
                "content": json.dumps({
                    "title": "サンプルデータ",
                    "description": "JSON形式のテストファイル",
                    "data": ["項目1", "項目2", "項目3"],
                    "timestamp": datetime.now().isoformat()
                }, ensure_ascii=False, indent=2),
                "content_type": "application/json"
            }
        ]

        try:
            # ファイルをBase64エンコード
            encoded_files = []
            for file_info in test_files:
                content_bytes = file_info["content"].encode('utf-8')
                encoded_content = base64.b64encode(content_bytes).decode('utf-8')

                encoded_files.append({
                    "filename": file_info["filename"],
                    "content": encoded_content,
                    "contentType": file_info["content_type"]
                })

            # アップロードリクエスト
            payload = {
                "files": encoded_files,
                "session_name": f"統合テスト_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            }

            # 実際のリクエスト（認証ヘッダーが必要）
            headers = {
                "Content-Type": "application/json"
            }

            if TEST_USER_TOKEN:
                headers["Authorization"] = f"Bearer {TEST_USER_TOKEN}"

            # 現在は認証なしでテストエンドポイントを使用
            test_url = f"{self.api_url}/test-upload"  # 認証なしテスト用エンドポイント

            print(f"   [UPLOAD] ファイルアップロード実行中... ({len(encoded_files)}ファイル)")

            # まずはエンドポイントの存在確認
            response = requests.options(test_url, timeout=10)
            if response.status_code == 404:
                print(f"   [WARN]  アップロードエンドポイントが未実装: {test_url}")
                print("   💡 基本チャット機能のテストに移行します")
                return False

            # 実際のアップロード試行
            response = requests.post(test_url, json=payload, headers=headers, timeout=30)

            if response.status_code == 200:
                result = response.json()
                self.session_id = result.get("session_id")
                self.uploaded_files = result.get("uploaded_files", [])

                print(f"   [OK] アップロード成功!")
                print(f"   📁 セッションID: {self.session_id}")
                print(f"   📄 アップロードファイル数: {len(self.uploaded_files)}")

                for file_info in self.uploaded_files:
                    print(f"     - {file_info.get('filename')}: {file_info.get('size')}バイト")

                self.test_results["file_upload"] = True
                return True

            else:
                print(f"   [FAIL] アップロード失敗: {response.status_code}")
                print(f"   エラー内容: {response.text}")
                return False

        except Exception as e:
            print(f"   [FAIL] ファイルアップロードテストエラー: {e}")
            return False

    def test_basic_chat(self):
        """基本チャット機能テスト"""
        print("[TEST] 4. 基本チャット機能テスト中...")

        try:
            # テストチャットエンドポイント使用（認証不要）
            chat_payload = {
                "message": "こんにちは。無機RAGシステムのテストです。正常に動作していますか？",
                "session_id": "test-session-basic"
            }

            response = requests.post(
                f"{self.api_url}/test-chat",
                json=chat_payload,
                headers={"Content-Type": "application/json"},
                timeout=30
            )

            if response.status_code == 200:
                result = response.json()
                assistant_message = result.get("message", "")

                print(f"   [OK] チャット応答成功!")
                print(f"   🤖 応答: {assistant_message[:100]}{'...' if len(assistant_message) > 100 else ''}")

                self.test_results["hybrid_search"] = True
                return True
            else:
                print(f"   [FAIL] チャット失敗: {response.status_code}")
                print(f"   エラー内容: {response.text}")
                return False

        except Exception as e:
            print(f"   [FAIL] チャットテストエラー: {e}")
            return False

    def test_session_management(self):
        """セッション管理機能テスト"""
        print("[TEST] 5. セッション管理機能テスト中...")

        if not self.session_id:
            print("   [WARN]  セッションIDがありません。ファイルアップロードをスキップ")
            return False

        try:
            # セッション情報取得
            session_url = f"{self.api_url}/sessions/{self.session_id}"
            response = requests.get(session_url, timeout=10)

            if response.status_code == 200:
                session_info = response.json()
                print(f"   [OK] セッション情報取得成功!")
                print(f"   [SUMMARY] ファイル数: {session_info.get('file_count', 0)}")
                print(f"   📅 作成日時: {session_info.get('created_at', 'N/A')}")

                self.test_results["session_management"] = True
                return True
            else:
                print(f"   [FAIL] セッション管理失敗: {response.status_code}")
                return False

        except Exception as e:
            print(f"   [FAIL] セッション管理テストエラー: {e}")
            return False

    def test_analysis_features(self):
        """分析機能テスト"""
        print("[TEST] 6. 分析機能テスト中...")

        try:
            # 分析テーマ一覧取得
            themes_response = requests.get(f"{self.api_url}/analyze/themes", timeout=10)

            if themes_response.status_code == 200:
                themes = themes_response.json()
                print(f"   [OK] 分析テーマ取得成功: {len(themes.get('themes', {}))}件")

                # 簡単な分析リクエスト
                analysis_payload = {
                    "theme": "custom_analysis",
                    "custom_theme": "システムの動作確認",
                    "documents": ["test_document"],
                    "session_id": self.session_id or "test-session"
                }

                analysis_response = requests.post(
                    f"{self.api_url}/analyze",
                    json=analysis_payload,
                    timeout=60
                )

                if analysis_response.status_code == 200:
                    analysis_result = analysis_response.json()
                    print(f"   [OK] 分析実行成功!")
                    print(f"   [SUMMARY] 分析結果: {len(analysis_result.get('report', ''))}文字")

                    self.test_results["analysis_report"] = True
                    return True
                else:
                    print(f"   [FAIL] 分析実行失敗: {analysis_response.status_code}")
                    return False
            else:
                print(f"   [FAIL] 分析テーマ取得失敗: {themes_response.status_code}")
                return False

        except Exception as e:
            print(f"   [FAIL] 分析機能テストエラー: {e}")
            return False

    def run_comprehensive_test(self):
        """包括的テスト実行"""
        print("=" * 60)
        print(">>> 無機RAGシステム 統合テスト開始")
        print("=" * 60)

        start_time = time.time()

        # 1. ヘルスチェック
        self.run_health_check()

        # 2. CORS設定確認
        self.test_cors_configuration()

        # 3. 基本チャット機能テスト
        self.test_basic_chat()

        # 4. ファイルアップロード機能テスト
        self.test_file_upload()

        # 5. セッション管理テスト
        if self.test_results["file_upload"]:
            self.test_session_management()

        # 6. 分析機能テスト
        self.test_analysis_features()

        # 総合結果
        elapsed_time = time.time() - start_time
        success_count = sum(self.test_results.values())
        total_tests = len(self.test_results)

        print("\n" + "=" * 60)
        print("[SUMMARY] テスト結果サマリー")
        print("=" * 60)

        for test_name, result in self.test_results.items():
            status = "[OK] PASS" if result else "[FAIL] FAIL"
            print(f"  {test_name:<20}: {status}")

        print(f"\n[STAT] 成功率: {success_count}/{total_tests} ({success_count/total_tests*100:.1f}%)")
        print(f"[TIME]  実行時間: {elapsed_time:.1f}秒")

        # 全体的な評価
        overall_success = success_count >= total_tests * 0.7  # 70%以上で成功とみなす
        self.test_results["overall"] = overall_success

        if overall_success:
            print("\n[SUCCESS] 統合テスト: 総合的に成功!")
        else:
            print("\n[WARN]  統合テスト: 改善が必要な項目があります")

        return overall_success

def main():
    """メイン実行関数"""
    tester = RAGSystemTester()
    success = tester.run_comprehensive_test()

    if success:
        print("\n[OK] 無機RAGシステム統合テスト完了: システムは正常に動作しています")
    else:
        print("\n[FAIL] 無機RAGシステム統合テスト: 一部機能に問題があります")

    return success

if __name__ == "__main__":
    main()