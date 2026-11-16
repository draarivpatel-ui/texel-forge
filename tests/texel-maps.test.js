const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/texel-maps.js');

const N = 32;

function field(fn, size = N) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = fn(x, y);
  return h;
}

test('height: every pattern is deterministic per seed, normalized to 0..1, and differs between seeds', () => {
  for (let p = 0; p < T.PATTERNS.length; p++) {
    const a = T.heightField(p, N, 5);
    const b = T.heightField(p, N, 5);
    assert.deepEqual(a, b, T.PATTERNS[p].id);
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of a) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    assert.ok(Math.abs(lo) < 1e-6 && Math.abs(hi - 1) < 1e-6, `${T.PATTERNS[p].id} spans 0..1`);
    const c = T.heightField(p, N, 6);
    assert.notDeepEqual(a, c, `${T.PATTERNS[p].id} reacts to the seed`);
  }
});

test('height: the four patterns are genuinely different surfaces', () => {
  const maps = T.PATTERNS.map((_, p) => T.heightField(p, N, 7));
  for (let i = 0; i < maps.length; i++) {
    for (let j = i + 1; j < maps.length; j++) {
      let diff = 0;
      for (let k = 0; k < maps[i].length; k++) diff += Math.abs(maps[i][k] - maps[j][k]);
      assert.ok(diff / maps[i].length > 0.05, `${i} vs ${j}`);
    }
  }
});

test('height: sizes must be powers of two from 8 to 512', () => {
  for (const bad of [4, 48, 1024, 0]) assert.throws(() => T.heightField(0, bad, 1), RangeError, String(bad));
  assert.doesNotThrow(() => T.heightField(0, 8, 1));
});

test('normals: a flat field gives (0, 0, 1) everywhere and full occlusion visibility', () => {
  const h = field(() => 0.4);
  const n = T.normalMap(h, N, 6);
  for (let i = 0; i < N * N; i++) {
    assert.equal(Math.abs(n[i * 3]), 0);
    assert.equal(Math.abs(n[i * 3 + 1]), 0);
    assert.equal(n[i * 3 + 2], 1);
  }
  const ao = T.aoMap(h, N, 6, 8, 12);
  for (const v of ao) assert.equal(v, 1);
});

test('normals: a periodic ramp yields the analytic normal (Sobel recovers the exact slope)', () => {
  // h = x / N wraps once per map; away from the wrap column the slope is 1/N per texel.
  const strength = 3;
  const h = field((x) => x / N);
  const n = T.normalMap(h, N, strength);
  const g = 1 / N;
  const len = Math.hypot(g * strength, 1);
  for (let y = 0; y < N; y++) {
    for (let x = 2; x < N - 2; x++) {
      const o = (y * N + x) * 3;
      assert.ok(Math.abs(n[o] - -(g * strength) / len) < 1e-6);
      assert.ok(Math.abs(n[o + 1]) < 1e-6);
      assert.ok(Math.abs(n[o + 2] - 1 / len) < 1e-6);
    }
  }
});

test('normals: always unit length, and the OpenGL green channel points up the map', () => {
  for (let p = 0; p < T.PATTERNS.length; p++) {
    const m = T.synthesize({ pattern: p, size: N, seed: 3 });
    assert.ok(m.stats.normalUnitError < 1e-6, T.PATTERNS[p].id);
  }
  // OpenGL convention: on a bump, the slope on the upper side of the image faces up the map (green above
  // the midpoint) and the lower slope faces down (green below it).
  const bump = field((x, y) => Math.exp(-((x - N / 2) ** 2 + (y - N / 2) ** 2) / 40));
  const nb = T.normalMap(bump, N, 4);
  assert.ok(nb[((N / 2 - 4) * N + N / 2) * 3 + 1] > 0, 'upper slope faces up the map');
  assert.ok(nb[((N / 2 + 4) * N + N / 2) * 3 + 1] < 0, 'lower slope faces down the map');
  assert.ok(nb[(N / 2 * N + N / 2 - 4) * 3] < 0, 'left slope faces left');
});

