/**
 * SkyNeet Survivors — shared types.
 * Operation state is disposable. Campaign state persists.
 */

export type Biome = 'cavern' | 'sump' | 'foundry' | 'lattice' | 'hum' | 'trunk';

export type Owner =
  | 'neet'
  | 'occupied'
  | 'robot'
  | 'sancientOp'
  | 'nobot'
  | 'neutral'
  | 'contested';

export type MachineKind = 'sweeper' | 'occupier' | 'walker' | 'siege' | 'nobot' | 'sancient';

export type BuildKind = 'extractor' | 'rack' | 'turret' | 'plate' | 'nnn' | 'chrome';

export type Tile = 'wall' | 'floor' | 'water' | 'works' | 'elevator';

export type Feat = 'ghost_extract' | 'lit_extract' | 'jacked' | 'sancient_kill' | 'dark_drop';

export interface Stock {
  scrap: number;
  rack: number;
  plate: number;
  chrome: number;
  fragments: number;
}

export interface Site {
  id: string;
  biome: Biome;
  depth: number;
  owner: Owner;
  /** How reachable the hole is. Building raises it. Sancients feed on it. */
  loudness: number;
  lit: boolean;
  resolved: number;
  lastHaul: number;
  chromeClad: boolean;
  neighbors: string[];
}

export interface Pipeline {
  a: string;
  b: string;
}

export interface Warfront {
  litNodes: number;
  provisionedMass: number;
  nobotCoordination: number;
  pressure: number;
  note: string;
}

export interface Campaign {
  seed: number;
  bornAt: number;
  sites: Record<string, Site>;
  pipelines: Pipeline[];
  stock: Stock;
  warfront: Warfront;
  feats: Partial<Record<Feat, number>>;
  opsResolved: number;
  trunkReached: boolean;
  ending: 'cut' | 'hold' | null;
  log: string[];
}

export interface Machine {
  id: number;
  kind: MachineKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 0..1. Competence = 1 - lethality on fallback. */
  lethality: number;
  neutrino: boolean;
  vx: number;
  vy: number;
  aim: number;
  tx: number;
  ty: number;
  telegraph: number;
  wander: number;
  /** Sancient only: remaining window seconds. */
  window: number;
  charge: number;
}

export interface Building {
  id: number;
  kind: BuildKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  from: 'player' | 'machine' | 'turret';
  life: number;
}

export interface Wreck {
  x: number;
  y: number;
  scrap: number;
}

export interface Operation {
  siteId: string;
  biome: Biome;
  depth: number;
  w: number;
  h: number;
  tiles: Tile[];
  player: { x: number; y: number; hp: number; maxHp: number; fireCd: number };
  cargo: number;
  quota: number;
  machines: Machine[];
  buildings: Building[];
  wrecks: Wreck[];
  shots: Shot[];
  nnnLit: boolean;
  nnnId: number | null;
  loudness: number;
  sancientWindow: number;
  sancientId: number | null;
  time: number;
  logs: { t: number; line: string }[];
  result: 'running' | 'extracted' | 'dead' | 'abandoned';
  litEver: boolean;
  jacked: boolean;
  sancientKilled: boolean;
  nextId: number;
}

export interface FrameInput {
  ax: number;
  ay: number;
  wx: number;
  wy: number;
  fire: boolean;
  place: boolean;
  interact: boolean;
  leave: boolean;
  build: BuildKind | null;
}

export interface OpResult {
  siteId: string;
  outcome: 'extracted' | 'dead' | 'abandoned';
  haul: Stock;
  lit: boolean;
  ghost: boolean;
  jacked: boolean;
  sancientKilled: boolean;
  duration: number;
}
