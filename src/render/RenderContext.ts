import * as THREE from 'three';
import type { QualityTier } from '@core/data/settings/QualityTiers';
import type { Renderable } from '@core/time/RunClock';

/**
 * The WebGL renderer, the scene graph root, and the active camera.
 *
 * One canvas, one renderer, for the whole application — creating a second is the usual cause of
 * "the game runs fine for a minute". Scenes swap their contents in and out of `scene`; they do not
 * swap the renderer.
 *
 * Quality tier is applied here rather than negotiated per-object, so there is exactly one place
 * where a phone differs from a desktop in what it draws (ADR-0005).
 */
export class RenderContext implements Renderable {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();

  private activeCamera: THREE.PerspectiveCamera;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private quality: QualityTier,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxPixelRatio));
    this.renderer.shadowMap.enabled = quality.shadows !== 'off';
    if (quality.shadows === 'soft') this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.activeCamera = new THREE.PerspectiveCamera(45, 1, 0.1, quality.drawDistance);
    this.scene.fog = new THREE.Fog(0x0b0d0f, quality.drawDistance * 0.4, quality.drawDistance);

    this.resize();
  }

  get camera(): THREE.PerspectiveCamera {
    return this.activeCamera;
  }

  get qualityTier(): QualityTier {
    return this.quality;
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.activeCamera = camera;
    this.resize();
  }

  applyQuality(quality: QualityTier): void {
    this.quality = quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxPixelRatio));
    this.renderer.shadowMap.enabled = quality.shadows !== 'off';
    this.activeCamera.far = quality.drawDistance;
    this.activeCamera.updateProjectionMatrix();
  }

  /** Start tracking canvas size. Mobile browsers resize on scroll, so this is not optional. */
  observeResize(): void {
    if (this.resizeObserver) return;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.activeCamera.aspect = width / height;
    this.activeCamera.updateProjectionMatrix();
  }

  render(_alpha: number): void {
    this.renderer.render(this.scene, this.activeCamera);
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer.dispose();
  }
}
