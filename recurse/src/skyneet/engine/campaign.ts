/**
 * Campaign graph. Persistent. The only thing you keep.
 * Time advances only when operations resolve.
 */

import { BIOME_COPY, warfrontLine } from './lore';
import { hash, irange, pick, rng } from './rng';
import type {
  Biome,
  Campaign,
  OpResult,
  Pipeline,
  Site,
  Stock,
  Warfront,
} from './types';

const REGULAR: Biome[] = ['cavern', 'sump', 'foundry', 'lattice', 'hum'];

export function emptyStock(): Stock {
  return { scrap: 18, rack: 2, plate: 0, chrome: 0, fragments: 0 };
}

export function addStock(a: Stock, b: Partial<Stock>): Stock {
  return {
    scrap: a.scrap + (b.scrap ?? 0),
    rack: a.rack + (b.rack ?? 0),
    plate: a.plate + (b.plate ?? 0),
    chrome: a.chrome + (b.chrome ?? 0),
    fragments: a.fragments + (b.fragments ?? 0),
  };
}

export function spend(stock: Stock, cost: Partial<Stock>): boolean {
  if ((cost.scrap ?? 0) > stock.scrap) return false;
  if ((cost.rack ?? 0) > stock.rack) return false;
  if ((cost.plate ?? 0) > stock.plate) return false;
  if ((cost.chrome ?? 0) > stock.chrome) return false;
  if ((cost.fragments ?? 0) > stock.fragments) return false;
  stock.scrap -= cost.scrap ?? 0;
  stock.rack -= cost.rack ?? 0;
  stock.plate -= cost.plate ?? 0;
  stock.chrome -= cost.chrome ?? 0;
  stock.fragments -= cost.fragments ?? 0;
  return true;
}

export function smeltChrome(stock: Stock): boolean {
  if (stock.fragments < 1) return false;
  stock.fragments -= 1;
  stock.chrome += 1;
  return true;
}

export function newWarfront(): Warfront {
  return { litNodes: 0, provisionedMass: 0, nobotCoordination: 0, pressure: 0, note: 'Quiet. For now.' };
}

export function newCampaign(seed = (Math.random() * 0xffffffff) >>> 0): Campaign {
  const r = rng(hash(`archipelago:${seed}`));
  const sites: Record<string, Site> = {};
  const order: string[] = [];

  for (const biome of REGULAR) {
    const n = biome === 'cavern' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const id = `${biome}_${i}`;
      const depth =
        biome === 'cavern' ? 0.12 + r() * 0.18 : biome === 'hum' ? 0.72 + r() * 0.18 : 0.28 + r() * 0.45;
      sites[id] = {
        id,
        biome,
        depth,
        owner: biome === 'lattice' && i === 0 ? 'nobot' : 'neutral',
        loudness: biome === 'hum' ? 0.35 : 0,
        lit: false,
        resolved: 0,
        lastHaul: 0,
        chromeClad: false,
        neighbors: [],
      };
      order.push(id);
    }
  }

  sites.trunk_0 = {
    id: 'trunk_0',
    biome: 'trunk',
    depth: 1,
    owner: 'sancientOp',
    loudness: 0.55,
    lit: false,
    resolved: 0,
    lastHaul: 0,
    chromeClad: false,
    neighbors: [],
  };

  const pipelines: Pipeline[] = [];
  const link = (a: string, b: string) => {
    if (!sites[a] || !sites[b]) return;
    if (sites[a].neighbors.includes(b)) return;
    sites[a].neighbors.push(b);
    sites[b].neighbors.push(a);
    pipelines.push({ a, b });
  };

  // A path through the archipelago, then a few cross-cuts.
  for (let i = 0; i < order.length - 1; i++) link(order[i], order[i + 1]);
  link(order[0], order[2]);
  link(order[1], order[3]);
  link(order[order.length - 1], 'trunk_0');
  if (r() > 0.4) link(order[irange(r, 0, order.length - 1)], pick(r, order));

  return {
    seed,
    bornAt: Date.now(),
    sites,
    pipelines,
    stock: emptyStock(),
    warfront: newWarfront(),
    feats: {},
    opsResolved: 0,
    trunkReached: false,
    ending: null,
    log: ['[SkyNeet] Archipelago generated. Nobody names holes.'],
  };
}

export function siteList(c: Campaign): Site[] {
  return Object.values(c.sites).sort((a, b) => a.id.localeCompare(b.id));
}

export function trunkUnlocked(c: Campaign): boolean {
  const held = siteList(c).filter((s) => s.biome !== 'trunk' && s.owner === 'neet').length;
  return held >= 3 || c.stock.chrome > 0 || c.opsResolved >= 5;
}

export function canDrop(c: Campaign, id: string): boolean {
  if (c.ending) return false;
  const s = c.sites[id];
  if (!s) return false;
  if (s.biome === 'trunk') return trunkUnlocked(c);
  return true;
}

