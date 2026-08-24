# Scope Ledger

What this scaffolding contains, what it deliberately does not, and what comes next.

## Status

**Scaffolding and contracts only.** No gameplay logic is implemented. Every module has an intentional
public surface and a `// TODO: implement per DESIGN.md` body. The suite is green because unimplemented
contracts are `it.todo()`, not because they pass.

Three things are implemented for real, because everything else depends on them being trustworthy:

- `SeededRandom` — determinism is a prerequisite, not a feature
- `EventBus` — the seam every system talks through
- `CampaignSaveSerializer` round-trip — the Consequence pillar is the save format

## Deliberately dropped from the original spec

The design was first written as a Unity project. These items had no meaning on the web and were
dropped rather than faked:

| Dropped                                                                | Why                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `build-windows.yml`, `build-linux.yml`, `build-macos.yml`              | One web bundle, one `build.yml`. Per-OS builds would be three identical jobs.                    |
| `.asmdef` files                                                        | Replaced by `eslint-plugin-boundaries` rules, which enforce the same graph and actually fail CI. |
| `ProjectSettings/`, `Packages/manifest.json`, `AddressableAssetsData/` | Unity project plumbing with no equivalent.                                                       |
| `Plugins/`, `StreamingAssets/`                                         | Vite's `public/` covers the one real use.                                                        |
| `.meta` files                                                          | A Unity GUID-tracking mechanism.                                                                 |

Everything else in the spec's file list has a counterpart. The `.cs` → `.ts` mapping is one-to-one;
`.asset` files became typed JSON per `DATA-CONTRACTS.md`; `.unity` scenes became `Scene` modules.

## Deferred, not dropped

- **GitHub Pages deploy.** `build.yml` already produces the bundle; publishing it is one job. Held
  back on request — `npm run dev --host` is enough to reach a phone on the same network.
- **Third-person and first-person views.** The camera rigs exist and switch. They are not tuned, and
  the design says parity arrives late via meta unlocks anyway.
- **Networked host authority.** The `BuildAuthority` seam is in place; only the local implementation
  exists. See `NETWORKING.md`.
- **Art, audio, localisation beyond `en`.** Folders and loaders exist; content does not.

## Running the browser tests

`npm run test:e2e` uses Playwright's own Chromium. In a sandbox or CI image that ships a
different Chromium build, point Playwright at it instead of failing:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:e2e
```

Unset, Playwright resolves its browser as normal.

## Next Vertical Slice

The smallest playable loop that demonstrates **every run changes the battlefield for the next run**.
Nothing in it is optional; anything not in it is out of scope for the slice.

**One site. Top-down view only. One Goliath. One decision.**

1. **World Menu** lists three sites from a seeded `ArchipelagoGraph`. Each shows its owner. Launch
   into one — `SceneRouter` loads `OperationScene` and nothing else.
2. **The hole.** `NeetmonController` walks. `AutoFireSystem` fires at what it can see. One Goliath
   patrols with a full catalog and near-zero competence — visibly, comically bad at using it. Scrap
   on the floor goes into the `Backpack`.
3. **The decision.** A `NeetNetNode` can be planted and lit. Lighting it starts production and starts
   `NoiseSystem` accumulating. This is the whole Dread pillar in one keypress.
4. **The reversal.** Loudness crosses a threshold; `SancientDirector` sends one Sancient. It jacks the
   Goliath. `CompetenceOverride` raises the floor and the Goliath turns, acquires, waits, and fires.
   The player's read of the situation is now wrong in a way they can feel.
5. **The out.** `ExtractionZone` is live. Extract with the scrap, or die holding the node.
6. **The consequence.** Either end writes a `RunResult`. `OwnershipFlip` applies it to the graph and
   `CampaignSaveSerializer` writes IndexedDB. Return to the World Menu: **the site's owner has
   changed, and it stays changed after a page reload.**

Step 6 is the deliverable. Steps 1–5 exist to make it mean something.

### What the slice deliberately excludes

Building and forts, blueprints, Nobots and radicalisation, pipelines and logistics, the tech tree and
feats, in-run cards, third/first-person views, Pyron Chrome, multiple regions.

Every one of those is a Power or Greed feature. The slice is proving Consequence, and Consequence is
the pillar that wins ties.

### Definition of done

Close the tab. Reopen it. The World Menu still shows a site you lost. That is the game.
