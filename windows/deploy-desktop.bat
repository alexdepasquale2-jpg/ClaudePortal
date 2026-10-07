@echo off
rem Install the built Canvas to C:\Program Files\Xindoze\xindoze-canvas.exe and add a Start menu shortcut (UAC).
call "%~dp0ps\run.cmd" deploy-desktop %*
