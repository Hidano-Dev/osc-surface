# Implementation Plan — phase1-protocol-foundation

- [x] 1. テスト実行基盤を整備する
  - ルートの vitest 設定で unit(パッケージ配下の単体テスト・並列可)と e2e(tests/e2e 配下・単一フォーク直列・長めのタイムアウト)の 2 プロジェクトに分割する(workspace ファイルは作らない)
  - ルートの test スクリプトを「ワークスペース一括ビルド → vitest 一括実行」に変更し、パッケージ個別の test スクリプト方式は廃止する
  - `corepack pnpm test` が(テスト 0 件の時点でも)人手操作なしで完走し、unit / e2e の 2 プロジェクトが認識されている
  - _Requirements: 4.5_

- [x] 2. 共有プロトコル契約(shared)を確立する
- [x] 2.1 (P) `/sys/*` と surface 内部ペイロードの zod スキーマ・派生型を実装する
  - stats(受信数・パース失敗数・最終受信時刻)のスキーマ: 非負整数・ISO-8601 検証を含む
  - manifest(version リテラルと entries の address / label / type / widget / range / default / group)のスキーマ: アドレスの `/` 始まり・許容列挙値を検証
  - surface 内部契約の status(直近 RTT・連続喪失数・最終 pong seq)と config(宛先ホスト・送受信ポート・デバッグフラグ等)のスキーマ
  - 検証失敗時は zod issue の path で原因フィールドを特定できる
  - buildless TS(ソース直接参照)を維持し、zod 以外の依存を追加しない
  - 4 スキーマと派生型が shared からインポートでき、正しいペイロードの検証が通る状態になっている
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - _Boundary: SharedSchemas_

- [x] 2.2 (P) OSC ワイヤ型定義を追加する
  - 型タグ i / f / s / b の引数表現と、メッセージ / バンドルのパケット型(型のみ・ランタイムコードなし)
  - bundle の timetag は解釈せず透過保持とする
  - mock-unity・テスト側が型として参照でき、shared のランタイム依存が増えていない
  - _Requirements: 1.4_
  - _Boundary: SharedOscTypes_

- [x] 2.3 アドレス定数を拡張し契約の入口を統合する
  - `/surface/status/request` / `/surface/status` の内部名前空間定数を追加する
  - スキーマ・ワイヤ型を既存の SYS 定数と同一入口から re-export する
  - 各パッケージが単一入口から定数・スキーマ・型を import でき、アドレス文字列の重複定義がない状態になっている
  - _Requirements: 5.2_

- [x] 2.4 スキーマの受理・拒否ケースを網羅する単体テストを書く
  - 4 スキーマそれぞれの受理ケースと拒否ケース(必須欠落・型不一致・許容外列挙値・負整数・非 ISO 日時)を網羅
  - 検証エラーの path から原因フィールドを特定できることを検証
  - unit プロジェクトでスキーマテストが緑になっている
  - _Requirements: 1.3, 1.5_

- [x] 3. mock-unity OSC レスポンダを実装する
- [x] 3.1 (P) OSC コーデックアダプタ(osc.js ラッパ)を実装する
  - `osc` npm を mock-unity の依存に追加し、encode / decode を明示的な型表現(metadata 固定)のみで行う薄いラッパを実装(トランスポート機能は使用しない)
  - decode 時のあらゆる例外を単一のデコードエラー型へ正規化。Phase 1 契約外の型タグはパースエラーに数えず応答対象から除外(ログのみ)
  - osc.js の使用 API サブセットの ambient 型宣言を用意(DefinitelyTyped に型があればそちらを優先)
  - 単体テスト: i / f / s / b と bundle のラウンドトリップで型タグ・値が保持されること、不正バイト列がデコードエラーへ正規化されることが緑になっている
  - _Requirements: 2.6_
  - _Boundary: MockOscAdapter_
  - _Depends: 2.2, 2.3_

- [x] 3.2 (P) レスポンダコア(応答規則と受信統計)を実装する
  - 応答規則: ping → 同一 seq の pong、stats 照会 → 統計 JSON、その他の `/sys/*` → 無応答、非 `/sys/*` → 同一アドレス・同一引数のエコーバック
  - bundle は要素を展開して各メッセージに規則を適用し、受信数も要素ごとに計数
  - 受信数・パース失敗数・最終受信時刻を集計し、stats 応答は shared の stats スキーマに適合させる
  - パース不能の計上を受けてもプロセスを止めない(例外を投げないソケット非依存の純粋コア)
  - 単体テスト: 応答規則 4 系統と統計遷移(受信数・パース失敗数・最終受信時刻)が緑になっている
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: MockResponder_
  - _Depends: 2.1, 2.3_

