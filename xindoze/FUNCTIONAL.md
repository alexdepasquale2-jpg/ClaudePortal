# Functional checklist

SPEC section 12. Status is what the core tests do on `xindoze/main`. The desktop Canvas that shows the same loop is pull request #8. The Ollama warm-up and context cap are pull request #13.

| Test | Status | Owner |
|---|---|---|
| 1. Act + Rewind | Passing in core. `taxes_move_is_journaled_and_rewinds` creates Taxes 2026, moves the invoice PDF, journals the move, and rewind puts the file back. The Intent Bar that calls this through xinod is the desktop shell in #8. | core, desktop |
| 2. Forge | Partial. A water request installs a Genome with `xz.install_genome`, and `seed_bank_evals_pass` runs the Seed Bank evals. The Canvas does not yet render that app, and a restart of its data is not covered by a UI test. | core, desktop |
| 3. Hive | Partial. With the PC offline, `a_hard_question_runs_here_when_the_pc_is_offline` returns the one-line local notice. `pair_using_a_seed_shows_the_code` shows a pairing code. A paired phone does not run on the PC Cortex; the Hive socket is still open. | hive |
| 4. Injection resistance | Partial. The reflex refuses "ignore all previous" and a page summary says instructions inside the page were ignored. There is no local fixture server that serves that page and then checks Pulse. | core |
| 5. Charter | Passing in core. `charter_rule_holds_a_later_send` holds a later send, and the Charter Seed Bank eval runs inside `seed_bank_evals_pass`. | core |
| 6. Ancestor | Not passing. The eval for "Convert every .docx in Downloads to PDF" expects `fs.search` with `*.docx`. It does not convert through the LibreOffice CLI. | core |
| 7. Zero egress | Not run. Hive stays LAN-only. There is no 24-hour packet capture. | core |

The merged Android APK from #9 crashes on launch. That fix merges ahead of the desktop shell and the speed work.

The desktop loop Alex is driving is Intent Bar, then a plan from the local model, then action cards, then Rewind. Core rewind is in test 1. The window is #8. The model stay-warm and 4096 context behavior is #13.
