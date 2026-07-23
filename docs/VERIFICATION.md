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

## Phase 1 — プロトコル基盤

### 前提

```powershell
# shared / custom-module / mock-unity のビルド
corepack pnpm -r --if-present run build
```

- ブラウザ確認には常用ブラウザではなく、開発用の軽量ブラウザを使う
- `config/surface.config.json` の既定値は `unity.sendPort = 9000`、`unity.receivePort = 9001`

### 確認手順

1. mock-unity を起動する:

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 9000 --reply-host 127.0.0.1 --reply-port 9001
   ```

2. `MOCK_UNITY_READY {"listenPort":9000}` が表示されることを確認する
3. 別ターミナルで O-S-C headless を起動する:

   ```powershell
   node vendor/open-stage-control/app -n -p 7080 -o 9001 -s 127.0.0.1:9000 -l layouts/main.json -c packages/custom-module/dist/osc-surface.js
   ```

4. O-S-C 側のログに custom module 読み込み完了とサーバー起動が出ることを確認する
5. 開発用ブラウザで `http://127.0.0.1:7080` を開き、`Smoke Test` フェーダーが表示されることを確認する
6. フェーダーを操作し、値を離した後に表示が mock-unity のエコーバックで確定することを目視確認する
7. 自動検証として次を実行し、unit と e2e が通ることを確認する:

   ```powershell
   corepack pnpm test
   ```

8. 停止時は O-S-C と mock-unity の両方を `Ctrl+C` で終了する

### ポート占有時の確認

1. `EADDRINUSE` が出たら使用中プロセスを確認する:

   ```powershell
   Get-NetTCPConnection -LocalPort 7080,9000,9001 -ErrorAction SilentlyContinue |
     Select-Object LocalAddress,LocalPort,OwningProcess,State
   ```

2. `OwningProcess` が分かったら詳細を確認する:

   ```powershell
   Get-Process -Id <PID>
   ```

3. 不要な残留プロセスなら停止してから再実行する:

   ```powershell
   Stop-Process -Id <PID>
   ```
