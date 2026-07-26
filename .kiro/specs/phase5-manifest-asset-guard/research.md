# Research & Design Decisions — phase5-manifest-asset-guard

## Summary
- **Feature**: `phase5-manifest-asset-guard`
- **Discovery Scope**: Extension(既存システムの拡張。light discovery を適用)
- **Key Findings**:
  - 新規外部依存はゼロ。zod / uOSC / osc npm / Playwright の既存スタックのみで実現可能なため Web 調査は不要(Unity ScriptableObject の YAML シリアライズは標準機能)
  - OscSurface プロジェクトは `ProjectSettings/EditorSettings.asset` の `m_SerializationMode: 2`(Force Text)が設定済みであり、要件 1.2 の「YAML テキストで Git 差分管理」の前提は既に成立している
  - 診断エンジン(NDJSON ライタ含む)は `config.debug === true` のときのみ生成される。決定事項 (e) の「debug に関わらず常時記録」を満たすには、debug と独立した常時稼働の軽量イベントログ経路が必要
  - `ManifestClient.reject()` は無条件に `state = 'requesting'` へ戻す。settled 状態で不一致マニフェストを拒否した際にこの挙動を踏襲すると、正しい Unity への再要求と UI 全再適用が誘発され要件 3.6 と衝突する

## Research Log

### Unity 側: EntryDef のシリアライズ可能化
- **Context**: 現行 `EntryDef` は `readonly struct` + `object Initial` であり、Unity のシリアライズ規約(public もしくは `[SerializeField]` のフィールド、`object` 型不可、readonly 不可)に反するためそのまま ScriptableObject に載せられない
- **Sources Consulted**: `OscSurface/Assets/OscSurfaceBridge/OscSurfaceBridge.cs`(EntryDefs 配列、BuildManifestJson、RecordValue、Awake の初期値充填)、Unity 標準のシリアライズ規約(既知知識。新規調査不要)
- **Findings**:
  - `object Initial` は「default の有無 + 型付き値」を 1 フィールドで表現している。Unity シリアライズでは判別子 enum(`DefaultKind: None/Int/Float/String/Bool`)+ 型別フィールドに分解する必要がある
  - `HasRange + RangeMin/RangeMax` は既に判別子方式でありそのまま移せる
  - `{characterName}` トークン置換と「currentValues を default に埋める」処理は実行時の関心事であり、アセット(静的定義)ではなく Bridge 側に残す
  - `.asset` の YAML には `m_Script: {guid: <スクリプトの GUID>}` 参照が含まれる。GUID はプロジェクト固有のため、`.asset` 全文を付録 A の「内容一致不変条件」の対象に含めると他プロジェクトへの流用時に矛盾する
- **Implications**: `OscSurfaceManifestAsset`(ScriptableObject)+ `[Serializable] Entry` クラスを新設。付録 A の不変条件は C# ファイル集合に限定し、`.asset` は例示扱いとする(→ Decision: 付録 A 不変条件の再定義)

### custom module: 常時記録経路と NDJSON レコード拡張
- **Context**: 決定事項 (e)「ガード拒否は debug 無効でも NDJSON 記録 + 診断パネル表示」に対し、現行の記録経路(`DiagnosticsEngine` → `NdjsonWriter`)は debug 有効時のみ存在する
- **Sources Consulted**: `diagnostics-engine.ts` / `ndjson-writer.ts` / `ndjson-quota.ts` / `diag-panel-sink.ts` / `module-runtime.ts`
- **Findings**:
  - `NdjsonWriter.append` は `MessageRecord` 固定。ライタ自体は JSON.stringify するだけなのでレコード型の拡張は容易
  - `NdjsonWriter` は生成時に即ファイル作成(ストリームを eager open)する。常時生成に変えると debug 無効の毎起動で空ファイルが量産される → 初回 append まで open を遅延させる変更が必要
  - `selectPurgeTargets` は「現在書き込み中の 1 ファイル」だけを削除対象から除外する。ライタが 2 本(debug 用 + ガード用)になると保護対象を複数にする必要がある(Windows では open 中ファイルの unlink が失敗する)
  - 診断パネルへの表示は `receiveFn`(O-S-C の `receive()`)呼び出しだけで成立し、DiagnosticsEngine の存在に依存しない。存在しないウィジェットアドレスへの `receive()` は無害
  - `oscOutFilter` の `/surface/*` 送出遮断は OSC 出力の話であり、`receive()` によるパネル更新には影響しない
- **Implications**: debug と独立に常時生成する `GuardEventLog` コンポーネントを新設し、専用 NDJSON ファイル(遅延 open)+ パネル発行(`/surface/diag/guard`)を持たせる。`NdjsonWriter` はレコード型を union 化 + 遅延 open 化。`selectPurgeTargets` は保護ファイル名を複数受け取る形へ変更

