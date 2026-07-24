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

## Phase 2 — マニフェスト駆動 UI

Phase 2 でレイアウトを拡張したため、Phase 0 / Phase 1 の手順にある「Smoke Test フェーダー」は現行レイアウトでは「Smile」フェーダーに読み替える。

### 前提

```powershell
# shared / custom-module / mock-unity のビルド
corepack pnpm -r --if-present run build

# E2E 用ブラウザ (chromium) のインストール(初回のみ。corepack pnpm test の前提)
corepack pnpm exec playwright install chromium
```

- ブラウザ確認には常用ブラウザではなく、開発用の軽量ブラウザを使う
- レイアウト規約: `layouts/main.json` の手動配置ウィジェットには、動的生成用の id 接頭辞 `dyn`(生成 id は `dynamicWidgetId(address)` により `dyn_avatar_...` の形になる)と、動的生成先コンテナの id `dynamic` を使わないこと。動的生成はこれらの id を前提に手動配置ウィジェットを保護している

### 確認手順

1. mock-unity を標準シナリオ指定で起動する:

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 9000 --reply-host 127.0.0.1 --reply-port 9001 --scenario packages/mock-unity/scenarios/default.json
   ```

2. READY 行 `MOCK_UNITY_READY {"listenPort":9000,"scenarioPath":"...","characterName":"..."}` に起動ごとのキャラ名が出ることを確認する(以降の手順でラベル表示と突き合わせる)
3. 別ターミナルで O-S-C headless を起動する:

   ```powershell
   node vendor/open-stage-control/app -n -p 7080 -o 9001 -s 127.0.0.1:9000 -l layouts/main.json -c packages/custom-module/dist/osc-surface.js
   ```

   **`-s`(既定送信ターゲット)の指定は必須**で、`config/surface.config.json` の宛先(`unity.host:unity.sendPort` = `127.0.0.1:9000`)と一致させること。動的生成ウィジェットは `target` プロパティを持たずサーバ既定ターゲット(`-s`)へ送信するため、これがずれると動的ウィジェットの操作だけが mock-unity(Unity)へ届かなくなる

4. 開発用ブラウザで `http://127.0.0.1:7080` を開き、マニフェスト適用を確認する:
   - 既存ウィジェットのラベルにキャラ名が反映されている(Smile フェーダーのラベルが `<キャラ名> Smile` になる)
   - `Generated Widgets`(`dynamic`)パネル配下に、レイアウトにない索引外エントリ(`Greeting` / `Wave`)の動的ウィジェットが group 見出し(`Profile` / `Motion`)付きで生成されている
   - 各ウィジェットがシナリオの現在値(`default`)で初期表示されている(値同期。Character Name / Greeting にキャラ名が入る)
5. 動的ウィジェット(例: `Wave` ボタン)を操作し、mock-unity のエコーバックで表示が確定することを確認する(手動配置ウィジェットと同一の送信・エコーバック規律)
6. mock-unity を `Ctrl+C` で停止し、**5 秒程度待って喪失を検出させてから**(2 秒間隔 ping の連続喪失 1 以上が回復検出の前提)キャラ名を固定して再起動する:

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 9000 --reply-host 127.0.0.1 --reply-port 9001 --scenario packages/mock-unity/scenarios/default.json --character-name 検証用キャラ
   ```

   到達性回復 → マニフェスト再要求により、ラベル・値のキャラ名が新しい名前へ変わることを目視確認する
7. Smile フェーダーをドラッグし続けている間はエコーバック受信値で表示が飛ばない(ドラッグ中の受信値無視)こと、離した後にエコーバック値で表示が確定することを確認する
8. 自動検証として次を実行し、Phase 1 の既存テストに加えて Phase 2 の単体テストと E2E(標準シナリオ / 不正シナリオ)が通ることを確認する:

   ```powershell
   corepack pnpm test
   ```

9. 停止時は O-S-C と mock-unity の両方を `Ctrl+C` で終了し、`git status` で `vendor/open-stage-control` に差分がないことを確認する

## Phase 3 — 診断パネルとデバッグモード

### 前提

```powershell
# shared / custom-module / mock-unity のビルド
corepack pnpm -r --if-present run build

