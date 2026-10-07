@echo off
rem Build the debug APK locally (arm64). Pass -Target x86_64 for an emulator.
call "%~dp0ps\run.cmd" build-android %*
