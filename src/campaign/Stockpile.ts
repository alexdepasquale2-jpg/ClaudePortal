import {
  MATERIAL_TIERS,
  emptyMaterialCounts,
  type MaterialCounts,
  type MaterialTier,
} from '@core/types/Vocabulary';

/**
 * Materials the campaign holds, per site and in total.
 *
 * Stockpiles persist; forts do not (ADR-0002). A run that built an enormous fort and died leaves
 * behind a smaller stockpile and nothing else — the materials were genuinely spent, and that is the
 * cost of the Power pillar being a spike rather than an investment.
 *
 * All operations return new values. A stockpile that could be mutated in place would be one aliasing
 * bug away from the campaign quietly gaining or losing materials.
 */
export const Stockpile = {
  empty: emptyMaterialCounts,

  add(base: MaterialCounts, addition: Partial<MaterialCounts>): MaterialCounts {
    const result = { ...base };
    for (const tier of MATERIAL_TIERS) {
      result[tier] = base[tier] + (addition[tier] ?? 0);
    }
    return result;
  },

  /** Subtract, clamping at zero. Use `canAfford` first if going negative should be refused. */
  subtract(base: MaterialCounts, cost: Partial<MaterialCounts>): MaterialCounts {
    const result = { ...base };
    for (const tier of MATERIAL_TIERS) {
      result[tier] = Math.max(0, base[tier] - (cost[tier] ?? 0));
    }
    return result;
  },

  canAfford(base: MaterialCounts, cost: Partial<MaterialCounts>): boolean {
    return MATERIAL_TIERS.every((tier) => base[tier] >= (cost[tier] ?? 0));
  },

  /** What is missing to afford a cost. Empty when affordable. */
  shortfall(base: MaterialCounts, cost: Partial<MaterialCounts>): MaterialCounts {
    const result = emptyMaterialCounts() as Record<MaterialTier, number>;
    for (const tier of MATERIAL_TIERS) {
      result[tier] = Math.max(0, (cost[tier] ?? 0) - base[tier]);
    }
    return result;
  },

  isEmpty(counts: MaterialCounts): boolean {
    return MATERIAL_TIERS.every((tier) => counts[tier] === 0);
  },

  total(counts: MaterialCounts): number {
    return MATERIAL_TIERS.reduce((sum, tier) => sum + counts[tier], 0);
  },
} as const;
