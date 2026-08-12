#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

& (Join-Path $PSScriptRoot 'start-oscdesk.ps1') -ConfigPath (Join-Path $PSScriptRoot 'config\oscdesk.debug.config.json')
exit $LASTEXITCODE
