import type { AuraDef } from '../sim/types';

export const AURAS: Record<string, AuraDef> = {
  overpower_window: {
    id: 'overpower_window', name: 'Overpower Ready', icon: 'OP', durationMs: 5000, maxStacks: 1,
    school: 'physical', helpful: true,
  },
  battle_shout: {
    id: 'battle_shout', name: 'Battle Shout', icon: 'BS', durationMs: 120000, maxStacks: 1,
    school: 'physical', helpful: true, mods: { ap: 20 },
  },
  rend: {
    id: 'rend', name: 'Rend', icon: 'RD', durationMs: 9000, maxStacks: 1, tickMs: 3000,
    school: 'physical', helpful: false,
    periodic: { kind: 'damage', min: 4, max: 4, school: 'physical' },
  },
  // Polymorph: incapacitates and regenerates, breaks on any damage. The classic quirk is that
  // the sheep heals fast while CC'd, so breaking it early loses your damage.
  polymorph: {
    id: 'polymorph', name: 'Polymorph', icon: 'PM', durationMs: 20000, maxStacks: 1, tickMs: 1000,
    school: 'arcane', helpful: false, incapacitate: true, breakOnDamage: true, breakDamageThreshold: 1,
    periodic: { kind: 'heal', min: 5, max: 5, school: 'arcane' },
  },
  frost_nova_root: {
    id: 'frost_nova_root', name: 'Frost Nova', icon: 'FN', durationMs: 8000, maxStacks: 1,
    school: 'frost', helpful: false, mods: { speedPct: -100 }, breakOnDamage: false,
  },
  frostbolt_slow: {
    id: 'frostbolt_slow', name: 'Chilled', icon: 'CH', durationMs: 6000, maxStacks: 1,
    school: 'frost', helpful: false, mods: { speedPct: -40 },
  },
  arcane_intellect: {
    id: 'arcane_intellect', name: 'Arcane Intellect', icon: 'AI', durationMs: 1800000, maxStacks: 1,
    school: 'arcane', helpful: true, mods: { int: 6 },
  },
  well_fed: {
    id: 'well_fed', name: 'Well Fed', icon: 'WF', durationMs: 600000, maxStacks: 1,
    school: 'physical', helpful: true, mods: { sta: 4, spi: 4 },
  },
  demoralizing_shout: {
    id: 'demoralizing_shout', name: 'Demoralizing Shout', icon: 'DS', durationMs: 30000, maxStacks: 1,
    school: 'physical', helpful: false, mods: { ap: -30 },
  },
};
