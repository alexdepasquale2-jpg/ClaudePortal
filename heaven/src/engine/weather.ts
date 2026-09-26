// Weather is inferred from their words. First match wins.

export type Weather =
  | 'anger'
  | 'meal'
  | 'dark'
  | 'name'
  | 'light'
  | 'leaving'
  | 'love'
  | 'notKnowing';

export type Feeling = 'tired' | 'angry' | 'loving' | 'afraid' | 'unsure' | 'grieving' | 'glad';

const ORDER: [Weather, string[]][] = [
  ['anger', ['stop', 'stopped', 'hate', 'hated', 'angry', 'unfair', 'rage', 'wound', 'if you loved', 'you would have']],
  ['meal', ['bread', 'supper', 'table', 'hungry', 'eat', 'meal', 'loaf', 'fish', 'breakfast']],
  ['dark', ['dark', 'waiting', 'waited', 'whale', 'belly', 'night', 'alone', 'jonah']],
  ['name', ['called me', 'my name', 'named', 'name was']],
  ['light', ['light', 'morning', 'beginning', 'lamp', 'dawn']],
  ['leaving', ['goodbye', 'left', 'gone', 'ran', 'farewell']],
  ['love', ['still here', 'stayed', 'stay', 'wanted', 'love', 'loved', 'see me']],
  ['notKnowing', ['idk', "i don't know", 'fake', 'not sure', 'nothing']],
];

/** Lowercase, straighten quotes, collapse space. Never shown back to them. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\bdont\b/g, "don't")
    .replace(/\s+/g, ' ')
    .trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map<string, RegExp>();

export function has(text: string, phrase: string): boolean {
  let re = cache.get(phrase);
  if (!re) {
    re = new RegExp(`(^|[^a-z'])${escape(phrase)}(?![a-z])`);
    cache.set(phrase, re);
  }
  return re.test(normalize(text));
}

export function hasAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((p) => has(text, p));
}

export function keywordsFor(w: Weather): readonly string[] {
  return ORDER.find(([k]) => k === w)![1];
}

export function inferWeather(text: string): Weather {
  if (normalize(text) === '') return 'notKnowing';
  for (const [w, words] of ORDER) if (hasAny(text, words)) return w;
  return 'notKnowing';
}

export function feelingFor(w: Weather, text: string): Feeling {
  switch (w) {
    case 'anger':
      return 'angry';
    case 'meal':
      return hasAny(text, keywordsFor('leaving')) ? 'grieving' : 'glad';
    case 'dark':
      return 'afraid';
    case 'name':
      return 'loving';
    case 'light':
      return 'glad';
    case 'leaving':
      return 'grieving';
    case 'love':
      return 'loving';
    case 'notKnowing':
      return 'unsure';
  }
}
