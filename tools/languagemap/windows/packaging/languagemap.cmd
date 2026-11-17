@echo off
if "%~1"=="--version" (echo LanguageMap 1.1.0& exit /b 0)
if "%~1"=="--data-dir" (echo "%LOCALAPPDATA%\LanguageMap"& exit /b 0)
if "%~1"=="--help" (
 echo languagemap              Open LanguageMap
 echo languagemap --version    Show version
 echo languagemap --data-dir   Show library folder
 exit /b 0
)
if not "%~1"=="" (echo Unknown option. Use languagemap --help.& exit /b 2)
start "" "%~dp0LanguageMap.exe"
