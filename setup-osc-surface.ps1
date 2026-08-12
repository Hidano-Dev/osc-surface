#Requires -Version 5.1
<#
.SYNOPSIS
    OSC Surface の初回セットアップ。

.DESCRIPTION
    新しい PC にリポジトリをクローンした直後に一度だけ実行する。
    完了済みの手順は自動的にスキップされるため、何度実行しても安全。

    通常はダブルクリックで setup-osc-surface.bat から呼ばれる。

.PARAMETER Force
    完了済みの手順もすべてやり直す。

.PARAMETER WithTests
    E2E テスト用の Chromium も導入する（corepack pnpm test を実行する場合に必要）。

.EXAMPLE
    .\setup-osc-surface.ps1
    .\setup-osc-surface.ps1 -Force
    .\setup-osc-surface.ps1 -WithTests
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$WithTests
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# corepack が pnpm を初回取得するときの確認プロンプトを抑制する（ダブルクリック実行で止まらないように）
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'

$script:step = 0
$script:total = if ($WithTests) { 7 } else { 6 }

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Title)
    $script:step++
    Write-Host ''
    Write-Host ('[{0}/{1}] {2}' -f $script:step, $script:total, $Title) -ForegroundColor Cyan
}

function Write-Detail {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "      $Message" -ForegroundColor DarkGray
}

function Write-Done {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "      OK   $Message" -ForegroundColor Green
}

function Write-Skipped {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "      skip $Message" -ForegroundColor DarkGray
}

function Assert-ExitCode {
    param([Parameter(Mandatory = $true)][string]$What)
    if ($LASTEXITCODE -ne 0) {
        throw ('{0}に失敗しました（終了コード {1}）。上に表示されているログを確認してください。' -f $What, $LASTEXITCODE)
    }
}

