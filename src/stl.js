const STL_EXTENSION = /\.stl$/i;
const MANIFEST_URL = './models.json';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function toModelEntry(entry) {
  if (typeof entry === 'string') {
    return STL_EXTENSION.test(entry) ? { name: entry, url: `./${encodeURIComponent(entry)}` } : null;
  }
  if (!entry || typeof entry.name !== 'string' || !STL_EXTENSION.test(entry.name)) return null;
  return {
    name: entry.name,
    url: typeof entry.url === 'string' ? entry.url : `./${encodeURIComponent(entry.name)}`
  };
}

function sortModels(models) {
  return models.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

function githubRepositoryFromLocation() {
  const host = window.location.hostname;
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (host.endsWith('.github.io')) {
    const owner = host.slice(0, -'.github.io'.length);
    const repo = segments[0] || `${owner}.github.io`;
    return owner && repo ? { owner, repo } : null;
  }
  if (host === 'github.com' && segments.length >= 2) {
    return { owner: segments[0], repo: segments[1].replace(/\.git$/, '') };
  }
  return null;
}

async function discoverFromGitHub() {
  const repository = githubRepositoryFromLocation();
  if (!repository) return [];
  const url = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/contents/`;
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!response.ok) return [];
  const entries = await response.json();
  if (!Array.isArray(entries)) return [];
  return sortModels(entries
    .filter((entry) => entry.type === 'file' && STL_EXTENSION.test(entry.name))
    .map((entry) => ({ name: entry.name, url: entry.download_url || `./${encodeURIComponent(entry.name)}` })));
}

async function discoverFromManifest() {
  const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) return [];
  const entries = await response.json();
  return sortModels((Array.isArray(entries) ? entries : []).map(toModelEntry).filter(Boolean));
}

export async function discoverSTLModels() {
  try {
    const remoteModels = await discoverFromGitHub();
    if (remoteModels.length) return remoteModels;
  } catch (error) {
    console.warn('STL repository discovery failed', error);
  }
  try {
    return await discoverFromManifest();
  } catch (error) {
    console.warn('STL manifest discovery failed', error);
    return [];
  }
}

function readVertex(view, offset) {
  return [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true)
  ];
}

function parseBinarySTL(buffer) {
  if (buffer.byteLength < 84) return [];
  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  const expectedLength = 84 + triangleCount * 50;
  if (!triangleCount || expectedLength > buffer.byteLength) return [];
  const triangles = [];
  for (let i = 0; i < triangleCount; i++) {
    const base = 84 + i * 50;
    const vertices = [readVertex(view, base + 12), readVertex(view, base + 24), readVertex(view, base + 36)];
    if (vertices.flat().every(Number.isFinite)) triangles.push(vertices);
  }
  return triangles;
}

function parseASCIISTL(buffer) {
  const text = new TextDecoder().decode(buffer);
  const vertices = [];
  const vertexPattern = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/gi;
  for (const match of text.matchAll(vertexPattern)) {
    vertices.push([Number(match[1]), Number(match[2]), Number(match[3])]);
  }
  const triangles = [];
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    const triangle = [vertices[i], vertices[i + 1], vertices[i + 2]];
    if (triangle.flat().every(Number.isFinite)) triangles.push(triangle);
  }
  return triangles;
}

export function parseSTL(buffer) {
  const binary = parseBinarySTL(buffer);
  if (binary.length) return binary;
  const ascii = parseASCIISTL(buffer);
  if (!ascii.length) throw new Error('The STL file contains no triangles');
  return ascii;
}

export async function loadSTLModel(model) {
  const response = await fetch(model.url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Unable to load ${model.name}`);
  return parseSTL(await response.arrayBuffer());
}

function boundsOf(triangles) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const triangle of triangles) {
    for (const vertex of triangle) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], vertex[axis]);
        max[axis] = Math.max(max[axis], vertex[axis]);
      }
    }
  }
  return { min, max, spans: max.map((value, axis) => value - min[axis]) };
}

function triangleNormal(triangle) {
  const [a, b, c] = triangle;
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
}

function splitSurfaceTriangles(triangles, depthAxis) {
  const positive = [];
  const negative = [];
  for (const triangle of triangles) {
    const normal = triangleNormal(triangle);
    const length = Math.hypot(...normal);
    if (!length || Math.abs(normal[depthAxis]) / length < 0.75) continue;
    (normal[depthAxis] >= 0 ? positive : negative).push(triangle);
  }
  const averageDepth = (group) => group.length
    ? group.reduce((sum, triangle) => sum + triangle.reduce((inner, vertex) => inner + vertex[depthAxis], 0) / 3, 0) / group.length
    : -Infinity;
  return averageDepth(positive) >= averageDepth(negative)
    ? { top: positive, bottom: negative }
    : { top: negative, bottom: positive };
}

