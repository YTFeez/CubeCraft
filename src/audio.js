import { BLOCK } from './blocks.js';

// Synthesized sounds with Web Audio API (no assets needed).
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 1;
    this.lastStep = 0;
  }

  _ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      } catch (e) { /* no audio */ }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  _noise(duration, filterFreq, gainValue) {
    this._ensure();
    if (!this.ctx) return;
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    src.connect(filter).connect(gain).connect(this.master || ctx.destination);
    src.start();
    src.stop(ctx.currentTime + duration);
  }

  _tone(freq, duration, type = 'sine', gainValue = 0.15) {
    this._ensure();
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(this.master || ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  playBreak(id) {
    if (id === BLOCK.STONE || id === BLOCK.BEDROCK) {
      this._noise(0.25, 1400, 0.35);
      this._tone(90, 0.12, 'square', 0.1);
    } else if (id === BLOCK.WOOD || id === BLOCK.PLANKS) {
      this._tone(180, 0.12, 'square', 0.2);
      this._noise(0.18, 900, 0.2);
    } else if (id === BLOCK.GLASS) {
      this._tone(2200, 0.08, 'triangle', 0.2);
      this._tone(1500, 0.12, 'triangle', 0.12);
    } else if (id === BLOCK.LEAVES) {
      this._noise(0.16, 4000, 0.2);
    } else {
      this._noise(0.2, 600, 0.3);
    }
  }

  playPlace(id) {
    if (id === BLOCK.GLASS) this._tone(1200, 0.06, 'triangle', 0.15);
    else if (id === BLOCK.STONE) this._noise(0.12, 1200, 0.25);
    else this._noise(0.12, 700, 0.25);
  }

  playStep() {
    const now = performance.now();
    if (now - this.lastStep < 340) return;
    this.lastStep = now;
    this._noise(0.08, 500, 0.12);
  }

  setVolume(v01) {
    this.volume = Math.max(0, Math.min(1, Number(v01) || 0));
    if (this.master && this.ctx) this.master.gain.setValueAtTime(this.volume, this.ctx.currentTime);
  }
}
