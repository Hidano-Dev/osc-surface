# Research & Design Decisions — phase2-manifest-driven-ui

## Summary

- **Feature**: `phase2-manifest-driven-ui`
- **Discovery Scope**: Extension(Phase 1 基盤の拡張。ただし O-S-C リモートコマンドの実行モデルが設計を左右するため、vendor v1.30.4 ソースの直接検証まで実施)
- **Key Findings**:
  - `/EDIT`・`/EDIT/GET`・`/GET` は **O-S-C サーバではなくブラウザクライアント内で実行される**。ウィジェット状態は接続クライアントごとに存在するため、custom module はクライアント接続(`sessionOpened`)ごとにマニフェストを再適用する必要がある
  - ウィジェットを 1 個ずつ追加するリモートコマンドは存在しない。動的生成は専用コンテナパネルへの `/EDIT` で `widgets` 配列を丸ごと差し替える宣言的全再生成が唯一かつ最善の経路(削除要件 2.5 が自然に成立する)
  - 現在値同期は custom module の `receive()` → クライアント側 `setValue({send:false, sync:true})` で実現でき、フィードバックループが構造的に発生しない。`/SET` は Unity への送信を伴うため custom module からは使用禁止
  - `sessionOpened` はクライアントの `parser.parse()` 完了後に送信されるため、このイベント時点でウィジェットツリーは構築済み(タイミング問題は発生しない — ソースで確定)

## Research Log

### O-S-C リモートコマンドの実行場所とクライアントごとの状態

- **Context**: マニフェスト → `/EDIT` 変換をどこで・いつ実行するかの前提確認
- **Sources Consulted**: `vendor/open-stage-control/src/client/remote-control.mjs`、`src/client/osc.mjs`、`src/server/node/osc/index.mjs`、`src/server/node/ipc/server.mjs`、`src/server/node/ipc/callbacks.mjs`
- **Findings**:
  - `remote-control.mjs` の `/EDIT` / `/EDIT/GET` / `/GET` / `/SET` はすべて **クライアント(ブラウザ)側モジュール**。サーバは受信 OSC を `ipcServer.send('receiveOsc', ...)` で各クライアントへ中継するだけ(`osc/index.mjs:147-161`)
  - custom module の `receive(host, port, address, ...args)` は `cm: 1` フラグ付きで `receiveOsc` に流れる(`osc/index.mjs:37-57`)。`host` が `/` 始まりなら host/port を省略でき、末尾に `{clientId}` オブジェクトを付けると **特定クライアントのみに配信**できる
  - `cm: 1` は READ_ONLY 起動時でも `/EDIT` を許可するフラグ(`remote-control.mjs:14`)。custom module 経由の `/EDIT` は read-only 運用とも両立する
  - クライアント接続イベントは `ipc/server.mjs:41-48` により **ipc コールバック名がそのまま custom module の `app` EventEmitter に転送**される(`app.on('open'|'close'|'sessionOpened'|..., (data, client) => ...)`、`client = {address, id}`)
- **Implications**: custom module は (a) 採用済みマニフェストを保持し、(b) `sessionOpened` 受信ごとに当該 `clientId` へ適用、(c) 新マニフェスト採用時は全クライアントへブロードキャスト適用する二経路が必要。ウィジェット状態のアサーションは接続中クライアントが 1 個存在しないと成立しない(E2E で Playwright がクライアントを 1 個保持する根拠)

### `sessionOpened` とウィジェットツリー準備完了のタイミング

- **Context**: `sessionOpened` 時点で `/EDIT` が空振りしないか(gap 分析の残課題)
- **Sources Consulted**: `src/client/managers/session/index.mjs:40-99, 166-173`
- **Findings**: クライアントは `sessionOpen` 受信 → `load()` 内で `parser.parse()` によりウィジェットツリーを同期構築 → 25ms 後のコールバックで `ipc.send('sessionOpened', ...)` を送信する。つまり **`sessionOpened` がサーバ(= custom module の `app` イベント)に届いた時点でウィジェットツリーは構築済み**
- **Implications**: `sessionOpened` を適用トリガにすれば追加の待機・リトライは不要。設計から「widget-tree readiness 検証」の不確実性を除去できる(E2E では念のため `/EDIT/GET` ポーリングで観測的にも担保)

