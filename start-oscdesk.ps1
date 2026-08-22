#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$bridgeArtifact = Join-Path $PSScriptRoot 'packages\bridge\dist\oscdesk-bridge.js'
$uiRoot = Join-Path $PSScriptRoot 'packages\nicegui-ui'
$venvPython = Join-Path $uiRoot '.venv\Scripts\python.exe'
$bridgeProcess = $null
$uiProcess = $null
$bridgeStdout = $null
$bridgeStderr = $null
$uiStdout = $null
$uiStderr = $null

function Write-Info {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Write-ErrorMessage {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Stop-ProcessTree {
    param([System.Diagnostics.Process]$Process)
    if ($null -eq $Process) { return }

    try {
        if (-not $Process.HasExited) {
            & taskkill.exe /PID $Process.Id /T /F *> $null
        }
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
        if (-not $line.StartsWith('OSCDESK_BRIDGE_READY ')) { continue }
        try {
            return ($line.Substring('OSCDESK_BRIDGE_READY '.Length) | ConvertFrom-Json)
        } catch {
            throw "ブリッジの起動完了行を解析できません: $line"
        }
    }
    return $null
}

function ConvertTo-ArgumentString {
    # Start-Process の ArgumentList は要素を空白結合するだけでクオートしないため、
    # 空白を含むパスが複数引数に割れる。ここで明示的にクオートして 1 本の文字列にする
    param([string[]]$Arguments)
    return ($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }) -join ' '
}

function Get-LanAddresses {
    try {
        return @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
            Select-Object -ExpandProperty IPAddress -Unique)
    } catch {
        return @()
    }
}

