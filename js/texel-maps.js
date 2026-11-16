/*
 * TexelForge material maps. Procedural, tileable PBR-style texture synthesis at
 * texel resolution: a height field, a tangent-space normal map, ambient
 * occlusion, curvature and a derived roughness map, plus a software lit preview
 * that is quantized through the same ordered dither the shader uses.
 *
 * Every pattern is periodic over the map size, and every neighbour lookup wraps.
 * The largest sampled wrap step can exceed the largest interior step; mapStats
 * reports both rather than treating their ordering as a tiling guarantee.
 * Pure functions with no DOM access: this file runs as a browser global
 * (window.TexelMaps) and as a Node module for tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TexelMaps = factory();
}(typeof self === "undefined" ? this : self, function () {
  "use strict";

  const PATTERNS = [
    { id: "riveted-plates", name: "Riveted plates" },
    { id: "cobblestone", name: "Cobblestone" },
    { id: "hex-tiles", name: "Hex tiles" },
    { id: "corroded-noise", name: "Corroded noise" }
  ];

  const MAP_DEFAULTS = { pattern: 0, size: 64, seed: 7, strength: 4, aoRadius: 6, aoDirections: 8, aoDepth: 12 };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const wrap = (i, n) => ((i % n) + n) % n;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (t) => t * t * (3 - 2 * t);

  /* ------------------------------------------------------------ patterns */

  // Tileable value noise: a lattice of random values with period `cells`.
  function valueNoise(size, cells, rng) {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const a = lattice[wrap(y0, cells) * cells + wrap(x0, cells)];
        const b = lattice[wrap(y0, cells) * cells + wrap(x0 + 1, cells)];
        const c = lattice[wrap(y0 + 1, cells) * cells + wrap(x0, cells)];
        const d = lattice[wrap(y0 + 1, cells) * cells + wrap(x0 + 1, cells)];
        out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      }
    }
    return out;
  }

  function fbm(size, seed, octaves) {
    const rng = mulberry32(seed);
    const out = new Float32Array(size * size);
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
      const cells = Math.min(size, 4 << o);
      const layer = valueNoise(size, cells, rng);
      for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
      total += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }

  function normalize01(h) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo || 1;
    for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / span;
    return h;
  }

  function rivetedPlates(size, seed) {
    const plates = 4;
    const cell = size / plates;
    const grain = fbm(size, seed, 4);
    const h = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const lx = (x % cell) + 0.5;
        const ly = (y % cell) + 0.5;
        const edge = Math.min(lx, ly, cell - lx, cell - ly);
        let v = 0.55 + 0.45 * smooth(clamp01((edge - 0.5) / 2.5));
        const rx = Math.min(lx - 2.5, cell - lx - 2.5);
        const ry = Math.min(ly - 2.5, cell - ly - 2.5);
        const rd = Math.hypot(Math.abs(rx) < 1.6 ? rx : 9, Math.abs(ry) < 1.6 ? ry : 9);
        if (rd < 1.6) v += 0.35 * Math.sqrt(1 - (rd / 1.6) * (rd / 1.6));
        h[y * size + x] = v * 0.9 + grain[y * size + x] * 0.1;
      }
    }
    return normalize01(h);
  }

  // Worley noise with a periodic jittered grid: F2 minus F1 gives raised stones
  // with mortar valleys along the cell borders.
  function cobblestone(size, seed) {
    const rng = mulberry32(seed);
    const cells = 6;
    const pts = [];
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) pts.push([(i + 0.15 + rng() * 0.7) / cells, (j + 0.15 + rng() * 0.7) / cells]);
    }
    const h = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size;
        const v = (y + 0.5) / size;
        let f1 = Infinity;
        let f2 = Infinity;
        for (const p of pts) {
          let dx = Math.abs(u - p[0]); dx = Math.min(dx, 1 - dx);
          let dy = Math.abs(v - p[1]); dy = Math.min(dy, 1 - dy);
          const d = Math.hypot(dx, dy);
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
        h[y * size + x] = smooth(clamp01((f2 - f1) * cells * 1.6));
      }
    }
    const grain = fbm(size, seed + 1, 3);
    for (let i = 0; i < h.length; i++) h[i] = h[i] * 0.88 + grain[i] * 0.12;
    return normalize01(h);
  }

  // Hexagonal tiles on a lattice that repeats exactly over the map: two tile
  // columns of width size/4 and rows of height size/4.
  function hexTiles(size, seed) {
    const grain = fbm(size, seed, 3);
    const h = new Float32Array(size * size);
    const cols = 4;
    const rows = 4;
    const w = size / cols;
    const r = size / rows;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let best = Infinity;
        let second = Infinity;
        for (let j = -1; j <= rows; j++) {
          for (let i = -1; i <= cols; i++) {
            const cx = (i + (j & 1 ? 0.5 : 0)) * w;
            const cy = j * r;
            const dx = x + 0.5 - cx;
            const dy = (y + 0.5 - cy) * 1.15;
            const d = Math.max(Math.abs(dx) * 0.866 + Math.abs(dy) * 0.5, Math.abs(dy));
            if (d < best) { second = best; best = d; } else if (d < second) second = d;
          }
        }
        h[y * size + x] = smooth(clamp01((second - best) / 3)) * 0.9 + grain[y * size + x] * 0.1;
      }
    }
    return normalize01(h);
  }

  function corrodedNoise(size, seed) {
    const base = fbm(size, seed, 5);
    const pits = fbm(size, seed + 99, 3);
    const h = new Float32Array(size * size);
    for (let i = 0; i < h.length; i++) h[i] = base[i] - 0.6 * Math.max(0, 0.42 - pits[i]);
    return normalize01(h);
  }

  const BUILDERS = [rivetedPlates, cobblestone, hexTiles, corrodedNoise];

  function heightField(pattern, size, seed) {
    const index = Math.max(0, Math.min(BUILDERS.length - 1, pattern | 0));
    if (!(size >= 8 && size <= 512 && (size & (size - 1)) === 0)) throw new RangeError("map size must be a power of two from 8 to 512");
    return BUILDERS[index](size, seed >>> 0);
  }

  /* ---------------------------------------------------------------- maps */

  // Sobel gradient with wrap-around, in height units per texel.
  function gradient(h, size, x, y) {
    const at = (i, j) => h[wrap(j, size) * size + wrap(i, size)];
    const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
    const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
    return [gx, gy];
  }

  // Tangent-space normals, OpenGL convention (green points up the map, so +y
  // in the map is down the image and the y component is flipped).
  function normalMap(h, size, strength) {
    const n = new Float32Array(size * size * 3);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [gx, gy] = gradient(h, size, x, y);
        let nx = -gx * strength;
        let ny = gy * strength;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len; ny /= len; nz /= len;
        const o = (y * size + x) * 3;
        n[o] = nx; n[o + 1] = ny; n[o + 2] = nz;
      }
    }
    return n;
  }

  function encodeNormal(nx, ny, nz) {
    return [Math.round((nx * 0.5 + 0.5) * 255), Math.round((ny * 0.5 + 0.5) * 255), Math.round((nz * 0.5 + 0.5) * 255)];
  }

  function decodeNormal(r, g, b) {
    return [(r / 255) * 2 - 1, (g / 255) * 2 - 1, (b / 255) * 2 - 1];
  }

  // Horizon-based ambient occlusion on the height field. For each texel and each
  // of `directions` evenly spaced directions, march out to `radius` texels and
  // keep the steepest rise. Occlusion is the mean sine of those horizon angles,
  // so a flat map gives 1 and a deep pit approaches 0. `depth` converts height
  // units (0 to 1) into texels.
  function aoMap(h, size, radius, directions, depth) {
    const ao = new Float32Array(size * size);
    const dirs = [];
    for (let k = 0; k < directions; k++) {
      const a = (k / directions) * Math.PI * 2;
      dirs.push([Math.cos(a), Math.sin(a)]);
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const h0 = h[y * size + x] * depth;
        let occ = 0;
        for (const [dx, dy] of dirs) {
          let maxSin = 0;
          for (let s = 1; s <= radius; s++) {
            const sx = wrap(Math.round(x + dx * s), size);
            const sy = wrap(Math.round(y + dy * s), size);
            const rise = h[sy * size + sx] * depth - h0;
            if (rise > 0) {
              const sin = rise / Math.hypot(rise, s);
              if (sin > maxSin) maxSin = sin;
            }
          }
          occ += maxSin;
        }
        ao[y * size + x] = 1 - occ / directions;
      }
    }
    return ao;
  }

  // Discrete Laplacian with wrap. Positive in valleys (concave), negative on ridges.
  function curvatureMap(h, size) {
    const c = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const at = (i, j) => h[wrap(j, size) * size + wrap(i, size)];
        c[y * size + x] = at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * at(x, y);
      }
    }
    return c;
  }

  // Roughness derived from geometry: crevices hold grime and read rough, worn
  // ridges polish smooth. A heuristic, labeled as such in the interface.
  function roughnessMap(curv, ao, size) {
    let scale = 0;
    for (const v of curv) scale = Math.max(scale, Math.abs(v));
    scale = scale || 1;
    const r = new Float32Array(size * size);
    for (let i = 0; i < r.length; i++) r[i] = clamp01(0.45 + 0.35 * (curv[i] / scale) + 0.25 * (1 - ao[i]));
    return r;
  }

  function synthesize(options) {
    const o = Object.assign({}, MAP_DEFAULTS, options || {});
    const size = o.size;
    const height = heightField(o.pattern, size, o.seed);
    const normal = normalMap(height, size, o.strength);
    const ao = aoMap(height, size, o.aoRadius, o.aoDirections, o.aoDepth);
    const curvature = curvatureMap(height, size);
    const roughness = roughnessMap(curvature, ao, size);
    return { options: o, size, height, normal, ao, curvature, roughness, stats: mapStats({ size, height, normal, ao, roughness }) };
  }

  // Quality checks that the interface reports: the largest deviation of a
  // normal from unit length, the largest seam jump in the height field across
  // the wrap edge compared with its largest interior jump, and map means.
  function mapStats(maps) {
    const { size, height, normal, ao, roughness } = maps;
    let unitErr = 0;
    for (let i = 0; i < size * size; i++) {
      const l = Math.hypot(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]);
      unitErr = Math.max(unitErr, Math.abs(l - 1));
    }
    let interior = 0;
    let seam = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = height[y * size + x];
        const right = height[y * size + wrap(x + 1, size)];
        const down = height[wrap(y + 1, size) * size + x];
        const rightJump = Math.abs(v - right);
        const downJump = Math.abs(v - down);
        if (x === size - 1) seam = Math.max(seam, rightJump);
        else interior = Math.max(interior, rightJump);
        if (y === size - 1) seam = Math.max(seam, downJump);
        else interior = Math.max(interior, downJump);
      }
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    return { normalUnitError: unitErr, seamJump: seam, interiorJump: interior, seamRatio: interior > 0 ? seam / interior : 0, aoMean: mean(ao), roughnessMean: mean(roughness) };
  }

  /* ------------------------------------------------------ dither and light */

  // Bayer threshold in (0, 1) by bit interleaving, the same construction and
  // the same half-cell offset as the fragment shader: n is 2, 4 or 8.
  function bayer(x, y, n) {
    const bits = Math.log2(n) | 0;
    let v = 0;
    for (let b = 0; b < bits; b++) {
      const xb = (x >> b) & 1;
      const yb = (y >> b) & 1;
      v = (v << 2) | (((xb ^ yb) << 1) | yb);
    }
    return (v + 0.5) / (n * n);
  }

  function bayerMatrix(n) {
    const m = [];
    for (let y = 0; y < n; y++) {
      const row = [];
      for (let x = 0; x < n; x++) row.push(Math.floor(bayer(x, y, n) * n * n));
      m.push(row);
    }
    return m;
  }

  // Ordered-dither quantizer, line for line with the shader:
  //   v = clamp(luma) + (threshold - 0.5) * spread / steps
  //   q = floor(clamp(v) * steps + 0.5)
  function quantize(value, threshold, levels, spread) {
    const steps = Math.max(levels - 1, 1);
    const v = clamp01(value) + ((threshold - 0.5) * spread) / steps;
    return Math.floor(clamp01(v) * steps + 0.5);
  }

  // The shader's palette ramp: q in [0, 1] blends between neighbouring stops.
  function rampColor(stops, q) {
    const f = clamp01(q) * (stops.length - 1);
    const i = Math.max(0, Math.min(stops.length - 2, Math.floor(f)));
    const t = f - i;
    return [0, 1, 2].map((c) => Math.round(stops[i][c] + (stops[i + 1][c] - stops[i][c]) * t));
  }

  // Lambert diffuse with ambient scaled by AO, under a light at azimuth `angle`
  // (radians, the same angle as the shader's light uniform) and elevation `elev`.
  function shade(maps, angle, elev) {
    const { size, normal, ao } = maps;
    const lx = Math.cos(angle) * Math.cos(elev);
    const ly = Math.sin(angle) * Math.cos(elev);
    const lz = Math.sin(elev);
    const out = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const ndl = Math.max(0, normal[i * 3] * lx + normal[i * 3 + 1] * ly + normal[i * 3 + 2] * lz);
      out[i] = clamp01(0.18 * ao[i] + 0.82 * ndl * (0.55 + 0.45 * ao[i]));
    }
    return out;
  }

  // Palette indices for a shaded map. ditherMode follows the app: 0, 1, 2 are
  // Bayer 2, 4, 8 and 3 is a scanline triangle wave with `scanPeriod` rows.
  function ditherToPalette(values, size, levels, spread, ditherMode, scanPeriod) {
    const idx = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let t;
        if (ditherMode >= 3) {
          const p = Math.max(2, scanPeriod || 6);
          const ph = ((y + 0.5) / p) % 1;
          t = Math.abs(ph * 2 - 1);
        } else {
          t = bayer(x, y, 2 << ditherMode);
        }
        idx[y * size + x] = quantize(values[y * size + x], t, levels, spread);
      }
    }
    return idx;
  }

  /* --------------------------------------------------------------- pixels */

  // RGBA pixels for one map channel, ready for ImageData.
  function toRgba(maps, which, ramp) {
    const { size } = maps;
    const px = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      let r;
      let g;
      let b;
      if (which === "normal") {
        [r, g, b] = encodeNormal(maps.normal[i * 3], maps.normal[i * 3 + 1], maps.normal[i * 3 + 2]);
      } else if (which === "lit" && ramp) {
        [r, g, b] = rampColor(ramp, maps.litIndex[i] / Math.max(maps.litLevels - 1, 1));
      } else {
        const v = which === "height" ? maps.height[i] : which === "ao" ? maps.ao[i] : maps.roughness[i];
        r = g = b = Math.round(clamp01(v) * 255);
      }
      px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
    }
    return px;
  }

  return {
    PATTERNS,
    MAP_DEFAULTS,
    mulberry32,
    heightField,
    gradient,
    normalMap,
    encodeNormal,
    decodeNormal,
    aoMap,
    curvatureMap,
    roughnessMap,
    synthesize,
    mapStats,
    bayer,
    bayerMatrix,
    quantize,
    rampColor,
    shade,
    ditherToPalette,
    toRgba
  };
}));
