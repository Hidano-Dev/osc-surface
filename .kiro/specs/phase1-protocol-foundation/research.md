# Research & Design Decisions — phase1-protocol-foundation

## Summary

- **Feature**: `phase1-protocol-foundation`
- **Discovery Scope**: Extension(Phase 0 で構築済みの pnpm workspace / O-S-C headless 基盤への機能追加)
- **Key Findings**:
  - mock-unity の OSC エンコード/デコードは自前の最小 OSC 1.0 コーデックで実装する(`osc` npm パッケージは不採用)。コーデックは `packages/shared` に置き、mock-unity とテストハーネスが共用する
  - O-S-C headless には UI 操作を模擬する経路がないため、custom module の計測値(RTT・連続喪失数)は `/surface/status/request` → `/surface/status` の内部照会アドレスで E2E から観測する。通常メッセージのエコーバック検証は「テストクライアント ↔ mock-unity 直結」で行い、ブラウザ UI 経由のフルチェーンは手動検証(VERIFICATION.md)に回す
  - mock-unity の pong / 応答の返信先は「受信データグラムの送信元」ではなく「設定された返信先(O-S-C の OSC 入力ポート)」を既定とする。実 Unity でも同じ規律になるため `docs/UNITY_PROTOCOL.md` の互換性ノート対象

## Research Log

### mock-unity の OSC ライブラリ選定(自前実装 vs `osc` npm)

