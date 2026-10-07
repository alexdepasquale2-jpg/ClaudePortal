@echo off
rem Check and install prerequisites: Rust, MSVC, WebView2, Node + npm deps, Tauri CLI, optional Android toolchain.
call "%~dp0ps\run.cmd" setup %*
