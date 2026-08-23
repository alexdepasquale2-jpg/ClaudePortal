import type { RngState } from './rng';
import type { Stats } from '../data/formulas';

export type PowerType = 'rage' | 'mana' | 'energy' | 'none';
export type School = 'physical' | 'fire' | 'frost' | 'arcane' | 'nature' | 'shadow' | 'holy';
export type Quality = 'poor' | 'common' | 'uncommon' | 'rare' | 'epic';
export type Slot = 'head' | 'chest' | 'legs' | 'feet' | 'hands' | 'mainhand' | 'offhand' | 'ranged' | 'trinket' | 'none';

export type Vec = { x: number; z: number };

export type AttackOutcome = 'miss' | 'dodge' | 'parry' | 'block' | 'glancing' | 'crushing' | 'crit' | 'hit' | 'resist' | 'immune';

export type EffectDef =
  | { kind: 'damage'; school: School; min: number; max: number; apCoef?: number; spCoef?: number; weapon?: boolean; weaponBonus?: number }
  | { kind: 'heal'; min: number; max: number; spCoef?: number }
  | { kind: 'aura'; auraId: string; toSelf?: boolean }
  | { kind: 'threat'; amount: number }
  | { kind: 'power'; resource: PowerType; amount: number };

export type SpellDef = {
  id: string; name: string; icon: string;
  castMs: number; cost: number; resource: PowerType;
  cooldownMs: number; rangeYd: number; school: School;
  gcd: boolean; effects: EffectDef[];
  reqLevel: number; classId: string;
  trainCostCopper?: number;
  requiresAura?: string;      // e.g. Overpower needs the dodge-window proc
  consumesAura?: string;
  requiresTargetHostile?: boolean;
  channel?: boolean;
  desc: string;
};

export type StatMod = Partial<Stats> & { ap?: number; crit?: number; armor?: number; damageTakenPct?: number; speedPct?: number; spellPower?: number };

export type AuraDef = {
  id: string; name: string; icon: string;
  durationMs: number; maxStacks: number; tickMs?: number;
  school: School;
  helpful: boolean;
  mods?: StatMod;
  periodic?: { kind: 'damage' | 'heal'; min: number; max: number; spCoef?: number; school: School };
  breakOnDamage?: boolean;    // Polymorph
  incapacitate?: boolean;
  breakDamageThreshold?: number;
};

export type Aura = { defId: string; sourceId: number; stacks: number; expiresTick: number; nextTick: number; appliedTick: number };

export type ItemStats = Partial<Stats> & { ap?: number; crit?: number; armor?: number; spellPower?: number };

export type ItemDef = {
  id: string; name: string; icon: string; slot: Slot; quality: Quality; ilvl: number;
  stats?: ItemStats;
  weapon?: { min: number; max: number; speedMs: number; kind: 'sword' | 'axe' | 'mace' | 'dagger' | 'staff' | 'wand' };
  maxDurability?: number;
  vendorCopper: number;
  stack?: number;
  quest?: boolean;
  desc?: string;
  color?: number;              // vertex colour used by the render layer
  suffixPool?: string;
};

export type ItemInstance = { itemId: string; count: number; durability?: number; suffixId?: string };

export type LootEntry = { itemId: string; chance: number; min?: number; max?: number };
export type LootTable = { id: string; money: { min: number; max: number }; entries: LootEntry[] };

export type MobDef = {
  id: string; name: string; level: number; family: string;
  health: number; mana?: number; armor: number;
  dmg: { min: number; max: number }; attackSpeedMs: number;
  aggroYd?: number; leashYd?: number; social: boolean;
  lootTable?: string; xpBaseOverride?: number;
  spells?: string[];
  elite?: boolean;
  color: number; scale: number; shape: 'boar' | 'humanoid' | 'wolf' | 'spider' | 'critter';
};

export type QuestObjective =
  | { kind: 'kill'; mobId: string; count: number; text: string }
  | { kind: 'collect'; itemId: string; count: number; text: string }
  | { kind: 'talk'; npcId: string; text: string }
  | { kind: 'explore'; x: number; z: number; radius: number; text: string };

export type QuestDef = {
  id: string; name: string; level: number; giver: string; turnIn: string;
  objectives: QuestObjective[];
  rewards: { xp: number; copper: number; items?: string[]; choice?: string[] };
  prereq?: string[];
  text: string; completeText: string; progressText: string;
};

export type NpcDef = {
  id: string; name: string; title?: string; x: number; z: number;
  roles: ('vendor' | 'trainer' | 'innkeeper' | 'quest')[];
  vendorItems?: string[];
  trainerClass?: string;
  color: number;
};

export type SpawnPoint = { id: string; mobId: string; x: number; z: number; radius: number; count: number };

export type ZoneDef = {
  id: string; name: string; seed: number; size: number;
  spawns: SpawnPoint[]; npcs: NpcDef[];
  roads: Vec[][]; pois: { name: string; x: number; z: number; kind: string }[];
};

export type QuestState = { id: string; progress: number[]; complete: boolean; turnedIn: boolean };

export type Unit = {
  id: number; kind: 'player' | 'mob' | 'npc'; defId: string; name: string;
  level: number; classId: string;
  pos: Vec; facing: number; velocity: Vec;
  spawn: Vec; spawnPointId?: string;
  health: number; maxHealth: number;
  power: number; maxPower: number; powerType: PowerType;
  base: Stats; gearStats: ItemStats;
  auras: Aura[];
  targetId: number | null;
  inCombat: boolean; dead: boolean; evading: boolean;
  deadUntilTick: number;
  swingReadyTick: number; gcdUntilTick: number;
  casting: { spellId: string; targetId: number | null; endTick: number } | null;
  cooldowns: Record<string, number>;
  threat: Map<number, number>;
  moveTo: Vec | null;
  attacking: boolean;
  aiCooldown: number;
  queuedBonus: number;
  npcDefId?: string;
};

export type Bag = (ItemInstance | null)[];

export type PlayerState = {
  unitId: number;
  xp: number; restedXp: number;
  copper: number;
  bags: Bag;
  equipped: Partial<Record<Slot, ItemInstance>>;
  knownSpells: string[];
  actionBar: (string | null)[];
  quests: QuestState[];
  completedQuests: string[];
  talents: Record<string, number>;
  talentPoints: number;
  resting: boolean;
};

export type Corpse = {
  unitId: number; x: number; z: number; mobId: string;
  loot: ItemInstance[]; copper: number; looted: boolean; expiresTick: number;
};

export type LogLine = { tick: number; text: string; kind: string };

export type FloatText = { x: number; z: number; text: string; kind: string; unitId: number };

export type World = {
  tick: number;
  rng: RngState;
  units: Map<number, Unit>;
  nextId: number;
  player: PlayerState;
  corpses: Corpse[];
  log: LogLine[];
  floats: FloatText[];
  zoneId: string;
  spawnTimers: Record<string, number>;
  events: string[];
  lastRegenTick: number;
  paused: boolean;
};

export type { Stats } from '../data/formulas';
