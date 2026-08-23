import * as THREE from 'three';

/** 500 instanced blades around the player, recycled as you move — never reallocated. */
export class GrassField {
  mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private origin = new THREE.Vector2(1e9, 1e9);
  constructor(private count: number, private radius: number, private heightAt: (x: number, z: number) => number) {
    // A tapered blade, not a textured quad: no transparency cost, no paper look.
    const geo = new THREE.ConeGeometry(0.09, 0.55, 3, 1, true);
    geo.translate(0, 0.27, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x54832f, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = true;
  }
  update(px: number, pz: number) {
    if (Math.hypot(px - this.origin.x, pz - this.origin.y) < this.radius * 0.35) return;
    this.origin.set(px, pz);
    for (let i = 0; i < this.count; i++) {
      const a = (i * 2.399963) % (Math.PI * 2), r = Math.sqrt(i / this.count) * this.radius;
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      this.v.set(x, this.heightAt(x, z), z);
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a * 3.7);
      this.s.setScalar(0.7 + ((i * 37) % 11) / 14);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
