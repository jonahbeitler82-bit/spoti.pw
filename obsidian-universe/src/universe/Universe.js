import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildLayout, computeColors } from './layout.js';
import {
  NEBULA_VERT, NEBULA_FRAG, STAR_VERT, STAR_FRAG, LINK_VERT, LINK_FRAG, DUST_VERT, DUST_FRAG, morphPosition,
} from './shaders.js';
import { mulberry32 } from './noise.js';
import { rgbToCss } from '../palettes.js';

const MORPH_SECONDS = 3;
const GROW_SECONDS = 16;
const toLinear = (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = Math.pow(arr[i], 2.2); return arr; };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Universe {
  constructor(container, data, { mini = false, scheme = 'neon', onSelect, onHover, onGrow } = {}) {
    this.container = container;
    this.data = data;
    this.mini = mini;
    this.scheme = scheme;
    this.onSelect = onSelect || (() => {});
    this.onHover = onHover || (() => {});
    this.onGrow = onGrow || (() => {});
    this.morph = 0;
    this.morphTarget = 0;
    this.grow = { active: false, playing: false, t: 1 };
    this.selected = -1;
    this.hovered = -1;
    this.shift = 0;
    this.shiftTarget = 0;
    this.labelsVisible = !mini;
    this.running = false;
    this.fps = 0;
    this._frames = 0;
    this._fpsT = performance.now();
    this._tmp = new Float32Array(3);
    this._vec = new THREE.Vector3();

    this.layout = buildLayout(data, { budget: mini ? 11000 : 44000 });
    this._initRenderer();
    this._initScene();
    this._applyColors();
    if (!mini) this._initLabels();
    this._initInput();
    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
  }

  // ---------- setup ----------

  _initRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // pure black: a tinted clear colour comes out lifted once the output pass encodes it
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.NoToneMapping;
    this.container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    this.renderer = renderer;
    this.canvas = renderer.domElement;

    const R = this.layout.radius;
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 12000);
    this.homeDistance = this.mini ? R * 1.8 : R * 2.1;
    this.brainDistance = this.layout.brainScale * 3.3;
    this.camera.position.set(0, R * 0.62, this.homeDistance).setLength(this.homeDistance);
    this.scene = new THREE.Scene();

    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.06, rotateSpeed: 0.5, zoomSpeed: 0.9, panSpeed: 0.6,
      minDistance: 12, maxDistance: R * 6, autoRotate: !this.mini, autoRotateSpeed: 0.22,
    });
    this.controls.enabled = !this.mini;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), this.mini ? 0.8 : 0.9, 0.42, 0.16);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _initScene() {
    const L = this.layout;
    this.uniforms = {
      uMorph: { value: 0 }, uTime: { value: 0 }, uGrow: { value: 2 }, uPixelRatio: { value: 1 }, uScale: { value: 500 },
      uSel: { value: -1 }, uHover: { value: -1 }, uSizeMul: { value: this.mini ? 1.25 : 1 }, uStarMul: { value: this.mini ? 1.3 : 1 },
      uIntensity: { value: this.mini ? 0.4 : 0.34 }, uLinkAlpha: { value: this.mini ? 0.1 : 0.13 }, uBrainDim: { value: 0.5 },
    };
    const mat = (vertexShader, fragmentShader) => new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // background star dust
    const rand = mulberry32(99);
    const D = this.mini ? 1400 : 7000;
    const dPos = new Float32Array(D * 3), dSize = new Float32Array(D), dRand = new Float32Array(D), dCol = new Float32Array(D * 3);
    for (let i = 0; i < D; i++) {
      const far = i < D * 0.72;
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const dist = far ? 2500 + rand() * 5000 : L.radius * (0.2 + Math.cbrt(rand()) * 1.6);
      dPos.set([Math.cos(th) * r * dist, u * dist * (far ? 1 : 0.6), Math.sin(th) * r * dist], i * 3);
      dSize[i] = far ? 0.8 + Math.pow(rand(), 4) * 2.2 : 0.7 + rand() * 0.8;
      dRand[i] = rand();
      const tint = rand();
      const b = far ? 0.25 + rand() * 0.5 : 0.12 + rand() * 0.18;
      const c = tint < 0.33 ? [0.75, 0.82, 1] : tint < 0.66 ? [1, 0.95, 0.9] : [0.9, 0.85, 1];
      dCol.set(toLinear(new Float32Array(c.map((v) => v * b))), i * 3);
    }
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    dGeo.setAttribute('aSize', new THREE.BufferAttribute(dSize, 1));
    dGeo.setAttribute('aRand', new THREE.BufferAttribute(dRand, 1));
    dGeo.setAttribute('aColor', new THREE.BufferAttribute(dCol, 3));
    this.dust = new THREE.Points(dGeo, mat(DUST_VERT, DUST_FRAG));
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);

    const geo = (spec, extra) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(spec.gal, 3)); // used for bounds only
      g.setAttribute('aGal', new THREE.BufferAttribute(spec.gal, 3));
      g.setAttribute('aBrain', new THREE.BufferAttribute(spec.brain, 3));
      g.setAttribute('aColorA', new THREE.BufferAttribute(new Float32Array(spec.count * 3), 3));
      g.setAttribute('aColorB', new THREE.BufferAttribute(new Float32Array(spec.count * 3), 3));
      g.setAttribute('aRand', new THREE.BufferAttribute(spec.rnd, 1));
      g.setAttribute('aBirth', new THREE.BufferAttribute(spec.birth, 1));
      for (const [name, arr, n] of extra) g.setAttribute(name, new THREE.BufferAttribute(arr, n));
      return g;
    };

    this.links = new THREE.LineSegments(
      geo(L.links, [['aT', L.links.t, 1], ['aEnds', L.links.ends, 2], ['aSeed', L.links.seed, 1]]),
      mat(LINK_VERT, LINK_FRAG),
    );
    this.nebula = new THREE.Points(geo(L.nebula, [['aSize', L.nebula.size, 1]]), mat(NEBULA_VERT, NEBULA_FRAG));
    this.stars = new THREE.Points(geo(L.stars, [['aSize', L.stars.size, 1], ['aId', L.stars.id, 1]]), mat(STAR_VERT, STAR_FRAG));
    for (const o of [this.links, this.nebula, this.stars]) { o.frustumCulled = false; this.group.add(o); }
  }

  _applyColors() {
    const c = computeColors(this.layout, this.scheme);
    const set = (obj, [a, b]) => {
      obj.geometry.attributes.aColorA.array.set(toLinear(a));
      obj.geometry.attributes.aColorB.array.set(toLinear(b));
      obj.geometry.attributes.aColorA.needsUpdate = true;
      obj.geometry.attributes.aColorB.needsUpdate = true;
    };
    set(this.nebula, c.nebula);
    set(this.stars, c.stars);
    set(this.links, c.links);
    this.galaxyColors = c.galaxyColors;
    if (this.labels) this.labels.forEach((l) => this._drawLabel(l, true));
  }

  setScheme(key) {
    this.scheme = key;
    this._applyColors();
  }

  // ---------- labels (drawn in WebGL so they show up in recordings) ----------

  _initLabels() {
    this.labelScene = new THREE.Scene();
    this.labels = this.layout.galaxies.map((g, i) => {
      const canvas = document.createElement('canvas');
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
      sprite.center.set(0.5, -0.35);
      sprite.renderOrder = 10;
      this.labelScene.add(sprite);
      const top = g.rot(0, g.radius * 0.18, 0);
      return {
        i, g, canvas, tex, sprite, count: -1, px: [1, 1],
        galPos: [g.center[0] + top[0], g.center[1] + top[1] + g.radius * 0.28, g.center[2] + top[2]],
        brainPos: g.brainLabel,
        times: g.notes.map((id) => this.layout.stars.birth[id]).sort((a, b) => a - b),
      };
    });
    this.labels.forEach((l) => this._drawLabel(l, true));
  }

  _drawLabel(l, force) {
    const count = this.grow.active ? countBelow(l.times, this.grow.t) : l.g.count;
    if (!force && count === l.count) return;
    l.count = count;
    const dpr = 2;
    const ctx = l.canvas.getContext('2d');
    const font = '500 12px "JetBrains Mono", ui-monospace, Menlo, monospace';
    const name = l.g.name.toUpperCase();
    ctx.font = font;
    const spacing = 2.6;
    const measure = (s) => [...s].reduce((w, ch) => w + ctx.measureText(ch).width + spacing, 0);
    const wName = measure(name), wCount = measure(String(count));
    const w = Math.ceil(18 + wName + 8 + wCount + 8), h = 26;
    l.canvas.width = w * dpr; l.canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.font = font;
    ctx.textBaseline = 'middle';
    const col = this.galaxyColors[l.i];
    ctx.shadowColor = rgbToCss(col, 0.9);
    ctx.shadowBlur = 8;
    ctx.fillStyle = rgbToCss(col);
    ctx.beginPath(); ctx.arc(7, h / 2, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = rgbToCss(col.map((v) => v + (1 - v) * 0.45));
    let x = 18;
    for (const ch of name) { ctx.fillText(ch, x, h / 2 + 0.5); x += ctx.measureText(ch).width + spacing; }
    x += 8;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const ch of String(count)) { ctx.fillText(ch, x, h / 2 + 0.5); x += ctx.measureText(ch).width + spacing; }
    l.tex.dispose();
    l.tex = new THREE.CanvasTexture(l.canvas);
    l.tex.colorSpace = THREE.SRGBColorSpace;
    l.tex.minFilter = THREE.LinearFilter;
    l.sprite.material.map = l.tex;
    l.sprite.material.needsUpdate = true;
    l.px = [w, h];
    this._scaleLabel(l);
  }

  _scaleLabel(l) {
    const H = this.height || 1;
    const k = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / H;
    l.sprite.scale.set(l.px[0] * k, l.px[1] * k, 1);
  }

  setLabelsVisible(v) { this.labelsVisible = v; }

  // ---------- input ----------

  _initInput() {
    if (this.mini) return;
    const el = this.canvas;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      this._cancelFly();
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 6 && performance.now() - down.t < 600) {
        const id = this.pick(e.clientX, e.clientY);
        this.onSelect(id);
      }
      down = null;
    });
    el.addEventListener('pointermove', (e) => {
      this._hoverAt = [e.clientX, e.clientY];
    });
    el.addEventListener('pointerleave', () => { this._hoverAt = null; this._setHover(-1); });
    el.addEventListener('wheel', () => this._cancelFly(), { passive: true });
  }

  _setHover(id) {
    if (id === this.hovered) return;
    this.hovered = id;
    this.uniforms.uHover.value = id;
    this.canvas.style.cursor = id >= 0 ? 'pointer' : '';
    this.onHover(id, this._hoverAt);
  }

  starPosition(id, out = this._tmp) {
    const s = this.layout.stars;
    morphPosition(out, s.gal[id * 3], s.gal[id * 3 + 1], s.gal[id * 3 + 2], s.brain[id * 3], s.brain[id * 3 + 1], s.brain[id * 3 + 2], s.rnd[id], this.morph);
    return out;
  }

  isVisible(id) {
    return !this.grow.active || this.layout.stars.birth[id] <= this.grow.t;
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    const s = this.layout.stars;
    let best = -1, bestD = Infinity;
    const v = this._vec;
    const scale = this.uniforms.uScale.value;
    for (let i = 0; i < s.count; i++) {
      if (!this.isVisible(i)) continue;
      const p = this.starPosition(i);
      v.set(p[0], p[1], p[2]);
      const depth = v.distanceTo(this.camera.position);
      v.project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = (v.x + 1) / 2 * rect.width, sy = (1 - v.y) / 2 * rect.height;
      const d = Math.hypot(sx - mx, sy - my);
      const radius = Math.max(12, (s.size[i] * scale) / depth * 0.5);
      if (d < radius && d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // ---------- actions ----------

  toggleMorph() { this.setMorph(this.morphTarget > 0.5 ? 0 : 1); }

  setMorph(target) {
    this.morphTarget = target;
    if (this.mini) return;
    const dist = target ? this.brainDistance : this.homeDistance;
    // the brain reads best from the side; the universe from slightly above
    const dir = target ? new THREE.Vector3(0.92, 0.2, 0.34) : new THREE.Vector3(-0.25, 0.3, 1);
    this._flyTo(new THREE.Vector3(0, 0, 0), dir.normalize().multiplyScalar(dist), MORPH_SECONDS * 0.95);
  }

  get isBrain() { return this.morphTarget > 0.5; }

  /** Shifts the picture left so the centre of attention isn't under the preview panel. */
  setInset(px) { this.shiftTarget = px / 2; }

  _applyShift() {
    if (Math.abs(this.shift) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(this.width, this.height, this.shift, 0, this.width, this.height);
  }

  select(id) {
    this.selected = id;
    this.uniforms.uSel.value = id;
  }

  flyToStar(id) {
    if (id < 0) return;
    // a star that hasn't been born yet in "watch it grow" can't be focused
    if (!this.isVisible(id)) this.stopGrow();
    const p = this.starPosition(id);
    const target = new THREE.Vector3(p[0], p[1], p[2]);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    // far enough to see the star's whole galaxy (or a good part of the brain)
    const g = this.layout.galaxies[this.layout.stars.gIndex[id]];
    const dist = this.isBrain ? this.layout.brainScale * 1.5 : Math.max(110, g.radius * 2.8);
    this._flyTo(target, dir.multiplyScalar(dist), 1.5);
  }

  resetView() {
    const dir = new THREE.Vector3(0, 0.3, 1).normalize();
    this._flyTo(new THREE.Vector3(), dir.multiplyScalar(this.isBrain ? this.brainDistance : this.homeDistance), 1.6);
  }

  _flyTo(target, offset, seconds) {
    this.fly = {
      fromT: this.controls.target.clone(), toT: target,
      fromP: this.camera.position.clone(), toP: target.clone().add(offset),
      t: 0, dur: seconds,
    };
  }

  _cancelFly() { this.fly = null; }

  // watch it grow
  startGrow() {
    this.grow = { active: true, playing: true, t: 0 };
    this._emitGrow();
  }
  stopGrow() {
    this.grow = { active: false, playing: false, t: 1 };
    this._emitGrow();
  }
  toggleGrowPlaying() {
    if (!this.grow.active) return;
    if (!this.grow.playing && this.grow.t >= 1) this.grow.t = 0;
    this.grow.playing = !this.grow.playing;
    this._emitGrow();
  }
  setGrowT(t) {
    this.grow.t = Math.min(1, Math.max(0, t));
    this._emitGrow();
  }
  _emitGrow() {
    const { tMin, tMax } = this.layout;
    const date = new Date(tMin + (tMax - tMin) * Math.min(1, this.grow.t));
    const count = this.grow.active ? countBelow(this._sortedBirths(), this.grow.t) : this.data.notes.length;
    this.onGrow({ ...this.grow, date, count, total: this.data.notes.length });
  }
  _sortedBirths() {
    if (!this._births) this._births = Array.from(this.layout.stars.birth).sort((a, b) => a - b);
    return this._births;
  }

  // ---------- loop ----------

  _resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.width = w; this.height = h;
    const pr = this.renderer.getPixelRatio();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this._applyShift();
    this.camera.updateProjectionMatrix();
    this.uniforms.uPixelRatio.value = pr;
    this.uniforms.uScale.value = (h / 2) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    if (this.labels) this.labels.forEach((l) => this._scaleLabel(l));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this.renderer.setAnimationLoop((t) => this._tick(t));
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  _tick(now) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    const u = this.uniforms;
    u.uTime.value += dt;

    if (this.morph !== this.morphTarget) {
      const step = dt / MORPH_SECONDS;
      this.morph = this.morphTarget > this.morph ? Math.min(this.morphTarget, this.morph + step) : Math.max(this.morphTarget, this.morph - step);
    }
    u.uMorph.value = this.morph;

    if (this.grow.active && this.grow.playing) {
      this.grow.t += dt / GROW_SECONDS;
      if (this.grow.t >= 1) { this.grow.t = 1; this.grow.playing = false; }
      this._emitGrow();
    }
    u.uGrow.value = this.grow.active ? this.grow.t : 2;

    if (this.fly) {
      const f = this.fly;
      f.t += dt / f.dur;
      const e = easeInOut(Math.min(1, f.t));
      this.controls.target.lerpVectors(f.fromT, f.toT, e);
      this.camera.position.lerpVectors(f.fromP, f.toP, e);
      if (f.t >= 1) this.fly = null;
    }

    if (Math.abs(this.shift - this.shiftTarget) > 0.3) {
      this.shift += (this.shiftTarget - this.shift) * Math.min(1, dt * 5);
      if (Math.abs(this.shift - this.shiftTarget) <= 0.3) this.shift = this.shiftTarget;
      this._applyShift();
      this.camera.updateProjectionMatrix();
    }

    if (this.mini) this.group.rotation.y += dt * 0.07;
    else this.controls.update(dt);

    if (this._hoverAt && !this.fly) {
      this._setHover(this.pick(this._hoverAt[0], this._hoverAt[1]));
    }

    this.composer.render(dt);

    if (this.labels && this.labelsVisible) {
      const p = this._tmp;
      for (const l of this.labels) {
        this._drawLabel(l, false);
        morphPosition(p, ...l.galPos, ...l.brainPos, 0.5, this.morph);
        l.sprite.position.set(p[0], p[1], p[2]);
        l.sprite.material.opacity = l.count > 0 ? 0.95 : 0;
      }
      this.renderer.autoClear = false;
      this.renderer.render(this.labelScene, this.camera);
      this.renderer.autoClear = true;
    }
    if (this.frameSink) this.frameSink(this.canvas); // recorder copies the finished frame

    this._frames++;
    if (now - this._fpsT > 500) {
      this.fps = Math.round((this._frames * 1000) / (now - this._fpsT));
      this._frames = 0;
      this._fpsT = now;
    }
  }

  dispose() {
    this.stop();
    this._ro.disconnect();
    this.controls.dispose();
    for (const o of [this.dust, this.links, this.nebula, this.stars]) { o.geometry.dispose(); o.material.dispose(); }
    if (this.labels) this.labels.forEach((l) => { l.tex.dispose(); l.sprite.material.dispose(); });
    this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

function countBelow(sorted, t) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= t) lo = mid + 1; else hi = mid; }
  return lo;
}
