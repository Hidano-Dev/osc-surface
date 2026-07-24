# Research & Design Decisions — phase3-diagnostics-debug

---
**Purpose**: Phase 3(診断パネルとデバッグモード)の設計に先立つ調査結果と設計判断の根拠を記録する。
---

## Summary

- **Feature**: `phase3-diagnostics-debug`
- **Discovery Scope**: Extension(既存 Phase 1/2 実装への拡張。light discovery を実施)
- **Key Findings**:
  - custom module の `send()` は vendor 内部で `sendOsc()` を直接呼び、**`oscOutFilter` を経由しない**(`vendor/open-stage-control/src/server/node/osc/index.mjs` L26-36)。送信記録は `oscOutFilter`(ウィジェット発の送信)と module 自身の `sendFn` 呼び出し箇所(ping / manifest request)の 2 点でフックする必要がある
  - O-S-C v1.30.4 には **fragment ウィジェット**があり、`file` プロパティは「セッションファイルからの相対パス(フォールバックで絶対パス)」で解決される(`src/client/widgets/containers/fragment.mjs`)。診断パネルの別ファイル化(要件 5.1/5.2)は fragment include で本体無改造のまま実現できる
  - 新規 npm 依存は不要。サブネット判定は `node:os.networkInterfaces()`、NDJSON 書き出しは `node:fs` で足り、custom module コンテキストでは `nativeRequire` 経由で取得できる(Phase 1 の `node:path` 取得と同一パターン)
  - `receive()` はサーバ→クライアントの表示専用経路であり `oscOutFilter` を通らない(D-010 の前提を vendor ソースで再確認)。診断パネルへの反映に使っても Unity への送信は発生しない

## Research Log

### custom module から送受信メッセージを漏れなく記録できるフック点はどこか

- **Context**: 要件 2.1(方向・時刻・アドレス・引数の記録)。ウィジェット発・module 発の両方の送信と、全受信を捕捉する必要がある
- **Sources Consulted**: `vendor/open-stage-control/src/server/node/osc/index.mjs`、`custom-module.mjs`、`resources/docs/docs/custom-module/custom-module.md`
- **Findings**:
  - 受信: UDP/TCP/MIDI とも `oscInFilter(data)` を必ず通る(`oscInHandler` L190)。ここで全受信を捕捉できる
  - ウィジェット発送信: クライアント→サーバ→`oscOutFilter`→`sendOsc` の経路(L267)。ここで捕捉できる
  - module 発送信(`send()` グローバル): `sendOsc` を直接呼ぶため `oscOutFilter` を**通らない**(L26-36)
  - `receive()` は `receiveOsc` を `cm: 1` フラグ付きで直接呼び、ワイヤ送信ではない
- **Implications**: 記録は「受信 = `oscInFilter` 先頭」「送信 = `oscOutFilter` + module-runtime の `sendFn` ラップ」の 3 点フック。`receive()` による診断パネル更新は記録対象外(ワイヤトラフィックではない)であり、記録の再帰も起きない

### 診断パネルの別ファイル化と合流手段(include vs タブ)

- **Context**: 要件 5.1/5.2。`layouts/main.json` を汚さず、別ファイルの診断パネルを合流させる
- **Sources Consulted**: `resources/docs/docs/widgets/fragments.md`、`src/client/widgets/containers/fragment.mjs`
- **Findings**:
  - fragment ウィジェットは fragment ファイル(セッションと同形式の JSON)を埋め込み、`file` はセッションファイル位置からの相対パスで解決される
  - fragment 内ウィジェットの `address` はクライアント側で通常どおり有効になり、`receive(address, value)` で表示更新できる
  - root を `tabs` 構造へ変換すると Phase 2 の `/EDIT dynamic` 対象を含む既存パネル配置の作り直しが必要になる
- **Implications**: include(fragment)方式を採用。`layouts/diagnostics.json` を fragment ファイルとして新設し、`main.json` には modal + fragment の参照ウィジェットのみ追加する(操作面を専有しない)。タブ方式は既存レイアウト構造の変更コストが大きく不採用

### サブネット静的判定に使える OS 情報と判定範囲

- **Context**: 要件 4.1-4.4。ネットワーク送信なしで宛先 IP の設定ミスを検出する
- **Sources Consulted**: Node.js `os.networkInterfaces()` API(既知仕様)、`config/surface.config.json`
- **Findings**:
  - `os.networkInterfaces()` は各インターフェースの `address` / `netmask` / `family`('IPv4'|'IPv6') / `internal` を返す。マスク AND 比較だけで同一サブネット判定が完結する
  - 現行 config の `unity.host` は文字列で、IPv4 リテラル以外(ホスト名・IPv6)も設定可能
  - DNS 解決は OS 情報との静的照合を超える(ネットワーク副作用があり得る)ため要件 4.4 の趣旨に反する
