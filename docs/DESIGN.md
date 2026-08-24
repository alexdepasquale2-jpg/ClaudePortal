# SkyNeet Survivors — Design

This document is the single source of truth. Sections 1–3 are the locked concept text.
Nothing in the codebase may contradict it. Where the code deviates from the original
Unity-oriented scaffolding spec, the deviation is recorded in `ARCHITECTURE.md` and
`SCOPE-LEDGER.md` — never silently.

---

## 1. Core Concept (the only thing that must never be cut)

**Every run changes the battlefield for the next run.**

You are Neetmon Gould — one body, on foot, underground.
The machines that inherited the surface still carry full Goliath catalogs but have forgotten how to
use them. Underground, machine signal is dead until you plant a NeetNetNode (NNN). Lighting an NNN
is always a deliberate, dangerous decision. Building is loud. Loudness brings the Sancients.
Sancients temporarily restore full competence to nearby Goliaths. When you die or extract, ownership
of the site and its production can flip. The fort you built this run dies with the run; the campaign
graph remembers.

There is no win state. The game simply progresses. The permanent record is the shape of the campaign
graph the player has created through repeated failure and opportunistic success.

### The Five Pillars (every feature must serve at least one)

- **Greed** — "There's more scrap over there."
- **Dread** — "Should we turn on NNN?"
- **Power** — "This fort is becoming ridiculous."
- **Panic** — "The Sancient made them competent."
- **Consequence** — "We lost this site, and now somebody else owns it."

---

## 2. Locked Design Decisions

### Pyron Chrome

Powerful magnetic plasma metal alloy. Its only mechanical purpose is to protect a primary NNN
(reduces noise signature and extends safe hold time). You find it; you never forge it. Discovery of a
usable mass is a campaign-level event.

### Warfront

Purely emergent from overlapping territory influence of lit/owned sites. No separate mode. Competence
floors rise inside overlapping volumes. Visualised on the World/Region menus as influence bleed.

### Nobots

Extremely important. Player can arm them with scavenged neutrino tech. While newly armed they act as
temporary allies/distractors. Over successive resolved operations they radicalise. Eventually they
betray and want their own protected nodes. Sancients accelerate betrayal. "They want your node"
belongs primarily to Sancients and to post-betrayal Nobots.

### Sancients

Rare. Personally weak. Fully aware of the catalog. Their power determines how many nodes or groups
they can jack simultaneously and for how long. Long-duration multi-jacks are possible. Permanent
jacks raise the local competence floor permanently. The signature moment is the psychological
reversal: a clownish high-lethality Goliath suddenly turns, acquires, waits, and fires.

### Forts & Building

Forts exist **only inside play sessions** and consume resources while the player is in the hole.
Ownership and stockpiles persist; the physical fort does not. Blueprints can be planned between runs
and loaded as ghosts. Solidifying generates noise. Host-only place/solidify/scrap.

### Campaign Presentation

Vampire Survivors-style menu layer with region and territory information. Never load the entire
archipelago as one physics scene. One operation = one scene.

### Views

One pawn, three live-switchable views:

- **Top-down** (default, steep) — auto-fire Survivors spine
- **Third-person** — hybrid
- **First-person** — manual

Camera and building are coupled. Views reach parity late via meta unlocks.

### Flavor Tags

HUD reads player verbs and applies exactly one locked mechanical consequence per tag (Militant,
Logistics, Diplomatic, Subversive, Expedition). Labels without consequences are forbidden.

### Progression

- Feats on different tracks per end type
- One permanent tech tree (head-starts, curves, formations, perks, finally camera presets)
- In-run VS-style cards always reset
- Leaderboards are bragging rights only
- The graph is the keep

### Neets

Circumstantially underground. No deep ancient-exile mythology required.

---

## 3. Required Menus (campaign layer)

- **World Menu** (top-level map + status)
- **Region Menu**
- **Faction Menu** (Goliaths / Sancients / Nobots with radicalisation meters)
- **Resources Menu**
- **Logistics Menu** (pipelines)
- **Forts Menu** (read-only history + blueprint load only)
- **Technology Menu**
- **Blueprints Menu** (sandbox planning)
- **Settings**

Forts and Tower Defense builds are live/session-only.

---

## 4. How the code enforces this

The rules above are not left to discipline. Three of them are structural:

| Design rule                                | Enforcement                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Forts are session-only                     | `ui` cannot import `gameplay`; `FortsMenuController` cannot reach `FortRuntime`. Lint fails on violation.                            |
| The campaign graph is the permanent record | `CampaignSave` has no field capable of holding fort geometry; the round-trip test asserts it.                                        |
| Labels without consequences are forbidden  | `FlavorTag` is a closed union, and `TagConsequenceApplicator` is total over it — adding a tag without a consequence fails typecheck. |

See `ARCHITECTURE.md` for the full layer graph.
