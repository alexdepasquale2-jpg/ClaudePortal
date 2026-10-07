# NOTES

- "Neural replaces hardware" is impossible as stated. Hardware is *absorbed* behind MCP Organs, and only the software model goes neural (SPEC §1).
- No model may sit in the Warden's enforcement path. Charter rules are model-drafted but user-confirmed and deterministic.
- Ollama has no official Android build. Android uses embedded llama.cpp, and Ollama is optional on desktop.
- Android Accessibility and launcher use are restricted on Play. Ship via F-Droid/APK, and ship a Play "Lite" build.
- Some popular open-weight models (Llama, Gemma) use custom licenses. They are hidden behind a toggle by the OSI license gate.
- openWakeWord's pretrained models are non-commercial. That is why v1 uses push-to-talk.
- v1 scope (safety): no Android AccessibilityService, no input injection into other apps, no silent SMS (message_send opens a prefilled draft the user sends), and Windows Takeover is fullscreen-at-login rather than replacing the Explorer shell. These match common spyware/persistence patterns and need their own design review.
- Subagent concurrency is CPUs-2 = 2 per workflow here; the org spend limit was hit once with two workflows running. Run one workflow at a time.
