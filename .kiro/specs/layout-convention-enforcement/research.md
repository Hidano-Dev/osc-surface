# Research & Design Decisions — layout-convention-enforcement

## Summary
- **Feature**: `layout-convention-enforcement`
- **Discovery Scope**: Extension(既存 custom module の拡張。light discovery を実施)
- **Key Findings**:
  - O-S-C のセッションルートウィジェットの id は `root` に静的固定されており(`StaticProperties(Panel, {..., id: 'root'})`)、レイアウト JSON の記述に関わらず `/EDIT root` を注入ターゲットにできる
  - `/EDIT` は `newdata.widgets` を含むと対象ウィジェットの子を全再構築(`reuseChildren: false`)し、配列は丸ごと置換される。root への注入 edit は「既存 root 子配列 + 注入モーダル」の完全な配列を送る必要があり、既存手動ウィジェットの値はリセットされる(緩和策は Decision 参照)
  - vendor の `loadJSON` はキャッシュなしで毎回 `fs.readFileSync` するが、失敗時は例外を投げず `undefined` を返す(errorCallback 未指定時は内部で console.error)。再読み込み失敗の検知は「例外 + undefined 戻り値」の両方を扱う必要がある

## Research Log

### /EDIT の挙動(注入・同一 ID・配列置換)
- **Context**: Req 3(コンテナ注入)と Req 4-2(重複コンテナ)の実現可否確認
- **Sources Consulted**: `vendor/open-stage-control/src/client/remote-control.mjs` L12-73
- **Findings**:
  - `/EDIT id json opts` は `getWidgetById(id)` で**同 ID の全ウィジェット**に props を上書きし、`newdata.widgets || newdata.tabs` があると `reuseChildren: false` で子を全再構築する
  - `/EDIT/MERGE` は `deepExtend` だが、配列は deep-extend の仕様上丸ごと置換される。「root の widgets 配列に 1 要素だけ追記」は不可能
  - `opts` に `{noWarning: true}` を渡すと unsaved フラグを立てない(既存実装が使用中)
- **Implications**: 注入は「適用直前に再読み込みしたレイアウトファイルの root 子配列 + 注入モーダル」を `/EDIT root` で送る方式が唯一の手段。重複 `dynamic` コンテナへの edit は O-S-C 側で全個体に一括反映されるため、custom module 側での選別は不要(Req 4-2 の決定と整合)

### root ウィジェット ID の固定性
- **Context**: 任意のユーザレイアウトで `/EDIT root` が成立するかの確認
- **Sources Consulted**: `vendor/open-stage-control/src/client/widgets/containers/root.mjs` L11, L50
- **Findings**: `class Root extends StaticProperties(Panel, {visible: true, label: false, id: 'root'})` かつコンストラクタで `options.props.id = 'root'` を強制。レイアウト JSON が別 id(例: `diag_root`)を書いていてもランタイム上は `root`
- **Implications**: 注入ターゲットは常に `root` で安全。ただし**レイアウトファイル側**の root 子配列はファイルの `content.widgets` から取得する必要がある(ランタイム props は custom module から読めない)

### loadJSON のキャッシュ有無と失敗時挙動
- **Context**: Req 6(適用直前再読み込み)の成立条件と失敗検知方法
- **Sources Consulted**: `vendor/open-stage-control/src/server/node/custom-module.mjs` L38-52
- **Findings**:
  - 毎回 `fs.readFileSync` + `JSON.parse`。キャッシュなし → 適用直前に読むだけで常に最新(D-4 成立)
  - 失敗時: `errorCallback` 指定なしだと console.error して `undefined` を返す。例外は投げない
  - 現行 `module-runtime.ts` の `loadCurrentLayoutJson` は `settings.read('load')` の解決失敗時のみ throw
- **Implications**: スナップショット再構築は「throw」と「undefined 戻り」の双方を失敗として扱い、last-good へフォールバックする(D-5)

