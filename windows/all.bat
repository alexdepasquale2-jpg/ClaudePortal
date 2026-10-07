@echo off
setlocal
set "XZ_NOPAUSE=1"
:menu
cls
title Xindoze - menu
echo ============================================
echo   Xindoze one-click scripts
echo ============================================
echo   1. Setup / check prerequisites
echo   2. Build desktop shell (exe + installer)
echo   3. Run desktop shell (dev mode)
echo   4. Build Android debug APK
echo   5. Download latest CI Android APK
echo   6. Install APK on connected phone
echo   7. Run tests (Rust + UI)
echo   8. Deploy desktop to Program Files
echo   9. Uninstall desktop
echo   0. Exit
echo.
choice /c 1234567890 /n /m "Pick an option: "
set "N=%ERRORLEVEL%"
if "%N%"=="10" exit /b 0
if "%N%"=="1" call "%~dp0setup.bat"
if "%N%"=="2" call "%~dp0build-desktop.bat"
if "%N%"=="3" call "%~dp0run-desktop.bat"
if "%N%"=="4" call "%~dp0build-android.bat"
if "%N%"=="5" call "%~dp0download-android-apk.bat"
if "%N%"=="6" call "%~dp0install-android.bat"
if "%N%"=="7" call "%~dp0test.bat"
if "%N%"=="8" call "%~dp0deploy-desktop.bat"
if "%N%"=="9" call "%~dp0uninstall-desktop.bat"
echo.
pause
goto menu
