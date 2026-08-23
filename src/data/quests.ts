import type { QuestDef } from '../sim/types';

export const QUESTS: Record<string, QuestDef> = {
  q_boars: {
    id: 'q_boars', name: 'Boar Trouble', level: 1, giver: 'marshal_hale', turnIn: 'marshal_hale',
    objectives: [{ kind: 'kill', mobId: 'boar', count: 5, text: 'Mangy Boars slain' }],
    rewards: { xp: 250, copper: 85, items: ['worn_boots'] },
    text: 'The boars east of Hearthglen Rest have gotten bold. Thin them out — five should do it.',
    progressText: 'Still hearing them out there?',
    completeText: 'Good. The road is safer already. Take these, you will need the footing.',
  },
  q_meat: {
    id: 'q_meat', name: 'Supper for the Inn', level: 2, giver: 'innkeeper_bell', turnIn: 'innkeeper_bell',
    objectives: [{ kind: 'collect', itemId: 'boar_meat', count: 4, text: 'Chunk of Boar Meat' }],
    rewards: { xp: 300, copper: 120, items: ['tough_jerky'] },
    text: 'If you are killing boars anyway, bring me four chunks of meat and the stew is on me.',
    progressText: 'Four chunks. The pot is waiting.',
    completeText: 'That will feed the whole common room. Here, and there is jerky for the road.',
  },
  q_trainer: {
    id: 'q_trainer', name: 'Learn Your Trade', level: 2, giver: 'marshal_hale', turnIn: 'trainer_varn',
    objectives: [{ kind: 'talk', npcId: 'trainer_varn', text: 'Speak with your class trainer' }],
    rewards: { xp: 120, copper: 50 },
    prereq: ['q_boars'],
    text: 'You swing like someone who has never been taught. Varn can fix that. Go and speak with them.',
    progressText: 'Varn is by the forge.',
    completeText: 'So Hale sent you. Very well — let us see what you can learn.',
  },
  q_wolves: {
    id: 'q_wolves', name: 'Wolves at the Treeline', level: 4, giver: 'marshal_hale', turnIn: 'marshal_hale',
    objectives: [{ kind: 'kill', mobId: 'wolf', count: 6, text: 'Timber Wolves slain' }],
    rewards: { xp: 620, copper: 240, choice: ['tough_leather_gloves', 'boar_hide_belt'] },
    prereq: ['q_boars'],
    text: 'Wolves in the northern treeline now. Six of them, and pick something from the chest when you return.',
    progressText: 'The treeline, north of the road.',
    completeText: 'That should quiet the nights. Choose your reward.',
  },
  q_cave: {
    id: 'q_cave', name: 'Candles in the Dark', level: 5, giver: 'trainer_varn', turnIn: 'trainer_varn',
    objectives: [
      { kind: 'explore', x: 118, z: -96, radius: 14, text: 'Find the kobold cave' },
      { kind: 'collect', itemId: 'kobold_candle', count: 6, text: 'Kobold Candle' },
    ],
    rewards: { xp: 900, copper: 400, choice: ['verdant_edge', 'emberwood_wand'] },
    prereq: ['q_trainer'],
    text: 'Kobolds have dug into the hill southeast. Find their cave, take six of their candles, and come back whole.',
    progressText: 'Southeast, past the broken fence.',
    completeText: 'Six candles and all your fingers. Take your pick of the rack.',
  },
};
