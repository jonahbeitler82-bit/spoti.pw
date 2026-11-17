// GLSL for the particles, stars and links. The morph lives in one shared chunk,
// and Universe.morphPosition() mirrors it in JS for picking and labels.

export const MORPH_CHUNK = /* glsl */ `
uniform float uMorph;
uniform float uTime;
uniform float uGrow;
uniform float uPixelRatio;
uniform float uScale;

vec3 morphPos(vec3 a, vec3 b, float r, out float e) {
  float l = clamp(uMorph * 1.35 - r * 0.35, 0.0, 1.0);
  e = l < 0.5 ? 4.0 * l * l * l : 1.0 - pow(-2.0 * l + 2.0, 3.0) * 0.5;
  vec3 p = mix(a, b, e);
  float arc = sin(e * 3.14159265);
  vec3 dir = normalize(vec3(r - 0.5, 0.8, fract(r * 7.13) - 0.5));
  p += dir * arc * length(b - a) * 0.18;
  float ang = arc * (0.5 + r * 0.9);
  float c = cos(ang), s = sin(ang);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

float growIn(float birth, float window) {
  return clamp((uGrow - birth) / window, 0.0, 1.0);
}
`;

export const NEBULA_VERT = /* glsl */ `
${MORPH_CHUNK}
uniform float uSizeMul;
uniform float uBrainDim;
attribute vec3 aGal;
attribute vec3 aBrain;
attribute vec3 aColorA;
attribute vec3 aColorB;
attribute float aSize;
attribute float aRand;
attribute float aBirth;
varying vec3 vColor;
varying float vAlpha;

void main() {
  float e;
  vec3 p = morphPos(aGal, aBrain, aRand, e);
  float k = growIn(aBirth, 0.03);
  p += vec3(sin(uTime * 0.31 + aRand * 40.0), cos(uTime * 0.27 + aRand * 31.0), sin(uTime * 0.23 + aRand * 17.0)) * 0.7;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aSize * uSizeMul * (k + sin(k * 3.14159) * 0.6) * uScale / max(1.0, -mv.z);
  // tiny points keep their energy instead of flickering; big (close) ones fade so they don't blow out
  float fade = 1.0;
  if (px < 1.6) { fade = (px * px) / (1.6 * 1.6); px = 1.6; }
  else if (px > 6.0) { fade = pow(6.0 / px, 1.3); }
  gl_PointSize = min(px, 40.0) * uPixelRatio;
  vColor = mix(aColorA, aColorB, e) * mix(1.0, uBrainDim, e);
  vAlpha = k * fade * (0.8 + 0.2 * sin(uTime * 1.7 + aRand * 60.0));
  if (k <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const NEBULA_FRAG = /* glsl */ `
uniform float uIntensity;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  float a = exp(-d * 4.0) - 0.0183;
  if (a <= 0.0) discard;
  gl_FragColor = vec4(vColor * uIntensity, a * vAlpha);
}
`;

export const STAR_VERT = /* glsl */ `
${MORPH_CHUNK}
uniform float uSel;
uniform float uHover;
uniform float uStarMul;
attribute vec3 aGal;
attribute vec3 aBrain;
attribute vec3 aColorA;
attribute vec3 aColorB;
attribute float aSize;
attribute float aRand;
attribute float aBirth;
attribute float aId;
varying vec3 vColor;
varying float vAlpha;
varying float vHot;

void main() {
  float e;
  vec3 p = morphPos(aGal, aBrain, aRand, e);
  float k = growIn(aBirth, 0.02);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sel = abs(aId - uSel) < 0.5 ? 1.0 : 0.0;
  float hov = abs(aId - uHover) < 0.5 ? 1.0 : 0.0;
  float pop = k + sin(k * 3.14159) * 1.4;
  float pulse = 1.0 + sel * (0.9 + 0.25 * sin(uTime * 4.0));
  float px = aSize * uStarMul * pop * pulse * (1.0 + hov * 0.6) * uScale / max(1.0, -mv.z);
  gl_PointSize = clamp(px, 2.5, 90.0) * uPixelRatio;
  vColor = mix(aColorA, aColorB, e);
  vHot = max(sel, hov);
  vAlpha = k * (0.85 + 0.15 * sin(uTime * 2.3 + aRand * 80.0));
  if (k <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vHot;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = smoothstep(0.28, 0.0, d);
  float halo = exp(-d * d * 7.0);
  float ring = vHot * smoothstep(0.08, 0.0, abs(d - 0.78)) * 0.9;
  vec3 col = vColor * (halo * 1.4 + ring) + vec3(1.0) * core * (1.3 + vHot);
  gl_FragColor = vec4(col, vAlpha);
}
`;

export const LINK_VERT = /* glsl */ `
${MORPH_CHUNK}
uniform float uSel;
uniform float uLinkAlpha;
attribute vec3 aGal;
attribute vec3 aBrain;
attribute vec3 aColorA;
attribute vec3 aColorB;
attribute float aT;
attribute float aRand;
attribute float aBirth;
attribute vec2 aEnds;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;

void main() {
  float e;
  vec3 p = morphPos(aGal, aBrain, aRand, e);
  float k = growIn(aBirth, 0.03);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  float hasSel = uSel >= 0.0 ? 1.0 : 0.0;
  float sel = (abs(aEnds.x - uSel) < 0.5 || abs(aEnds.y - uSel) < 0.5) ? 1.0 : 0.0;
  float flow = pow(fract(aT - uTime * 0.16 + aSeed), 12.0);
  float base = uLinkAlpha * mix(1.0, mix(0.25, 3.2, sel), hasSel);
  vAlpha = k * min(1.0, base + flow * (0.45 + sel * 0.8));
  vColor = mix(aColorA, aColorB, e);
  if (k <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const LINK_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor, vAlpha);
}
`;

export const DUST_VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute float aSize;
attribute float aRand;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  vColor = aColor;
  vAlpha = 0.55 + 0.45 * sin(uTime * (0.6 + aRand * 1.8) + aRand * 100.0);
}
`;

export const DUST_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = 1.0 - smoothstep(0.0, 0.5, length(c));
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;

/** Same easing and arc as morphPos() above. */
export function morphPosition(out, ax, ay, az, bx, by, bz, r, m) {
  const l = Math.min(1, Math.max(0, m * 1.35 - r * 0.35));
  const e = l < 0.5 ? 4 * l * l * l : 1 - Math.pow(-2 * l + 2, 3) * 0.5;
  let x = ax + (bx - ax) * e, y = ay + (by - ay) * e, z = az + (bz - az) * e;
  const arc = Math.sin(e * Math.PI);
  let dx = r - 0.5, dy = 0.8, dz = (r * 7.13 - Math.floor(r * 7.13)) - 0.5;
  const dl = Math.hypot(dx, dy, dz);
  const len = Math.hypot(bx - ax, by - ay, bz - az) * 0.18 * arc;
  x += (dx / dl) * len; y += (dy / dl) * len; z += (dz / dl) * len;
  const ang = arc * (0.5 + r * 0.9);
  const c = Math.cos(ang), s = Math.sin(ang);
  out[0] = c * x + s * z; out[1] = y; out[2] = -s * x + c * z;
  return e;
}