### ManifestClient の状態機械と拒否理由の拡張
- **Context**: 不一致拒否(project-mismatch)を既存の拒否経路に追加した場合の状態遷移の妥当性
- **Sources Consulted**: `manifest-client.ts`、`module-runtime.ts`(applyManifest / requestManifestIfNeeded / onReachabilityRecovered)
- **Findings**:
  - 既存 reject(json-parse-error / schema-error)は `state = 'requesting'` に戻し再要求を継続する。これは「正しい Unity からの応答が壊れていた」ケースに合理的
  - project-mismatch は「別プロジェクトの Unity から届いた」ケースであり、settled 状態から requesting に戻すと正しい Unity へ再要求 → 正常マニフェスト受信 → UI 全再適用が発生し、運用中の UI を無用に再生成してしまう(要件 3.6 違反)
  - requesting 状態(未採用)での不一致は、再要求を継続すべきなので requesting のまま維持でよい
  - isRepeat 抑制は `reason:detail` キーの一致比較。detail に expected/received の両識別子を含めれば「別の不一致 Unity が現れた」ときに抑制が解けて再記録される
- **Implications**: 拒否理由 `'project-mismatch'` を追加し、この理由に限り **状態を変更しない**(settled は settled のまま、requesting は requesting のまま)。`expectedProjectId` は config 読み込み後に確定するため、コンストラクタでなく `onManifestPayload` の引数で渡す(ManifestClient を config 非依存・テスト容易に保つ)

### 破壊的変更の波及範囲(update-together 制約)
- **Context**: `ManifestSchema` に `projectId` を必須追加すると、どこが同時に壊れるか
- **Sources Consulted**: `packages/mock-unity/src/scenario.ts`(コンストラクタと `manifestJson()` が `ManifestSchema.parse` を実行)、`scenarios/*.json`、`OscSurfaceBridge.cs`、E2E テスト
- **Findings**:
  - `ScenarioRuntime` はコンストラクタで `ManifestSchema.parse` するため、shared 変更を入れた瞬間に既存シナリオ(default.json / invalid-manifest.json)がロード不能になる
  - Unity 参照実装の `BuildManifestJson()` も projectId を含めない限り Surface に拒否される
  - `rawManifestOverride` を使う invalid-manifest.json はマニフェスト構築を迂回するが、`ScenarioSchema` に projectId を必須で足すならファイル自体の更新は必要
- **Implications**: shared スキーマ変更 → mock-unity(スキーマ・シナリオ・CLI)→ custom module → Unity 参照実装 → docs は **同一実装バッチで更新しなければテストが緑にならない**。design.md にタスク順序制約として明記する(→ Migration Strategy)

### mock-unity のシナリオ・CLI 拡張方式
- **Context**: 誤接続模擬シナリオの表現方法(専用シナリオファイル vs CLI 上書き)
- **Sources Consulted**: `packages/mock-unity/src/index.ts`(`--character-name` の前例)、DESIGN.md D-012(シナリオはデータファイル + CLI 上書き)
- **Findings**:
  - D-012 の既存方針は「データファイルが正、CLI は上書き」。`--character-name` は `--scenario` 必須の従属フラグとして実装済み
  - 誤接続の模擬は「エントリ構成も異なる別プロジェクト」を再現した方が E2E の検証力が高い(UI が上書きされないことをエントリ差分で確認できる)
- **Implications**: `scenarios/wrong-project.json`(異なる projectId + 異なるエントリ構成)を新設し、加えて `--project-id` CLI 上書き(`--scenario` 必須)も提供する(→ Decision)

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. DiagnosticsEngine を常時生成 | debug=false でもフルの診断エンジンを起動 | 記録経路が一本化 | debug の意味論(リングバッファ・全メッセージ記録)が崩れる。ログ量増大 | 不採用 |
| B. 常時稼働の軽量 GuardEventLog を新設 | ガードイベント専用の NDJSON + パネル発行を debug と独立に生成 | debug の意味論を維持。責務が明確。遅延 open で空ファイルなし | ライタが 2 本になり purge 保護の拡張が必要 | **採用** |
| C. ガードイベントを console ログのみに | NDJSON を書かず logError だけ | 変更最小 | 決定事項 (e) に違反(常時 NDJSON 記録が要求) | 不採用 |

## Design Decisions

