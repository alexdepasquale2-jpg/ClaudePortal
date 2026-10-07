@echo off
rem Remove what deploy-desktop.bat installed (UAC).
call "%~dp0ps\run.cmd" deploy-desktop -Uninstall %*
