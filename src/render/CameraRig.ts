import * as THREE from 'three';
import type { CameraPreset } from '@core/data/tech/CameraPresets';
import { damp } from '@core/utilities/MathHelpers';
import type { Vec3 } from '@core/types/Vocabulary';

/**
 * Positions the camera for one view mode from a CameraPreset.
 *
 * There is one pawn and one camera; switching views swaps which rig is driving it. That is why the
 * three views are three rigs rather than three cameras — the design says "one pawn, three
 * live-switchable views", and a switch that changed cameras would let them drift apart.
 *
 * Smoothing is frame-rate independent (MathHelpers.damp) because the same rig runs at 60fps on a
 * desktop and at whatever a phone manages.
 */
export class CameraRig {
  private readonly target = new THREE.Vector3();
  private yaw = 0;
  private pitchOffset = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private preset: CameraPreset,
  ) {
    this.applyPreset(preset);
  }

  get activePreset(): CameraPreset {
    return this.preset;
  }

  applyPreset(preset: CameraPreset): void {
    this.preset = preset;
    this.camera.fov = preset.fieldOfView;
    this.camera.updateProjectionMatrix();
  }

  /** Look direction, driven by manual aim in third/first person. Ignored by the top-down rig. */
  setLook(yaw: number, pitchOffset: number): void {
    this.yaw = yaw;
    this.pitchOffset = pitchOffset;
  }

  /** Move the camera toward where the preset says it belongs relative to the pawn. */
  follow(pawnPosition: Vec3, dt: number): void {
    const preset = this.preset;
    this.target.set(pawnPosition.x, pawnPosition.y, pawnPosition.z);

    const pitch = THREE.MathUtils.degToRad(preset.pitchDegrees) + this.pitchOffset;
    const horizontal = Math.cos(pitch) * preset.distance;

    const desiredX = this.target.x - Math.sin(this.yaw) * horizontal;
    const desiredZ = this.target.z - Math.cos(this.yaw) * horizontal;
    const desiredY = this.target.y + preset.height + Math.sin(pitch) * preset.distance;

    if (preset.followSmoothing <= 0) {
      this.camera.position.set(desiredX, desiredY, desiredZ);
    } else {
      this.camera.position.set(
        damp(this.camera.position.x, desiredX, preset.followSmoothing, dt),
        damp(this.camera.position.y, desiredY, preset.followSmoothing, dt),
        damp(this.camera.position.z, desiredZ, preset.followSmoothing, dt),
      );
    }

    if (preset.distance === 0) {
      // First person: look along the aim direction rather than at the pawn we are inside.
      this.camera.rotation.set(this.pitchOffset, this.yaw, 0, 'YXZ');
    } else {
      this.camera.lookAt(this.target);
    }
  }
}
