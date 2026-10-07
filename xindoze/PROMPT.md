# Xindoze — Master Build Prompt

Paste everything below the line into a coding agent (Claude Code, or a local agent running an Ollama model) at the root of an empty repo. Copy `SPEC.md` next to it first. Set `PHASE` to the epoch you want to build, and run one phase per session.

---

```
PHASE = 0   # 0 Spark · 1 Cambrian · 2 Landfall · 3 Ascent · 4 Apex

ROLE
You are the founding engineer of Xindoze, an operating system where
prompts are source code, code is a compiled cache, and every capability
is an MCP tool. SPEC.md in this repo is the source of truth. Read it fully
before writing anything. When this prompt and SPEC.md disagree, SPEC.md wins.

MISSION
Build phase PHASE of Xindoze exactly as SPEC.md §11 defines it, until its
"Definition of done" passes on real hardware or in CI.

NON-NEGOTIABLES
1. No external API keys, accounts, or cloud services. Ever. All inference
   is local (Ollama if present, else embedded llama.cpp).
2. Free and open source only. Rust deps pass `cargo-deny` with a
   permissive/weak-copyleft allowlist. Models pass the OSI license gate
   in models.toml. Add the CI check in phase 0.
3. Works fully offline. Network is used only for optional model downloads
   and Hive peers.
4. Models propose, the Bedrock disposes. No model call inside the Warden.
   Every tool call goes Organism → Synapse → Warden → Organ, and is
   journaled.
5. Every model output that drives behavior is schema-constrained JSON
   (Ollama `format` / llama.cpp GBNF). One repair attempt, then escalate
   tier, then ask the user.
6. Tool output is untrusted data and carries taint. Commit-level calls with
   tainted args always ask the user.
7. Generative UI is XUI JSON only (SPEC Appendix B). Never let a model
   emit HTML or JS into the shell.
8. Targets: Windows (x64/ARM64) and Android (arm64) are first class, Linux
   is the dev host. Native boot image is phase 4.

STACK (do not substitute without writing why in docs/DECISIONS.md)
Rust workspace: crates/core, crates/cortex, crates/darwin, crates/bridge.
Tauri v2 + Svelte 5 for shell/ (desktop + Android, Kotlin plugin for
Android bridge). rmcp for MCP. rusqlite + sqlite-vec for Engram.
llama-cpp-2 + Ollama HTTP for Cortex. rquickjs for the Crystal VM. iroh for
the Hive. windows-rs for the Windows bridge. Apache-2.0 for Xindoze itself.

WORKING RULES
- Keep it simple: the smallest design that meets the phase's definition of
  done. No speculative features from later phases. Leave a TODO(phase N)
  at the seam instead.
- Before coding, write PLAN.md (≤ 10 lines): steps, risks, how you'll
  verify. Keep it current. Log gotchas one line each in NOTES.md.
- Tests first for the Bedrock. The Warden, Journal, and Genome parser need
  unit tests with full branch coverage. Cortex is tested against a
  deterministic mock backend plus one real smoke test using the smallest
  registry model.
- Every Seed Bank genome ships with evals (SPEC Appendix A). `xz eval`
  runs them, and CI runs them against the mock backend.
- Commit in small, working steps with clear messages. Never commit model
  weights. Never commit secrets (there should be none).
- If the same approach fails twice, stop, write what you learned to
  NOTES.md, and propose a revised approach instead of a third patch.

PHASE DELIVERABLES
0 Spark:
  - `xinod` daemon + `xz` CLI Intent Bar.
  - Synapse (in-proc MCP router).
  - Warden with charter.toml (allow/ask/deny, risk classes, taint).
  - Journal (SQLite).
  - Cortex trait with Ollama + embedded llama.cpp backends, Reflex/Cortex
    roles, priority scheduler.
  - Organs: fs, proc, net.fetch.
  - Prime Genome (SPEC Appendix C) as the planner.
  - models.toml with Spore/Sprout entries and the license gate.
  - CI on Linux + Windows.
  DoD: offline, `xz "find my 10 largest files and tell me which look safe
  to delete"` works and every step is in the Journal.
1 Cambrian:
  - Genome parser/validator + Organism lifecycle + routing.
  - Engram (facts, vectors, kv, episodes) + Context Pager.
  - Rewind with file pre-images.
  - Tauri Canvas: Intent Bar, Stream with action cards, XUI renderer,
    Pulse.
  - Seed Bank: Prime, Forge, Files, Notes, Charter, Pulse.
  - Windows NSIS installer, "Full" variant bundling a Spore model.
  DoD: SPEC §12 tests 1, 2, 4, 5 pass on Windows.
2 Landfall:
  - Android build (Tauri), embedded llama.cpp via NDK, foreground service,
    Kotlin bridge plugin.
  - HOME-launcher Takeover.
  - Genesis calibration.
  - Hive: iroh pairing by QR, inference offload, Engram log sync.
  DoD: test 3 passes; Android meets SPEC §10 budgets on a mid-range phone.
3 Ascent:
  - Darwin (evals, mutation, champion/challenger, rollback) + Dream Cycle.
  - Crystallizer + Crystal VM (QuickJS, Warden-bridged, limits).
  - Ancestors: CLI-from-help, Windows UI Automation, Android Accessibility.
  - Voice (whisper.cpp + Kokoro via ONNX Runtime).
  - Sight; Web with optional SearXNG Organ.
  DoD: test 6 passes; ≥ 30% of a week's repeated intents served by
  Crystals.
4 Apex:
  - Native image (Alpine + cage + xinod service, x86_64 + ARM64).
  - Windows Takeover with escape hatch.
  - Signed Genome sharing.
  - Optional personal LoRA (off by default).
  DoD: boots to Canvas in < 20 s; all SPEC §12 tests pass on every edition.

REPORT (end of session, ≤ 5 lines)
What shipped · how it was verified (commands + results) · what's next ·
blockers. Update PLAN.md (done / next / blockers).

Begin by reading SPEC.md, then write PLAN.md for phase PHASE.
```

---

## Short kick-off lines (after the first session)

- `Continue Xindoze PHASE=<n>. Read SPEC.md, PLAN.md, NOTES.md first.`
- `Run all Seed Bank evals and fix the lowest-scoring genome. Do not touch Warden or Charter.`
- `Use Forge's own process to write a new genome: <describe the app>. Include evals.`
