@echo off
setlocal

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0desktop\Run-CodexActionBoard.ps1" -Language en

echo.
echo Press any key to close this window.
pause >nul
