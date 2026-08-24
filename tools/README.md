# Tools

Unity gave us Editor windows. On the web we write CLIs instead (ADR-0005), which turns out to be a
fair trade: everything here runs in CI as easily as it runs locally.

Run any of them with the matching npm script:

```bash
npm run tool:blueprint-validator -- path/to/plan.json
npm run tool:campaign-graph-visualizer -- path/to/campaign.json
npm run tool:noise-heatmap-generator -- --biome signal-vault
npm run tool:feat-balance-simulator -- --runs 5000
npm run tool:localization-extractor -- --check
```

They import from `src/` directly via `tsx`, so they always reflect the current contracts rather
than a stale copy.
