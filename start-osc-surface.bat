@echo off
cd /d "%~dp0"
title OSC Surface

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

echo Starting OSC Surface...
echo   Web UI  : http://localhost:7080  (browser opens in a few seconds)
echo   To Unity: 127.0.0.1:7090 / From Unity: 7091
echo.
echo Closing this window also stops the server.
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:7080"
node vendor\open-stage-control\app -n -p 7080 -o 7091 -s 127.0.0.1:7090 -c packages\custom-module\dist\osc-surface.js
pause
