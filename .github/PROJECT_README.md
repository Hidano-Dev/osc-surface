# プロジェクトセットアップガイド

このリポジトリは Unity プロジェクトテンプレートから生成され、GitHub Actions によって自動初期化されています (cc-sdd 設定・設定済みプロジェクトのリネーム・Unity バージョン固定)。

リポジトリ直下の各ディレクトリがそれぞれ独立した Unity プロジェクトです。生成時には、テンプレートに同梱された設定済みプロジェクト (パッケージ構成・ProjectSettings・URP 設定込み) がリポジトリ名にリネームされて 1 つ配置されています (ProjectSettings の productName もリポジトリ名に設定済み)。

## はじめかた

1. **初期化の完了を確認** — Actions タブで `Template Init` が完了 (緑) していることを確認します。まだ実行中なら完了を待ってください。`chore: initialize from template` コミットが積まれていれば完了です。
2. **clone / pull** — 初期化コミットが積まれた後に clone してください。先に clone していた場合は `git pull` します。
3. **Unity Hub で開く** — 「Add project from disk」で**プロジェクトディレクトリ** (リポジトリ直下ではなく、その中の各プロジェクトフォルダ) を指定します。指定バージョンが未インストールの場合は Hub がインストールを案内します。
4. 初回起動で生成される `Packages/packages-lock.json` をコミットしておくと、メンバー間でパッケージ解決が揃います。

## Unity バージョンを変更したい場合

**対象プロジェクトの初回起動前 (開始時) の実行を想定しています。** ハッシュ (changeset) を調べる必要はありません。

1. Actions タブ →「**Set Unity Version**」→「Run workflow」
2. プロジェクトディレクトリ名とバージョン番号 (例: `6000.0.32f1`) を入力して実行
3. 完了後に `git pull` して Unity Hub で開く

ProjectVersion.txt の書き換えと、manifest.json 内の公式 UPM パッケージ (`com.unity.*`) の対象 Editor 適合版への揃え直しが自動で行われます (OpenUPM 等のサードパーティパッケージと scopedRegistries には触れません)。URP など Editor 同梱系のパッケージは warning を出して自動更新をスキップするため、Unity で開いた際に必要に応じて調整してください。存在しないバージョンや存在しないプロジェクト名を入力した場合はエラーで停止するだけで、リポジトリは変更されません。利用可能なバージョン一覧は `.github/unity-versions.tsv` (生成時点のスナップショット) で確認できます。

> **注意**: 開発が進んだ後に大きくバージョンを下げると `Assets/` 内のシーン・プレハブに非互換が起きる可能性があります。その場合はブランチで検証してから main に取り込んでください。

## プロジェクト名を変更したい場合

1. Actions タブ →「**Set Project Name**」→「Run workflow」
2. 新しいプロジェクト名を入力して実行 (1 つの入力でディレクトリ名と ProjectSettings.asset の productName の両方が変わります)
3. 完了後に `git pull` し、Unity Hub で新しいディレクトリを「Add project from disk」で指定し直す

対象はリポジトリ直下の Unity プロジェクトが自動検出されます。プロジェクトを複数追加している場合は自動判別できずエラーで停止するため、その場合はローカルで `git mv` と productName の編集を行ってください。

## プロジェクトを追加したい場合

1. Actions タブ →「**Add Unity Project**」→「Run workflow」
2. 新しいプロジェクトディレクトリ名とバージョン番号を入力して実行
3. 完了後に `git pull` し、Unity Hub でそのディレクトリを開く

リポジトリ直下に `Assets/`, `Packages/`, `ProjectSettings/` を備えた骨組みが作成されます (初期プロジェクトのような設定済み構成のコピーではなく最小構成です)。

## 困ったときは

- **cc-sdd の設定やプロジェクトディレクトリが見当たらない** → 初期化コミット前の状態です。`git pull` してください。
- **バージョン変更 / プロジェクト追加が反映されない** → Actions の実行結果を確認してください。bot の push が拒否されている場合は、リポジトリ設定の Workflow permissions を「Read and write permissions」にします。

テンプレートの仕組みの詳細は、テンプレートリポジトリ側の README (仕様・運用手順書) を参照してください。
