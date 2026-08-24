# Data Contracts

Unity ScriptableObjects become typed JSON plus a zod schema. Every data file is validated at load;
bad data fails loudly with the offending field named, rather than producing a subtly wrong game.

Definitions live in `src/core/data/<domain>/`. Each domain has:

- `*.ts` — the TypeScript interface and its zod schema
- `*.json` — the data itself
- a loader that parses the JSON through the schema and returns the typed value

## The contracts

| Data file                                 | Schema                    | What it drives                                                                                |
| ----------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| `biomes/biome-database.json`              | `BiomeDefinition`         | `BiomeSampler`, site generation, material distribution                                        |
| `cards/card-pool.json`                    | `InRunCard`               | `CardManager` draws. In-run only — always reset.                                              |
| `factions/goliath-catalog.json`           | `GoliathCatalogEntry`     | What a Goliath _carries_. Never what it is good at — that is competence, computed at runtime. |
| `factions/sancient-power-tiers.json`      | `SancientPowerTier`       | How many nodes/groups a Sancient can jack at once, and for how long                           |
| `factions/nobot-group-template.json`      | `NobotGroupTemplate`      | Starting attitude and radicalisation curve per group archetype                                |
| `materials/materials.json`                | `MaterialDefinition`      | The four tiers: Scrap, Rack, Plate, PyronChrome                                               |
| `tech/tech-tree.json`                     | `TechNode`                | The one permanent tree. Camera presets are the late nodes.                                    |
| `tech/feat-tracks.json`                   | `FeatDefinition`          | Feats, split by `RunEndType` — different tracks per end type                                  |
| `tech/camera-presets.json`                | `CameraPreset`            | Per-view rigs; unlocked late, which is how views reach parity                                 |
| `flavor/verb-to-tag-mapping.json`         | `VerbToTagRule`           | Which tracked verbs produce which `FlavorTag`                                                 |
| `campaign/influence-volume-settings.json` | `InfluenceVolumeSettings` | Radius and falloff of territory influence; the Warfront emerges from these                    |
| `settings/game-settings.json`             | `GameSettings`            | Defaults, including per-device view default                                                   |
| `settings/quality-tiers.json`             | `QualityTier`             | Render budgets — mobile is a real tier, not a downscale                                       |
| `localization/en.json`                    | `StringTable`             | UI strings                                                                                    |

## Two contracts that carry design rules in their shape

### `GoliathCatalogEntry` has no skill field

A catalog entry describes armament and lethality. It cannot describe competence, because competence
is not a property of the machine — it is a property of whether something is currently telling the
machine how to aim. `LethalityCompetence` computes it from the local competence floor at runtime.

This is ADR-0003 expressed as a type. If a catalog entry could say "accuracy: 0.9", someone would
eventually author a permanently competent Goliath and the Panic pillar would quietly die.

### `VerbToTagRule` maps to a closed union

`FlavorTag` is `'Militant' | 'Logistics' | 'Diplomatic' | 'Subversive' | 'Expedition'` — five, closed.
`TagConsequenceApplicator` switches over it exhaustively, so adding a sixth tag without giving it a
mechanical consequence is a **typecheck failure**, not a review note.

The design says labels without consequences are forbidden. The compiler agrees.

## Adding a data file

1. Write the interface and zod schema in `src/core/data/<domain>/`.
2. Write the JSON.
3. Register it in the domain loader.
4. Add a row to the table above.

Data that no schema validates is not data, it is a future bug.