function buildSurfaceSampler(triangles, uAxis, vAxis, bounds) {
  const uSpan = Math.max(bounds.spans[uAxis], Number.EPSILON);
  const vSpan = Math.max(bounds.spans[vAxis], Number.EPSILON);
  const gridSize = 64;
  const buckets = Array.from({ length: gridSize * gridSize }, () => []);
  const projected = triangles.map((triangle) => triangle.map((vertex) => ({
    u: vertex[uAxis],
    v: vertex[vAxis],
    d: vertex[3 - uAxis - vAxis]
  })));

  projected.forEach((triangle, index) => {
    const minU = Math.min(...triangle.map((point) => point.u));
    const maxU = Math.max(...triangle.map((point) => point.u));
    const minV = Math.min(...triangle.map((point) => point.v));
    const maxV = Math.max(...triangle.map((point) => point.v));
    const x0 = clamp(Math.floor((minU - bounds.min[uAxis]) / uSpan * gridSize), 0, gridSize - 1);
    const x1 = clamp(Math.floor((maxU - bounds.min[uAxis]) / uSpan * gridSize), 0, gridSize - 1);
    const y0 = clamp(Math.floor((minV - bounds.min[vAxis]) / vSpan * gridSize), 0, gridSize - 1);
    const y1 = clamp(Math.floor((maxV - bounds.min[vAxis]) / vSpan * gridSize), 0, gridSize - 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) buckets[y * gridSize + x].push(index);
    }
  });

  return (u, v) => {
    const x = clamp(Math.floor((u - bounds.min[uAxis]) / uSpan * gridSize), 0, gridSize - 1);
    const y = clamp(Math.floor((v - bounds.min[vAxis]) / vSpan * gridSize), 0, gridSize - 1);
    const candidates = buckets[y * gridSize + x];
    let bestDepth = null;
    for (const index of candidates) {
      const [a, b, c] = projected[index];
      const denominator = (b.v - c.v) * (a.u - c.u) + (c.u - b.u) * (a.v - c.v);
      if (Math.abs(denominator) < 1e-12) continue;
      const w0 = ((b.v - c.v) * (u - c.u) + (c.u - b.u) * (v - c.v)) / denominator;
      const w1 = ((c.v - a.v) * (u - c.u) + (a.u - c.u) * (v - c.v)) / denominator;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const depth = w0 * a.d + w1 * b.d + w2 * c.d;
      if (bestDepth === null || depth > bestDepth) bestDepth = depth;
    }
    return bestDepth;
  };
}

function projectPoint(vertex, axes, bounds, canvas, reliefPixels) {
  const [uAxis, vAxis, depthAxis] = axes;
  const side = Math.min(canvas.width, canvas.height);
  const padding = side * 0.075;
  const plotSize = side - padding * 2;
  const uSpan = Math.max(bounds.spans[uAxis], Number.EPSILON);
  const vSpan = Math.max(bounds.spans[vAxis], Number.EPSILON);
  const depthSpan = Math.max(bounds.spans[depthAxis], Number.EPSILON);
  const x = (canvas.width - side) / 2 + padding + (vertex[uAxis] - bounds.min[uAxis]) / uSpan * plotSize;
  const y = (canvas.height - side) / 2 + padding + (bounds.max[vAxis] - vertex[vAxis]) / vSpan * plotSize;
  const depth = (vertex[depthAxis] - bounds.min[depthAxis]) / depthSpan;
  return [x - depth * reliefPixels, y - depth * reliefPixels];
}

