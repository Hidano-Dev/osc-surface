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

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
