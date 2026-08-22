# oscdesk 開発ガイド

## プロジェクトメモリ

- `.kiro/steering/` はプロジェクト全体の方針を置く場所です。
- `.kiro/specs/` は機能ごとの仕様と作業記録を置く場所です。
- `AGENTS.md` は対象ディレクトリ固有の前提・契約・テスト規約を記録します。
- Markdown のプロジェクト文書は、日本語で UTF-8 として編集します。

## 構成

- `packages/bridge` — Node.js ブリッジ。OSC と WebSocket の境界を担当
- `packages/nicegui-ui` — NiceGUI(Python) UI。モジュール名は `oscdesk_ui`
- `packages/shared` — 共有プロトコル型・zod スキーマ・定数
- `packages/osc-codec` — OSC エンコード・デコード
- `packages/mock-unity` — Unity モック
- `config/` — 実行時設定、`protocol/` — プロトコル資料
- `tests/` — 共通テスト、`scripts/run-python-tests.mjs` — pytest の入口
- `OscSurface/` — Unity プロジェクト

## 絶対規律

1. ブリッジと UI の責務を分離する。Unity との OSC 通信はブリッジに集約し、UI は WebSocket プロトコルを利用する。
2. 案件差分はコードではなく設定・レイアウト・マニフェストのデータで表現する。
3. Unity を真実の源とする。UI は表示キャッシュで、値の確定は Unity のエコーバックだけで行う。

## セットアップと起動

```powershell
.\setup-oscdesk.ps1
corepack pnpm install
corepack pnpm -r run build
```

通常起動は `start-oscdesk.bat` または `.\start-oscdesk.ps1`、デバッグ起動は `start-oscdesk-debug.bat`、OSC ネイティブ UI 評価は `start-oscdesk-touchosc.bat` です。通常起動ではブリッジと NiceGUI UI の接続先 URL が表示され、終了時に両プロセスが停止します。

このシステムは無認証で、信頼できる LAN 内での利用を前提とします。外部ネットワークへ公開しないでください。

## テスト

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm exec vitest run --config vitest.config.ts --project unit
```

変更後は対象テストに加えて、可能なら `corepack pnpm test` を実行します。手動検証は `docs/VERIFICATION.md`、Unity との契約は `docs/UNITY_PROTOCOL.md` と `protocol/` を参照します。

## 仕様駆動開発

仕様の変更は Requirements → Design → Tasks → Implementation の順で進め、作業対象の仕様と `.kiro/specs/` の進捗を確認します。実装前にブリッジ/UI 境界や Unity の契約を変更する必要がある場合は、判断を止めて報告します。
