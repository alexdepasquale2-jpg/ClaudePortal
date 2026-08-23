// Every gameplay constant lives here. Logic files import; they never hardcode.
// Comments cite the Classic intent, not the code.

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

/** Classic global cooldown: 1.5s for everything except a handful of rogue/feral abilities. */
export const GCD_MS = 1500;

/** Yards. Melee "5 yard rule" is really ~5 combat-reach yards from edge to edge. */
export const MELEE_RANGE = 5;

/** Base stats before class/race modifiers. Classic level-1 characters sit near these. */
export const BASE_STATS = { str: 20, agi: 20, sta: 20, int: 20, spi: 20 };

/** Health/mana the body has before Stamina/Intellect are counted. */
export const BASE_HEALTH = 40;
export const BASE_MANA = 60;

/** First 20 points of Sta/Int give 1 hp/mp each; beyond that 10 hp / 15 mp per point. */
export const STA_FREE_POINTS = 20;
export const HEALTH_PER_STA = 10;
export const INT_FREE_POINTS = 20;
export const MANA_PER_INT = 15;

/** Melee attack power: 2 AP per Strength for plate classes; AP contributes dmg at AP/14 per weapon second. */
export const AP_PER_STR = 2;
export const AP_PER_LEVEL_WARRIOR = 3;
export const AP_TO_DPS = 14;

/** Spell power scaling for the stub caster kit: Int gives a little, gear gives the rest. */
export const SPELLPOWER_PER_INT = 0.2;

/** Crit from Agility. Classic used a per-class table; 20 Agi per 1% is the warrior-ish middle. */
export const AGI_PER_CRIT_PCT = 20;
export const BASE_CRIT_PCT = 0.75;
/** Casters crit off Intellect, ~59 Int per 1% at 60. Scaled down for a 1-10 game. */
export const INT_PER_SPELL_CRIT_PCT = 29.5;
export const BASE_SPELL_CRIT_PCT = 0.9;

/** Dodge from Agility, same shape as crit. Everyone has a small base dodge. */
export const AGI_PER_DODGE_PCT = 20;
export const BASE_DODGE_PCT = 0.75;
export const BASE_PARRY_PCT = 5;
export const BASE_BLOCK_PCT = 5;

/** Physical mitigation. DR = A / (A + 85*attackerLevel + 400), hard-capped at 75%. */
export const ARMOR_K1 = 85;
export const ARMOR_K2 = 400;
export const ARMOR_DR_CAP = 0.75;
export const ARMOR_PER_AGI = 2;

/** Melee crits multiply by 2.0 (not 1.5 — that's spells). */
export const MELEE_CRIT_MULT = 2.0;
export const SPELL_CRIT_MULT = 1.5;

/** Base miss vs an equal-level target is 5%; each level of the defender above you adds ~0.5%,
 *  and above +3 levels the penalty steepens sharply (the classic "level cap" wall). */
export const BASE_MISS_PCT = 5;
export const MISS_PER_LEVEL = 0.5;
export const MISS_PER_LEVEL_ABOVE_3 = 2;

/** Glancing blows only occur against mobs 3+ levels above you, and they are ~40% of hits. */
export const GLANCING_MIN_LEVEL_DELTA = 3;
export const GLANCING_CHANCE_PCT = 40;
export const GLANCING_DAMAGE = { lo: 0.65, hi: 0.85 };

/** Crushing blows: mobs 4+ levels above the player hit for 150%. */
export const CRUSHING_MIN_LEVEL_DELTA = 4;
export const CRUSHING_CHANCE_PCT = 15;
export const CRUSHING_MULT = 1.5;

/** Spells use a binary hit table: 4% base miss vs equal level, +11% at +3 levels. */
export const SPELL_BASE_MISS_PCT = 4;
export const SPELL_MISS_PER_LEVEL = 1;
export const SPELL_MISS_PER_LEVEL_ABOVE_2 = 11;

/** Rage: damage taken and damage dealt both generate. Classic's conversion value at low level.
 *  rage = damage / conversion * 7.5, dealt-damage side uses a fraction of that. */
export const RAGE_CONVERSION_BASE = 8.5;
export const RAGE_CONVERSION_PER_LEVEL = 1.6;
export const RAGE_FROM_TAKEN_MULT = 2.5;
export const RAGE_FROM_DEALT_MULT = 1.0;
export const MAX_RAGE = 100;
/** Out of combat, rage decays 3 per second. */
export const RAGE_DECAY_PER_SEC = 3;

/** Mana/health regen ticks every 2s. Out of combat only ("five second rule" simplified). */
export const REGEN_TICK_MS = 2000;
export const MANA_REGEN_PER_SPI = 0.25;
export const HEALTH_REGEN_PER_SPI = 0.3;
export const COMBAT_REGEN = false;

