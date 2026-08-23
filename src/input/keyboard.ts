import { emptyIntent, type Intent, type InputSource } from './source';

/** WASD + QE strafe, arrows turn, right-drag orbits, wheel zooms. */
export class KeyboardMouse implements InputSource {
  private keys = new Set<string>();
  private yaw = 0; private pitch = 0; private zoom = 0;
  private dragging = false;
  private handlers: [string, EventTarget, EventListener][] = [];

  constructor(private canvas: HTMLCanvasElement, private onPick: (x: number, y: number, button: number) => void) {
    this.on(window, 'keydown', (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
    });
    this.on(window, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); });
    this.on(window, 'blur', () => this.keys.clear());
    this.on(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    this.on(canvas, 'mousedown', (e: MouseEvent) => {
      if (e.button === 0) this.onPick(e.clientX, e.clientY, 0);
      if (e.button === 2) { this.dragging = true; canvas.requestPointerLock?.(); }
    });
    this.on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button === 2) { this.dragging = false; document.exitPointerLock?.(); }
    });
    this.on(window, 'mousemove', (e: MouseEvent) => {
      if (!this.dragging) return;
      this.yaw -= e.movementX * 0.005;
      this.pitch = Math.max(-0.2, Math.min(1.2, this.pitch + e.movementY * 0.004));
    });
    this.on(canvas, 'wheel', (e: WheelEvent) => { e.preventDefault(); this.zoom += Math.sign(e.deltaY) * 1.2; }, { passive: false });
  }

  private on<E extends Event>(target: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn as EventListener, opts);
    this.handlers.push([type, target, fn as EventListener]);
  }

  poll(): Intent {
    const i = emptyIntent();
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) i.moveZ += 1;
    if (k.has('s') || k.has('arrowdown')) i.moveZ -= 1;
    if (k.has('a') || k.has('arrowleft')) i.yawDelta += 0.05;
    if (k.has('d') || k.has('arrowright')) i.yawDelta -= 0.05;
    if (k.has('q')) i.moveX -= 1;
    if (k.has('e')) i.moveX += 1;
    i.yawDelta += this.yaw; i.pitchDelta += this.pitch;
    i.zoomDelta += this.zoom;
    this.yaw = 0; this.pitch = 0; this.zoom = 0;
    return i;
  }

  dispose() { for (const [type, target, fn] of this.handlers) target.removeEventListener(type, fn); }
}
