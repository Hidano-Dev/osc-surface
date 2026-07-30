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
- `config/surface.config.json` の既定値は `unity.sendPort = 7090`、`unity.receivePort = 7091`

### 確認手順

1. mock-unity を起動する:

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091
   ```

2. `MOCK_UNITY_READY {"listenPort":7090}` が表示されることを確認する
3. 別ターミナルで O-S-C headless を起動する:

   ```powershell
   node vendor/open-stage-control/app -n -p 7080 -o 7091 -s 127.0.0.1:7090 -l layouts/main.json -c packages/custom-module/dist/osc-surface.js
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
   Get-NetTCPConnection -LocalPort 7080,7090,7091 -ErrorAction SilentlyContinue |
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
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/default.json
   ```

2. READY 行 `MOCK_UNITY_READY {"listenPort":7090,"scenarioPath":"...","characterName":"..."}` に起動ごとのキャラ名が出ることを確認する(以降の手順でラベル表示と突き合わせる)
3. 別ターミナルで O-S-C headless を起動する:

   ```powershell
   node vendor/open-stage-control/app -n -p 7080 -o 7091 -s 127.0.0.1:7090 -l layouts/main.json -c packages/custom-module/dist/osc-surface.js
   ```

   **`-s`(既定送信ターゲット)の指定は必須**で、`config/surface.config.json` の宛先(`unity.host:unity.sendPort` = `127.0.0.1:7090`)と一致させること。動的生成ウィジェットは `target` プロパティを持たずサーバ既定ターゲット(`-s`)へ送信するため、これがずれると動的ウィジェットの操作だけが mock-unity(Unity)へ届かなくなる

4. 開発用ブラウザで `http://127.0.0.1:7080` を開き、マニフェスト適用を確認する:
   - 既存ウィジェットのラベルにキャラ名が反映されている(Smile フェーダーのラベルが `<キャラ名> Smile` になる)
   - `Generated Widgets`(`dynamic`)パネル配下に、レイアウトにない索引外エントリ(`Greeting` / `Wave`)の動的ウィジェットが group 見出し(`Profile` / `Motion`)付きで生成されている
   - 各ウィジェットがシナリオの現在値(`default`)で初期表示されている(値同期。Character Name / Greeting にキャラ名が入る)
5. 動的ウィジェット(例: `Wave` ボタン)を操作し、mock-unity のエコーバックで表示が確定することを確認する(手動配置ウィジェットと同一の送信・エコーバック規律)
6. mock-unity を `Ctrl+C` で停止し、**5 秒程度待って喪失を検出させてから**(2 秒間隔 ping の連続喪失 1 以上が回復検出の前提)キャラ名を固定して再起動する:

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/default.json --character-name 検証用キャラ
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
- `layouts/main.json` の Diagnostics モーダルは表示専用で、`古いログを削除` ボタン以外の診断表示は Unity への OSC 送信を行わない(ボタン押下も custom module が処理して破棄するため Unity へは届かない)

### 長時間デバッグ時の容量に関する運用注意

- NDJSON ログは起動ごとに新規ファイルを作成し、debug ON の間はすべての送受信を追記し続けるため、長時間の連続デバッグではログ使用量が増え続ける
- 合計サイズが閾値(`diagnostics.ndjsonMaxTotalBytes`、既定 50 MB)を超えると、ブラウザへのトースト通知が 1 回とパネルの `警告:` 表示が出る。診断パネルの `古いログを削除` ボタンで古いログから整理するか、O-S-C 停止後に出力先(`diagnostics.ndjsonDir`、既定 `logs/diagnostics`)の不要ファイルを手動削除する
- 数時間以上のデバッグを予定する場合は、事前に config で `ndjsonMaxTotalBytes` を運用に合わせて引き上げるか、ディスク残量に注意して定期的にログを整理する

### 確認手順

1. 既存ログを消して観測を開始しやすくする:

   ```powershell
   Remove-Item logs/diagnostics -Recurse -Force -ErrorAction SilentlyContinue
   ```

2. mock-unity を標準シナリオで起動する:

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/default.json
   ```

3. 別ターミナルで debug ON の O-S-C headless を起動する(`OSC_SURFACE_CONFIG` は絶対パスで指定する。相対パスは custom module のディレクトリ基準で解決され読み込みに失敗する):

   ```powershell
   $env:OSC_SURFACE_CONFIG="$PWD\config\surface.debug.config.json"
   node vendor/open-stage-control/app -n -p 7080 -o 7091 -s 127.0.0.1:7090 -l layouts/main.json -c packages/custom-module/dist/osc-surface.js
   Remove-Item Env:OSC_SURFACE_CONFIG
   ```

4. O-S-C 側ログに `Diagnostics debug mode enabled.` が出ることを確認し、ブラウザで `http://127.0.0.1:7080` を開いて `Diagnostics` モーダルを表示する
5. 数秒待ち、診断パネルに次が出ることを確認する:
   - 到達性が `到達`
   - RTT に数値(ms)が出る
   - 損失率が `0% (0/N)` の形式で出る(N は観測数。ping の観測が始まる前は `-`)
   - サブネット判定が `同一ホスト` または `同一サブネット`
   - ログ使用量にサイズ表示が出る
   - 最新メッセージに `/sys/ping` と `/sys/pong` を含む送受信履歴が出る
