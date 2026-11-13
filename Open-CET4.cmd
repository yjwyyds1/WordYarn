@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0web\tools\start-study.ps1" -OpenBrowser
if errorlevel 1 pause
