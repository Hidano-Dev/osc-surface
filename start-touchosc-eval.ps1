#Requires -Version 5.1
<#
.SYNOPSIS
    TouchOSC 評価環境を起動する。

.DESCRIPTION
    mock-unity と O-S-C サーバー(custom module 付き)をまとめて起動し、
    TouchOSC などの OSC ネイティブ UI から接続できる状態にする。

    O-S-C 本体は無改造のまま、OSC I/O と custom module のホストとしてのみ使う。
    UI からの OSC を Unity へ転送する役は custom module の oscUi ルーターが担う。
    詳細は docs/TOUCHOSC_EVAL.md を参照。
#>
[CmdletBinding()]
param(
    # O-S-C の HTTP / WebSocket ポート(ブラウザ UI との比較用)
    [int]$HttpPort = 7080,
    # OSC 受信ポート。TouchOSC からはここへ送る
    [int]$OscInPort = 7091,
    # mock-unity の待受ポート(サーフェス → Unity)
    [int]$UnityPort = 7090,
    # ビルド済みでも強制的に再ビルドする
    [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$customModule = 'packages\custom-module\dist\osc-surface.js'
$mockUnity = 'packages\mock-unity\dist\mock-unity.js'
$scenario = 'packages\mock-unity\scenarios\touchosc-eval.json'
$configPath = 'config\surface.touchosc.config.json'

function Write-Step($message) {
    Write-Host "==> $message" -ForegroundColor Cyan
}

function Write-Fail($message) {
    Write-Host "[エラー] $message" -ForegroundColor Red
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Fail 'Node.js が見つかりません。https://nodejs.org からインストールしてください。'
    Read-Host '閉じるには Enter'
    exit 1
}

if (-not (Test-Path $scenario)) {
    Write-Fail "評価用シナリオが見つかりません: $scenario"
    Read-Host '閉じるには Enter'
    exit 1
}

# --- ビルド ------------------------------------------------------------------

$needsCustomModule = $Rebuild -or -not (Test-Path $customModule)
$needsMockUnity = $Rebuild -or -not (Test-Path $mockUnity)

if ($needsCustomModule -or $needsMockUnity) {
    Write-Step 'ビルド生成物が無いのでビルドします(初回のみ数十秒)'

    $filters = @()
    if ($needsCustomModule) { $filters += '@osc-surface/custom-module' }
    if ($needsMockUnity) { $filters += '@osc-surface/mock-unity' }

    foreach ($filter in $filters) {
        Write-Host "    building $filter"
        & corepack pnpm --filter $filter run build
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "$filter のビルドに失敗しました。先に 'corepack pnpm install' を実行してください。"
            Read-Host '閉じるには Enter'
            exit 1
        }
    }
}

# --- O-S-C の設定フォルダ ----------------------------------------------------

# O-S-C 本体は設定フォルダを非再帰の mkdir で作るため、親が無い新しい PC では
# 「Could not create config folder」で失敗する。本体は改造しない方針なので、
# ここで先に掘っておく(既にあれば何もしない)。
$oscConfigDir = Join-Path $env:APPDATA 'open-stage-control\Config'
if (-not (Test-Path $oscConfigDir)) {
    New-Item -ItemType Directory -Force -Path $oscConfigDir | Out-Null
    Write-Step "O-S-C の設定フォルダを作成しました: $oscConfigDir"
}

# --- 接続先の案内 ------------------------------------------------------------

# 物理 LAN を優先して並べる。VPN・仮想スイッチ・Hyper-V などが多いマシンでは
# 候補が大量に出るため、それらしいものを先頭に持ってくる。
$candidates = @(
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
        ForEach-Object {
            $alias = $_.InterfaceAlias
            $isVirtual = $alias -match 'vEthernet|VirtualBox|VMware|Hyper-V|Loopback|TAP|Tailscale|ZeroTier|WSL'
            [pscustomobject]@{
                IPAddress = $_.IPAddress
                Alias     = $alias
                Rank      = if ($isVirtual) { 1 } else { 0 }
            }
        } |
        Sort-Object Rank, Alias
)

if ($candidates.Count -eq 0) {
    $candidates = @([pscustomobject]@{ IPAddress = '127.0.0.1'; Alias = 'loopback'; Rank = 0 })
}

Write-Host ''
Write-Host '======================================================================'
Write-Host ' TouchOSC 評価環境' -ForegroundColor Green
Write-Host '======================================================================'
Write-Host ''
Write-Host ' TouchOSC の Connections > OSC に以下を設定してください:'
Write-Host ''
Write-Host ("   Send  ポート : {0}" -f $OscInPort) -ForegroundColor Yellow
Write-Host '   Receive ポート: 任意(例 9000)。名乗りで自動登録されます' -ForegroundColor Yellow
Write-Host ''
Write-Host '   Send ホスト : この PC の IP。候補が複数ある場合は' -ForegroundColor Yellow
Write-Host '                 タブレットと同じ Wi-Fi/LAN のものを選んでください' -ForegroundColor Yellow
Write-Host ''
foreach ($candidate in $candidates) {
    $mark = if ($candidate.Rank -eq 0) { '  ->' } else { '    ' }
    $note = if ($candidate.Rank -eq 0) { '' } else { '  (仮想アダプタの可能性)' }
    Write-Host ("{0} {1,-16} [{2}]{3}" -f $mark, $candidate.IPAddress, $candidate.Alias, $note)
}
Write-Host ''
Write-Host '   繋がらない場合はタブレット側で ipconfig 相当を確認し、'
Write-Host '   前 3 オクテットが一致する候補を選び直してください。'
Write-Host ''
Write-Host ' 接続後、TouchOSC から一度だけ名乗りを送ってください:'
Write-Host ('   /surface/hello  <Receive ポート:int>')
Write-Host ''
Write-Host (' 比較用のブラウザ UI : http://localhost:{0}' -f $HttpPort)
Write-Host (' 使用シナリオ        : {0}' -f $scenario)
Write-Host ''
Write-Host ' このウィンドウを閉じるとサーバーも mock-unity も停止します。'
Write-Host '======================================================================'
Write-Host ''

# --- 起動 --------------------------------------------------------------------

$env:OSC_SURFACE_CONFIG = (Resolve-Path $configPath).Path

Write-Step ("mock-unity を起動します (待受 {0})" -f $UnityPort)
$mockProcess = Start-Process -FilePath 'node' `
    -ArgumentList @($mockUnity, '--listen-port', $UnityPort, '--scenario', $scenario) `
    -NoNewWindow -PassThru

try {
    Write-Step ("O-S-C サーバーを起動します (http {0} / osc-in {1})" -f $HttpPort, $OscInPort)
    Write-Host ''

    & node vendor\open-stage-control\app `
        -n --no-qrcode `
        -p $HttpPort `
        -o $OscInPort `
        -s ("127.0.0.1:{0}" -f $UnityPort) `
        -l layouts\main.json `
        -c $customModule
}
finally {
    if ($mockProcess -and -not $mockProcess.HasExited) {
        Write-Step 'mock-unity を停止します'
        Stop-Process -Id $mockProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
