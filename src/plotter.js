import { buildProceduralLines } from './model.js';

export class Plotter {
  constructor(canvas, onProgress = () => {}, onStatus = () => {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onProgress = onProgress;
    this.onStatus = onStatus;
    this.lines = buildProceduralLines(canvas);
    this.index = 0;
    this.running = false;
    this.paused = false;
    this.lineDuration = 3600;
    this.gapDuration = 420;
    this.sound = true;
    this.phase = 'line';
    this.lineElapsed = 0;
    this.gapElapsed = 0;
    this.lastFrame = 0;
    this.raf = 0;
    this.audio = null;
    this.renderScale = Math.min(canvas.width, canvas.height) / 1000;
    this.clear();
  }

  setLines(lines) {
    this.lines = Array.isArray(lines) && lines.length ? lines : buildProceduralLines(this.canvas);
    this.renderScale = Math.min(this.canvas.width, this.canvas.height) / 1000;
    this.reset();
  }

  clear() {
    const c = this.ctx;
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.onProgress(0, this.lines.length);
    this.onStatus('Ready');
  }

  _initAudio() {
    if (!this.sound || this.audio) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    this.audio = new AudioContextClass();
    this.motor = this.audio.createOscillator();
    this.filter = this.audio.createBiquadFilter();
    this.gain = this.audio.createGain();
    this.pulse = this.audio.createOscillator();
    this.pulseDepth = this.audio.createGain();
    this.motor.type = 'sawtooth';
    this.motor.frequency.value = 142;
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 520;
    this.gain.gain.value = 0.0001;
    this.pulse.type = 'sine';
    this.pulse.frequency.value = 8;
    this.pulseDepth.gain.value = 0;
    this.motor.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(this.audio.destination);
    this.pulse.connect(this.pulseDepth);
    this.pulseDepth.connect(this.gain.gain);
    this.motor.start();
    this.pulse.start();
  }

  unlockAudio() {
    this._initAudio();
    if (this.audio?.state === 'suspended') this.audio.resume();
  }

  _motor(on, layer = 0) {
    if (!this.sound) return;
    if (!this.audio && !on) return;
    this._initAudio();
    if (!this.audio) return;
    if (this.audio.state === 'suspended') this.audio.resume();
    const t = this.audio.currentTime;
    this.motor.frequency.setTargetAtTime(layer === 0 ? 142 : 176, t, 0.035);
    this.pulse.frequency.setTargetAtTime(layer === 0 ? 7.5 : 8.5, t, 0.035);
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(on ? 0.015 : 0.0001, t, on ? 0.025 : 0.055);
    this.pulseDepth.gain.cancelScheduledValues(t);
    this.pulseDepth.gain.setTargetAtTime(on ? 0.012 : 0, t, on ? 0.025 : 0.055);
  }

  _drawSegment(line, fromIndex, toIndex) {
    const points = line.points;
    const start = Math.max(0, Math.min(points.length - 1, fromIndex));
    const end = Math.max(start, Math.min(points.length - 1, toIndex));
    if (end <= start) return;
    const c = this.ctx;
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(points[start][0], points[start][1]);
    for (let i = start + 1; i <= end; i++) c.lineTo(points[i][0], points[i][1]);
    c.strokeStyle = line.color || '#000';
    c.lineWidth = 2.8 * this.renderScale;
    c.stroke();
    c.restore();
  }

  start() {
    if (this.running) return;
    if (!this.lines.length) return;
    if (this.index >= this.lines.length) this.reset();
    this._initAudio();
    if (this.audio?.state === 'suspended') this.audio.resume();
    this.running = true;
    this.paused = false;
    this.lastFrame = 0;
    const line = this.lines[this.index];
    this._motor(this.phase === 'line', line?.layer ?? 0);
    this.onStatus(this.phase === 'gap' ? 'Moving to next line' : 'Drawing');
    this.raf = requestAnimationFrame((t) => this._frame(t));
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    this.paused = true;
    cancelAnimationFrame(this.raf);
    this._motor(false);
    this.onStatus('Paused');
  }

  reset() {
    this.running = false;
    this.paused = false;
    cancelAnimationFrame(this.raf);
    this.index = 0;
    this.phase = 'line';
    this.lineElapsed = 0;
    this.gapElapsed = 0;
    this.lastFrame = 0;
    this._drawnPoint = 0;
    this._motor(false);
    this.clear();
  }

  _frame(timestamp) {
    if (!this.running) return;
    if (!this.lastFrame) this.lastFrame = timestamp;
    const dt = Math.min(60, timestamp - this.lastFrame);
    this.lastFrame = timestamp;

    if (this.phase === 'line') {
      const line = this.lines[this.index];
      this.lineElapsed = Math.min(this.lineDuration, this.lineElapsed + dt);
      const fraction = this.lineElapsed / this.lineDuration;
      const lastPoint = line.points.length - 1;
      const target = Math.min(lastPoint, Math.floor(fraction * lastPoint));
      this._drawSegment(line, this._drawnPoint, target);
      this._drawnPoint = target;
      this.onProgress(this.index + fraction, this.lines.length);
      if (fraction >= 1) {
        this.index++;
        this.phase = 'gap';
        this.gapElapsed = 0;
        this._drawnPoint = 0;
        this._motor(false);
        this.onProgress(this.index, this.lines.length);
        if (this.index >= this.lines.length) {
          this.running = false;
          this.onStatus('Relief revealed');
          return;
        }
        this.onStatus('Moving to next line');
      }
    } else {
      this.gapElapsed = Math.min(this.gapDuration, this.gapElapsed + dt);
      if (this.gapElapsed >= this.gapDuration) {
        this.phase = 'line';
        const next = this.lines[this.index];
        this._motor(true, next?.layer ?? 0);
        this.onStatus('Drawing');
      }
    }
    this.raf = requestAnimationFrame((t) => this._frame(t));
  }
}