- [x] 3.3 UDP サーバ配線と CLI 起動形態を実装する
  - UDP 待受け → decode → 応答決定 → encode 送信の配線。デコード失敗はパース失敗計上のみで受信継続、ソケットエラーイベントはログのみ(Windows の ECONNRESET 相当を含む)
  - 返信先は起動引数で明示指定(未指定時のみデータグラム送信元へフォールバック)
  - CLI 引数(待受ポート必須・返信先ホスト/ポート任意)の検証と不正時の fail fast、起動完了時の ready 行出力(テスト同期用契約)、SIGINT / SIGTERM での正常終了
  - esbuild で単一 JS にバンドル(`osc` は external 指定)し、node 直接実行できるようにする
  - CLI 起動 → ready 行出力 → ping 送信に pong が返り、Ctrl+C で終了する状態になっている
  - _Requirements: 2.5, 2.7, 5.3_

- [x] 4. custom module の到達性計測を実装する
- [x] 4.1 (P) RTT・連続喪失数の状態機械を実装する
  - 未応答 ping は常に最大 1 件保持(待ちウィンドウ = ping 間隔)。次の ping 発行時に未応答なら連続喪失数 +1 して新 seq に差し替え。seq は 1 始まりの単調増加
  - 保持中 seq と一致する pong で RTT 確定・連続喪失数 0 リセット。不一致(未知・期限切れ)・重複 pong は計測に反映せず破棄
  - status スキーマに適合するスナップショットを提供(Phase 3 診断パネルの表示ソース)
  - タイマー・送信を持たずクロック注入・同期遷移で単体テスト可能な純粋ロジックとする
  - 単体テスト: RTT 確定 / 喪失加算 / 破棄規則 / スナップショットのスキーマ適合が緑になっている
  - _Requirements: 3.2, 3.3, 3.4, 3.7_
  - _Boundary: PingMonitor_
  - _Depends: 2.1, 2.3_

- [x] 4.2 (P) 設定の読み込みと検証を実装する
  - config を shared のスキーマで検証する純粋な parse 関数(O-S-C グローバル非依存・読み込み関数は注入)
  - 読み込みパスは環境変数による絶対パス上書きを優先し、なければバンドル基準の既定相対パスで `config/surface.config.json` を解決
  - 単体テスト: 正常 config の受理と欠落・型不正の拒否が緑になっている
  - _Requirements: 3.6, 5.3_
  - _Boundary: ConfigLoader_
  - _Depends: 2.1_

- [x] 4.3 O-S-C グローバルへの配線(ping ループ・受信フィルタ・status 応答)を実装する
  - init で config 読込・検証に成功したら 2 秒間隔で単調増加 seq の ping を設定宛先へ送信し続ける。config 失敗時はエラーログを出し ping ループを開始しない(O-S-C 本体は稼働継続)
  - 受信フィルタ: pong は計測へ渡して swallow(seq 不一致は破棄)、status 照会は照会元へ状態 JSON を返信して swallow、その他の `/sys/*`・`/surface/*` も swallow、通常メッセージのみウィジェットへ素通し
  - フィルタ内例外は try/catch で握ってログに留め、stop / unload でタイマーを解放する(autoreload 安全)
  - アドレス比較は shared 定数のみを使用し、`osc` npm を import しない(バンドルに含まれないことを確認 — 依存方向規則の検証点)
  - バンドル再生成後、O-S-C headless + mock-unity のループバック起動で ping/pong が自走し、status 照会に状態 JSON が返る状態になっている
  - _Requirements: 3.1, 3.5, 4.2_

- [x] 5. E2E ループバック検証を実装する
- [x] 5.1 (P) 子プロセスハーネスを実装する
  - shell を介さず引数配列で直接 spawn(Windows での kill を確実化)し、stdout の行監視 + タイムアウトで ready 判定する
  - 停止は kill → exit 待機 → タイムアウト時 Windows は taskkill /T /F、他 OS は SIGKILL のフォールバック。登録済み全プロセスを失敗時も止め切る一括停止を提供
  - 失敗診断用に子プロセスの stdout / stderr をバッファし、テスト失敗時に出力する
  - 起動 → 停止のラウンドトリップ後にプロセスが残留しない状態になっている
  - _Requirements: 4.1, 4.6_
  - _Boundary: ProcessHarness_

