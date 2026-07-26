# Requirements Document

## Project Description (Input)
マニフェストの資産化と誤接続ガード。目的は 2 つ。(1) Unity 側のマニフェスト定義(公開する操作エントリの一覧)を、現在の OscSurfaceBridge.cs 内のハードコード配列(EntryDefs)から独立したファイルアセット(ScriptableObject または JSON アセット)へ外出しし、Scene/Prefab に埋め込まず Git 管理・別プロジェクトへの流用が可能な形にする。(2) ネットワーク内で誤って別プロジェクトの Unity を起動した場合に、本番運用中の OSC コントロールサーフェス UI がそのマニフェストで上書き再生成されない誤接続ガードを導入する。具体的にはマニフェストにプロジェクト識別子を追加し、Surface 側(custom module)の config に期待する識別子を設定して、不一致のマニフェストは拒否・診断ログに記録する。プロトコルのスキーマ変更(packages/shared)を伴うため version の互換性判断が必要。影響範囲: packages/shared のスキーマ、packages/custom-module の受信・採用ロジック、packages/mock-unity のシナリオ、OscSurface/ の参照実装(OscSurfaceBridge.cs)と付録 A、docs/UNITY_PROTOCOL.md、E2E テスト。絶対規律(O-S-C 本体無改造・Unity が真実の源・特定 OSC ライブラリ非依存)は維持する。

## Introduction
本仕様は Phase 5「マニフェストの資産化と誤接続ガード」の要件を定義する。対象は 2 つの独立した価値を持つ改善である。第一に、Unity 参照実装が公開する操作エントリの定義を C# ソース内のハードコード配列から独立したファイルアセットへ外出しし、Git 管理と別プロジェクトへの流用を可能にする(マニフェストの資産化)。第二に、マニフェストにプロジェクト識別子を追加し、Surface 側(custom module)が期待する識別子と照合することで、LAN 内で誤って起動された別プロジェクトの Unity によって運用中の UI が上書き再生成される事故を防ぐ(誤接続ガード)。

ユーザー決定事項(2026-07-26): (a) 定義・編集は ScriptableObject アセットで行い、送信時に JSON へシリアライズする。(b) 本プロトコルはリリース前であるため、version は 1 のまま識別子を必須フィールドとして追加する(識別子を持たないマニフェストはスキーマ検証で拒否)。(c) 識別子は人間が決める任意の文字列とする。(d) ガードの防御範囲はマニフェストのみとし、値のエコーバック受信は防がない(制限としてドキュメントに明記)。(e) ガード拒否イベントは debug 設定に関わらず常時 NDJSON に記録し、診断パネルにも表示する(誤接続は本番運用中に起きる事象のため)。(f) 識別子のフィールド名はマニフェスト側 `projectId`、Surface config 側 `expectedProjectId` とする。

## Boundary Context
- **In scope**: packages/shared のマニフェストスキーマ拡張、packages/custom-module の受信・採用ロジックへの識別子照合の追加と診断ログ記録、packages/mock-unity のシナリオ拡張、OscSurface/ 参照実装(OscSurfaceBridge.cs)のエントリ定義アセット化、docs/UNITY_PROTOCOL.md(本文および付録 A)と docs/VERIFICATION.md の更新、E2E テストの追加
- **Out of scope**: O-S-C 本体(`vendor/open-stage-control`)への一切の変更、認証・暗号化などセキュリティ目的のアクセス制御(本ガードは誤接続防止であり悪意ある送信者への対策ではない)、マニフェスト以外の `/sys/*` メッセージへの識別子付与、値のエコーバック受信の遮断(アドレスが偶然重複した別プロジェクトからの値更新は防がない。制限として文書化する)、Unity エディタ拡張(専用インスペクタ等)の作り込み
- **Adjacent expectations**: Phase 3 で構築済みの診断基盤(診断パネル、NDJSON ログ、isRepeat 抑制付き拒否ログ)を拡張して利用する。「Unity が真実の源」「案件差分はデータで表現」「特定 Unity OSC ライブラリ非依存(OSC 1.0 標準機能のみ)」の絶対規律を維持する

## Requirements

### Requirement 1: マニフェスト定義のファイルアセット化(Unity 側)
**Objective:** Unity 開発者として、公開する操作エントリの一覧を C# ソースコードから独立したファイルアセットで管理したい。それにより Scene/Prefab に依存せず Git で差分管理でき、別プロジェクトへ流用できるようにするため。

#### Acceptance Criteria
1. The Unity 参照実装(OscSurfaceBridge) shall マニフェストのエントリ定義を C# ソースコード内のハードコード配列ではなく、独立した ScriptableObject アセットから読み込む
2. The マニフェスト定義アセット shall Scene/Prefab に埋め込まれない単独のアセットファイルとして保存され、テキストベース(Unity の YAML シリアライズ)で Git 差分管理が可能である
3. The マニフェスト定義アセット shall プロジェクト識別子と操作エントリの一覧(アドレス・型・範囲・ラベル等、現行 EntryDefs と同等の情報)を保持し、Unity インスペクタで編集できる
4. When OscSurfaceBridge が有効化された時(OnEnable), the Unity 参照実装 shall 割り当てられたアセットから読み込んだ定義を JSON にシリアライズしてマニフェストを自発送信する
5. If マニフェスト定義アセットが未割り当てまたは読み込み不能である, the Unity 参照実装 shall エラーをログ出力し、マニフェストの送信を行わない
6. The 移行後の参照実装 shall 既存の EntryDefs と同一内容の定義をアセットとして同梱し、移行前と等価なマニフェストを送信できる

