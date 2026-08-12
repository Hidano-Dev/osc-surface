# Requirements Document

## Project Description (Input)
Open Stage Control (O-S-C) への依存をリポジトリ全体から除去し、osc.js + ws による自前ブリッジサーバーと NiceGUI 製 UI だけで成立する OSC コントロールサーフェスへ再構成する。同時にリポジトリ名・アプリ名を osc-surface / OSC Surface から oscdesk / OscDesk へ改める。

【決定済みの方針（ユーザー承認済み・2026-08-12）】
1. サーバー構成は「Node ブリッジ + NiceGUI」の 2 プロセス。新パッケージ（仮称 packages/bridge）を osc.js（UDP OSC I/O）と ws（WebSocket サーバー）で構築し、既存 packages/custom-module の TypeScript ロジックを移植する。NiceGUI は表示に専念する。Python 一本化（python-osc）は不採用。
2. 名前は oscdesk / OscDesk。npm scope は @oscdesk/*、Python パッケージは oscdesk_ui、設定ファイルは oscdesk.config.json、起動スクリプトは start-oscdesk.bat。読みは「オーエスシー・デスク」、由来は OSC + desk（音響・照明の「卓」）。
3. OSC アドレスのうち Unity との契約である /sys/*（ping, pong, manifest, manifest/request, stats）は据え置き。サーバー内部・UI 向けの /surface/* は /oscdesk/* へ改名する（/oscdesk/manifest, /oscdesk/manifest/request, /oscdesk/hello, /oscdesk/status, /oscdesk/status/request, /oscdesk/diag/*）。改名に伴い docs/UNITY_PROTOCOL.md、mock-unity のシナリオ、E2E、NiceGUI 側を追従させる。
4. WebSocket のフレーム形式は O-S-C 互換（["sendOsc", {...}] / ["receiveOsc", {...}] / ["ping"] / ["pong"]）をやめ、独自形式へ整理する方針を推奨とする。現行形式は receiveOsc 経路で OSC の型タグが落ちる実害があり（docs/CUSTOM_UI_INTEGRATION.md §3 に既知の欠陥として記録済み）、互換を保つべき相手が消えるため。最終的な形式は設計フェーズで確定する。

【現状の把握（調査済み）】
O-S-C が現に担っている役割は 4 つ。
 ① OSC(UDP) の送受信（O-S-C 内部で osc.js を使用）。packages/mock-unity/src/osc-adapter.ts が既に osc.js を直接叩いており、そのまま流用できる。
 ② WebSocket サーバー（NiceGUI ↔ サーバー）。ws パッケージで置換可能。
 ③ custom module のホスト（oscInFilter / oscOutFilter フック、send() / receive() API、settings.read()、app の sessionOpened イベント）。ping 監視・マニフェスト受理・診断・誤接続ガードの本体はここにある。
 ④ 内蔵ブラウザ UI とレイアウト JSON の配信。NiceGUI 版では未使用。

【廃止対象】
- vendor/open-stage-control（git submodule）と .gitmodules、および setup スクリプト内の vendor 初期化手順一式
- layouts/*.json（main.json, diagnostics.json）と、そこに紐づく O-S-C レイアウト規約
- packages/custom-module のうち O-S-C 内蔵 UI 専用モジュール: layout-index, layout-snapshot, manifest-apply, widget-catalog, diag-panel-sink（各テスト含む）
- tools/poc/（O-S-C をサーバー専用として使えることの実証コード。役目を終える）
- Playwright 依存と、O-S-C 内蔵 UI をブラウザで検査する E2E（widget-inspector 系、helpers/browser-client.ts）
- docs/CUSTOM_UI_INTEGRATION.md のうち O-S-C 起動方法と O-S-C WebSocket 仕様の記述

【新パッケージへ移植するロジック（custom-module から）】
config, ping-monitor, manifest-client, diagnostics-engine, guard-event-log, ndjson-writer, ndjson-quota, ring-buffer, subnet-check, link-health, osc-ui-router, module-runtime（フック境界を自前サーバー向けに再設計）

【無傷で残すもの】
- packages/shared（プロトコル型・zod スキーマ・定数。SURFACE 定数群のアドレス値のみ改名）
- packages/mock-unity（osc.js による Unity モック。シナリオ内の /surface/* 参照のみ追従）
- docs/UNITY_PROTOCOL.md（/sys/* 仕様。/surface/* 参照箇所と uOSC 参照実装のみ追従）
- packages/nicegui-ui（WebSocket の話し方と名称のみ改修。UI ロジック本体は維持）
- 同居する Unity プロジェクト OscSurface/（本ワークスペースの管轄外だが、名称とアドレス改名の影響を手順として記録する）

【改名の展開先】
package.json 群の name（@osc-surface/* → @oscdesk/*）、pnpm-workspace、Python パッケージ osc_surface_ui → oscdesk_ui とその配布名、config/surface.config.json 系 3 ファイル、環境変数 OSC_SURFACE_CONFIG / OSC_SURFACE_TEST_NETWORK_INTERFACES、ルートの各 .bat / .ps1、CLAUDE.md、README.md、DESIGN.md、AGENTS.md、HANDOVER.md、docs/ 配下全て、.kiro/steering/。GitHub リポジトリ名とローカルディレクトリ名の変更はユーザー操作が必要なため、手順を文書として残す。

【守る規律】
- 案件差分はコードでなくデータ（config / マニフェスト）で表現する
- Unity が真実の源。UI は表示キャッシュで、値の確定は Unity のエコーバックのみ
- 特定 Unity OSC ライブラリに依存しない。OSC 1.0 標準の機能のみでプロトコルを成立させる
- 完了時に docs/VERIFICATION.md へ手動検証手順を追記し、自動テスト（corepack pnpm test と nicegui-ui の pytest）を緑にする

## Introduction

Open Stage Control (O-S-C) への依存をリポジトリ全体から取り除き、`osc.js`(UDP OSC I/O)と `ws`(WebSocket サーバー)で構成する自前のブリッジサーバーと、NiceGUI 製 UI の 2 プロセスだけで成立する OSC コントロールサーフェスへ再構成する。あわせてリポジトリ・アプリの名称を osc-surface / OSC Surface から oscdesk / OscDesk へ改める。

Unity との契約である `/sys/*` プロトコルは据え置き、内部・UI 向けの `/surface/*` は `/oscdesk/*` へ改名する。WebSocket のフレーム形式は O-S-C 互換をやめ、OSC の型タグが欠落しない独自形式へ整理する。既存の機能(ping 監視・マニフェスト駆動 UI・診断・誤接続ガード・OSC ネイティブ UI 中継)は、O-S-C 内蔵ブラウザ UI 専用の部分を除いて機能等価を保つ。

## Boundary Context

- **In scope**:
  - ブリッジサーバー新パッケージの新設(OSC UDP I/O、WebSocket サーバー、既存 custom module ロジックの移植)
  - WebSocket フレーム形式の再定義と、その仕様文書化
  - `/surface/*` → `/oscdesk/*` のアドレス改名と、依存箇所(mock-unity / E2E / NiceGUI / ドキュメント)の追従
  - O-S-C 依存資産(vendor submodule、`layouts/`、`tools/poc/`、Playwright 系 E2E、O-S-C 内蔵 UI 専用モジュール)の撤去
  - 名称改名の全面展開(npm scope、Python パッケージ、設定ファイル、環境変数、起動スクリプト、ドキュメント)
  - セットアップ / 起動スクリプトの再構成と、テスト・手動検証手順の再整備
- **Out of scope**:
  - `/sys/*` プロトコルそのものの仕様変更(アドレス・引数・意味は据え置き)
  - NiceGUI UI のウィジェット設計・操作調停ロジックの作り直し(接続方式と名称のみ改修)
  - GitHub リポジトリ名およびローカルディレクトリ名の実変更(ユーザー操作。手順の文書化までが範囲)
  - 同居する Unity プロジェクト `OscSurface/` の実改修(影響の手順化までが範囲)
- **Adjacent expectations**:
  - `packages/shared` はプロトコル型・zod スキーマを維持し、内部アドレス定数値のみ改名する
  - `packages/mock-unity` は `osc.js` による Unity モックとして維持し、シナリオ内の内部アドレス参照のみ追従する
  - `docs/UNITY_PROTOCOL.md` は `/sys/*` 仕様の正典として維持する

## Open Questions and Decisions (Dig)

dig インタビューで確定した判断。ID は本節内で完結し、`DESIGN.md` の連番とは別体系。

### D-1: 移行は段階並走を採らず、ブランチ内で一気に入れ替える

- **選択**: 作業ブランチ内で「ブリッジ新設 → ロジック移植 → NiceGUI 付け替え → O-S-C 撤去 → 全面改名 → ドキュメント改訂」を連続して行い、全て終えた時点でテストを緑にして main へ入れる。O-S-C とブリッジを並走させる中間状態は作らない。
- **理由**: 並走させるには O-S-C 側の設定・レイアウト・custom module をすべて生かしたまま新旧 2 系統を維持する必要があり、共存のためだけのコードと手順が増える。撤去が目的の作業で撤去対象を延命させるのは本末転倒と判断した。
- **リスク**: 高。途中で中断すると、どのタスクまで終わったのかがテスト結果からは判別できないブランチが残る。壊れたときの原因切り分けも難しい。
- **緩和**: 中断耐性はタスク分割とコミット方針で担保する(D-4 参照)。

### D-2: WebSocket は JSON テキストのフレームで運ぶ

- **選択**: OSC のバイナリをそのまま WebSocket へ透過させる方式は採らず、ブリッジが OSC を JSON へ包み直して UI へ送る。型タグと値の対応は JSON 上で明示的に保持する(例: `{"address": "...", "args": [{"type": "f", "value": 0.5}]}`)。具体的なフィールド名とイベント種別は設計フェーズで確定する。
- **理由**: 目で読めることのデバッグ上の利点と、Python 側に OSC デコーダ依存(python-osc)を増やさずに済むことを取った。接続状態など OSC 以外の情報も同じ経路で送れる。
- **リスク**: 中。包む側(TypeScript)と解く側(Python)に同じ形式を二重実装するため、両者がずれると型の欠落や誤解釈が再発する。この「ずれ」こそ現行 O-S-C 形式の欠陥と同種の失敗であり、対策なしでは移行の目的を損なう。
- **緩和**: 二重実装のずれ防止策を D-5 で定める。

### D-3: 診断は NiceGUI に接続状態のみを常時表示し、詳細はログに残す

- **選択**: 「Unity と繋がっているか」「応答速度(RTT)」「連続喪失回数」に相当する情報を NiceGUI 画面に常時表示する。現行の診断パネル(送受信メッセージの逐次表示、ネットワーク確認、ログ削除操作)は NiceGUI 側へ作り直さない。詳細は NDJSON ログとブリッジの標準出力に残す。
- **理由**: 現場で必要なのは「今繋がっているか」の一目での判別であり、メッセージの逐次確認は開発時にログで足りる。移行作業に UI の新規実装を抱き合わせない。
- **リスク**: 低〜中。画面上で送受信を追う手段を失うため、現場での切り分けはログ参照が前提になる。
- **影響**: Req 2-11 の「診断パネル配信を含まない」を維持しつつ、Req 6 に接続状態表示の受入基準を追加する。

### D-4: コミットはタスク単位で刻み、テストが赤の状態でもコミットする

- **選択**: `tasks.md` の 1 タスク = 1 コミット。全体テストが緑になるのは移行完了時点だが、それを待たずに各タスク完了時点でコミットする。
- **理由**: D-1 で中間状態にテストの裏付けが無くなったぶん、進捗の可視化を git 履歴と `tasks.md` のチェックボックスの一致に委ねる。中断しても「どこまで終わったか」が両方から同じ答えで読める。
- **リスク**: 低。テストが赤のコミットが履歴に並ぶが、作業ブランチ内に閉じており main へは緑になってから入る。
- **トレードオフ**: 個々のコミットは単体では動作保証を持たない。二分探索による回帰特定には使えない。

### D-5: フレーム形式のずれは共有サンプルと実結合テストの二段で防ぐ

- **選択**: (a) フレームの見本 JSON をリポジトリに置き、TypeScript(vitest)と Python(pytest)の双方のテストが同じファイルを読んで検証する。(b) 加えて pytest から実ブリッジを起動し、Python の接続層とブリッジを実際に往復させる。ブラウザは使わず、UI 層ではなく接続層を対象とする。
- **理由**: (a) は形式定義のずれを、(b) は「定義が合っていても実際には繋がらない」ずれを捕まえる。D-2 の二重実装リスクは片方だけでは塞げない。
- **リスク**: 中。(b) により pytest が Node のビルド成果物に依存するようになり、Python 単体で完結していた現在のテスト実行条件が変わる。
- **トレードオフ**: 見本ファイルは仕様の正典ではなく実例にすぎないため、見本に無いケース(未知の型タグ、異常系)のずれは検出できない。異常系の受入基準は Req 3-5 で別途担保する。

### D-6: 新パッケージは custom-module を git mv して不要部分を削る形で作る

- **選択**: `packages/custom-module` を `packages/bridge`(名称は設計フェーズで確定)へ丸ごとリネームし、O-S-C 内蔵 UI 専用の 5 モジュールを削除する。OSC UDP I/O と WebSocket サーバー、およびそれらを束ねる入口は新規に書く。
- **理由**: 移植対象の 12 モジュールは実質そのまま使うため、コピーで作ると git 上は全ファイル新規となり「なぜこう実装したか」の履歴が切れる。診断や誤接続ガードには過去 Phase の判断が積み上がっており、blame が追えることの価値が高い。
- **リスク**: 低。
- **トレードオフ**: 新規設計としての見通しの良さは犠牲になる。フック境界の再設計(`module-runtime.ts` 相当)は実質書き直しになるため、この 1 ファイルについては履歴の連続性に意味が薄い。

### D-7: OSC ネイティブ UI(TouchOSC 等)の中継経路は維持する

- **選択**: `osc-ui-router` をブリッジへ移植し、設定の `oscUi` ブロック、評価用の起動入口、`docs/TOUCHOSC_EVAL.md`、OSC ネイティブ UI の E2E を移行後も維持する。
- **理由**: `DESIGN.md` D-024 で「NiceGUI 版とは排他ではなく併存」と決めた判断を、今回の移行で無言のうちに覆さない。中継ロジックは純粋な振り分け処理でテストも既にあり、ブリッジが UDP を直接扱う体制ではむしろ実装が素直になる。
- **リスク**: 低。
- **追従が必要な点**: `/surface/hello` → `/oscdesk/hello` の改名により、TouchOSC 側の送信先アドレス設定も書き換えが必要になる。移行手順として文書化する。

### D-8: ポート設定は設定ファイルへ一元化する

- **選択**: Unity 宛先に加え、UI 接続用ポート・Unity 受信ポート・UI のポートを設定ファイルへ集約する。コマンド行引数は一時的な上書き手段として残す。
- **理由**: 現状は「Unity 宛先は設定ファイル、待ち受けポートは O-S-C の起動引数」の二重管理で、現場でポートを変えるときに 2 か所を見る必要がある。「案件差分はコードでなくデータで表現する」規律にも合う。
- **リスク**: 低〜中。設定スキーマが拡張されるため、Req 4-5 の「zod スキーマの構造を変更しない」はマニフェストスキーマに限定する形へ明確化した。
- **トレードオフ**: 設定ファイルの項目が増え、初見の読み手が把握すべき情報量は増える。

### D-9: テストの実行入口は 1 本にまとめる

- **選択**: ワークスペースのテストコマンドで TypeScript 側と Python 側の双方を実行する。Python 仮想環境が未作成の環境では Python 側をスキップし、理由と対処コマンドを警告として表示する。
- **理由**: Req 9-7 の完了条件が「両方が緑」である以上、その判定が 1 コマンドで下せないと片方を忘れたまま完了と誤認する余地が残る。D-5 で Python 側に実結合テストを置いたことで、この誤認の代償が大きくなった。
- **リスク**: 低。
- **トレードオフ**: TypeScript 側だけを回したい場面で余分な実行時間がかかる。個別実行の手段は残す。

## Requirements

### Requirement 1: 自前ブリッジサーバーの新設
**Objective:** As a サーフェス運用者, I want O-S-C 本体なしで OSC 送受信と UI 接続を成立させるブリッジサーバー, so that vendor submodule の取得・ビルドなしにサーフェスを起動できる

#### Acceptance Criteria
1. The ブリッジサーバー shall 設定ファイルで指定された受信ポートで UDP OSC を待ち受け、設定された Unity 宛先へ UDP OSC を送出する
2. When ブリッジサーバーが起動する, the ブリッジサーバー shall 設定されたポートで WebSocket サーバーを開始し、UI クライアントの接続を受け付ける
3. When UDP で OSC メッセージを受信する, the ブリッジサーバー shall OSC 1.0 の基本型タグ(`i` / `f` / `s` / `b`)と値の対応を保持したまま内部処理へ渡す
4. When ブリッジサーバーの起動が完了する, the ブリッジサーバー shall 待ち受けポートと Unity 宛先を含む起動完了行を標準出力へ 1 行の機械可読形式で出力する
5. If 受信ポートまたは WebSocket ポートが使用中である, then the ブリッジサーバー shall 対象ポートを含むエラーメッセージを出力し、非ゼロの終了コードで終了する
6. The ブリッジサーバー shall `vendor/open-stage-control` 配下のファイル、O-S-C の実行バイナリ、レイアウト JSON のいずれにも依存せずに起動できる
7. The ブリッジサーバー shall Node.js 単体で実行でき、Electron およびブラウザバイナリを必要としない
8. The ブリッジサーバー shall UI 接続用ポート・Unity 受信ポート・Unity 宛先のすべてを実行時設定ファイルから読み取る(see D-8)
9. Where コマンド行引数でポートが指定されている, the ブリッジサーバー shall 設定ファイルの値より引数を優先する
10. If 実行時設定ファイルが読めない、または必須項目を満たさない, then the ブリッジサーバー shall 対象ファイルと不足項目を示すエラーを出力し、非ゼロの終了コードで終了する

### Requirement 2: custom module ロジックの移植と機能等価性
**Objective:** As a サーフェス開発者, I want 既存 custom module の中核ロジックがブリッジサーバー上で同じ振る舞いを保つこと, so that O-S-C 撤去によって既存機能を失わない

#### Acceptance Criteria
1. The ブリッジサーバー shall 設定読込・ping 監視・マニフェスト受理・診断エンジン・誤接続ガードログ・NDJSON 出力と容量上限・リングバッファ・サブネット判定・リンク健全性・OSC ネイティブ UI ルーティングの各機能を提供する
2. While ブリッジサーバーが稼働している, the ブリッジサーバー shall 一定間隔で `/sys/ping` を送信し、`/sys/pong` の seq・RTT・連続喪失数を集計して観測可能にする
3. When `/sys/manifest` を受信する, the ブリッジサーバー shall zod スキーマ検証と `expectedProjectId` 照合を行い、合格したマニフェストのみを採用する
4. If 受信したマニフェストの `projectId` が期待値と一致しない, then the ブリッジサーバー shall 当該マニフェストを採用せず、拒否イベントを誤接続ガードログに記録する
5. When Unity への到達性が喪失状態から回復する, the ブリッジサーバー shall マニフェストを再要求する
6. If マニフェストの再要求が連続して必要になる, then the ブリッジサーバー shall 規定の最小間隔より短い周期では再要求を送信しない
7. Where 設定の `debug` が有効, the ブリッジサーバー shall 診断スナップショットの取得経路と、容量上限つき NDJSON ログ出力を提供する
8. Where 設定の `oscUi` が有効, the ブリッジサーバー shall OSC ネイティブ UI からの名乗りを受理し、Unity ↔ UI ピア間の中継を行う
9. The ブリッジサーバー shall UI から送られた値を確定値として保持せず、値の確定は Unity からのエコーバックのみで行う
10. The ブリッジサーバー shall 移植した各ロジックについて、移植前と同等以上のカバレッジを持つ単体テストを備える
11. The ブリッジサーバー shall O-S-C 内蔵 UI 専用の機能(レイアウト索引、レイアウトスナップショット、`/EDIT` 適用プラン生成、ウィジェットカタログ、診断パネル配信)を含まない

### Requirement 3: WebSocket プロトコルの再定義
**Objective:** As a UI 実装者, I want OSC の型情報が欠落しない独自 WebSocket フレーム形式, so that 受信値を型に基づいて安全に扱える

#### Acceptance Criteria
1. The ブリッジサーバー shall O-S-C 互換のフレーム形式(`["sendOsc", …]` / `["receiveOsc", …]` / `["open", …]` / `["ping"]` / `["pong"]` の配列形式)を受理も送出もしない
2. When OSC 受信を UI へ通知する, the ブリッジサーバー shall 各引数の OSC 型タグと値の対応を保持した JSON テキストのフレームで通知する(see D-2)
3. When 通知する OSC メッセージの引数が 1 個である, the ブリッジサーバー shall 引数を単一の素値へ縮約せず、引数列の構造を保ったまま通知する
4. When UI が値送信フレームを送る, the ブリッジサーバー shall UI が宛先を指定しなくても設定された Unity 宛先へ送出する
5. If UI から仕様に適合しないフレームを受信する, then the ブリッジサーバー shall 接続を維持したまま当該フレームを破棄し、破棄理由をログに記録する
6. The ブリッジサーバー shall WebSocket 接続の死活監視を備え、応答のないクライアントを切断する
7. When UI クライアントが接続を確立する, the ブリッジサーバー shall 採用済みマニフェストが存在する場合に当該クライアントへ配信する
8. When UI がマニフェストの再配信を要求する, the ブリッジサーバー shall 当該要求を内部で消費し、UDP へ送出しない
9. The プロジェクト shall 新しいフレーム形式(方向・イベント種別・ペイロード・死活監視の間隔とタイムアウト)を `docs/` 配下の接続仕様文書に正典として記述する

### Requirement 4: OSC アドレス名前空間の整理
**Objective:** As a Unity 実装者, I want Unity との契約アドレスが据え置かれ内部アドレスだけが改名されること, so that Unity 側実装を変えずにサーフェスを更新できる

#### Acceptance Criteria
1. The プロジェクト shall `/sys/ping`・`/sys/pong`・`/sys/stats`・`/sys/stats/request`・`/sys/manifest`・`/sys/manifest/request` のアドレス文字列と引数仕様を変更しない
2. The プロジェクト shall 内部名前空間の全アドレスを `/surface/*` から `/oscdesk/*` へ改名する(`manifest`、`manifest/request`、`hello`、`status`、`status/request`、`diag/*`)
3. When 内部名前空間宛のメッセージが UDP 送出経路に達する, the ブリッジサーバー shall 当該メッセージを UDP へ出さず内部で消費する
4. The リポジトリ shall 改名完了後、実装・テスト・シナリオ・ドキュメントのいずれにも `/surface/` を含む文字列を残さない(履歴記録である `DESIGN.md` の過去エントリ、および `.kiro/specs/` 配下の完了済み spec を除く。これらは当時の判断の記録であり、書き換えると記録としての価値を失う)
5. The `packages/shared` shall 内部アドレス定数の値のみを改名し、`/sys/*` 定数・プロトコル型・マニフェストの zod スキーマ構造を変更しない(実行時設定のスキーマは D-8 により拡張される。この制約の対象外)
6. When mock-unity・E2E・NiceGUI UI が内部名前空間を参照する, they shall 改名後のアドレスを参照する

### Requirement 5: O-S-C 依存資産の撤去
**Objective:** As a 新規参加の開発者, I want O-S-C 由来の資産とセットアップ手順が消えていること, so that クローン直後の環境構築が短く失敗しにくくなる

#### Acceptance Criteria
1. The リポジトリ shall `vendor/open-stage-control` submodule と `.gitmodules` を含まない
2. The リポジトリ shall `layouts/` 配下のレイアウト JSON と、O-S-C レイアウト規約に関する記述を含まない
3. The リポジトリ shall `tools/poc/` を含まない
4. The リポジトリ shall Playwright への依存と、O-S-C 内蔵 UI をブラウザで検査する E2E(ウィジェット検査系ヘルパを含む)を含まない
5. The リポジトリ shall O-S-C の custom module としてホストされることを前提としたパッケージを含まない
6. When 開発者が依存インストールを実行する, the セットアップ shall O-S-C 本体・Electron・ブラウザバイナリのいずれの取得も行わない
7. If 撤去対象の資産が唯一の検証手段を担っていた, then the プロジェクト shall 代替の検証手段を用意するか、失う検証観点と理由を `DESIGN.md` に記録する

### Requirement 6: NiceGUI UI の追従
**Objective:** As a サーフェス利用者, I want 既存の UI 体験を保ったまま新ブリッジへ接続できること, so that 画面の使い勝手を落とさずに基盤だけを入れ替えられる

#### Acceptance Criteria
1. The UI パッケージ shall Python パッケージ名と配布名を `osc_surface_ui` から `oscdesk_ui` へ改名する
2. When UI がブリッジサーバーへ接続する, the UI shall 新しいフレーム形式のみを用いて通信する
3. When Unity のエコーバックを受信する, the UI shall 型タグを伴う値として解釈し、対応するウィジェット表示を更新する
4. The UI shall 値の確定を Unity のエコーバックのみで行い、自身の送信値では確定しない
5. While ユーザーがウィジェットを操作している, the UI shall 操作中の値を表示し、操作終了後はエコーバックを正として表示を戻す
6. If ブリッジサーバーとの接続が切断される, then the UI shall 再接続を試み、再接続後にマニフェストを取り直し、値をエコーバックで埋め直す
7. Where プロキシ環境変数が設定されている, the UI shall LAN 内のブリッジサーバーへの接続でプロキシを使用しない
8. The UI パッケージ shall 改名と新フレーム形式に追従した pytest を備え、全件成功する
9. While UI が表示されている, the UI shall Unity との接続状態・応答速度・連続喪失回数に相当する情報を画面上に常時表示する(see D-3)
10. When Unity との到達性が失われる, the UI shall 表示上の接続状態を切断として反映する
11. The UI shall 送受信メッセージの逐次表示・ネットワーク確認・ログ削除操作といった詳細診断機能を持たない(see D-3)

### Requirement 7: oscdesk への全面改名
**Objective:** As a プロジェクト管理者, I want 名称が oscdesk / OscDesk に統一されること, so that リポジトリ内に新旧 2 つの名前が混在しない

#### Acceptance Criteria
1. The リポジトリ shall npm ワークスペースの全パッケージ名を `@osc-surface/*` から `@oscdesk/*` へ改名し、相互参照とワークスペース定義を追従させる
2. The リポジトリ shall 実行時設定ファイル群を `oscdesk.config.json` を基準とする命名へ改め、通常・デバッグ・OSC ネイティブ UI 評価の各構成を維持し、ポート設定を含む形へ拡張する(see D-8)
3. The リポジトリ shall 環境変数 `OSC_SURFACE_CONFIG` および `OSC_SURFACE_TEST_NETWORK_INTERFACES` を oscdesk 由来の名称へ改名する
4. The リポジトリ shall 起動・セットアップ用の `.bat` / `.ps1` を oscdesk 由来の名称へ改め、`start-oscdesk.bat` を主要な起動入口とする
5. The `.bat` ファイル shall 非 ASCII 文字を含まず、日本語のメッセージは BOM 付き UTF-8 の `.ps1` 側に置く
6. The リポジトリ shall `CLAUDE.md`・`README.md`・`DESIGN.md`・`AGENTS.md`・`HANDOVER.md`・`docs/` 配下・`.kiro/steering/` の記述を新名称へ更新する
7. The プロジェクト shall 旧名称の設定ファイル名・環境変数名に対する後方互換エイリアスを設けない
8. If ユーザー操作が必要な改名(GitHub リポジトリ名、ローカルディレクトリ名)が残る, then the プロジェクト shall その実施手順と実施後の確認方法を文書として残す

### Requirement 8: セットアップと 2 プロセス起動
**Objective:** As a サーフェス運用者, I want ダブルクリック 1 回でブリッジと UI がそろって立ち上がること, so that 現場で手順を覚えずに起動できる

#### Acceptance Criteria
1. When ユーザーが主要な起動スクリプトを実行する, the 起動スクリプト shall ブリッジサーバーと NiceGUI UI の 2 プロセスを起動し、UI の接続先 URL を画面に表示する
2. When 起動スクリプトが完了する, the 起動スクリプト shall LAN 内の別端末から接続するための IP アドレスを含む案内を表示する
3. If いずれかのプロセスの起動に失敗する, then the 起動スクリプト shall 失敗したプロセスと原因を表示し、既に起動した側のプロセスを終了させる
4. When ユーザーが起動スクリプトを終了する, the 起動スクリプト shall 起動した両プロセスを終了させ、孤児プロセスを残さない
5. When ユーザーがセットアップスクリプトを実行する, the セットアップ shall submodule 取得と vendor ビルドの手順を一切実行せず、ワークスペース依存の導入・ブリッジのビルド・Python 仮想環境の準備のみを行う
6. The セットアップスクリプト shall 完了済みの手順をスキップし、繰り返し実行しても同じ結果になる
7. The プロジェクト shall デバッグ構成用および OSC ネイティブ UI 評価用の起動入口を維持する

### Requirement 9: テストと検証の再構成
**Objective:** As a サーフェス開発者, I want O-S-C なしで自動テストと手動検証が完結すること, so that 移行後も回帰を検出できる

#### Acceptance Criteria
1. When 開発者がワークスペースのテストコマンドを実行する, the テストスイート shall ブラウザバイナリと O-S-C の事前準備なしで完走する
2. The E2E shall ブリッジサーバーと mock-unity のループバック構成で、ping/pong の疎通、マニフェストの受理と配信、値のエコーバック、到達性の喪失と回復を検証する
3. The E2E shall WebSocket クライアントを接続し、新フレーム形式による UI → Unity 送信と Unity → UI 受信の往復を型タグ付きで検証する
4. The E2E shall 誤接続ガード(`projectId` 不一致の拒否)と診断出力の検証を維持する
5. When 開発者がワークスペースのテストコマンドを実行する, the テストスイート shall TypeScript 側と Python 側の双方を実行し、全件成功を 1 コマンドで判定できる(see D-9)
5-a. If Python 仮想環境が未作成である, then the テストスイート shall Python 側をスキップし、スキップした事実・理由・対処コマンドを警告として表示する
6. The プロジェクト shall `docs/VERIFICATION.md` に O-S-C を使わない構成での手動検証手順を追記する
7. The プロジェクト shall 移行完了時点で自動テスト(ワークスペースのテストと UI パッケージのテスト)がすべて成功する状態を満たす
8. The プロジェクト shall WebSocket フレームの見本 JSON をリポジトリ内の単一の場所に置き、TypeScript 側テストと Python 側テストの双方が同じファイルを読んで検証する(see D-5)
9. When Python 側テストを実行する, the テストスイート shall 実ブリッジを起動して接続層との往復(UI → Unity 送信と Unity → UI 受信)を検証する(see D-5)
10. If 実ブリッジの起動に必要なビルド成果物が存在しない, then the Python 側テスト shall その旨が判別できる形で失敗またはスキップし、原因と対処コマンドを表示する
11. The 自動テスト shall ブラウザバイナリを必要としない

### Requirement 10: ドキュメントと移行手順の整備
**Objective:** As a 次に触る開発者, I want 何がなぜ変わったのかと残作業が文書に残ること, so that 移行後の構成を前提に作業を続けられる

#### Acceptance Criteria
1. The `docs/UNITY_PROTOCOL.md` shall `/sys/*` 仕様を維持したまま、内部アドレス参照と名称のみを新体系へ更新する
2. The 接続仕様文書 shall O-S-C の起動方法と O-S-C WebSocket 仕様の記述を含まず、ブリッジサーバーの起動方法と新フレーム形式に置き換える
3. The プロジェクト shall 本移行の主要判断(2 プロセス構成の採用と Python 一本化の不採用、名称、アドレス改名の範囲、フレーム形式の独自化)を `DESIGN.md` に既存の連番に続く形で追記する
4. The `CLAUDE.md` shall O-S-C 本体を改造しない旨の規律を、ブリッジサーバー体制に対応する規律へ置き換える
5. The `CLAUDE.md` shall リポジトリ構成の記述を移行後のパッケージ構成と開発コマンドに更新する
6. The プロジェクト shall 同居する Unity プロジェクト側で必要となる追従作業(名称と内部アドレスの影響範囲)を手順として記録する
6-a. The プロジェクト shall OSC ネイティブ UI(TouchOSC 等)側で必要となる送信先アドレスの書き換え手順を記録する(see D-7)
7. The プロジェクト shall 「案件差分はコードでなくデータ(設定・マニフェスト)で表現する」「Unity が真実の源」「特定 Unity OSC ライブラリに依存しない」の 3 規律を移行後のドキュメントに引き続き明記する

## Dig Summary

### 実施規模

- ラウンド数: 3
- 質問数: 9
- 決定数: 9 (D-1 〜 D-9)

### 主要な発見

1. **「JSON テキストで運ぶ」選択は、現行 O-S-C 形式の欠陥と同種の失敗を招く余地を残す**。型タグを保つ形式を自分で定義しても、包む側(TypeScript)と解く側(Python)の二重実装がずれれば結局同じ問題が起きる。形式を変えること自体は解決ではなく、ずれを検出し続ける仕組み(D-5)が本体である。
2. **「一気に入れ替える」選択により、テストが移行完了まで完了判定として機能しなくなる**。その空白をタスク単位のコミットと `tasks.md` の一致(D-4)で埋める必要がある。テストを完了判定に使えない期間があること自体が、この移行の最大のリスク。
3. **ポート設定が設定ファイルと起動引数に二重管理されていた**(Unity 宛先は設定ファイル、待ち受けポートは O-S-C の起動引数)。これは O-S-C の CLI に引きずられた形であり、O-S-C 撤去はこれを正す機会になる(D-8)。

### 決定一覧

| ID | 論点 | 決定 | 理由 | リスク |
|---|---|---|---|---|
| D-1 | 移行の刻み方 | 並走させず、ブランチ内で一気に入れ替える | 撤去が目的の作業で撤去対象を延命させない | 高 |
| D-2 | WebSocket フレーム形式 | OSC バイナリ透過ではなく JSON テキストで運ぶ | 目で読めること / Python 側の依存を増やさない | 中 |
| D-3 | 診断の継承範囲 | NiceGUI には接続状態のみ常時表示。詳細はログ | 現場で要るのは疎通の一目判別。移行に UI 新規実装を抱き合わせない | 低〜中 |
| D-4 | コミット方針 | タスク単位で刻む(テストが赤でもコミット) | D-1 で失った進捗の可視性を git 履歴で担保 | 低 |
| D-5 | 二重実装のずれ防止 | 共有見本 JSON + pytest からの実結合テスト | 形式定義のずれと実接続のずれは別物で、片方では塞げない | 中 |
| D-6 | 新パッケージの作り方 | `git mv` でリネームし不要分を削る | 移植 12 モジュールの blame を切らない | 低 |
| D-7 | OSC ネイティブ UI 経路 | 維持する | `DESIGN.md` D-024 の併存判断を無言で覆さない | 低 |
| D-8 | ポート設定の置き場 | 設定ファイルへ一元化(引数は上書き用) | 二重管理の解消 / 「案件差分はデータ」の規律 | 低〜中 |
| D-9 | テストの実行入口 | 1 コマンドで TypeScript と Python 双方 | 「両方緑」の判定を 1 か所に | 低 |

### 残るリスク(設計フェーズで扱うこと)

- **D-2 のフレーム形式の具体が未確定**。フィールド名、イベント種別(OSC 値 / マニフェスト / 接続状態 / 死活監視)の分け方、死活監視の間隔とタイムアウトを設計で確定する必要がある。D-5 の見本 JSON はこの確定後にしか作れないため、設計とタスクの依存順序に注意。
- **D-5 の実結合テストにより pytest が Node のビルド成果物へ依存する**。テスト実行の前提条件が変わるため、セットアップ手順と CI 相当の実行順序(ビルド → テスト)を設計で明示する必要がある。
- **D-1 により、移行途中のブランチは動作しない**。作業を中断して別件に移る場合、ブランチの状態を `HANDOVER.md` に残す運用が前提になる。
- **移植 12 モジュールの「機能等価」をどう証明するかが未定**。既存の単体テストがそのまま通ることを等価の根拠とするのか、追加の比較検証を行うのかは設計フェーズの判断。