### Decision: 常時稼働の GuardEventLog を新設する
- **Context**: 決定事項 (e) — ガード拒否は debug 設定に関わらず NDJSON 記録 + 診断パネル表示
- **Alternatives Considered**: 上表 A / B / C
- **Selected Approach**: `guard-event-log.ts` を新設。`init()` で debug 判定の外で常に生成し、専用 NDJSON ファイル(`osc-guard-<timestamp>.ndjson`、初回 append まで open 遅延)への追記と `/surface/diag/guard` へのパネル発行を担う
- **Rationale**: debug モードの既存意味論(全メッセージ記録)を汚さず、誤接続という「本番で起きる事象」の記録を独立経路で保証できる
- **Trade-offs**: NDJSON ライタが 2 本になる。purge 保護対象を複数化(`currentFileNames`)する小変更が必要。quota 計算は `.ndjson` 拡張子集計のため自動的にガードログも含まれる(好都合)
- **Follow-up**: 空ファイルが作られないこと(遅延 open)、purge がガードログの書き込み中ファイルを消さないことをユニットテストで検証

### Decision: NDJSON レコードは MessageRecord 非変更 + GuardEventRecord 追加の union とする
- **Context**: `NdjsonWriter.append` の型拡張方式。ハンドオーバーでは判別 union が推奨
- **Alternatives Considered**:
  1. `MessageRecord` に `kind: 'message'` を追加して完全な判別 union 化 — 既存 NDJSON 行形式・Phase 3 のテスト・diag-panel-sink に波及
  2. `MessageRecord` 無変更 + `kind: 'guard-reject'` を持つ `GuardEventRecord` を追加し、`append(record: MessageRecord | GuardEventRecord)` の TS union とする
- **Selected Approach**: 案 2。行の判別は「`kind` フィールドの有無」(guard 行のみ `kind: 'guard-reject'` を持つ)
- **Rationale**: 既存の NDJSON 行形式と Phase 3 テストを無傷に保つ。ファイル自体も分離(`osc-debug-*` と `osc-guard-*`)されるため実運用上の判別も自明
- **Trade-offs**: zod の discriminatedUnion による単一スキーマでの網羅検証はしない(ファイル分離とフィールド有無で十分と判断)
- **Follow-up**: `GuardEventRecordSchema` を shared に置き、mock 消費者(テスト)が同スキーマで検証できるようにする

### Decision: project-mismatch 拒否は ManifestClient の状態を変更しない
- **Context**: 要件 3.6(不一致拒否中も採用済み UI と値同期を継続)とギャップ分析ハンドオーバー 3
- **Alternatives Considered**:
  1. 既存 reject と同様に `state = 'requesting'` へ戻す — settled 時に正しい Unity への再要求 + UI 全再適用が発生
  2. project-mismatch のみ状態不変(settled → settled、requesting → requesting)
- **Selected Approach**: 案 2。`expectedProjectId` は `onManifestPayload(json, options)` の引数で受け取り、スキーマ検証通過後に照合する
- **Rationale**: 不一致は「応答が壊れている」のではなく「送信元が違う」事象であり、採用済み状態を動かす理由がない。requesting 中は再送継続が必要なので requesting のまま維持で両立する
- **Trade-offs**: reject 経路が理由により分岐する(実装の条件分岐が 1 つ増える)。isRepeat キーは `project-mismatch:expected=<e>;received=<r>` 形式とし、別の不一致元が現れたら再記録される
- **Follow-up**: settled 中の不一致で `shouldRequest` が false のままであること、requesting 中の不一致で再送が継続することをユニットテストで固定

### Decision: マニフェスト定義は ScriptableObject + 判別子 enum 方式のエントリで表現する
- **Context**: ユーザー決定 (a) と、`object Initial` が Unity シリアライズ不能である問題
- **Alternatives Considered**:
  1. default を文字列 1 フィールドで持ち実行時にパース — 型安全性が低くインスペクタ編集でミスしやすい
  2. `DefaultKind` enum(None/Int/Float/String/Bool)+ 型別フィールド(defaultInt/defaultFloat/defaultString/defaultBool)
- **Selected Approach**: 案 2。type/widget も文字列でなく enum(`EntryType` / `WidgetType`)で持ち、送信時にワイヤ表現("i"/"f"/"s"/"b"/"bool" 等)へ変換する
- **Rationale**: インスペクタでドロップダウン編集でき、不正値がシリアライズ層で作れない。ワイヤ表現との対応は Bridge 側の変換関数 1 箇所に集約
- **Trade-offs**: フィールド数は増えるが、YAML 差分は明示的で読みやすい
- **Follow-up**: enum → ワイヤ文字列変換の網羅(switch の default で LogError)を参照実装に含める

