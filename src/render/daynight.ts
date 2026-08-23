import * as THREE from 'three';
import { DAY_LENGTH_MS } from '../data/formulas';

const DAY = new THREE.Color(0x9dc9ef), DUSK = new THREE.Color(0xd98a4a), NIGHT = new THREE.Color(0x1b2440);

export class DayNight {
  constructor(private scene: THREE.Scene, private sun: THREE.DirectionalLight, private hemi: THREE.HemisphereLight) {}
  /** t is milliseconds of game time; one full cycle is DAY_LENGTH_MS. */
  update(t: number) {
    // Start at midday so the first thing anyone sees is a lit world, not midnight.
    const phase = (((t + DAY_LENGTH_MS * 0.25) % DAY_LENGTH_MS) / DAY_LENGTH_MS) * Math.PI * 2;
    const elev = Math.sin(phase);
    this.sun.position.set(Math.cos(phase) * 120, elev * 120, 40);
    // Night never goes fully black — an unplayably dark screen is not atmosphere.
    this.sun.intensity = Math.max(0, elev) * 0.85 + 0.18;
    const sky = new THREE.Color();
    if (elev > 0.25) sky.copy(DAY);
    else if (elev > -0.05) sky.copy(NIGHT).lerp(DUSK, (elev + 0.05) / 0.3).lerp(DAY, Math.max(0, elev / 0.25));
    else sky.copy(NIGHT);
    this.scene.background = sky;
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.hemi.intensity = 0.55 + Math.max(0, elev) * 0.45;
  }
  static hour(t: number) { return Math.floor(((t % DAY_LENGTH_MS) / DAY_LENGTH_MS) * 24); }
}
