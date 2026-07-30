@echo off
cd /d "%~dp0"
title OSC Surface (debug)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org
  pause
  exit /b 1
)

if not exist "packages\custom-module\dist\osc-surface.js" (
  echo [ERROR] custom module is not built. Run these in PowerShell first:
  echo     corepack pnpm install
  echo     corepack pnpm --filter @osc-surface/custom-module run build
  pause
  exit /b 1
)

set "OSC_SURFACE_CONFIG=%~dp0config\surface.debug.config.json"

echo Starting OSC Surface in DEBUG mode...
echo   Web UI  : http://localhost:7080  (browser opens in a few seconds)
echo   To Unity: 127.0.0.1:7090 / From Unity: 7091
echo   Diagnostics panel and NDJSON logs (logs\diagnostics\) are enabled.
echo.
echo Closing this window also stops the server.
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:7080"
node vendor\open-stage-control\app -n -p 7080 -o 7091 -s 127.0.0.1:7090 -l layouts\main.json -c packages\custom-module\dist\osc-surface.js
pause