### Requirement 2: プロジェクト識別子のプロトコル拡張(packages/shared)
**Objective:** プロトコル設計者として、マニフェストにプロジェクト識別子を含める仕様を定義したい。それにより受信側がマニフェストの帰属プロジェクトを判別できるようにするため。

#### Acceptance Criteria
1. The 共有スキーマ(packages/shared) shall マニフェスト(version 1 のまま)にプロジェクト識別子フィールド `projectId` を必須項目として定義し、zod スキーマで検証可能にする
2. The プロジェクト識別子 shall 人間が決める空でない任意の文字列であり、OSC 1.0 標準の型のみで転送可能で、特定の Unity OSC ライブラリの独自機能に依存しない
3. If 識別子フィールドを持たない、または型・内容が不正な(空文字列を含む)マニフェストを受信した, the custom module shall スキーマ検証エラーとして拒否する(リリース前のため旧形式の受理は不要)
4. The 共有スキーマ shall 任意のマニフェストに対する検証結果が決定的である

### Requirement 3: 誤接続ガード(custom module の照合・採否ロジック)
**Objective:** 運用者として、別プロジェクトの Unity が同一 LAN 内で起動されても運用中の UI が上書きされないようにしたい。それにより本番運用中の操作画面を誤接続から保護するため。

#### Acceptance Criteria
1. The custom module shall 実行時設定(config)で期待するプロジェクト識別子 `expectedProjectId` を設定できる
2. When 期待識別子が設定された状態でスキーマ検証を通過したマニフェストを受信した時, the custom module shall マニフェスト内の識別子を期待識別子と照合する
3. When 識別子が期待値と一致するマニフェストを受信した時, the custom module shall 従来どおりマニフェストを採用し UI を再生成する
4. If 識別子が期待値と不一致である, the custom module shall そのマニフェストを拒否し、UI の再生成および表示キャッシュの更新を行わない
5. While 期待識別子が config に未設定である, the custom module shall 識別子照合をスキップし、スキーマ検証(識別子フィールドの存在検証を含む)のみで採否を判断する
6. While 不一致マニフェストの拒否が発生している, the custom module shall 採用済みの正しいマニフェストに基づく UI と値同期を継続する

### Requirement 4: 拒否の診断・可観測性
**Objective:** 運用者として、誤接続ガードによる拒否の発生と理由を確認できるようにしたい。それにより「UI が更新されない」事象の原因を切り分けられるようにするため。

#### Acceptance Criteria
1. When 識別子不一致によりマニフェストを拒否した時, the custom module shall debug 設定の有効・無効に関わらず、拒否理由・期待識別子・受信した識別子を診断ログ(NDJSON)に記録する
2. If 同一の拒否事由のマニフェストが繰り返し届く, the custom module shall 既存の isRepeat 抑制と同様の方式で重複ログの氾濫を抑制する
3. The 診断パネル shall 誤接続ガードによる拒否が発生したことを運用者が確認できる情報を表示する

### Requirement 5: テストハーネスの拡張(mock-unity / E2E)
**Objective:** 開発者として、誤接続ガードとアセット化後のマニフェストフローを自動テストで検証したい。それによりリグレッションを防ぎ、Phase 完了条件(テスト緑)を満たすため。

#### Acceptance Criteria
1. The mock-unity shall プロジェクト識別子を含むマニフェストを送信するシナリオを提供する
2. The mock-unity shall 期待値と異なる識別子を持つマニフェストを送信するシナリオ(誤接続の模擬)を提供する
3. The E2E テスト shall 識別子一致時にマニフェストが採用され UI が生成されることを検証する
4. The E2E テスト shall 識別子不一致時に UI が上書き再生成されず、拒否が診断ログに記録されることを検証する
5. The E2E テスト shall 期待識別子未設定時に識別子照合なしでマニフェストが採用されることを検証する
6. The 単体テスト shall 識別子フィールドを持たないマニフェストがスキーマ検証で拒否されることを検証する
7. The テストスイート shall `corepack pnpm test`(vitest 単体 + Playwright E2E)で全件成功する

### Requirement 6: ドキュメント整合(プロトコル仕様書・検証手順)
**Objective:** プロトコル利用者として、識別子仕様と互換性ルールを docs/UNITY_PROTOCOL.md から把握できるようにしたい。それにより任意の OSC ライブラリで互換実装を書けるようにするため。

#### Acceptance Criteria
1. The docs/UNITY_PROTOCOL.md shall プロジェクト識別子のフィールド定義(version 1 のまま必須化)・照合ルール・ガードの防御範囲の制限(値のエコーバックは防がない)を本文の該当節に反映する
2. When プロトコル仕様の本文を変更した時, the docs/UNITY_PROTOCOL.md shall 付録 A の参照実装全文も同時に更新し、OscSurfaceBridge.cs と内容一致の不変条件を維持する
3. If プロトコル設計上 OSC ライブラリ間で挙動が分かれ得る判断を行った, the docs/UNITY_PROTOCOL.md shall その判断を互換性ノートとして記録する
4. The docs/VERIFICATION.md shall 本フェーズの手動検証手順(識別子一致・不一致・アセット差し替えの確認を含む)を追記する
