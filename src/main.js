import { Plotter } from './plotter.js';
const $ = id => document.getElementById(id);
const canvas = $('plot');
const startButton = $('start');
const pauseButton = $('pause');
let completed = false;
const plotter = new Plotter(canvas, (n, total) => {
  const pct = Math.round(n / total * 100);
  $('bar').style.width = pct + '%';
  $('percent').textContent = pct + '%';
}, message => {
  $('status').textContent = message.toUpperCase();
  if (message === 'Relief revealed') {
    completed = true;
    startButton.textContent = 'Запустить снова';
    pauseButton.disabled = true;
  }
});
startButton.addEventListener('click', () => {
  if (completed) {
    plotter.reset();
    completed = false;
    startButton.textContent = 'Начать';
  }
  plotter.start();
  startButton.textContent = 'Продолжить';
  pauseButton.disabled = false;
});
pauseButton.addEventListener('click', () => {
  plotter.pause();
  startButton.textContent = 'Продолжить';
  pauseButton.disabled = true;
});
$('reset').addEventListener('click', () => {
  plotter.reset();
  completed = false;
  pauseButton.disabled = true;
  startButton.textContent = 'Начать';
});
$('duration').addEventListener('input', e => {
  const value = Number(e.target.value);
  plotter.setDuration(value);
  $('durationOut').textContent = (value / 1000).toFixed(1) + ' с';
});
$('gap').addEventListener('input', e => {
  const value = Number(e.target.value);
  plotter.setGap(value);
  $('gapOut').textContent = (value / 1000).toFixed(2) + ' с';
});
$('sound').addEventListener('change', e => plotter.setSound(e.target.checked));
