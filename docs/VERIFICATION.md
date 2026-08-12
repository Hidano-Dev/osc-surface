# VERIFICATION.md — 手動検証手順

各 Phase の完了時に、その Phase の動作確認手順を追記する。コマンドはリポジトリ root で実行する(PowerShell 想定)。

## O-S-C を使わない構成 — 移行後の手動検証

O-S-C を起動せず、ブリッジと NiceGUI UI だけで Unity を操作する構成の確認手順。検証端末と Unity (または同じプロトコルを実装した mock-unity) は信頼できる同一 LAN に置く。認証はないため、インターネットへ公開しない。

### セットアップ

1. リポジトリ root で `setup-oscdesk.bat` をダブルクリックするか、PowerShell で次を実行する。既にセットアップ済みなら、依存関係とビルドが最新であることを確認する。

   ```powershell
   .\setup-oscdesk.ps1
   ```

2. セットアップが完了し、`packages/bridge/dist/oscdesk-bridge.js` と `packages/nicegui-ui/.venv/Scripts/python.exe` が存在することを確認する。Unity を使う場合は `OscSurface/` を Unity Editor で開き、`Assets/OscSurfaceBridge/OscSurfaceBridge.unity` を Play Mode にする。mock-unity で代替する場合は次を実行する。

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/default.json
   ```

### 起動と LAN 端末からの接続

1. Unity または mock-unity が待ち受けている状態で、リポジトリ root から通常起動する。

   ```powershell
   .\start-oscdesk.ps1
   ```

   または `start-oscdesk.bat` をダブルクリックする。これはブリッジと NiceGUI UI を起動し、`接続先 URL:` の下に LAN 用 URL を表示する。O-S-C のプロセスやブラウザ用の O-S-C URL は使用しない。

2. 同じ LAN に接続した別の PC またはスマートフォンで、起動ウィンドウに表示された `http://<この PC の LAN IP>:8080` を開く。画面が表示され、ヘッダーに `ブリッジ: 接続済み`、マニフェストに `採用済み`、ウィジェット群が表示されることを確認する。LAN IP が複数表示された場合は、検証端末と同じネットワークのアドレスを選ぶ。

3. 画面を数秒表示したままにし、ヘッダーの `Unity: 接続中 (… ms, 連続喪失 0 回)` (または同等の RTT 表示) を確認する。これが `Unity 未接続` のままなら、Unity の送信先・ブリッジの UDP 受信ポート 7091・Windows ファイアウォールを確認する。

### ping/pong、接続状態、エコーバック

1. `Unity: 接続中` と RTT の数値が表示されている状態で、Unity または mock-unity 側のログとブリッジのログを確認する。ブリッジから `/sys/ping` が送られ、Unity から `/sys/pong` が返り、画面の RTT・連続喪失回数が更新されることを確認する。Unity を一時停止して約 5 秒待つと `Unity 未接続` になり、再開すると `Unity 接続中` に戻ることも確認する。

2. 画面のスライダー、トグル、ボタンを操作する。操作値が Unity に届き、Unity から同じ値がエコーバックされた後に表示値が確定することを確認する。スライダーを保持中に別のエコーバックが来た場合は表示が飛ばず、指を離した後にエコーバック値へ揃うことも確認する。

3. ブラウザ描画の目視確認として、別の LAN 端末のブラウザでも同じ URL を開く。ヘッダーの接続状態、マニフェスト由来のラベル、グループ、スライダー・トグル・ボタン・表示専用値が崩れずに描画され、片方の端末で操作したエコーバック値がもう片方にも反映されることを確認する。これが O-S-C 移行後に残すブラウザ描画確認である。

### 誤接続ガード

1. 正常な値を確認した後、Unity または mock-unity を停止する。mock-unity を使う場合は `wrong-project.json` で起動する。

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/wrong-project.json
   ```

2. ブラウザを再読み込みする。`projectId` が `expectedProjectId` (`oscdesk-demo`) と一致しないマニフェストは採用されず、既に表示されているウィジェットと値が差し替わらないことを確認する。画面のマニフェスト欄に `誤接続の疑い` または `projectId 不一致` が表示されることも確認する。

### ログと標準出力の観測場所

- NDJSON はリポジトリ root の `logs/diagnostics/` に出力される。通常の診断ログは `oscdesk-*.ndjson`、誤接続の拒否は `oscdesk-guard-*.ndjson` で、1 行が 1 JSON である。正常接続では `ping`/`pong` と値の送受信、ガード確認では `kind: "guard-reject"`、`expectedProjectId`、`receivedProjectId` を見る。確認には次を使う。

  ```powershell
  Get-ChildItem logs/diagnostics
  Get-Content (Get-ChildItem logs/diagnostics/*.ndjson | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -TotalCount 20
  Get-Content (Get-ChildItem logs/diagnostics/oscdesk-guard-*.ndjson | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -TotalCount 20
  ```

- ブリッジの標準出力は `OSCDESK_BRIDGE_READY {...}`、起動エラー、`(ERROR, CUSTOM MODULE) Manifest project mismatch: ...` などのブリッジ側観測値を見る場所である。`start-oscdesk.ps1` はブリッジを非表示で起動して標準出力を一時ファイルへリダイレクトし、終了時に削除するため、実行中に標準出力を観測する場合は別ターミナルで次を実行する（UI は通常どおり起動し、同じブリッジへ接続する）。

  ```powershell
  node packages/bridge/dist/oscdesk-bridge.js
  ```

  `start-oscdesk.ps1` を同時に実行して二重起動しない。標準出力と NDJSON は別物であり、ブラウザの接続状態は UI がブリッジから受け取った表示、NDJSON は root の `logs/diagnostics/` にある記録として突き合わせる。

### 完了条件

この手順を上から実施し、LAN 端末からの描画、ブリッジ接続、Unity の ping/pong と接続状態、値のエコーバック、誤接続マニフェストの拒否、ならびに対応する NDJSON とブリッジ標準出力を確認できれば、O-S-C を使わない移行後構成の主要機能を手動で確認できたものとする。