test('tileability: wrap-around normals equal normals computed inside a 2 by 2 tiled field', () => {
  for (let p = 0; p < T.PATTERNS.length; p++) {
    const h = T.heightField(p, N, 11);
    const big = new Float32Array(4 * N * N);
    for (let y = 0; y < 2 * N; y++) for (let x = 0; x < 2 * N; x++) big[y * 2 * N + x] = h[(y % N) * N + (x % N)];
    const small = T.normalMap(h, N, 5);
    const large = T.normalMap(big, 2 * N, 5);
    // Texel (0, 0) of the tile sits at (N, N) inside the big field, where no wrap is needed.
    for (const [x, y] of [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1], [7, 0], [0, 9]]) {
      const a = (y * N + x) * 3;
      const b = ((y + N) * 2 * N + (x + N)) * 3;
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(small[a + c] - large[b + c]) < 1e-9, `${T.PATTERNS[p].id} at ${x},${y}`);
    }
  }
});

test('tileability: default seed-7 wrap jumps stay below the largest interior jumps', () => {
  for (let p = 0; p < T.PATTERNS.length; p++) {
    const { stats } = T.synthesize({ pattern: p, size: 64, seed: 7 });
    assert.ok(stats.seamJump <= stats.interiorJump + 1e-9, `${T.PATTERNS[p].id}: seam ${stats.seamJump} vs interior ${stats.interiorJump}`);
  }
});

test('tileability: seed-13 cobblestone reports a wrap maximum above its interior maximum accurately', () => {
  const { size, height, stats } = T.synthesize({ pattern: 1, size: 64, seed: 13 });
  let wrapMax = 0;
  let interiorMax = 0;
  for (let y = 0; y < size; y++) {
    wrapMax = Math.max(wrapMax, Math.abs(height[y * size + size - 1] - height[y * size]));
    wrapMax = Math.max(wrapMax, Math.abs(height[(size - 1) * size + y] - height[y]));
    for (let x = 0; x < size - 1; x++) {
      interiorMax = Math.max(interiorMax, Math.abs(height[y * size + x + 1] - height[y * size + x]));
      interiorMax = Math.max(interiorMax, Math.abs(height[(x + 1) * size + y] - height[x * size + y]));
    }
  }
  assert.equal(stats.seamJump, wrapMax);
  assert.equal(stats.interiorJump, interiorMax);
  assert.equal(stats.seamJump.toFixed(9), '0.402244389');
  assert.equal(stats.interiorJump.toFixed(9), '0.401748806');
  assert.ok(stats.seamJump > stats.interiorJump);
  assert.equal(stats.seamRatio, wrapMax / interiorMax);
});

test('map stats: interior edges on the last row or column are not wrap seams', () => {
  const size = 3;
  const normal = new Float32Array(size * size * 3);
  for (let i = 2; i < normal.length; i += 3) normal[i] = 1;
  const channels = { size, normal, ao: new Float32Array(size * size).fill(1), roughness: new Float32Array(size * size).fill(0.5) };
  for (const height of [
    new Float32Array([0, 10, 0, 0, 10, 0, 0, 10, 0]),
    new Float32Array([0, 0, 0, 10, 10, 10, 0, 0, 0])
  ]) {
    const stats = T.mapStats({ ...channels, height });
    assert.equal(stats.seamJump, 0);
    assert.equal(stats.interiorJump, 10);
    assert.equal(stats.seamRatio, 0);
  }
});

test('map stats: horizontal and vertical wrap edges contribute their own jumps', () => {
  const size = 3;
  const normal = new Float32Array(size * size * 3);
  for (let i = 2; i < normal.length; i += 3) normal[i] = 1;
  const channels = { size, normal, ao: new Float32Array(size * size), roughness: new Float32Array(size * size) };
  for (const height of [
    new Float32Array([0, 1, 2, 0, 1, 2, 0, 1, 2]),
    new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2])
  ]) {
    const stats = T.mapStats({ ...channels, height });
    assert.equal(stats.seamJump, 2);
    assert.equal(stats.interiorJump, 1);
    assert.equal(stats.seamRatio, 2);
  }
  const flat = T.mapStats({ ...channels, height: new Float32Array(size * size) });
  assert.equal(flat.seamJump, 0);
  assert.equal(flat.interiorJump, 0);
  assert.equal(flat.seamRatio, 0);
});