### 動的ウィジェット生成の実現方式

- **Context**: 要件 2.3-2.5(生成・更新・削除)を本体無改造で実現する経路の選定
- **Sources Consulted**: `remote-control.mjs:12-43`(`/EDIT`)、`src/server/node/ipc/callbacks.mjs`(`addWidget` は editor 内部イベントであり外部コマンドではない)、`src/client/parser.mjs:95-111`
- **Findings**:
  - 単一ウィジェット追加の外部コマンドは存在しない。`/EDIT` は既存 id のプロパティ差し替えのみ(id 不在なら何もしない)
  - `/EDIT` で `widgets` プロパティを渡すと `updateWidget(..., {reuseChildren: false})` となり、コンテナ配下が **全再パース**される(`remote-control.mjs:33`)— 子の追加・変更・削除がひとつの操作で宣言的に完結する
  - `parser.mjs:98-108`: 生成時に `value` プロパティがなく `default` プロパティがあれば `setValue(default, {defaultInit: true})` が実行され、**OSC 送信は発生しない**(`send` オプションなし)
- **Implications**: レイアウトに専用コンテナパネル(id `dynamic`)を置き、マニフェスト採用ごとに `widgets` 配列を丸ごと構築し直す方式を採用。生成ウィジェットの初期値は `default` プロパティで安全に与えられ、更新時の現在値は `receive()` 同期で上書きする。手動配置ウィジェットは `dynamic` コンテナ外にあるため構造的に無傷(2.5)

### 現在値同期とフィードバックループ・ドラッグ中挙動

- **Context**: 要件 3.1-3.4 の実現手段確認
- **Sources Consulted**: `src/client/osc.mjs:69-87`、`src/client/widgets/sliders/slider.mjs:226-234`、`remote-control.mjs:159-189`(`/SET`)
- **Findings**:
  - サーバ(custom module)からの `receive()` はクライアントで `widgets[i].setValue(restArgs, {send:false, sync:true, ...})` を実行(`osc.mjs:80`)— 表示更新のみで Unity への送信なし
  - `/SET` は `setValue(value, {sync:true, send:true})` で **Unity への送信を伴う**。custom module の値同期には使用禁止。ただしテストが「UI 操作の代替」として使う分には、ユーザー操作と同一の経路(送信 → エコーバック確定)を通るため適切
  - slider 系はドラッグ中(`this.touched`)の外部 `setValue` をキューに退避し、操作終了後に反映する(`slider.mjs:229-234`)— 要件 3.4 は vendor 挙動で成立
- **Implications**: 値同期はエントリの `address` 宛の `receive()` に一本化する(既存・動的生成の両ウィジェットに同一経路で作用し、実装が単純になる)。非 slider 系(button 等)の touched 挙動は離散値でドラッグ概念が薄く実害が想定されないが、実装時の手動確認項目として VERIFICATION.md に含める

### `/EDIT/GET`・`/GET` によるウィジェット状態の OSC 検証

- **Context**: E2E で DOM 検査なしにウィジェット状態を検証する方式(ユーザー承認済み方針)の裏取り
- **Sources Consulted**: `remote-control.mjs:88-157`
- **Findings**:
  - `/EDIT/GET (s target, s idOrAddress)`: `target`(`host:port`)宛に `/EDIT/GET (s idOrAddress, s propsJson)` を返信する。`idOrAddress` が `/` 始まりならアドレス検索、それ以外は id 検索
  - `/GET (s target, s idOrAddress)`: ウィジェットの現在値を `/GET (s idOrAddress, 値...)` として `target` へ返信
  - テストクライアント → O-S-C(9001)への `/EDIT/GET` 送信は custom module の `oscInFilter` を通過(`/sys/*`・`/surface/*` 以外は素通し)し、全クライアントで実行される。**接続クライアントが 1 個なら応答はちょうど 1 個**
