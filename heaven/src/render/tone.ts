// A bed of room tone: far air, no hymn. Never started on its own.

export class RoomTone {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  playing = false;

  private build(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const seconds = 6;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    // Brown noise: a far room with air moving in it.
    let last = 0;
    for (let i = 0; i < ch.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      ch[i] = last * 3.2;
    }
    // Crossfade the loop seam.
    const fade = Math.floor(ctx.sampleRate * 0.5);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      ch[i] = ch[i]! * t + ch[ch.length - fade + i]! * (1 - t);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopEnd = seconds - 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const air = ctx.createGain();
    air.gain.value = 0.05;
    // Slow swell, like breath through a window.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain).connect(air.gain);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(lp).connect(air).connect(gain).connect(ctx.destination);
    src.start();
    lfo.start();
    this.ctx = ctx;
    this.gain = gain;
  }

  set(on: boolean): void {
    if (on === this.playing) return;
    if (on && !this.ctx) this.build();
    if (!this.ctx || !this.gain) return;
    void this.ctx.resume();
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(on ? 1 : 0, t + 1.6);
    this.playing = on;
  }
}