test('map stats: default seed-7 wrap maxima match an independent edge scan and exact regression figures', () => {
  const expectedSeams = [0.0054251502733677626, 0.3694489300251007, 0.0023720264434814453, 0.08767575025558472];
  const expectedInterior = [0.5353914760053158, 0.4026913046836853, 0.7335847616195679, 0.18764670193195343];
  for (let pattern = 0; pattern < T.PATTERNS.length; pattern += 1) {
    const maps = T.synthesize({ pattern, size: 64, seed: 7 });
    const { size, height, stats } = maps;
    const wrapEdges = [];
    const interiorEdges = [];
    for (let i = 0; i < size; i += 1) {
      wrapEdges.push(Math.abs(height[i * size + size - 1] - height[i * size]));
      wrapEdges.push(Math.abs(height[(size - 1) * size + i] - height[i]));
      for (let j = 0; j < size - 1; j += 1) {
        interiorEdges.push(Math.abs(height[i * size + j + 1] - height[i * size + j]));
        interiorEdges.push(Math.abs(height[(j + 1) * size + i] - height[j * size + i]));
      }
    }
    assert.equal(stats.seamJump, Math.max(...wrapEdges));
    assert.equal(stats.interiorJump, Math.max(...interiorEdges));
    assert.equal(stats.seamJump, expectedSeams[pattern], T.PATTERNS[pattern].id);
    assert.equal(stats.interiorJump, expectedInterior[pattern], T.PATTERNS[pattern].id);
  }
});

test('occlusion: a pit is darker than a peak, values stay in 0..1, and a wider radius never brightens', () => {
  const pit = field((x, y) => Math.min(1, Math.hypot(x - N / 2, y - N / 2) / 8));
  const ao = T.aoMap(pit, N, 6, 8, 12);
  const centre = ao[(N / 2) * N + N / 2];
  const rim = ao[(N / 2) * N + N / 2 + 12];
  assert.ok(centre < 0.6, `pit floor is occluded (${centre})`);
  assert.ok(rim > centre);
  for (const v of ao) assert.ok(v >= 0 && v <= 1);
  const wide = T.aoMap(pit, N, 10, 8, 12);
  for (let i = 0; i < ao.length; i++) assert.ok(wide[i] <= ao[i] + 1e-12, 'more horizon can only add occlusion');
});

test('curvature and roughness: valleys read concave and rougher than ridges', () => {
  const h = field((x) => 0.5 + 0.5 * Math.cos((2 * Math.PI * x) / N));
  const curv = T.curvatureMap(h, N);
  assert.ok(curv[0] < 0, 'ridge at x = 0 is convex');
  assert.ok(curv[N / 2] > 0, 'valley at x = N/2 is concave');
  const ao = T.aoMap(h, N, 4, 8, 12);
  const rough = T.roughnessMap(curv, ao, N);
  assert.ok(rough[N / 2] > rough[0]);
  for (const v of rough) assert.ok(v >= 0 && v <= 1);
});

test('normal encoding round-trips within one 8-bit step', () => {
  const m = T.synthesize({ pattern: 1, size: N, seed: 2 });
  for (let i = 0; i < N * N; i += 7) {
    const n = [m.normal[i * 3], m.normal[i * 3 + 1], m.normal[i * 3 + 2]];
    const back = T.decodeNormal(...T.encodeNormal(...n));
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(back[c] - n[c]) <= 1 / 255 + 1e-9);
  }
  assert.deepEqual(T.encodeNormal(0, 0, 1), [128, 128, 255]);
});

