import * as THREE from 'three';

/**
 * Shared materials.
 *
 * Cached and reused: a Survivors spine puts hundreds of identical things on screen, and a material
 * per instance is both a memory cost and a draw-call cost that a phone will not absorb.
 *
 * Faction colours live here rather than in the UI layer because they are used by both the world and
 * the region map, and the two must agree — a site that reads as "theirs" on the map has to read as
 * "theirs" in the hole.
 */
export const FACTION_COLORS = {
  Neet: 0x6fd3c7,
  Goliath: 0xd4762f,
  Sancient: 0xb14fd8,
  Nobot: 0xc9c545,
  Unowned: 0x5b6067,
} as const;

const cache = new Map<string, THREE.Material>();

function cached<T extends THREE.Material>(key: string, create: () => T): T {
  const existing = cache.get(key);
  if (existing) return existing as T;
  const created = create();
  cache.set(key, created);
  return created;
}

export const factionMaterial = (faction: keyof typeof FACTION_COLORS): THREE.MeshStandardMaterial =>
  cached(
    `faction:${faction}`,
    () =>
      new THREE.MeshStandardMaterial({
        color: FACTION_COLORS[faction],
        roughness: 0.7,
        metalness: 0.3,
      }),
  );

/** Translucent material for un-solidified building ghosts. */
export const ghostMaterial = (valid: boolean): THREE.MeshStandardMaterial =>
  cached(
    `ghost:${valid}`,
    () =>
      new THREE.MeshStandardMaterial({
        color: valid ? 0x6fd3c7 : 0xd8484f,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
  );

export const solidifiedMaterial = (): THREE.MeshStandardMaterial =>
  cached(
    'solidified',
    () => new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.85, metalness: 0.45 }),
  );

/** Emissive material for a lit NNN. Lighting one should be visible from across the site. */
export const litNodeMaterial = (): THREE.MeshStandardMaterial =>
  cached(
    'node:lit',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x6fd3c7,
        emissive: 0x2fa89a,
        emissiveIntensity: 2,
        roughness: 0.4,
      }),
  );

export const darkNodeMaterial = (): THREE.MeshStandardMaterial =>
  cached(
    'node:dark',
    () => new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.9, metalness: 0.2 }),
  );

export function disposeMaterialCache(): void {
  for (const material of cache.values()) material.dispose();
  cache.clear();
}