### モーダル型注入の具体 props(Research Needed 5)
- **Context**: D-1 のモーダル型コンテナ注入をどの props で行うか。現行 dynamic は panel 型であり、modal が受け皿として機能するかの確認
- **Sources Consulted**: `vendor/open-stage-control/src/client/widgets/containers/modal.mjs`、`layouts/main.json` の `diag_modal`
- **Findings**:
  - modal は containers 系ウィジェットで `widgets` プロパティを持つ(diag_modal が fragment を子に持つ実績あり)。後続の `/EDIT dynamic {widgets: [...]}` の受け皿として panel と同様に機能する
  - 主要 props: `doubleTap`(既定 false)、`popupWidth`/`popupHeight`(既定 '80%')、`popupLabel`(既定 'auto')
  - 位置指定は `left`/`top`/`width`/`height`(number|percentage)。「右下隅」のような相対アンカーはないため percentage で近似する
- **Implications**: 注入モーダルは `type: 'modal'`, `id: 'dynamic'`, `left: '78%', top: '92%', width: '20%', height: 40, popupWidth: '80%', popupHeight: '80%'` とする(design.md の決定参照)。既存ウィジェットとの重なりは理論上あり得るが、注入は緊急回避でありボタンは小型なので許容

### 現行コードのギャップ(validate-gap 結果の裏取り)
- **Context**: 事前の gap 分析結果を設計に落とす前の再確認
- **Sources Consulted**: `packages/custom-module/src/layout-index.ts`, `manifest-apply.ts`, `module-runtime.ts`, `layout-convention.ts`, `guard-event-log.ts`, `manifest-client.ts`
- **Findings**:
  - `LayoutIndex` は `idByAddress`(address 解決済みウィジェットのみ)しか持たず「レイアウト全体の ID 集合」がない(Req 1 のギャップ)
  - `dynamicWidgetId` の正規化(`[^A-Za-z0-9]+ → _`)は生成 ID 同士でも衝突しうる(`/a/b` と `/a_b` → 同一 ID)→ Req 1-4 は生成 ID 間の used-set 管理が必須
  - `buildApplyPlan` は dynamic エントリ 0 件でもコンテナ edit(`widgets: [...]`)を常に発行(placeholder が消える現行仕様)
  - `sessionOpened` → `applyPlanToClient(acceptedPlan, clientId)` の再適用機構が既存。注入 edit を plan に含めれば Req 3-4 は既存機構で充足
  - `ManifestClient` は受理後 `settled` になり要求を停止。到達性回復時に `requesting` へ戻る。適用不能時の再試行はこの状態機械を流用できる
  - `guard-event-log.ts` の `isRepeat` は manifest-client が計算して渡す方式。自己修復イベントはイベントログ側で内部計算する方が境界が綺麗(manifest-client は関与しないため)
  - E2E(`tests/e2e/mock-unity-loopback.e2e.test.ts`)は `dyn_avatar_generated_wave` 等の ID を直接参照。衝突なしケースで ID 不変なら既存テストはそのまま通る(Req 5-1)
- **Implications**: design.md の File Structure Plan / Components に反映済み

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: layout-convention.ts を拡張して自己修復も担当 | 検証モジュールに修復ロジックを足す | 既存ファイルを活かせる | 「検証」と「読み込み+照合表+last-good」の責務が混在。適用直前再読み込み(Req 6)と噛み合わない | 不採用 |
| B: module-runtime に直書き | ランタイムに読み込み・検証・注入を追加 | ファイル追加なし | module-runtime が肥大化、純関数テスト不能 | 不採用 |
| C: ハイブリッド(採用) | 新規 `layout-snapshot.ts`(読み込み+検証+ID 集合+last-good)、`manifest-apply.ts` 純関数拡張、`guard-event-log.ts` 最小拡張 | 決定性テスト可能(Req 1-3, 5-1)、責務分離、破壊的改名なし | ファイル 1 追加 + 1 廃止 | validate-gap の推奨。採用 |

## Design Decisions

### Decision: root 全再構築による値リセットの緩和(Research Needed 1)
- **Context**: 注入 edit は `/EDIT root` で子を全再構築するため、手動ウィジェットの現在値が default にリセットされる
- **Alternatives Considered**:
  1. 全ウィジェットの現在値を退避・復元 — custom module からクライアント側の現在値を列挙する手段がなく不可能
  2. 注入後に plan の valueSyncs を送出し、マニフェスト対象アドレスのみ復元 — 既存の plan 適用順(edits → valueSyncs)で自然に実現
  3. 値リセットを完全に防ぐ — /EDIT の仕様上不可能
