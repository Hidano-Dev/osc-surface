# Requirements Document

## Project Description (Input)
Phase 4 — 実 Unity 接続手順書。docs/UNITY_PROTOCOL.md を完成させる。本文はライブラリ非依存の擬似コード(受信統計の持ち方、pong 実装、マニフェスト生成)を正とし、uOSC を使った具体例は付録に隔離する。独自 Fork ライブラリの利用者が「付録を読み替えるだけ」で実装できる構成にする。対象は docs/UNITY_PROTOCOL.md(および必要なら docs/VERIFICATION.md への手動検証手順追記)のみで、コード変更は原則なし。O-S-C 本体 (vendor/open-stage-control) は無改造。OSC 1.0 標準の機能のみでプロトコルを成立させ、特定 Unity OSC ライブラリに依存しない。

## Introduction

Phase 4 は、`docs/UNITY_PROTOCOL.md` を「実 Unity 接続手順書」として完成させるドキュメントフェーズである。Phase 1〜3 で確定したプロトコル仕様(到達性・診断、マニフェストハンドシェイク、双方向同期、診断パネル)を前提に、Unity 実装者が特定の OSC ライブラリに依存せず `/sys/*` プロトコルを実装し、実機の Unity を Surface に接続できる状態まで文書を仕上げる。本文はライブラリ非依存の擬似コードを正とし、uOSC を使った具体例は付録に隔離する。独自 Fork ライブラリの利用者が「付録を読み替えるだけ」で実装できる構成を成功条件とする。

## Boundary Context

