# Save Format

## Where it lives

IndexedDB, database `skyneet`, object store `campaign`, keyed by save slot id. Local-only: no server,
no account, works offline, survives a browser restart. `CampaignSaveSerializer` also produces a plain
JSON document for export/import, which is the same shape written to IndexedDB.

localStorage is deliberately not used: the archipelago graph plus per-site history will exceed its
~5MB cap, and its synchronous API stalls the frame.

## What is saved

- `version` — schema version, integer, bumped on any breaking shape change
- `campaignSeed` — the root seed; every site derives from it
- `graph` — sites, their edges, per-site `SiteState` and `Ownership`
- `stockpiles` — per-site material counts by `MaterialTier`
- `pipelines` — the logistics network
- `factions` — attitudes and per-group Nobot radicalisation values
- `meta` — feats earned per track, tech tree nodes unlocked
- `history` — resolved `RunResult` records: end type, site, duration, what flipped
- `blueprints` — player-authored plans (these are _plans_, not built structures)

## What is never saved

**Fort geometry.** Not the pieces, not the modules, not their transforms, not their health. A fort
exists only inside a play session and dies with the run. This is ADR-0002 and it is the reason the
campaign layer is worth having at all.

What survives a fort is only its _consequences_: the ownership it defended or lost, the materials it
consumed, the production it enabled, the noise it made.

Also never saved: in-run card selections (cards always reset — see `CardResetService`), live enemy
state, live noise field, the run clock.

### How this is enforced

`CampaignSave` has no field capable of holding geometry, and `tests/unit/CampaignSaveRoundTrip.test.ts`
asserts the round trip preserves everything it does hold. If someone adds a `fortLayout` field, the
review checklist in `.github/PULL_REQUEST_TEMPLATE.md` catches it and ADR-0002 says no.

## Blueprints are the exception that proves the rule

Blueprints persist. A blueprint is not a fort — it is an intention, authored in the sandbox between
runs, loaded into a run as ghosts. It carries no state from any previous run: no damage, no partial
construction, no resources already spent. Loading a blueprint costs full price every time.

## Versioning and migration

`version` is checked on load. Migrations are pure functions `(older) => newer`, registered in order in
`CampaignSaveSerializer`, applied in sequence. A save from an unknown _future_ version is refused
rather than guessed at — the player is offered export instead, so the file is never silently mangled.

There is no auto-repair. A save that fails schema validation reports which field failed.

## Save timing

The campaign save is written when a run _resolves_ — extract, death, or abandon — not continuously
during a run. A run in progress is not a campaign state. Closing the tab mid-run loses the run, which
is correct: the run is the thing you can lose.
