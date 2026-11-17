// Turns vault data into particle buffers: galaxy positions, brain positions, birth times.
import { mulberry32, hashString, gaussian, makeNoise3 } from './noise.js';
import { sampleBrain } from './brain.js';
import { galaxyColor, gradientAt, SCHEMES } from '../palettes.js';

const TAU = Math.PI * 2;

function rotateFn(ax, ay, az) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  return (x, y, z) => {
    const y1 = y * cx - z * sx; const z1 = y * sx + z * cx; // X
    const x2 = x * cy + z1 * sy; const z2 = -x * sy + z1 * cy; // Y
    const x3 = x2 * cz - y1 * sz; const y3 = x2 * sz + y1 * cz; // Z
    return [x3, y3, z2];
  };
}

/** Places the galaxies in a loose, flattened cluster without overlaps. */
function placeGalaxies(galaxies, rand) {
  const n = galaxies.length;
  galaxies.forEach((g) => { g.radius = 30 + 11 * Math.sqrt(g.count); });
  const spread = n === 1 ? 0 : 70 + 62 * Math.sqrt(n);
  const golden = Math.PI * (3 - Math.sqrt(5));
  galaxies.forEach((g, i) => {
    if (n === 1) { g.center = [0, 0, 0]; return; }
    const y = 1 - (i + 0.5) / n * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i * 7.3 + rand() * 0.5;
    const d = spread * (0.62 + rand() * 0.38);
    g.center = [Math.cos(th) * r * d, y * d * 0.42, Math.sin(th) * r * d];
  });
  for (let it = 0; it < 120; it++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = galaxies[i], b = galaxies[j];
        const dx = b.center[0] - a.center[0], dy = b.center[1] - a.center[1], dz = b.center[2] - a.center[2];
        const d = Math.hypot(dx, dy, dz) || 0.01;
        const min = (a.radius + b.radius) * 1.08;
        if (d < min) {
          const push = (min - d) / d * 0.5;
          a.center[0] -= dx * push; a.center[1] -= dy * push * 0.5; a.center[2] -= dz * push;
          b.center[0] += dx * push; b.center[1] += dy * push * 0.5; b.center[2] += dz * push;
        }
      }
    }
  }
  let mean = [0, 0, 0];
  galaxies.forEach((g) => { mean = mean.map((m, k) => m + g.center[k] / n); });
  galaxies.forEach((g) => { g.center = g.center.map((c, k) => c - mean[k]); });
}

