#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'

function Assert-ExitCode {
    param([Parameter(Mandatory = $true)][string]$What)
    if ($LASTEXITCODE -ne 0) {
        throw "${What}に失敗しました（終了コード $LASTEXITCODE）。"
    }
}

function Write-Step {
    param([Parameter(Mandatory = $true)][int]$Number, [Parameter(Mandatory = $true)][string]$Title)
    Write-Host "[$Number/3] $Title" -ForegroundColor Cyan
}

function Write-Skipped {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "      スキップ: $Message" -ForegroundColor DarkGray
}

try {
    Write-Host '=== OSCDesk セットアップ ===' -ForegroundColor White
    if ($Force) {
        Write-Host '強制再実行モード' -ForegroundColor Yellow
    }

    Write-Step 1 'ワークスペース依存を導入'
    # node_modules の存在だけを見てスキップすると、依存が増えた更新後のチェックアウトで
    # 古いまま先へ進んでビルドが失敗する。pnpm install は最新なら即終了する冪等コマンド
    # なので、毎回そのまま実行して鮮度判定は pnpm に任せる
    corepack pnpm install
    Assert-ExitCode 'ワークスペース依存の導入'
    Write-Host '      完了' -ForegroundColor Green

    Write-Step 2 '全パッケージをビルド'
    $bridgeBundle = Join-Path $PSScriptRoot 'packages\bridge\dist\oscdesk-bridge.js'
    if ((Test-Path $bridgeBundle -PathType Leaf) -and -not $Force) {
        Write-Skipped 'パッケージは既にビルド済みです'
    }
    else {
        corepack pnpm -r run build
        Assert-ExitCode '全パッケージのビルド'
        if (-not (Test-Path $bridgeBundle -PathType Leaf)) {
            throw 'ビルドは成功しましたが bridge の成果物が見つかりません。'
        }
        Write-Host '      完了' -ForegroundColor Green
    }

    Write-Step 3 'Python 仮想環境を作成し UI パッケージを開発インストール'
    $venvPython = Join-Path $PSScriptRoot 'packages\nicegui-ui\.venv\Scripts\python.exe'
    $venvDir = Join-Path $PSScriptRoot 'packages\nicegui-ui\.venv'
    if (-not (Test-Path $venvPython -PathType Leaf)) {
        if (Get-Command py -ErrorAction SilentlyContinue) {
            py -3 -m venv $venvDir
        }
        elseif (Get-Command python -ErrorAction SilentlyContinue) {
            python -m venv $venvDir
        }
        else {
            throw 'Python 3.11 以上が必要です。'
        }
        Assert-ExitCode 'Python 仮想環境の作成'
    }
    else {
        Write-Skipped 'Python 仮想環境は既に存在します(パッケージの同期は毎回行います)'
    }
    # 既存 venv には旧パッケージ名や古い依存が残りうる(パッケージ改名・websockets の
    # 下限引き上げ後など)。editable インストールは冪等なので毎回実行して同期する
    $uiPackage = (Join-Path $PSScriptRoot 'packages\nicegui-ui') + '[dev]'
    & $venvPython -m pip install -e $uiPackage
    Assert-ExitCode 'UI パッケージの開発インストール'
    Write-Host '      完了' -ForegroundColor Green

    Write-Host '=== セットアップ完了 ===' -ForegroundColor Green
    exit 0
}
catch {
    Write-Host '=== セットアップ失敗 ===' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
