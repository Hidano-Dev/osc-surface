# Requirements Document

## Project Description (Input)
Phase 2 — マニフェスト駆動 UI。Unity(mock-unity)が /sys/manifest/request に応答して返す manifest JSON(version/entries: address, type, label, range, 初期値, group 等)を custom module が受信・zod 検証し、O-S-C のリモートコマンド(/EDIT 等)で既存レイアウトのウィジェットのラベル・レンジ・初期値を動的更新する。キャラクター名など実行時にしか決まらない値をマニフェスト経由で UI に反映し、マニフェストの現在値で UI 表示を Unity の実状態に同期させる。mock-unity に「キャラ名が毎回変わる」シナリオを持たせて E2E 検証する。案件差分はコードでなくデータ(マニフェスト/レイアウト/config)で表現する規律に従う。

## Introduction

Phase 2 では OSC Surface のマニフェスト駆動 UI を実装する。Unity(開発・テストでは mock-unity)が `/sys/manifest/request` への応答として返すマニフェスト JSON を custom module が受信・検証し、O-S-C のリモートコマンド(`/EDIT` 等)で既存レイアウトのウィジェットのラベル・レンジ・値を動的更新する。マニフェストにのみ存在しレイアウトに対応ウィジェットがないエントリについては、エントリの型情報に基づいてウィジェットを動的生成する。これにより、キャラクター名など実行時にしか決まらない値をマニフェスト経由で UI に反映し、UI 表示を Unity の実状態に同期させる。

本 Phase は Phase 1 で確立したプロトコル基盤(`packages/shared` のマニフェスト zod スキーマ、mock-unity レスポンダ、custom module の到達性計測、E2E ハーネス)の上に構築する。前提となるプロジェクト規律: O-S-C 本体(`vendor/open-stage-control`)は無改造、Unity が真実の源(UI は表示キャッシュ)、プロトコルは OSC 1.0 標準の機能のみで成立させる、案件差分はコードでなくデータ(マニフェスト/レイアウト/config)で表現する。

## Boundary Context

- **In scope**: custom module のマニフェストハンドシェイク(`/sys/manifest/request` 送信・`/sys/manifest` 受信・zod 検証)、マニフェスト → O-S-C リモートコマンド(`/EDIT` 等)変換によるウィジェットのラベル・レンジ・値の動的更新、レイアウトに対応ウィジェットがないエントリのウィジェット動的生成、マニフェストの現在値による UI 表示同期、mock-unity のマニフェスト応答と「キャラ名が毎回変わる」シナリオ、これらを検証する単体テスト・E2E テスト、関連ドキュメント更新(`docs/VERIFICATION.md`・`docs/UNITY_PROTOCOL.md`・`CLAUDE.md`・`DESIGN.md`)
- **Out of scope**: 診断パネル・デバッグモード・NDJSON 記録・サブネット判定(Phase 3)、実 Unity 接続手順書と uOSC 付録(Phase 4)、O-S-C 本体への一切の変更
- **Adjacent expectations**: Phase 1 で定義済みの `packages/shared` のマニフェストスキーマ(`ManifestSchema`)を単一の契約として利用する(スキーマ変更が必要な場合は互換性への影響を記録する)。Phase 1 の到達性計測(ping/pong)と mock-unity のエコーバックはそのまま動作を維持する。Phase 3 の診断パネルは本 Phase のマニフェスト適用結果に依存しない。

## Requirements

### Requirement 1: マニフェストハンドシェイク(custom module)

**Objective:** As a サーフェス運用者, I want custom module が Unity へマニフェストを要求し応答を検証して受け入れること, so that 実行時にしか決まらないパラメータ定義を人手設定なしで UI に取り込める

#### Acceptance Criteria

1. When custom module が起動し宛先への送信が可能になった場合, the custom module shall 設定された宛先へ `/sys/manifest/request`(引数なし)を送信する
2. If 送信した `/sys/manifest/request` に対する `/sys/manifest` 応答が一定時間内に受信されない場合, the custom module shall 要求を再送し、応答を受信するまで再試行を継続する
3. When ping/pong の到達性が喪失状態から回復した場合, the custom module shall `/sys/manifest/request` を再送信し、最新のマニフェストを取得し直す
4. When `/sys/manifest (string json)` を受信した場合, the custom module shall JSON をパースし `packages/shared` のマニフェストスキーマ(zod)で検証する
5. If 受信したマニフェストが JSON としてパースできない、またはスキーマ検証に失敗した場合, the custom module shall 当該マニフェストを UI に適用せず、原因を特定できる情報をログに出力し、直前の UI 状態を維持して稼働を継続する
6. When スキーマ検証に成功したマニフェストを受信した場合, the custom module shall そのマニフェストを最新版として採用し、ウィジェット更新(Requirement 2)を実行する
7. The custom module shall `/sys/manifest` などのシステムメッセージをレイアウトのウィジェット側へ素通しさせない

