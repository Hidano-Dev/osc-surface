# Requirements Document

## Project Description (Input)
Phase 1 プロトコル基盤 — OSC Surface の /sys/* プロトコル基盤を実装する。対象: (1) packages/shared に /sys/* の zod スキーマ(manifest / stats)を実装(アドレス定数は実装済み)。(2) packages/mock-unity に OSC 1.0 標準のみに依存する OSC レスポンダを実装(/sys/ping→/sys/pong、/sys/stats/request→/sys/stats、通常メッセージのエコーバック)。(3) packages/custom-module に 2 秒間隔の ping 送信と RTT・連続喪失数の保持を実装。(4) tests/ に O-S-C headless + mock-unity のループバック疎通 E2E を vitest で実装し corepack pnpm test で自動検証。完了時に docs/VERIFICATION.md へ Phase 1 手順を追記し、CLAUDE.md の Phase 進捗を更新する。制約: O-S-C 本体 (vendor/open-stage-control) は無改造、Unity が真実の源、特定 OSC ライブラリ非依存(OSC 1.0 標準のみ)。要検討事項: mock-unity の OSC ライブラリ選定(自前実装 vs osc npm パッケージ)。参照: claude-code-initial-prompt.md(全 Phase 要件原文)、HANDOVER.md、docs/UNITY_PROTOCOL.md(草稿)、DESIGN.md。

## Introduction

Phase 1 では OSC Surface の `/sys/*` プロトコル基盤を実装する。具体的には、`packages/shared` のプロトコルスキーマ(zod)、`packages/mock-unity` の OSC レスポンダ、`packages/custom-module` の到達性計測(ping/pong・RTT・連続喪失数)、および O-S-C headless + mock-unity のループバック E2E テストを対象とする。本 Phase の成果は、実 Unity なしで全機能を自動検証できるテスト土台と、Phase 2 以降(マニフェスト駆動 UI・診断パネル)が依存するプロトコル契約の確立である。

前提となるプロジェクト規律: O-S-C 本体(`vendor/open-stage-control`)は無改造、Unity が真実の源(UI は表示キャッシュ)、プロトコルは OSC 1.0 標準の機能(基本型タグ・bundle・timetag)のみで成立させる、案件差分はコードでなくデータで表現する。

## Boundary Context

- **In scope**: `/sys/*` ペイロード(stats / manifest)の zod スキーマ、mock-unity レスポンダ(ping/pong・stats 応答・通常メッセージのエコーバック)、custom module の 2 秒間隔 ping 送信と RTT・連続喪失数の保持、ループバック E2E テスト(`corepack pnpm test` で完走)、関連ドキュメント更新(`docs/VERIFICATION.md`・`docs/UNITY_PROTOCOL.md`・`CLAUDE.md`・`DESIGN.md`)
- **Out of scope**: マニフェストハンドシェイクの実行と動的ウィジェット更新(Phase 2)、診断パネル・デバッグモード・NDJSON 記録・サブネット判定(Phase 3)、実 Unity 接続手順書と uOSC 付録(Phase 4)、O-S-C 本体への一切の変更
- **Adjacent expectations**: Phase 2 は本 Phase で定義するマニフェストスキーマ(`packages/shared`)をそのまま利用する。Phase 3 の診断パネルは本 Phase の RTT・連続喪失数の計測値を表示ソースとして利用する。`docs/UNITY_PROTOCOL.md` は Phase 4 で完成させるため、本 Phase では確定事項の詳細化のみ行う。

## Requirements

### Requirement 1: 共有プロトコルスキーマ(packages/shared)

**Objective:** As a プロトコル実装者, I want `/sys/*` ペイロードの zod スキーマと型定義, so that custom module・mock-unity・テストが単一の契約(single source of truth)を共有できる

#### Acceptance Criteria

1. The shared パッケージ shall `/sys/stats` の JSON ペイロード(`received`: 整数, `parseErrors`: 整数, `lastReceivedAt`: ISO-8601 文字列)を検証する zod スキーマと、それに対応する TypeScript 型を提供する
2. The shared パッケージ shall `docs/UNITY_PROTOCOL.md` 記載のマニフェスト構造(`version`, `entries[]` の `address` / `label` / `type` / `widget` / `range?` / `default?` / `group?`)を検証する zod スキーマと、それに対応する TypeScript 型を提供する
3. When 必須フィールドの欠落・型不一致・許容外の列挙値を含むペイロードを検証した場合, the shared スキーマ shall 検証エラーを返し、原因フィールドを特定できる情報を含める
4. The shared パッケージ shall ビルド工程なしで TS ソースを直接参照できる現行の提供形態を維持する
5. The shared パッケージ shall スキーマの受理ケース・拒否ケースを網羅する単体テスト(vitest)を持つ

### Requirement 2: mock-unity OSC レスポンダ

**Objective:** As a 開発者・テスト作成者, I want 実 Unity なしで `/sys/*` に仕様通り応答する Node 製 OSC レスポンダ, so that 全機能をローカルと CI で自動検証できる

#### Acceptance Criteria

1. When `/sys/ping (int seq)` を受信した場合, the mock-unity shall 同一の `seq` を引数とする `/sys/pong (int seq)` を即時返信する
2. When `/sys/stats/request` を受信した場合, the mock-unity shall 自身の受信統計 `{ received, parseErrors, lastReceivedAt }` を JSON 文字列化した `/sys/stats (string json)` を返信する
3. When `/sys/` 名前空間以外の OSC メッセージを受信した場合, the mock-unity shall 同一アドレス・同一引数のメッセージを返信元へエコーバックする
4. The mock-unity shall 受信メッセージ数(`received`)・パース失敗数(`parseErrors`)・最終受信時刻(`lastReceivedAt`)を集計し、`/sys/stats` の応答は Requirement 1 の stats スキーマに適合する
5. If OSC としてパースできない UDP データグラムを受信した場合, the mock-unity shall プロセスを停止せず `parseErrors` を加算して受信を継続する
6. The mock-unity shall OSC 1.0 標準の機能(基本型タグ・bundle・timetag)のみでエンコード・デコードを行い、特定 OSC ライブラリ固有の拡張や挙動に依存しない
7. The mock-unity shall 待受ポートと返信先(ホスト・ポート)を起動時の引数または設定で指定でき、テストコードからプロセスとして起動・停止できる

### Requirement 3: custom module の到達性計測(ping/pong)

**Objective:** As a サーフェス運用者, I want custom module が Unity(または mock-unity)への到達性を常時計測すること, so that 接続状態を把握でき、Phase 3 の診断パネルの計測ソースになる

#### Acceptance Criteria

1. While custom module が稼働している間, the custom module shall 2 秒間隔で単調増加する `seq` を持つ `/sys/ping (int seq)` を設定された宛先へ送信し続ける
2. When 送信済み `seq` に対応する `/sys/pong (int seq)` を受信した場合, the custom module shall 当該 ping の RTT を算出して最新値として保持し、連続喪失数を 0 にリセットする
3. If 送信した ping に対応する pong が次の ping 送信時点までに受信されない場合, the custom module shall 連続喪失数を 1 加算する
4. If 未知または期限切れの `seq` を持つ pong を受信した場合, the custom module shall その pong を RTT 計測に反映せず破棄する
5. The custom module shall `/sys/pong` などのシステムメッセージをレイアウトのウィジェット側へ素通しさせない(UI に不要な `/sys/*` 受信を流さない)
6. The custom module shall ping の宛先ホスト・ポートを `config/surface.config.json` から読み込み、コード変更なしに変更可能にする
7. The custom module shall RTT・連続喪失数の計測ロジックを単体テスト(vitest)で検証可能な形で提供する

### Requirement 4: E2E ループバック疎通テスト

**Objective:** As a 開発者, I want O-S-C headless と mock-unity をループバック接続する自動 E2E テスト, so that プロトコル基盤の疎通をコマンド一発・CI 想定のヘッドレスで継続的に検証できる

#### Acceptance Criteria

1. The E2E テスト shall O-S-C を headless(no-gui)で custom module とレイアウトを読み込んで起動し、mock-unity とループバック(localhost)で接続する
2. The E2E テスト shall ping/pong の成立(pong の受信、RTT の記録、連続喪失数が 0 であること)を自動検証する
3. The E2E テスト shall 通常メッセージのエコーバック(送信した値が同一アドレス・同一引数で返ること)を自動検証する
4. The E2E テスト shall `/sys/stats/request` に対する `/sys/stats` 応答が shared の stats スキーマに適合することを自動検証する
5. When `corepack pnpm test` を実行した場合, the テストスイート shall 単体テスト(shared・custom module)と E2E テストを人手操作なしで完走し、結果を合否として報告する
6. When テストが終了した場合(失敗時を含む), the E2E テスト shall 起動した O-S-C・mock-unity のプロセスを確実に終了させ、使用ポートを解放する

### Requirement 5: プロトコル規律・構成管理の遵守

**Objective:** As a プロジェクトオーナー, I want Phase 1 実装がプロジェクトの絶対規律を守ること, so that 将来の案件展開や OSC ライブラリ差し替えに耐える基盤になる

#### Acceptance Criteria

1. The Phase 1 実装 shall `vendor/open-stage-control`(lockfile 含む)へ一切の変更を加えない
2. The Phase 1 実装 shall `/sys/*` アドレス文字列を `packages/shared` の定数から参照し、各パッケージでの重複定義をしない
3. The Phase 1 実装 shall 宛先・ポートなどの環境依存値をデータ(config)で表現し、案件固有の値をコードへハードコードしない
4. If OSC 1.0 標準のみでは実現できない、または OSC ライブラリ間で解釈が割れる仕様点が判明した場合, the 開発プロセス shall 回避策を独断で実装せず、`docs/UNITY_PROTOCOL.md` の互換性ノートに記録した上で、本体改造が必要な場合は選択肢を添えてユーザーへ報告する

### Requirement 6: ドキュメントと進捗の更新

**Objective:** As a プロジェクト保守者, I want Phase 1 の完了状態と決定事項がドキュメントに反映されること, so that 手動検証を再現でき、次 Phase や引き継ぎで文脈が失われない

#### Acceptance Criteria

1. When Phase 1 の実装と自動テストが完了した場合, the プロジェクトドキュメント shall `docs/VERIFICATION.md` に Phase 1 の手動検証手順(mock-unity 起動、O-S-C headless 起動、ping/pong・stats・エコーバックの確認方法)を追記する
2. When Phase 1 の実装と自動テストが完了した場合, the プロジェクトドキュメント shall `CLAUDE.md` の Phase 進捗を Phase 1 完了に更新する
3. The プロジェクトドキュメント shall `docs/UNITY_PROTOCOL.md` の草稿で「Phase 1 で規定」とされた RTT・連続喪失数の保持仕様を、本 Phase の決定内容で詳細化する
4. When mock-unity の OSC ライブラリ(自前実装 vs `osc` npm パッケージ等)を選定した場合, the プロジェクトドキュメント shall `DESIGN.md` に設計判断として選定結果と理由を記録する
