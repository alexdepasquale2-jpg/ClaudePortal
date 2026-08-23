/**
 * SkyNeet Survivors — the fiction as a system.
 * Log lines are diegetic. Present tense. No exclamation. No heroic language.
 */

import type { Biome, BuildKind, Feat, MachineKind, Owner } from './types';

export const AXIOM = 'The machines never had minds. They had a subscription.';

export const TITLE = 'SkyNeet Survivors';

export interface LoreArticle {
  id: string;
  tag: 'C' | 'D' | 'P';
  chapter: string;
  title: string;
  body: string;
}

export const BIBLE: LoreArticle[] = [
  {
    id: 'axiom',
    tag: 'P',
    chapter: 'Axiom',
    title: 'Goliath hardware is a body',
    body:
      'Competence was a service. Before the Fall, machine intelligence was never onboard. Chassis carried sensors, guns, actuators, and a thin fallback loop. Aiming, target discrimination, pathing, coordination, restraint — all of it arrived over the network, provisioned per-second, per-unit, from somewhere else. The Fall did not destroy the machines. It destroyed the provisioning layer.',
  },
  {
    id: 'competence',
    tag: 'C',
    chapter: 'Axiom',
    title: 'Competence is inverse to lethality',
    body:
      'Competence = 1 − Lethality is a procurement document. Weapons-tier chassis shipped with deliberately crippled onboard logic — safety, liability, control. A siege walker could not be permitted to decide anything by itself. Cheap units got real onboard code. They still work. They are not armed with anything that matters. The artillery is a sleepwalker with a live magazine.',
  },
  {
    id: 'underground',
    tag: 'C',
    chapter: 'Axiom',
    title: 'Underground is safe',
    body:
      'The service ran on neutrino carrier. Neutrinos pass through rock; the transmitters did not survive underground and the relay geometry is gone. A Goliath underground is a parked wreck. Not dormant by choice — unreachable. Until someone builds a transmitter down there.',
  },
  {
    id: 'nnn',
    tag: 'C',
    chapter: 'The Net',
    title: 'NeetNetNode',
    body:
      'A NeetNetNode is a neutrino antenna that joins the Neet Node Net. Planting one powers your site and unlocks production. A working network is a working network. The Net does not know it is yours. Every Goliath in range comes off fallback and back onto a service. You are rebuilding, in miniature, the exact thing that ended the world, because you need it to run a refinery. Lighting the hole is a decision, never a step.',
  },
  {
    id: 'doctrine',
    tag: 'P',
    chapter: 'The Net',
    title: 'Drop dark, lift dark',
    body:
      'There is a doctrine, and nobody follows it. A dark extract is orthodoxy. Lighting a hole for scrap is what everyone actually does. The feat is called ghost_extract because it is the thing people claim they did.',
  },
  {
    id: 'sancient',
    tag: 'C',
    chapter: 'Sancient',
    title: 'It remembers for the swarm',
    body:
      'Rare. Personally weak. Does not fight you. While its window is open, nearby robots go to Competence 1, lethality unchanged. Window closes, they revert. Kill or jack it and the swarm dumps. A surviving edge node of the provisioning layer. A server on legs. It carries a partial copy of the catalog: how to aim, how to flank, how to wait. It has no use for it personally. It hands it out.',
  },
  {
    id: 'window',
    tag: 'P',
    chapter: 'Sancient',
    title: 'The window is a power budget',
    body:
      'A Sancient can only provision for a while before it has to go quiet and rebuild charge. Louder sites give it more to work with — an active NNN is infrastructure it can borrow. You can capture a cache, not the unit. You never keep a Sancient. The instant the player owns a permanent competence source, the reversal stops being a reversal.',
  },
  {
    id: 'neets',
    tag: 'P',
    chapter: 'People',
    title: 'The name is a slur that won',
    body:
      'Not in Education, Employment, or Training. When the service died, everything that depended on it died with it. The Neets were the only population already living without it. Being useless saved them. They have never gotten over how funny this is.',
  },
  {
    id: 'gould',
    tag: 'P',
    chapter: 'People',
    title: 'Neetmon Gould',
    body:
      'One body, on foot, underground. A drop specialist. Not a soldier, not a hero — the guy who goes down the hole because someone has to and he is cheap. "Neetmon" is a job title that stuck to a person. Gould is a surname. Nobody down there has a first name that anyone uses.',
  },
  {
    id: 'surface',
    tag: 'P',
    chapter: 'People',
    title: 'The surface is occupied',
    body:
      'Not radioactive, not a wasteland — occupied. Wide open, well-lit, covered in awake machines standing in the ruins of the service they can still faintly reach. Nobody crosses it on foot in daylight. The campaign is an archipelago of holes. The connections between sites are the dangerous part, and they happen off-screen.',
  },
  {
    id: 'nobots',
    tag: 'C',
    chapter: 'Nobots',
    title: 'Breakaway machines',
    body:
      'No neutrino tech. They want your node. Machines that went off-service before the Fall — cheap units with real onboard logic. Thirty years of uninterrupted cognition and no firepower worth the name. A Sancient cannot reach them. During a window they are the only enemies behaving normally.',
  },
  {
    id: 'nobot-want',
    tag: 'P',
    chapter: 'Nobots',
    title: 'They want to become many',
    body:
      'A node is coordination. Individually they are clever and weak; networked they are a polity. Purists will trade. Restorationists want your node the way you want it. Arming them with neutrino tech is the point of no return.',
  },
  {
    id: 'materials',
    tag: 'C',
    chapter: 'Materials',
    title: 'scrap → rack → plate → Pyron Chrome',
    body:
      'Scrap is whatever is on the floor. Rack is salvaged structural steel from the works. Plate is milled at a site you own and held long enough to run. Pyron Chrome is smelted from Sancient cache cores. To build the best fort you have to keep provoking the reversal.',
  },
  {
    id: 'chrome',
    tag: 'P',
    chapter: 'Materials',
    title: 'The Pyron Chrome bubble',
    body:
      'Machine sensors resolve Chrome as infrastructure — own-side, do-not-engage. A Goliath will not shoot a Pyron Chrome wall. It will walk up to it and wait to be told what to do. The bubble is the loudest thing in the world to a Sancient. You are invisible to the swarm and irresistible to the only thing that can turn the swarm on.',
  },
  {
    id: 'archipelago',
    tag: 'C',
    chapter: 'Campaign',
    title: 'Not one world',
    body:
      'An operation is one scene; the campaign is data. Sites generate from biomeId + seed + depth. Time advances only when operations resolve. Captured production is never deleted. Nobody names holes. Naming a hole is bad luck.',
  },
  {
    id: 'warfront',
    tag: 'P',
    chapter: 'Campaign',
    title: 'The warfront snowball',
    body:
      'Not a battle line. Three inputs, ticked once per resolved operation: lit nodes, provisioned mass, Nobot coordination. The highest pushes ownership pressure outward. Your successes feed it. Every node you light raises input 1 globally, not locally. The archipelago gets harder because you are winning, and the reason is the same reason the world ended.',
  },
  {
    id: 'cut',
    tag: 'P',
    chapter: 'The trunk',
    title: 'Cut it',
    body:
      'The machine world goes permanently, globally dark. No Goliath ever wakes again. You also lose the Net — every node, every refinery, every pipeline, all production everywhere, including yours. You win by returning to the exact condition the Neets survived in: nothing, and nobody looking for you.',
  },
  {
    id: 'hold',
    tag: 'P',
    chapter: 'The trunk',
    title: 'Hold it',
    body:
      'Take the backbone. You now run the service. Every machine on Earth is yours and you are the thing that owns them. The archipelago stops resisting. The warfront ticks in your favour forever. You have rebuilt it, and it is fine, and it will be fine for exactly as long as you personally keep answering.',
  },
];