- **Implications**: 判定対象は IPv4 リテラルのみ。ループバック(127.0.0.0/8)と自インターフェース自身のアドレスは「同一ホスト」、ホスト名・IPv6 リテラルは「判定不能(理由付き)」の判定結果として明示する。判定は純関数 `evaluateSubnetVerdict(dest, interfaces)` とし、インターフェース情報は注入可能にして実ネットワーク非依存の単体テスト(要件 6.4)を成立させる

### デバッグ OFF 時のホットパスコストをどうゼロに近づけるか

- **Context**: 要件 1.2(OFF 時は診断専用処理を一切実行しない)
- **Sources Consulted**: `packages/custom-module/src/module-runtime.ts`(Phase 1/2 実装)
- **Findings**:
  - module-runtime は依存注入形式で、`oscInFilter` / `sendPing` / `sendFn` のフック点が既に一本化されている
  - 全レコード処理を 1 つの `DiagnosticsEngine` に閉じ込め、OFF 時は `null` を保持すれば、ホットパス上の追加コストは `if (diag !== null)` の null チェックのみになる(計測・整形・確保は一切走らない)
- **Implications**: `DiagnosticsEngine | null` 方式を採用。`sendFn` のラップも debug ON 時のみ行い、OFF 時は素の `sendFn` をそのまま使う

### mock-unity の故障注入手段

- **Context**: 要件 6.1(応答停止等で喪失・切断を再現)。D-012「案件差分はデータ」との整合
- **Sources Consulted**: `packages/mock-unity/src/{responder,index}.ts`、`tests/e2e/mock-unity-loopback.e2e.test.ts`、DESIGN.md D-011/D-012
- **Findings**:
  - Phase 2 E2E は「プロセス停止→再起動」で切断と回復を再現済み(D-011)。これは切断(全断)の再現としてそのまま使える
  - 「プロセスは生きているが応答しない」状態(部分喪失・無応答)は現状再現できない
  - responder の応答生成は `handlePacket` に集約されており、応答のフィルタで故障を表現できる
- **Implications**: CLI 起動フラグ `--fault <mode>`(`drop-pong` = pong のみ停止 / `silent` = 全応答停止・受信計数は継続)を追加する。故障状態はフラグ値というデータで表現され、コード分岐の追加はフィルタ 1 箇所に閉じる。実行中の動的トグル(stdin 制御チャネル)は、E2E がプロセス停止/フラグ付き起動の組み合わせで全ケースを再現できるため導入しない(複雑さ回避)

### 診断値の E2E 観測点

- **Context**: 要件 6.3/6.5(E2E で診断パネル表示を検証)。D-007(`/surface/*` 観測名前空間)・D-011(検証面を OSC に一本化)との整合
- **Sources Consulted**: `tests/e2e/helpers/widget-inspector.ts`、DESIGN.md D-007
- **Findings**:
  - widget-inspector は `/GET`(値)・`/EDIT/GET`(props)でアドレス指定の検証ができるため、診断ウィジェットの表示値は既存手段で検証可能
  - `/surface/status` と同型の JSON スナップショット観測点があると、間引きタイミングに依存しない確定的なアサーションができる
- **Implications**: パネル表示検証は widget-inspector(`/surface/diag/*` アドレスの値取得)で行い、加えて `/surface/diag/request` → `/surface/diag`(JSON スナップショット)を debug ON 時のみの観測点として追加する(D-007 の status 契約パターンの再利用)。OFF 時は既存の `/surface/*` 一括破棄に落ちるため追加コストなし

### E2E ハーネスの不足機能

