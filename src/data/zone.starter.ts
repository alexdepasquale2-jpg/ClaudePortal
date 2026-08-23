import type { ZoneDef } from '../sim/types';

// Hearthglen Rest: ~500m across. Village at origin, boars east, wolves north, kobold cave southeast.
export const STARTER_ZONE: ZoneDef = {
  id: 'hearthglen', name: 'Hearthglen Rest', seed: 20240613, size: 500,
  npcs: [
    { id: 'marshal_hale', name: 'Marshal Hale', title: 'Militia Captain', x: 6, z: -10, roles: ['quest'], color: 0xb03030 },
    { id: 'innkeeper_bell', name: 'Innkeeper Bell', title: 'Innkeeper', x: -14, z: 4, roles: ['innkeeper', 'quest'], color: 0xd8a05a },
    { id: 'trainer_varn', name: 'Varn Ironquill', title: 'Class Trainer', x: 16, z: 12, roles: ['trainer', 'quest'], trainerClass: 'any', color: 0x4a70c0 },
    { id: 'vendor_pike', name: 'Merchant Pike', title: 'General Goods', x: -6, z: 16, roles: ['vendor'], color: 0x60a060,
      vendorItems: ['tough_jerky', 'refreshing_water', 'worn_boots', 'recruits_vest', 'apprentice_robe', 'rusty_sword', 'tough_leather_gloves'] },
  ],
  spawns: [
    { id: 's_boar_1', mobId: 'boar', x: 62, z: -8, radius: 26, count: 9 },
    { id: 's_boar_2', mobId: 'boar', x: 96, z: 26, radius: 24, count: 7 },
    { id: 's_boar_elder', mobId: 'boar_elder', x: 104, z: -18, radius: 18, count: 3 },
    { id: 's_wolf_1', mobId: 'wolf', x: 10, z: -78, radius: 30, count: 8 },
    { id: 's_wolf_2', mobId: 'wolf', x: -52, z: -92, radius: 26, count: 6 },
    { id: 's_spider', mobId: 'spider', x: 130, z: -104, radius: 16, count: 5 },
    { id: 's_kobold_1', mobId: 'kobold', x: 112, z: -88, radius: 20, count: 8 },
    { id: 's_kobold_2', mobId: 'kobold', x: 132, z: -76, radius: 18, count: 6 },
    { id: 's_kobold_geo', mobId: 'kobold_geomancer', x: 124, z: -100, radius: 14, count: 4 },
    { id: 's_kobold_boss', mobId: 'kobold_overseer', x: 138, z: -110, radius: 4, count: 1 },
  ],
  roads: [
    [{ x: -60, z: 20 }, { x: 0, z: 0 }, { x: 60, z: -8 }, { x: 120, z: -70 }],
    [{ x: 0, z: 0 }, { x: 8, z: -60 }, { x: 4, z: -120 }],
  ],
  pois: [
    { name: 'Hearthglen Rest', x: 0, z: 0, kind: 'village' },
    { name: 'Boar Fields', x: 80, z: 8, kind: 'wild' },
    { name: 'Timber Line', x: 0, z: -84, kind: 'wild' },
    { name: 'Candlerock Cave', x: 122, z: -96, kind: 'cave' },
  ],
};
