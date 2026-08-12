#Requires -Version 5.1
<#
.SYNOPSIS
    NiceGUI 版コントロールサーフェスの起動。

.DESCRIPTION
    O-S-C を headless(UI 無しの OSC/WebSocket ブリッジ)で起動し、
    ブラウザ画面は NiceGUI 側で提供する。
    Python の仮想環境が無ければ自動で作成する。

    通常はダブルクリックで start-nicegui-ui.bat から呼ばれる。

.PARAMETER OscPort
    O-S-C の HTTP / WebSocket ポート(既定 7080)。

.PARAMETER UiPort
    NiceGUI のポート(既定 8080)。

.PARAMETER SkipServer
    O-S-C を起動しない(既に別ウィンドウで動かしている場合)。

.PARAMETER Reinstall
    Python の依存を入れ直す。

.EXAMPLE
    .\start-nicegui-ui.ps1
    .\start-nicegui-ui.ps1 -UiPort 9000
    .\start-nicegui-ui.ps1 -SkipServer
#>
[CmdletBinding()]
param(
    [int]$OscPort = 7080,
    [int]$UiPort = 8080,
    [switch]$SkipServer,
    [switch]$Reinstall
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$uiRoot = Join-Path $PSScriptRoot 'packages\nicegui-ui'
$venv = Join-Path $uiRoot '.venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'
$customModule = Join-Path $PSScriptRoot 'packages\custom-module\dist\osc-surface.js'
$oscProcess = $null

function Write-Info {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Write-Detail {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "      $Message" -ForegroundColor DarkGray
}

function Test-CommandExists {
    param([Parameter(Mandatory = $true)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Resolve-Python {
    foreach ($candidate in @('py', 'python')) {
        if (Test-CommandExists $candidate) {
            return $candidate
        }
    }

    throw 'Python が見つかりません。https://www.python.org/ から 3.11 以降を導入してください。'
}

try {
    if (-not (Test-Path $customModule)) {
        throw @'
custom module がビルドされていません。先に setup-osc-surface.bat を実行するか、
PowerShell で次を実行してください。
    corepack pnpm install
    corepack pnpm --filter @osc-surface/custom-module run build
'@
    }

    if (-not $SkipServer -and -not (Test-CommandExists 'node')) {
        throw 'Node.js が見つかりません。https://nodejs.org から導入してください。'
    }

    if ($Reinstall -and (Test-Path $venv)) {
        Write-Info '[1/3] Python 仮想環境を作り直します'
        Remove-Item $venv -Recurse -Force
    }

    if (-not (Test-Path $venvPython)) {
        Write-Info '[1/3] Python 仮想環境を作成します（初回のみ・数分かかります）'
        $python = Resolve-Python
        if ($python -eq 'py') {
            & py -3 -m venv $venv
        } else {
            & python -m venv $venv
        }
        if ($LASTEXITCODE -ne 0) { throw '仮想環境の作成に失敗しました。' }

        & $venvPython -m pip install --upgrade pip --quiet
        if ($LASTEXITCODE -ne 0) { throw 'pip の更新に失敗しました。' }

        # "$uiRoot[dev]" と書くと [dev] がインデクサとして解釈されうるため、
        # 曖昧さの無いフォーマット演算子でパスと extras を連結する。
        $editableTarget = '{0}[dev]' -f $uiRoot
        & $venvPython -m pip install -e $editableTarget --quiet
        if ($LASTEXITCODE -ne 0) { throw 'Python 依存の導入に失敗しました。' }
        Write-Detail '導入しました。'
    } else {
        Write-Info '[1/3] Python 仮想環境は導入済みです'
    }

    if ($SkipServer) {
        Write-Info '[2/3] O-S-C は起動しません（-SkipServer）'
    } else {
        Write-Info "[2/3] O-S-C を headless で起動します（ポート $OscPort）"
        $oscArgs = @(
            'vendor\open-stage-control\app',
            '-n', '--no-qrcode',
            '-p', "$OscPort",
            '-o', '7091',
            '-s', '127.0.0.1:7090',
            '-c', 'packages\custom-module\dist\osc-surface.js'
        )
        $oscProcess = Start-Process -FilePath 'node' -ArgumentList $oscArgs -PassThru -NoNewWindow
        Start-Sleep -Seconds 2
        Write-Detail "内蔵 UI: http://localhost:$OscPort"
    }

    Write-Info "[3/3] NiceGUI を起動します: http://localhost:$UiPort"
    Write-Host ''
    Write-Host 'このウィンドウを閉じると全体が止まります。' -ForegroundColor DarkGray
    Write-Host ''

    & $venvPython -m osc_surface_ui --osc-port $OscPort --ui-port $UiPort
} catch {
    Write-Host ''
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($null -ne $oscProcess -and -not $oscProcess.HasExited) {
        Write-Host ''
        Write-Host 'O-S-C を停止します。' -ForegroundColor DarkGray
        Stop-Process -Id $oscProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
