# DESIGN.md — 設計判断の記録

このファイルは osc-surface の設計判断とその理由を時系列で記録する。判断を覆す場合も履歴は残し、取り消し線ではなく追記で更新する。

## 2026-07-23 Phase 0

### D-001: O-S-C submodule は Framagit の upstream を直接参照する

- **背景**: O-S-C の開発は GitHub から Framagit へ移行済み(GitHub 側は 2025-12-17 にアーカイブ、読み取り専用)。正式リポジトリは https://framagit.org/jean-emmanuel/open-stage-control
- **判断**: `vendor/open-stage-control` は Framagit の upstream URL を submodule として参照し、リリースタグ `v1.30.4` のコミットに固定する
- **理由**: git submodule はホスティングサービスを問わないため機能上の問題はない。Framagit はアカウント登録制で Fork 作成の敷居が高く、現時点で Fork を持たない
- **保険(Fork 相当)の方針**: 将来必要になったら GitHub に `git push --mirror` でミラーリポジトリを作成し、`.gitmodules` の URL を差し替える。submodule はコミット SHA で固定されるため、URL 差し替えのみで履歴の同一性は保たれる

### D-002: vendor のインストールは electron を除外し node ランタイムで headless 起動する

- **背景**: O-S-C の `electron` は optionalDependencies であり、`src/server/index.js` は electron 不在または `--no-gui` 指定時に純 node ランタイムで起動する設計になっている
- **判断**: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --no-package-lock` でインストールし、`node app/ --no-gui ...` で起動する
- **理由**:
  - electron バイナリのダウンロード(数百MB)を回避でき、CI と開発マシン双方で軽い
  - headless 運用(テスト・本番)では GUI ランチャー不要
  - `--no-package-lock` は upstream の `package-lock.json` が古い npm 形式で `npm ci` と非互換なため。lockfile を書き換えると submodule 無改造の規律に反するので、書き換えない形でインストールする
- **経緯**: 当初 `--omit=optional` で electron ごと除外したが、rollup / @parcel/watcher の各プラットフォーム用ネイティブバイナリも optionalDependencies 配下のため build が壊れた。optional は入れつつ electron のバイナリだけ環境変数でスキップする方式に変更
- **既知の副作用**: upstream の npm scripts が使う `echo '=> Dependencies ...'` / `echo '=> JS and CSS assets ...'` は Windows cmd で `>` がリダイレクト解釈され、submodule 直下に `Dependencies` / `JS` というゴミファイルを作る。install / build 後に削除すること

### D-003: custom module は TypeScript で書き esbuild で単一 CJS にバンドルする

- **背景**: O-S-C の custom module は制限付きコンテキストで実行され、node の `require` が使えない(独自の `require`/`nativeRequire` のみ)。複数ファイル・npm 依存を素直には使えない
- **判断**: `packages/custom-module/src/index.ts` を esbuild で `dist/osc-surface.js`(CJS 単一ファイル)にバンドルし、`--custom-module` に渡す
- **注意**: モジュールのエクスポートは esbuild の ESM 変換を避けるため `module.exports = {...}` を直接書く(O-S-C 側は `module.exports` の形しか認識しない)

### D-004: pnpm は corepack 経由で使用する

- **判断**: グローバルインストールせず、root `package.json` の `packageManager: "pnpm@10.13.1"` + corepack で固定する。コマンドは `corepack pnpm ...`
- **理由**: マシン差異の排除。CI でも同一バージョンが再現される

### D-005: リポジトリには Unity プロジェクト `OscSurface/` が同居する

- **背景**: リポジトリ root には既存の Unity プロジェクト(`OscSurface/`)がある。初回指示のディレクトリ構成(packages/ 等)は root 直下に構築した
- **注意**: `.gitignore` は Unity 用パターン(`[Ll]ibrary/` 等)が深さ無制限で効いているため、Node 側で `Library/` という名前のディレクトリを作らないこと

## 2026-07-23 Phase 1

### D-006: mock-unity とテスト系の OSC コーデックには `osc` npm を使う

- **背景**: Phase 1 では mock-unity の encode/decode と E2E クライアントの packet 生成・解釈が必要だが、shared にはライブラリ非依存の wire 型だけを置きたい
- **判断**: mock-unity と `tests/e2e` の OSC コーデックには `osc` npm を採用する
- **理由**:
  - 実績のあるコーデックを使うことで mock 実装とテスト実装の作成コストを抑えられる
  - E2E で O-S-C の独立実装と突き合わせるため、`osc` 固有の癖に引きずられた場合も検出可能
  - shared をライブラリ非依存に保ち、プロトコル仕様と実装都合を分離できる
- **使用制約**:
  - Phase 1 で扱う型は基本型タグ `i` / `f` / `s` / `b` と bundle / timetag のみ
  - `metadata: true`、`unpackSingleArgs: false` を固定し、実装側で明示的に wire 型へ正規化する
- **記録**: ユーザー判断日 2026-07-23

### D-007: `/surface/*` は内部観測名前空間として扱い、疎通確認は E2E と status で行う

- **背景**: Phase 1 の主目的は `/sys/*` 到達性確認だが、custom module 内の RTT・喪失数は外部から観測できる出口が必要だった
- **判断**: `/surface/status/request` と `/surface/status` を Surface 内部の観測専用名前空間として追加し、E2E と手動検証の観測点にする
- **理由**:
  - `/sys/*` を Unity 向け制御面、`/surface/*` を Surface 自身の状態公開面として分離できる
  - UI の目視確認だけに頼らず、RTT・連続喪失数・最後の pong `seq` を JSON で確定的に検証できる
  - Phase 3 の診断パネル実装でも同じ status 契約を再利用できる

## 2026-07-24 Phase 2

### D-008: 動的生成は `dynamic` コンテナへの `/EDIT` 宣言的全再生成で行う

- **背景**: マニフェストの索引外エントリからウィジェットを生成し、再受信時の更新・消滅エントリの削除・手動配置の保護を同時に満たす必要がある。O-S-C にウィジェット単位の追加/削除コマンドは存在しない(本体改造は規律違反)
- **判断**: レイアウトに空のパネル `dynamic` をデータとして定義し、マニフェスト採用ごとに group ごとの子パネル + ウィジェット群を構築して `/EDIT dynamic {widgets: [...]}` 1 コマンドで `widgets` 配列を丸ごと差し替える
- **理由**: 差分計算が不要で、消滅エントリの削除が全再生成により自然に成立する。手動配置ウィジェットは `dynamic` コンテナ外にあるため構造的に無傷。root への `/EDIT` は手動配置を巻き込むリスクがあり不採用
- **トレードオフ**: 再受信のたびに動的ウィジェットの値がリセットされる → 直後の `receive()` 値同期でマニフェストの現在値に揃える(Unity が真実の源の規律とも整合)
- **付随規約**: 生成 id は `dynamicWidgetId(address)`(`/` → `_` 置換 + 接頭辞 `dyn`)の決定的変換。手動配置ウィジェットに `dyn` 接頭辞・`dynamic` id を使わない(VERIFICATION.md に明記)。生成ウィジェットは `target` を指定せず、サーバ既定ターゲット(`-s` = config の宛先)へ送信する

### D-009: マニフェスト適用は「採用時ブロードキャスト」+「sessionOpened ごとのクライアント別適用」の二経路

- **背景**: O-S-C のウィジェット状態はクライアントごとに存在するため、適用済みマニフェストは後から接続したクライアントにも届ける必要がある
- **判断**: runtime が採用済みマニフェストを保持し、(a) 新マニフェスト採用時は clientId 指定なしで全クライアントへ、(b) `app.on('sessionOpened')` で当該 `clientId` のみへ適用プランを配信する
- **理由**: `sessionOpened` はクライアントのウィジェットツリー構築完了後に届く(vendor ソースで確認済み)ため、後続接続クライアントも最新マニフェストで初期化される
- **トレードオフ**: クライアント 0 接続時の採用は表示に反映されないが、保持したマニフェストが次の接続時に適用されるため問題ない
- **注意**: `/EDIT` 配信は props の JSON 文字列化 + `{noWarning: true}` を常に付与(未保存ダイアログ抑止)。`clientId` オプションは指定時のみ渡す(undefined を渡すと OSC 引数と誤認される)

### D-010: 値の表示同期は `receive()` のみを使い、custom module から `/SET` を使わない

- **背景**: 要件のフィードバックループ禁止。`/SET` は `send: true` で動作し、表示更新のつもりが Unity への送信を引き起こす
- **判断**: 現在値の表示同期はエントリ `address` 宛の `receive()`(クライアント側で `setValue({send: false, sync: true})` になる表示専用経路)のみを使用する。値の確定は引き続き Unity からのエコーバックのみ
- **理由**: `receive()` は送信を伴わない表示更新経路として vendor が保証している
- **例外**: テストコードに限り `/SET` を「UI 操作の代替」として使用する。ユーザー操作と同一の送信 → エコーバック経路を通るため、操作検証の手段として適切

### D-011: E2E は Playwright 保持クライアント + OSC リモートコマンド検証で行う

- **背景**: ウィジェット状態はクライアント側にのみ存在するため、headless E2E でも実ブラウザクライアントを 1 個接続しないと検証が成立しない
- **判断**: Playwright(chromium headless)で O-S-C クライアントを 1 個だけ接続保持し、状態検証は `/EDIT/GET`・`/GET`、操作注入は `/SET` で行う(DOM 検査はしない)
- **理由**: 検証面が OSC に一本化され、O-S-C の内部 DOM 構造(壊れやすい)への依存を持たない。接続クライアントが 1 個なら応答の多重化も起きない
- **トレードオフ**: `corepack pnpm test` の前提としてブラウザバイナリのインストール(`corepack pnpm exec playwright install chromium`)が必要 → CLAUDE.md / VERIFICATION.md に手順として明記
- **注意**: 到達性喪失 → 回復の E2E では、mock 停止後に `/surface/status` で連続喪失 1 以上を確認してから再起動する(喪失検出前の再起動は回復遷移が発火せず再要求されないフレーク源)

### D-012: mock-unity のシナリオはデータファイル + CLI 上書きで表現する

- **背景**: 「案件差分はコードでなくデータ」の規律。マニフェスト応答の内容・キャラ名生成・不正応答ケースをコード分岐なしで切り替えたい
- **判断**: シナリオ JSON(エントリ雛形・`{characterName}` プレースホルダ・キャラ名生成規則・不正応答の raw 上書き)を `--scenario <path>` で読み込み、`--character-name <name>` で固定上書き可能にする。READY 行 JSON に `characterName` を含めテストへ公開する
- **理由**: 不正マニフェストケースも「不正な応答文字列を持つシナリオデータ」(`scenarios/invalid-manifest.json`)で表現でき、コード分岐が増えない
- **トレードオフ**: シナリオスキーマという mock 専用契約が増える → mock-unity パッケージ内に閉じ、`/sys/*` 契約(shared)とは分離する

### D-013: 診断 E2E の「切断(全断)」はプロセス停止でなく silent フォールトで再現する

- **背景**: Phase 3 設計の E2E 一覧では「切断(全断)= mock プロセス停止」(D-011 の既存パターン)を予定していたが、実装では mock-unity の `--fault silent`(全応答抑止・受信計数は継続)で代替した
- **判断**: `tests/e2e/diagnostics.e2e.test.ts` の全断シナリオは silent フォールトで検証する。プロセス停止による喪失 → 回復の遷移自体は Phase 2 の E2E(`mock-unity-loopback.e2e.test.ts` の mock 再起動テスト)が引き続きカバーする
- **理由**: UDP はコネクションレスのため、custom module から見た観測面(ping 送信は続くが pong が返らない)はプロセス停止と silent で等価。silent はプロセス生存のまま再現できるため、Windows での taskkill 待ちやポート再バインドを伴わず、テストが速く安定する
- **トレードオフ**: 「ポートが閉じている」状態(ICMP port unreachable が返り得る)そのものは E2E で再現しない → 手動検証手順(VERIFICATION.md Phase 3 の mock 停止手順)で補完する

## 2026-07-24 Phase 4

### D-014: 擬似コードは付録でなく本文 §4 に置き、付録は uOSC(A)のみとする

- **背景**: 初版の付録プレースホルダは「A. uOSC 例 + B〜D. 擬似コード」だったが、初回指示は「本文はライブラリ非依存の擬似コードを正とし、uOSC の具体例は付録に隔離」「本文のみで実装が完結する」を要求していた
- **判断**: 受信統計・pong・マニフェスト生成の擬似コードを本文 §4 に昇格し、§5 実 Unity 接続手順・§6 互換性チェックリストも本文に置く。付録は A(uOSC)のみとする
- **理由**: 擬似コードを付録に残す構成では「本文のみで実装完結」と両立しない。付録 A.3 の読み替え表が本文 §4 と 1:1 で対応する形が、独自 Fork ライブラリ利用者の「付録を読み替えるだけ」を最短にする

### D-015: uOSC は npmjs スコープドレジストリの `com.hecomi.uosc@2.2.0` を明示ピンで導入する

- **判断**: `OscSurface/Packages/manifest.json` にスコープドレジストリ(`hecomi` / `https://registry.npmjs.com` / scope `com.hecomi`)と依存 `"com.hecomi.uosc": "2.2.0"` を追加する。代替導入(レジストリ障害時)は git URL `#upm`
- **理由**: バージョン固定による再現性と、unitypackage の手作業取り込み回避
- **注意**: スコープドレジストリ追加後の初回 Editor 起動で「Importing a scoped registry」モーダルが表示され、閉じるまでメインループが停止する(uloop 等の自動化も止まる)。付録 A.1 に注記した

### D-016: 参照実装の JSON 生成は手書きビルダで行う

- **背景**: `ManifestSchema` は optional フィールド(range / default / group)の「キーごと省略」を要求し `null` を許容しない。Unity の `JsonUtility` はこの省略セマンティクスを表現できない
- **判断**: `StringBuilder` ベースの JSON ビルダ(文字列エスケープ・invariant culture の数値書式込み)を参照実装ファイル内に内蔵する
- **理由**: 外部依存を uOSC のみに保ちながら、スキーマの省略要件を正確に満たす。エントリ 5 件の生成なら手書きで十分に安全

### D-017: bool は送信前に int 0/1 へ正規化する

- **判断**: 参照実装の `NormalizeValue` で C# `bool` を 0/1 の `int` に変換してから送信する。uOSC の対応型が int / float / string / byte[] のみである制約と、プロトコルの「bool は `i` の 0/1」(Phase 2 確定)が自然に一致する
- **補足**: 現在値ストアの `bool` エントリは 0/1 の int 受信では更新しない(mock-unity の `matchesEntryType` と同じ確定挙動に揃え、マニフェスト `default` の型は boolean のまま保つ)

### D-018: `/sys/stats` の動作確認は外部送信ワンライナー + 診断パネル観測で行う

- **背景**: Surface(custom module)が通常運用で自動送信するのは `/sys/ping` と `/sys/manifest/request` のみで、`/sys/stats/request` を送る UI・経路は存在しない(Phase 4 執筆中に確定)
- **判断**: §5.2 の stats 確認は「任意の送信手段(リポジトリ root の node ワンライナー)で要求を送り、応答は Unity の返信先(= Surface 受信ポート)に届くので診断パネル / NDJSON で観測する」という任意手順として文書化する。互換性ノートにも「stats は診断・実装確認用」と明記
- **理由**: プロトコル仕様(§1)と実装の矛盾ではなく運用の明確化であり、本体・custom module の変更なしで検証可能性を確保できる

## 2026-08-12 NiceGUI 版 UI

### D-019: マニフェストは `/surface/manifest` として WebSocket クライアントへ配る

- **背景**: custom module は `/sys/manifest` を `oscInFilter` で消費するため、自作 UI にはマニフェストが届かなかった(`docs/CUSTOM_UI_INTEGRATION.md` §4 の「要対応」)。`applyPlanToClient()` が送るのは O-S-C 専用の `/EDIT` で、レイアウト JSON を持たない UI からは使えない
- **判断**: 採用済みマニフェストの正規化 JSON を `receive('/surface/manifest', json)` で配る。配信は (a) 採用時に全クライアントへ、(b) `sessionOpened` で当該クライアントのみへ、(c) UI からの `/surface/manifest/request` に応じて。(c) は `oscOutFilter` で消費し UDP には出さない(`/surface/diag/purge` と同じ手口)
- **理由**: 既存の診断パネル配信(`diag-panel-sink.ts`)と同じ経路に載るため本体改造が不要。zod 検証と誤接続ガードを通った後のデータだけが流れるので、UI 側で契約を再実装しなくてよい
- **(c) を用意した理由**: `sessionOpened` は O-S-C のセッション確立イベントで、素の WebSocket クライアントに対して必ず発火する保証を vendor 側で確認できていない。UI からの明示要求があれば接続順に依存せず初期化できる

### D-020: レイアウト不在でもマニフェストは採用し、再要求は間隔を守る

- **背景**: `applyManifest()` はレイアウトスナップショットを取れないと何もせず `/sys/manifest/request` を即再送していた。自作 UI 専用構成(`-l` なしで O-S-C を起動)ではこの分岐に必ず入るため、Unity の応答速度そのままの要求ループになる
- **判断**: マニフェストの採用と `/surface/manifest` 配信はレイアウトの有無と切り離す。スナップショットが無い場合は `/EDIT` の適用だけを飛ばし、再要求は `MANIFEST_REQUEST_INTERVAL_MS`(2 秒)より短い間隔では行わない
- **理由**: レイアウトは O-S-C 内蔵 UI のための資産であり、自作 UI の動作条件ではない。自己修復のための再要求は残しつつ、上限レートを設けることで暴走だけを止める

### D-021: 表示の更新はページ側のタイマーで状態を取り込む

- **背景**: NiceGUI では複数ブラウザが同時に接続しうる一方、WebSocket 受信は 1 本のバックグラウンドタスクで、そこから各クライアントの要素を直接触るとクライアントコンテキストの問題を踏む
- **判断**: プロセスに 1 つの `SurfaceState`(値と revision)を置き、各ページが 20Hz のタイマーで revision の変わったウィジェットだけを更新する
- **理由**: 高頻度のエコーバックが自然に間引かれ、ページ間の同期も自動的に成立する。バックグラウンドから UI を触らないので、NiceGUI のバージョン差の影響も受けにくい
- **トレードオフ**: 表示の遅延が最大 50ms 増える。コントロールサーフェスの表示追従としては許容範囲

### D-022: 送信できない型のウィジェットは表示専用に落とす

- **判断**: `text` ウィジェットに加え、`s` / `b` 型が操作系ウィジェット(fader 等)に割り当てられたエントリも表示専用として描画する
- **理由**: 型の合わない OSC を Unity へ投げるより、表示だけに留めるほうが安全。マニフェスト側の記述ミスは UI の見た目で気付ける

### D-023: WebSocket クライアントはプロキシ環境変数を無視する

- **判断**: `websockets.connect(..., proxy=None)` を明示する
- **理由**: Python の `websockets` は既定で `HTTP(S)_PROXY` を見る。接続先は LAN 内の O-S-C なので、社内プロキシ設定のある PC では接続が壊れる

### D-024: NiceGUI 版を正規の UI として開発を進める

- **判断**: 実機での動作確認を経て、今後の UI 開発は `packages/nicegui-ui` を主線とする(ユーザー判断日 2026-08-12)
- **この判断に含まれないこと**: O-S-C 内蔵ブラウザ UI・`layouts/*.json`・`/EDIT` による動的生成は現状のまま維持する。診断パネルと E2E がこれらに依存しているため、廃止・縮小は別途判断する
- **TouchOSC など OSC ネイティブ UI との関係**: `oscUi` 経路(`docs/TOUCHOSC_EVAL.md`)は評価用として併存する。NiceGUI 版とは排他ではなく、同時に接続してもよい

## 2026-08-13 oscdesk standalone bridge 移行

### D-025: O-S-C を撤去し Node ブリッジ + NiceGUI の 2 プロセス構成を採る

- **判断**: O-S-C の submodule と内蔵 UI に依存せず、Node.js のブリッジと Python の NiceGUI UI を別プロセスで動かす
- **理由**: OSC の UDP 変換と WebSocket のプロトコル処理は Node 側に集約し、UI は Python 側に分離することで責務と障害範囲を明確にできる。Python 一本化は既存の Node/TypeScript 側の OSC・WebSocket 実装資産を捨て、UI とトランスポートを同一プロセスへ結合するため採用しない

### D-026: 名称を oscdesk / OscDesk とする

- **判断**: 実行ファイル・パッケージ・設定・スクリプトの機械名は `oscdesk`、表示上の名称は `OscDesk` とする
- **理由**: O-S-C や `osc-surface` への依存を名称から切り離し、OSC を扱うデスクトップ向けブリッジ/UI であることを示す。改名はコード、設定、テスト、スクリプト、ログ、文書を対象とし、外部プロトコルの `/sys/*` は対象外とする

### D-027: `/sys/*` は据え置き、`/surface/*` を `/oscdesk/*` へ改名する

- **判断**: Unity との既存の制御名前空間である `/sys/*` は互換性のため維持し、内部観測・UI 用の `/surface/*` は `/oscdesk/*` へ改名する。診断パネル専用アドレスは廃止する
- **理由**: 外部の Unity 側契約を壊さずに、撤去する O-S-C 固有の内部名前空間だけを新しい構成へ移行できる

### D-028: WebSocket フレームをエンベロープ付き JSON オブジェクトへ変更する

- **判断**: O-S-C 互換の配列形式をやめ、`v` と `type` を持つエンベロープ付き JSON オブジェクトを正規形式とする。OSC 引数は型タグ付きで保持し、blob は base64 で表現する
- **理由**: Node ブリッジと NiceGUI の双方で検証可能な明示的スキーマになり、引数の型と将来のフレーム種別を安全に拡張できる

### D-029: 設定を `unity` / `bridge` / `ui` の 3 ブロックへ集約する

- **判断**: 設定を 3 ブロックへ集約し、起動時に解決した値をブリッジの READY 行と UI への `hello` フレームで配布する
- **理由**: 起動スクリプトと UI が設定ファイルを個別に読む経路をなくし、実際に起動したブリッジの接続先・ポートを正典として扱える

### D-030: レイアウト不在時の強制マニフェスト再要求を廃止する

- **判断**: レイアウトが無い場合でもマニフェストを採用して WebSocket UI へ配信し、O-S-C の `/EDIT` 適用を行わない。レイアウト不在を理由に `/sys/manifest/request` を強制再送する D-020 の機構は廃止する
- **理由**: レイアウトは撤去する内蔵 UI の資産であり、NiceGUI UI の動作条件ではない。レイアウト不在時の再要求ループをなくし、マニフェストの取得と UI 表示を独立させる

### D-031: 診断パネルと手動ログ削除を廃止し、容量上限は自動パージで守る

- **判断**: 診断パネルと UI からの手動ログ削除を廃止し、証跡は NDJSON ログとブリッジの標準出力に集約する。ログ容量上限は debug 時も無効化せず自動パージで守り、必要な場合は `ndjsonMaxTotalBytes` を引き上げる
- **失う検証観点**: 画面上で送受信を逐次確認することと、任意タイミングでログを削除すること。代替は NDJSON、ブリッジ標準出力、およびエクスプローラでのファイル削除とする
- **緊張関係**: 証跡がログのみになる一方で容量上限を効かせるため、長時間の debug では古い証跡が先に消える。この制約は許容し、必要に応じて `ndjsonMaxTotalBytes` を引き上げる

### D-032: ブラウザ検査 E2E を WebSocket クライアント検証へ置き換える

- **判断**: O-S-C 内蔵 UI を実ブラウザで検査する E2E とウィジェット検査を廃止し、WebSocket クライアントでフレームと状態を検証する
- **失う検証観点**: 実ブラウザ上でのウィジェット描画確認。これに代わる自動検証は無く、`docs/VERIFICATION.md` に移した手動の目視検証で確認する
