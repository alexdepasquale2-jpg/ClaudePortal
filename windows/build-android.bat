@echo off
rem cargo tauri android build --debug --apk --target aarch64
rem APK: xindoze\dist\android\xindoze-debug.apk
rem Pass -Target x86_64 for an emulator.
call "%~dp0ps\run.cmd" build-android %*