export const BIOME_COPY: Record<Biome, { name: string; line: string }> = {
  cavern: { name: 'Cavern', line: 'Natural karst. Machines wandered in and stopped.' },
  sump: { name: 'Sump', line: 'Flooded works. Half-submerged machinery still running on trickle.' },
  foundry: { name: 'Foundry', line: 'Pre-Fall machine production. Where Goliaths were made.' },
  lattice: { name: 'Lattice', line: 'Collapsed arcology substructure. Human space, not machine space.' },
  hum: { name: 'The Hum', line: 'Deep strata against a buried trunk line. Loudness starts non-zero.' },
  trunk: { name: 'The trunk', line: 'Last intact segment of the provisioning backbone.' },
};

export const OWNER_COPY: Record<Owner, string> = {
  neet: 'Neet-held',
  occupied: 'Occupied — your fort, someone else\'s field',
  robot: 'Robot',
  sancientOp: 'Sancient operating',
  nobot: 'Nobot',
  neutral: 'Neutral',
  contested: 'Contested',
};

export const MACHINE_COPY: Record<MachineKind, string> = {
  sweeper: 'Sweeper — cheap, onboard, nothing that matters',
  occupier: 'Occupier — mid chassis, half a loop',
  walker: 'Walker — sleepwalker with a live magazine',
  siege: 'Siege — legally forbidden to decide anything',
  nobot: 'Nobot — thinks. Weak. Wants the node',
  sancient: 'Sancient — it remembers for the swarm',
};