export function tickWarfront(c: Campaign, provisionedMass: number): Warfront {
  const sites = siteList(c);
  const litNodes = sites.filter((s) => s.lit).length;
  let nobotClusters = 0;
  for (const s of sites) {
    if (s.owner !== 'nobot') continue;
    if (s.neighbors.some((n) => c.sites[n]?.owner === 'nobot')) nobotClusters += 1;
  }
  const nobotCoordination = nobotClusters / 2;
  const inputs = [
    { name: 'lit nodes', v: litNodes * 0.34 },
    { name: 'provisioned mass', v: provisionedMass },
    { name: 'nobot coordination', v: nobotCoordination },
  ];
  inputs.sort((a, b) => b.v - a.v);
  const driver = inputs[0];
  const pressure = inputs[0].v * 0.65 + inputs[1].v * 0.25 + inputs[2].v * 0.1;

  // Highest input pushes ownership outward from its strongest cluster.
  if (driver.name === 'lit nodes' && litNodes > 0) {
    for (const s of sites) {
      if (!s.lit || s.biome === 'trunk') continue;
      for (const nid of s.neighbors) {
        const n = c.sites[nid];
        if (!n || n.biome === 'trunk' || n.owner === 'neet') continue;
        if (pressure > 0.8 && n.owner === 'neutral') n.owner = 'robot';
        if (pressure > 1.4 && n.owner === 'robot') n.owner = 'contested';
      }
    }
  }
  if (driver.name === 'nobot coordination') {
    for (const s of sites) {
      if (s.owner !== 'nobot') continue;
      for (const nid of s.neighbors) {
        const n = c.sites[nid];
        if (n && n.owner === 'neutral' && n.biome !== 'trunk') n.owner = 'nobot';
      }
    }
  }
  if (driver.name === 'provisioned mass' && provisionedMass > 0.6) {
    for (const s of sites) {
      if (s.biome === 'hum' || s.biome === 'trunk') s.owner = s.owner === 'neet' ? 'contested' : 'sancientOp';
    }
  }

  const wf: Warfront = {
    litNodes,
    provisionedMass,
    nobotCoordination,
    pressure,
    note: warfrontLine(pressure, driver.name),
  };
  c.warfront = wf;
  return wf;
}

export function resolveOperation(c: Campaign, result: OpResult): void {
  const s = c.sites[result.siteId];
  if (!s) return;
  c.stock = addStock(c.stock, result.haul);
  c.opsResolved += 1;
  s.resolved += 1;
  s.lastHaul = result.haul.scrap + result.haul.rack * 3 + result.haul.plate * 8;
  s.lit = result.lit;
  if (result.lit) s.loudness = Math.min(1, s.loudness + 0.4);
  else s.loudness = Math.max(0, s.loudness - 0.08);

  if (result.outcome === 'extracted') {
    s.owner = 'neet';
    if (result.ghost) c.feats.ghost_extract = (c.feats.ghost_extract ?? 0) + 1;
    else c.feats.lit_extract = (c.feats.lit_extract ?? 0) + 1;
    if (!result.lit) c.feats.dark_drop = (c.feats.dark_drop ?? 0) + 1;
  } else if (result.outcome === 'dead') {
    if (result.lit) s.owner = 'occupied';
  }

  if (result.jacked) {
    c.feats.jacked = (c.feats.jacked ?? 0) + 1;
    c.stock.fragments += 1;
  }
  if (result.sancientKilled) c.feats.sancient_kill = (c.feats.sancient_kill ?? 0) + 1;

  if (s.biome === 'foundry' && s.owner === 'neet' && s.resolved >= 1) {
    c.stock.plate += 2;
  }

  // Pipelines move stock between Neet-held endpoints.
  for (const p of c.pipelines) {
    const a = c.sites[p.a];
    const b = c.sites[p.b];
    if (a.owner === 'neet' && b.owner === 'neet' && c.stock.scrap > 8) {
      // already pooled — ownership is the bonus
    } else if (a.owner === 'neet' && b.owner !== 'neet' && c.stock.scrap > 12) {
      c.stock.scrap -= 1;
    }
  }

  const mass = result.lit ? 0.4 + s.depth * 0.5 : result.sancientKilled || result.jacked ? 0.7 : 0.05;
  tickWarfront(c, mass);
  c.log.push(c.warfront.note);
  if (c.log.length > 80) c.log.splice(0, c.log.length - 80);
  if (s.biome === 'trunk' && result.outcome === 'extracted') c.trunkReached = true;
}

export function decideTrunk(c: Campaign, choice: 'cut' | 'hold'): void {
  c.ending = choice;
  if (choice === 'cut') {
    for (const s of siteList(c)) {
      s.lit = false;
      s.loudness = 0;
      if (s.owner === 'robot' || s.owner === 'sancientOp' || s.owner === 'occupied') s.owner = 'neutral';
    }
    c.stock = { scrap: 0, rack: 0, plate: 0, chrome: 0, fragments: 0 };
    c.warfront = newWarfront();
    c.log.push('[SkyNeet] Trunk cut. Nothing, and nobody looking for you.');
  } else {
    for (const s of siteList(c)) {
      s.owner = 'neet';
      s.lit = true;
    }
    c.warfront = { litNodes: siteList(c).length, provisionedMass: 0, nobotCoordination: 0, pressure: 0, note: '[SkyNeet] You are answering.' };
    c.log.push('[SkyNeet] Backbone held. It is fine for as long as you keep answering.');
  }
}

export function siteBlurb(s: Site): string {
  return `${BIOME_COPY[s.biome].name} · depth ${s.depth.toFixed(2)} · ${s.id}`;
}
