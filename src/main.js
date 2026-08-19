import "./style.css";
import * as THREE from "three";
import GUI from "lil-gui";

/* ================================================================== */
/*  COMPONENT 020 — SILK RIBBONS                                       */
/*  Soft glossy diagonal ribbons over paper-white, with chromatic      */
/*  fringing on the folds. Moving the cursor paints blurred ink        */
/*  colors underneath the ribbons. Every knob lives in the GUI and     */
/*  the whole state copies to / pastes from the clipboard as JSON.     */
/* ================================================================== */

const TRAIL_COUNT = 32;

/* ------------------------------------------------------------------ */
/*  PARAMS (single source of truth — mirrored into uniforms)           */
/* ------------------------------------------------------------------ */
const params = {
  // ---- paper / ribbons -------------------------------------------
  paperColor: "#ffffff",
  shadowColor: "#e8cfcf",
  stripeAngle: -15, // deg
  stripeFreq: 12,
  stripeDepth: 0.8, // how dark the cast shadow between tubes gets
  shadowSoftness: 0.05, // how far the shadow bleeds onto the next tube
  stripeDrift: 0.0, // slow constant slide

  // ---- tube lighting (each strip = glass/water cylinder) ----------
  tubeRound: 0.1, // how bulgy the tube cross-section is
  lightAngle: 48, // deg, where the light hits the tube from
  ambient: 0.99, // base light on the tube surface
  diffuse: 1.0, // shading from the curve (gives the 3D depth)
  specStrength: 0.42, // glossy water highlight running along the tube
  glossSharp: 200, // tightness of that highlight
  fresnel: 0.86, // bright glassy edges of the tube
  fresnelPow: 3.1,
  refraction: 1.72, // water bends the colors underneath

  // ---- block patches along each strip -----------------------------
  blockFreq: 6.95, // patches per unit along the strip
  blockDepth: 0.5, // how dark a patch can get
  blockSoftness: 1.0, // blur of patch edges
  blockStagger: 2.0, // per-strip random offset (brick layout)

  // ---- hover reveal ----------------------------------------------
  revealRadius: 0.1, // area around cursor that "wakes up"
  idleContrast: 0.07, // shading+fringe strength far from cursor
  hoverContrast: 1.67, // shading+fringe strength under cursor

  // ---- waviness (noise warp of the ribbons; 0 = straight lines) ---
  noiseScale: 0.24,
  warpStrength: 0.13,
  timeSpeed: 0.15,
  octaves: 6,
  lacunarity: 1.03,
  gain: 0.88,

  // ---- ink (colors revealed by the mouse) -------------------------
  ink1: "#ff0a2f",
  ink2: "#ffffff",
  ink3: "#fafaff",
  ink4: "#e3e3e3",
  colorMode: "Single", // Single | Gradient | Cycle
  inkBlend: 0.57, // smooths color changes along the stroke (no stripes)
  inkIntensity: 0.41,
  inkRadius: 0.26, // torch spot size
  inkSoftness: 1.04, // blur of the spot
  tubeSpread: 2.86, // how many tubes the torch reaches
  tubeConfine: 1.71, // keeps the color inside the tube's water
  torchGlow: 0.18, // luminous glow of the lit water
  inkCycleSpeed: 1.03, // how fast strokes change color
  inkDecay: 0.951, // how quickly the torch light fades behind the cursor
  inkSaturation: 0.88,
  inkUnderRibbons: 0.33, // 1 = ink shaded by ribbons, 0 = on top

  // ---- fluid motion of the ink ------------------------------------
  fluidWarp: 0.06, // liquid wobble of the ink edges
  fluidScale: 0.85, // size of the wobble
  fluidSpeed: 0.75, // how fast the liquid churns
  inkStretch: 1.0, // elongates strokes along movement

  // ---- mouse ------------------------------------------------------
  mouseSmoothing: 0.09,
  bendRadius: 0.08, // ribbons bend near cursor
  bendStrength: 0.0,
  velocitySmear: 0.0,
  mousePush: 2.0, // +1 push, -1 pull

  // ---- post -------------------------------------------------------
  chromaticAberration: 0.015,
  aberrationAngle: 129, // deg
  fringeOnInk: 0.0, // 0 = no rainbow fringe over the hover color
  grain: 0.035,
  grainSpeed: 1.0,
  vignette: 0.0,
  vignetteRadius: 0.2,
  contrast: 1.61,
  brightness: -0.33,
  saturation: 1.0,
  hueShift: -13, // deg
  gamma: 1.99,
  blurEdges: 1.0, // softens ribbon shading like frosted glass
  invert: false,

  // ---- animation --------------------------------------------------
  paused: false,
  globalSpeed: 1.0,
};

/* ------------------------------------------------------------------ */
/*  RENDERER + FULLSCREEN QUAD                                         */
/* ------------------------------------------------------------------ */
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const trailData = new Float32Array(TRAIL_COUNT * 4); // x, y, strength, radiusScale
const trailColorData = new Float32Array(TRAIL_COUNT * 3);

