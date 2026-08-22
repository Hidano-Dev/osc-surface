#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$bridgeArtifact = Join-Path $PSScriptRoot 'packages\bridge\dist\oscdesk-bridge.js'
$mockUnityArtifact = Join-Path $PSScriptRoot 'packages\mock-unity\dist\mock-unity.js'
$scenarioPath = Join-Path $PSScriptRoot 'packages\mock-unity\scenarios\touchosc-eval.json'
$configPath = Join-Path $PSScriptRoot 'config\oscdesk.touchosc.config.json'
$mockProcess = $null
$bridgeProcess = $null
$bridgeStdout = $null
$bridgeStderr = $null
$mockStdout = $null
$mockStderr = $null

function Stop-ProcessTree {
    param([System.Diagnostics.Process]$Process)
    if ($null -eq $Process) { return }
    try {
        if (-not $Process.HasExited) { & taskkill.exe /PID $Process.Id /T /F *> $null }
    } catch {
        Write-Host "プロセス $($Process.Id) の回収に失敗しました: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Get-OutputText {
    param([string]$Path)
    if ($null -eq $Path -or -not (Test-Path -LiteralPath $Path)) { return '' }
    return [string]::Join([Environment]::NewLine, (Get-Content -LiteralPath $Path -Encoding UTF8))
}

function Find-ReadyLine {
    param([string]$Path)
    if ($null -eq $Path -or -not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
        if ($line.StartsWith('OSCDESK_BRIDGE_READY ')) {
            return ($line.Substring('OSCDESK_BRIDGE_READY '.Length) | ConvertFrom-Json)
        }
    }
    return $null
}

try {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw 'Node.js が見つかりません。Node.js 20 以降を導入してください。'
    }
    foreach ($required in @($bridgeArtifact, $mockUnityArtifact, $scenarioPath, $configPath)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "必要なファイルがありません: $required。先にセットアップまたはビルドを実行してください。"
        }
    }

    $bridgeStdout = [System.IO.Path]::GetTempFileName()
    $bridgeStderr = [System.IO.Path]::GetTempFileName()
    $mockStdout = [System.IO.Path]::GetTempFileName()
    $mockStderr = [System.IO.Path]::GetTempFileName()

    Write-Host 'mock-unity を起動しています...' -ForegroundColor Cyan
    $mockProcess = Start-Process -FilePath 'node.exe' `
        -ArgumentList @($mockUnityArtifact, '--listen-port', '7090', '--scenario', $scenarioPath) `
        -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $mockStdout -RedirectStandardError $mockStderr

    # mock-unity がポートを掴めないまま(Unity Editor が 7090 を使用中など)ブリッジだけ
    # 起動すると、Unity 不在の評価環境を延々と案内してしまう。READY 行を待ってから進む
    $mockReady = $false
    $mockDeadline = (Get-Date).AddSeconds(15)
    while (-not $mockReady -and (Get-Date) -lt $mockDeadline) {
        if ($mockProcess.HasExited) {
            $detail = Get-OutputText $mockStderr
            if ([string]::IsNullOrWhiteSpace($detail)) { $detail = Get-OutputText $mockStdout }
            throw "mock-unity の起動に失敗しました (exit $($mockProcess.ExitCode))。ポート 7090 を使用中のプロセス(Unity Editor 等)が無いか確認してください: $detail"
        }
        if ((Get-OutputText $mockStdout) -match 'MOCK_UNITY_READY') { $mockReady = $true }
        if (-not $mockReady) { Start-Sleep -Milliseconds 100 }
    }
    if (-not $mockReady) {
        throw "mock-unity の起動完了行が 15 秒以内に出ませんでした: $(Get-OutputText $mockStderr)"
    }

    Write-Host 'ブリッジを起動しています...' -ForegroundColor Cyan
    $bridgeProcess = Start-Process -FilePath 'node.exe' `
        -ArgumentList @($bridgeArtifact, '--config', $configPath) `
        -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $bridgeStdout -RedirectStandardError $bridgeStderr

    $ready = $null
    $deadline = (Get-Date).AddSeconds(30)
    while ($null -eq $ready -and (Get-Date) -lt $deadline) {
        if ($bridgeProcess.HasExited) {
            throw "ブリッジの起動に失敗しました (exit $($bridgeProcess.ExitCode)): $(Get-OutputText $bridgeStderr)"
        }
        $ready = Find-ReadyLine $bridgeStdout
        if ($null -eq $ready) { Start-Sleep -Milliseconds 100 }
    }
    if ($null -eq $ready) { throw "ブリッジの起動完了行が 30 秒以内に出ませんでした: $(Get-OutputText $bridgeStderr)" }

    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
        Select-Object -ExpandProperty IPAddress -Unique)
    if ($addresses.Count -eq 0) { $addresses = @('127.0.0.1') }

    Write-Host ''
    Write-Host 'OSC ネイティブ UI 評価環境が起動しました。' -ForegroundColor Green
    Write-Host 'TouchOSC の送信先 IP:' -ForegroundColor Green
    foreach ($address in $addresses) { Write-Host "  $address" -ForegroundColor Green }
    Write-Host "OSC 受信ポート: $($ready.oscListenPort)" -ForegroundColor Green
    Write-Host ''
    Write-Host 'このウィンドウを閉じるとブリッジと mock-unity を停止します。' -ForegroundColor DarkGray
    Wait-Process -Id $bridgeProcess.Id
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Stop-ProcessTree $bridgeProcess
    Stop-ProcessTree $mockProcess
    foreach ($path in @($bridgeStdout, $bridgeStderr, $mockStdout, $mockStderr)) {
        if ($null -ne $path -and (Test-Path -LiteralPath $path)) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
    }
}
