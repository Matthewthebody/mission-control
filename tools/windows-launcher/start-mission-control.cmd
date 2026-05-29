@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start-mission-control.ps1" %*
endlocal