- **Selected Approach**: 案 2。plan の適用順を「注入 edit → 既存ウィジェット edit → dynamic コンテナ edit → valueSyncs」に固定し、マニフェストが値を持つアドレスは注入直後に復元する。マニフェスト対象外の手動ウィジェット値のリセットは**緊急回避の許容コスト**として明記し、自己修復イベント(診断表示 + ログ)で作成者に通知する
- **Rationale**: 注入が発動するのは「コンテナを消してしまった」異常時のみ。Unity が真実の源という原則上、UI 側の値は表示キャッシュであり、Unity からのエコーバックで随時回復する
- **Trade-offs**: 注入発動時のみ一瞬値が既定値に見える / 実装は既存機構の順序保証だけで済む
- **Follow-up**: E2E で「注入発動後にマニフェスト値が復元されること」を検証

### Decision: 自己修復イベントの配信経路(Research Needed 3, 4)
- **Context**: Req 4-4 / D-3。自己修復(注入・ID 衝突回避・再読み込み失敗)をサーバーログ + 診断表示へ流す経路の選定
- **Alternatives Considered**:
  1. 新規イベントログモジュールを作る — guard-event-log と NDJSON writer/quota 配線が重複
  2. guard-event-log を改名して汎用化 — 破壊的改名。テスト・呼び出し箇所の変更が波及
  3. guard-event-log に `recordSelfHeal` を追加する最小拡張(採用)
- **Selected Approach**: `createGuardEventLog` に `recordSelfHeal(event)` を追加。新アドレス `SURFACE_DIAG.SELF_HEAL = '/surface/diag/self-heal'` へ publish し、`layouts/diagnostics.json` に表示行 `diag_self_heal` を追加。NDJSON には `SelfHealEventRecordSchema`(shared に追加)で追記
- **Rationale**: guard の publish/publishTo/NDJSON/quota の配線をそのまま再利用でき、`sessionOpened` 時の再配信(publishTo)も自動で効く
- **Trade-offs**: モジュール名と責務が僅かにずれる(guard = 誤接続ガード + 自己修復)が、改名リスクを回避
- **Follow-up**: 将来イベント種別が増えたら surface-event-log への改名を別 spec で検討

### Decision: 警告スパム抑制は「イベントキーの内部リピート判定 + 警告セット差分ログ」(Research Needed 4)
- **Context**: D-4 により毎適用時に再読み込み・再検証が走る。同じ警告・同じ自己修復が適用のたびにログ・NDJSON へ書かれるとスパム化する
- **Selected Approach**:
  - 自己修復イベント: guard-event-log 内部で「kind + detail」のキーを直前レコードと比較し、リピート時は NDJSON 追記とサーバーログを抑制、診断パネルの表示(累計回数)のみ更新する(guard の isRepeat パターンの内製化)
  - スナップショット警告(重複アドレス等): module-runtime が直前スナップショットの警告集合と比較し、新規警告のみログ出力。診断反映は常時
- **Rationale**: manifest-client が isRepeat を供給する guard 方式は誤接続ガード固有。自己修復はイベント発生源が複数(plan / snapshot / runtime)のため、集約点であるイベントログ側で判定する方が境界が単純
- **Trade-offs**: 「同一内容が交互に出る」ケース(A→B→A)はリピート扱いされず都度ログされるが、実運用で問題にならない

### Decision: dynamic エントリ 0 件時の注入スキップ(Research Needed 6)
- **Context**: 現行はエントリ 0 件でもコンテナ edit を常に発行する。コンテナ欠落 + エントリ 0 件のとき注入する意味があるか
- **Selected Approach**:
  - コンテナ**存在**時: 従来どおりエントリ 0 件でもコンテナ edit を発行(placeholder 消去を含む現行挙動を維持 = Req 5-1)
  - コンテナ**欠落** + dynamic エントリ 0 件: 注入もコンテナ edit もスキップ(受け皿に入れるものがなく、root 全再構築の値リセットコストだけが残るため)
