import type { PowerType } from '../sim/types';
import type { Stats, Stats as S } from './formulas';

export type ClassDef = {
  id: string; name: string; resource: PowerType;
  stats: S; statsPerLevel: S;
  healthPerLevel: number; manaPerLevel: number;
  apPerLevel: number;
  armorGear: number;
  startSpells: string[]; startItems: string[];
  color: number;
  playable: boolean;
  trees?: string[];
};

// Classic level-1 stat spreads, condensed. Warrior stacks Str/Sta, Mage Int/Spi.
export const CLASSES: Record<string, ClassDef> = {
  warrior: {
    id: 'warrior', name: 'Warrior', resource: 'rage',
    stats: { str: 23, agi: 20, sta: 23, int: 17, spi: 18 },
    statsPerLevel: { str: 1.4, agi: 0.9, sta: 1.4, int: 0.4, spi: 0.6 },
    healthPerLevel: 20, manaPerLevel: 0, apPerLevel: 3, armorGear: 20,
    startSpells: ['heroic_strike', 'attack'], startItems: ['rusty_sword', 'recruits_vest'],
    color: 0xc79c6e, playable: true, trees: ['Arms', 'Fury', 'Protection'],
  },
  mage: {
    id: 'mage', name: 'Mage', resource: 'mana',
    stats: { str: 17, agi: 18, sta: 18, int: 25, spi: 22 },
    statsPerLevel: { str: 0.4, agi: 0.6, sta: 0.8, int: 1.6, spi: 1.4 },
    healthPerLevel: 10, manaPerLevel: 22, apPerLevel: 1, armorGear: 5,
    startSpells: ['fireball', 'attack'], startItems: ['gnarled_staff', 'apprentice_robe'],
    color: 0x69ccf0, playable: true, trees: ['Arcane', 'Fire', 'Frost'],
  },
  // Stubs: data only, no dedicated code paths.
  priest: {
    id: 'priest', name: 'Priest', resource: 'mana',
    stats: { str: 17, agi: 18, sta: 19, int: 24, spi: 24 },
    statsPerLevel: { str: 0.4, agi: 0.5, sta: 0.9, int: 1.5, spi: 1.6 },
    healthPerLevel: 10, manaPerLevel: 22, apPerLevel: 1, armorGear: 5,
    startSpells: ['smite', 'lesser_heal', 'power_word_shield'], startItems: [], color: 0xffffff, playable: false,
  },
  rogue: {
    id: 'rogue', name: 'Rogue', resource: 'energy',
    stats: { str: 21, agi: 25, sta: 20, int: 17, spi: 18 },
    statsPerLevel: { str: 1.0, agi: 1.6, sta: 1.0, int: 0.4, spi: 0.6 },
    healthPerLevel: 15, manaPerLevel: 0, apPerLevel: 2, armorGear: 12,
    startSpells: ['sinister_strike', 'eviscerate', 'stealth'], startItems: [], color: 0xfff569, playable: false,
  },
  hunter: {
    id: 'hunter', name: 'Hunter', resource: 'mana',
    stats: { str: 20, agi: 24, sta: 20, int: 19, spi: 19 },
    statsPerLevel: { str: 0.9, agi: 1.5, sta: 1.0, int: 0.8, spi: 0.8 },
    healthPerLevel: 14, manaPerLevel: 16, apPerLevel: 2, armorGear: 12,
    startSpells: ['raptor_strike', 'serpent_sting', 'arcane_shot'], startItems: [], color: 0xabd473, playable: false,
  },
};

export const statsAtLevel = (c: ClassDef, level: number): Stats => ({
  str: Math.floor(c.stats.str + c.statsPerLevel.str * (level - 1)),
  agi: Math.floor(c.stats.agi + c.statsPerLevel.agi * (level - 1)),
  sta: Math.floor(c.stats.sta + c.statsPerLevel.sta * (level - 1)),
  int: Math.floor(c.stats.int + c.statsPerLevel.int * (level - 1)),
  spi: Math.floor(c.stats.spi + c.statsPerLevel.spi * (level - 1)),
});
