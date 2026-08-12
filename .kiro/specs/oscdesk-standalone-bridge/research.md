# Research & Design Decisions

## Summary

- **Feature**: `oscdesk-standalone-bridge`
- **Discovery Scope**: Complex Integration(既存システムの基盤入れ替え + 全面改名)
- **Key Findings**:
  1. `osc@2.4.5` は `serialport` を **optionalDependencies** に持ち、`ws@8.18.0` を通常依存として引く。つまり `ws` はすでに推移的にインストール済みで、直接依存として宣言しても新規のネイティブ依存は増えない。esbuild では `--external:osc --external:ws` が必要になり、ブリッジの配布形態は「dist の単一 JS + `node_modules`」になる。
  2. UDP の実装は `osc.js` の `UDPPort` ではなく `node:dgram` + 既存コーデックで足りる。`packages/mock-unity/src/server.ts` がすでに同じ構成で動いており、`rinfo` から送信元 host/port を取る先例(osc-ui-router が必要とする情報)も揃っている。
  3. 移植 12 モジュールのうち、O-S-C の接合面に触れているのは実質 `module-runtime.ts` の 1 本だけで、残りは `sendFn` / `receiveFn` / `fs` / `now` の注入で既に抽象化されている。したがって「接合面を分割して片側を新規に書く」(Option C)が、既存テストの生存率と設計の素直さの両立点になる。
  4. 設定パーサが TypeScript(zod)と Python(手書き)で二重化している。ブリッジが解決済み設定を WebSocket の `hello` フレームで配れば Python 側パーサを丸ごと削除でき、D-2 の「二重実装のずれ」の対象がフレーム 1 種類に減る。
  5. OSC の `b`(blob)を JSON へ載せる業界標準は存在しない(hosc-json はバイト配列、osc.js は WebSocket でもバイナリのまま)。自前で決める必要があり、往復可能性を取るなら base64 一択。

## Research Log

### `ws` パッケージと死活監視の方式