### Requirement 2: マニフェストによる動的ウィジェット更新・生成

**Objective:** As a サーフェス利用者, I want マニフェストの内容がレイアウトのウィジェットへ自動反映され、足りないウィジェットは自動で追加されること, so that キャラクター名などの実行時情報を含む正しいラベル・レンジ・値で、マニフェストにある全パラメータを操作できる

#### Acceptance Criteria

1. When 検証済みマニフェストを採用した場合, the custom module shall 各エントリの `address` に対応する既存ウィジェットに対し、O-S-C のリモートコマンド(`/EDIT` 等)で `label` を反映する
2. When 検証済みマニフェストのエントリに `range` が含まれる場合, the custom module shall 対応するウィジェットのレンジを当該値へ更新する
3. If マニフェストのエントリに対応するウィジェットが既存レイアウトに存在しない場合, the custom module shall 当該エントリの `type`・`label`・`range`・現在値に基づき、対応する種類のウィジェット(数値ならスライダー等)を動的に生成してレイアウトへ追加する
4. When ウィジェットを動的に生成する場合, the custom module shall 生成ウィジェットの送信先アドレスをエントリの `address` と一致させ、手動配置されたウィジェットと同じ操作・同期の規律(エコーバック確定等)で動作させる
5. When 新しい検証済みマニフェストを受信し直した場合, the custom module shall 動的生成済みウィジェットを最新のマニフェスト内容で更新し、最新のマニフェストに存在しなくなった動的生成ウィジェットをレイアウトから取り除く(手動配置されたウィジェットは取り除かない)
6. If 既存レイアウトのウィジェットに対応するエントリがマニフェストに存在しない場合, the custom module shall 当該ウィジェットの表示を変更せず維持する
7. Where マニフェストのエントリに `group` が含まれる場合, the custom module shall グループ情報を UI のセクション分け(動的生成ウィジェットの配置先セクション・見出し表示等)へ反映する
8. The custom module shall マニフェストから O-S-C リモートコマンドへの変換ロジック(更新・生成の両方)を、O-S-C 実行環境なしの単体テスト(vitest)で検証可能な純粋ロジックとして提供する
9. The custom module shall マニフェストのエントリとウィジェットの対応付け、およびエントリの `type` から生成するウィジェット種類への対応を、コード内の案件固有分岐ではなくデータ(マニフェスト・レイアウト定義・対応表)に基づいて解決する

### Requirement 3: 現在値による UI 表示同期

**Objective:** As a サーフェス利用者, I want UI の表示値が Unity の実状態と一致すること, so that 接続直後や再接続後も実際の状態を信頼して操作できる

#### Acceptance Criteria

1. When 検証済みマニフェストのエントリに現在値(`default`)が含まれる場合, the custom module shall 対応するウィジェットの表示値を当該現在値へ更新する
2. When マニフェストの現在値をウィジェットへ反映する場合, the custom module shall 当該反映を表示更新として扱い、Unity への OSC 送信(フィードバックループ)を発生させない
3. When マニフェスト適用後にユーザーがウィジェットを操作し Unity が同一アドレスへ確定値をエコーバックした場合, the OSC Surface shall エコーバックされた値でウィジェット表示を確定する
4. While ユーザーがウィジェットをドラッグ操作している間, the OSC Surface shall 当該ウィジェットのアドレスへの受信値を表示に反映せず、操作終了後の最終エコーバックで整合させる
5. The custom module shall UI 側の操作値を確定状態として扱わず、値の確定を Unity からのエコーバックのみに依拠する(Unity が真実の源)

### Requirement 4: mock-unity のマニフェスト応答と「キャラ名が毎回変わる」シナリオ

**Objective:** As a 開発者・テスト作成者, I want mock-unity が仕様通りのマニフェスト応答と実行時可変のキャラ名シナリオを提供すること, so that 実 Unity なしでマニフェスト駆動 UI の全経路を自動検証できる

#### Acceptance Criteria

1. When `/sys/manifest/request` を受信した場合, the mock-unity shall `packages/shared` のマニフェストスキーマに適合する JSON を文字列化した `/sys/manifest (string json)` を返信元へ返信する
2. The mock-unity shall マニフェストの各エントリに自身が保持する現在値を `default` として含める
3. The mock-unity shall 起動ごとに変化するキャラクター名を生成し、マニフェストの該当エントリ(ラベル等)へ反映する「キャラ名が毎回変わる」シナリオを提供する
4. The mock-unity shall 既存レイアウトに対応ウィジェットが存在しないエントリを含むシナリオを提供し、ウィジェット動的生成の検証を可能にする
5. The mock-unity shall マニフェストの内容(エントリ構成・可変部分の生成規則)をコード内の案件固有分岐ではなくデータ(設定・シナリオ定義)で差し替え可能にする
6. The mock-unity shall マニフェスト応答を含む全ての送受信を OSC 1.0 標準の機能のみで行い、特定 OSC ライブラリ固有の挙動に依存しない
7. The mock-unity shall テストコードから起動ごとのキャラクター名(可変値)を取得または固定指定でき、E2E テストで期待値照合を可能にする

