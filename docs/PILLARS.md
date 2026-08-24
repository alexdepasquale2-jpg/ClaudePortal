# The Five Pillars

Every feature must serve at least one. A feature that serves none is out of scope, regardless of how
good it is in isolation. This is the filter used in PR review and in `.github/ISSUE_TEMPLATE`.

## Greed — "There's more scrap over there."

The pull outward. Every metre from the extraction zone is a bet. Greed is what makes the map feel
larger than the run.

Systems that serve it: `Backpack` weight, `Refinery` output rates, site generation placing the good
material away from the entrance, `ExtractionZone` distance.

## Dread — "Should we turn on NNN?"

The deliberate, dangerous decision. Lighting a NeetNetNode is never incidental and never free.
Dread is the pause before the switch.

Systems that serve it: `NNNActivation`, `NoiseSystem`, `ChromeShield` (which changes the maths of the
decision without removing it), `SancientDirector` arrival pressure.

## Power — "This fort is becoming ridiculous."

The escalation curve inside a single run. The fort you build is genuinely absurd by the end, and
then it is gone. That impermanence is what makes it feel like a spike rather than a plateau.

Systems that serve it: `Solidifier`, `ModuleStamp`, `FortRuntime`, `CardManager` (in-run cards, always
reset), `TowerDefenseOverlay`.

## Panic — "The Sancient made them competent."

The psychological reversal. A Goliath that has been clowning at high lethality suddenly turns,
acquires, waits, and fires. Nothing about its stat block changed except that it now knows how to use
what it always carried.

Systems that serve it: `LethalityCompetence`, `SancientJack`, `CompetenceOverride`, `BetrayalTrigger`.

## Consequence — "We lost this site, and now somebody else owns it."

The pillar the whole architecture is bent around. Every run writes to the campaign graph. Ownership
flips. Production is inherited by whoever holds the site. The next run starts on the battlefield the
last one left behind.

Systems that serve it: `OwnershipFlip`, `ProductionInheritance`, `TerritoryInfluence`,
`WarfrontCalculator`, `CampaignSave`, `RunResult`.

---

## The tie-break

When two pillars conflict, **Consequence wins.** It is the only one that cannot be recovered by a
later feature — a run that does not change the battlefield is a run the game did not happen in.