const uniforms = {
  uTime: { value: 0 },
  uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  uMouse: { value: new THREE.Vector2(0.5, 0.5) },
  uMouseVel: { value: new THREE.Vector2(0, 0) },
  uTrail: { value: trailData },
  uTrailColor: { value: trailColorData },

  uPaperColor: { value: new THREE.Color(params.paperColor) },
  uShadowColor: { value: new THREE.Color(params.shadowColor) },
  uStripeAngle: { value: params.stripeAngle },
  uStripeFreq: { value: params.stripeFreq },
  uStripeDepth: { value: params.stripeDepth },
  uShadowSoftness: { value: params.shadowSoftness },
  uSpecStrength: { value: params.specStrength },
  uTubeRound: { value: params.tubeRound },
  uLightAngle: { value: params.lightAngle },
  uAmbient: { value: params.ambient },
  uDiffuse: { value: params.diffuse },
  uGlossSharp: { value: params.glossSharp },
  uFresnel: { value: params.fresnel },
  uFresnelPow: { value: params.fresnelPow },
  uRefraction: { value: params.refraction },
  uStripeDrift: { value: params.stripeDrift },
  uBlockFreq: { value: params.blockFreq },
  uBlockDepth: { value: params.blockDepth },
  uBlockSoftness: { value: params.blockSoftness },
  uBlockStagger: { value: params.blockStagger },
  uRevealRadius: { value: params.revealRadius },
  uIdleContrast: { value: params.idleContrast },
  uHoverContrast: { value: params.hoverContrast },

  uNoiseScale: { value: params.noiseScale },
  uWarpStrength: { value: params.warpStrength },
  uTimeSpeed: { value: params.timeSpeed },
  uOctaves: { value: params.octaves },
  uLacunarity: { value: params.lacunarity },
  uGain: { value: params.gain },

  uInkIntensity: { value: params.inkIntensity },
  uInkRadius: { value: params.inkRadius },
  uInkSoftness: { value: params.inkSoftness },
  uInkSaturation: { value: params.inkSaturation },
  uInkUnderRibbons: { value: params.inkUnderRibbons },
  uTubeSpread: { value: params.tubeSpread },
  uTubeConfine: { value: params.tubeConfine },
  uTorchGlow: { value: params.torchGlow },
  uFluidWarp: { value: params.fluidWarp },
  uFluidScale: { value: params.fluidScale },
  uFluidSpeed: { value: params.fluidSpeed },
  uInkStretch: { value: params.inkStretch },

  uBendRadius: { value: params.bendRadius },
  uBendStrength: { value: params.bendStrength },
  uVelocitySmear: { value: params.velocitySmear },
  uMousePush: { value: params.mousePush },

  uAberration: { value: params.chromaticAberration },
  uAberrationAngle: { value: params.aberrationAngle },
  uFringeOnInk: { value: params.fringeOnInk },
  uGrain: { value: params.grain },
  uGrainSpeed: { value: params.grainSpeed },
  uVignette: { value: params.vignette },
  uVignetteRadius: { value: params.vignetteRadius },
  uContrast: { value: params.contrast },
  uBrightness: { value: params.brightness },
  uSaturation: { value: params.saturation },
  uHueShift: { value: params.hueShift },
  uGamma: { value: params.gamma },
  uBlurEdges: { value: params.blurEdges },
  uInvert: { value: 0 },
};

