# Requirements Document

## Project Description (Input)
Phase 1 プロトコル基盤 — OSC Surface の /sys/* プロトコル基盤を実装する。対象: (1) packages/shared に /sys/* の zod スキーマ(manifest / stats)を実装(アドレス定数は実装済み)。(2) packages/mock-unity に OSC 1.0 標準のみに依存する OSC レスポンダを実装(/sys/ping→/sys/pong、/sys/stats/request→/sys/stats、通常メッセージのエコーバック)。(3) packages/custom-module に 2 秒間隔の ping 送信と RTT・連続喪失数の保持を実装。(4) tests/ に O-S-C headless + mock-unity のループバック疎通 E2E を vitest で実装し corepack pnpm test で自動検証。完了時に docs/VERIFICATION.md へ Phase 1 手順を追記し、CLAUDE.md の Phase 進捗を更新する。制約: O-S-C 本体 (vendor/open-stage-control) は無改造、Unity が真実の源、特定 OSC ライブラリ非依存(OSC 1.0 標準のみ)。要検討事項: mock-unity の OSC ライブラリ選定(自前実装 vs osc npm パッケージ)。参照: claude-code-initial-prompt.md(全 Phase 要件原文)、HANDOVER.md、docs/UNITY_PROTOCOL.md(草稿)、DESIGN.md。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