- **Context**: Req 3-6(応答のないクライアントの切断)と D-2(JSON テキストで運ぶ)の整合。
- **Sources Consulted**: [ws - npm](https://www.npmjs.com/package/ws)、[ws ドキュメント](https://www.npmjs.com/package/ws?activeTab=versions)、`node_modules/.pnpm/osc@2.4.5/node_modules/osc/package.json`
- **Findings**:
  - `ws` の最新は 8.21.x 系。Node 専用、プリビルドのネイティブアドオン(マスク処理の高速化)を同梱するが、無くても動作する。
  - `osc@2.4.5` が `ws@8.18.0` を依存に持つため、リポジトリにはすでに `ws` が存在する。直接依存として `^8.18.0` を宣言してもツリーは増えない。
  - 死活監視には (a) WebSocket プロトコルの ping/pong フレーム(`ws.ping()` + `pong` イベント + `isAlive` フラグ)と、(b) アプリ層の JSON 心拍の 2 通りがある。
- **Implications**: D-2 が「すべて JSON テキストで運ぶ」を選んだ以上、(b) を採る。理由は 3 つ。(1) フレーム形式が 1 本化され、見本 JSON(D-5)で心拍まで検証できる。(2) Python の `websockets` は自動 pong を返すため (a) では「アプリが生きているか」ではなく「TCP が生きているか」しか測れない。(3) `websockets` 側の `ping_interval=None` 設定(既存コードにある)をそのまま維持できる。

### `osc` npm の bundling と配布形態

- **Context**: Req 8-5 / Req 9-10 の「ビルド成果物」の定義。
- **Sources Consulted**: [osc - npm](https://www.npmjs.com/package/osc)、[osc.js GitHub](https://github.com/colinbdclark/osc.js/)、リポジトリ内 `packages/mock-unity/package.json`
- **Findings**:
  - `osc` は `long` / `slip` / `wolfy87-eventemitter` / `ws` を依存に、`serialport` を optional に持つ。`serialport` はネイティブビルドを伴うため bundle 不可。
  - 既存の mock-unity はすでに `esbuild ... --external:osc` で回避している。
  - `pnpm` の厳格な node_modules レイアウトのため、`--external` した依存は「そのパッケージの `node_modules` から解決できること」が前提になる。dist を単体コピーして別の場所で動かすことはできない。
- **Implications**: ブリッジのビルドは `esbuild src/main.ts --bundle --platform=node --format=cjs --outfile=dist/oscdesk-bridge.js --external:osc --external:ws`。**「ビルド成果物」= `packages/bridge/dist/oscdesk-bridge.js` が存在し、かつワークスペースの `node_modules` がインストール済みであること**、と定義する。pytest の fixture はこの 2 条件を起動前に確認し、欠けていれば対処コマンド付きで失敗させる(Req 9-10)。

### UDP トランスポートの実装方式

- **Context**: O-S-C 内部の osc.js 利用を自前へ置き換える。
- **Findings**:
  - `osc.js` の `UDPPort` はイベントエミッタと `serialport` を含む広い API 面を持ち込む。受信情報は `port.on('message', (msg, timeTag, info) => ...)` の `info` から取る。
  - `node:dgram` + `osc.readPacket/writePacket` は既に `packages/mock-unity/src/{server,osc-adapter}.ts` に実装済みで、`rinfo.address` / `rinfo.port` がそのまま得られる。`metadata: true` / `unpackSingleArgs: false` により型タグ保持がリポジトリ標準になっている。
- **Implications**: `UDPPort` は採らず `node:dgram` + 既存コーデックを採用。コーデックはブリッジと mock-unity の双方が使うため、`packages/mock-unity/src/osc-adapter.ts` を新パッケージ `packages/osc-codec` へ `git mv` して 1 本化する。

### OSC blob の JSON 表現

- **Context**: Req 1-3 / Req 3-2 は `b` の型タグと値の対応保持を求めるが、`Uint8Array` は JSON 化できない。
- **Sources Consulted**: [Sound.OSC.Type.JSON (hosc-json)](https://hackage.haskell.org/package/hosc-json-0.16/docs/Sound-OSC-Type-JSON.html)、[Base64](https://en.wikipedia.org/wiki/Base64)、リポジトリ内 `RecordedArgSchema`
- **Findings**:
  - hosc-json は `{"blob":[0,1]}` のバイト配列表記。JSON サイズが 3〜4 倍に膨らむ。
  - osc.js の WebSocketPort はバイナリのまま送るため JSON 表現を定義していない。
  - リポジトリ内の先例 `RecordedArgSchema` は `{kind:'blob', byteLength}` で **長さしか持たない**(診断ログ用途で値の復元が不要だったため)。
- **Implications**: 診断ログの先例は「値を捨ててよい文脈」の判断であり、UI へ配る経路には流用できない。往復可能性を優先して **base64 文字列**を採る。引数の形は `{type, value}` で統一し、`type: 'b'` のときだけ `value` が base64 文字列であることを仕様に明記する。Python 側は `base64.b64decode` のみで復元でき、追加依存は不要。

### git submodule の完全な削除手順

- **Context**: Req 5-1。
- **Findings**: submodule の痕跡は 4 か所(`.gitmodules`、`.git/config` の `submodule.*` セクション、`.git/modules/<path>`、index のギットリンクエントリ)に残る。`git rm` だけでは `.git/modules/` が残り、同名パスを再度 submodule 化したときに古い設定が復活する。
- **Implications**: 手順を以下の順で固定し、タスクへ落とす。
  1. `git submodule deinit -f vendor/open-stage-control`(`.git/config` のセクションを消す)
  2. `git rm -f vendor/open-stage-control`(index のギットリンクと作業ツリーを消す)
  3. `git rm -f .gitmodules`(他に submodule が無いのでファイルごと削除)
  4. `Remove-Item -Recurse -Force .git/modules/vendor`(残骸の削除。Windows では読み取り専用属性で失敗しうるので `-Force` 必須)
  5. `Remove-Item -Recurse -Force vendor`(gitignore されたビルド生成物 `app/` が残るため)

### NiceGUI 側の現状と改修範囲

- **Context**: Req 6 と D-3 の gap 補正。
- **Findings**:
  - `protocol.py` は O-S-C の配列フレーム専用で、`parse_received_osc` は型タグを捨てる実装(`_unwrap_arg`)。全面書き換え。
  - `surface_link.py` は再接続・送信キュー・優先 pong 応答の骨格が使える。変わるのは「何を送り何を読むか」だけ。
  - `config.py` は `unity` ブロックと `expectedProjectId` を独自にパースしている(TypeScript 側 zod との二重実装)。
  - `state.py` は `expectedProjectId` 照合を自前で行い、`/surface/` プレフィクスを直書きしている。
  - `page.py` が表示しているのは WebSocket 接続の生死のみ。RTT・連続喪失の表示要素は存在しない。
  - `AppConfig.show_debug_panel` はどこからも参照されていない。
- **Implications**: `hello` / `link` フレームの導入により `config.py` のファイルパース、`state.py` の projectId 照合、`show_debug_panel` をすべて削除できる。UI が起動時に必要な情報は「ブリッジの WebSocket URL」と「自分の待受ポート」の 2 つだけになり、それは起動スクリプトが渡す。

## Architecture Pattern Evaluation

### 接合面(module-runtime.ts)の分割線

| Option | 説明 | 強み | リスク / 限界 | 判定 |
|--------|------|------|---------------|------|
| A | O-S-C API(`send` / `receive` / `oscInFilter` / `oscOutFilter`)を薄いアダプタで模し、`module-runtime.ts` をほぼそのまま動かす | 差分最小。1200 行超の既存結合テストがほぼ無改修で通る | 消したはずの O-S-C の設計思想(`oscOutFilter` が `false` を返す、`receive` の第 3 引数に `{clientId}`)が API 形状として恒久化する。Req 5-5 に精神的に抵触 | 却下 |
| B | 接合面を素直に再設計し、純粋ロジックだけを移植する | Req 5-5 を素直に満たす | `module-runtime.test.ts` の大半が書き直しになり、ping 監視・マニフェスト再要求・誤接続ガードの結合レベル回帰網が一度失われる。D-1(一気入れ替え)と重なると最も危険 | 却下 |
| C | オーケストレータ(トランスポート非依存の状態機械)とトランスポート束ね役(UDP / WS / タイマー)へ分割。前者は `git mv` 後に削り出し、後者は新規 | 既存 deps 注入(`sendFn` / `receiveFn`)が既に抽象化されているため、`sendFn` はそのまま、`receiveFn` だけを `publish(frame, target?)` へ置換すれば既存テストの大半が生きる。blame も保たれる(D-6) | `receiveFn` を検証していたテストは書き換えが要る。ただし対象は「マニフェスト配信」「ガードのパネル配信」「/EDIT 適用」の 3 系統で、後 2 者は仕様として削除される | **採用** |

### ブリッジの内部構造

| Option | 説明 | 強み | リスク / 限界 | 判定 |
|--------|------|------|---------------|------|
| レイヤード(Types → Config → Domain → Core → Transport → Entry) | 依存方向を一方向に固定し、トランスポートを最外周に置く | 既存パッケージ構成(shared → custom-module)の延長で理解しやすい。テストはコアだけで完結する | 層が薄いところで冗長になりうる | **採用** |
| ヘキサゴナル(明示的なポート/アダプタ定義) | 同上をより形式化 | 抽象が明示される | このサイズ(1 プロセス・2 トランスポート)には過剰。インタフェース定義が増えるだけ | 却下 |
| イベントバス中心 | 内部を pub/sub で疎結合化 | 拡張しやすい | 追跡性が落ちる。Unity が真実の源という単純な流れを不必要に間接化する | 却下 |

## Design Decisions

### Decision: WebSocket フレームはエンベロープ付きの型判別ユニオンにする

- **Context**: D-2 は「JSON テキストで運ぶ」までを決め、具体のフィールド名とイベント種別は設計に委ねられた。
- **Alternatives Considered**:
  1. `["イベント名", データ]` の配列を維持したまま中身だけ改善 — Req 3-1 が明示的に禁止。
  2. アドレス空間で種別を区別(`/oscdesk/manifest` を OSC フレームとして送る)— 現行方式。マニフェストが「JSON 文字列を OSC の s 引数に入れる」二重エンコードになり、UI 側が OSC メッセージと制御情報を見分けるためにアドレス文字列を判定する必要がある。
  3. `{v, type, ...}` のオブジェクトで種別を第一級にする。
- **Selected Approach**: 3。全フレームに `v`(プロトコル版)と `type`(判別子)を持たせ、`osc` / `manifest` / `link` / `hello` / `heartbeat` / `notice`(下り)、`osc` / `manifestRequest` / `heartbeatAck`(上り)に分ける。
- **Rationale**: OSC の値配信と、マニフェスト・接続状態・死活監視という「OSC ではない情報」を同じ経路で運ぶ以上、種別は第一級であるべき。マニフェストをオブジェクトのまま送れるようになり、二重エンコードが消える。
- **Trade-offs**: フレーム種別が 9 個に増え、仕様書と見本 JSON の維持コストが上がる。ただし D-5 の見本 JSON が種別ごとに 1 ケースずつ並ぶ形になり、かえって網羅性が見える。
- **Follow-up**: 上りフレームは zod の `.strict()` で検証し、キーの綴り間違いを Req 3-5 の破棄として扱う。

### Decision: ブリッジが解決済み設定を `hello` フレームで UI へ配る

- **Context**: gap 分析が挙げた「設定パーサの二重実装」。`expectedProjectId` は TypeScript(zod)と Python(手書き)の両方で読まれている。
- **Alternatives Considered**:
  1. 現状維持(Python 側でも設定ファイルを読む)。
  2. UI 側の設定ファイル読み込みを廃止し、必要な値をすべて起動引数で渡す。
  3. UI 側の設定ファイル読み込みを廃止し、接続後に `hello` フレームで受け取る。
- **Selected Approach**: 3。UI が起動時に知る必要があるのは「ブリッジの WebSocket URL」と「自分の待受ポート」だけにし、Unity 宛先・`expectedProjectId`・心拍間隔・ping 間隔はすべて `hello` で受け取る。
- **Rationale**: 「案件差分はデータ」の規律を保ったまま、パーサを 1 本にできる。鶏卵問題(UI は接続先を知らないと繋げない)は残るが、それは 2 値の起動引数で済み、意味を持つ設定ではない。
- **Trade-offs**: UI は接続が確立するまで Unity 宛先を表示できない。表示上は「接続待ち」で埋める。
- **Follow-up**: `expectedProjectId` の照合責務はブリッジへ一本化する。UI 側の照合ロジック(`state.py`)は削除し、判定結果は `link` フレームの `lastRejection` として受け取る。

### Decision: 起動スクリプトはブリッジの READY 行を読んで UI を起動する

- **Context**: D-8 でポートを設定ファイルへ集約したが、UI(Python)と起動スクリプト(PowerShell)も同じポートを知る必要がある。設定パーサを増やしたくない。
- **Alternatives Considered**:
  1. PowerShell が `ConvertFrom-Json` で設定ファイルを読む(3 つ目のパーサ)。
  2. ブリッジが Req 1-4 の起動完了行に解決済みポートを載せ、起動スクリプトはそれを読む。
- **Selected Approach**: 2。`OSCDESK_BRIDGE_READY {json}` を標準出力へ 1 行出し、起動スクリプトはこの行を待ってから UI を起動する。
- **Rationale**: Req 1-4 が要求する行をそのまま「設定の解決結果の公開点」にできる。設定の解釈はブリッジ 1 か所に閉じる。起動完了を待つ同期点も同時に得られる(Req 8-3 の失敗検出に使える)。`MOCK_UNITY_READY` という同型の先例がリポジトリにある。
- **Trade-offs**: 起動スクリプトが標準出力をパースする実装になり、素朴な `Start-Process` より複雑になる。
- **Follow-up**: E2E の `ProcessHarness` と pytest fixture も同じ READY 行を待つ。3 者が同じ同期点を共有する。

### Decision: `unity.receivePort` を `bridge.oscListenPort` へ改名する

- **Context**: gap 分析の論点 4。ブリッジ自身の待受ポートなのに Unity 視点の名前で、約 25 箇所が動く。
- **Alternatives Considered**:
  1. 据え置き(差分最小)。
  2. `bridge` ブロックへ移して改名。
- **Selected Approach**: 2。設定を `unity`(宛先)/ `bridge`(自分の待受)/ `ui`(UI の待受)の 3 ブロックへ再構成する。
- **Rationale**: D-8 で `wsPort` が同じ設定ファイルに入る以上、「ブリッジの待受ポート 2 本が別ブロックに分かれている」状態は初見の読み手を確実に誤らせる。Req 7-7 が後方互換エイリアスを禁じており、どうせ全設定ファイルを書き直す機会でもある。動く 25 箇所のうち実装は数か所で、大半はテストフィクスチャと文書。
- **Trade-offs**: Unity 側の手順書(`docs/UNITY_PROTOCOL.md`)で「Unity が送る先 = ブリッジの `bridge.oscListenPort`」という読み替えの説明が必要になる。
- **Follow-up**: `OscSurface/` 側の追従手順(Req 10-6)にこの読み替えを明記する。

### Decision: レイアウト不在時の強制マニフェスト再要求を廃止する

- **Context**: `applyManifest()` の `snapshot === null` 分岐(`lastForcedManifestRequestAtMs` によるバックオフ)。`DESIGN.md` D-020 の判断に由来する。
- **Alternatives Considered**:
  1. バックオフ付きの強制再要求を残す。
  2. 分岐ごと削除し、`ManifestClient` の `settled` 状態に任せる。
- **Selected Approach**: 2。
- **Rationale**: この分岐は「マニフェストは採用したが、レイアウト JSON が無いので `/EDIT` を組み立てられない → いつか出るかもしれないので Unity に再送を頼み続ける」という O-S-C 内蔵 UI 都合の挙動だった。レイアウトの概念が消える以上、採用できたら `settled` で止まるのが正しい。Req 2-6 の「規定の最小間隔より短い周期で再要求しない」は `ManifestClient.requestIntervalMs` がそのまま担保する。
- **Trade-offs**: D-020 の判断を実質的に取り消すことになるため、`DESIGN.md` に理由を残す必要がある(Req 10-3)。
- **Follow-up**: Req 2-5(到達性回復時の再要求)は `refreshManifestOnNextAcceptedPong` として残るため、再要求経路そのものは失われない。

### Decision: NDJSON の容量上限は自動パージで守る

- **Context**: 現行は診断パネルの「ログ削除」ボタン(`/surface/diag/purge`)が唯一のパージ経路。debug 有効時は guard ログの自動パージも意図的に無効化されている。D-3 でパネルが消えると、debug 構成で上限が守られなくなる。
- **Selected Approach**: 診断エンジンの容量ポーリング(60 秒周期)で上限超過を検出したら、その場で `purgeLogs()` を実行する。UI からの削除操作(`/oscdesk/diag/purge`)は廃止する。
- **Rationale**: Req 2-7 が求めるのは「容量上限つき」であって「手動削除の提供」ではない。人が押すボタンでしか守られない上限は、パネルが消えた時点で上限として機能しない。
- **Trade-offs**: 運用者が任意のタイミングでログを消す手段を失う。エクスプローラでのファイル削除が代替になる旨を `docs/VERIFICATION.md` に書く(Req 5-7)。

### Decision: OSC コーデックを独立パッケージへ切り出す

- **Context**: ブリッジと mock-unity の双方が同じ「型タグ保持の OSC 変換」を必要とする。
- **Alternatives Considered**:
  1. ブリッジへコピーする — 2 本のコーデックが将来ずれる。
  2. `packages/shared` へ移す — shared が `osc` に依存し、型・スキーマだけの純粋パッケージでなくなる。
  3. `packages/osc-codec` を新設し、両者が依存する。
- **Selected Approach**: 3。`packages/mock-unity/src/osc-adapter.ts` とそのテストを `git mv` して作る。
- **Rationale**: 依存方向が `shared`(型)← `osc-codec` ← `{bridge, mock-unity}` と一方向に保たれる。shared は zod だけに依存する状態を維持できる。
- **Trade-offs**: ワークスペースのパッケージが 1 つ増える。mock-unity は「無傷で残す」対象だが、import 1 行の変更が入る。

## Risks & Mitigations

- **D-1(一気入れ替え)により、移行途中はテストが完了判定として機能しない** — 移行順序を「①足場(osc-codec / wire スキーマ)→ ②ブリッジ本体 → ③E2E 付け替え → ④UI 付け替え → ⑤O-S-C 撤去 → ⑥改名 → ⑦文書」に固定し、各段の完了条件を「そのタスクの単体テストが緑」に落とす。全体緑は ⑦ の後。
- **`surface-core` 抽出中に結合レベルの回帰網が失われる** — `sendFn` の形を変えないことで既存テストの大半を生かす。`receiveFn` → `publish` の置換は機械的変換で、テスト側も同じ機械的変換で追従できる。抽出は「削る」方向のみとし、ロジックの書き換えを同じタスクに混ぜない。
- **フレーム形式の二重実装のずれ** — D-5 のとおり見本 JSON(`protocol/wire-samples.json`)を TypeScript と Python の双方で読む。加えて異常系ケースを見本へ同梱し、「見本に無いケースは検出できない」というトレードオフの穴を部分的に埋める。
- **pytest が Node のビルド成果物に依存する** — fixture が起動前に `dist` と `node_modules` の存在を確認し、欠けていれば対処コマンド(`corepack pnpm install` / `corepack pnpm --filter @oscdesk/bridge run build`)を出して失敗する(Req 9-10)。ルートの test スクリプトは build → vitest → pytest の順に固定する。
- **`/surface/` と旧名称の取り残し** — vitest のガードテストがリポジトリを走査して検出する(Req 4-8)。除外は `DESIGN.md`、`.kiro/specs/**`、`node_modules`、`.git`、`logs/` のみ。
- **未対応 OSC 型タグ(`d` / `T` / `F` 等)を Unity が送った場合** — 既存コーデックは例外を投げる。ブリッジは当該パケットを破棄してログに残し、接続は維持する。`docs/UNITY_PROTOCOL.md` の互換性ノートに「OSC 1.0 の `i` / `f` / `s` / `b` のみ対応」を明記する。

## References

- [ws - npm](https://www.npmjs.com/package/ws) — WebSocket サーバー実装。最新 8.21.x
- [osc - npm](https://www.npmjs.com/package/osc) / [osc.js GitHub](https://github.com/colinbdclark/osc.js/) — OSC の読み書きと依存構成
- [Sound.OSC.Type.JSON (hosc-json)](https://hackage.haskell.org/package/hosc-json-0.16/docs/Sound-OSC-Type-JSON.html) — OSC の JSON 表現の先行例
- [Base64](https://en.wikipedia.org/wiki/Base64) — blob 表現の根拠
- [Transmitting OSC data via WebSocket](https://contra.medium.com/transmitting-osc-data-via-websocket-43fcc8bfade7) — OSC over WebSocket の一般的な構成
- リポジトリ内: `docs/CUSTOM_UI_INTEGRATION.md` §3(現行フレーム形式と既知の欠陥)、`DESIGN.md` D-019 / D-020 / D-023 / D-024