6. `Smile` フェーダーまたは動的生成ウィジェットを操作し、診断パネルの最新メッセージに対応する OSC 送受信が追記されることを確認する
7. `logs/diagnostics` 配下に `osc-debug-*.ndjson` が生成され、1 行 1 JSON の NDJSON であることを確認する:

   ```powershell
   Get-ChildItem logs/diagnostics
   Get-Content (Get-ChildItem logs/diagnostics/osc-debug-*.ndjson | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -TotalCount 5
   ```

8. 診断パネルの `古いログを削除` ボタンを押し、古い NDJSON が削除されてログ使用量表示が減ることを確認する
9. mock-unity を `Ctrl+C` で停止し、5 秒程度待って診断パネルの到達性が `喪失` に変わることを確認する。必要なら最新メッセージに ping 継続と pong 欠落が反映されることも確認する
10. mock-unity を再起動し、到達性が `到達` に戻ることを確認する
11. debug OFF の抑止を確認するため、O-S-C を停止してから既定 config で起動し直す:

   ```powershell
   node vendor/open-stage-control/app -n -p 7080 -o 7091 -s 127.0.0.1:7090 -l layouts/main.json -c packages/custom-module/dist/osc-surface.js
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

## Phase 4 — 実 Unity 接続手順書

### 前提

```powershell
# shared / custom-module / mock-unity のビルド
corepack pnpm -r --if-present run build
```

- ブラウザ確認には常用ブラウザではなく、開発用の軽量ブラウザを使う
- 実機疎通の確認には `OscSurface/` を Unity Editor(`ProjectVersion.txt` のバージョン)で開けること。初回は uOSC(`com.hecomi.uosc@2.2.0`)のパッケージ解決が走る
- ポートは既定構成(Unity 待受 7090 / Surface 受信 7091)を使うため、mock-unity と実 Unity を同時に動かさない(待受 7090 が競合する)

### 手順書の追試(mock-unity を実 Unity に見立てる)

1. `docs/UNITY_PROTOCOL.md` §5 の接続手順を、mock-unity を「実 Unity」に読み替えて上から実行できることを確認する:
   - Unity 側アプリの起動に相当: Phase 2 と同じコマンドで mock-unity を標準シナリオ起動する

     ```powershell
     node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/default.json
     ```

   - O-S-C headless は §5.1 記載の debug ON コマンドで起動する
   - §5.2 の ①(到達性)→ ②(マニフェスト採用)→ ③(エコーバック確定)→ ④(stats。ワンライナーで要求を送り、診断パネルの最新メッセージに `/sys/stats` の受信が出る)を順に確認する
2. 手順に欠落・誤りを見つけた場合は §5 を修正してから先へ進む(手順書のセルフテスト)

### 実機疎通(Unity Editor Play Mode)

1. `OscSurface/` を Unity Editor で開き、uOSC の解決とコンパイル成功を確認する(uloop 導入環境では `uloop compile` で確認できる)
2. mock-unity が動いていれば停止し、`Assets/OscSurfaceBridge/OscSurfaceBridge.unity` シーンを開いて Play Mode に入る
3. O-S-C headless を §5.1 記載の debug ON コマンドで起動し、開発用ブラウザで `http://127.0.0.1:7080` を開く
4. §5.2 を実 Unity で追試する:
   - ① 診断パネルの到達性が「到達」になり RTT に数値が出る
   - ② マニフェスト採用: ラベルに `UnityBridge`(`OscSurfaceBridge` の characterName)が反映され、動的ウィジェット(`Greeting` / `Wave`)が生成される
   - ③ ウィジェット操作がエコーバックで確定する
   - ④ ワンライナーで `/sys/stats/request` を送り、診断パネルまたは NDJSON で `/sys/stats` 応答(received / parseErrors / lastReceivedAt)を確認する
5. NDJSON ログ(`logs/diagnostics/osc-debug-*.ndjson`)で、エコーバックの受信引数型が `i` / `f` / `s` であることを確認する
6. Editor の Pause で到達性が「喪失」に変わり、Play 再開で「到達」へ戻ることを確認する(§5.3 の正常挙動の追試)

### 回帰・無変更確認

```powershell
corepack pnpm test
git status --short -- vendor packages
```

- `corepack pnpm test` が緑であること(`process-harness ready-timeout` の E2E だけが失敗した場合は 1 回だけ再実行し、それでも失敗する場合のみ異常と判断する)
- `vendor/open-stage-control` と `packages/` に差分がないこと。作業ツリーの差分が docs・`.kiro/`・`OscSurface/` の最小変更(`Packages/manifest.json`・`Assets/OscSurfaceBridge/` 一式と対応 `.meta`)のみであること

### レビュー観点(本文の uOSC 非依存)

```powershell
Select-String -Path docs/UNITY_PROTOCOL.md -Pattern 'uOSC'
```

