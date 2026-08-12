@echo off
cd /d "%~dp0"
title OSC Surface - TouchOSC evaluation
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-touchosc-eval.ps1" %*
pause
