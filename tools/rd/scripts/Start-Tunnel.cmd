@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Pangzhu.ps1" -Mode Tunnel
if errorlevel 1 pause