const fragmentShader = /* glsl */ `
precision highp float;

#define TRAIL_COUNT ${TRAIL_COUNT}
#define MAX_OCTAVES 6

uniform float uTime;
uniform vec2  uResolution;
uniform vec2  uMouse;
uniform vec2  uMouseVel;
uniform vec4  uTrail[TRAIL_COUNT];
uniform vec3  uTrailColor[TRAIL_COUNT];

uniform vec3  uPaperColor, uShadowColor;
uniform float uStripeAngle, uStripeFreq, uStripeDepth;
uniform float uSpecStrength, uShadowSoftness, uStripeDrift;
uniform float uTubeRound, uLightAngle, uAmbient, uDiffuse;
uniform float uGlossSharp, uFresnel, uFresnelPow, uRefraction;
uniform float uBlockFreq, uBlockDepth, uBlockSoftness, uBlockStagger;
uniform float uRevealRadius, uIdleContrast, uHoverContrast;

uniform float uNoiseScale, uWarpStrength, uTimeSpeed, uLacunarity, uGain;
uniform int   uOctaves;

uniform float uInkIntensity, uInkRadius, uInkSoftness, uInkSaturation, uInkUnderRibbons;
uniform float uTubeSpread, uTubeConfine, uTorchGlow;
uniform float uFluidWarp, uFluidScale, uFluidSpeed, uInkStretch;
uniform float uBendRadius, uBendStrength, uVelocitySmear, uMousePush;

uniform float uAberration, uAberrationAngle, uFringeOnInk;
uniform float uGrain, uGrainSpeed, uVignette, uVignetteRadius;
uniform float uContrast, uBrightness, uSaturation, uHueShift, uGamma;
uniform float uBlurEdges, uInvert;

varying vec2 vUv;

/* ---------------- noise ---------------- */
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float snoise(vec2 p) {
  const float K1 = 0.366025404;
  const float K2 = 0.211324865;
  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;
  vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  vec3 n = h * h * h * h * vec3(dot(a, hash2(i)), dot(b, hash2(i + o)), dot(c, hash2(i + 1.0)));
  return dot(n, vec3(70.0));
}

float fbm(vec2 p) {
  float amp = 0.5, freq = 1.0, sum = 0.0, norm = 0.0;
  for (int i = 0; i < MAX_OCTAVES; i++) {
    if (i >= uOctaves) break;
    sum += snoise(p * freq) * amp;
    norm += amp;
    amp *= uGain;
    freq *= uLacunarity;
  }
  return sum / max(norm, 0.0001);
}

vec3 hueRotate(vec3 color, float angle) {
  float c = cos(angle), s = sin(angle);
  mat3 m = mat3(
    0.299 + 0.701 * c + 0.168 * s, 0.587 - 0.587 * c + 0.330 * s, 0.114 - 0.114 * c - 0.497 * s,
    0.299 - 0.299 * c - 0.328 * s, 0.587 + 0.413 * c + 0.035 * s, 0.114 - 0.114 * c + 0.292 * s,
    0.299 - 0.300 * c + 1.250 * s, 0.587 - 0.588 * c - 1.050 * s, 0.114 + 0.886 * c - 0.203 * s
  );
  return color * m;
}

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

/* ---------------- scene ---------------- */
vec3 field(vec2 uv, float aspect, float act, out vec3 oInk, out float oMask, out float oH, out float oWide) {
  vec2 p = uv;
  p.x *= aspect;

  /* -------- water refraction: each tube bends what's under it ----- */
  float angR = radians(uStripeAngle);
  vec2 acrossDir = vec2(cos(angR), sin(angR));
  float sPre = dot(p, acrossDir) * uStripeFreq + uTime * uStripeDrift * uStripeFreq;
  float fPre = fract(sPre);
  float xPre = (fPre - 0.5) * 2.0;
  float hPre = sqrt(max(1.0 - xPre * xPre, 0.0));
  vec2 pRef = p - acrossDir * xPre * (1.0 - hPre) * uRefraction / max(uStripeFreq, 1.0);

  /* -------- fluid ink strokes from the trail -------- */
  /* the sample point itself churns like liquid, so the stroke
     edges wobble and smear instead of reading as stamped dots   */
  vec2 wob = vec2(
    fbm(p * uFluidScale + uTime * uFluidSpeed),
    fbm(p * uFluidScale + 7.31 - uTime * uFluidSpeed * 0.8)
  );
  vec2 wp = pRef + wob * uFluidWarp;

  vec3 ink = vec3(0.0);
  float inkMask = 0.0;
  /* capsule falloff between consecutive trail points = one
     continuous liquid line instead of separate blobs           */
  for (int i = 0; i < TRAIL_COUNT - 1; i++) {
    float sA = uTrail[i].z;
    float sB = uTrail[i + 1].z;
    if (max(sA, sB) < 0.002) continue;
    vec2 a = uTrail[i].xy;     a.x *= aspect;
    vec2 b = uTrail[i + 1].xy; b.x *= aspect;
    vec2 ab = b - a;
    float len2 = dot(ab, ab);
    /* stretch: sample position pulled along the stroke direction */
    vec2 sp = wp;
    if (len2 > 0.000001) {
      vec2 dir = ab * inversesqrt(len2);
      sp -= dir * dot(wob, vec2(1.0)) * uInkStretch * 0.05;
    }
    float h = len2 > 0.000001 ? clamp(dot(sp - a, ab) / len2, 0.0, 1.0) : 0.0;
    vec2 cp = a + ab * h;
    vec2 d = sp - cp;
    float str = mix(sA, sB, h);
    float r = uInkRadius * mix(uTrail[i].w, uTrail[i + 1].w, h);
    float fall = exp(-dot(d, d) / max(r * r * uInkSoftness * 0.5, 0.0001)) * str;
    /* torch stays inside the tube it is pointing at: weight by how
       many tubes away this pixel is from the lit spot              */
    float sHere = dot(p, acrossDir) * uStripeFreq;
    float sSpot = dot(cp, acrossDir) * uStripeFreq;
    float ds = sHere - sSpot;
    fall *= exp(-(ds * ds) / max(uTubeSpread * uTubeSpread, 0.0001));
    ink += mix(uTrailColor[i], uTrailColor[i + 1], h) * fall;
    inkMask += fall;
  }
  vec3 inkCol = inkMask > 0.001 ? ink / inkMask : vec3(1.0);
  float luma = dot(inkCol, vec3(0.299, 0.587, 0.114));
  inkCol = mix(vec3(luma), inkCol, uInkSaturation);
  /* the light lives in the water: strongest at the tube's core,
     fading to nothing at the tube walls                          */
  /* wider footprint of the torch (before tube confinement) — used to
     fade the chromatic fringe out around the hover color            */
  oWide = clamp((1.0 - exp(-inkMask * uInkIntensity * 2.0)) * 2.0, 0.0, 1.0);
  inkMask *= pow(max(hPre, 0.0), uTubeConfine);
  inkMask = 1.0 - exp(-inkMask * uInkIntensity);
  oInk = inkCol;
  oMask = inkMask;
  oH = hPre;

  /* -------- ribbons bend around the cursor -------- */
  vec2 m = uMouse;
  m.x *= aspect;
  vec2 dm = p - m;
  float mFall = exp(-dot(dm, dm) / max(uBendRadius * uBendRadius, 0.0001));
  vec2 disp = normalize(dm + 0.0001) * mFall * uBendStrength * uMousePush * 0.2;
  disp += uMouseVel * mFall * uVelocitySmear * 0.15;
  p += disp;

  /* -------- diagonal ribbon coordinate -------- */
  float ang = radians(uStripeAngle);
  float s = dot(p, vec2(cos(ang), sin(ang))) * uStripeFreq;
  s += fbm(p * uNoiseScale + uTime * uTimeSpeed) * uWarpStrength * uStripeFreq * 0.35;
  s += uTime * uStripeDrift * uStripeFreq;
  float f = fract(s);

  /* -------- overlapping paper-strip shading --------
     each strip: flat face + bright rim on its leading edge,
     casting a soft blurred shadow onto the strip below       */
  float soften = mix(1.0, 2.5, clamp(uBlurEdges, 0.0, 1.0));
  float ss = max(uShadowSoftness * soften, 0.001);
  float shadow = exp(-(f * f) / (ss * ss));

  /* -------- tube cross-section: raised center, curved sides ------- */
  float x = (f - 0.5) * 2.0;
  float h = pow(max(1.0 - x * x, 0.0), 0.5 * max(uTubeRound, 0.05));
  vec3 n = normalize(vec3(x, 0.0, max(h, 0.03)));
  float la = radians(uLightAngle);
  vec3 L = normalize(vec3(sin(la), 0.25, cos(la)));
  float dif = max(dot(n, L), 0.0);
  vec3 Hv = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, Hv), 0.0), uGlossSharp) * uSpecStrength;
  float fres = pow(clamp(1.0 - n.z, 0.0, 1.0), uFresnelPow) * uFresnel;

  /* -------- staggered patches along each strip (brick layout) ----- */
  float sid = floor(s);
  float along = dot(p, vec2(-sin(ang), cos(ang))) * uBlockFreq;
  along += rand(vec2(sid, 3.71)) * uBlockStagger * 4.0;
  float bid = floor(along);
  float bf = fract(along);
  float v0 = rand(vec2(sid, bid));
  float v1 = rand(vec2(sid, bid + 1.0));
  float bs = max(uBlockSoftness, 0.001);
  float bt = clamp((bf - (1.0 - bs)) / bs, 0.0, 1.0);
  float blockVal = mix(v0, v1, smoothstep(0.0, 1.0, bt));

  /* -------- composite (structure only — ink is applied once,
     without chromatic aberration, back in main)                 */
  vec3 paper = uPaperColor;
  /* curved surface light: center of the tube sits higher and catches more.
     far from the cursor the lighting relaxes back to flat white          */
  float lightAmt = mix(1.0, uAmbient + dif * uDiffuse, clamp(act, 0.0, 1.5));
  vec3 col = paper * max(lightAmt, 0.0);
  col = mix(col, uShadowColor * paper, clamp(uStripeDepth * shadow * act, 0.0, 1.0));
  col = mix(col, uShadowColor * paper, clamp(uBlockDepth * blockVal * act, 0.0, 1.0));
  col += (spec + fres) * act;
  return col;
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;

  /* hover reveal: contrast + fringe wake up near the cursor */
  vec2 dm = uv - uMouse;
  dm.x *= aspect;
  float actFall = exp(-dot(dm, dm) / max(uRevealRadius * uRevealRadius, 0.0001));
  float act = mix(uIdleContrast, uHoverContrast, actFall);

  /* center sample first — it tells us where the ink is */
  vec3 inkC; float inkM; float hC; float wideC;
  vec3 centerCol = field(uv, aspect, act, inkC, inkM, hC, wideC);

  /* chromatic aberration: rainbow fringes on the ribbon folds.
     the fringe fades out around the hover color so no yellow halo
     forms next to it                                              */
  float abAmt = act * mix(1.0 - wideC, 1.0, uFringeOnInk);
  float aAng = radians(uAberrationAngle) + radians(uStripeAngle);
  vec2 off = vec2(cos(aAng), sin(aAng)) * uAberration * abAmt;
  vec3 col;
  if (uAberration * abAmt > 0.00001) {
    vec3 dC; float dM; float dH; float dW;
    col.r = field(uv + off, aspect, act, dC, dM, dH, dW).r;
    col.g = centerCol.g;
    col.b = field(uv - off, aspect, act, dC, dM, dH, dW).b;
  } else {
    col = centerCol;
  }

  /* ink applied once at the center sample — no channel separation,
     so the color inside a tube stays one clean smooth tone         */
  col = mix(col, col * inkC, inkM * uInkUnderRibbons);
  col += inkC * inkM * uTorchGlow * hC;
  col = mix(col, mix(col, inkC, inkM), 1.0 - uInkUnderRibbons);

  /* grade */
  col = hueRotate(col, radians(uHueShift));
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, uSaturation);
  col = (col - 0.5) * uContrast + 0.5 + uBrightness;
  col = pow(max(col, 0.0), vec3(1.0 / max(uGamma, 0.05)));

  /* grain */
  col += (rand(vUv * uResolution + fract(uTime * uGrainSpeed) * 100.0) - 0.5) * uGrain;

  /* vignette */
  vec2 vc = vUv - 0.5;
  vc.x *= aspect;
  float vig = smoothstep(uVignetteRadius, uVignetteRadius - 0.6, length(vc));
  col = mix(col * (1.0 - uVignette), col, vig);

  if (uInvert > 0.5) col = 1.0 - col;

  gl_FragColor = vec4(col, 1.0);
}
`;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const quad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })
);
scene.add(quad);

