const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../js/texel-maps.js');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

function standInGpu(values) {
  const names = ['u_levels', 'u_spread'];
  const gl = {
    FLOAT: 5126, VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713, LINK_STATUS: 35714, ACTIVE_UNIFORMS: 35718,
    ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, TRIANGLES: 4,
    createShader: () => ({}),
    createProgram: () => ({}),
    createVertexArray: () => ({}),
    createBuffer: () => ({}),
    getShaderParameter: () => true,
    getShaderSource: () => 'void main() {}',
    getProgramParameter(_program, parameter) {
      return parameter === this.ACTIVE_UNIFORMS ? names.length : parameter === this.LINK_STATUS;
    },
    getActiveUniform: (_program, index) => ({ name: names[index], type: 5126, size: 1 }),
    getUniformLocation: (_program, name) => name,
    getUniform: (_program, name) => values.get(name) ?? 0,
    uniform1f(name, value) { if (name !== null) values.set(name, value); }
  };
  for (const name of [
    'shaderSource', 'compileShader', 'attachShader', 'bindAttribLocation', 'linkProgram',
    'useProgram', 'bindVertexArray', 'bindBuffer', 'bufferData', 'enableVertexAttribArray',
    'vertexAttribPointer', 'uniform2f', 'uniformMatrix3fv', 'uniform3fv', 'uniform1i',
    'drawArrays', 'viewport'
  ]) gl[name] = () => {};
  return gl;
}