- **In scope**:
  - `docs/UNITY_PROTOCOL.md` の完成(本文の擬似コード執筆、実 Unity 接続手順の追記、付録 A〜D の執筆、互換性ノート・暫定表記の整理)
  - `docs/VERIFICATION.md` への Phase 4 手動検証手順の追記
  - 実 Unity 疎通検証のための最小限の Unity 側作業: `OscSurface/` への uOSC(hecomi 版 v2 系)導入と、付録の参照実装(C# 1 ファイル)の投入、および実機での疎通確認
- **Out of scope**:
  - `packages/` 配下(shared / custom-module / mock-unity)のコード変更
  - `vendor/open-stage-control` の改造(絶対規律)
  - `layouts/` / `config/` の変更
  - `OscSurface/` の疎通検証に不要な変更(ゲームロジック・シーン構成の作り込み等)
  - `/sys/*` プロトコル自体の拡張・変更(矛盾発見時は記録してユーザー判断へ返す)
- **Adjacent expectations**:
  - マニフェストスキーマの正規定義は `packages/shared` の zod `ManifestSchema` であり、文書はこれを参照する
  - `packages/mock-unity` は本仕様の参照実装として存在し、文書の手順検証に利用できる
  - Phase 1〜3 の確定仕様(計数規則・再送/回復・検証/採用・値同期・bool/blob の扱い)は既に `docs/UNITY_PROTOCOL.md` に記載済みであり、Phase 4 はこれらを変更しない

## Requirements

### Requirement 1: ライブラリ非依存の擬似コードによる本文の完成

**Objective:** Unity 実装者として、受信統計・pong・マニフェスト生成の実装指針をライブラリ非依存の擬似コードで読みたい。任意の OSC ライブラリ(独自 Fork 含む)の上で `/sys/*` プロトコルを正しく実装できるようにするためである。

#### Acceptance Criteria

1. The UNITY_PROTOCOL.md shall 受信統計(`received` / `parseErrors` / `lastReceivedAt`)の保持と更新の方法を、特定の OSC ライブラリに依存しない擬似コードで記述する
2. The UNITY_PROTOCOL.md shall `/sys/ping` 受信から `/sys/pong` 返信まで(同じ `seq` の即時返信)の実装を、特定の OSC ライブラリに依存しない擬似コードで記述する
3. The UNITY_PROTOCOL.md shall マニフェスト JSON の生成と `/sys/manifest` 応答(現在値を `default` として埋め込むこと、UTF-8 の単一データグラムで送信することを含む)の実装を、特定の OSC ライブラリに依存しない擬似コードで記述する
4. The UNITY_PROTOCOL.md shall 擬似コードの挙動を既存の確定仕様(bundle の展開後メッセージ単位の計数、`/sys/stats/request` 自身の計数、要求への重複応答の許容と自発送信、同一アドレスへのエコーバック)と一致させる
5. If 擬似コードの表現に OSC 1.0 で解釈が割れやすい機能(配列引数・カラー型・64bit 整数・ライブラリ独自の bool 変換など)が必要になった場合, the UNITY_PROTOCOL.md shall その機能を使用せず、代替表現と理由を互換性ノートに記録する

### Requirement 2: 実 Unity 接続手順の記述

**Objective:** Surface を実 Unity と接続する運用者として、接続の前提条件から疎通確認までの手順を知りたい。mock-unity ではなく実機の Unity アプリを LAN 内で Surface に接続できるようにするためである。

#### Acceptance Criteria

1. The UNITY_PROTOCOL.md shall 実 Unity と Surface を接続するための前提条件(トランスポートが UDP であること、`config/surface.config.json` の宛先・ポート設定、O-S-C headless 起動時の送信ターゲット指定との対応関係)を記述する
2. The UNITY_PROTOCOL.md shall 接続確認の手順を段階的(ping/pong の成立 → `/sys/stats` の取得 → マニフェストの採用 → 値のエコーバック確定)に記述する
3. The UNITY_PROTOCOL.md shall 返信先を「受信データグラムの送信元」とみなさず、返信先ホスト・ポートを設定で明示する前提を接続手順に反映する
4. If 接続が成立しない場合, the UNITY_PROTOCOL.md shall 切り分けの指針(確認すべき症状と、診断パネル・デバッグモード・NDJSON ログなど既存の診断手段への参照)を提供する

### Requirement 3: uOSC 参照実装例の付録隔離

**Objective:** uOSC を採用する Unity 実装者として、そのまま流用できる具体的な実装例を読みたい。ただし本文のライブラリ非依存性を損なわないよう、具体例は付録に閉じてほしい。

#### Acceptance Criteria

1. The UNITY_PROTOCOL.md shall uOSC(hecomi 版 v2 系)を使った参照実装例(受信統計の実装、pong 返信、マニフェスト生成・応答、通常メッセージのエコーバック)を、コピーしてそのまま利用できる完全な C# 1 ファイルとして付録セクションにのみ記述する
2. The UNITY_PROTOCOL.md shall 本文(付録以外の全セクション)に uOSC 固有の API・型・挙動への依存を含めない
3. The UNITY_PROTOCOL.md shall 付録の uOSC 例を本文の擬似コード(受信統計・pong・マニフェスト生成)と節単位で対応付けて構成する
4. Where uOSC の挙動が OSC 1.0 標準または本文の擬似コードと差異を持つ場合, the UNITY_PROTOCOL.md shall その差異を付録または互換性ノートに明記する

### Requirement 4: 独自 Fork ライブラリ利用者の読み替え可能性

**Objective:** uOSC 以外の OSC ライブラリ(独自 Fork 含む)を使う Unity 実装者として、付録を自分のライブラリに読み替えるだけで実装を完了したい。ライブラリ選定や Fork の差異が導入の障害にならないようにするためである。

#### Acceptance Criteria

1. The UNITY_PROTOCOL.md shall 本文のみで(付録を参照せずに)`/sys/*` プロトコルの実装に必要な仕様と実装指針を完結させる
2. The UNITY_PROTOCOL.md shall 付録の uOSC 例について、別ライブラリへ読み替える際の対応点(どの API 呼び出しが本文擬似コードのどの操作に対応するか)を明示する
3. The UNITY_PROTOCOL.md shall 利用ライブラリの互換性を確認するためのチェック項目(UTF-8 文字列の扱い、基本型タグ `i`/`f`/`s`/`b` の対応、bundle の展開、返信先の明示指定、想定ペイロードサイズのデータグラム送受信)を一覧として提供する
4. If 利用ライブラリがチェック項目を満たさない場合, the UNITY_PROTOCOL.md shall 既知の代替策(例: JSON ペイロードの ASCII-safe 化、bool の 0/1 表現)の所在を互換性ノートへの参照として示す

### Requirement 5: 既存確定仕様との整合と文書の完成状態

**Objective:** プロジェクトオーナーとして、UNITY_PROTOCOL.md が暫定版ではなく Unity 実装者へ受け渡せる完成版であってほしい。Phase 1〜3 で確定した仕様と矛盾する記述が混入しないようにするためである。

#### Acceptance Criteria

1. The UNITY_PROTOCOL.md shall Phase 1〜3 で確定済みの仕様(§1 計数規則、§2 要求・再送・回復と検証・採用と値同期、§3 双方向同期の規律、bool の 0/1 表現、blob の値同期非対応)と矛盾しない内容で完成する
2. The UNITY_PROTOCOL.md shall 「暫定版」「Phase 4 で執筆」「Phase 4 で追記する」等の未完了を示す表記を解消し、付録プレースホルダ(A〜D)を実内容に置き換える
3. The UNITY_PROTOCOL.md shall 追記する全ての内容を OSC 1.0 標準の機能(基本型タグ・bundle・timetag)の範囲で成立させる
4. If 執筆中に既存の仕様記述と実装(packages/ 配下)の矛盾が発見された場合, the ドキュメント作成プロセス shall 独断で仕様または実装を変更せず、差異と選択肢を互換性ノートに記録してユーザー判断へ返す

### Requirement 6: Phase 4 の手動検証手順と無変更の確認

**Objective:** プロジェクトオーナーとして、Phase 4 完了時に文書の妥当性を検証する手順と、コード・vendor が無変更であることの確認手段を持ちたい。各 Phase 完了時に検証手順を残す規律を維持するためである。

#### Acceptance Criteria

1. The VERIFICATION.md shall Phase 4 の手動検証手順(UNITY_PROTOCOL.md の接続手順を mock-unity を実 Unity に見立てて追試できることの確認を含む)を追記として含む
2. The Phase 4 検証手順 shall 既存の自動テスト一式(`corepack pnpm test`)が緑のままであることの確認を含む
3. The Phase 4 検証手順 shall `git status` により `vendor/open-stage-control` および `packages/` 配下に差分がないこと(ドキュメントと `OscSurface/` の疎通検証用最小変更のみであること)の確認を含む
4. The Phase 4 検証手順 shall 本文に uOSC 固有の記述が混入していないことのレビュー観点を含む

### Requirement 7: 実 Unity 疎通検証

**Objective:** プロジェクトオーナーとして、手順書が机上の文書で終わらず、実機の Unity で実際に接続が成立することを確認したい。付録の参照実装がそのまま動くことを保証するためである。

#### Acceptance Criteria

1. The Phase 4 作業 shall `OscSurface/` に uOSC(hecomi 版 v2 系)を導入し、付録の参照実装 C# ファイルをそのまま投入する(付録と投入ファイルの内容は一致させる)
2. The Phase 4 作業 shall 実 Unity(Editor Play Mode)と Surface(O-S-C headless)の間で ping/pong の疎通が成立すること(診断パネルの到達性表示が正常になること)を確認する
3. If 実機検証で付録の参照実装に修正が必要になった場合, the Phase 4 作業 shall 修正を付録と投入ファイルの両方へ反映し、判明した差異を互換性ノートに記録する
4. The `OscSurface/` への変更 shall 疎通検証に必要な最小限(パッケージ導入・参照実装・最小のシーン配置)に留める
