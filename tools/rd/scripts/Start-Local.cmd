@echo off
cd /d "%~dp0"
"%~dp0pangzhu.exe" --open
if errorlevel 1 pause
