export type TalentDef = {
  id: string; name: string; tree: string; classId: string;
  tier: number; maxRank: number; desc: string;
  requires?: string;            // dependency arrow: this talent needs a point in that one
  effect: { kind: 'ap' | 'crit' | 'spellPower' | 'costPct' | 'critDamage'; value: number };
};

/** One class ships a full three-tree spread; the Mage trees are stubs at one talent each. */
export const TALENTS: Record<string, TalentDef> = {
  w_deflection: { id: 'w_deflection', name: 'Deflection', tree: 'Arms', classId: 'warrior', tier: 1, maxRank: 5, desc: '+1% parry per rank.', effect: { kind: 'crit', value: 0 } },
  w_improved_heroic: { id: 'w_improved_heroic', name: 'Improved Heroic Strike', tree: 'Arms', classId: 'warrior', tier: 1, maxRank: 3, desc: 'Heroic Strike costs 1 less rage per rank.', effect: { kind: 'costPct', value: -7 } },
  w_impale: { id: 'w_impale', name: 'Impale', tree: 'Arms', classId: 'warrior', tier: 2, maxRank: 2, desc: '+10% critical strike damage per rank.', requires: 'w_improved_heroic', effect: { kind: 'critDamage', value: 10 } },
  w_cruelty: { id: 'w_cruelty', name: 'Cruelty', tree: 'Fury', classId: 'warrior', tier: 1, maxRank: 5, desc: '+1% melee crit per rank.', effect: { kind: 'crit', value: 1 } },
  w_unbridled: { id: 'w_unbridled', name: 'Unbridled Wrath', tree: 'Fury', classId: 'warrior', tier: 2, maxRank: 5, desc: '+4 attack power per rank.', requires: 'w_cruelty', effect: { kind: 'ap', value: 4 } },
  w_shield_spec: { id: 'w_shield_spec', name: 'Shield Specialization', tree: 'Protection', classId: 'warrior', tier: 1, maxRank: 5, desc: '+1% block per rank.', effect: { kind: 'crit', value: 0 } },
  w_toughness: { id: 'w_toughness', name: 'Toughness', tree: 'Protection', classId: 'warrior', tier: 2, maxRank: 5, desc: '+2% armor per rank.', requires: 'w_shield_spec', effect: { kind: 'ap', value: 0 } },

  m_arcane_focus: { id: 'm_arcane_focus', name: 'Arcane Focus', tree: 'Arcane', classId: 'mage', tier: 1, maxRank: 5, desc: 'Spells cost 2% less mana per rank.', effect: { kind: 'costPct', value: -2 } },
  m_improved_fireball: { id: 'm_improved_fireball', name: 'Improved Fireball', tree: 'Fire', classId: 'mage', tier: 1, maxRank: 5, desc: '+2 spell power per rank.', effect: { kind: 'spellPower', value: 2 } },
  m_elemental_precision: { id: 'm_elemental_precision', name: 'Elemental Precision', tree: 'Frost', classId: 'mage', tier: 1, maxRank: 3, desc: '+1% spell crit per rank.', effect: { kind: 'crit', value: 1 } },
};

export const treesFor = (classId: string) => {
  const trees: Record<string, TalentDef[]> = {};
  for (const t of Object.values(TALENTS)) {
    if (t.classId !== classId) continue;
    (trees[t.tree] ??= []).push(t);
  }
  for (const list of Object.values(trees)) list.sort((a, b) => a.tier - b.tier);
  return trees;
};
