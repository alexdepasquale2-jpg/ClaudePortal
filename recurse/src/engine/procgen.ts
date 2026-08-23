/**
 * procgen.ts — the generative half of the one function.
 *
 * Everything about a node (its name, its generators, its colour, its
 * pathology) is a pure function of a 32-bit seed. Nothing here touches the
 * DOM, the clock, or the save file; give it the same seed twice and you get
 * the same node twice, on any machine, in any epoch.
 */

export type Arch =
  | 'steady'
  | 'pulse'
  | 'decay'
  | 'resonant'
  | 'parasitic'
  | 'cascade';

export type Anomaly = 'mirror' | 'echo' | 'void' | 'bloom';

export type Tier = 'surface' | 'shallow' | 'deep' | 'abyssal';

export const ARCHETYPES: Arch[] = [
  'steady',
  'pulse',
  'decay',
  'resonant',
  'parasitic',
  'cascade',
];

/** Design weights. Do not change without re-running the headless check. */
export const ARCH_WEIGHTS: Record<Arch, number> = {
  steady: 36,
  pulse: 15,
  decay: 14,
  resonant: 14,
  parasitic: 10,
  cascade: 11,
};

export const ANOMALIES: Anomaly[] = ['mirror', 'echo', 'void', 'bloom'];

/** Relative frequency *within* the ~1/12 of nodes that are anomalous. */
export const ANOMALY_WEIGHTS: Record<Anomaly, number> = {
  mirror: 30,
  echo: 28,
  void: 21,
  bloom: 21,
};

/** One node in twelve carries an anomaly. */
export const ANOMALY_RATE = 1 / 12;

export const TIERS: Tier[] = ['surface', 'shallow', 'deep', 'abyssal'];

/** 6 archetypes x 4 tiers x 5 anomaly states (four types + none). */
export const SPECIES_COUNT =
  ARCHETYPES.length * TIERS.length * (ANOMALIES.length + 1);

// ---------------------------------------------------------------------------
// deterministic randomness
// ---------------------------------------------------------------------------

/** FNV-1a, 32-bit, returned unsigned. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Rng = () => number;

/** mulberry32. Small, fast, and good enough for a game about noise. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: Rng, xs: readonly T[]): T {
  return xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))];
}

export function weightedPick<T extends string>(
  r: Rng,
  weights: Record<T, number>,
  keys: readonly T[],
): T {
  let total = 0;
  for (const k of keys) total += weights[k];
  let roll = r() * total;
  for (const k of keys) {
    roll -= weights[k];
    if (roll < 0) return k;
  }
  return keys[keys.length - 1];
}

// ---------------------------------------------------------------------------
// word grammar
// ---------------------------------------------------------------------------

export interface PhonemeBank {
  id: number;
  name: string;
  ON: string[];
  NU: string[];
  CO: string[];
}

/**
 * Bank 0 is the language the game ships with. Genesis swaps banks. The first
 * six banks are authored; later banks are derived so the name-space never
 * actually runs out.
 */
