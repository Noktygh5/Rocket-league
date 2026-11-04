import { settings } from './settings';

/** All sound is synthesised with WebAudio; there are no audio files. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engine: { osc1: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private boostNode: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private crowd: { gain: GainNode } | null = null;
  private noiseBuf: AudioBuffer | null = null;

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = settings.volume;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const n = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    // engine
    const osc1 = this.ctx.createOscillator(); osc1.type = 'sawtooth';
    const osc2 = this.ctx.createOscillator(); osc2.type = 'square';
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 500;
    const gain = this.ctx.createGain(); gain.gain.value = 0;
    osc1.connect(filter); osc2.connect(filter); filter.connect(gain); gain.connect(this.master);
    osc1.start(); osc2.start();
    this.engine = { osc1, osc2, gain, filter };

    // boost whoosh (looping filtered noise)
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bf = this.ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 900; bf.Q.value = 0.8;
    const bg = this.ctx.createGain(); bg.gain.value = 0;
    src.connect(bf); bf.connect(bg); bg.connect(this.master); src.start();
    this.boostNode = { src, gain: bg, filter: bf };

    // crowd murmur
    const cs = this.ctx.createBufferSource(); cs.buffer = this.noiseBuf; cs.loop = true;
    const cf = this.ctx.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 600;
    const cg = this.ctx.createGain(); cg.gain.value = 0.05;
    cs.connect(cf); cf.connect(cg); cg.connect(this.master); cs.start();
    this.crowd = { gain: cg };
  }

  setVolume(v: number): void { if (this.ctx) this.master.gain.value = v; }
  /** Pausing stops every sound (engine, boost, crowd, effects); resuming brings them back. */
  setPaused(p: boolean): void { if (this.ctx) void (p ? this.ctx.suspend() : this.ctx.resume()); }

  /** Continuous sounds. `speed` in uu/s. */
  update(speed: number, boosting: boolean, throttle: number, inAir: boolean): void {
    if (!this.ctx || !this.engine || !this.boostNode) return;
    const t = this.ctx.currentTime;
    const f = 55 + Math.min(2300, speed) * 0.09 + (throttle > 0 ? 18 : 0);
    this.engine.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.engine.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engine.filter.frequency.setTargetAtTime(350 + Math.min(2300, speed) * 0.5, t, 0.08);
    this.engine.gain.gain.setTargetAtTime(inAir ? 0.04 : 0.07 + Math.min(1, speed / 2300) * 0.07, t, 0.1);
    this.boostNode.gain.gain.setTargetAtTime(boosting ? 0.22 : 0, t, 0.04);
    this.boostNode.filter.frequency.setTargetAtTime(700 + Math.min(2300, speed) * 0.4, t, 0.1);
  }

  silenceLoops(): void {
    if (!this.ctx || !this.engine || !this.boostNode) return;
    const t = this.ctx.currentTime;
    this.engine.gain.gain.setTargetAtTime(0, t, 0.05);
    this.boostNode.gain.gain.setTargetAtTime(0, t, 0.05);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, delay = 0, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx || !this.noiseBuf) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  ballHit(speed: number): void {
    const v = Math.min(1, speed / 3000);
    this.tone(180 + v * 140, 0.14, 'sine', 0.25 + v * 0.5, 60);
    this.noise(0.08, 0.15 + v * 0.35, 1800, 0.7);
  }
  wallHit(speed: number): void {
    const v = Math.min(1, speed / 3000);
    if (v < 0.06) return;
    this.tone(120, 0.12, 'triangle', 0.12 + v * 0.3, 50);
  }
  padPickup(large: boolean): void {
    this.tone(large ? 520 : 760, 0.12, 'square', 0.1, large ? 1040 : 1140);
    if (large) this.tone(780, 0.18, 'square', 0.08, 1560, 0.06);
  }
  jump(): void { this.tone(260, 0.12, 'square', 0.08, 520); }
  flip(): void { this.tone(340, 0.18, 'sawtooth', 0.07, 700); this.noise(0.14, 0.08, 2200, 1); }
  demo(): void { this.noise(0.6, 0.5, 400, 0.5, 0, 'lowpass'); this.tone(90, 0.5, 'sawtooth', 0.35, 30); }
  goal(): void {
    for (let i = 0; i < 2; i++) {
      this.tone(220, 0.9, 'sawtooth', 0.22, 215, i * 0.05);
      this.tone(330, 0.9, 'square', 0.1, 322, i * 0.05);
    }
    this.noise(1.6, 0.22, 900, 0.4, 0.1);
    if (this.crowd && this.ctx) {
      const t = this.ctx.currentTime;
      this.crowd.gain.gain.cancelScheduledValues(t);
      this.crowd.gain.gain.setValueAtTime(0.05, t);
      this.crowd.gain.gain.linearRampToValueAtTime(0.35, t + 0.4);
      this.crowd.gain.gain.linearRampToValueAtTime(0.05, t + 4);
    }
  }
  beep(final: boolean): void { this.tone(final ? 880 : 520, final ? 0.5 : 0.16, 'square', 0.12); }
  boostEmpty(): void { this.tone(140, 0.08, 'square', 0.05); }
}
