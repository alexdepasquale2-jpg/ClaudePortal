@echo off
rem Rust tests (CI crate list) + Canvas UI checks. Optional: -RustOnly or -UiOnly
call "%~dp0ps\run.cmd" test %*
