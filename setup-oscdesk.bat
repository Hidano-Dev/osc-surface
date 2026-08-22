@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-oscdesk.ps1" %*
set "SETUP_EXIT=%ERRORLEVEL%"
exit /b %SETUP_EXIT%
