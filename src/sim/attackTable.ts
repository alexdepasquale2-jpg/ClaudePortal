import * as F from '../data/formulas';
import { roll100 } from './rng';
import type { AttackOutcome, Unit, World } from './types';
import { effStats } from './world';

/** Classic rolls ONE d100 against a stacked table, not independent rolls per outcome.
 *  Order matters: miss > dodge > parry > block > glancing > crit > crushing > hit. */
export function rollAttack(w: World, atk: Unit, def: Unit, opts: { canCrit?: boolean; cannotMiss?: boolean } = {}): AttackOutcome {
  const delta = def.level - atk.level;
  const a = effStats(w, atk), d = effStats(w, def);

  let miss = F.BASE_MISS_PCT + Math.max(0, delta) * F.MISS_PER_LEVEL;
  if (delta > 3) miss += (delta - 3) * F.MISS_PER_LEVEL_ABOVE_3;
  let dodge = (def.kind === 'player' ? F.dodgeFrom(d.agi) : F.BASE_DODGE_PCT) + Math.max(0, delta) * 0.04;
  let parry = def.kind === 'player' ? F.BASE_PARRY_PCT : 0;
  const block = def.kind === 'player' ? F.BASE_BLOCK_PCT : 0;
  const glancing = delta >= F.GLANCING_MIN_LEVEL_DELTA ? F.GLANCING_CHANCE_PCT : 0;
  const crit = opts.canCrit === false ? 0 : Math.max(0, (atk.kind === 'player' ? F.critFrom(a.agi) + a.crit : 5) - Math.max(0, delta));
  const crushing = atk.kind === 'mob' && -delta >= F.CRUSHING_MIN_LEVEL_DELTA ? F.CRUSHING_CHANCE_PCT : 0;

  if (opts.cannotMiss) { miss = 0; dodge = 0; parry = 0; }

  const r = roll100(w.rng);
  let acc = miss;
  if (r < acc) return 'miss';
  if (r < (acc += dodge)) return 'dodge';
  if (r < (acc += parry)) return 'parry';
  if (r < (acc += block)) return 'block';
  if (r < (acc += glancing)) return 'glancing';
  if (r < (acc += crit)) return 'crit';
  if (r < (acc += crushing)) return 'crushing';
  return 'hit';
}

/** Spells use a binary table: resist-all or full hit, plus an independent crit roll. */
export function rollSpell(w: World, atk: Unit, def: Unit): AttackOutcome {
  const delta = def.level - atk.level;
  let miss = F.SPELL_BASE_MISS_PCT + Math.max(0, delta) * F.SPELL_MISS_PER_LEVEL;
  if (delta > 2) miss = F.SPELL_MISS_PER_LEVEL_ABOVE_2 + (delta - 3) * 11;
  if (roll100(w.rng) < miss) return 'resist';
  const a = effStats(w, atk);
  const crit = atk.kind === 'player' ? F.spellCritFrom(a.int) : 3;
  return roll100(w.rng) < crit ? 'crit' : 'hit';
}
