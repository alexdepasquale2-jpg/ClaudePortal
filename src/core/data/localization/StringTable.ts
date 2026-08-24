import { z } from 'zod';
import { parseData } from '../schema';
import rawEn from './en.json';

/**
 * UI strings.
 *
 * Flat key -> string, keys namespaced by dot. Flat because the extractor tool has to be able to
 * diff two locales mechanically, and nested tables make that a tree walk for no benefit.
 *
 * Design vocabulary (NNN, Goliath, Sancient, Nobot, Neetmon, Pyron Chrome) is NOT translated —
 * see STYLE-GUIDE.md. Those are names.
 */
export const StringTableSchema = z.record(z.string().min(1), z.string());

export type StringTable = z.infer<typeof StringTableSchema>;

let cache: StringTable | null = null;

export function loadStrings(): StringTable {
  cache ??= parseData('en.json', StringTableSchema, rawEn);
  return cache;
}

/** Look up a key. Returns the key itself when missing, so a gap is visible rather than blank. */
export function t(key: string): string {
  return loadStrings()[key] ?? key;
}
