import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ITEMS } from '../data/items';
import { MOBS } from '../data/mobs';
import type { ItemInstance, Unit } from '../sim/types';

const mobGeoCache = new Map<string, THREE.BufferGeometry>();
const mobMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

const mat = (color: number, flat = false) =>
  new THREE.MeshLambertMaterial({ color, flatShading: flat });

function capsule(h: number, r: number, color: number) {
  const g = new THREE.CapsuleGeometry(r, h, 4, 8);
  const m = new THREE.Mesh(g, mat(color));
  m.castShadow = true;
  return m;
}

export type UnitView = {
  root: THREE.Group;
  weapon: THREE.Group;
  bodyColor: THREE.MeshLambertMaterial;
  height: number;
};

export function buildPlayer(classColor: number): UnitView {
  const root = new THREE.Group();
  const body = capsule(0.9, 0.34, classColor);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), mat(0xe8c39e));
  head.position.y = 1.75; head.castShadow = true;
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 8), mat(0x333a55));
  cloak.position.set(0, 1.05, -0.18);
  const weapon = new THREE.Group();
  weapon.position.set(0.42, 1.05, 0.12);
  root.add(body, head, cloak, weapon);
  return { root, weapon, bodyColor: body.material as THREE.MeshLambertMaterial, height: 2.1 };
}

/** Equipping swaps this mesh — that is the visible payoff for a green sword. */
export function setWeaponMesh(view: UnitView, inst: ItemInstance | undefined) {
  view.weapon.clear();
  if (!inst) return;
  const def = ITEMS[inst.itemId];
  if (!def.weapon) return;
  const color = def.color ?? 0xaaaaaa;
  const kind = def.weapon.kind;
  const g = new THREE.Group();
  if (kind === 'staff' || kind === 'wand') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, kind === 'staff' ? 1.9 : 0.6, 6), mat(color));
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), mat(color, true));
    orb.position.y = (kind === 'staff' ? 1.9 : 0.6) / 2 + 0.1;
    g.add(shaft, orb);
    g.rotation.z = -0.25;
  } else {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.05, 0.02), mat(color));
    blade.position.y = 0.62;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.07), mat(0x6b5a3c));
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.28, 6), mat(0x3b2f22));
    grip.position.y = -0.16;
    g.add(blade, guard, grip);
    g.rotation.z = -0.35;
    // Uncommon+ weapons glow faintly so the upgrade reads at a glance.
    if (def.quality === 'uncommon' || def.quality === 'rare') {
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.06),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28 }));
      glow.position.y = 0.62;
      g.add(glow);
    }
  }
  view.weapon.add(g);
}

/** Each mob is merged down to a single geometry — one draw call per mob, colours baked
 *  into the vertices — so a screen full of them costs calls in the dozens, not the hundreds. */
export function buildMob(u: Unit): UnitView {
  const def = MOBS[u.defId];
  const s = def.scale;
  const parts: [THREE.BufferGeometry, number][] = [];
  const push = (g: THREE.BufferGeometry, color: number, pos: [number, number, number], rot?: [number, number, number]) => {
    if (rot) { g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]); }
    g.translate(pos[0], pos[1], pos[2]);
    parts.push([g, color]);
  };
  const body = () => new THREE.CapsuleGeometry(0.4 * s, 0.7 * s, 4, 8);

  switch (def.shape) {
    case 'boar': case 'wolf': {
      push(body(), def.color, [0, 0.55 * s, 0], [Math.PI / 2, 0, 0]);
      push(new THREE.ConeGeometry(0.22 * s, 0.5 * s, 6), def.color, [0, 0.55 * s, 0.75 * s], [Math.PI / 2, 0, 0]);
      push(new THREE.BoxGeometry(0.6 * s, 0.5 * s, 0.9 * s), 0x2e2418, [0, 0.25 * s, 0]);
      if (def.shape === 'wolf')
        push(new THREE.ConeGeometry(0.1 * s, 0.6 * s, 5), def.color, [0, 0.8 * s, -0.75 * s], [-Math.PI / 2.6, 0, 0]);
      break;
    }
    case 'spider': {
      push(body(), def.color, [0, 0.5 * s, 0], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        push(new THREE.CylinderGeometry(0.04 * s, 0.03 * s, 1.0 * s, 4), 0x1d1a26,
          [Math.cos(a) * 0.5 * s, 0.42 * s, Math.sin(a) * 0.5 * s], [Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9]);
      }
      break;
    }
    default: {
      push(body(), def.color, [0, 0.9 * s, 0]);
      push(new THREE.SphereGeometry(0.26 * s, 8, 6), def.color, [0, 1.6 * s, 0]);
      push(new THREE.ConeGeometry(0.14 * s, 0.42 * s, 5), 0xd8d2c0, [0, 1.9 * s, 0]);
      push(new THREE.BoxGeometry(0.1 * s, 0.8 * s, 0.1 * s), 0x4a3a26, [0.38 * s, 1.0 * s, 0], [0, 0, -0.4]);
    }
  }

  const c = new THREE.Color();
  for (const [g, color] of parts) {
    c.setHex(color);
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
  }
  // All mobs of a type share one geometry and one material.
  let merged = mobGeoCache.get(u.defId);
  if (!merged) {
    merged = mergeGeometries(parts.map(([g]) => g), false)!;
    mobGeoCache.set(u.defId, merged);
  }
  for (const [g] of parts) g.dispose();

  const mesh = new THREE.Mesh(merged, mobMaterial);
  mesh.castShadow = true;
  const root = new THREE.Group();
  root.add(mesh);
  return { root, weapon: new THREE.Group(), bodyColor: mobMaterial, height: 2 * s };
}