/* ------------------------------------------------------------------ */
/*  MOUSE + INK TRAIL                                                  */
/* ------------------------------------------------------------------ */
const mouseTarget = new THREE.Vector2(0.5, 0.5);
const mouseSmooth = new THREE.Vector2(0.5, 0.5);
const mousePrev = new THREE.Vector2(0.5, 0.5);
const trail = Array.from({ length: TRAIL_COUNT }, () => ({
  x: 0.5, y: 0.5, s: 0, r: 1, color: new THREE.Color(1, 1, 1),
}));
let frame = 0;
let inkPhase = 0;

window.addEventListener("pointermove", (e) => {
  mouseTarget.set(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
});

const inkGradient = new THREE.Color();
function sampleInk(t) {
  // loops through ink1..ink4 smoothly
  const stops = [params.ink1, params.ink2, params.ink3, params.ink4].map(
    (c) => new THREE.Color(c)
  );
  const x = ((t % 1) + 1) % 1;
  const seg = Math.floor(x * 4);
  const local = x * 4 - seg;
  inkGradient.copy(stops[seg]).lerp(stops[(seg + 1) % 4], local);
  return inkGradient;
}

function updateMouse(dt) {
  mousePrev.copy(mouseSmooth);
  mouseSmooth.lerp(mouseTarget, params.mouseSmoothing);
  const vel = new THREE.Vector2().subVectors(mouseSmooth, mousePrev);
  uniforms.uMouse.value.copy(mouseSmooth);
  uniforms.uMouseVel.value.lerp(vel.clone().multiplyScalar(30), 0.2);

  const speed = vel.length();
  if (params.colorMode === "Cycle") {
    inkPhase += params.inkCycleSpeed * dt + speed * 0.15;
  }

  for (const t of trail) t.s *= params.inkDecay;

  // drop a new splat only while actually moving
  if (frame % 2 === 0 && speed > 0.0004) {
    trail.pop();
    /* pick the target color for this stroke point */
    let target;
    if (params.colorMode === "Single") {
      target = new THREE.Color(params.ink1);
    } else if (params.colorMode === "Gradient") {
      // smooth gradient across the screen, driven by cursor position
      target = sampleInk(mouseSmooth.x * 0.75).clone();
    } else {
      target = sampleInk(inkPhase).clone();
    }
    /* blend toward the previous point so the stroke never stripes */
    const c = trail[0].color.clone().lerp(target, 1 - params.inkBlend);
    trail.unshift({
      x: mouseSmooth.x,
      y: mouseSmooth.y,
      s: Math.min(1, 0.35 + speed * 25),
      r: 0.9 + Math.min(0.5, speed * 12),
      color: c,
    });
  }

  for (let i = 0; i < TRAIL_COUNT; i++) {
    const t = trail[i];
    trailData[i * 4 + 0] = t.x;
    trailData[i * 4 + 1] = t.y;
    trailData[i * 4 + 2] = t.s;
    trailData[i * 4 + 3] = t.r;
    trailColorData[i * 3 + 0] = t.color.r;
    trailColorData[i * 3 + 1] = t.color.g;
    trailColorData[i * 3 + 2] = t.color.b;
  }
}

/* ------------------------------------------------------------------ */
/*  SYNC PARAMS -> UNIFORMS                                            */
/* ------------------------------------------------------------------ */
function syncUniforms() {
  uniforms.uPaperColor.value.set(params.paperColor);
  uniforms.uShadowColor.value.set(params.shadowColor);
  uniforms.uStripeAngle.value = params.stripeAngle;
  uniforms.uStripeFreq.value = params.stripeFreq;
  uniforms.uStripeDepth.value = params.stripeDepth;
  uniforms.uShadowSoftness.value = params.shadowSoftness;
  uniforms.uSpecStrength.value = params.specStrength;
  uniforms.uTubeRound.value = params.tubeRound;
  uniforms.uLightAngle.value = params.lightAngle;
  uniforms.uAmbient.value = params.ambient;
  uniforms.uDiffuse.value = params.diffuse;
  uniforms.uGlossSharp.value = params.glossSharp;
  uniforms.uFresnel.value = params.fresnel;
  uniforms.uFresnelPow.value = params.fresnelPow;
  uniforms.uRefraction.value = params.refraction;
  uniforms.uStripeDrift.value = params.stripeDrift;
  uniforms.uBlockFreq.value = params.blockFreq;
  uniforms.uBlockDepth.value = params.blockDepth;
  uniforms.uBlockSoftness.value = params.blockSoftness;
  uniforms.uBlockStagger.value = params.blockStagger;
  uniforms.uRevealRadius.value = params.revealRadius;
  uniforms.uIdleContrast.value = params.idleContrast;
  uniforms.uHoverContrast.value = params.hoverContrast;

  uniforms.uNoiseScale.value = params.noiseScale;
  uniforms.uWarpStrength.value = params.warpStrength;
  uniforms.uTimeSpeed.value = params.timeSpeed;
  uniforms.uOctaves.value = params.octaves;
  uniforms.uLacunarity.value = params.lacunarity;
  uniforms.uGain.value = params.gain;

  uniforms.uInkIntensity.value = params.inkIntensity;
  uniforms.uInkRadius.value = params.inkRadius;
  uniforms.uInkSoftness.value = params.inkSoftness;
  uniforms.uInkSaturation.value = params.inkSaturation;
  uniforms.uInkUnderRibbons.value = params.inkUnderRibbons;
  uniforms.uTubeSpread.value = params.tubeSpread;
  uniforms.uTubeConfine.value = params.tubeConfine;
  uniforms.uTorchGlow.value = params.torchGlow;
  uniforms.uFluidWarp.value = params.fluidWarp;
  uniforms.uFluidScale.value = params.fluidScale;
  uniforms.uFluidSpeed.value = params.fluidSpeed;
  uniforms.uInkStretch.value = params.inkStretch;

  uniforms.uBendRadius.value = params.bendRadius;
  uniforms.uBendStrength.value = params.bendStrength;
  uniforms.uVelocitySmear.value = params.velocitySmear;
  uniforms.uMousePush.value = params.mousePush;

  uniforms.uAberration.value = params.chromaticAberration;
  uniforms.uAberrationAngle.value = params.aberrationAngle;
  uniforms.uFringeOnInk.value = params.fringeOnInk;
  uniforms.uGrain.value = params.grain;
  uniforms.uGrainSpeed.value = params.grainSpeed;
  uniforms.uVignette.value = params.vignette;
  uniforms.uVignetteRadius.value = params.vignetteRadius;
  uniforms.uContrast.value = params.contrast;
  uniforms.uBrightness.value = params.brightness;
  uniforms.uSaturation.value = params.saturation;
  uniforms.uHueShift.value = params.hueShift;
  uniforms.uGamma.value = params.gamma;
  uniforms.uBlurEdges.value = params.blurEdges;
  uniforms.uInvert.value = params.invert ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/*  PRESETS                                                            */
/* ------------------------------------------------------------------ */
const defaults = JSON.parse(JSON.stringify(params));

const presets = {
  "Silk Paper": {},
  "Dark Velvet": {
    paperColor: "#141418", shadowColor: "#000000",
    ink1: "#ff4fd8", ink2: "#ff9d3d", ink3: "#7bff5e", ink4: "#4fc9ff",
    inkUnderRibbons: 0.3, inkIntensity: 1.4, stripeDepth: 0.5,
    specStrength: 0.5, chromaticAberration: 0.004, grain: 0.05,
  },
  "Pastel Dream": {
    paperColor: "#fdf6ef", shadowColor: "#e3d5e8",
    ink1: "#f9a8d4", ink2: "#fcd9a8", ink3: "#bfe8b0", ink4: "#a8c8f9",
    stripeFreq: 6, stripeDepth: 0.22, specStrength: 0.25,
    inkRadius: 0.32, inkSoftness: 1.6, chromaticAberration: 0.0015,
  },
  "Hologram Foil": {
    paperColor: "#eef0f5", shadowColor: "#b8bcd0",
    stripeFreq: 16, stripeDepth: 0.4, tubeRound: 1.6,
    specStrength: 1.2, glossSharp: 30, chromaticAberration: 0.006,
    inkCycleSpeed: 1.2, warpStrength: 0.55, hueShift: 0,
  },
  "Ink Storm": {
    inkIntensity: 1.8, inkRadius: 0.35, inkDecay: 0.994,
    inkSoftness: 0.7, bendStrength: 0.6, velocitySmear: 2.5,
    warpStrength: 0.6, stripeDepth: 0.3,
  },
  "Fine Lines": {
    stripeFreq: 28, stripeDepth: 0.25, tubeRound: 0.8,
    specStrength: 0.4, warpStrength: 0.2, chromaticAberration: 0.0018,
    inkRadius: 0.18, grain: 0.04,
  },
};

function applyPreset(name) {
  Object.assign(params, defaults, presets[name]);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  syncUniforms();
}

/* ------------------------------------------------------------------ */
/*  GUI                                                                */
/* ------------------------------------------------------------------ */
const gui = new GUI({ title: "SILK RIBBONS — 020" });

const actions = {
  preset: "Silk Paper",
  copySettings: async () => {
    const json = JSON.stringify(params, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      flashTitle("✓ COPIED TO CLIPBOARD");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = json;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      flashTitle("✓ COPIED TO CLIPBOARD");
    }
  },
  pasteSettings: async () => {
    try {
      const text = await navigator.clipboard.readText();
      const obj = JSON.parse(text);
      Object.assign(params, obj);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      syncUniforms();
      flashTitle("✓ SETTINGS LOADED");
    } catch {
      flashTitle("✗ CLIPBOARD IS NOT VALID JSON");
    }
  },
  randomize: () => {
    const r = (a, b) => a + Math.random() * (b - a);
    const rc = (l0, l1) =>
      "#" + new THREE.Color().setHSL(Math.random(), r(0.6, 1), r(l0, l1)).getHexString();
    Object.assign(params, {
      ink1: rc(0.5, 0.65), ink2: rc(0.5, 0.65), ink3: rc(0.5, 0.65), ink4: rc(0.5, 0.65),
      stripeAngle: r(-70, 70), stripeFreq: r(5, 22), stripeDepth: r(0.15, 0.5),
      tubeRound: r(0.6, 1.8), specStrength: r(0.3, 1.2), glossSharp: r(20, 120),
      refraction: r(0.2, 1.2),
      warpStrength: r(0.1, 0.7), noiseScale: r(0.8, 2.5),
      chromaticAberration: r(0.001, 0.006),
      inkRadius: r(0.15, 0.4), inkCycleSpeed: r(0.1, 1),
    });
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    syncUniforms();
  },
  reset: () => {
    Object.assign(params, defaults);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    syncUniforms();
  },
};

function flashTitle(text) {
  const el = gui.$title;
  const original = "SILK RIBBONS — 020";
  el.textContent = text;
  setTimeout(() => (el.textContent = original), 1400);
}

gui.add(actions, "preset", Object.keys(presets)).name("Preset").onChange(applyPreset);
gui.add(actions, "copySettings").name("📋 Copy All Settings");
gui.add(actions, "pasteSettings").name("📥 Paste Settings");
gui.add(actions, "randomize").name("🎲 Randomize");
gui.add(actions, "reset").name("↺ Reset");

const fRibbon = gui.addFolder("Ribbons");
fRibbon.addColor(params, "paperColor").name("Paper");
fRibbon.addColor(params, "shadowColor").name("Fold Shadow");
fRibbon.add(params, "stripeAngle", -90, 90, 1).name("Angle°");
fRibbon.add(params, "stripeFreq", 2, 40, 0.1).name("Count");
fRibbon.add(params, "stripeDepth", 0, 0.8, 0.01).name("Shadow Depth");
fRibbon.add(params, "shadowSoftness", 0.05, 1, 0.01).name("Shadow Blur");

const fTube = gui.addFolder("Tube Light");
fTube.add(params, "tubeRound", 0.1, 3, 0.01).name("Roundness");
fTube.add(params, "lightAngle", -90, 90, 1).name("Light Angle°");
fTube.add(params, "ambient", 0.3, 1.2, 0.01).name("Ambient");
fTube.add(params, "diffuse", 0, 1, 0.01).name("Depth Shading");
fTube.add(params, "specStrength", 0, 2, 0.01).name("Water Gloss");
fTube.add(params, "glossSharp", 4, 200, 1).name("Gloss Tightness");
fTube.add(params, "fresnel", 0, 1, 0.01).name("Glass Edge");
fTube.add(params, "fresnelPow", 1, 8, 0.1).name("Edge Falloff");
fTube.add(params, "refraction", 0, 2, 0.01).name("Refraction");
fRibbon.add(params, "stripeDrift", -0.2, 0.2, 0.005).name("Drift Speed");
fRibbon.add(params, "blurEdges", 0, 1, 0.01).name("Frosted Blur");

const fReveal = gui.addFolder("Hover Reveal");
fReveal.add(params, "revealRadius", 0.1, 1.5, 0.01).name("Reveal Radius");
fReveal.add(params, "idleContrast", 0, 1.5, 0.01).name("Idle Contrast");
fReveal.add(params, "hoverContrast", 0, 2.5, 0.01).name("Hover Contrast");

const fBlocks = gui.addFolder("Strip Patches");
fBlocks.add(params, "blockFreq", 0.5, 10, 0.05).name("Patch Count");
fBlocks.add(params, "blockDepth", 0, 0.5, 0.005).name("Patch Depth");
fBlocks.add(params, "blockSoftness", 0.05, 1, 0.01).name("Patch Blur");
fBlocks.add(params, "blockStagger", 0, 2, 0.01).name("Stagger");

const fWave = gui.addFolder("Waviness");
fWave.add(params, "warpStrength", 0, 1.5, 0.01).name("Warp");
fWave.add(params, "noiseScale", 0.2, 5, 0.01).name("Noise Scale");
fWave.add(params, "timeSpeed", 0, 0.6, 0.005).name("Evolution");
fWave.add(params, "octaves", 1, 6, 1).name("Octaves");
fWave.add(params, "lacunarity", 1, 4, 0.01).name("Lacunarity");
fWave.add(params, "gain", 0.1, 0.9, 0.01).name("Gain");
fWave.close();

const fInk = gui.addFolder("Ink Colors");
fInk.add(params, "colorMode", ["Single", "Gradient", "Cycle"]).name("Color Mode");
fInk.add(params, "inkBlend", 0, 0.98, 0.01).name("Color Blend");
fInk.addColor(params, "ink1").name("Ink 1");
fInk.addColor(params, "ink2").name("Ink 2");
fInk.addColor(params, "ink3").name("Ink 3");
fInk.addColor(params, "ink4").name("Ink 4");
fInk.add(params, "inkIntensity", 0, 3, 0.01).name("Intensity");
fInk.add(params, "inkRadius", 0.05, 0.8, 0.01).name("Blob Size");
fInk.add(params, "inkSoftness", 0.2, 3, 0.01).name("Blur");
fInk.add(params, "inkCycleSpeed", 0, 2, 0.01).name("Color Cycle");
fInk.add(params, "inkDecay", 0.9, 0.999, 0.001).name("Linger");
fInk.add(params, "inkSaturation", 0, 2, 0.01).name("Saturation");
fInk.add(params, "inkUnderRibbons", 0, 1, 0.01).name("Under Ribbons");
fInk.add(params, "tubeSpread", 0.2, 4, 0.01).name("Tube Spread");
fInk.add(params, "tubeConfine", 0, 4, 0.01).name("Tube Confine");
fInk.add(params, "torchGlow", 0, 1.5, 0.01).name("Torch Glow");

const fFluid = gui.addFolder("Fluid Motion");
fFluid.add(params, "fluidWarp", 0, 0.6, 0.005).name("Liquid Wobble");
fFluid.add(params, "fluidScale", 0.5, 8, 0.05).name("Wobble Scale");
fFluid.add(params, "fluidSpeed", 0, 2, 0.01).name("Churn Speed");
fFluid.add(params, "inkStretch", 0, 4, 0.01).name("Stroke Stretch");

const fMouse = gui.addFolder("Mouse");
fMouse.add(params, "mouseSmoothing", 0.02, 0.3, 0.005).name("Smoothing");
fMouse.add(params, "bendRadius", 0.05, 1, 0.01).name("Bend Radius");
fMouse.add(params, "bendStrength", 0, 1.5, 0.01).name("Bend Strength");
fMouse.add(params, "velocitySmear", 0, 5, 0.01).name("Velocity Smear");
fMouse.add(params, "mousePush", -2, 2, 0.05).name("Push / Pull");

const fPost = gui.addFolder("Post / Grade");
fPost.add(params, "chromaticAberration", 0, 0.015, 0.0001).name("Fringe");
fPost.add(params, "aberrationAngle", -180, 180, 1).name("Fringe Angle°");
fPost.add(params, "fringeOnInk", 0, 1, 0.01).name("Fringe On Color");
fPost.add(params, "grain", 0, 0.3, 0.005).name("Grain");
fPost.add(params, "grainSpeed", 0, 5, 0.05).name("Grain Speed");
fPost.add(params, "vignette", 0, 1, 0.01).name("Vignette");
fPost.add(params, "vignetteRadius", 0.2, 1.5, 0.01).name("Vignette Radius");
fPost.add(params, "contrast", 0.3, 2, 0.01).name("Contrast");
fPost.add(params, "brightness", -0.4, 0.4, 0.01).name("Brightness");
fPost.add(params, "saturation", 0, 2.5, 0.01).name("Saturation");
fPost.add(params, "hueShift", -180, 180, 1).name("Hue Shift°");
fPost.add(params, "gamma", 0.3, 2.5, 0.01).name("Gamma");
fPost.add(params, "invert").name("Invert");
fPost.close();

const fAnim = gui.addFolder("Animation");
fAnim.add(params, "globalSpeed", 0, 3, 0.01).name("Global Speed");
fAnim.add(params, "paused").name("Pause");
fAnim.close();

gui.onChange(syncUniforms);

/* ------------------------------------------------------------------ */
/*  LOOP + RESIZE                                                      */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (!params.paused) elapsed += dt * params.globalSpeed;
  uniforms.uTime.value = elapsed;
  frame++;
  updateMouse(dt);
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
});

syncUniforms();
animate();
