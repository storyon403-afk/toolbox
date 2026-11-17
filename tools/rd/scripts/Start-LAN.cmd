@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Pangzhu.ps1" -Mode LAN
if errorlevel 1 pause