### Requirement 5: E2E 検証(マニフェスト反映のループバック試験)

**Objective:** As a 開発者, I want O-S-C headless と mock-unity によるマニフェスト駆動 UI の自動 E2E テスト, so that ハンドシェイクからウィジェット反映までの全経路をコマンド一発・CI 想定のヘッドレスで継続的に検証できる

#### Acceptance Criteria

1. The E2E テスト shall O-S-C を headless で custom module とレイアウトを読み込んで起動し、mock-unity とループバック(localhost)で接続した状態でマニフェストハンドシェイクの成立(要求送信と検証済み応答の受信)を自動検証する
2. The E2E テスト shall マニフェスト適用後のウィジェット状態(ラベル・レンジ・表示値)が mock-unity の返したマニフェスト内容と一致することを自動検証する
3. The E2E テスト shall 既存レイアウトに対応ウィジェットがないエントリからウィジェットが動的生成され、そのウィジェットの操作値送信とエコーバックによる確定が成立することを自動検証する
4. The E2E テスト shall mock-unity の再起動(または再シナリオ実行)によりキャラクター名が変化した際、新しいキャラクター名が UI へ反映されることを自動検証する
5. The E2E テスト shall 不正なマニフェスト(スキーマ違反)を受信した場合に custom module が稼働を継続し UI へ適用しないことを自動検証する
6. When `corepack pnpm test` を実行した場合, the テストスイート shall Phase 1 までの既存テストと Phase 2 の単体・E2E テストを人手操作なしで完走し、結果を合否として報告する
7. When テストが終了した場合(失敗時を含む), the E2E テスト shall 起動した O-S-C・mock-unity のプロセスを確実に終了させ、使用ポートを解放する

### Requirement 6: プロトコル規律・構成管理の遵守

**Objective:** As a プロジェクトオーナー, I want Phase 2 実装がプロジェクトの絶対規律を守ること, so that 案件展開時にコード変更なしでマニフェスト・レイアウト・config の差し替えだけで対応できる

#### Acceptance Criteria

1. The Phase 2 実装 shall `vendor/open-stage-control`(lockfile 含む)へ一切の変更を加えず、動的ウィジェット更新を custom module とレイアウトの範囲で実現する
2. If O-S-C のリモートコマンド(`/EDIT` 等)では実現できない更新要件が判明した場合, the 開発プロセス shall 本体改造や回避策を独断で実装せず、選択肢を添えてユーザーへ報告する
3. The Phase 2 実装 shall `/sys/*` アドレスとマニフェストスキーマを `packages/shared` から参照し、各パッケージでの重複定義をしない
4. The Phase 2 実装 shall 案件・シナリオ固有の値(キャラクター名・パラメータ構成・宛先等)をコードへハードコードせず、マニフェスト・レイアウト・config のデータで表現する
5. If マニフェストハンドシェイクに関して OSC 1.0 標準のみでは実現できない、または OSC ライブラリ間で解釈が割れる仕様点(文字列エンコーディング・最大データグラム長等)が判明した場合, the 開発プロセス shall `docs/UNITY_PROTOCOL.md` の互換性ノートに記録する

### Requirement 7: ドキュメントと進捗の更新

**Objective:** As a プロジェクト保守者, I want Phase 2 の完了状態と決定事項がドキュメントに反映されること, so that 手動検証を再現でき、次 Phase や実 Unity 実装者への引き継ぎで文脈が失われない

#### Acceptance Criteria

1. When Phase 2 の実装と自動テストが完了した場合, the プロジェクトドキュメント shall `docs/VERIFICATION.md` に Phase 2 の手動検証手順(mock-unity 起動、O-S-C 起動、マニフェスト反映とキャラ名変化の確認方法)を追記する
2. When Phase 2 の実装と自動テストが完了した場合, the プロジェクトドキュメント shall `CLAUDE.md` の Phase 進捗を Phase 2 完了に更新する
3. The プロジェクトドキュメント shall `docs/UNITY_PROTOCOL.md` のマニフェストハンドシェイク仕様を、本 Phase で確定した挙動(要求の再送、再接続時の再取得、現在値同期、エラー時の扱い)で詳細化する
4. When マニフェスト適用方式(リモートコマンドの選定・ウィジェット対応付け・再送方式等)に関する設計判断を行った場合, the プロジェクトドキュメント shall `DESIGN.md` に判断内容と理由を記録する
