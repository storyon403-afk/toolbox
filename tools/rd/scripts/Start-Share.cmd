@echo off
cd /d "%~dp0"
"%~dp0pangzhu.exe" --quick-share --open
if errorlevel 1 (
  echo.
  echo Sharing could not start. Check the message above and data\share.log.
  pause
)
