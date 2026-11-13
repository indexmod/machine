import { Plotter } from './plotter.js';
import { buildProceduralLines } from './model.js';
import { buildLinesFromSTL, discoverSTLModels, loadSTLModel } from './stl.js';

const canvas = document.getElementById('plot');
const rotationKey = 'machine.stl.rotation';

function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = document.documentElement.clientWidth || window.innerWidth || 300;
  const height = document.documentElement.clientHeight || window.innerHeight || 150;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
}

sizeCanvas();
const plotter = new Plotter(canvas);
const state = {
  models: [],
  currentIndex: 0,
  started: false,
  cache: new Map(),
  activeTriangles: null
};

function storedIndex() {
  try {
    const value = Number.parseInt(localStorage.getItem(rotationKey), 10);
    return Number.isInteger(value) ? value : null;
  } catch {
    return null;
  }
}

function rememberIndex() {
  try {
    localStorage.setItem(rotationKey, String(state.currentIndex));
  } catch {
    // Storage may be unavailable in private browsing; rotation still works for clicks.
  }
}

async function selectInitialModel() {
  state.models = await discoverSTLModels();
  if (!state.models.length) {
    plotter.setLines(buildProceduralLines(canvas));
    return;
  }
  const previous = storedIndex();
  state.currentIndex = previous === null ? 0 : (previous + 1) % state.models.length;
  await activateCurrentModel();
}

async function activateCurrentModel() {
  if (!state.models.length) {
    state.activeTriangles = null;
    plotter.setLines(buildProceduralLines(canvas));
    return;
  }
  const model = state.models[state.currentIndex];
  let triangles = state.cache.get(model.url);
  if (!triangles) {
    triangles = await loadSTLModel(model);
    state.cache.set(model.url, triangles);
  }
  state.activeTriangles = triangles;
  plotter.setLines(buildLinesFromSTL(triangles, canvas));
}

const ready = selectInitialModel().catch((error) => {
  console.warn('STL model initialization failed', error);
  state.models = [];
  state.activeTriangles = null;
  plotter.setLines(buildProceduralLines(canvas));
});

let clickQueue = Promise.resolve();
window.addEventListener('click', () => {
  plotter.unlockAudio();
  const advance = state.started;
  state.started = true;
  clickQueue = clickQueue.then(async () => {
    await ready;
    if (advance && state.models.length > 1) {
      state.currentIndex = (state.currentIndex + 1) % state.models.length;
    }
    await activateCurrentModel();
    rememberIndex();
    plotter.reset();
    plotter.start();
  }).catch((error) => console.warn('Drawing restart failed', error));
});

let resizeTimer = 0;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const wasRunning = plotter.running;
    sizeCanvas();
    if (state.activeTriangles) plotter.setLines(buildLinesFromSTL(state.activeTriangles, canvas));
    else plotter.setLines(buildProceduralLines(canvas));
    if (wasRunning) plotter.start();
  }, 100);
});
