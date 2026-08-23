import type { ItemDef, Quality } from '../sim/types';

export const QUALITY_COLOR: Record<Quality, string> = {
  poor: '#9d9d9d', common: '#ffffff', uncommon: '#1eff00', rare: '#0070dd', epic: '#a335ee',
};

/** Random suffixes ("of the Bear") roll a stat budget onto uncommon+ drops. */
export const SUFFIXES: Record<string, { id: string; name: string; stats: Record<string, number> }> = {
  bear: { id: 'bear', name: 'of the Bear', stats: { str: 3, sta: 3 } },
  eagle: { id: 'eagle', name: 'of the Eagle', stats: { int: 3, sta: 3 } },
  monkey: { id: 'monkey', name: 'of the Monkey', stats: { agi: 3, sta: 3 } },
  wolf: { id: 'wolf', name: 'of the Wolf', stats: { agi: 4, spi: 2 } },
  whale: { id: 'whale', name: 'of the Whale', stats: { sta: 5 } },
};
export const SUFFIX_POOLS: Record<string, string[]> = {
  melee: ['bear', 'monkey', 'wolf', 'whale'],
  caster: ['eagle', 'whale', 'wolf'],
};

export const ITEMS: Record<string, ItemDef> = {
  rusty_sword: { id: 'rusty_sword', name: 'Rusty Shortsword', icon: 'SW', slot: 'mainhand', quality: 'poor', ilvl: 1,
    weapon: { min: 2, max: 4, speedMs: 2000, kind: 'sword' }, maxDurability: 25, vendorCopper: 12, color: 0x8a7a5c,
    desc: 'It has seen better decades.' },
  gnarled_staff: { id: 'gnarled_staff', name: 'Gnarled Staff', icon: 'ST', slot: 'mainhand', quality: 'common', ilvl: 2,
    weapon: { min: 4, max: 8, speedMs: 2900, kind: 'staff' }, stats: { int: 1 }, maxDurability: 30, vendorCopper: 20, color: 0x6b4f2a,
    desc: 'Warm to the touch.' },
  recruits_vest: { id: 'recruits_vest', name: "Recruit's Vest", icon: 'CH', slot: 'chest', quality: 'common', ilvl: 1,
    stats: { armor: 16 }, maxDurability: 30, vendorCopper: 15, color: 0x7a5c3a },
  apprentice_robe: { id: 'apprentice_robe', name: "Apprentice's Robe", icon: 'RB', slot: 'chest', quality: 'common', ilvl: 1,
    stats: { armor: 6, int: 1 }, maxDurability: 30, vendorCopper: 15, color: 0x2f4f7a },
  worn_boots: { id: 'worn_boots', name: 'Worn Boots', icon: 'BT', slot: 'feet', quality: 'common', ilvl: 2,
    stats: { armor: 8 }, maxDurability: 25, vendorCopper: 18, color: 0x6b5b45 },
  tough_leather_gloves: { id: 'tough_leather_gloves', name: 'Tough Leather Gloves', icon: 'GL', slot: 'hands', quality: 'common', ilvl: 5,
    stats: { armor: 12, str: 1 }, maxDurability: 25, vendorCopper: 40, color: 0x7d6146 },

  // The green sword — the visible payoff of the vertical slice.
  verdant_edge: { id: 'verdant_edge', name: 'Verdant Edge', icon: 'VE', slot: 'mainhand', quality: 'uncommon', ilvl: 8,
    weapon: { min: 7, max: 13, speedMs: 2200, kind: 'sword' }, stats: { str: 3, crit: 1 },
    maxDurability: 45, vendorCopper: 850, color: 0x3ddc6a, suffixPool: 'melee',
    desc: 'The blade hums faintly green.' },
  emberwood_wand: { id: 'emberwood_wand', name: 'Emberwood Wand', icon: 'WD', slot: 'mainhand', quality: 'uncommon', ilvl: 8,
    weapon: { min: 5, max: 9, speedMs: 1900, kind: 'wand' }, stats: { int: 4, spellPower: 4 },
    maxDurability: 40, vendorCopper: 820, color: 0xff7a3d, suffixPool: 'caster',
    desc: 'Smells faintly of ash.' },
  boar_hide_belt: { id: 'boar_hide_belt', name: 'Boar Hide Belt', icon: 'BL', slot: 'legs', quality: 'uncommon', ilvl: 6,
    stats: { armor: 20, sta: 2 }, maxDurability: 30, vendorCopper: 300, color: 0x4caf50, suffixPool: 'melee' },

  // Consumables / trash / quest
  tough_jerky: { id: 'tough_jerky', name: 'Tough Jerky', icon: 'JK', slot: 'none', quality: 'common', ilvl: 1,
    vendorCopper: 5, stack: 20, desc: 'Restores health over time when eaten.' },
  refreshing_water: { id: 'refreshing_water', name: 'Refreshing Spring Water', icon: 'WT', slot: 'none', quality: 'common', ilvl: 1,
    vendorCopper: 5, stack: 20, desc: 'Restores mana over time when drunk.' },
  chipped_boar_tusk: { id: 'chipped_boar_tusk', name: 'Chipped Boar Tusk', icon: 'TK', slot: 'none', quality: 'poor', ilvl: 1,
    vendorCopper: 4, stack: 10 },
  boar_meat: { id: 'boar_meat', name: 'Chunk of Boar Meat', icon: 'MT', slot: 'none', quality: 'common', ilvl: 1,
    vendorCopper: 3, stack: 20, quest: true },
  ruined_pelt: { id: 'ruined_pelt', name: 'Ruined Wolf Pelt', icon: 'PL', slot: 'none', quality: 'poor', ilvl: 1,
    vendorCopper: 6, stack: 10 },
  kobold_candle: { id: 'kobold_candle', name: 'Kobold Candle', icon: 'CD', slot: 'none', quality: 'poor', ilvl: 1,
    vendorCopper: 7, stack: 10, quest: true },
  linen_cloth: { id: 'linen_cloth', name: 'Linen Cloth', icon: 'LC', slot: 'none', quality: 'common', ilvl: 1,
    vendorCopper: 8, stack: 20 },
};