function bootPage(hash = '', { gpu = false } = {}) {
  const nodes = [];
  const byId = new Map();
  const documentListeners = new Map();
  const timers = new Map();
  const frames = [];
  const hashWrites = [];
  const gpuValues = new Map();
  const context = gpu ? standInGpu(gpuValues) : null;
  const syntheses = [];
  const location = { hash };
  let timerId = 0;
  let clock = 0;

  function element(tag, attrs = {}) {
    const listeners = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      attributes: {},
      children: [],
      dataset: {},
      style: { setProperty() {} },
      classList: { add() {}, remove() {} },
      hidden: false,
      checked: false,
      textContent: '',
      value: '',
      setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (['id', 'name', 'value', 'type', 'min', 'max'].includes(name)) this[name] = String(value);
        if (name === 'hidden') this.hidden = true;
        if (name === 'id') byId.set(String(value), this);
      },
      append(...children) { this.children.push(...children); },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(listener);
      },
      fire(type, event = {}) {
        for (const listener of listeners.get(type) || []) listener({ target: this, preventDefault() {}, ...event });
      },
      focus() { document.activeElement = this; },
      setPointerCapture() {},
      getBoundingClientRect() { return { width: 640, height: 480 }; },
      getContext(kind) {
        if (kind === 'webgl2') return context;
        return {
          createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
          putImageData() {}
        };
      }
    };
    nodes.push(node);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  }

  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
  for (const match of markup.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] || '']));
    if (attrs.id) element(match[1], attrs);
  }
  const document = {
    activeElement: null,
    body: element('body'),
    createElement: element,
    querySelector(selector) {
      if (selector.startsWith('#')) return byId.get(selector.slice(1));
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const name = selector.match(/^input\[name="([^"]+)"\]$/);
      assert.ok(name, `supported selector: ${selector}`);
      return nodes.filter((node) => node.tagName === 'INPUT' && node.name === name[1]);
    },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    }
  };
  const window = {
    TexelMaps: {
      ...T,
      synthesize(options) {
        syntheses.push(JSON.parse(JSON.stringify(options)));
        return T.synthesize(options);
      }
    },
    matchMedia: () => ({ matches: false }),
    addEventListener() {}
  };
  vm.runInNewContext(inline[0], {
    document,
    window,
    location,
    URLSearchParams,
    history: { replaceState(_state, _title, url) { location.hash = url; hashWrites.push(url); } },
    setTimeout(callback, delay = 0) { timers.set(++timerId, { callback, at: clock + delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { frames.push(callback); },
    ResizeObserver: class { observe() {} },
    WebGL2RenderingContext: {
      FLOAT: 5126, INT: 5124, BOOL: 35670,
      FLOAT_VEC2: 35664, FLOAT_VEC3: 35665, FLOAT_VEC4: 35666,
      INT_VEC2: 35667, INT_VEC3: 35668, INT_VEC4: 35669,
      BOOL_VEC2: 35671, BOOL_VEC3: 35672, BOOL_VEC4: 35673,
      FLOAT_MAT2: 35674, FLOAT_MAT3: 35675, FLOAT_MAT4: 35676,
      SAMPLER_2D: 35678
    },
    performance: { now: () => clock }
  });
  if (gpu) assert.equal(byId.get('linkState').dataset.ok, 'true');
  else assert.equal(byId.get('noticeTitle').textContent, 'WebGL 2 is not available', 'the page boots through all controls without a GPU');
  return {
    byId,
    syntheses,
    location,
    hashWrites,
    gpuValues,
    frame(now) {
      clock = now;
      const callback = frames.shift();
      assert.ok(callback, 'an animation frame is scheduled');
      callback(now);
      for (const [id, timer] of [...timers]) {
        if (timer.at <= clock) { timers.delete(id); timer.callback(); }
      }
    },
    flushHash() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((timer) => timer.callback());
    },
    pattern(value) {
      return nodes.find((node) => node.name === 'mappattern' && node.value === String(value));
    },
    radio(name, value) {
      return nodes.find((node) => node.name === name && node.value === String(value));
    },
    uniformNumber(name) {
      return nodes.find((node) => node.type === 'number' && node.attributes['aria-label'] === name + ' value');
    },
    input(id, value) {
      const node = byId.get(id);
      node.value = String(value);
      node.fire('input');
    }
  };
}

test('page: the inline application script parses', () => {
  assert.equal(inline.length, 1);
  assert.doesNotThrow(() => new vm.Script(inline[0], { filename: 'index.html inline script' }));
});

test('page: the maps module loads before the inline script', () => {
  const moduleAt = html.indexOf('<script src="js/texel-maps.js"></script>');
  const inlineAt = html.indexOf('<script>');
  assert.ok(moduleAt > 0 && moduleAt < inlineAt);
  assert.ok(fs.existsSync(path.join(root, 'js/texel-maps.js')));
});

test('page: the inspector has three wired tabs, each controlling its own panel', () => {
  for (const [tab, panel] of [['tabUniforms', 'panelUniforms'], ['tabSource', 'panelSource'], ['tabMaps', 'panelMaps']]) {
    assert.match(html, new RegExp(`id="${tab}" aria-controls="${panel}"`));
    assert.match(html, new RegExp(`id="${panel}" role="tabpanel" aria-labelledby="${tab}"`));
  }
  assert.match(inline[0], /const tabs = \[\$\("#tabUniforms"\), \$\("#tabSource"\), \$\("#tabMaps"\)\]/);
  assert.match(inline[0], /select\(\(i \+ 1\) % n, true\)/, 'arrow keys cycle through all tabs');
});

test('page: the maps panel has its controls, five map canvases, stats and a computed-data badge', () => {
  for (const id of ['mapKeys', 'mapStrength', 'mapRadius', 'mapSeedBtn', 'mapExportBtn', 'mapHeight', 'mapNormal', 'mapAo', 'mapRough', 'mapLit', 'statUnit', 'statSeam', 'statAo', 'statTime']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  for (const m of html.matchAll(/<canvas id="map\w+"[^>]*>/g)) {
    assert.match(m[0], /role="img"/);
    assert.match(m[0], /aria-label="[^"]{15,}"/);
  }
  assert.match(html, /<label for="mapStrength">/);
  assert.match(html, /<label for="mapRadius">/);
  assert.match(html, /class="data-badge">Computed in this tab</);
  assert.match(html, /image-rendering: pixelated/);
});

test('page: changing every Maps control writes a share link that restores controls and synthesis', () => {
  const page = bootPage('#g=3&d=2&p=1&yaw=1.25&pit=-0.4&z=5&t=4');
  const pattern = page.pattern(3);
  pattern.checked = true;
  page.byId.get('mapKeys').fire('change', { target: pattern });
  page.input('mapStrength', 9);
  page.input('mapRadius', 10);
  page.byId.get('mapSeedBtn').fire('click');
  assert.equal(page.syntheses.length, 0, 'controls still persist while the Maps panel is hidden');
  page.flushHash();
  const hash = new URLSearchParams(page.location.hash.slice(1));
  for (const [key, value] of [['mp', '3'], ['mb', '9'], ['mr', '10'], ['g', '3'], ['d', '2'], ['p', '1'], ['yaw', '1.250'], ['pit', '-0.400'], ['z', '5.000'], ['t', '4.00']]) {
    assert.equal(hash.get(key), value, key);
  }
  const seed = Number(hash.get('ms'));
  assert.ok(Number.isInteger(seed) && seed !== 7, 'the new seed is serialized exactly');
  page.byId.get('tabMaps').fire('click');
  assert.deepEqual(page.syntheses[0], { pattern: 3, seed, strength: 9, aoRadius: 10 });

  const restored = bootPage(page.location.hash);
  assert.equal(restored.pattern(3).checked, true);
  assert.equal(restored.pattern(0).checked, false);
  assert.equal(restored.byId.get('mapStrength').value, '9');
  assert.equal(restored.byId.get('mapStrengthOut').textContent, '9');
  assert.equal(restored.byId.get('mapRadius').value, '10');
  assert.equal(restored.byId.get('mapRadiusOut').textContent, '10 texels');
  restored.byId.get('tabMaps').fire('click');
  assert.deepEqual(restored.syntheses, page.syntheses);
  assert.equal(restored.byId.get('statSeam').textContent, page.byId.get('statSeam').textContent);
  assert.equal(restored.byId.get('statAo').textContent, page.byId.get('statAo').textContent);
});

test('page: integer scene and Maps controls commit rounded values before rendering and sharing', () => {
  const page = bootPage('#t=4', { gpu: true });
  for (const id of ['geoKeys', 'ditherKeys', 'palKeys']) {
    page.byId.get(id).fire('change', { target: { value: '1.5' } });
  }
  page.input('texel', 3.5);
  page.byId.get('mapKeys').fire('change', { target: { value: '1.5' } });
  page.input('mapStrength', 4.5);
  page.input('mapRadius', 5.5);
  const levels = page.uniformNumber('u_levels');
  assert.ok(levels);
  levels.focus();
  levels.value = '3.5';
  levels.fire('input');
  assert.equal(levels.value, '3.5', 'the textbox preserves the active draft');
  assert.equal(Number(page.byId.get('texel').value), 4);
  assert.equal(page.byId.get('texelOut').textContent, '4 px');
  assert.equal(Number(page.byId.get('mapStrength').value), 5);
  assert.equal(Number(page.byId.get('mapRadius').value), 6);
  page.frame(100);
  assert.equal(page.gpuValues.get('u_levels'), 4);
  page.flushHash();
  const hash = new URLSearchParams(page.location.hash.slice(1));
  for (const [key, value] of [['g', '2'], ['d', '2'], ['p', '2'], ['x', '4'], ['l', '4'], ['mp', '2'], ['mb', '5'], ['mr', '6']]) {
    assert.equal(hash.get(key), value, key);
  }
  levels.fire('change');
  assert.equal(levels.value, '4');
  const restored = bootPage(page.location.hash, { gpu: true });
  restored.frame(100);
  assert.equal(restored.gpuValues.get('u_levels'), 4);
  assert.equal(Number(restored.uniformNumber('u_levels').value), 4);
  assert.equal(Number(restored.byId.get('texel').value), 4);
  for (const name of ['geometry', 'dither', 'palette']) {
    assert.equal(restored.radio(name, 2).checked, true);
  }
  assert.equal(restored.pattern(2).checked, true);
  assert.equal(Number(restored.byId.get('mapStrength').value), 5);
  assert.equal(Number(restored.byId.get('mapRadius').value), 6);
  restored.byId.get('tabMaps').fire('click');
  assert.deepEqual(restored.syntheses[0], { pattern: 2, seed: 7, strength: 5, aoRadius: 6 });

  levels.value = '1';
  levels.fire('input');
  assert.equal(levels.value, '1', 'minimum clamping must not replace the first digit while typing');
  levels.value += '0';
  levels.fire('input');
  assert.equal(levels.value, '10');
  page.frame(200);
  page.flushHash();
  assert.equal(page.gpuValues.get('u_levels'), 10);
  assert.equal(new URLSearchParams(page.location.hash.slice(1)).get('l'), '10');
  levels.fire('change');
  assert.equal(levels.value, '10');
});

test('page: continuous uniform controls retain fractional values when committing and sharing', () => {
  const page = bootPage('#t=4', { gpu: true });
  const spread = page.uniformNumber('u_spread');
  spread.focus();
  spread.value = '0.375';
  spread.fire('input');
  page.frame(100);
  assert.equal(page.gpuValues.get('u_spread'), 0.375);
  page.flushHash();
  assert.equal(new URLSearchParams(page.location.hash.slice(1)).get('s'), '0.375');
  const restored = bootPage(page.location.hash, { gpu: true });
  restored.frame(100);
  assert.equal(restored.gpuValues.get('u_spread'), 0.375);
});

test('page: the share hash waits for inertia and serializes the settled camera and zoom', () => {
  const page = bootPage('#yaw=0.5&pit=0.2&z=5&t=4');
  const display = page.byId.get('display');
  display.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  page.frame(16);
  display.fire('pointermove', { pointerId: 1, clientX: 136, clientY: 112 });
  display.fire('pointerup', { pointerId: 1 });
  let yaw = 0.5 - 36 * 0.007;
  let pitch = 0.2 + 12 * 0.007;
  let vx = (-36 * 0.007 / 0.016) * 0.4;
  let vy = (12 * 0.007 / 0.016) * 0.4;
  const decay = Math.pow(0.03, 0.016);
  for (let i = 2; i <= 150; i++) {
    if (i === 40) display.fire('wheel', { deltaY: 80 });
    if (Math.abs(vx) > 0.01 || Math.abs(vy) > 0.01) {
      yaw += vx * 0.016;
      pitch = Math.min(1.45, Math.max(-1.45, pitch + vy * 0.016));
      vx *= decay;
      vy *= decay;
    } else { vx = vy = 0; }
    page.frame(i * 16);
    if (i === 60) assert.equal(page.hashWrites.length, 0, 'inertia keeps rescheduling the pending hash write');
  }
  assert.equal(vx, 0);
  assert.equal(vy, 0);
  assert.equal(page.hashWrites.length, 1);
  const hash = new URLSearchParams(page.location.hash.slice(1));
  assert.equal(hash.get('yaw'), yaw.toFixed(3));
  assert.equal(hash.get('pit'), pitch.toFixed(3));
  assert.equal(hash.get('z'), (5 * Math.exp(80 * 0.0012)).toFixed(3));
  const restored = bootPage(page.location.hash);
  restored.input('mapStrength', 6);
  restored.flushHash();
  const reopened = new URLSearchParams(restored.location.hash.slice(1));
  for (const key of ['yaw', 'pit', 'z']) assert.equal(reopened.get(key), hash.get(key));
});

test('page: Maps hashes retain legacy defaults and normalize invalid or out-of-range settings', () => {
  for (const [hash, options] of [
    ['#g=3&d=2&p=1&t=4', { pattern: 0, seed: 7, strength: 4, aoRadius: 6 }],
    ['#mp=bogus&ms=123junk&mb=NaN&mr=Infinity', { pattern: 0, seed: 7, strength: 4, aoRadius: 6 }],
    ['#mp=&ms=&mb=&mr=', { pattern: 0, seed: 7, strength: 4, aoRadius: 6 }],
    ['#mp=99&ms=-9&mb=100&mr=0', { pattern: 3, seed: 0, strength: 12, aoRadius: 2 }],
    ['#mp=1.6&ms=10.6&mb=3.6&mr=5.6', { pattern: 2, seed: 11, strength: 4, aoRadius: 6 }],
    ['#ms=2147483646', { pattern: 0, seed: 2147483646, strength: 4, aoRadius: 6 }]
  ]) {
    const page = bootPage(hash);
    assert.equal(page.pattern(options.pattern).checked, true, hash);
    assert.equal(page.byId.get('mapStrength').value, String(options.strength));
    assert.equal(page.byId.get('mapRadius').value, String(options.aoRadius));
    page.byId.get('tabMaps').fire('click');
    assert.deepEqual(page.syntheses[0], options);
  }
});

test('page: seed-7 seam readouts show the actual wrap maxima to six decimals', () => {
  const expected = [
    '0.005425 / 0.535391',
    '0.369449 / 0.402691',
    '0.002372 / 0.733585',
    '0.087676 / 0.187647'
  ];
  for (let pattern = 0; pattern < expected.length; pattern += 1) {
    const page = bootPage(`#mp=${pattern}&ms=7`);
    page.byId.get('tabMaps').fire('click');
    assert.equal(page.byId.get('statSeam').textContent, expected[pattern]);
  }
});

test('docs: default map figures match recomputed seed-7 statistics', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const update = fs.readFileSync(path.join(root, 'DEVPOST_UPGRADE.md'), 'utf8');
  for (let pattern = 0; pattern < T.PATTERNS.length; pattern += 1) {
    const stats = T.synthesize({ pattern, size: 64, seed: 7 }).stats;
    const cells = [T.PATTERNS[pattern].name, stats.seamJump.toFixed(6), stats.interiorJump.toFixed(6), stats.aoMean.toFixed(6)];
    assert.ok(update.includes('| ' + cells.join(' | ') + ' |'));
    assert.ok(readme.includes('| ' + [...cells, stats.roughnessMean.toFixed(6)].join(' | ') + ' |'));
  }
  for (const key of ['mp', 'ms', 'mb', 'mr']) assert.ok(readme.includes('`' + key + '`'));
});

test('page: M opens the maps tab from anywhere except text fields, and the key is shown on the tab', () => {
  assert.match(html, /Maps <kbd>M<\/kbd>/);
  assert.match(inline[0], /e\.key === "m" \|\| e\.key === "M"/);
  assert.match(inline[0], /if \(e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\) return;/);
});

test('page: the atlas export writes all four maps plus the lit preview', () => {
  assert.match(inline[0], /const names = \["height", "normal", "ao", "roughness"\]/);
  assert.match(inline[0], /out\.width = size \* scale \* 5/);
  assert.match(inline[0], /"texelforge-maps-"/);
});

test('page: the title stands alone, with no tagline under it and no helper lines under legends', () => {
  assert.match(html, /<h1>TexelForge<\/h1>\s*<\/div>/);
  assert.ok(!/<p class="hint">/.test(html));
});