- [x] 5.2 (P) OSC テストクライアントを実装する
  - ルートに `osc` devDependency を追加し、encode / decode は明示的な型表現(metadata 固定)・型タグ i / f / s / b 限定で shared ワイヤ型へ正規化する(osc.js 固有表現をテスト期待値に持ち込まない)
  - 送信、タイムアウト + リトライ付きの応答待ち(起動直後の照会レース対策)、不正データグラム注入用の生バイト列送信を提供
  - 送信 → 期待アドレスの応答受信がワイヤ型で取得できる状態になっている
  - _Requirements: 4.3, 4.4_
  - _Boundary: OscTestClient_
  - _Depends: 2.2, 3.1_

- [x] 5.3 直結検証スペック(テストクライアント ↔ mock-unity)を書く
  - ハーネスで mock-unity を単独 spawn し、ping → 同一 seq の pong 返信を検証
  - int / float / string 引数の通常メッセージが同一アドレス・同一引数でエコーバックされることを検証
  - 不正データグラム送信後も応答が継続し、stats 応答が shared スキーマに適合して parseErrors・received が期待どおり増加していることを検証
  - e2e プロジェクトで直結スペックが緑になり、終了後にプロセスが残らない
  - _Requirements: 2.5, 2.7, 4.3, 4.4_

- [x] 5.4 フルチェーン検証スペックとテスト一式の完走を確認する
  - mock-unity + O-S-C headless(custom module バンドルとレイアウトを読み込み)をループバック構成で起動する
  - status 照会を上限付きポーリングで実行し、RTT が記録済み・連続喪失数 0・採用 pong seq が 1 以上であることを検証(固定 sleep に依存しない)
  - afterAll + try/finally の二重防御で、失敗時を含む全経路で起動プロセスを確実に終了させポートを解放する
  - `corepack pnpm test` が単体テストと E2E を人手操作なしで完走して合否を報告し、`vendor/open-stage-control`(lockfile 含む)に一切の差分がないことを確認する
  - _Requirements: 4.1, 4.2, 4.5, 4.6, 5.1_

- [x] 6. ドキュメントと進捗を反映する
- [x] 6.1 (P) プロトコル文書を詳細化し互換性ノートを追記する
  - `docs/UNITY_PROTOCOL.md` §1 に RTT・連続喪失数の保持仕様(未応答 1 件ウィンドウ・2 秒・期限切れ破棄)、received の計数規則(`/sys/*` 含む全パース成功メッセージ・bundle は要素ごと)、lastReceivedAt が応答時点で常に存在する根拠を追記
  - 互換性ノートに「返信先は設定で明示する(データグラム送信元への返信を前提にしない)」規律を追記。実装中に判明した OSC 1.0 の解釈割れがあれば同ノートへ記録し、本体改造が必要な場合は選択肢を添えてユーザーへ報告する
  - 保持仕様・計数規則・返信先規律が文書化され shared スキーマの実装と一致している
  - _Requirements: 5.4, 6.3_
  - _Boundary: DocsUpdate_

- [x] 6.2 (P) 検証手順・設計判断・進捗を更新する
  - `docs/VERIFICATION.md` に Phase 1 手動検証手順(mock-unity CLI 起動 → O-S-C headless 起動 → フェーダー操作のエコーバック確定を目視確認 → status 照会または `corepack pnpm test`)を追記。ポート占有時の確認手順と、画面確認に開発用の軽量ブラウザを使う方針も明記
  - `DESIGN.md` に D-006(mock-unity・テスト系の OSC コーデックに `osc` npm を採用。理由と使用制約 = 基本型タグ + bundle/timetag・metadata 固定を併記)と D-007(`/surface/*` 内部名前空間と E2E 観測方式)を追記
  - `CLAUDE.md` の Phase 1 進捗をチェックし、root test スクリプト変更に伴う開発コマンド記載の整合を確認
  - 手動検証手順どおりに操作して Phase 1 の動作が再現できる状態になっている
  - _Requirements: 6.1, 6.2, 6.4_
  - _Boundary: DocsUpdate_
