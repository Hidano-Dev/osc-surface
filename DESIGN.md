# DESIGN.md — 設計判断の記録

このファイルは osc-surface の設計判断とその理由を時系列で記録する。判断を覆す場合も履歴は残し、取り消し線ではなく追記で更新する。

## 2026-07-23 Phase 0

### D-001: O-S-C submodule は Framagit の upstream を直接参照する

- **背景**: O-S-C の開発は GitHub から Framagit へ移行済み(GitHub 側は 2025-12-17 にアーカイブ、読み取り専用)。正式リポジトリは https://framagit.org/jean-emmanuel/open-stage-control
- **判断**: `vendor/open-stage-control` は Framagit の upstream URL を submodule として参照し、リリースタグ `v1.30.4` のコミットに固定する
- **理由**: git submodule はホスティングサービスを問わないため機能上の問題はない。Framagit はアカウント登録制で Fork 作成の敷居が高く、現時点で Fork を持たない
- **保険(Fork 相当)の方針**: 将来必要になったら GitHub に `git push --mirror` でミラーリポジトリを作成し、`.gitmodules` の URL を差し替える。submodule はコミット SHA で固定されるため、URL 差し替えのみで履歴の同一性は保たれる

### D-002: vendor のインストールは electron を除外し node ランタイムで headless 起動する

- **背景**: O-S-C の `electron` は optionalDependencies であり、`src/server/index.js` は electron 不在または `--no-gui` 指定時に純 node ランタイムで起動する設計になっている
- **判断**: `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --no-package-lock` でインストールし、`node app/ --no-gui ...` で起動する
- **理由**:
  - electron バイナリのダウンロード(数百MB)を回避でき、CI と開発マシン双方で軽い
  - headless 運用(テスト・本番)では GUI ランチャー不要
  - `--no-package-lock` は upstream の `package-lock.json` が古い npm 形式で `npm ci` と非互換なため。lockfile を書き換えると submodule 無改造の規律に反するので、書き換えない形でインストールする
- **経緯**: 当初 `--omit=optional` で electron ごと除外したが、rollup / @parcel/watcher の各プラットフォーム用ネイティブバイナリも optionalDependencies 配下のため build が壊れた。optional は入れつつ electron のバイナリだけ環境変数でスキップする方式に変更
- **既知の副作用**: upstream の npm scripts が使う `echo '=> Dependencies ...'` / `echo '=> JS and CSS assets ...'` は Windows cmd で `>` がリダイレクト解釈され、submodule 直下に `Dependencies` / `JS` というゴミファイルを作る。install / build 後に削除すること

### D-003: custom module は TypeScript で書き esbuild で単一 CJS にバンドルする

- **背景**: O-S-C の custom module は制限付きコンテキストで実行され、node の `require` が使えない(独自の `require`/`nativeRequire` のみ)。複数ファイル・npm 依存を素直には使えない
- **判断**: `packages/custom-module/src/index.ts` を esbuild で `dist/osc-surface.js`(CJS 単一ファイル)にバンドルし、`--custom-module` に渡す
- **注意**: モジュールのエクスポートは esbuild の ESM 変換を避けるため `module.exports = {...}` を直接書く(O-S-C 側は `module.exports` の形しか認識しない)

### D-004: pnpm は corepack 経由で使用する

- **判断**: グローバルインストールせず、root `package.json` の `packageManager: "pnpm@10.13.1"` + corepack で固定する。コマンドは `corepack pnpm ...`
- **理由**: マシン差異の排除。CI でも同一バージョンが再現される

### D-005: リポジトリには Unity プロジェクト `OscSurface/` が同居する

- **背景**: リポジトリ root には既存の Unity プロジェクト(`OscSurface/`)がある。初回指示のディレクトリ構成(packages/ 等)は root 直下に構築した
- **注意**: `.gitignore` は Unity 用パターン(`[Ll]ibrary/` 等)が深さ無制限で効いているため、Node 側で `Library/` という名前のディレクトリを作らないこと
