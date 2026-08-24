# Gaps

Questions the scaffolding deliberately does not answer. Listing them is cheaper than discovering them
mid-implementation, and an unlisted gap tends to get resolved accidentally by whoever writes the code
first.

Nothing here blocks the vertical slice in `SCOPE-LEDGER.md`.

## Design

- **Competence floor maths.** The design locks the _behaviour_ (Sancients raise it; overlap raises it;
  permanent jacks raise it permanently). It does not specify the curve, the units, or whether floors
  from different sources add, max, or multiply. `LethalityCompetence` needs a decision before it can
  be more than a stub.
- **Radicalisation rate.** "Over successive resolved operations they radicalise" — how many? Is it
  per-operation, per-arming, or per-Sancient-encounter? Does it ever decay? A Nobot group that can
  never be de-radicalised makes arming a one-shot decision; one that decays makes it a maintenance
  chore. Both are defensible; neither is chosen.
- **The five flavor tag consequences.** The design forbids labels without consequences and names the
  five tags. It does not say what the five consequences are. Until they are chosen,
  `TagConsequenceApplicator` cannot be implemented — and must not be given placeholder effects,
  because a placeholder consequence is exactly the "label without consequence" the design forbids.
- **Ownership flip rules.** Who receives a site when you die at it? The nearest influencing faction?
  Whoever damaged you last? Does an unlit site flip at all? This is the Consequence pillar's central
  mechanic and it is currently one line of prose.
- **Pyron Chrome scarcity.** "Discovery of a usable mass is a campaign-level event" — is it seeded
  into the graph at campaign start, or rolled per-site? Seeded makes it findable and plannable;
  rolled makes it a shock. The design implies shock; nothing enforces it.
- **What a run costs.** Forts consume resources from stockpiles during a run. If a run can spend more
  than it earns, the campaign can be driven into an unrecoverable state. There is no stated floor.

## Systems

- **Co-op campaign ownership.** If two players run together, do they share a graph? See `NETWORKING.md`.
- **Extraction under contest.** `HoldOrLeaveDecision` implies extraction is a choice made under
  pressure, but the pressure model (timer? escalating waves? Sancient arrival?) is unspecified.
- **Save slots.** One campaign or several? The IndexedDB store is keyed for several; nothing in the
  UI offers them.
- **Leaderboard integrity.** "Bragging rights only" is a design decision that conveniently defers the
  question of whether a client-authoritative score means anything. It will come back if leaderboards
  ever become social.

## Production

- **Art and audio direction.** Entirely absent. The scaffolding has folders, not a style.
- **Localisation beyond `en`.** The extractor tool exists; no second locale does.
- **Accessibility.** `AccessibilityOptions` exists as a surface. Colour-blind-safe faction colours,
  motion reduction for the top-down camera, and one-handed mobile input are unanswered — and the
  third one is a design constraint, not a setting.