- **Rationale**: 注入は「生成ウィジェットの受け皿の復活」(Req 3-1)が目的であり、生成物がなければ発動条件を満たさない
- **Trade-offs**: 空マニフェスト後にエントリが増えた適用で初めて注入される(自然な挙動)

### Decision: 起動時レイアウト読み込み失敗をランタイム停止から警告継続へ変更
- **Context**: 現行 init はレイアウト読み込み失敗で ping タイマーすら開始せず全停止する。Req 6-4(再読み込み失敗中も既存機能を止めない)と D-4(適用直前に毎回読む)の下では、init 時の読み込みは「ウォームアップ」に格下げできる
- **Selected Approach**: init でのスナップショット構築は best-effort とし、失敗してもランタイムは起動する(config 読み込み失敗は従来どおり停止)。適用時に refresh が失敗し last-good も無い場合はその適用をスキップし、エラーログ + 診断イベントを記録した上で ManifestClient を requesting に戻して再試行させる
- **Rationale**: 「古い/無いレイアウトで誤った UI を作る」より「次の受信で再試行」が安全。ID 一意化があるため last-good 適用は破壊を起こさない(D-5 の根拠)
- **Trade-offs**: init 失敗時の挙動が変わる(全停止 → ping 継続)が、Req 6-4 が要求する方向への変更

### Decision: ID 一意化アルゴリズムの決定性(Req 1-3)
- **Context**: 同一マニフェスト + 同一レイアウトで常に同一の ID 割り当てを保証する必要がある
- **Selected Approach**: used-set を「レイアウト ID 集合(dynamic コンテナ配下を除く)∪ 予約 ID(`root`, `dynamic`)∪ 割り当て済み生成 ID」で初期化し、マニフェストのエントリ順に `dynamicWidgetId(address)` を基底 ID として空きを探す。衝突時は `_2`, `_3`, … と最小の空き番号を付与。グループパネル ID・見出し ID も同じ used-set を通す
- **Rationale**: 入力(マニフェスト順序 + レイアウトファイル)のみに依存する純関数となり、乱数・時刻を使わないため決定的。衝突なしケースでは基底 ID がそのまま使われ、既存 E2E の ID 参照(`dyn_avatar_generated_wave` 等)が不変(Req 5-1)
- **Follow-up**: `/a/b` と `/a_b` の正規化衝突ケースをユニットテストに含める

## Risks & Mitigations
- 注入発動時にマニフェスト対象外の手動ウィジェット値がリセットされる — 緊急回避として許容し、自己修復イベントで作成者へ通知。Unity エコーバックで回復(上記 Decision 参照)
- 注入モーダルの固定座標(画面右下)が既存ウィジェットと重なる — 小型ボタン + モーダルは開くまで画面を覆わないため影響最小。診断表示で注入発動を通知し、恒久対応(レイアウトへのコンテナ追加)を促す
- last-good スナップショットと実ファイルの乖離(編集失敗が続く場合) — 診断表示に再読み込み失敗を出し続けることで気付きを担保。ID 一意化により古い照合表でも破壊は起きない
- `buildApplyPlan` のシグネチャ変更(LayoutIndex → LayoutSnapshot)による既存テストの改修漏れ — manifest-apply.test / module-runtime.test を同一タスクで更新し、5-1 の「衝突なしケース出力不変」を snapshot 的にアサート

## References
- `vendor/open-stage-control/src/client/remote-control.mjs` — /EDIT・/EDIT/MERGE の実挙動(v1.30.4 固定のため local ソースが正)
- `vendor/open-stage-control/src/client/widgets/containers/root.mjs` — root id の静的固定
- `vendor/open-stage-control/src/client/widgets/containers/modal.mjs` — modal ウィジェットの props 既定値
- `vendor/open-stage-control/src/server/node/custom-module.mjs` — loadJSON の実装(キャッシュなし・失敗時 undefined)
- [Open Stage Control Docs — Widgets](https://openstagecontrol.ammd.net/docs/widgets/general/) — modal / panel props の公式リファレンス(挙動確認は vendor ソースを優先)
