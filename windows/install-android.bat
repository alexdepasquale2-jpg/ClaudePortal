@echo off
rem adb install xindoze\dist\android\xindoze-debug.apk (or the newest APK found). Optional: -Apk path\to\file.apk
call "%~dp0ps\run.cmd" install-android %*