export function buildNpc(color: number): UnitView {
  const view = buildPlayer(color);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4, 8), mat(0x2b2b3a));
  hat.position.y = 2.0;
  view.root.add(hat);
  return view;
}

/** Village geometry: primitives only, arranged so the place reads as a settlement. */
export function buildVillage(): THREE.Group {
  const g = new THREE.Group();
  const house = (x: number, z: number, w: number, d: number, h: number, wall: number, roof: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(wall));
    b.position.set(x, h / 2, z); b.castShadow = b.receiveShadow = true;
    const r = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, h * 0.7, 4), mat(roof, true));
    r.position.set(x, h + h * 0.35, z); r.rotation.y = Math.PI / 4; r.castShadow = true;
    g.add(b, r);
  };
  house(-16, 2, 10, 8, 4.2, 0xb9a184, 0x8a3b2e);   // inn
  house(-6, 18, 7, 6, 3.4, 0xb9a184, 0x4a5f7a);    // vendor stall
  house(18, 12, 8, 7, 3.8, 0xa8926f, 0x5a4a3a);    // forge
  house(6, -14, 7, 6, 3.4, 0xb9a184, 0x6a5a3a);    // barracks
  const well = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 1.1, 12), mat(0x7a7a80));
  well.position.set(0, 0.55, 2); g.add(well);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 5), mat(0x6b5334));
    post.position.set(Math.cos(a) * 30, 0.65, Math.sin(a) * 30);
    g.add(post);
  }
  return g;
}

export function buildCave(): THREE.Group {
  const g = new THREE.Group();
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x4a4048, true));
  mouth.scale.set(1, 0.8, 1);
  mouth.position.set(122, 0, -96);
  g.add(mouth);
  for (let i = 0; i < 22; i++) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + Math.random() * 2.4, 0), mat(0x5b5560, true));
    const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 16;
    r.position.set(122 + Math.cos(a) * d, 0.4, -96 + Math.sin(a) * d);
    r.castShadow = true;
    g.add(r);
  }
  return g;
}

export function buildTrees(count: number, heightAt: (x: number, z: number) => number): THREE.Group {
  const g = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 3.4, 5);
  const leafGeo = new THREE.ConeGeometry(2.0, 4.4, 6);
  const trunkMat = mat(0x4a3524), leafMat = mat(0x2f5e2a, true);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < count * 4 && n < count; i++) {
    const x = (Math.random() - 0.5) * 420, z = (Math.random() - 0.5) * 420;
    if (Math.hypot(x, z) < 44) continue;             // keep the village clear
    if (Math.hypot(x - 122, z + 96) < 26) continue;  // keep the cave mouth clear
    const y = heightAt(x, z);
    const s = 0.75 + Math.random() * 0.7;
    m.makeScale(s, s, s); m.setPosition(x, y + 1.7 * s, z); trunks.setMatrixAt(n, m);
    m.makeScale(s, s, s); m.setPosition(x, y + 4.6 * s, z); leaves.setMatrixAt(n, m);
    n++;
  }
  trunks.count = leaves.count = n;
  trunks.castShadow = leaves.castShadow = true;
  g.add(trunks, leaves);
  return g;
}
