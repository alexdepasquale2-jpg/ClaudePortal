/** Canvas icon names. Strokes use currentColor on a 24 px grid. */
export const iconNames = [
  'summon',
  'mic',
  'voice',
  'send',
  'stream',
  'rewind',
  'pulse',
  'egress',
  'egress-out',
  'hive',
  'warden',
  'charter',
  'journal',
  'cortex',
  'settings',
  'prime',
  'forge',
  'files',
  'notes',
  'web',
  'sight',
  'ancestors',
  'allow',
  'ask',
  'deny',
  'observe',
  'act',
  'commit',
] as const;

export type IconName = (typeof iconNames)[number];

/** Seed Bank genome id suffix (`xindoze.prime`) to its icon. */
export const genomeIcon: Record<string, IconName> = {
  prime: 'prime',
  forge: 'forge',
  files: 'files',
  notes: 'notes',
  web: 'web',
  pulse: 'pulse',
  hive: 'hive',
  sight: 'sight',
  ancestors: 'ancestors',
};
