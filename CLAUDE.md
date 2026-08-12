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

# OSCDesk — Unity向けOSCコントロールサーフェス

初回指示の原文: `claude-code-initial-prompt.md`。設計判断の記録: `DESIGN.md`。

## 概要

Unity アプリ(将来的には任意の OSC 受信アプリ)を LAN 内のブラウザ/スマホから操作する双方向 OSC コントロールサーフェスを作る。ブリッジサーバーが Unity との OSC 通信と UI との WebSocket 通信を仲介し、NiceGUI UI が表示と操作を担当する。開発対象はブリッジ、UI、共有プロトコル、mock-unity、テストハーネスに限定する。

## 絶対規律

- **ブリッジサーバーと UI の責務を分離する**。Unity との OSC 通信はブリッジに集約し、UI はブリッジの WebSocket プロトコルを利用する。要件がこの境界を越える場合は、実装前にユーザーへ報告して判断を仰ぐ
- **案件差分はコードでなくデータ**(config / レイアウト / マニフェスト)で表現する
- **Unity が真実の源**。UI は表示キャッシュ。値の確定は Unity からのエコーバックのみ
- **特定 Unity OSC ライブラリに依存しない**。OSC 1.0 標準の機能のみでプロトコルを成立させ、迷う点は `docs/UNITY_PROTOCOL.md` に互換性ノートとして記録
- 各 Phase 完了時、`docs/VERIFICATION.md` に手動検証手順を追記し、自動テストを緑にしてから次へ進む

## リポジトリ構成

- `packages/bridge` — Node.js のブリッジサーバー。Unity との OSC 通信と UI との WebSocket 通信を担当し、`dist/oscdesk-bridge.js` を生成する
- `packages/nicegui-ui` — NiceGUI(Python) UI。パッケージ名は `oscdesk-nicegui-ui`、Python モジュール名は `oscdesk_ui`
- `packages/shared` — プロトコル型・zod スキーマ・定数(TS ソースを直接参照、ビルド出力なし)
- `packages/osc-codec` — OSC のエンコード・デコード処理
- `packages/mock-unity` — Unity モック OSC レスポンダ(テスト・開発用)
- `config/` — 実行時設定(宛先・ポート・デバッグフラグ)
- `protocol/` — 共有プロトコルの資料・サンプル
- `tests/` — リポジトリ共通テスト
- `scripts/run-python-tests.mjs` — UI の pytest をテスト入口から実行するスクリプト
- `OscSurface/` — 同居する Unity プロジェクト

## 開発コマンド

### 初回セットアップ(新しい PC にクローンした直後)

`setup-oscdesk.bat` をダブルクリックする(または `.\setup-oscdesk.ps1` を実行)。ワークスペース依存の導入、全パッケージのビルド、`packages/nicegui-ui/.venv` の作成と UI パッケージの開発インストールを一括で行う。完了済みの手順はスキップするので何度実行してもよい。`-Force` で全手順を再実行する。

### 個別コマンド

pnpm は corepack 経由(グローバルインストール不要)。

```powershell
# ワークスペース依存のインストール
corepack pnpm install

# 全パッケージのビルド
corepack pnpm -r run build

# UI の Python 仮想環境と開発依存を準備(通常は setup-oscdesk.bat が実行)
py -3 -m venv packages/nicegui-ui/.venv
packages/nicegui-ui/.venv/Scripts/python -m pip install -e "packages/nicegui-ui[dev]"

# 型チェック
corepack pnpm typecheck

# テスト一式(単一の入口)
corepack pnpm test
```

## 起動方法

通常起動はリポジトリ直下の `start-oscdesk.bat` をダブルクリックする(または `.\start-oscdesk.ps1` を実行する)。このランチャーはブリッジ(Node.js)と NiceGUI UI(Python)の2プロセスを起動し、接続先 URL を表示する。既定の Unity 向けポートは送信 7090 / 受信 7091、ブリッジ WebSocket は 7080 である。ウィンドウを閉じると両プロセスを停止する。

デバッグ起動は `start-oscdesk-debug.bat`、OSC ネイティブ UI 評価は `start-oscdesk-touchosc.bat` を使う。評価用ランチャーは mock-unity とブリッジを起動し、接続先 IP と受信ポートを表示する。

`.bat` は薄いランチャーに留め、処理本体と日本語メッセージは `.ps1`(UTF-8 BOM 付き)に置く。`.bat` に非 ASCII を入れると cmd のコードページ依存で壊れるため。

## 実装上の前提

- Unity 側のマニフェストと `/sys/*` プロトコルを契約の基準とする
- ブリッジと UI の接続、Unity との送受信、マニフェスト同期、診断表示はテストで検証する
- 手動検証の手順やプロトコルの詳細は `docs/` と `protocol/` の該当資料を参照する
