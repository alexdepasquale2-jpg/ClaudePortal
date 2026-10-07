@echo off
rem Build the Tauri desktop shell (release exe + NSIS installer).
call "%~dp0ps\run.cmd" build-desktop %*
