# Agentic SDLC and Spec-Driven Development

Kiro-style Spec-Driven Development on an agentic SDLC

## Project Context

### Paths
- Steering: `.kiro/steering/`
- Specs: `.kiro/specs/`

### Steering vs Specification

**Steering** (`.kiro/steering/`) - Guide AI with project-wide rules and context
**Specs** (`.kiro/specs/`) - Formalize development process for individual features

### Active Specifications
- Check `.kiro/specs/` for active specifications
- Use `/kiro:spec-status [feature-name]` to check progress

## Development Guidelines
- Think in English, generate responses in Japanese. All Markdown content written to project files (e.g., requirements.md, design.md, tasks.md, research.md, validation reports) MUST be written in the target language configured for this specification (see spec.json.language).

## Minimal Workflow
- Phase 0 (optional): `/kiro:steering`, `/kiro:steering-custom`
- Phase 1 (Specification):
  - `/kiro:spec-init "description"`
  - `/kiro:spec-requirements {feature}`
  - `/kiro:validate-gap {feature}` (optional: for existing codebase)
  - `/kiro:spec-design {feature} [-y]`
  - `/kiro:validate-design {feature}` (optional: design review)
  - `/kiro:spec-tasks {feature} [-y]`
- Phase 2 (Implementation): `/kiro:spec-impl {feature} [tasks]`
  - `/kiro:validate-impl {feature}` (optional: after implementation)
- Progress check: `/kiro:spec-status {feature}` (use anytime)

## Development Rules
- 3-phase approval workflow: Requirements → Design → Tasks → Implementation
- Human review required each phase; use `-y` only for intentional fast-track
- Keep steering current and verify alignment with `/kiro:spec-status`
- Follow the user's instructions precisely, and within that scope act autonomously: gather the necessary context and complete the requested work end-to-end in this run, asking questions only when essential information is missing or the instructions are critically ambiguous.

## Steering Configuration
- Load entire `.kiro/steering/` as project memory
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via `/kiro:steering-custom`)

---

# OSC Surface — Unity向けOSCコントロールサーフェス

初回指示の原文: `claude-code-initial-prompt.md`。設計判断の記録: `DESIGN.md`。

## 概要

Open Stage Control (O-S-C) を土台に、Unity アプリ(将来的には任意の OSC 受信アプリ)を LAN 内のブラウザ/スマホから操作する双方向 OSC コントロールサーフェスを作る。開発対象は (1) custom module、(2) レイアウト定義 JSON、(3) `/sys/*` プロトコル仕様 (`docs/UNITY_PROTOCOL.md`)、(4) テストハーネス (mock-unity + E2E) の 4 つに限定。

## 絶対規律

- **O-S-C 本体 (`vendor/open-stage-control`) は改造しない**(lockfile 含む)。本体改造でしか実現できない要件はユーザーに報告して判断を仰ぐ
- **案件差分はコードでなくデータ**(config / レイアウト / マニフェスト)で表現する
- **Unity が真実の源**。UI は表示キャッシュ。値の確定は Unity からのエコーバックのみ
- **特定 Unity OSC ライブラリに依存しない**。OSC 1.0 標準の機能のみでプロトコルを成立させ、迷う点は `docs/UNITY_PROTOCOL.md` に互換性ノートとして記録
- 各 Phase 完了時、`docs/VERIFICATION.md` に手動検証手順を追記し、自動テストを緑にしてから次へ進む

## リポジトリ構成

- `packages/shared` — プロトコル型・zod スキーマ・定数(TS ソース直接参照、ビルドなし)
- `packages/custom-module` — O-S-C custom module。esbuild で `dist/osc-surface.js` に単一バンドル
- `packages/mock-unity` — Unity モック OSC レスポンダ(テスト・開発用)
- `layouts/` — O-S-C セッション(レイアウト)JSON
- `config/` — 実行時設定(宛先・ポート・デバッグフラグ)
- `tests/` — E2E(O-S-C headless + mock-unity ループバック)
- `vendor/open-stage-control` — Framagit upstream の submodule(タグ v1.30.4 に固定・無改造)
- `OscSurface/` — 同居する Unity プロジェクト(本ワークスペースの管轄外)

## 開発コマンド

pnpm は corepack 経由(グローバルインストール不要)。

```powershell
# ワークスペース依存のインストール
corepack pnpm install

# vendor (O-S-C) の初期化: 依存インストール + アセットビルド(初回と submodule 更新時のみ)
$env:ELECTRON_SKIP_BINARY_DOWNLOAD='1'; npm --prefix vendor/open-stage-control install --no-package-lock --no-audit --no-fund
npm --prefix vendor/open-stage-control run build
# 注意: upstream の npm scripts の echo が Windows で `Dependencies` / `JS` というゴミファイルを作るので削除する
#   Remove-Item vendor/open-stage-control/Dependencies, vendor/open-stage-control/JS -ErrorAction SilentlyContinue

# custom module のバンドル
corepack pnpm --filter @osc-surface/custom-module run build

# O-S-C headless 起動(custom module + レイアウト読み込み)
node vendor/open-stage-control/app -n -p 7080 -l layouts/main.json -c packages/custom-module/dist/osc-surface.js

# テスト一式
corepack pnpm test
```

## Phase 進捗

- [x] Phase 0 — 環境の素振り(headless 起動・custom module 読み込み確認)
- [ ] Phase 1 — プロトコル基盤(shared / mock-unity / ping-pong / stats / E2E 疎通)
- [ ] Phase 2 — マニフェスト駆動 UI
- [ ] Phase 3 — 診断パネルとデバッグモード
- [ ] Phase 4 — 実 Unity 接続手順書
