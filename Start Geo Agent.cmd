@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-private-stack.ps1" -CreateDesktopShortcut
if errorlevel 1 pause