function buildWireframeLines(triangles, axes, bounds, canvas) {
  const precision = Math.max(...bounds.spans) * 1e-7 || 1e-7;
  const vertices = [];
  const vertexIds = new Map();
  const edges = new Map();
  const idFor = (vertex) => {
    const key = vertex.map((value) => Math.round(value / precision)).join(':');
    if (!vertexIds.has(key)) {
      vertexIds.set(key, vertices.length);
      vertices.push(vertex);
    }
    return vertexIds.get(key);
  };
  for (const triangle of triangles) {
    const ids = triangle.map(idFor);
    for (let i = 0; i < 3; i++) {
      const a = ids[i], b = ids[(i + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!edges.has(key)) edges.set(key, [a, b]);
    }
  }
  const reliefPixels = Math.min(canvas.width, canvas.height) * 0.075;
  const edgeList = [...edges.values()];
  const stride = Math.max(1, Math.ceil(edgeList.length / 1800));
  return edgeList.filter((_, index) => index % stride === 0).map(([a, b]) => ({
    points: [projectPoint(vertices[a], axes, bounds, canvas, reliefPixels), projectPoint(vertices[b], axes, bounds, canvas, reliefPixels)],
    color: '#2468d8',
    layer: 0
  }));
}

export function buildLinesFromSTL(triangles, canvas) {
  const bounds = boundsOf(triangles);
  const axes = [0, 1, 2].sort((a, b) => bounds.spans[b] - bounds.spans[a]);
  const [uAxis, vAxis, depthAxis] = axes;
  const uSpan = Math.max(bounds.spans[uAxis], Number.EPSILON);
  const vSpan = Math.max(bounds.spans[vAxis], Number.EPSILON);
  const depthSpan = Math.max(bounds.spans[depthAxis], Number.EPSILON);
  const surfaces = splitSurfaceTriangles(triangles, depthAxis);
  const hasThickness = surfaces.top.length >= triangles.length * 0.05 && surfaces.bottom.length >= triangles.length * 0.05;
  const sampleTop = buildSurfaceSampler(hasThickness ? surfaces.top : triangles, uAxis, vAxis, bounds);
  const sampleBottom = hasThickness ? buildSurfaceSampler(surfaces.bottom, uAxis, vAxis, bounds) : null;
  const side = Math.min(canvas.width, canvas.height);
  const padding = side * 0.075;
  const plotSize = side - padding * 2;
  const reliefPixels = Math.min(plotSize * 0.075, side * 0.08);
  const count = 66;
  const samples = 300;
  const lines = [];
  const mapU = (u) => (canvas.width - side) / 2 + padding + (u - bounds.min[uAxis]) / uSpan * plotSize;
  const mapV = (v) => (canvas.height - side) / 2 + padding + (bounds.max[vAxis] - v) / vSpan * plotSize;
  const addPath = (path, color, layer) => {
    if (path.length > 1) lines.push({ points: path, color, layer });
  };

  const buildPass = (vertical) => {
    const color = vertical ? '#2468d8' : '#df4038';
    const layer = vertical ? 0 : 1;
    for (let j = 0; j < count; j++) {
      const fixed = vertical
        ? bounds.min[uAxis] + j * uSpan / (count - 1)
        : bounds.min[vAxis] + j * vSpan / (count - 1);
      const topPoints = [];
      const bottomPoints = [];
      for (let i = 0; i <= samples; i++) {
        const moving = vertical
          ? bounds.min[vAxis] + i * vSpan / samples
          : bounds.min[uAxis] + i * uSpan / samples;
        const u = vertical ? fixed : moving;
        const v = vertical ? moving : fixed;
        const topDepth = sampleTop(u, v);
        const bottomDepth = sampleBottom ? sampleBottom(u, v) : null;
        topPoints.push(topDepth === null ? null : [
          mapU(u) - (vertical ? ((topDepth - bounds.min[depthAxis]) / depthSpan) * reliefPixels : 0),
          mapV(v) - (vertical ? 0 : ((topDepth - bounds.min[depthAxis]) / depthSpan) * reliefPixels)
        ]);
        bottomPoints.push(bottomDepth === null ? null : [
          mapU(u) - (vertical ? ((bottomDepth - bounds.min[depthAxis]) / depthSpan) * reliefPixels : 0),
          mapV(v) - (vertical ? 0 : ((bottomDepth - bounds.min[depthAxis]) / depthSpan) * reliefPixels)
        ]);
      }

      let start = null;
      const flush = (end) => {
        if (start === null || end - start < 1) return;
        if (!sampleBottom) {
          addPath(topPoints.slice(start, end + 1).filter(Boolean), color, layer);
          return;
        }
        const path = topPoints.slice(start, end + 1);
        path.push(bottomPoints[end]);
        for (let i = end - 1; i >= start; i--) path.push(bottomPoints[i]);
        path.push(topPoints[start]);
        addPath(path, color, layer);
      };

      for (let i = 0; i <= samples; i++) {
        const present = topPoints[i] && (!sampleBottom || bottomPoints[i]);
        if (present && start === null) start = i;
        if ((!present || i === samples) && start !== null) {
          flush(present && i === samples ? i : i - 1);
          start = null;
        }
      }
    }
  };

  // Pass 1: vertical blue strokes. Pass 2: horizontal red strokes.
  buildPass(true);
  buildPass(false);
  return lines.length >= 12 ? lines : buildWireframeLines(triangles, axes, bounds, canvas);
}
