@echo off
cd /d "%~dp0"
title OSC Surface (NiceGUI)

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows PowerShell not found.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-nicegui-ui.ps1" %*
set "UI_EXIT=%ERRORLEVEL%"

echo.
pause
exit /b %UI_EXIT%