export function buildLayout(data, { budget = 42000 } = {}) {
  const rand = mulberry32(hashString(data.vaultName + ':universe'));
  const noise = makeNoise3(mulberry32(hashString(data.vaultName + ':noise')));
  const galaxies = data.galaxies.map((g) => ({ ...g }));
  const G = galaxies.length;
  placeGalaxies(galaxies, rand);

  // timeline: 0 = first note, 1 = now
  let tMin = Date.now() - 86400000, tMax = Date.now();
  for (const n of data.notes) { tMin = Math.min(tMin, n.created); tMax = Math.max(tMax, n.created); }
  const span = Math.max(1, tMax - tMin);
  const birthOf = (ms) => (ms - tMin) / span;

  // particles per galaxy, proportional to its size
  const weights = galaxies.map((g) => 10 + g.count);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.max(500, Math.round((budget * w) / wsum)));
  const N = counts.reduce((a, b) => a + b, 0);

  const gal = new Float32Array(N * 3);
  const brain = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const rnd = new Float32Array(N);
  const birth = new Float32Array(N);
  const gIndex = new Uint16Array(N);
  const whiten = new Float32Array(N);
  const bright = new Float32Array(N);
  const brainS = new Float32Array(N);

  // ---- galaxies ----
  let off = 0;
  galaxies.forEach((g, gi) => {
    const n = counts[gi];
    g.offset = off; g.particles = n;
    const R = g.radius;
    const cloud = rand() < 0.3;
    const arms = 2 + Math.floor(rand() * 3);
    const twist = 2.2 + rand() * 2.4;
    const rot = rotateFn((rand() - 0.5) * 1.1, rand() * TAU, (rand() - 0.5) * 1.1);
    g.rot = rot; g.arms = arms; g.twist = twist; g.cloud = cloud;
    const seed = rand() * 100;
    const radial = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      const i = off + j;
      let x, y, z, w = 0, b = 1, sz = 1;
      const roll = rand();
      const bulge = cloud ? 0.1 : 0.14;
      const armShare = cloud ? 0.32 : 0.7;
      if (roll < bulge) {
        x = gaussian(rand) * R * 0.12; y = gaussian(rand) * R * 0.08; z = gaussian(rand) * R * 0.12;
        b = 1.15; sz = 0.9;
      } else if (roll < armShare) {
        const r = R * Math.min(1.08, -Math.log(1 - rand() * 0.985) * 0.3 + 0.05);
        const arm = Math.floor(rand() * arms);
        const th = (arm / arms) * TAU + (r / R) * twist + gaussian(rand) * 0.3;
        x = Math.cos(th) * r + gaussian(rand) * R * 0.04;
        z = Math.sin(th) * r + gaussian(rand) * R * 0.04;
        y = gaussian(rand) * R * 0.035 * (1.3 - r / R);
      } else {
        // nebula haze: clumpy cloud, found by rejection against noise
        let tries = 0;
        do {
          const d = Math.cbrt(rand()) * R * 1.05;
          const [ux, uy, uz] = [gaussian(rand), gaussian(rand), gaussian(rand)];
          const l = Math.hypot(ux, uy, uz) || 1;
          x = (ux / l) * d; y = (uy / l) * d * (cloud ? 0.55 : 0.28); z = (uz / l) * d;
          tries++;
        } while (tries < 12 && noise(x / R * 1.7 + seed, y / R * 1.7, z / R * 1.7) < -0.05 + rand() * 0.45);
        b = 0.55; sz = 1.5;
      }
      const rn = Math.hypot(x, y, z) / R;
      radial[j] = rn;
      w = Math.pow(Math.max(0, 1 - rn * 3.2), 1.8) * 0.6;
      if (rand() < 0.025) { w = Math.max(w, 0.7); b *= 1.6; sz *= 1.8; } // sparkles
      const [rx, ry, rz] = rot(x, y, z);
      gal[i * 3] = g.center[0] + rx; gal[i * 3 + 1] = g.center[1] + ry; gal[i * 3 + 2] = g.center[2] + rz;
      size[i] = 1.7 * sz * (0.55 + rand() * 0.9);
      rnd[i] = rand();
      gIndex[i] = gi;
      whiten[i] = w;
      bright[i] = b * (0.6 + rand() * 0.5);
    }
    // birth: the inner cloud appears with the first notes, the edge with the latest
    const times = g.notes.map((id) => birthOf(data.notes[id].created)).sort((a, b) => a - b);
    const order = Array.from({ length: n }, (_, j) => j).sort((a, b) => radial[a] - radial[b]);
    order.forEach((j, rank) => {
      const q = Math.min(times.length - 1, Math.floor(((rank + rand() * n * 0.05) / n) * times.length));
      birth[off + j] = times[Math.max(0, q)];
    });
    off += n;
  });

  // ---- brain regions: galaxies ordered by colour slot, each gets a band of the brain ----
  const bp = sampleBrain(N, mulberry32(hashString(data.vaultName + ':brain')), noise);
  const brainScale = Math.max(120, universeRadius(galaxies) * 0.6);
  const orderS = Array.from({ length: N }, (_, i) => i).sort((a, b) => bp.s[a] - bp.s[b]);
  const bySlot = galaxies.map((g, gi) => gi).sort((a, b) => galaxies[a].slot - galaxies[b].slot);
  let cursor = 0;
  const regionCenters = new Array(G);
  bySlot.forEach((gi) => {
    const g = galaxies[gi];
    const pts = orderS.slice(cursor, cursor + g.particles);
    cursor += g.particles;
    regionCenters[gi] = pts.reduce((a, p) => a + bp.s[p], 0) / pts.length;
    // map galaxy particles to region points, both sorted by height, so the flow stays orderly
    const src = Array.from({ length: g.particles }, (_, j) => g.offset + j).sort((a, b) => gal[a * 3 + 1] - gal[b * 3 + 1]);
    const dst = pts.slice().sort((a, b) => bp.pos[a * 3 + 1] - bp.pos[b * 3 + 1]);
    src.forEach((i, j) => {
      const p = dst[j];
      brain[i * 3] = bp.pos[p * 3] * brainScale;
      brain[i * 3 + 1] = bp.pos[p * 3 + 1] * brainScale;
      brain[i * 3 + 2] = bp.pos[p * 3 + 2] * brainScale;
      brainS[i] = bp.s[p];
    });
    // label sits outside the region's centroid
    let cx = 0, cy = 0, cz = 0;
    pts.forEach((p) => { cx += bp.pos[p * 3]; cy += bp.pos[p * 3 + 1]; cz += bp.pos[p * 3 + 2]; });
    const m = pts.length;
    const c = [cx / m, cy / m, cz / m];
    const len = Math.hypot(...c) || 1;
    g.brainLabel = c.map((v) => (v / len) * (len + 0.42) * brainScale);
    g.brainShell = pts.filter((p) => bp.shell[p]);
  });

  // ---- stars (notes) ----
  const notes = data.notes;
  const S = notes.length;
  const sGal = new Float32Array(S * 3);
  const sBrain = new Float32Array(S * 3);
  const sSize = new Float32Array(S);
  const sRnd = new Float32Array(S);
  const sBirth = new Float32Array(S);
  const sId = new Float32Array(S);
  const sG = new Uint16Array(S);
  const sS = new Float32Array(S);
  galaxies.forEach((g, gi) => {
    const ids = g.notes.slice().sort((a, b) => notes[b].degree - notes[a].degree);
    const shell = g.brainShell;
    const step = shell.length / Math.max(1, ids.length);
    ids.forEach((id, rank) => {
      const frac = ids.length === 1 ? 0 : rank / (ids.length - 1);
      const r = g.radius * (0.06 + 0.72 * Math.sqrt(frac)) * (0.9 + rand() * 0.2);
      const arm = Math.floor(rand() * g.arms);
      const th = (arm / g.arms) * TAU + (r / g.radius) * g.twist + gaussian(rand) * 0.22;
      const y = gaussian(rand) * g.radius * 0.03;
      const [rx, ry, rz] = g.rot(Math.cos(th) * r, y, Math.sin(th) * r);
      sGal[id * 3] = g.center[0] + rx; sGal[id * 3 + 1] = g.center[1] + ry; sGal[id * 3 + 2] = g.center[2] + rz;
      const p = shell[Math.floor((rank + rand() * 0.8) * step) % shell.length];
      const out = 1.035;
      sBrain[id * 3] = bp.pos[p * 3] * brainScale * out;
      sBrain[id * 3 + 1] = bp.pos[p * 3 + 1] * brainScale * out;
      sBrain[id * 3 + 2] = bp.pos[p * 3 + 2] * brainScale * out;
      sS[id] = bp.s[p];
      sSize[id] = Math.min(13, 3.6 + 1.5 * Math.sqrt(notes[id].degree));
      sRnd[id] = rand();
      sBirth[id] = birthOf(notes[id].created);
      sId[id] = id;
      sG[id] = gi;
    });
  });

  // ---- links: curved, in both shapes ----
  const L = data.links.length;
  const K = L > 3000 ? 5 : L > 1200 ? 8 : 14;
  const V = L * K * 2;
  const lGal = new Float32Array(V * 3);
  const lBrain = new Float32Array(V * 3);
  const lT = new Float32Array(V);
  const lRnd = new Float32Array(V);
  const lBirth = new Float32Array(V);
  const lEnds = new Float32Array(V * 2);
  const lSeed = new Float32Array(V);
  const bez = (out, o, p0, p1, p2, t) => {
    const u = 1 - t;
    for (let c = 0; c < 3; c++) out[o + c] = u * u * p0[c] + 2 * u * t * p1[c] + t * t * p2[c];
  };
  const v3 = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
  let vi = 0;
  data.links.forEach(([a, b]) => {
    const A = v3(sGal, a), B = v3(sGal, b), Ab = v3(sBrain, a), Bb = v3(sBrain, b);
    const same = sG[a] === sG[b];
    const mid = A.map((v, c) => (v + B[c]) / 2);
    const d = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const ml = Math.hypot(...mid) || 1;
    const lift = same ? d * 0.12 : d * 0.22;
    const C = mid.map((v, c) => v + (mid[c] / ml) * lift * 0.6 + (c === 1 ? lift * 0.8 : 0));
    const midB = Ab.map((v, c) => (v + Bb[c]) / 2);
    const db = Math.hypot(Bb[0] - Ab[0], Bb[1] - Ab[1], Bb[2] - Ab[2]);
    const mlb = Math.hypot(...midB) || 1;
    const Cb = midB.map((v) => (v / mlb) * (mlb + db * 0.35 + brainScale * 0.06));
    const seed = rand();
    const bth = Math.max(sBirth[a], sBirth[b]);
    for (let k = 0; k < K; k++) {
      for (const t of [k / K, (k + 1) / K]) {
        bez(lGal, vi * 3, A, C, B, t);
        bez(lBrain, vi * 3, Ab, Cb, Bb, t);
        lT[vi] = t;
        lRnd[vi] = sRnd[a] + (sRnd[b] - sRnd[a]) * t;
        lBirth[vi] = bth;
        lEnds[vi * 2] = a; lEnds[vi * 2 + 1] = b;
        lSeed[vi] = seed;
        vi++;
      }
    }
  });

  return {
    galaxies, tMin, tMax, brainScale,
    radius: universeRadius(galaxies),
    nebula: { count: N, gal, brain, size, rnd, birth, gIndex, whiten, bright, brainS },
    stars: { count: S, gal: sGal, brain: sBrain, size: sSize, rnd: sRnd, birth: sBirth, id: sId, gIndex: sG, brainS: sS },
    links: { count: V, gal: lGal, brain: lBrain, t: lT, rnd: lRnd, birth: lBirth, ends: lEnds, seed: lSeed },
    regionCenters,
  };
}

