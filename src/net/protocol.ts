import type { Slot } from '../sim/types';

/** Every player action is one of these. The sim only ever sees Commands, never DOM or Three objects,
 *  so swapping the local queue for a WebSocket transport is a wire-format change, not a rewrite. */
export type Command =
  | { t: 'move'; dx: number; dz: number; facing: number }
  | { t: 'target'; id: number | null }
  | { t: 'cast'; spellId: string; targetId: number | null }
  | { t: 'stopcast' }
  | { t: 'loot'; corpseUnitId: number }
  | { t: 'lootSlot'; corpseUnitId: number; index: number }
  | { t: 'equip'; bagIndex: number }
  | { t: 'unequip'; slot: Slot }
  | { t: 'sell'; bagIndex: number }
  | { t: 'buy'; itemId: string }
  | { t: 'repair' }
  | { t: 'train'; spellId: string }
  | { t: 'acceptQuest'; questId: string }
  | { t: 'completeQuest'; questId: string; choice?: string }
  | { t: 'abandonQuest'; questId: string }
  | { t: 'talk'; npcId: string }
  | { t: 'rest'; on: boolean }
  | { t: 'revive' }
  | { t: 'setAction'; index: number; spellId: string | null }
  | { t: 'spendTalent'; talentId: string };

export type Frame = { tick: number; commands: Command[] };
