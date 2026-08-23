import type { LootTable } from '../sim/types';

// chance is percent, rolled independently per entry. money is a copper range.
export const LOOT: Record<string, LootTable> = {
  boar: { id: 'boar', money: { min: 3, max: 14 }, entries: [
    { itemId: 'chipped_boar_tusk', chance: 45 },
    { itemId: 'boar_meat', chance: 60, min: 1, max: 2 },
    { itemId: 'tough_jerky', chance: 12 },
    { itemId: 'boar_hide_belt', chance: 2 },
  ]},
  wolf: { id: 'wolf', money: { min: 4, max: 18 }, entries: [
    { itemId: 'ruined_pelt', chance: 50 },
    { itemId: 'tough_jerky', chance: 15 },
    { itemId: 'verdant_edge', chance: 3 },
  ]},
  kobold: { id: 'kobold', money: { min: 8, max: 30 }, entries: [
    { itemId: 'kobold_candle', chance: 55 },
    { itemId: 'linen_cloth', chance: 35 },
    { itemId: 'refreshing_water', chance: 15 },
    { itemId: 'verdant_edge', chance: 4 },
    { itemId: 'emberwood_wand', chance: 4 },
  ]},
  kobold_boss: { id: 'kobold_boss', money: { min: 60, max: 140 }, entries: [
    { itemId: 'verdant_edge', chance: 40 },
    { itemId: 'emberwood_wand', chance: 40 },
    { itemId: 'boar_hide_belt', chance: 35 },
    { itemId: 'linen_cloth', chance: 80, min: 2, max: 4 },
  ]},
  spider: { id: 'spider', money: { min: 3, max: 12 }, entries: [
    { itemId: 'linen_cloth', chance: 30 },
    { itemId: 'tough_leather_gloves', chance: 6 },
  ]},
};
