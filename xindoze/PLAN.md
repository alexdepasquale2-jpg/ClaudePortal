# PLAN

## STATUS (2026-10-07)

Phase 0 loop is on the base Engram, Genome, Bridge and Seed Bank. `xz` routes an intent, plans with the offline reflex (or Ollama when `XZ_MODEL` is set), and journals every call. Phase 1 slice: Context Pager, Files act + Rewind, Charter rules that hold a later send. Shell stays a workspace member; this host has no WebKit, so local `cargo test` excludes `xindoze-shell`. Native boot (this track): `xz-boot` plans the Alpine + cage + xinod lifecycle, renders a layout behind `XZ_NATIVE_BUILD=1`, and models Windows Takeover as a reversible fullscreen-at-login launcher. It does not edit Hive, Crystal, Android, or the Tauri shell. Next for other tracks: Crystal fast path (phase 3), Hive pairing (phase 2), Android.

Build all phases (0–4) as one Rust workspace + Tauri shell. Contracts first, then parallel waves.

1. `crates/types`: shared contracts (tools, taint, models, plan, XUI, journal, confirm, crystal). Written by hand first.
2. Wave 1 (leaf crates, parallel): cortex, warden, engram, genome, bridge, Seed Bank genomes, shell UI.
3. Wave 2: core (synapse, organism loop, router, pager, rewind, forge, charter) + xinod/xz binaries.
4. Wave 3: darwin (evals, crystals, dream), hive (iroh), senses (voice), shell Tauri + Android + Windows, native image, CI.
5. Wave 4: acceptance tests (SPEC §12) + adversarial review + fixes.

Verify: `cargo test --workspace` on Linux here; Windows via `cargo check --target x86_64-pc-windows-gnu` here plus GitHub Actions; Android/Native/real-model e2e via GitHub Actions only (no SDK, no model downloads in this container).
Risks: no real LLM in this container (scripted mock + random-weight GGUF for backend smoke), 4 CPUs (heavy C++ builds).
