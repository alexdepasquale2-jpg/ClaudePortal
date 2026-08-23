import * as THREE from 'three';
import { CLASSES } from '../data/classes';
import { STARTER_ZONE } from '../data/zone.starter';
import { DayNight } from './daynight';
import { GrassField } from './grass';
import { buildCave, buildMob, buildNpc, buildPlayer, buildTrees, buildVillage, setWeaponMesh, type UnitView } from './models';
import { TerrainStreamer, heightAt } from './terrain';
import type { ItemInstance, Unit, World } from '../sim/types';

type Tracked = { view: UnitView; smooth: THREE.Vector3; unitId: number };

export class Renderer {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  yaw = 0; pitch = 0.42; zoom = 12;
  private views = new Map<number, Tracked>();
  private terrain: TerrainStreamer;
  private grass: GrassField;
  private dayNight: DayNight;
  private ray = new THREE.Raycaster();
  private hostileMat = new THREE.Color(0xff5555);
  private lastEquipped = '';

  constructor(private canvas: HTMLCanvasElement, private world: World) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 900);
    this.scene.fog = new THREE.Fog(0x9dc9ef, 90, 340);

    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -60;
    sun.shadow.camera.right = sun.shadow.camera.top = 60;
    const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x4a5a3a, 0.5);
    this.scene.add(sun, sun.target, hemi);
    this.dayNight = new DayNight(this.scene, sun, hemi);

    this.terrain = new TerrainStreamer(this.scene);
    this.grass = new GrassField(500, 34, heightAt);
    this.scene.add(this.grass.mesh);
    this.scene.add(buildVillage(), buildCave(), buildTrees(260, heightAt));

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private viewFor(u: Unit): Tracked {
    let t = this.views.get(u.id);
    if (t) return t;
    const view = u.kind === 'player' ? buildPlayer(CLASSES[u.classId].color)
      : u.kind === 'npc' ? buildNpc(STARTER_ZONE.npcs.find(n => n.id === u.npcDefId)?.color ?? 0xcccccc)
      : buildMob(u);
    this.scene.add(view.root);
    t = { view, smooth: new THREE.Vector3(u.pos.x, heightAt(u.pos.x, u.pos.z), u.pos.z), unitId: u.id };
    this.views.set(u.id, t);
    return t;
  }

  /** alpha is the fraction between the last two sim ticks — the render never writes back to the sim. */
  sync(alpha: number, dt: number) {
    const w = this.world;
    for (const [id, t] of this.views) {
      if (!w.units.has(id)) { this.scene.remove(t.view.root); this.views.delete(id); }
    }
    for (const u of w.units.values()) {
      const t = this.viewFor(u);
      const y = heightAt(u.pos.x, u.pos.z);
      t.smooth.lerp(new THREE.Vector3(u.pos.x, y, u.pos.z), Math.min(1, alpha * 0.35 + dt * 12));
      t.view.root.position.copy(t.smooth);
      t.view.root.rotation.y = u.facing;
      t.view.root.visible = !u.dead;
      if (u.dead) t.view.root.visible = false;
      if (u.kind === 'mob') t.view.root.rotation.z = u.dead ? Math.PI / 2 : 0;
    }

    const p = w.units.get(w.player.unitId)!;
    const pv = this.views.get(p.id)!;
    const mh = w.player.equipped.mainhand;
    const key = mh ? `${mh.itemId}:${mh.suffixId ?? ''}` : 'none';
    if (key !== this.lastEquipped) { setWeaponMesh(pv.view, mh as ItemInstance | undefined); this.lastEquipped = key; }

    this.terrain.update(p.pos.x, p.pos.z);
    this.grass.update(p.pos.x, p.pos.z);
    this.dayNight.update(performance.now());
    this.updateCamera(pv.smooth);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(target: THREE.Vector3) {
    const focus = target.clone().add(new THREE.Vector3(0, 1.6, 0));
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch));
    const want = focus.clone().add(dir.multiplyScalar(this.zoom));
    // Never let the camera sink under the terrain.
    want.y = Math.max(want.y, heightAt(want.x, want.z) + 1.2);
    this.camera.position.lerp(want, 0.35);
    // On a tall portrait screen the HUD owns the bottom third, so aim below the player
    // to push the character up into the clear part of the frame.
    const lift = this.camera.aspect < 0.85 ? 3.4 : 0;
    this.camera.lookAt(focus.x, focus.y - lift, focus.z);
  }

  /** Screen-space projection for DOM nameplates and floating combat text. */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, visible: v.z < 1 };
  }

  unitScreenPos(unitId: number, yOffset = 0) {
    const t = this.views.get(unitId);
    if (!t) return null;
    return this.project(t.smooth.x, t.smooth.y + t.view.height + yOffset, t.smooth.z);
  }

  /** Click/tap picking: raycast the unit roots, nearest wins. */
  pick(clientX: number, clientY: number): number | null {
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const roots: THREE.Object3D[] = [];
    for (const t of this.views.values()) if (t.view.root.visible && t.unitId !== this.world.player.unitId) roots.push(t.view.root);
    const hits = this.ray.intersectObjects(roots, true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !(o.parent instanceof THREE.Scene)) o = o.parent;
    for (const t of this.views.values()) if (t.view.root === o) return t.unitId;
    return null;
  }

  /** Ground point under the cursor, for tap-to-move on touch. */
  pickGround(clientX: number, clientY: number): { x: number; z: number } | null {
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const dir = this.ray.ray.direction, org = this.ray.ray.origin;
    for (let t = 1; t < 300; t += 1.5) {
      const x = org.x + dir.x * t, y = org.y + dir.y * t, z = org.z + dir.z * t;
      if (y <= heightAt(x, z)) return { x, z };
    }
    return null;
  }
}

export { heightAt };
