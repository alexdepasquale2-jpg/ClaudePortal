import { z } from 'zod';
import { IdSchema, parseData } from '../schema';
import rawPool from './card-pool.json';

/**
 * Vampire-Survivors-style in-run cards.
 *
 * DESIGN.md, in the progression list: "In-run VS-style cards always reset." Cards are the ONLY
 * progression that does not touch the campaign graph. Nothing a card does may outlive the run, and
 * no card may write to a stockpile, ownership, radicalisation, feats or the tech tree.
 *
 * The schema enforces that: `scope` is the literal 'run' and there is no persistence field. If a
 * card needs to matter tomorrow, it is a tech tree node, not a card.
 */
export const CardEffectSchema = z.object({
  /** Which runtime stat this modifies. Resolved by CardEffectRunner. */
  target: IdSchema,
  operation: z.enum(['add', 'multiply', 'set']),
  value: z.number(),
});

export const InRunCardSchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1),
  description: z.string().min(1),
  /** Always 'run'. A card that persists is a contradiction in terms. */
  scope: z.literal('run'),
  /** Draw weight within its rarity band. */
  weight: z.number().positive(),
  rarity: z.enum(['common', 'uncommon', 'rare']),
  /** Highest number of times it can be taken in one run. */
  maxStacks: z.number().int().min(1),
  effects: z.array(CardEffectSchema).min(1),
  /** Which pillar this card is serving. Every card must serve one. */
  pillar: z.enum(['Greed', 'Dread', 'Power', 'Panic', 'Consequence']),
});

export type CardEffect = z.infer<typeof CardEffectSchema>;
export type InRunCard = z.infer<typeof InRunCardSchema>;

export const CardPoolSchema = z.array(InRunCardSchema).min(1);

let cache: readonly InRunCard[] | null = null;

export function loadCardPool(): readonly InRunCard[] {
  cache ??= parseData('card-pool.json', CardPoolSchema, rawPool);
  return cache;
}