- 該当行がすべて「付録 A」または「互換性ノート」の節内にあること(本文 §1〜§6 に uOSC への言及がないこと)
- `docs/UNITY_PROTOCOL.md` 付録 A.2 のコードブロックと `OscSurface/Assets/OscSurfaceBridge/OscSurfaceBridge.cs` の内容が一致していること(コードブロックを抽出して diff、または目視で突き合わせる)
- 「暫定版」「Phase 4 で執筆/追記」等の未完了表記が UNITY_PROTOCOL.md に残っていないこと

## Phase 5 — マニフェスト資産化と誤接続ガード

### 前提

- `OscSurface/` を Unity Editor で開き、`Assets/OscSurfaceBridge/OscSurfaceBridge.unity` を対象シーンにする
- `corepack pnpm -r --if-present run build` を実行して、shared・custom-module・mock-unity のビルド成果物を最新にする
- `logs/diagnostics` に残った過去のログを確認対象に混ぜないよう、必要に応じて退避または削除する
- Unity と mock-unity は同じポートを使用するため、同時に起動しない

### 識別子一致時の採用確認

1. 既定の `expectedProjectId` (`osc-surface-demo`) を含む `config/surface.config.json` を使用する。
2. 別ターミナルで mock-unity を起動する。

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/default.json
   ```

3. O-S-C headless を起動する。

   ```powershell
   node vendor/open-stage-control/app -n -p 7080 -o 7091 -s 127.0.0.1:7090 -l layouts/main.json -c packages/custom-module/dist/osc-surface.js
   ```

4. `http://127.0.0.1:7080` を開き、mock-unity の `projectId` と `expectedProjectId` が一致したとき、受信マニフェストが採用されることを確認する。`UnityBridge` のラベルと `Greeting` / `Wave` などのマニフェスト由来ウィジェットが生成され、既存の UI が正しく更新されることを確認する。
5. 生成された UI を操作し、従来どおりエコーバックによる値同期が行われることを確認する。診断パネルと `logs/diagnostics` の NDJSON に、マニフェスト採用を妨げる拒否記録がないことも確認する。

### 識別子不一致時の拒否確認

1. O-S-C を停止し、既定 config の `expectedProjectId` (`osc-surface-demo`) が有効な状態にする。
2. mock-unity を `packages/mock-unity/scenarios/wrong-project.json` で起動する。

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/wrong-project.json
   ```

3. O-S-C を再起動し、ブラウザを再読み込みする。`other-project` のマニフェストが受信されても採用されず、既に採用済みの UI が再生成・上書きされないことを確認する。
4. 診断パネルの「誤接続ガード」に、識別子不一致による拒否が表示されることを確認する。`logs/diagnostics` に `osc-guard-*.ndjson` が生成され、各行が `kind: "guard-reject"` と不一致の識別子を含む JSON であることを確認する。

   ```powershell
   Get-ChildItem logs/diagnostics/osc-guard-*.ndjson
   Get-Content (Get-ChildItem logs/diagnostics/osc-guard-*.ndjson | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -TotalCount 5
   ```

### アセット未割当時の送信停止確認

1. Unity Editor で `OscSurfaceBridge` の `manifestAsset` 参照を一時的に外し、Play Mode に入る。
2. Unity 側ログにマニフェストアセット未割当のエラーが出ること、`/sys/manifest` の自発送信が行われないことを確認する。
3. `/sys/manifest/request` を受信しても同じエラーとなり、マニフェスト送信だけが停止することを確認する。ping/pong、stats、値のエコーバックなど他の通信は継続することを確認する。
4. 検証後、`manifestAsset` の参照を元に戻す。

### アセット編集・差し替えの反映確認

1. `OscSurface/Assets/OscSurfaceBridge/` の同梱マニフェストアセットを複製してバックアップし、アセットの `projectId`、ラベル、エントリ、または既定値を1つ変更する。
2. Unity Editor で変更を保存し、Play Mode を再起動する。送信されたマニフェスト JSON に変更後の値が反映され、変更前のハードコード定義が送信されないことを確認する。
3. 変更したアセットを別のマニフェストアセットへ差し替えて再起動し、差し替え先の `projectId` とエントリだけが送信されることを確認する。`expectedProjectId` と一致しない場合は、上記の不一致時と同じく UI が不変で拒否が記録されることを確認する。
4. バックアップから元のアセットを戻し、Unity シーンの参照を確認して保存する。

### 全体回帰と無変更確認

```powershell
corepack pnpm test
git status --short -- vendor/open-stage-control pnpm-lock.yaml
```

- `corepack pnpm test` の vitest 単体テストと Playwright E2E がすべて成功することを確認する。
- `tests/e2e/process-harness.e2e.test.ts > ProcessHarness > ready timeout時は出力を添えて失敗する` だけが失敗した場合は1回だけ再実行し、再実行でも失敗した場合に限って異常と判断する。
- `vendor/open-stage-control` と `pnpm-lock.yaml` に git 差分がないことを確認する。
- 検証用に変更したアセット、config、ログを元に戻し、最後に `git status --short` で意図した docs と `CLAUDE.md` 以外の変更がないことを確認する。