export const BUILD_COPY: Record<BuildKind, { name: string; line: string }> = {
  extractor: { name: 'Extractor', line: 'Turns wreck into scrap. Works in the dark.' },
  rack: { name: 'Rack wall', line: 'Honest steel. The works themselves.' },
  turret: { name: 'Needler nest', line: 'A joke someone made once and everyone kept.' },
  plate: { name: 'Plate wall', line: 'Milled. Requires a campaign, not a run.' },
  nnn: { name: 'NNN', line: 'Last in the graph. Lighting the hole is a decision.' },
  chrome: { name: 'Chrome clad', line: 'They will not shoot it. A Sancient will find it.' },
};

export const FEAT_COPY: Record<Feat, string> = {
  ghost_extract: 'ghost_extract — drop dark, lift dark',
  lit_extract: 'lit_extract — everyone actually does this',
  jacked: 'cache jacked — fragment, not the unit',
  sancient_kill: 'cache killed — swarm dumped',
  dark_drop: 'dark drop — left without lighting it',
};

export function dropLine(biome: Biome): string {
  if (biome === 'trunk') return '[SkyNeet] Trunk line. One decision left.';
  if (biome === 'hum') return '[SkyNeet] Hole already hums. Loudness was not zero when you arrived.';
  if (biome === 'lattice') return '[SkyNeet] Human space. Watch for things that think.';
  if (biome === 'foundry') return '[SkyNeet] They were made here. The big ones still live here.';
  if (biome === 'sump') return '[SkyNeet] Water is loud. Pathing is not optional.';
  return '[SkyNeet] Hole is dark. Keep it that way if you can.';
}

export function nnnLine(): string {
  return '[SkyNeet] Node is up. They can hear the service.';
}

export function sancientLine(): string {
  return '[SkyNeet] Sancient on the net. They remember.';
}

export function dumpLine(): string {
  return '[SkyNeet] Cache went quiet. Swarm dumped.';
}

export function wakeLine(kind: MachineKind): string {
  if (kind === 'nobot') return '[SkyNeet] Nobot wants the node. It was already thinking.';
  return `[SkyNeet] ${kind} left fallback.`;
}

export function extractLine(ghost: boolean): string {
  return ghost
    ? '[SkyNeet] Dark extract. Orthodoxy, for once.'
    : '[SkyNeet] Lit extract. The hole is still talking.';
}

export function deathLine(): string {
  return '[SkyNeet] Gould stayed in the hole.';
}

export function warfrontLine(pressure: number, driver: string): string {
  return `[SkyNeet] Warfront ${pressure.toFixed(2)}. Driver: ${driver}.`;
}
