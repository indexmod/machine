import { MODEL, heightAt, gradientAt } from './model.js';

export class Plotter {
  constructor(canvas, onProgress = () => {}, onStatus = () => {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onProgress = onProgress;
    this.onStatus = onStatus;
    this.lines = [];
    this.index = 0;
    this.running = false;
    this.paused = false;
    this.lineDuration = 2400;
    this.gapDuration = 420;
    this.sound = true;
    this.phase = 'line';
    this.lineElapsed = 0;
    this.gapElapsed = 0;
    this.lastFrame = 0;
    this.raf = 0;
    this.audio = null;
    this._build();
    this.clear();
  }

  _build() {
    const N = this.canvas.width;
    const margin = 0.075 * N;
    const count = 66;
    // Pass 1: 66 horizontal blue contours.
    for (let j = 0; j < count; j++) {
      const y = margin + j * (N - 2 * margin) / (count - 1);
      const points = [];
      for (let i = 0; i <= 300; i++) {
        const x = margin + i * (N - 2 * margin) / 300;
        const xn = x / N, yn = y / N;
        const z = heightAt(xn, yn), g = gradientAt(xn, yn);
        points.push([x, y - z * 112 - g[1] * 0.65]);
      }
      this.lines.push({ points, color: '#2468d8', layer: 0 });
    }
    // Pass 2: 66 vertical red contours, only after the blue pass is complete.
    for (let j = 0; j < count; j++) {
      const x = margin + j * (N - 2 * margin) / (count - 1);
      const points = [];
      for (let i = 0; i <= 300; i++) {
        const y = margin + i * (N - 2 * margin) / 300;
        const xn = x / N, yn = y / N;
        const z = heightAt(xn, yn), g = gradientAt(xn, yn);
        points.push([x - z * 112 - g[0] * 0.65, y]);
      }
      this.lines.push({ points, color: '#df4038', layer: 1 });
    }
  }

  clear() {
    const c = this.ctx, n = this.canvas.width;
    c.fillStyle = '#f0f0ed';
    c.fillRect(0, 0, n, n);
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
    this.motor.type = 'sawtooth';
    this.motor.frequency.value = 142;
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 520;
    this.gain.gain.value = 0.0001;
    this.motor.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(this.audio.destination);
    this.motor.start();
  }

  _motor(on, layer = 0) {
    if (!this.sound) return;
    this._initAudio();
    if (!this.audio) return;
    if (this.audio.state === 'suspended') this.audio.resume();
    const t = this.audio.currentTime;
    this.motor.frequency.setTargetAtTime(layer === 0 ? 142 : 176, t, 0.035);
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(on ? 0.026 : 0.0001, t, on ? 0.025 : 0.055);
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
    c.strokeStyle = 'rgba(25,28,34,.14)';
    c.lineWidth = 2.2;
    c.stroke();
    c.beginPath();
    c.moveTo(points[start][0], points[start][1]);
    for (let i = start + 1; i <= end; i++) c.lineTo(points[i][0], points[i][1]);
    c.strokeStyle = line.color;
    c.lineWidth = 1.45;
    c.stroke();
    c.restore();
  }

  start() {
    if (this.running) return;
    if (this.index >= this.lines.length) this.reset();
    this._initAudio();
    if (this.audio?.state === 'suspended') this.audio.resume();
    this.running = true;
    this.paused = false;
    this.lastFrame = 0;
    const line = this.lines[this.index];
    this._motor(this.phase === 'line', line?.layer ?? 0);
    this.onStatus(this.phase === 'gap' ? 'Moving to next line' : (line?.layer === 0 ? 'Blue horizontal pass' : 'Red vertical pass'));
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
    this._motor(false);
    this.clear();
  }

  setSound(value) {
    this.sound = value;
    if (!value) this._motor(false);
  }
  setDuration(ms) { this.lineDuration = ms; }
  setGap(ms) { this.gapDuration = ms; }

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
      this._drawSegment(line, this._drawnPoint ?? 0, target);
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
        this._motor(true, next.layer);
        this.onStatus(next.layer === 0 ? 'Blue horizontal pass' : 'Red vertical pass');
      }
    }
    this.raf = requestAnimationFrame((t) => this._frame(t));
  }
}