/** Threat: damage is 1:1 threat, healing is 0.5, taunt sets you to top. */
export const THREAT_PER_DAMAGE = 1;
export const THREAT_PER_HEAL = 0.5;
/** A melee attacker must exceed the current target's threat by 10% to pull aggro (30% at range). */
export const THREAT_PULL_MELEE = 1.1;
export const THREAT_PULL_RANGED = 1.3;

/** Aggro radius shrinks/grows ~1 yard per level of difference, floored at 5. */
export const BASE_AGGRO_YD = 12;
export const AGGRO_PER_LEVEL = 1;
export const MIN_AGGRO_YD = 5;
export const SOCIAL_AGGRO_YD = 10;

/** Mobs leash and full-heal when dragged too far from spawn. */
export const LEASH_YD = 40;
export const EVADE_HEAL_PER_SEC = 0.35;

export const MOVE_SPEED = 7;      // yards/sec, Classic run speed
export const MOB_MOVE_SPEED = 6.5;
export const RESPAWN_MS = 25000;

/** Classic's level 1-10 experience table, verbatim — the curve is data, not a fitted polynomial. */
export const XP_TABLE = [400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500];

export function xpToLevel(level: number): number {
  return XP_TABLE[level - 1] ?? XP_TABLE[XP_TABLE.length - 1];
}

/** Mob XP: (5 * mobLevel + 45) at low level, modified by level delta. */
export function mobBaseXp(mobLevel: number): number { return 5 * mobLevel + 45; }

/** Grey mobs give nothing; the grey line is level - (5 + floor(level/10)) below level 40. */
export function greyLevel(playerLevel: number): number {
  return playerLevel - (5 + Math.floor(playerLevel / 10));
}

/** Above your level: +5% per level. Below: linear falloff to zero at grey. */
export function xpLevelMod(playerLevel: number, mobLevel: number): number {
  if (mobLevel > playerLevel) return 1 + 0.05 * (mobLevel - playerLevel);
  const grey = greyLevel(playerLevel);
  if (mobLevel <= grey) return 0;
  return 1 - (playerLevel - mobLevel) / (playerLevel - grey);
}

/** Rested XP doubles quest/kill XP until the pool drains; pool fills 5% of a level per 8h in an inn. */
export const RESTED_MULT = 2;
export const RESTED_PER_HOUR_INN = 0.05 / 8;
export const RESTED_CAP_LEVELS = 1.5;
/** Game time runs 30x real time: a full day/night cycle takes 48 real minutes. */
export const TIME_SCALE = 30;
export const DAY_LENGTH_MS = 24 * 3600_000 / TIME_SCALE;

export const VENDOR_SELL_RATIO = 0.25; // vendors buy at a quarter of the listed price
export const DURABILITY_LOSS_ON_DEATH = 0.1;
export const REPAIR_COPPER_PER_POINT = 3;

export const LOOT_RANGE_YD = 6;
export const INTERACT_RANGE_YD = 8;

// --- derived stat helpers ---------------------------------------------------

export type Stats = { str: number; agi: number; sta: number; int: number; spi: number };

export const maxHealthFrom = (sta: number, level: number, perLevel: number) =>
  Math.floor(BASE_HEALTH + perLevel * (level - 1) +
    Math.min(sta, STA_FREE_POINTS) + Math.max(0, sta - STA_FREE_POINTS) * HEALTH_PER_STA);

export const maxManaFrom = (int: number, level: number, perLevel: number) =>
  Math.floor(BASE_MANA + perLevel * (level - 1) +
    Math.min(int, INT_FREE_POINTS) + Math.max(0, int - INT_FREE_POINTS) * MANA_PER_INT);

export const attackPowerFrom = (str: number, level: number, perLevel: number) =>
  Math.floor(str * AP_PER_STR + level * perLevel);

export const critFrom = (agi: number) => BASE_CRIT_PCT + agi / AGI_PER_CRIT_PCT;
export const spellCritFrom = (int: number) => BASE_SPELL_CRIT_PCT + int / INT_PER_SPELL_CRIT_PCT;
export const dodgeFrom = (agi: number) => BASE_DODGE_PCT + agi / AGI_PER_DODGE_PCT;
export const armorFrom = (agi: number, gear: number) => gear + agi * ARMOR_PER_AGI;

export const armorDR = (armor: number, attackerLevel: number) =>
  Math.min(ARMOR_DR_CAP, armor / (armor + ARMOR_K1 * attackerLevel + ARMOR_K2));

export const rageConversion = (level: number) => RAGE_CONVERSION_BASE + RAGE_CONVERSION_PER_LEVEL * level;
export const rageFromDamageTaken = (dmg: number, level: number) =>
  (dmg / rageConversion(level)) * RAGE_FROM_TAKEN_MULT;
export const rageFromDamageDealt = (dmg: number, level: number) =>
  (dmg / rageConversion(level)) * RAGE_FROM_DEALT_MULT;

export const aggroRadius = (mobLevel: number, playerLevel: number) =>
  Math.max(MIN_AGGRO_YD, BASE_AGGRO_YD - (playerLevel - mobLevel) * AGGRO_PER_LEVEL);
