@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-study.ps1" -OpenBrowser
if errorlevel 1 pause
