# oscdesk

Unity を LAN 内のブラウザやスマートフォンから操作する、oscdesk コントロールサーフェスです。Node.js のブリッジが Unity との OSC 通信と UI との WebSocket 通信を仲介し、NiceGUI UI が表示と操作を担当します。

このシステムは認証を提供しません。信頼できる LAN 内で利用することを前提とし、インターネットや信頼できないネットワークへ直接公開しないでください。

## 3つの規律

- ブリッジと UI の責務を分離する。Unity との OSC 通信はブリッジに集約し、UI はブリッジの WebSocket プロトコルを利用する。
- 案件ごとの差分はコードではなく、設定・レイアウト・マニフェストのデータで表現する。
- Unity を真実の源とする。UI は表示キャッシュであり、値の確定は Unity からのエコーバックだけで行う。

## 構成

- `packages/bridge` — Node.js ブリッジ。Unity との OSC 通信と UI との WebSocket 通信を担当
- `packages/nicegui-ui` — NiceGUI UI。Python モジュール名は `oscdesk_ui`
- `packages/shared` — プロトコル型、zod スキーマ、定数
- `packages/osc-codec` — OSC のエンコード・デコード
- `packages/mock-unity` — テスト・開発用 Unity モック
- `config/` — 実行時設定
- `protocol/` — 共有プロトコルの資料とサンプル
- `tests/` — 共通テスト
- `OscSurface/` — 同居する Unity プロジェクト

## セットアップ

新しい PC にクローンした直後は `setup-oscdesk.bat` をダブルクリックするか、PowerShell で `.\setup-oscdesk.ps1` を実行します。依存関係の導入、全パッケージのビルド、UI 用 Python 仮想環境の準備を行います。

個別に実行する場合:

```powershell
corepack pnpm install
corepack pnpm -r run build
py -3 -m venv packages/nicegui-ui/.venv
packages/nicegui-ui/.venv/Scripts/python -m pip install -e "packages/nicegui-ui[dev]"
```

## 起動

通常起動は `start-oscdesk.bat` をダブルクリックするか、`.\start-oscdesk.ps1` を実行します。ブリッジと NiceGUI UI が起動し、接続先 URL が表示されます。既定の Unity 向けポートは送信 7090 / 受信 7091、WebSocket は 7080 です。ウィンドウを閉じると両プロセスが停止します。

デバッグ起動は `start-oscdesk-debug.bat`、OSC ネイティブ UI 評価は `start-oscdesk-touchosc.bat` を使用します。評価起動では mock-unity とブリッジを起動し、接続先 IP と受信ポートを表示します。

## テスト

```powershell
# 型チェック
corepack pnpm typecheck

# 全テスト(ビルドを含む単一入口)
corepack pnpm test

# 単体テストのみ
corepack pnpm exec vitest run --config vitest.config.ts --project unit
```

UI の pytest は `corepack pnpm test` から `scripts/run-python-tests.mjs` 経由で実行されます。

詳細なプロトコルと手動検証手順は `protocol/` と `docs/` を参照してください。
