@echo off
rem Usage: run.cmd <script-name> [args...]   Shared runner for the windows\*.bat wrappers.
setlocal
set "XZ_DIR=%~dp0"
set "XZ_SCRIPT=%~1"
shift
set "XZ_ARGS="
:collect
if "%~1"=="" goto run
set "XZ_ARGS=%XZ_ARGS% %1"
shift
goto collect
:run
title Xindoze - %XZ_SCRIPT%
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%XZ_DIR%%XZ_SCRIPT%.ps1" %XZ_ARGS%
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" goto ok
echo [FAILED] %XZ_SCRIPT% exited with code %RC%. Scroll up for the red ERROR line.
goto end
:ok
echo [OK] %XZ_SCRIPT% finished.
:end
if not defined XZ_NOPAUSE pause
exit /b %RC%