### Decision: 付録 A の内容一致不変条件を「C# ファイル集合」に再定義する
- **Context**: アセット化により Unity 側コードが OscSurfaceBridge.cs + OscSurfaceManifestAsset.cs の 2 ファイルに分割される(ハンドオーバー 5)
- **Selected Approach**: 付録 A.2 を「A.2.1 OscSurfaceBridge.cs 全文」「A.2.2 OscSurfaceManifestAsset.cs 全文」の 2 節構成にし、内容一致不変条件(要件 6.2)は各 C# ファイルごとにリポジトリ実ファイルと全文一致とする。同梱 `.asset` は YAML 例示(抜粋)として掲載するが、`m_Script` の GUID がプロジェクト固有のため不変条件の対象外と明記する
- **Rationale**: `.asset` を不変条件に含めると GUID のプロジェクト固有性と矛盾し、他プロジェクト流用(要件 1 の目的)を阻害する
- **Trade-offs**: `.asset` の内容ドリフトは不変条件で守られない → VERIFICATION.md の手動確認(等価マニフェスト送信)で担保
- **Follow-up**: 付録 A.3 の対応表も 2 ファイル構成に合わせて更新

### Decision: 誤接続模擬は専用シナリオファイル + `--project-id` CLI 上書きの両方を提供する
- **Context**: 要件 5.2 とハンドオーバー 7。D-012(データファイル + CLI 上書き)との整合
- **Selected Approach**: `scenarios/wrong-project.json`(異なる projectId **かつ** 異なるエントリ構成)を新設し、`--project-id`(`--scenario` 必須、`--character-name` と同型)も追加する
- **Rationale**: 専用ファイルはエントリ構成まで異なる「別プロジェクト」を忠実に模擬でき、E2E で「UI が上書きされない」ことをエントリ差分で強く検証できる。CLI 上書きは同一エントリで識別子だけ違うケースの検証やアドホックな手動確認に有用
- **Trade-offs**: シナリオファイルが 1 つ増える(保守対象増)が軽微
- **Follow-up**: READY 行(`MOCK_UNITY_READY`)のペイロードに解決済み projectId を含め、E2E から観測可能にする

### Decision: 既定 projectId は "osc-surface-demo" とし、リポジトリ config にも expectedProjectId を設定する
- **Context**: 同梱アセット・default.json シナリオ・config/surface.config.json の整合
- **Selected Approach**: Unity 同梱アセットと `scenarios/default.json` の projectId を `"osc-surface-demo"` に揃え、`config/surface.config.json` に `"expectedProjectId": "osc-surface-demo"` を設定する
- **Rationale**: リポジトリ既定構成のままでループバック・実機検証がガード有効状態で成立し、ガードが常用される(未設定運用が既定にならない)
- **Trade-offs**: expectedProjectId 未設定ケース(3.5)は E2E の一時 config で明示的にカバーする必要がある(既存 E2E は一時 config を生成する方式なので影響なし)

## Risks & Mitigations
- **shared スキーマ変更の同時破壊**(mock-unity シナリオ・Unity 参照実装・E2E が一斉に壊れる)— design.md の Migration Strategy に update-together 制約を明記し、tasks 生成時に単一バッチへまとめる
- **Windows での open 中 NDJSON ファイル purge 失敗** — `selectPurgeTargets` の保護対象を `currentFileNames`(複数)へ拡張し、ガードログの現行ファイルを常に除外
- **`.meta` GUID の衝突**(ユーザーグローバルルール)— 新規 `.asset` / `.cs` の `.meta` は Unity Editor(uloop 経由)での生成を第一候補とし、手書きする場合は `[guid]::NewGuid().ToString('N')` 等でランダム 32 桁 hex を生成。連続・ローテーションパターン禁止
- **uloop / Unity Editor 操作の罠**(MEMORY: D:\UnityEditors 直起動、scoped registry モーダルでメインループ停止)— アセット生成タスクは Editor 操作手順を明記し、失敗時は手書き `.meta` フォールバック
- **診断パネルの新規クライアント欠落**(接続後にガード行の値が届かない)— `sessionOpened` フックで `publishTo(clientId)` を呼び、既存の acceptedPlan 再適用と同じ経路で補完

## References
- `docs/UNITY_PROTOCOL.md` §2 / §4.3 / 付録 A — 変更対象のプロトコル本文と参照実装
- `DESIGN.md` D-009(sessionOpened 二経路適用)/ D-012(シナリオ = データ + CLI 上書き)/ D-016(JSON 手書きビルダ)— 本設計が踏襲する既存判断
- `OscSurface/ProjectSettings/EditorSettings.asset` `m_SerializationMode: 2` — Force Text 確認済み(要件 1.2 の前提)
- ユーザーグローバルルール「Unity .meta GUID」— 新規 .meta の GUID 生成規律
