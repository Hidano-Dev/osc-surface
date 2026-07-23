# VERIFICATION.md — 手動検証手順

各 Phase の完了時に、その Phase の動作確認手順を追記する。コマンドはリポジトリ root で実行する(PowerShell 想定)。

## Phase 0 — 環境の素振り

### 前提(初回セットアップ)

```powershell
# 1. submodule 取得
git submodule update --init

# 2. ワークスペース依存
corepack pnpm install

# 3. vendor (O-S-C) の依存 + アセットビルド
$env:ELECTRON_SKIP_BINARY_DOWNLOAD='1'
npm --prefix vendor/open-stage-control install --no-package-lock --no-audit --no-fund
npm --prefix vendor/open-stage-control run build
# upstream の npm scripts の echo が Windows で作るゴミファイルを削除
Remove-Item vendor/open-stage-control/Dependencies, vendor/open-stage-control/JS -ErrorAction SilentlyContinue

# 4. custom module のバンドル
corepack pnpm --filter @osc-surface/custom-module run build
```

### 確認手順

1. headless 起動:

   ```powershell
   node vendor/open-stage-control/app -n -p 7080 -l layouts/main.json -c packages/custom-module/dist/osc-surface.js
   ```

2. 起動ログに以下が出ること:
   - `(INFO) [osc-surface] custom module loaded ...` — custom module が読み込まれた
   - `(INFO) Server started, app available at ...` — HTTP サーバー起動
3. ブラウザで `http://127.0.0.1:7080` を開き、`Smoke Test` フェーダーが表示されること(レイアウト読み込み確認)
4. `Ctrl+C` で停止し、`git status` で `vendor/open-stage-control` に変更(dirty)が出ていないこと(無改造の確認)
