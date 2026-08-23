import type { SpellDef } from '../sim/types';
import { GCD_MS, MELEE_RANGE } from './formulas';

const M = MELEE_RANGE;

export const SPELLS: Record<string, SpellDef> = {
  attack: {
    id: 'attack', name: 'Attack', icon: 'AT', castMs: 0, cost: 0, resource: 'none',
    cooldownMs: 0, rangeYd: M, school: 'physical', gcd: false, effects: [],
    reqLevel: 1, classId: 'all', requiresTargetHostile: true,
    desc: 'Toggle auto-attack on your target.',
  },

  // --- Warrior -------------------------------------------------------------
  heroic_strike: {
    id: 'heroic_strike', name: 'Heroic Strike', icon: 'HS', castMs: 0, cost: 15, resource: 'rage',
    cooldownMs: 0, rangeYd: M, school: 'physical', gcd: false,
    effects: [{ kind: 'damage', school: 'physical', min: 0, max: 0, weapon: true, weaponBonus: 11 },
              { kind: 'threat', amount: 20 }],
    reqLevel: 1, classId: 'warrior', requiresTargetHostile: true,
    desc: 'A strong attack that adds damage to your next swing and generates high threat.',
  },
  rend: {
    id: 'rend', name: 'Rend', icon: 'RD', castMs: 0, cost: 10, resource: 'rage',
    cooldownMs: 0, rangeYd: M, school: 'physical', gcd: true,
    effects: [{ kind: 'aura', auraId: 'rend' }],
    reqLevel: 2, classId: 'warrior', requiresTargetHostile: true, trainCostCopper: 100,
    desc: 'Wounds the target, dealing physical damage over 9 sec.',
  },
  // Overpower only fires in the 5s window after the target dodges you — the aura is that window.
  overpower: {
    id: 'overpower', name: 'Overpower', icon: 'OP', castMs: 0, cost: 5, resource: 'rage',
    cooldownMs: 5000, rangeYd: M, school: 'physical', gcd: true,
    effects: [{ kind: 'damage', school: 'physical', min: 0, max: 0, weapon: true, weaponBonus: 35 }],
    reqLevel: 6, classId: 'warrior', requiresTargetHostile: true, trainCostCopper: 200,
    requiresAura: 'overpower_window', consumesAura: 'overpower_window',
    desc: 'Usable only after the target dodges. Cannot be blocked, dodged or parried.',
  },
  battle_shout: {
    id: 'battle_shout', name: 'Battle Shout', icon: 'BS', castMs: 0, cost: 10, resource: 'rage',
    cooldownMs: 0, rangeYd: 0, school: 'physical', gcd: true,
    effects: [{ kind: 'aura', auraId: 'battle_shout', toSelf: true }],
    reqLevel: 1, classId: 'warrior', desc: 'Increases attack power for 2 min.',
  },
  demoralizing_shout: {
    id: 'demoralizing_shout', name: 'Demoralizing Shout', icon: 'DS', castMs: 0, cost: 10, resource: 'rage',
    cooldownMs: 0, rangeYd: 10, school: 'physical', gcd: true,
    effects: [{ kind: 'aura', auraId: 'demoralizing_shout' }, { kind: 'threat', amount: 30 }],
    reqLevel: 8, classId: 'warrior', requiresTargetHostile: true, trainCostCopper: 400,
    desc: 'Reduces the attack power of nearby enemies.',
  },
  charge: {
    id: 'charge', name: 'Charge', icon: 'CG', castMs: 0, cost: 0, resource: 'rage',
    cooldownMs: 15000, rangeYd: 25, school: 'physical', gcd: false,
    effects: [{ kind: 'power', resource: 'rage', amount: 9 }, { kind: 'threat', amount: 5 }],
    reqLevel: 4, classId: 'warrior', requiresTargetHostile: true, trainCostCopper: 100,
    desc: 'Charge an enemy and generate rage. Out of combat only.',
  },

  // --- Mage ----------------------------------------------------------------
  fireball: {
    id: 'fireball', name: 'Fireball', icon: 'FB', castMs: 2000, cost: 30, resource: 'mana',
    cooldownMs: 0, rangeYd: 30, school: 'fire', gcd: true,
    effects: [{ kind: 'damage', school: 'fire', min: 14, max: 22, spCoef: 0.6 }],
    reqLevel: 1, classId: 'mage', requiresTargetHostile: true,
    desc: 'Hurls a fiery ball that causes Fire damage.',
  },
  frostbolt: {
    id: 'frostbolt', name: 'Frostbolt', icon: 'FR', castMs: 1800, cost: 25, resource: 'mana',
    cooldownMs: 0, rangeYd: 30, school: 'frost', gcd: true,
    effects: [{ kind: 'damage', school: 'frost', min: 11, max: 15, spCoef: 0.5 },
              { kind: 'aura', auraId: 'frostbolt_slow' }],
    reqLevel: 2, classId: 'mage', requiresTargetHostile: true, trainCostCopper: 100,
    desc: 'Launches a bolt of frost, slowing the target.',
  },
  fire_blast: {
    id: 'fire_blast', name: 'Fire Blast', icon: 'FZ', castMs: 0, cost: 32, resource: 'mana',
    cooldownMs: 8000, rangeYd: 20, school: 'fire', gcd: true,
    effects: [{ kind: 'damage', school: 'fire', min: 18, max: 24, spCoef: 0.43 }],
    reqLevel: 6, classId: 'mage', requiresTargetHostile: true, trainCostCopper: 200,
    desc: 'Blasts the enemy for instant Fire damage.',
  },
  frost_nova: {
    id: 'frost_nova', name: 'Frost Nova', icon: 'FN', castMs: 0, cost: 35, resource: 'mana',
    cooldownMs: 25000, rangeYd: 10, school: 'frost', gcd: true,
    effects: [{ kind: 'aura', auraId: 'frost_nova_root' }],
    reqLevel: 8, classId: 'mage', requiresTargetHostile: true, trainCostCopper: 400,
    desc: 'Roots nearby enemies in place for 8 sec.',
  },
  polymorph: {
    id: 'polymorph', name: 'Polymorph', icon: 'PM', castMs: 1500, cost: 40, resource: 'mana',
    cooldownMs: 0, rangeYd: 30, school: 'arcane', gcd: true,
    effects: [{ kind: 'aura', auraId: 'polymorph' }],
    reqLevel: 8, classId: 'mage', requiresTargetHostile: true, trainCostCopper: 500,
    desc: 'Turns the enemy into a sheep. Any damage breaks the effect.',
  },
  arcane_intellect: {
    id: 'arcane_intellect', name: 'Arcane Intellect', icon: 'AI', castMs: 1500, cost: 30, resource: 'mana',
    cooldownMs: 0, rangeYd: 0, school: 'arcane', gcd: true,
    effects: [{ kind: 'aura', auraId: 'arcane_intellect', toSelf: true }],
    reqLevel: 1, classId: 'mage', desc: 'Increases Intellect for 30 min.',
  },

  // --- Stub classes (data only) --------------------------------------------
  smite: { id: 'smite', name: 'Smite', icon: 'SM', castMs: 1500, cost: 20, resource: 'mana', cooldownMs: 0, rangeYd: 30, school: 'holy', gcd: true, effects: [{ kind: 'damage', school: 'holy', min: 13, max: 17, spCoef: 0.4 }], reqLevel: 1, classId: 'priest', requiresTargetHostile: true, desc: 'Smites an enemy for Holy damage.' },
  lesser_heal: { id: 'lesser_heal', name: 'Lesser Heal', icon: 'LH', castMs: 1500, cost: 30, resource: 'mana', cooldownMs: 0, rangeYd: 40, school: 'holy', gcd: true, effects: [{ kind: 'heal', min: 46, max: 56, spCoef: 0.4 }], reqLevel: 1, classId: 'priest', desc: 'Heals a friendly target.' },
  power_word_shield: { id: 'power_word_shield', name: 'Power Word: Shield', icon: 'PW', castMs: 0, cost: 45, resource: 'mana', cooldownMs: 4000, rangeYd: 40, school: 'holy', gcd: true, effects: [], reqLevel: 6, classId: 'priest', desc: 'Absorbs damage.' },
  sinister_strike: { id: 'sinister_strike', name: 'Sinister Strike', icon: 'SS', castMs: 0, cost: 45, resource: 'energy', cooldownMs: 0, rangeYd: M, school: 'physical', gcd: true, effects: [{ kind: 'damage', school: 'physical', min: 0, max: 0, weapon: true, weaponBonus: 3 }], reqLevel: 1, classId: 'rogue', requiresTargetHostile: true, desc: 'An instant strike that awards a combo point.' },
  eviscerate: { id: 'eviscerate', name: 'Eviscerate', icon: 'EV', castMs: 0, cost: 35, resource: 'energy', cooldownMs: 0, rangeYd: M, school: 'physical', gcd: true, effects: [{ kind: 'damage', school: 'physical', min: 10, max: 14 }], reqLevel: 1, classId: 'rogue', requiresTargetHostile: true, desc: 'Finishing move.' },
  stealth: { id: 'stealth', name: 'Stealth', icon: 'ST', castMs: 0, cost: 0, resource: 'energy', cooldownMs: 10000, rangeYd: 0, school: 'physical', gcd: false, effects: [], reqLevel: 1, classId: 'rogue', desc: 'Slip into the shadows.' },
  raptor_strike: { id: 'raptor_strike', name: 'Raptor Strike', icon: 'RS', castMs: 0, cost: 15, resource: 'mana', cooldownMs: 6000, rangeYd: M, school: 'physical', gcd: true, effects: [{ kind: 'damage', school: 'physical', min: 0, max: 0, weapon: true, weaponBonus: 5 }], reqLevel: 1, classId: 'hunter', requiresTargetHostile: true, desc: 'A strong melee attack.' },
  serpent_sting: { id: 'serpent_sting', name: 'Serpent Sting', icon: 'SP', castMs: 0, cost: 15, resource: 'mana', cooldownMs: 0, rangeYd: 35, school: 'nature', gcd: true, effects: [], reqLevel: 4, classId: 'hunter', requiresTargetHostile: true, desc: 'Nature damage over time.' },
  arcane_shot: { id: 'arcane_shot', name: 'Arcane Shot', icon: 'AS', castMs: 0, cost: 25, resource: 'mana', cooldownMs: 6000, rangeYd: 35, school: 'arcane', gcd: true, effects: [{ kind: 'damage', school: 'arcane', min: 13, max: 15 }], reqLevel: 6, classId: 'hunter', requiresTargetHostile: true, desc: 'An instant shot.' },

  // --- Mob spells ----------------------------------------------------------
  mob_cleave: {
    id: 'mob_cleave', name: 'Cleave', icon: 'CL', castMs: 0, cost: 0, resource: 'none',
    cooldownMs: 9000, rangeYd: M, school: 'physical', gcd: true,
    effects: [{ kind: 'damage', school: 'physical', min: 0, max: 0, weapon: true, weaponBonus: 4 }],
    reqLevel: 1, classId: 'mob', requiresTargetHostile: true, desc: 'A wide swing.',
  },
  mob_firebolt: {
    id: 'mob_firebolt', name: 'Fire Bolt', icon: 'FB', castMs: 2200, cost: 0, resource: 'none',
    cooldownMs: 6000, rangeYd: 25, school: 'fire', gcd: true,
    effects: [{ kind: 'damage', school: 'fire', min: 9, max: 13 }],
    reqLevel: 1, classId: 'mob', requiresTargetHostile: true, desc: 'A crude fire bolt.',
  },
};

export const GCD_DEFAULT = GCD_MS;
