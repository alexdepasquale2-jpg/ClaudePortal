import { el } from '../ui/store';
import { emptyIntent, type Intent, type InputSource } from './source';

/** Virtual joystick + one-finger camera drag + pinch zoom. Emits the same Intent as the keyboard,
 *  so the sim and camera code have no idea a touchscreen exists. */
export class TouchInput implements InputSource {
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private move = { x: 0, z: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private yaw = 0; private pitch = 0; private zoom = 0;
  private pinch = 0;
  private knob: HTMLElement;
  private layer: HTMLElement;

  constructor(root: HTMLElement, private canvas: HTMLCanvasElement, private onTap: (x: number, y: number) => void, buttons: { label: string; onPress: () => void }[]) {
    this.knob = el('i');
    const stick = el('div#stick', {}, this.knob);
    const btnBox = el('div#touchBtns');
    for (const b of buttons) btnBox.append(el('button', { onclick: b.onPress }, b.label));
    this.layer = el('div#touch', {}, stick, btnBox);
    root.append(this.layer);

    stick.addEventListener('pointerdown', e => {
      this.stickId = e.pointerId;
      const r = stick.getBoundingClientRect();
      this.stickOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      stick.setPointerCapture(e.pointerId);
      this.updateStick(e.clientX, e.clientY);
    });
    stick.addEventListener('pointermove', e => { if (e.pointerId === this.stickId) this.updateStick(e.clientX, e.clientY); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null; this.move = { x: 0, z: 0 };
      this.knob.style.transform = '';
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    let downAt = 0, downPos = { x: 0, y: 0 };
    const active = new Map<number, { x: number; y: number }>();
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (active.size === 1) {
        this.lookId = e.pointerId; this.lookLast = { x: e.clientX, y: e.clientY };
        downAt = performance.now(); downPos = { x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('pointermove', e => {
      if (!active.has(e.pointerId)) return;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (active.size >= 2) {
        const [a, b] = [...active.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.zoom += (this.pinch - d) * 0.03;
        this.pinch = d;
        return;
      }
      if (e.pointerId !== this.lookId) return;
      this.yaw -= (e.clientX - this.lookLast.x) * 0.006;
      this.pitch = Math.max(-0.2, Math.min(1.2, this.pitch + (e.clientY - this.lookLast.y) * 0.005));
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const up = (e: PointerEvent) => {
      if (!active.has(e.pointerId)) return;
      const wasTap = active.size === 1 && performance.now() - downAt < 260 &&
        Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) < 12;
      active.delete(e.pointerId);
      if (active.size < 2) this.pinch = 0;
      if (e.pointerId === this.lookId) this.lookId = null;
      if (wasTap) this.onTap(e.clientX, e.clientY);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  private updateStick(x: number, y: number) {
    const dx = x - this.stickOrigin.x, dy = y - this.stickOrigin.y;
    const max = 52;
    const d = Math.min(max, Math.hypot(dx, dy));
    const a = Math.atan2(dy, dx);
    const nx = Math.cos(a) * d, ny = Math.sin(a) * d;
    this.knob.style.transform = `translate(${nx}px, ${ny}px)`;
    this.move = { x: nx / max, z: -ny / max };
  }

  poll(): Intent {
    const i = emptyIntent();
    i.moveX = this.move.x; i.moveZ = this.move.z;
    i.yawDelta = this.yaw; i.pitchDelta = this.pitch; i.zoomDelta = this.zoom;
    this.yaw = 0; this.pitch = 0; this.zoom = 0;
    return i;
  }

  dispose() { this.layer.remove(); }
}
