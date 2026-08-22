@echo off
cd /d "%~dp0"
title oscdesk OSC native UI evaluation

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows PowerShell not found.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-oscdesk-touchosc.ps1" %*
set "OSCdesk_EXIT=%ERRORLEVEL%"

echo.
pause
exit /b %OSCdesk_EXIT%
