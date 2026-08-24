import * as THREE from 'three';
import type { QualityTier } from '@core/data/settings/QualityTiers';

/**
 * Builds the Three.js object graph for one operation's site.
 *
 * The Unity spec had prefabs; on the web a prefab is a factory function. This is where a generated
 * site becomes geometry — and it is deliberately the only place, so that "one operation = one
 * scene" has a single enforcement point (ARCHITECTURE.md).
 *
 * It takes a quality tier because on a phone the site is built with fewer spawn points and less
 * decorative geometry, rather than being built at full density and culled afterwards.
 */
export interface SiteSceneHandles {
  readonly root: THREE.Group;
  readonly ground: THREE.Mesh;
  dispose(): void;
}

export class SiteSceneBuilder {
  constructor(private readonly quality: QualityTier) {}

  /** Minimal lit environment: enough to confirm the renderer is alive before a site exists. */
  buildPlaceholder(): SiteSceneHandles {
    const root = new THREE.Group();
    root.name = 'site-placeholder';

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = this.quality.shadows !== 'off';
    root.add(ground);

    const key = new THREE.DirectionalLight(0xfff0dd, 1.1);
    key.position.set(18, 34, 12);
    key.castShadow = this.quality.shadows !== 'off';
    root.add(key);

    root.add(new THREE.AmbientLight(0x3b4650, 0.55));
    root.add(new THREE.GridHelper(120, 40, 0x2a3138, 0x1d2227));

    return {
      root,
      ground,
      dispose(): void {
        ground.geometry.dispose();
        (ground.material as THREE.Material).dispose();
        root.clear();
      },
    };
  }

  /** Build the real site geometry from a generated layout. */
  build(_layout: unknown): SiteSceneHandles {
    // TODO: implement per DESIGN.md — consume SiteGenerator output, instance geometry within the
    // quality tier's budgets, and never allocate per-frame afterwards.
    throw new Error('SiteSceneBuilder.build not implemented');
  }
}