- **Implications**: `widget-inspector.ts`(テストヘルパ)は既存 `OscTestClient` の上に `/EDIT/GET`・`/GET`・`/SET` を包む。返信 `target` はテストクライアントの bind ポートを明示指定する(返信先を送信元とみなさない互換性ノートの規律とも一致)

### Playwright によるヘッドレスブラウザクライアント保持

- **Context**: E2E 中に O-S-C クライアントを 1 個接続状態で保持する手段(ユーザー承認済み方針)
- **Sources Consulted**: WebSearch(npm)— [playwright - npm](https://www.npmjs.com/package/playwright)
- **Findings**:
  - Playwright 最新安定版は **1.61 系**(2026-07 時点)。`chromium.launch({headless: true})` + `page.goto('http://127.0.0.1:7080')` で O-S-C クライアントを保持できる
  - ブラウザバイナリは別途 `playwright install chromium` が必要(初回 ~150MB)。CI・新規環境ではセットアップ手順に含める必要がある
  - Windows でのプロセス後始末は `browser.close()` が Playwright 側で管理する(既存 ProcessHarness の taskkill 系は不要)。テスト側は afterAll + try/finally の二重防御を踏襲
- **Implications**: root devDependency に `playwright` を追加。「接続完了」の判定は DOM ではなく `/EDIT/GET` ポーリング(root ウィジェットへの応答)で行い、検証手段を OSC に一本化する。`corepack pnpm test` の前提としてブラウザインストール手順を CLAUDE.md / VERIFICATION.md に明記する

### マニフェスト JSON サイズと UDP データグラム制限

- **Context**: 要件 6.5(OSC 1.0 だけでは決まらない仕様点の記録)
- **Sources Consulted**: OSC 1.0 仕様(パケット = 単一データグラム)、UDP/IPv4 の理論最大 65,507 バイト
- **Findings**:
  - `/sys/manifest` は string 1 引数の単一 OSC メッセージ = 単一 UDP データグラムで運ぶ。OSC 1.0 にはメッセージ分割の標準機構がない
  - 1 エントリ ≈ 100-150 バイト(JSON)。100 エントリでも ~15KB で理論上限内だが、MTU(~1500B)超過分は IP フラグメンテーションに依存する。ロスの多い Wi-Fi 環境では到達率が下がり得る
- **Implications**: プロトコル仕様としては「単一データグラムに収まること(実用上限 ~60KB、フラグメント回避推奨 ~1.4KB)」を UNITY_PROTOCOL.md 互換性ノートへ記録(7.3, 6.5)。再送は Phase 2 の無制限リトライが自然な回復手段になる

### E2E ポート戦略と実行直列性

- **Context**: Playwright 追加後もポート衝突なく `corepack pnpm test` を完走させる
- **Findings**: 既存 E2E は固定ポート(mock-unity 9000 / O-S-C OSC 9001 / HTTP 7080)+ vitest `singleFork` による直列実行で衝突を回避している。Phase 2 のスペックも同一プロジェクト(`e2e`)に追加すれば直列性は維持される
- **Implications**: 固定ポート + 直列実行を継続(新たなポート割り当て機構は導入しない)。マニフェスト E2E はブラウザ起動・mock 再起動を含むためタイムアウトを緩める(スペック単位で 120s)

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 全部 module-runtime 内に実装 | 既存 runtime に手続きを追記 | ファイル数最小 | 純粋ロジック分離(2.8)が崩れ単体テスト不能 | 却下 |
| B: クライアント側 custom widget script | O-S-C の script プロパティで動的挙動 | サーバ側変更最小 | 案件差分がレイアウト内コードになり規律違反、検証困難 | 却下 |
| C: 純粋ロジック分離 + runtime 配線(採用) | `manifest-client` / `layout-index` / `manifest-apply` を純粋モジュール化し、runtime は配線のみ | Phase 1 の DI パターン踏襲、2.8/2.9 を構造で担保 | ファイル数増 | Phase 1 の PingMonitor / ConfigLoader と同型 |

## Design Decisions

### Decision: 動的生成は専用コンテナへの `/EDIT` による宣言的全再生成

- **Context**: 要件 2.3-2.5(生成・再受信時の更新・消滅エントリの削除・手動配置の保護)
- **Alternatives Considered**:
  1. ウィジェット単位の追加/削除コマンド — 存在しない(本体改造が必要になり規律違反)
  2. root への `/EDIT` — 手動配置ウィジェットを巻き込むリスク
  3. 専用コンテナパネル(id `dynamic`)の `widgets` 配列丸ごと差し替え — 採用
- **Selected Approach**: レイアウトに空のパネル `dynamic` をデータとして定義。マニフェスト採用ごとに `manifest-apply` が group ごとの子パネル + ウィジェット群を構築し、`/EDIT dynamic {widgets: [...]}` 1 コマンドで全再生成する
- **Rationale**: 差分計算が不要で削除(2.5)が自然に成立。手動配置はコンテナ外なので構造的に保護される。`reuseChildren: false` の全再パースは vendor が保証する経路
- **Trade-offs**: 再受信のたびに動的ウィジェットの値がリセットされる → 直後の `receive()` 値同期でマニフェストの現在値に揃える(Unity が真実の源の規律とも整合)
- **Follow-up**: 大量エントリ時の `/EDIT` JSON サイズ(server→client は WebSocket なので UDP 制限は非該当)と再パース時間を実装時に確認

### Decision: マニフェスト適用は「クライアント接続ごと」+「採用時ブロードキャスト」の二経路

- **Context**: ウィジェット状態がクライアントごとに存在する(research 確定事項)
- **Selected Approach**: runtime が採用済みマニフェストを保持し、(a) `app.on('sessionOpened')` で当該 `clientId` のみに適用、(b) 新マニフェスト採用時は clientId 指定なしの `receive()` で全クライアントへ適用
- **Rationale**: `sessionOpened` はウィジェットツリー構築完了後に届くことをソースで確認済み。後から接続したクライアントも最新マニフェストで初期化される
- **Trade-offs**: クライアント 0 接続時の採用は表示に反映されない(保持したマニフェストが次の接続時に適用されるので問題なし)

### Decision: 値同期は `receive()` のみ・`/SET` は custom module から使用禁止

- **Context**: 要件 3.2(フィードバックループ禁止)
- **Selected Approach**: 現在値はエントリ `address` 宛の `receive()`(→ `setValue({send:false, sync:true})`)。動的生成ウィジェットの初期値は `default` プロパティ(送信なしで初期化されることをソース確認済み)+ 念のため同じ `receive()` 同期も通す
- **Rationale**: `/SET` は `send:true` で Unity へ送信してしまう。`receive()` は表示更新専用経路として vendor が保証
- **Trade-offs**: なし(テストコードに限り `/SET` を「UI 操作の代替」として使用する — ユーザー操作と同一経路のため要件 5.3 の検証手段として適切)

### Decision: マニフェスト再送は無制限・回復時再要求(ユーザー承認済み)

- **Context**: 要件 1.2, 1.3。承認済み決定「応答があるまで無制限リトライ + ping/pong 回復時の再要求」
- **Selected Approach**: 再送は既存の 2 秒 ping tick に相乗りする単一スケジューラで駆動(タイマー追加なし)。「応答があるまで」は **スキーマ検証を通過したマニフェストを採用するまで** と解釈する(不正応答はハンドシェイク未完了として再送継続)。回復判定は PingMonitor に「喪失状態(consecutiveLosses ≥ 1)から pong 採用で復帰した」遷移通知を追加して得る
- **Rationale: 不正応答で停止すると 1.5(稼働継続)後に最新マニフェストを得る手段がなくなる。2 秒間隔なら再送コストは無視できる
- **Trade-offs**: 恒常的に不正な応答を返す相手にはログが 2 秒ごとに出る → 同一原因の連続ログは抑制(状態遷移時のみ出力)する
- **Follow-up**: 採用済みマニフェスト保持中の回復時再要求で、同一内容が返った場合の再適用(冪等なので許容)をテストで確認

### Decision: mock-unity のシナリオはデータファイル + CLI 上書きで表現(ユーザー承認済み)

- **Context**: 要件 4.3-4.5, 4.7。「案件差分はデータ」の規律
- **Selected Approach**: シナリオ JSON(エントリ雛形・`{characterName}` プレースホルダ・キャラ名生成規則・不正応答の raw 上書き)を `--scenario <path>` で読み込む。`--character-name <name>` で固定上書き可能。READY 行 JSON に `characterName` を含めテストへ公開
- **Rationale**: 不正マニフェストケースも「不正な応答文字列を持つシナリオデータ」で表現でき、コード分岐が増えない(4.5)
- **Trade-offs**: シナリオスキーマという mock 専用契約が増える → mock-unity パッケージ内に閉じ、`/sys/*` 契約(shared)とは分離する

### Decision: E2E は Playwright 保持クライアント + OSC リモートコマンド検証(ユーザー承認済み)

- **Context**: 要件 5.1-5.5。headless E2E でウィジェット状態を検証する手段
- **Selected Approach**: Playwright(chromium headless)で O-S-C クライアントを 1 個だけ接続保持し、状態検証は `/EDIT/GET`・`/GET`、操作注入は `/SET` で行う(DOM 検査なし)
- **Rationale**: 検証面が OSC に一本化され、O-S-C の内部 DOM 構造への依存(壊れやすい)を持たない。接続 1 個なら応答の多重化も起きない
- **Trade-offs**: ブラウザバイナリのインストールが `corepack pnpm test` の前提になる → セットアップ手順をドキュメント化
- **Follow-up**: CI 想定環境での `playwright install chromium` 所要時間・キャッシュ方針

## Risks & Mitigations

- `/EDIT` 適用失敗がサーバ側から見えない(クライアント内で完結) — E2E の `/EDIT/GET` ポーリング検証で実状態を確認。タイムアウト時は子プロセスログ + ブラウザ console ログを出力
- 再接続・再受信のタイミング競合(適用中の新マニフェスト採用) — 適用はコマンド列の同期送信のみで完結し、Node 単一スレッドで順序が直列化されるため競合しない
- 不正マニフェスト再送ループのログ洪水 — 状態遷移時のみログ出力(同一エラーの連続は抑制)
- Playwright 未インストール環境でのテスト失敗 — 失敗メッセージにインストールコマンドを含める。VERIFICATION.md / CLAUDE.md に前提を明記
- mock-unity 再起動テストの flakiness(回復検出 + 再要求 + 適用の多段待ち) — 固定 sleep でなく述語ポーリング(`waitForProps`)+ スペック単位の余裕あるタイムアウト(120s)
- 大きなマニフェストの UDP 到達性 — 互換性ノートにサイズ上限指針を記録。無制限再送が回復手段

## References

- [Open Stage Control — Remote control docs](https://openstagecontrol.ammd.net/docs/remote-control/) — /EDIT・/GET 等の公式仕様(vendor v1.30.4 ソースと突き合わせ済み)
- [playwright - npm](https://www.npmjs.com/package/playwright) — v1.61 系(2026-07 時点の安定版)
- `vendor/open-stage-control/src/client/remote-control.mjs` / `src/client/osc.mjs` / `src/client/parser.mjs` / `src/client/managers/session/index.mjs` / `src/server/node/osc/index.mjs` / `src/server/node/ipc/server.mjs` — 本設計の根拠となる一次ソース(v1.30.4)
- `.kiro/specs/phase1-protocol-foundation/design.md` — 踏襲する DI・純粋ロジック分離パターン
