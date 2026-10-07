@echo off
rem Download the latest CI APK artifact (needs a GitHub token), otherwise open the Actions page.
call "%~dp0ps\run.cmd" download-android-apk %*
