@echo off
rem adb install the newest APK onto a connected phone. Optional: -Apk path\to\file.apk
call "%~dp0ps\run.cmd" install-android %*