function universeRadius(galaxies) {
  return Math.max(80, ...galaxies.map((g) => Math.hypot(...g.center) + g.radius));
}

/** Fills colour buffers for a scheme. Galaxy colour in the universe, a gradient across regions in the brain. */
export function computeColors(layout, schemeKey) {
  const { galaxies, nebula, stars, links, regionCenters } = layout;
  const G = galaxies.length;
  const stops = (SCHEMES[schemeKey] || SCHEMES.neon).stops;
  const gcol = galaxies.map((g) => galaxyColor(schemeKey, g.slot, G));
  galaxies.forEach((g, i) => { g.color = gcol[i]; });
  // brain gradient: piecewise between region centres, so each region carries its galaxy's colour
  const centers = galaxies.map((g, i) => ({ s: regionCenters[i], c: gcol[i] })).sort((a, b) => a.s - b.s);
  const brainColor = (s) => {
    if (G === 1) return gradientAt(stops, s);
    if (s <= centers[0].s) return centers[0].c;
    for (let i = 1; i < centers.length; i++) {
      if (s <= centers[i].s) {
        const f = (s - centers[i - 1].s) / (centers[i].s - centers[i - 1].s || 1);
        return centers[i - 1].c.map((v, k) => v + (centers[i].c[k] - v) * f);
      }
    }
    return centers[centers.length - 1].c;
  };
  const mixWhite = (c, w, b) => c.map((v) => (v + (1 - v) * w) * b);

  const nA = new Float32Array(nebula.count * 3);
  const nB = new Float32Array(nebula.count * 3);
  for (let i = 0; i < nebula.count; i++) {
    const g = nebula.gIndex[i];
    const a = mixWhite(gcol[g], nebula.whiten[i], nebula.bright[i]);
    const b = mixWhite(brainColor(nebula.brainS[i]), nebula.whiten[i] * 0.35, nebula.bright[i] * 1.05);
    nA.set(a, i * 3); nB.set(b, i * 3);
  }
  const sA = new Float32Array(stars.count * 3);
  const sB = new Float32Array(stars.count * 3);
  for (let i = 0; i < stars.count; i++) {
    sA.set(mixWhite(gcol[stars.gIndex[i]], 0.25, 1), i * 3);
    sB.set(mixWhite(brainColor(stars.brainS[i]), 0.25, 1), i * 3);
  }
  const lA = new Float32Array(links.count * 3);
  const lB = new Float32Array(links.count * 3);
  for (let v = 0; v < links.count; v++) {
    const a = links.ends[v * 2], b = links.ends[v * 2 + 1], t = links.t[v];
    for (let c = 0; c < 3; c++) {
      lA[v * 3 + c] = sA[a * 3 + c] + (sA[b * 3 + c] - sA[a * 3 + c]) * t;
      lB[v * 3 + c] = sB[a * 3 + c] + (sB[b * 3 + c] - sB[a * 3 + c]) * t;
    }
  }
  return { nebula: [nA, nB], stars: [sA, sB], links: [lA, lB], galaxyColors: gcol };
}
