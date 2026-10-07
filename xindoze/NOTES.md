# NOTES

- "Neural replaces hardware" is impossible as stated. Hardware is *absorbed* behind MCP Organs, and only the software model goes neural (SPEC §1).
- No model may sit in the Warden's enforcement path. Charter rules are model-drafted but user-confirmed and deterministic.
- Ollama has no official Android build. Android uses embedded llama.cpp, and Ollama is optional on desktop.
- Android Accessibility and launcher use are restricted on Play. Ship via F-Droid/APK, and ship a Play "Lite" build.
- Some popular open-weight models (Llama, Gemma) use custom licenses. They are hidden behind a toggle by the OSI license gate.
- openWakeWord's pretrained models are non-commercial. That is why v1 uses push-to-talk.
- v1 scope (safety): no Android AccessibilityService, no input injection into other apps, no silent SMS (message_send opens a prefilled draft the user sends), and Windows Takeover is fullscreen-at-login rather than replacing the Explorer shell. These match common spyware/persistence patterns and need their own design review.
- Subagent concurrency is CPUs-2 = 2 per workflow here; the org spend limit was hit once with two workflows running. Run one workflow at a time.
- Phase 0 `fs` does not follow symlinks. The Warden's path check is lexical, so a link could otherwise leave a grant.
- `net.fetch` does not follow redirects. A 30x is data; the Organ must not contact a host the Warden did not see.
- Prime's `fs.*` grants are narrowed to `~/**` at germination. The data directory stays denied by the Warden even inside that tree.
- With no `XZ_MODEL` (or no Ollama), `xz` uses an in-process reflex that only proposes plans. It is not in the Warden. Embedded llama.cpp stays behind the `llamacpp` feature until a verified GGUF is present.
- `fs.search` stops at 20_000 files and depth 8, so "largest" means largest among the files visited.
- "Looks safe to delete" is judged on the path relative to home. Matching `/tmp/` on the absolute path marked every file safe when home itself was under `/tmp`.
- Appendix A writes `engram.kv.write`; Appendix D writes `engram.kv_write`. The parser keeps the Appendix A form (`family.verb` joined with a dot).
- Journal INSERT parameters are owned `SqlValue`s. Returning `params![]` from a function does not live long enough on rustc 1.99.
- `shell/src-tauri` is not a workspace member until phase 1. `cargo test --workspace` cannot build Tauri here without GTK/WebKit and `shell/ui`.