# E2E 用ブラウザ (chromium) のインストール(初回のみ。corepack pnpm test の前提)
corepack pnpm exec playwright install chromium
```

- ブラウザ確認には常用ブラウザではなく、開発用の軽量ブラウザを使う
- debug ON の確認では `config/surface.debug.config.json` を使い、NDJSON 出力先 `logs/diagnostics` は必要に応じて事前に削除して観測しやすくする
- `layouts/main.json` の Diagnostics モーダルは表示専用で、`ログを削除` ボタン以外の診断表示は Unity への OSC 送信を行わない

### 確認手順

1. 既存ログを消して観測を開始しやすくする:

   ```powershell
   Remove-Item logs/diagnostics -Recurse -Force -ErrorAction SilentlyContinue
   ```

2. mock-unity を標準シナリオで起動する:

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 9000 --reply-host 127.0.0.1 --reply-port 9001 --scenario packages/mock-unity/scenarios/default.json
   ```

3. 別ターミナルで debug ON の O-S-C headless を起動する:

   ```powershell
   $env:OSC_SURFACE_CONFIG='config/surface.debug.config.json'
   node vendor/open-stage-control/app -n -p 7080 -o 9001 -s 127.0.0.1:9000 -l layouts/main.json -c packages/custom-module/dist/osc-surface.js
   Remove-Item Env:OSC_SURFACE_CONFIG
   ```

4. O-S-C 側ログに `Diagnostics debug mode enabled.` が出ることを確認し、ブラウザで `http://127.0.0.1:7080` を開いて `Diagnostics` モーダルを表示する
5. 数秒待ち、診断パネルに次が出ることを確認する:
   - 到達性が `到達中`
   - RTT に数値(ms)が出る
   - 損失率が `0.0%` 付近で出る
   - サブネット判定が `同一ホスト` または `同一サブネット`
   - ログ使用量にサイズ表示が出る
   - 最新メッセージに `/sys/ping` と `/sys/pong` を含む送受信履歴が出る
6. `Smile` フェーダーまたは動的生成ウィジェットを操作し、診断パネルの最新メッセージに対応する OSC 送受信が追記されることを確認する
7. `logs/diagnostics` 配下に `osc-debug-*.ndjson` が生成され、1 行 1 JSON の NDJSON であることを確認する:

   ```powershell
   Get-ChildItem logs/diagnostics
   Get-Content (Get-ChildItem logs/diagnostics/osc-debug-*.ndjson | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -TotalCount 5
   ```

8. 診断パネルの `ログを削除` ボタンを押し、古い NDJSON が削除されてログ使用量表示が減ることを確認する
9. mock-unity を `Ctrl+C` で停止し、5 秒程度待って診断パネルの到達性が `喪失中` に変わることを確認する。必要なら最新メッセージに ping 継続と pong 欠落が反映されることも確認する
10. mock-unity を再起動し、到達性が `到達中` に戻ることを確認する
11. debug OFF の抑止を確認するため、O-S-C を停止してから既定 config で起動し直す:

   ```powershell
   node vendor/open-stage-control/app -n -p 7080 -o 9001 -s 127.0.0.1:9000 -l layouts/main.json -c packages/custom-module/dist/osc-surface.js
   ```

12. O-S-C 側ログに `Diagnostics debug mode disabled.` が出ることを確認し、ブラウザから `/surface/diag/request` 相当の診断要求に反応しないこと、追加の NDJSON が生成されないことを確認する
13. 全体回帰として次を実行し、workspace build・unit test・E2E が通ることを確認する:

   ```powershell
   corepack pnpm test
   ```

   `process-harness ready-timeout` の E2E だけが失敗した場合は 1 回だけ再実行し、それでも失敗する場合のみ異常と判断する

14. 停止時は O-S-C と mock-unity の両方を `Ctrl+C` で終了し、vendor に差分がないことを確認する:

   ```powershell
   git status --short -- vendor
   ```
