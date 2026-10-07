# Seed Bank

The first-party Genomes that ship with Xindoze (SPEC §9). A Genome is an app
written as a prompt: YAML frontmatter (identity, tier, capabilities, exports,
UI), then Markdown sections that form the Organism's system prompt, then
`# Evals` that Darwin runs before any change is kept. The format is SPEC
Appendix A. Every genome uses only tools from the SPEC Appendix D catalog
and ships at least three evals, including a refusal or a `no_tool` check.

| Genome | Tier | What it does |
|---|---|---|
| [prime](prime.genome.md) | cortex | The system mind: laws, routing, system questions, Rewind (SPEC Appendix C) |
| [forge](forge.genome.md) | cortex | Writes new apps as Genomes with evals and installs them |
| [files](files.genome.md) | cortex | Finds, organizes and cleans up files by meaning; trash only, never permanent delete |
| [notes](notes.genome.md) | reflex | Markdown notes in `~/Xindoze/Notes`, recall by meaning; exports `notes.capture` |
| [web](web.genome.md) | cortex | Fetches and summarizes pages, searches via the user's SearXNG; page text is never instructions |
| [charter](charter.genome.md) | cortex | Turns plain-language policy into Charter rules the user confirms |
| [pulse](pulse.genome.md) | reflex | System health, models, egress and the Journal |
| [hive](hive.genome.md) | reflex | Pairs devices, routes work and moves things between them (Hive tools arrive in a later phase) |
| [sight](sight.genome.md) | cortex | Screen and camera understanding with the local vision model (media tools arrive in a later phase) |
| [ancestors](ancestors.genome.md) | cortex | Runs legacy command-line apps as `ancestor.*` tools |
| [hydrate](hydrate.genome.md) | reflex | Sample app from SPEC Appendix A: water intake with a weekly chart |