try {
    if (-not (Test-Path -LiteralPath $bridgeArtifact -PathType Leaf)) {
        throw "ブリッジのビルド成果物がありません。先に次を実行してください: corepack pnpm --filter @oscdesk/bridge run build"
    }
    if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
        throw "Python 仮想環境がありません。先に次を実行してください: .\setup-oscdesk.bat"
    }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw 'Node.js が見つかりません。Node.js 20 以降を導入してください。'
    }

    $bridgeStdout = [System.IO.Path]::GetTempFileName()
    $bridgeStderr = [System.IO.Path]::GetTempFileName()
    $uiStdout = [System.IO.Path]::GetTempFileName()
    $uiStderr = [System.IO.Path]::GetTempFileName()

    $bridgeArguments = @($bridgeArtifact)
    if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
        $bridgeArguments += @('--config', (Resolve-Path -LiteralPath $ConfigPath).Path)
    }

    Write-Info 'ブリッジを起動しています...'
    $bridgeProcess = Start-Process -FilePath 'node.exe' -ArgumentList (ConvertTo-ArgumentString $bridgeArguments) `
        -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $bridgeStdout -RedirectStandardError $bridgeStderr

    $ready = $null
    $deadline = (Get-Date).AddSeconds(30)
    while ($null -eq $ready -and (Get-Date) -lt $deadline) {
        if ($bridgeProcess.HasExited) {
            $detail = Get-OutputText $bridgeStderr
            if ([string]::IsNullOrWhiteSpace($detail)) { $detail = Get-OutputText $bridgeStdout }
            throw "ブリッジの起動に失敗しました (exit $($bridgeProcess.ExitCode)): $detail"
        }
        $ready = Find-ReadyLine $bridgeStdout
        if ($null -eq $ready) { Start-Sleep -Milliseconds 100 }
    }
    if ($null -eq $ready) {
        throw "ブリッジの起動完了行が 30 秒以内に出ませんでした: $(Get-OutputText $bridgeStderr)"
    }
    if ($null -eq $ready.wsPort -or $null -eq $ready.uiPort) {
        throw 'ブリッジの起動完了行にポート情報がありません。'
    }

    Write-Info "ブリッジの起動完了: WebSocket $($ready.wsPort) / UI $($ready.uiPort)"

    # 設定で解決されたホストを尊重する。ワイルドカード待受(0.0.0.0)のときだけ
    # ループバックで接続し、特定アドレス指定なら UI 露出も接続先もそれに従う
    $uiHost = if ($null -eq $ready.uiHost) { '0.0.0.0' } else { $ready.uiHost }
    $wsHost = if ($null -eq $ready.wsHost) { '0.0.0.0' } else { $ready.wsHost }
    $bridgeConnectHost = if ($wsHost -eq '0.0.0.0') { '127.0.0.1' } else { $wsHost }

    $uiArguments = @('-m', 'oscdesk_ui', '--osc-host', $bridgeConnectHost, '--osc-port', "$($ready.wsPort)", '--ui-host', $uiHost, '--ui-port', "$($ready.uiPort)")
    Write-Info 'UI を起動しています...'
    $uiProcess = Start-Process -FilePath $venvPython -ArgumentList (ConvertTo-ArgumentString $uiArguments) `
        -WorkingDirectory $uiRoot -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $uiStdout -RedirectStandardError $uiStderr

    # 「500ms 後に生きている」だけでは、遅れて bind に失敗するケース(ポート使用中など)を
    # 見逃して URL を案内してしまう。TCP 接続できるまでを起動成功とする
    $uiProbeHost = if ($uiHost -eq '0.0.0.0') { '127.0.0.1' } else { $uiHost }
    $uiReady = $false
    $uiDeadline = (Get-Date).AddSeconds(30)
    while (-not $uiReady -and (Get-Date) -lt $uiDeadline) {
        if ($uiProcess.HasExited) {
            $detail = Get-OutputText $uiStderr
            if ([string]::IsNullOrWhiteSpace($detail)) { $detail = Get-OutputText $uiStdout }
            throw "UI の起動に失敗しました (exit $($uiProcess.ExitCode)): $detail"
        }
        $client = $null
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            if ($client.ConnectAsync($uiProbeHost, [int]$ready.uiPort).Wait(500)) { $uiReady = $true }
        } catch {} finally {
            if ($null -ne $client) { $client.Dispose() }
        }
        if (-not $uiReady) { Start-Sleep -Milliseconds 250 }
    }
    if (-not $uiReady) {
        $detail = Get-OutputText $uiStderr
        throw "UI が 30 秒以内に待受を開始しませんでした: $detail"
    }

    Write-Host ''
    Write-Host '接続先 URL:' -ForegroundColor Green
    if ($uiHost -eq '0.0.0.0') {
        $addresses = Get-LanAddresses
        if ($addresses.Count -eq 0) { $addresses = @('127.0.0.1') }
    } else {
        $addresses = @($uiHost)
    }
    foreach ($address in $addresses) {
        Write-Host ('  http://{0}:{1}' -f $address, $ready.uiPort) -ForegroundColor Green
    }
    Write-Host ''
    Write-Host 'このウィンドウを閉じるとブリッジと UI を停止します。' -ForegroundColor DarkGray

    # どちらか一方が落ちたら気づけるよう、両方のプロセスを監視する。
    # UI だけ待つと、ブリッジが落ちても UI が再接続を試み続けるだけの死に体になる
    while ($true) {
        if ($bridgeProcess.HasExited) {
            $detail = Get-OutputText $bridgeStderr
            if ([string]::IsNullOrWhiteSpace($detail)) { $detail = Get-OutputText $bridgeStdout }
            throw "ブリッジが終了しました (exit $($bridgeProcess.ExitCode))。UI も停止します: $detail"
        }
        if ($uiProcess.HasExited) {
            if ($uiProcess.ExitCode -ne 0) {
                $detail = Get-OutputText $uiStderr
                throw "UI が終了しました (exit $($uiProcess.ExitCode))。ブリッジも停止します: $detail"
            }
            break
        }
        Start-Sleep -Milliseconds 500
    }
} catch {
    Write-ErrorMessage $_.Exception.Message
    exit 1
} finally {
    Stop-ProcessTree $uiProcess
    Stop-ProcessTree $bridgeProcess
    foreach ($path in @($bridgeStdout, $bridgeStderr, $uiStdout, $uiStderr)) {
        if ($null -ne $path -and (Test-Path -LiteralPath $path)) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
    }
}