- **Context**: 要件 6.5(TEST-NET 宛先の config で O-S-C を起動)には `OSC_SURFACE_CONFIG` 環境変数の指定が必要
- **Sources Consulted**: `tests/e2e/helpers/process.ts`
- **Findings**: `ProcessHarness.start()` の `SpawnSpec` に `env` オプションがなく、子プロセスへ環境変数を渡せない
- **Implications**: `SpawnSpec` に任意 `env`(`process.env` とマージ)を追加する。既存テストへの影響なし(省略時は従来挙動)

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| DiagnosticsEngine 集約 + null ゲート(採用) | 診断機能を単一ファサードに集約し、OFF 時は `null` | OFF 時コストが null チェックのみ。境界が明確で単体テスト容易 | フック点(3 箇所)の呼び忘れに注意 → traceability とテストで担保 | 要件 1.2 に最適 |
| 各機能を module-runtime に直書き | ring buffer 等を runtime 内へ展開 | ファイル数が増えない | OFF 分岐が散在しホットパス汚染。テスト困難 | 不採用 |
| oscInFilter/oscOutFilter だけで完結 | フィルタ内のみで記録 | フック最少 | module 発送信(ping 等)が記録から漏れる(vendor 仕様) | 不採用(調査結果より不成立) |
| 診断パネル合流: fragment include(採用) | `layouts/diagnostics.json` を fragment 参照 | main.json の変更が参照 1 ウィジェットのみ。別ファイル要件を直接満たす | fragment ファイル形式の細部は実装時検証が必要 | 要件 5.1/5.2 |
| 診断パネル合流: root タブ化 | root を tabs 構造に変換 | タブ UI で分離が明快 | 既存パネル・`dynamic` コンテナの再配置が必要。Phase 2 実装への回帰リスク | 不採用 |

## Design Decisions

### Decision: デバッグ OFF は「DiagnosticsEngine 不生成」で表現する

- **Context**: 要件 1.2。OFF 時にホットパスへ計測・記録コストを残さない
- **Alternatives Considered**:
  1. 各処理に `if (config.debug)` を都度書く — 分岐散在・漏れリスク
  2. no-op 実装を注入する Null Object — 呼び出しコストとメソッド分の間接コストが残る
- **Selected Approach**: `config.debug === true` のときだけ `createDiagnosticsEngine()` を生成し、runtime は `diag: DiagnosticsEngine | null` を保持。全フックは `if (diag !== null)` ガード
- **Rationale**: OFF 時の追加コストが参照比較 1 回に収まり、診断コードへの到達自体がなくなる。ON/OFF の判定箇所が init の 1 箇所に集約される
- **Trade-offs**: フックガードが数箇所に現れるが、traceability(1.2)と単体テスト(OFF 時に recorder/sink が呼ばれないことの spy 検証)で担保する
- **Follow-up**: `sendFn` ラップが OFF 時に素通しであることをテストで確認

### Decision: NDJSON はリングバッファと独立に逐次追記し、失敗時は書き出しのみ停止する

- **Context**: 要件 2.3/2.4/2.5。ファイル書き出し失敗が OSC 送受信を止めてはならない
- **Alternatives Considered**:
  1. リングバッファを定期フラッシュしてファイル化 — フラッシュ間隔分のロスト・重複管理が必要
  2. 失敗時に再オープンをリトライし続ける — 失敗ループでログが荒れる
- **Selected Approach**: debug ON の起動時に `logs/diagnostics/osc-debug-<起動時刻>.ndjson` を追記ストリームで開き、記録 1 件 = 1 行を逐次 write。エラー発生時は 1 回だけログを出し、以後の書き出しを停止(degraded)。リングバッファとパネル反映は継続
- **Rationale**: ストリームの内部バッファリングでホットパスをブロックせず、失敗の影響半径がファイル出力に閉じる
- **Trade-offs**: 書き出し停止後の記録はファイルに残らない(再開は再起動時)。デバッグ用途機能として許容
- **Follow-up**: `logs/` を `.gitignore` へ追加。E2E では一時ディレクトリを config で指定

### Decision: 喪失率は「確定した ping 結果の直近 W 件」のスライディングウィンドウで算出する

- **Context**: 要件 3.4(既定の ping 送信回数ベースの観測窓)、3.5(Phase 1 仕様の無変更利用)
- **Alternatives Considered**:
  1. `PingMonitor` を拡張して喪失履歴を持たせる — Phase 1 のテスト済みコードと仕様を触ることになる
  2. 時間窓(直近 60 秒)ベース — 送信回数ベースという要件文言から離れる
- **Selected Approach**: `PingMonitor` は無改変。module-runtime のフックで snapshot 差分から「前回 ping 喪失」「pong 採用」イベントを導出し、`LossRateWindow`(既定 W=30 ≒ 60 秒)へ outcome('answered' | 'lost')を記録。未確定(応答待ち中)の ping は窓に含めない
- **Rationale**: Phase 1 の ping/pong 仕様(2 秒間隔・未応答 1 件保持・不一致破棄)を変更せず(3.5)、公開 API(`snapshot()`)だけで診断イベントを導出できる
- **Trade-offs**: snapshot 差分による導出はやや間接的 → 導出ロジック自体を単体テスト対象にする
- **Follow-up**: W は config `diagnostics.lossRateWindow` で上書き可能にする(要件 7.3)

