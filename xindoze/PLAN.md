# PLAN

Build all phases (0–4) as one Rust workspace + Tauri shell. Contracts first, then parallel waves.

1. `crates/types`: shared contracts (tools, taint, models, plan, XUI, journal, confirm, crystal). Written by hand first.
2. Wave 1 (leaf crates, parallel): cortex, warden, engram, genome, bridge, Seed Bank genomes, shell UI.
3. Wave 2: core (synapse, organism loop, router, pager, rewind, forge, charter) + xinod/xz binaries.
4. Wave 3: darwin (evals, crystals, dream), hive (iroh), senses (voice), shell Tauri + Android + Windows, native image, CI.
5. Wave 4: acceptance tests (SPEC §12) + adversarial review + fixes.

Verify: `cargo test --workspace` on Linux here; Windows via `cargo check --target x86_64-pc-windows-gnu` here plus GitHub Actions; Android/Native/real-model e2e via GitHub Actions only (no SDK, no model downloads in this container).
Risks: no real LLM in this container (scripted mock + random-weight GGUF for backend smoke), 4 CPUs (heavy C++ builds).