export const BANKS: PhonemeBank[] = [
  {
    id: 0,
    name: 'Ordinal',
    ON: ['k', 'th', 'v', 'z', 'm', 'r', 's', 'n', 'dr', 'gl', 'sh', 'x', 'br', 'tr', 'ph', 'l', 'h', 'qu'],
    NU: ['a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'ou', 'ia', 'y', 'ua', 'eo'],
    CO: ['n', 'r', 'th', 's', 'x', 'l', 'm', 'k', 'ss', 'nn', 'rk', 'ld', '', '', ''],
  },
  {
    id: 1,
    name: 'Umbral',
    ON: ['gh', 'w', 'j', 'kr', 'pl', 'sv', 'tz', 'ng', 'fr', 'ch', 'y', 'b', 'd', 'g', 'vr', 'zh'],
    NU: ['aa', 'oo', 'ee', 'au', 'oi', 'ui', 'ee', 'ao', 'uu', 'ye', 'iu'],
    CO: ['ng', 'ff', 'gh', 'ct', 'pt', 'sk', 'v', 'z', 'w', 'j', '', '', 'tl'],
  },
  {
    id: 2,
    name: 'Liminal',
    ON: ['ts', 'kh', 'mn', 'ps', 'rh', 'sc', 'thr', 'xy', 'zv', 'ql', 'nd', 'mb'],
    NU: ['ai', 'oa', 'ue', 'ie', 'eu', 'yi', 'aeo', 'iou', 'oe'],
    CO: ['rn', 'lm', 'st', 'ph', 'tch', 'nx', 'lk', 'rt', '', 'dh'],
  },
  {
    id: 3,
    name: 'Serrated',
    ON: ['sk', 'vr', 'kl', 'st', 'gr', 'tw', 'zr', 'fn', 'qx', 'hl', 'brn', 'spk'],
    NU: ['ae', 'io', 'ua', 'ei', 'ao', 'uy', 'oa', 'ie'],
    CO: ['sk', 'rn', 'xt', 'lp', 'sh', 'rk', 'ft', '', 'zz'],
  },
  {
    id: 4,
    name: 'Auroral',
    ON: ['l', 'n', 's', 'h', 'w', 'y', 'fl', 'sn', 'hl', 'ly', 'sw', 'ny'],
    NU: ['ae', 'ia', 'ea', 'au', 'ou', 'ie', 'ao', 'ue', 'ya'],
    CO: ['l', 'n', 's', 'th', 'r', '', 'll', 'nn'],
  },
  {
    id: 5,
    name: 'Cavern',
    ON: ['g', 'd', 'b', 'k', 'dr', 'gr', 'br', 'kr', 'gl', 'dg', 'kb', 'rd'],
    NU: ['o', 'u', 'a', 'ou', 'au', 'oo', 'ua', 'or'],
    CO: ['g', 'm', 'nk', 'rd', 'lm', 'ght', 'mb', '', 'gg'],
  },
];

/**
 * Banks past the six shipped tongues are folded out of the ones before them,
 * seeded by the player's own history. The alphabet mutates but stays pronounceable.
 */
export function deriveBank(index: number, seed: number): PhonemeBank {
  if (index < BANKS.length) return BANKS[index];
  const r = rng(hash(`bank:${index}:${seed}`));
  const src = BANKS[index % BANKS.length];
  const other = BANKS[(index + 1) % BANKS.length];
  const blend = (a: string[], b: string[], keep: number): string[] => {
    const out: string[] = [];
    for (const x of a) if (r() < keep) out.push(x);
    for (const x of b) if (r() < 1 - keep) out.push(x);
    for (let i = 0; i < 4; i++) out.push(pick(r, a) + pick(r, b));
    return out.length ? out : a.slice();
  };
  return {
    id: index,
    name: word(rng(hash(`bankname:${index}:${seed}`)), 2),
    ON: blend(src.ON, other.ON, 0.6),
    NU: blend(src.NU, other.NU, 0.7),
    CO: blend(src.CO, other.CO, 0.6),
  };
}

/** Build a pronounceable word of `syllables` syllables from a phoneme bank. */
export function word(r: Rng, syllables: number, bank: PhonemeBank = BANKS[0]): string {
  let out = '';
  const n = Math.max(1, syllables | 0);
  for (let i = 0; i < n; i++) {
    out += pick(r, bank.ON) + pick(r, bank.NU);
    // codas mid-word are rare enough to keep the result speakable
    if (i === n - 1 || r() < 0.35) out += pick(r, bank.CO);
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Two-part designation used for node names: "Threxil Vaun". */
export function properName(r: Rng, bank: PhonemeBank = BANKS[0]): string {
  const a = word(r, 2 + (r() < 0.4 ? 1 : 0), bank);
  if (r() < 0.45) return a;
  return `${a} ${word(r, r() < 0.6 ? 1 : 2, bank)}`;
}

// ---------------------------------------------------------------------------
// node shape
// ---------------------------------------------------------------------------

export interface GenData {
  /** Procedural name of this generator. */
  name: string;
  seed: number;
  arch: Arch;
  /** Output per unit, before debuffs and door multipliers. */
  base: number;
  /** Cost of the first unit. */
  c0: number;
  /** Cost growth ratio. */
  gr: number;
  /** Units owned. */
  n: number;
  /** Path of the child node behind this generator's door, or null. */
  door: string | null;
  /** Auto-buyer: seconds between purchases, 0 = off. */
  autoEvery: number;
  /** Timestamp (sim seconds) of the last auto purchase. */
  autoAt: number;
  /** Lifetime units of this generator ever bought. */
  bought: number;
}

export interface NodeData {
  /** '' for the root; otherwise dot-joined generator indices, e.g. '0.3.1'. */
  path: string;
  seed: number;
  name: string;
  /** 0..359 */
  hue: number;
  depth: number;
  anomaly: Anomaly | null;
  gens: GenData[];
  currency: number;
  /** Total currency this node has ever produced. */
  lifetime: number;
  /** Taxonomy key, e.g. 'deep/cascade/void'. */
  species: string;
  /** Sigil geometry, all seed-derived. */
  sigil: SigilParams;
  createdAt: number;
}

export interface SigilParams {
  branches: number;
  angle: number;
  shrink: number;
  twist: number;
  wobble: number;
  hue: number;
}

/** Currency a node is born holding. Enough for a first handful of tier 0. */
export const NEW_NODE_CURRENCY = 3;

export function endowment(mult = 1): number {
  return NEW_NODE_CURRENCY * mult;
}

export function tierOf(depth: number): Tier {
  if (depth <= 0) return 'surface';
  if (depth <= 2) return 'shallow';
  if (depth <= 5) return 'deep';
  return 'abyssal';
}

export function tierIndex(t: Tier): number {
  return TIERS.indexOf(t);
}

/** Which archetype defines this node: most common, ties broken by highest tier. */
export function dominantArch(gens: readonly GenData[]): Arch {
  const counts = new Map<Arch, number>();
  for (const g of gens) counts.set(g.arch, (counts.get(g.arch) ?? 0) + 1);
  let best: Arch = gens[gens.length - 1].arch;
  let bestCount = -1;
  // walk backwards so the deepest generator wins ties
  for (let i = gens.length - 1; i >= 0; i--) {
    const c = counts.get(gens[i].arch)!;
    if (c > bestCount) {
      bestCount = c;
      best = gens[i].arch;
    }
  }
  return best;
}

export function speciesKey(
  tier: Tier,
  arch: Arch,
  anomaly: Anomaly | null,
): string {
  return `${tier}/${arch}/${anomaly ?? 'none'}`;
}

export function parseSpecies(
  key: string,
): { tier: Tier; arch: Arch; anomaly: Anomaly | null } {
  const [tier, arch, anomaly] = key.split('/');
  return {
    tier: tier as Tier,
    arch: arch as Arch,
    anomaly: anomaly === 'none' ? null : (anomaly as Anomaly),
  };
}

/** Every species key, in a stable order — used to size the codex. */
export function allSpecies(): string[] {
  const out: string[] = [];
  for (const t of TIERS)
    for (const a of ARCHETYPES)
      for (const an of [null, ...ANOMALIES])
        out.push(speciesKey(t, a, an));
  return out;
}

export interface GenOptions {
  /** Which archetypes may be rolled. Defaults to all six at design weights. */
  archs?: readonly Arch[];
  /** Which anomalies may be rolled. Defaults to all four. */
  anomalies?: readonly Anomaly[];
  /** Phoneme bank for names. */
  bank?: PhonemeBank;
  /** Override the anomaly roll rate (tests only). */
  anomalyRate?: number;
  /** Epoch law: bloom appends two generators instead of one. */
  bloomDouble?: boolean;
  createdAt?: number;
}

/**
 * Ladder shape. Cost climbs slightly faster than output (5.5 vs 5), so tier 0
 * is the efficient buy at first and each higher tier overtakes it once the
 * geometric curve bites — the usual idle pacing, but deliberately shallow.
 *
 * A steep ladder would gate DOORS behind late-tier prices, and since a door
 * only needs one unit, that would make descending into a fresh node the
 * cheapest expansion available at every moment — the tree would degenerate
 * into a chain no matter what the player intended. Width has to be affordable
 * for the choice between width and depth to exist at all.
 */
const GEN_BASE_STEP = 3;
const GEN_COST_STEP = 3.3;
/**
 * Absolute scale matters, because K = 12 is fixed. A door is worth
 * 1 + (childRate/12)^E, so if a lone node's raw output runs into the hundreds
 * the very first door is already worth ~50x and two levels of tree clear the
 * goal — depth stops meaning anything. Output and cost are scaled together
 * here, which leaves every payback time untouched while keeping node rates in
 * the same neighbourhood as K, where the exponent is doing visible work.
 */
const GEN_COST_BASE = 1;

/**
 * The generative function. One node, fully determined by (path, seed, depth).
 *
 * Anomalies are applied here, at creation, exactly once — nothing downstream
 * re-applies them, so a node's numbers never drift from its species.
 */
export function makeNode(
  path: string,
  seed: number,
  depth: number,
  opts: GenOptions = {},
): NodeData {
  const archs = opts.archs ?? ARCHETYPES;
  const anomalies = opts.anomalies ?? ANOMALIES;
  const bank = opts.bank ?? BANKS[0];
  const rate = opts.anomalyRate ?? ANOMALY_RATE;
  const r = rng(seed);

  const name = properName(r, bank);
  const hue = Math.floor(r() * 360);

  // Anomaly roll happens before generator construction so it can reshape them.
  const anomaly: Anomaly | null = r() < rate ? weightedPick(r, ANOMALY_WEIGHTS, anomalies) : null;

  const scale = 0.06 + r() * 0.1;
  const gens: GenData[] = [];
  const genCount = 4;
  for (let i = 0; i < genCount; i++) {
    gens.push(makeGen(r, i, scale, archs, bank, seed));
  }

  if (anomaly === 'bloom') {
    const extra = opts.bloomDouble ? 2 : 1;
    for (let k = 0; k < extra; k++) {
      const last = gens[gens.length - 1];
      const g = makeGen(r, gens.length, scale, archs, bank, seed);
      g.base = last.base * 4;
      g.c0 = last.c0 * 24;
      gens.push(g);
    }
  }

  if (anomaly === 'mirror') {
    for (const g of gens) {
      g.gr = 1 + (g.gr - 1) * 0.55;
      g.base *= 0.7;
    }
  } else if (anomaly === 'echo') {
    for (const g of gens) {
      g.gr = 1 + (g.gr - 1) * 0.22;
    }
  }
  // 'void' and 'bloom' act at rate-computation and construction time
  // respectively; nothing further to do to the generator table here.

  const tier = tierOf(depth);
  return {
    path,
    seed,
    name,
    hue,
    depth,
    anomaly,
    gens,
    currency: endowment(),
    lifetime: 0,
    species: speciesKey(tier, dominantArch(gens), anomaly),
    sigil: sigilParams(seed, hue),
    createdAt: opts.createdAt ?? 0,
  };
}

function makeGen(
  r: Rng,
  i: number,
  scale: number,
  archs: readonly Arch[],
  bank: PhonemeBank,
  nodeSeed: number,
): GenData {
  const arch = weightedPick(r, ARCH_WEIGHTS, archs);
  return {
    name: word(r, 1 + (r() < 0.5 ? 1 : 0), bank),
    seed: (hash(`${nodeSeed}:g${i}`) ^ nodeSeed) >>> 0,
    arch,
    base: scale * Math.pow(GEN_BASE_STEP, i),
    c0: GEN_COST_BASE * Math.pow(GEN_COST_STEP, i),
    gr: 1.18 + 0.015 * i + r() * 0.04,
    n: 0,
    door: null,
    autoEvery: 0,
    autoAt: 0,
    bought: 0,
  };
}

export function sigilParams(seed: number, hue: number): SigilParams {
  const r = rng((seed ^ 0x9e3779b9) >>> 0);
  return {
    branches: 2 + Math.floor(r() * 4),
    angle: 0.25 + r() * 0.85,
    shrink: 0.58 + r() * 0.22,
    twist: (r() - 0.5) * 0.9,
    wobble: r() * 0.4,
    hue,
  };
}

/** Deterministic child seed — two players on the same root see the same tree. */
export function childSeed(parentSeed: number, genIndex: number): number {
  return hash(`${parentSeed >>> 0}:door:${genIndex}`);
}

export function childPath(parentPath: string, genIndex: number): string {
  return parentPath === '' ? String(genIndex) : `${parentPath}.${genIndex}`;
}

export function parentPath(path: string): string | null {
  if (path === '') return null;
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(0, i);
}

// ---------------------------------------------------------------------------
// description dictionary — the codex text is templated, never hardcoded
// ---------------------------------------------------------------------------

export const ARCH_LABEL: Record<Arch, string> = {
  steady: 'Steady',
  pulse: 'Pulse',
  decay: 'Decay',
  resonant: 'Resonant',
  parasitic: 'Parasitic',
  cascade: 'Cascade',
};

const ARCH_NOUN: Record<Arch, string> = {
  steady: 'engine',
  pulse: 'oscillator',
  decay: 'sink',
  resonant: 'chorus',
  parasitic: 'predator',
  cascade: 'cataract',
};

const ARCH_CLAUSE: Record<Arch, string> = {
  steady: 'Its output is flat, unhurried, and indifferent to observation.',
  pulse: 'Output breathes on a period fixed at its birth and never renegotiated.',
  decay: 'Each additional unit is worth marginally less than the last; scale punishes it.',
  resonant: 'It listens to its siblings and grows louder the more of them there are.',
  parasitic: 'It runs hot by drawing down the neighbour immediately downstream of it.',
  cascade: 'Whatever is built beneath its door is amplified past the usual ceiling.',
};

const ANOM_LABEL: Record<Anomaly, string> = {
  mirror: 'Mirror',
  echo: 'Echo',
  void: 'Void',
  bloom: 'Bloom',
};

const ANOM_CLAUSE: Record<Anomaly, string> = {
  mirror: 'Its cost curve is folded flat, and its yield dimmed to match.',
  echo: 'Costs here barely rise at all; the specimen repeats itself almost for free.',
  void: 'Nothing beneath it reaches it. It is brighter alone than it could ever be attended.',
  bloom: 'It has grown a generator no sibling species possesses.',
};

const TIER_ADJ: Record<Tier, string> = {
  surface: 'surface-dwelling',
  shallow: 'shallow-water',
  deep: 'deep-strata',
  abyssal: 'abyssal',
};

const TIER_CLAUSE: Record<Tier, string> = {
  surface: 'Recovered at the origin, where the recursion has not yet begun to bite.',
  shallow: 'Recovered a door or two down, still within sight of the surface.',
  deep: 'Recovered well below the third door, where names start to repeat.',
  abyssal: 'Recovered past the seventh door, in strata that only exist while observed.',
};

/**
 * Assemble a description from the taxonomy. Nothing is written per-species;
 * all 120 entries fall out of these four dictionaries.
 */
export function describeSpecies(key: string, specimenName: string): string {
  const { tier, arch, anomaly } = parseSpecies(key);
  const head = `${specimenName} is a ${TIER_ADJ[tier]} ${ARCH_NOUN[arch]}`;
  const tail = anomaly ? `, marked by the ${ANOM_LABEL[anomaly]} anomaly.` : '.';
  const body = [ARCH_CLAUSE[arch], anomaly ? ANOM_CLAUSE[anomaly] : '', TIER_CLAUSE[tier]]
    .filter(Boolean)
    .join(' ');
  return `${head}${tail} ${body}`;
}

export function speciesTitle(key: string): string {
  const { tier, arch, anomaly } = parseSpecies(key);
  const t = tier.charAt(0).toUpperCase() + tier.slice(1);
  return anomaly
    ? `${t} ${ARCH_LABEL[arch]} · ${ANOM_LABEL[anomaly]}`
    : `${t} ${ARCH_LABEL[arch]}`;
}
