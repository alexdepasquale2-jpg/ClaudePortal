import * as THREE from 'three';
import { STARTER_ZONE } from '../data/zone.starter';
import { grassTexture, dirtTexture, rockTexture } from './atlas';

const SEED = STARTER_ZONE.seed;
const hash = (x: number, z: number) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ SEED;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t: number) => t * t * (3 - 2 * t);
function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  const u = smooth(xf), v = smooth(zf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** The single source of ground height. Sim is 2D; y is purely visual. */
export function heightAt(x: number, z: number): number {
  let h = 0, amp = 1, freq = 1 / 90;
  for (let o = 0; o < 4; o++) { h += valueNoise(x * freq, z * freq) * amp; amp *= 0.5; freq *= 2.1; }
  h = (h - 0.7) * 14;
  // The village sits on a flattened shelf so buildings and NPCs never float.
  const dv = Math.hypot(x, z);
  if (dv < 46) h *= Math.max(0, (dv - 22) / 24);
  // A basin around the cave mouth, so it reads as dug into the hill.
  const dc = Math.hypot(x - 122, z + 96);
  if (dc < 26) h -= (1 - dc / 26) * 7;
  return h;
}

export function normalAt(x: number, z: number): THREE.Vector3 {
  const e = 1.2;
  return new THREE.Vector3(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

const CHUNK = 50, RES = 24;

/** Vertex colours splat grass/dirt/rock by slope and height; roads paint dirt along their spline. */
function splatColor(x: number, z: number, slope: number, out: THREE.Color) {
  const roadDist = distToRoads(x, z);
  if (roadDist < 3.2) { out.setHex(0x8a7657); return; }
  if (slope > 0.45) { out.setHex(0x6e6e73); return; }
  const n = valueNoise(x / 17, z / 17);
  out.setHex(n > 0.55 ? 0x5f8f3f : n > 0.35 ? 0x4b7a34 : 0x3f6c2c);
  if (roadDist < 5.5) out.lerp(new THREE.Color(0x8a7657), 1 - (roadDist - 3.2) / 2.3);
}

function distToRoads(x: number, z: number): number {
  let best = Infinity;
  for (const road of STARTER_ZONE.roads) {
    for (let i = 0; i < road.length - 1; i++) {
      const a = road[i], b = road[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
    }
  }
  return best;
}

export function buildChunk(cx: number, cz: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, RES, RES);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx * CHUNK, z = pos.getZ(i) + cz * CHUNK;
    pos.setY(i, heightAt(x, z));
    const n = normalAt(x, z);
    splatColor(x, z, 1 - n.y, c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, terrainMaterial());
  mesh.position.set(cx * CHUNK, 0, cz * CHUNK);
  mesh.receiveShadow = true;
  return mesh;
}

let mat: THREE.Material | null = null;
function terrainMaterial() {
  if (mat) return mat;
  const tex = new THREE.CanvasTexture(grassTexture());
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(CHUNK / 4, CHUNK / 4);
  mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
  return mat;
}

/** Chunks stream in and out around the player instead of one giant mesh. */
export class TerrainStreamer {
  private loaded = new Map<string, THREE.Mesh>();
  constructor(private scene: THREE.Scene, private radius = 4) {}
  update(x: number, z: number) {
    const cx = Math.round(x / CHUNK), cz = Math.round(z / CHUNK);
    const want = new Set<string>();
    for (let i = -this.radius; i <= this.radius; i++)
      for (let j = -this.radius; j <= this.radius; j++) {
        if (i * i + j * j > this.radius * this.radius + 1) continue;
        const key = `${cx + i},${cz + j}`;
        want.add(key);
        if (!this.loaded.has(key)) {
          const m = buildChunk(cx + i, cz + j);
          this.scene.add(m); this.loaded.set(key, m);
        }
      }
    for (const [key, m] of this.loaded) {
      if (want.has(key)) continue;
      this.scene.remove(m); m.geometry.dispose(); this.loaded.delete(key);
    }
  }
}

export { CHUNK, dirtTexture, rockTexture, distToRoads };