### Decision: `/surface/*` の Unity 向け送出を oscOutFilter で常時遮断する

- **Context**: 要件 5.6(診断反映で Unity への OSC 送信を発生させない)の構造的保証
- **Alternatives Considered**:
  1. レイアウト側の `interaction: false` のみに頼る — レイアウト編集ミスで破れる
- **Selected Approach**: 診断ウィジェットは `interaction: false` + `receive()` 表示専用経路で更新し、さらに `oscOutFilter` で `/surface/` プレフィックスの外向きメッセージを破棄する(debug ON/OFF を問わない名前空間ガード)
- **Rationale**: `/surface/*` は D-007 で内部観測専用と定義済みであり、Unity へ流れること自体がプロトコル違反。ガードは診断専用処理ではなく名前空間の恒常規律のため、OFF 時に実行しても要件 1.2 に反しない(プレフィックス比較 1 回)
- **Trade-offs**: oscOutFilter に恒常コストが 1 比較増える(無視できる)
- **Follow-up**: ガード発動時は警告ログ(抑制付き)を出し、レイアウト設定ミスに気付けるようにする

### Decision: mock-unity の故障注入は起動時 CLI フラグ + プロセス停止の 2 手段とする

- **Context**: 要件 6.1/6.3。喪失(部分無応答)と切断(全断)の再現
- **Alternatives Considered**:
  1. stdin コマンドで実行中に故障をトグル — 柔軟だが mock に制御プロトコルが増える
  2. シナリオ JSON に故障を混ぜる — シナリオはマニフェスト内容の契約(D-012)であり責務が混ざる
- **Selected Approach**: `--fault drop-pong`(pong のみ停止 = 到達性喪失、他応答は継続)/ `--fault silent`(全応答停止・受信計数は継続)を追加。切断はプロセス停止(既存 D-011 パターン)。状態遷移(正常→喪失→回復)はプロセスの停止・再起動・フラグ違い起動の組み合わせで再現
- **Rationale**: E2E の全ケースが既存パターンの延長で書け、mock の契約追加が最小。故障状態はフラグ値というデータで表現される(規律 7.3)
- **Trade-offs**: 単一プロセス寿命内での故障トグルはできない → 現要件の検証には不要
- **Follow-up**: READY 行 JSON に `fault` を含め、テストから起動状態を確認可能にする

## Risks & Mitigations

- fragment ファイル形式の細部(`type` フィールド・root 構造)が docs に明記されていない — 実装冒頭に最小 fragment で表示確認するタスクを置く。表示できない場合は panel 直書き + `/EDIT` 適用へフォールバック可能(いずれも本体無改造)
- NDJSON 書き出しの Windows パス・権限問題 — 既定パスは cwd 相対 `logs/diagnostics/` とし、mkdir 失敗も要件 2.5 と同じ degraded 処理に落とす
- 100ms 間引きのテストのフレーク化 — 間引きロジックは fake timer の単体テストで検証し、E2E は「最終的に表示される」ことのみをポーリングで検証(タイミング断定をしない)
- TEST-NET 宛の ping 送信はネットワークへ UDP を送り得る — TEST-NET-3(203.0.113.0/24)は例示予約帯で到達しない(RFC 5737)。fire-and-forget UDP のため副作用なし
- サブネット判定の網羅ケース(/31、ブロードキャスト、複数 NIC)— 判定は純関数のためテーブル駆動の単体テストで網羅(要件 6.4)

## References

- `vendor/open-stage-control/src/server/node/osc/index.mjs` — send()/oscOutFilter の経路確認(v1.30.4 固定)
- `vendor/open-stage-control/resources/docs/docs/widgets/fragments.md` — fragment ウィジェット仕様
- `vendor/open-stage-control/resources/docs/docs/custom-module/custom-module.md` — custom module グローバル(nativeRequire 等)
- `docs/UNITY_PROTOCOL.md` §1 — ping/pong 仕様(無変更利用、要件 3.5)
- `DESIGN.md` D-007 / D-010 / D-011 / D-012 — /surface 名前空間・receive() 表示専用・E2E 方式・データ駆動の既存判断
- RFC 5737 — TEST-NET(192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24)例示用予約帯
- Node.js `os.networkInterfaces()` / `fs.createWriteStream` — 標準 API(新規依存なし)
