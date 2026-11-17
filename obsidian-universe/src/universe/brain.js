// Point cloud of a brain: two folded hemispheres, cerebellum and brain stem.
// Coordinates: x left/right, y up, z front. Each point also gets `s` in [0,1],
// which runs front -> top -> back -> cerebellum -> stem and orders the colour regions.

const PI = Math.PI;

function randomDir(rand) {
  const u = rand() * 2 - 1;
  const th = rand() * PI * 2;
  const r = Math.sqrt(1 - u * u);
  return [r * Math.cos(th), u, r * Math.sin(th)];
}

function insideCerebrum(x, y, z) {
  const ry = y > 0 ? 0.6 : 0.4;
  return (x / 0.66) ** 2 + (y / ry) ** 2 + (z / 0.92) ** 2 < 0.92;
}

export function sampleBrain(n, rand, noise) {
  const pos = new Float32Array(n * 3);
  const s = new Float32Array(n);
  const shell = new Uint8Array(n);
  const nCereb = Math.round(n * 0.8);
  const nCbl = Math.round(n * 0.145);
  let k = 0;
  const put = (x, y, z, sv, onShell) => {
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; s[k] = sv; shell[k] = onShell; k++;
  };

  // Cerebrum: an ellipsoid shaped like a brain, with noise contours cut out as sulci.
  let guard = 0;
  while (k < nCereb && guard++ < n * 40) {
    const [dx, dy, dz] = randomDir(rand);
    let rx = 0.66;
    let ry = dy > 0 ? 0.6 : 0.4;
    const rz = 0.92;
    if (dz > 0) rx *= 1 - 0.2 * dz * dz; // frontal lobe narrows
    if (dz < -0.3) ry *= 1 - 0.15 * (-dz - 0.3); // occipital lobe dips
    let R = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2);
    const tx = Math.abs(dx) - 0.72, ty = dy + 0.52, tz = dz - 0.12;
    R *= 1 + 0.16 * Math.exp(-(tx * tx + ty * ty + tz * tz) / 0.1); // temporal lobes
    let x = dx * R, y = dy * R, z = dz * R;
    if (y < -0.36) { // flat underside, thinned so it doesn't form a bright sheet
      if (rand() < 0.45) continue;
      y = -0.36 + (y + 0.36) * 0.35;
    }

    if (Math.abs(x) < 0.04 && y > -0.2) continue; // longitudinal fissure

    const g = noise(x * 2.4 + 11.3, y * 2.4, z * 2.4) + 0.45 * noise(x * 5.1, y * 5.1 + 7.7, z * 5.1);
    const v = g * 3.1;
    const f = v - Math.floor(v);
    const toSulcus = Math.min(f, 1 - f);
    if (toSulcus < 0.12 && rand() < 0.94) continue;
    // central sulcus, and the lateral fissure on each side
    if (y > 0.02 && Math.abs(z - (0.06 - 0.32 * y)) < 0.026 && rand() < 0.95) continue;
    if (Math.abs(x) > 0.42 && z > -0.42 && z < 0.55 && Math.abs(y - (-0.1 - 0.3 * z)) < 0.028 && rand() < 0.95) continue;

    let sc, onShell = 1;
    if (rand() < 0.9) sc = 1 - Math.pow(rand(), 2) * 0.05;
    else { sc = 0.4 + rand() * 0.5; onShell = 0; }
    sc *= 1 - 0.05 * Math.max(0, 1 - toSulcus / 0.25);
    x *= sc; y *= sc; z *= sc;
    x += Math.sign(x) * 0.02;

    // fan of wedges around a point below the brain: frontal, parietal, occipital in order
    const a = Math.atan2(y + 0.62, z);
    const sv = Math.min(1, Math.max(0, (a - 0.22) / (PI - 0.5))) * 0.8;
    put(x, y, z, sv, onShell);
  }

  // Cerebellum: tucked under the back, two lobes, fine horizontal folds.
  const cy = -0.44, cz = -0.58;
  guard = 0;
  while (k < nCereb + nCbl && guard++ < n * 40) {
    const [dx, dy, dz] = randomDir(rand);
    let R = 1 / Math.sqrt((dx / 0.46) ** 2 + (dy / 0.21) ** 2 + (dz / 0.27) ** 2);
    R *= 1 - 0.16 * Math.exp(-(dx * dx) / 0.012);
    let x = dx * R, y = cy + dy * R, z = cz + dz * R;
    if (insideCerebrum(x, y, z)) continue;
    const fol = (y * 1.0 - z * 0.45) * 30 + noise(x * 3, y * 3, z * 3) * 1.2;
    if (fol - Math.floor(fol) < 0.3 && rand() < 0.9) continue;
    const sc = rand() < 0.92 ? 1 - rand() * 0.04 : 0.5 + rand() * 0.4;
    x *= sc; y = cy + (y - cy) * sc; z = cz + (z - cz) * sc;
    const sv = 0.8 + 0.12 * Math.min(1, Math.max(0, (cy + 0.21 - y) / 0.42));
    put(x, y, z, sv, 1);
  }

  // Brain stem: a tapered, slightly bent tube with the pons bulging at the front.
  while (k < n) {
    const t = rand();
    const cx = 0, ccy = -0.28 - t * 0.68, ccz = -0.2 - t * 0.16 - 0.08 * Math.sin(t * PI);
    const th = rand() * PI * 2;
    let r = 0.125 - t * 0.04;
    const pons = Math.exp(-((t - 0.25) ** 2) / 0.01) * Math.max(0, Math.sin(th)) * 0.05;
    r = (r + pons) * (rand() < 0.9 ? 1 - rand() * 0.06 : 0.5);
    const x = cx + Math.cos(th) * r;
    const z = ccz + Math.sin(th) * r;
    if (insideCerebrum(x, ccy, z) && t < 0.1) continue;
    if (t < 0.3 && rand() < 0.5) continue; // thinner where stem, cerebellum and cerebrum meet
    put(x, ccy, z, 0.92 + 0.08 * t, 1);
  }

  // centre the whole thing vertically
  for (let i = 0; i < n; i++) pos[i * 3 + 1] += 0.16;
  return { pos, s, shell };
}
