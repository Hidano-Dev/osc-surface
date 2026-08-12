@echo off
cd /d "%~dp0"
title OSC Surface Setup

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows PowerShell not found.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-osc-surface.ps1" %*
set "SETUP_EXIT=%ERRORLEVEL%"

echo.
pause
exit /b %SETUP_EXIT%