test('dither: Bayer matrices match the classic tables and the shader construction', () => {
  assert.deepEqual(T.bayerMatrix(2), [[0, 2], [3, 1]]);
  assert.deepEqual(T.bayerMatrix(4), [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]);
  const m8 = T.bayerMatrix(8).flat();
  assert.deepEqual([...m8].sort((a, b) => a - b), Array.from({ length: 64 }, (_, i) => i), '8x8 is a permutation of 0..63');
  let sum = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sum += T.bayer(x, y, 4);
  assert.ok(Math.abs(sum / 16 - 0.5) < 1e-12, 'thresholds are centred like the shader');
});

test('dither: quantize mirrors the shader formula and preserves the mean of a flat field', () => {
  assert.equal(T.quantize(0, 0.5, 5, 1), 0);
  assert.equal(T.quantize(1, 0.5, 5, 1), 4);
  assert.equal(T.quantize(0.5, 0.5, 5, 0), 2);
  const levels = 5;
  for (const value of [0.1, 0.3, 0.55, 0.8]) {
    const idx = T.ditherToPalette(new Float32Array(64).fill(value), 8, levels, 1, 2, 6);
    const mean = idx.reduce((a, b) => a + b, 0) / idx.length / (levels - 1);
    assert.ok(Math.abs(mean - value) <= 1 / 64 + 1e-9, `ordered dither keeps ${value} on average (got ${mean})`);
  }
});

test('dither: scanline mode depends only on the row', () => {
  const idx = T.ditherToPalette(new Float32Array(64).fill(0.43), 8, 4, 1, 3, 4);
  for (let y = 0; y < 8; y++) for (let x = 1; x < 8; x++) assert.equal(idx[y * 8 + x], idx[y * 8]);
});

test('ramp: blends neighbouring palette stops like the shader', () => {
  const stops = [[0, 0, 0], [100, 50, 0], [200, 200, 200]];
  assert.deepEqual(T.rampColor(stops, 0), [0, 0, 0]);
  assert.deepEqual(T.rampColor(stops, 1), [200, 200, 200]);
  assert.deepEqual(T.rampColor(stops, 0.25), [50, 25, 0]);
});

test('shading: a flat surface lit from straight above is fully lit, and AO dims the ambient', () => {
  const size = 8;
  const flat = { size, normal: T.normalMap(new Float32Array(64).fill(0.5), size, 4), ao: new Float32Array(64).fill(1) };
  const top = T.shade(flat, 0, Math.PI / 2);
  for (const v of top) assert.ok(Math.abs(v - 1) < 1e-9);
  const dim = T.shade({ ...flat, ao: new Float32Array(64).fill(0) }, 0, Math.PI / 2);
  for (const v of dim) assert.ok(v < 0.5);
});

test('pixels: every map exports a full RGBA buffer and the lit map uses only ramp colors', () => {
  const m = T.synthesize({ pattern: 2, size: 16, seed: 4 });
  for (const which of ['height', 'normal', 'ao', 'roughness']) {
    const px = T.toRgba(m, which);
    assert.equal(px.length, 16 * 16 * 4);
    for (let i = 3; i < px.length; i += 4) assert.equal(px[i], 255);
  }
  const stops = [[10, 20, 30], [240, 230, 220]];
  m.litIndex = T.ditherToPalette(T.shade(m, 0.9, 0.75), 16, 2, 1, 1, 6);
  m.litLevels = 2;
  const lit = T.toRgba(m, 'lit', stops);
  for (let i = 0; i < lit.length; i += 4) {
    const rgb = [lit[i], lit[i + 1], lit[i + 2]].join(',');
    assert.ok(rgb === '10,20,30' || rgb === '240,230,220', rgb);
  }
});

test('synthesize: defaults produce a 64 texel material with sane statistics', () => {
  const m = T.synthesize();
  assert.equal(m.size, 64);
  assert.ok(m.stats.aoMean > 0.3 && m.stats.aoMean < 1);
  assert.ok(m.stats.roughnessMean > 0 && m.stats.roughnessMean < 1);
  assert.deepEqual(T.synthesize(), m, 'deterministic end to end');
});