- **Context**: HANDOVER.md / 要件 2.6・6.4 で明示された要検討事項。プロジェクト規律「OSC 1.0 標準のみ・特定ライブラリ非依存」との整合が論点
- **Sources Consulted**:
  - [osc.js (colinbdclark/osc.js)](https://github.com/colinbdclark/osc.js/) / [npm: osc](https://www.npmjs.com/package/osc) — OSC 1.0/1.1 の全型対応、個人メンテ(2025 年時点で活動あり)
  - [node-osc](https://www.npmjs.com/package/node-osc) — 代替候補
  - OSC 1.0 仕様(opensoundcontrol.org)— メッセージ/バンドルのバイナリ形式
- **Findings**:
  - `osc` npm は機能十分だが、独自の値表現(timetag のオブジェクト表現、long 対応のオプション依存など)を持ち、ライブラリ固有の型変換の癖がテスト資産に混入するリスクがある
  - Phase 1 で必要なのは型タグ `i` / `f` / `s` / `b` のメッセージと bundle の encode/decode のみで、実装規模は小さい(パディング規則 + 型ごとの固定処理)
  - 要件 2.5(パース不能データグラムで `parseErrors` を加算して継続)は、外部ライブラリだと例外の投げ方・握り潰し方に依存する。自前ならエラー境界を完全に制御できる
  - 自前コーデックは Phase 4 の `docs/UNITY_PROTOCOL.md` 付録(ライブラリ非依存の擬似コード)の下敷きとして再利用できる
- **Implications**: 自前実装を採用(詳細は Design Decisions)。エンコードバグのリスクは「OSC 1.0 仕様のバイト列既知例による単体テスト」+「E2E で O-S-C という独立実装とラウンドトリップさせる」ことで相殺する

### O-S-C custom module 実行コンテキストの制約

- **Context**: ping 送信・config 読み込み・状態公開を custom module 内でどう実現するか
- **Sources Consulted**: `vendor/open-stage-control/resources/docs/docs/custom-module/custom-module.md`(v1.30.4 同梱)、HANDOVER.md の Phase 0 の学び
- **Findings**:
  - 利用可能グローバル: `send(host, port, address, ...args)` / `receive` / `settings` / `loadJSON` / `saveJSON` / `app` / `nativeRequire` / `setInterval` / `process` など。`send` の引数は `{type, value}` オブジェクトで型タグを明示できる
  - `oscInFilter(data)` は `{address, args, host, port}` を受け、**戻り値を返さなければメッセージは破棄される**(ウィジェットへ流れない)→ 要件 3.5 の実現手段
  - `oscInFilter` の `host` / `port` は送信元 UDP アドレスなので、`send(host, port, ...)` で「送信元へ返信」が可能 → `/surface/status/request` 照会の実現手段
  - `loadJSON(path)` のパスは custom module の位置からの相対。`dist/osc-surface.js` 基準で `../../../config/surface.config.json` になる。`process.env` が使えるためテストからのパス上書きも可能
  - autoreload 時に `setInterval` はリセットされ `reload()` が呼ばれる。`stop()` でタイマー解放を行うのが安全
- **Implications**: ping ループは `init()` で `setInterval(2000)`、計測ロジックは純粋モジュールに分離して esbuild でバンドル(D-003 踏襲)。O-S-C 本体への変更は一切不要

### E2E トポロジと headless の限界

- **Context**: 要件 4.1〜4.3 をヘッドレスで自動化する方法
- **Sources Consulted**: HANDOVER.md(CLI オプション `-n` / `-p` / `-o` / `-s` / `-l` / `-c`)、O-S-C 同梱ドキュメント
- **Findings**:
  - O-S-C は `-o <port>` で OSC 入力を待受け、`-s <ip:port>` を既定送信先にできる。custom module の `send()` は任意宛先に送れる
  - headless ではブラウザクライアントが存在せず、ウィジェット操作 → OSC 送信のフルチェーン(UI 起点のエコーバック)をスクリプトから駆動する公式手段がない
  - custom module の内部状態(RTT・連続喪失数)は、O-S-C の OSC 入力ポートへ照会メッセージを送り `oscInFilter` で応答させれば外部から観測できる
- **Implications**:
  - **フルチェーン検証**(O-S-C + custom module + mock-unity): ping/pong の成立を `/surface/status` 照会で検証(要件 4.1・4.2)
  - **直結検証**(テストクライアント ↔ mock-unity): エコーバック・stats スキーマ適合・パースエラー耐性を検証(要件 4.3・4.4・2.5)
  - UI 起点のエコーバック確定は Phase 1 では `docs/VERIFICATION.md` の手動手順(ブラウザ + mock-unity)でカバーし、Phase 2 以降の自動化課題として明記

### 返信先ルーティング(pong をどこへ返すか)

- **Context**: mock-unity(将来は実 Unity)が `/sys/pong` を返す宛先の規定
- **Findings**:
  - O-S-C が `send()` で使う送信元ソケットと `-o` の受信ソケットが同一とは限らないため、「受信データグラムの送信元へ返す」実装は環境依存になり得る
  - OSC 1.0 にも「返信先」の規定はなく、ライブラリ間で解釈が割れる典型ポイント
- **Implications**: プロトコルとして「返信先は設定で明示的に与える(Surface の OSC 受信ポート)」を正とし、mock-unity は `--reply-host/--reply-port` 未指定時のみデータグラム送信元へフォールバックする。`docs/UNITY_PROTOCOL.md` の互換性ノートに追記(要件 5.4・6.3)

### vitest 3 のプロジェクト分割と直列実行

- **Context**: 要件 4.5(`corepack pnpm test` 一発)と 4.6(プロセス・ポートの確実解放)。単体テストは並列、E2E はポート競合回避のため直列にしたい
- **Sources Consulted**: [Vitest Test Projects](https://vitest.dev/guide/projects)、[Vitest Parallelism](https://vitest.dev/guide/parallelism)、[fileParallelism](https://vitest.dev/config/fileparallelism)、[vitest discussion #7416](https://github.com/vitest-dev/vitest/discussions/7416)
- **Findings**:
  - `vitest.workspace.ts` は 3.2 で非推奨になり、ルート設定の `test.projects` に統合された(機能は同等)
  - `fileParallelism` はプロジェクト単位では効かない既知の課題がある。プロジェクト単位の直列化は `poolOptions.forks.singleFork: true` か「E2E を単一テストファイルに集約」で実現するのが確実
- **Implications**: ルート `vitest.config.ts` の `test.projects` で `unit` / `e2e` を分離。E2E は単一スペックファイル + `singleFork` の二重化で直列を保証し、タイムアウトを長めに設定する

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 自前 OSC 1.0 コーデック(採用) | shared に最小 encode/decode を実装 | 依存ゼロ・OSC 1.0 準拠を自分で保証・エラー境界を制御・Phase 4 擬似コードの下敷き | 実装バグの自己責任 | 既知バイト列の単体テスト + O-S-C との相互運用 E2E で担保 |
| `osc` npm(osc.js) | 実績ある汎用ライブラリ | 実装工数減・全型対応 | ライブラリ固有の型表現が混入 / 個人メンテ / parseErrors 制御が間接的 | 「特定ライブラリ非依存」の規律的に、テスト資産にも癖を持ち込みたくない |
| ファイル経由の状態観測(saveJSON ポーリング) | custom module が状態を JSON ダンプ | プロトコル追加なし | タイミング依存・Windows のファイルロック・Phase 3 で結局照会経路が必要 | 不採用 |
| `/surface/status` OSC 照会(採用) | O-S-C 入力ポート経由で状態照会 | 決定的・Phase 3 診断パネルの布石・本体無改造 | `/surface/*` という surface 内部名前空間の新設 | `/sys/*`(Unity 契約)とは明確に分離する |

## Design Decisions

### Decision: mock-unity の OSC コーデックは自前実装し `packages/shared` に置く

- **Context**: 要件 2.6(OSC 1.0 標準のみ)・6.4(選定の記録)。mock-unity とテストクライアントの両方が OSC の encode/decode を必要とする
- **Alternatives Considered**:
  1. `osc` npm パッケージ — 実績あり、工数減
  2. 自前実装を mock-unity 内に置く — shared の責務を増やさない
  3. 自前実装を shared に置く — mock-unity とテストが共用
- **Selected Approach**: 3。`packages/shared/src/osc-codec.ts` に型タグ `i`/`f`/`s`/`b` + bundle + timetag の最小コーデックを実装(ビルドなし TS のまま)
- **Rationale**: テストハーネス(`tests/`)も OSC クライアントとしてバイト列を扱うため、mock-unity 内蔵にするとテストが mock-unity の内部実装へ依存する。shared 配置なら依存方向が `shared → mock-unity / tests` の一方向に保たれる。custom module は O-S-C が OSC I/O を担うためコーデックを使わない(import 禁止を設計で明記)
- **Trade-offs**: shared の責務が「型・スキーマ・定数」から「+ テストハーネス用 OSC 1.0 コーデック」に広がる。ただしプロトコル層のコードであり charter の逸脱は小さい。自作コーデック同士の encode/decode だと自己整合バグを検出できない点は、E2E で O-S-C(独立実装)を経由することで補う
- **Follow-up**: OSC 1.0 仕様書の既知バイト列(例: `/oscillator/4/frequency` 440.0f)をテストベクタに使う。DESIGN.md へ D-006 として転記(実装タスク)

### Decision: RTT・連続喪失数は「未応答 ping は常に 1 件」の単純ウィンドウで管理する

- **Context**: 要件 3.1〜3.4 の計測仕様を確定し、`docs/UNITY_PROTOCOL.md` の「Phase 1 で規定」を埋める(要件 6.3)
- **Alternatives Considered**:
  1. 送信済み ping を複数保持する pending マップ + 個別タイムアウト
  2. 未応答 ping を常に 1 件のみ保持(次の ping 送信時に未応答なら喪失 +1 して差し替え)
- **Selected Approach**: 2。ping 間隔 2 秒 = pong 待ちウィンドウ 2 秒。`nextPing()` 時に前回 seq が未応答なら連続喪失数 +1。pong は保持中の seq と一致した場合のみ RTT 採用・喪失数リセット、不一致(期限切れ・未知)は破棄
- **Rationale**: RTT が 2 秒を超える LAN 環境は事実上の到達不能であり、複数 pending を管理する複雑さに見合う精度向上がない。要件 3.3 の文言(「次の ping 送信時点までに」)と一致する
- **Trade-offs**: RTT > 2s の環境では喪失扱いになるが、これは仕様として明記する
- **Follow-up**: `docs/UNITY_PROTOCOL.md` §1 に保持仕様として追記

### Decision: E2E の観測は `/surface/status` 照会、エコーバック検証は mock-unity 直結

- **Context**: 要件 4.2(RTT・喪失数の検証)・4.3(エコーバック検証)を headless で自動化する
- **Alternatives Considered**:
  1. custom module のログ(stdout)をパース — 脆弱・仕様化しにくい
  2. saveJSON で状態ファイルをポーリング — タイミング依存
  3. `/surface/status/request` 照会 + エコーバックは mock-unity 直結で検証
- **Selected Approach**: 3。`/surface/*` は surface 内部名前空間(Unity 契約 `/sys/*` とは別)としてアドレス定数とペイロードスキーマを shared に定義
- **Rationale**: 決定的・低結合で、Phase 3 の診断パネルがそのまま同じ照会経路を利用できる。headless に UI 駆動経路がない制約下で、フルチェーン(O-S-C + custom module + mock-unity)は ping/pong で検証し、mock-unity のエコーバック仕様は直結で検証するのが責務的にも正しい(エコーバックは mock-unity の契約)
- **Trade-offs**: 「UI 操作 → エコーバック → ウィジェット確定」の完全な経路は Phase 1 の自動テストではカバーされない。VERIFICATION.md の手動手順で補い、Phase 2(マニフェスト駆動 UI)で自動化を再検討
- **Follow-up**: `/surface/*` を oscInFilter で必ず swallow し、ウィジェット側へ流さないこと

### Decision: mock-unity は esbuild で単一 JS にバンドルしてプロセス起動する

- **Context**: 要件 2.7(プロセスとして起動・停止)。mock-unity は buildless TS だが、子プロセス起動には JS 実体が要る
- **Alternatives Considered**:
  1. `tsx` / `ts-node` で TS を直接実行 — 依存追加、起動が遅い
  2. esbuild で `dist/mock-unity.js` にバンドル(custom module と同じ D-003 パターン)
- **Selected Approach**: 2。`node packages/mock-unity/dist/mock-unity.js --listen-port ... --reply-host ... --reply-port ...` で起動。純粋ロジック(コーデック・レスポンダ)は TS のまま vitest から直接 import して単体テスト
- **Rationale**: リポジトリ既存パターン(D-003)と一致し、追加ランタイム依存がない。起動確認は stdout の ready 行で同期できる
- **Trade-offs**: `pnpm test` 前にビルドが必要 → root の `test` スクリプトでビルドを前置して吸収

## Risks & Mitigations

- **自前コーデックのエンコードバグ** — OSC 1.0 仕様の既知バイト列による単体テスト + O-S-C(独立実装)とのラウンドトリップ E2E で検出
- **Windows での子プロセス残留・ポート未解放(要件 4.6)** — `shell: false` で直接 spawn(プロセスツリーを作らない)、`kill()` → exit 待ち → タイムアウト時 `taskkill /PID <pid> /T /F` フォールバック。`afterAll` + `try/finally` の二重防御。E2E は単一ファイル直列でポートを固定的に使う
- **O-S-C 起動完了の検出が不安定** — stdout の起動ログ(custom module 読み込みログ)を正規表現で待機 + タイムアウト。加えて最初の status 照会をリトライ付きにする
- **`loadJSON` の相対パス解決が実行形態で揺れる** — 既定パスを `dist/osc-surface.js` 基準の相対で固定し、環境変数 `OSC_SURFACE_CONFIG`(絶対パス)による上書きを用意。E2E は既定の `config/surface.config.json`(loopback 設定)をそのまま使う
- **ポート 9000/9001/7080 が開発環境で使用中** — E2E 失敗時のエラーメッセージにポート占有の確認手順を含める(VERIFICATION.md にも記載)

## References

- [osc.js (colinbdclark/osc.js)](https://github.com/colinbdclark/osc.js/) — 不採用としたライブラリの評価対象
- [npm: osc](https://www.npmjs.com/package/osc) / [npm: node-osc](https://www.npmjs.com/package/node-osc) — 代替候補
- [Vitest Test Projects](https://vitest.dev/guide/projects) — workspace 非推奨 → `test.projects` 移行
- [Vitest Parallelism](https://vitest.dev/guide/parallelism) / [fileParallelism](https://vitest.dev/config/fileparallelism) / [discussion #7416](https://github.com/vitest-dev/vitest/discussions/7416) — E2E 直列化の方式判断
- `vendor/open-stage-control/resources/docs/docs/custom-module/custom-module.md` — custom module API(v1.30.4 同梱)
- `claude-code-initial-prompt.md` / `HANDOVER.md` / `DESIGN.md`(D-001〜D-005) / `docs/UNITY_PROTOCOL.md`(草稿) — プロジェクト内一次資料
