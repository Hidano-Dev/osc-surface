# Requirements Document

## Project Description (Input)
Phase 3 — 診断パネルとデバッグモード。O-S-C custom module にデバッグモード(config フラグで ON/OFF、OFF 時は計測・記録処理を完全スキップしホットパスにコストを残さない)を実装する。ON 時の提供機能: 送受信メッセージの直近N件リングバッファ(NDJSON ファイル書き出しはデバッグ中のみ)、ping/pong による到達性・RTT・喪失率、宛先 IP が自ホストと同一サブネットかの静的判定(OS のインターフェース情報と照合)、これらをレイアウト内の診断パネル(専用ウィジェット群)へ 100ms 間隔の間引きで反映。診断パネルは通常レイアウト(layouts/main.json)とは別ファイルにし、include またはタブで合流させる。検証: 喪失・切断・別サブネットの各異常系を mock-unity の故障注入(応答停止等)で再現し、単体テスト(vitest: 診断判定ロジック)と E2E(O-S-C headless + mock-unity ループバック)で自動検証する。O-S-C 本体(vendor/open-stage-control)は無改造のまま。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