function Test-CommandExists {
    param([Parameter(Mandatory = $true)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

try {
    Write-Host ''
    Write-Host '=== OSC Surface 初回セットアップ ===' -ForegroundColor White
    Write-Host "リポジトリ: $PSScriptRoot"

    # --- 1. 前提コマンド -------------------------------------------------
    Write-Step '前提コマンドの確認'

    $missing = @()
    foreach ($cmd in 'node', 'npm', 'git') {
        if (-not (Test-CommandExists $cmd)) { $missing += $cmd }
    }
    if ($missing.Count -gt 0) {
        throw ('次のコマンドが見つかりません: {0}。Node.js（npm と corepack を同梱）は https://nodejs.org から、git は https://git-scm.com からインストールしてください。' -f ($missing -join ', '))
    }

    $nodeVersion = (node --version) -replace '^v', ''
    $nodeParts = $nodeVersion -split '\.'
    $nodeMajor = [int]$nodeParts[0]
    if ($nodeMajor -lt 20) {
        throw "Node.js 20 以上が必要です（検出したバージョン: $nodeVersion）。https://nodejs.org から更新してください。"
    }
    Write-Done "node $nodeVersion / $(git --version)"

    # --- 2. submodule ----------------------------------------------------
    Write-Step 'O-S-C 本体（git submodule）の取得'

    $vendorManifest = Join-Path $PSScriptRoot 'vendor\open-stage-control\package.json'
    if ((Test-Path $vendorManifest) -and -not $Force) {
        Write-Skipped '取得済み'
    }
    else {
        Write-Detail 'framagit.org から取得します（数十 MB あります）'
        git submodule update --init --recursive
        Assert-ExitCode 'submodule の取得'
        if (-not (Test-Path $vendorManifest)) {
            throw 'submodule コマンドは成功しましたが vendor/open-stage-control が空のままです。framagit.org に到達できているか確認してください。'
        }
        Write-Done 'vendor/open-stage-control を取得しました'
    }

    # --- 3. vendor の依存 -------------------------------------------------
    Write-Step 'O-S-C の依存パッケージのインストール'

    $vendorModules = Join-Path $PSScriptRoot 'vendor\open-stage-control\node_modules'
    if ((Test-Path $vendorModules) -and -not $Force) {
        Write-Skipped 'インストール済み'
    }
    else {
        Write-Detail '数分かかります。electron のバイナリはダウンロードしません'
        # upstream の package-lock.json は古い npm 形式で npm ci が通らないため --no-package-lock が必須。
        # --omit=optional は electron だけでなく rollup 等のネイティブバイナリも落とすので使わない。
        $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
        try {
            npm --prefix vendor/open-stage-control install --no-package-lock --no-audit --no-fund
            Assert-ExitCode 'O-S-C の依存インストール'
        }
        finally {
            if (Test-Path Env:ELECTRON_SKIP_BINARY_DOWNLOAD) {
                Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD
            }
        }
        Write-Done '依存パッケージをインストールしました'
    }

    # --- 4. vendor のビルド ------------------------------------------------
    Write-Step 'O-S-C のアセットビルド'

    # app/ は submodule では gitignore されているビルド生成物。これが無いと起動時に
    # MODULE_NOT_FOUND になる。
    $vendorEntry = Join-Path $PSScriptRoot 'vendor\open-stage-control\app\index.js'
    if ((Test-Path $vendorEntry) -and -not $Force) {
        Write-Skipped 'ビルド済み'
    }
    else {
        Write-Detail '数分かかります'
        npm --prefix vendor/open-stage-control run build
        Assert-ExitCode 'O-S-C のアセットビルド'
        if (-not (Test-Path $vendorEntry)) {
            throw 'ビルドコマンドは成功しましたが vendor/open-stage-control/app が生成されていません。'
        }
        Write-Done 'app/ を生成しました'
    }

    # upstream の npm scripts の echo が Windows の cmd でリダイレクトとして解釈され、
    # 中身のない Dependencies / JS というファイルを submodule 直下に作るので消す。
    foreach ($name in 'Dependencies', 'JS') {
        $garbage = Join-Path $PSScriptRoot "vendor\open-stage-control\$name"
        if (Test-Path $garbage -PathType Leaf) {
            Remove-Item $garbage -Force
            Write-Detail "ゴミファイル $name を削除しました"
        }
    }

    # --- 5. ワークスペースの依存 --------------------------------------------
    Write-Step 'ワークスペース依存のインストール'

    if ((Test-Path (Join-Path $PSScriptRoot 'node_modules')) -and -not $Force) {
        Write-Skipped 'インストール済み'
    }
    else {
        corepack pnpm install
        Assert-ExitCode 'ワークスペース依存のインストール'
        Write-Done 'pnpm install が完了しました'
    }

    # --- 6. custom module のバンドル ---------------------------------------
    # 自分たちのコードなので毎回ビルドし直す（数秒で終わる）
    Write-Step 'custom module のバンドル'

    corepack pnpm --filter @osc-surface/custom-module run build
    Assert-ExitCode 'custom module のバンドル'

    $bundle = Join-Path $PSScriptRoot 'packages\custom-module\dist\osc-surface.js'
    if (-not (Test-Path $bundle)) {
        throw 'ビルドコマンドは成功しましたが packages/custom-module/dist/osc-surface.js が見つかりません。'
    }
    Write-Done 'dist/osc-surface.js を生成しました'

    # --- 7. E2E 用ブラウザ（任意）------------------------------------------
    if ($WithTests) {
        Write-Step 'E2E テスト用 Chromium の導入'
        corepack pnpm exec playwright install chromium
        Assert-ExitCode 'Chromium の導入'
        Write-Done 'Chromium を導入しました'
    }

    Write-Host ''
    Write-Host '=== セットアップ完了 ===' -ForegroundColor Green
    Write-Host ''
    Write-Host '起動方法:'
    Write-Host '  start-osc-surface.bat        通常起動'
    Write-Host '  start-osc-surface-debug.bat  診断パネルと NDJSON ログを有効にして起動'
    if (-not $WithTests) {
        Write-Host ''
        Write-Host 'テスト一式（corepack pnpm test）も実行する場合は、次を一度だけ実行してください:'
        Write-Host '  corepack pnpm exec playwright install chromium'
    }
    Write-Host ''
}
catch {
    Write-Host ''
    Write-Host '=== セットアップ失敗 ===' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    Write-Host '解決しない場合は CLAUDE.md の「開発コマンド」を見て手動で実行してください。'
    Write-Host '途中まで進んでいる場合、もう一度実行すれば完了済みの手順はスキップされます。'
    Write-Host ''
    exit 1
}
