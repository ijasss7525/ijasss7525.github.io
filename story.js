/* =====================================================================
   The story: one claim and one knee, start to finish.
   A scroll-driven 3D scene with hand-built, rigged characters.
   Everything is a function of scroll progress (p) plus idle time (t),
   so scrolling backwards replays the story in reverse.
   ===================================================================== */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const section = document.getElementById('story');
const canvas = document.getElementById('storyCanvas');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(max-width: 760px)').matches;

function fail() { section && section.classList.add('no3d'); }
if (!section || !canvas || !window.gsap || !window.ScrollTrigger) { fail(); throw new Error('story: missing deps'); }

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) { fail(); throw e; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.3 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = !mobile;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(mobile ? 50 : 38, 1, 0.1, 120);

/* ---------- palette ---------- */
const P = {
  teal: '#0B7A87', tealLite: '#4CC3D1', tealDeep: '#064E57', signal: '#D9480F', signalLite: '#FF8A5B',
  ink: '#0B1F2A', cream: '#FFF8EE', white: '#F7FBFB', gold: '#F2B33D', wood: '#B7835A', woodDark: '#7A5235',
  wall: '#E7EFEF', plant: '#2F8F5B', plantDark: '#1F6B42', denim: '#3B5B8C', sky: '#BFE6EE',
};
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (p, a, b) => clamp((p - a) / (b - a));
const sm = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const ease = (x) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const backOut = (x) => { x = clamp(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const win = (p, a, b, f = .02) => Math.min(prog(p, a - f, a + f), 1 - prog(p, b - f, b + f));

/* ---------- toon materials + ink outlines ---------- */
const gradTex = (() => {
  const t = new THREE.DataTexture(new Uint8Array([70, 150, 215, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
})();
const matCache = new Map();
function toon(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: gradTex }, extra || {})));
  return matCache.get(key);
}
const outlineMat = new THREE.ShaderMaterial({
  uniforms: { thick: { value: .011 }, col: { value: new THREE.Color('#0B1F2A') } },
  vertexShader: 'uniform float thick; void main(){ vec3 p = position + normal * thick; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
  fragmentShader: 'uniform vec3 col; void main(){ gl_FragColor = vec4(col, 1.0); }',
  side: THREE.BackSide,
});
const outlineCache = new WeakMap();
function outlineGeo(g) {
  let o = outlineCache.get(g);
  if (!o) {
    o = g.clone(); o.deleteAttribute('normal'); if (o.attributes.uv) o.deleteAttribute('uv');
    o = mergeVertices(o, 1e-3); o.computeVertexNormals(); outlineCache.set(g, o);
  }
  return o;
}
function mesh(geo, color, parent, x = 0, y = 0, z = 0, o = {}) {
  const mat = (color && color.isMaterial) ? color : toon(color);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = o.cast !== false; m.receiveShadow = !!o.receive;
  if (o.outline !== false) { const h = new THREE.Mesh(outlineGeo(geo), outlineMat); h.raycast = () => {}; m.add(h); }
  if (parent) parent.add(m);
  return m;
}
const G = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); if (parent) parent.add(g); return g; };
const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14);
const sph = (r, ws = 20, hs = 14) => new THREE.SphereGeometry(r, ws, hs);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 20, hs = 1, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, hs, open);

/* =====================================================================
   Character rig
   hips > spine > (neck > head > face) + shoulders > elbows > wrists
   hips > legs (hip > knee > ankle > shoe)
   Faces +Z. Limbs hang along -Y. Forward swing = negative X rotation.
   ===================================================================== */
function Character(cfg) {
  const c = { cfg, blinkAt: Math.random() * 3, blink: 0 };
  const root = c.root = new THREE.Group();
  const skin = cfg.skin, hairC = cfg.hair;
  const sleeveLong = cfg.sleeves !== 'short';

  const hips = c.hips = G(root, 0, .92, 0);
  mesh(sph(.15).scale(1.05, .72, .78), cfg.pants, hips, 0, -.02, 0);
  if (cfg.belt) mesh(new THREE.TorusGeometry(.148, .016, 8, 28).rotateX(Math.PI / 2).scale(1, 1, .78), cfg.belt, hips, 0, .05, 0, { outline: false });

  const spine = c.spine = G(hips, 0, .04, 0);
  c.torso = mesh(cap(.165, .24).scale(1, 1, .7), cfg.shirt, spine, 0, .24, 0);
  // collar + buttons + pocket
  mesh(new THREE.TorusGeometry(.075, .022, 8, 20).rotateX(Math.PI / 2 - .25), cfg.collar || cfg.shirt, spine, 0, .5, .005);
  if (cfg.buttons) for (let i = 0; i < 3; i++) mesh(sph(.011, 8, 6), cfg.buttons, spine, 0, .42 - i * .09, .118, { outline: false, cast: false });
  if (cfg.hoodie) {
    mesh(new THREE.TorusGeometry(.12, .045, 10, 22).rotateX(Math.PI / 2 + .5), cfg.shirt, spine, 0, .5, -.06);
    for (const s of [-1, 1]) mesh(cap(.006, .1), '#F5F0E6', spine, s * .035, .4, .118, { outline: false, cast: false });
    mesh(cap(.05, .14).rotateZ(Math.PI / 2).scale(1, .7, .4), cfg.shirt, spine, 0, .16, .1);
  }
  if (cfg.coat) {
    const coatGeo = new THREE.CylinderGeometry(.19, .25, .78, 24, 1, true, .35, Math.PI * 2 - .7);
    const coat = mesh(coatGeo, toon(cfg.coat, { side: THREE.DoubleSide }), spine, 0, .14, 0);
    coat.scale.z = .78; coat.rotation.y = Math.PI;
    for (const s of [-1, 1]) {
      const lapel = mesh(box(.05, .26, .012), cfg.coat, spine, s * .075, .38, .118);
      lapel.rotation.z = s * .28;
      mesh(box(.08, .07, .01), cfg.coat, spine, s * .11, -.02, .17).rotation.x = -.15;
    }
    mesh(box(.012, .06, .006), P.teal, spine, -.1, .03, .182, { outline: false });
  }
  if (cfg.badge) {
    const pts = [new THREE.Vector3(-.07, .5, .09), new THREE.Vector3(-.04, .36, .125), new THREE.Vector3(0, .3, .13), new THREE.Vector3(.04, .36, .125), new THREE.Vector3(.07, .5, .09)];
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, .006, 5), cfg.badge, spine, 0, 0, 0, { outline: false, cast: false });
    const card = mesh(box(.07, .095, .008), P.white, spine, 0, .25, .135);
    mesh(box(.05, .022, .002), cfg.badge, card, 0, .025, .005, { outline: false, cast: false });
    mesh(new THREE.CircleGeometry(.014, 12), '#C9A27E', card, 0, -.012, .005, { outline: false, cast: false });
  }
  if (cfg.stethoscope) {
    const pts = [new THREE.Vector3(-.06, .3, .14), new THREE.Vector3(-.1, .5, .07), new THREE.Vector3(0, .58, -.07), new THREE.Vector3(.1, .5, .07), new THREE.Vector3(.07, .32, .14), new THREE.Vector3(.05, .18, .15)];
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, .011, 6), '#26343C', spine, 0, 0, 0, { cast: false });
    mesh(cyl(.026, .026, .016), '#C7D3D8', spine, .05, .16, .155).rotation.x = Math.PI / 2;
  }

  // neck + head
  const neck = c.neck = G(spine, 0, .53, 0);
  mesh(cyl(.05, .056, .12, 14), skin, neck, 0, .03, 0);
  const head = c.head = G(neck, 0, .1, 0);
  const skull = mesh(sph(.17, 28, 20).scale(1, 1.07, 1), skin, head, 0, .11, 0);
  const face = c.face = G(head, 0, .11, 0);
  for (const s of [-1, 1]) mesh(sph(.036, 12, 10).scale(.5, 1, .8), skin, face, s * .168, 0, -.005);
  mesh(sph(.022, 12, 10).scale(1, .9, 1.1), cfg.nose || skin, face, 0, -.012, .168, { outline: false });
  c.eyes = [];
  for (const s of [-1, 1]) {
    const e = G(face, s * .062, .022, .146);
    mesh(sph(.034, 16, 12).scale(1, 1.05, .6), '#FFFFFF', e, 0, 0, 0);
    const iris = mesh(sph(.021, 14, 10).scale(1, 1, .5), cfg.eye || '#4A2E1F', e, 0, -.002, .016, { outline: false, cast: false });
    mesh(sph(.011, 10, 8).scale(1, 1, .5), '#0B0F12', iris, 0, 0, .007, { outline: false, cast: false });
    mesh(sph(.0055, 8, 6), '#FFFFFF', iris, .008, .008, .012, { outline: false, cast: false });
    // upper lash line
    const lash = mesh(new THREE.TorusGeometry(.033, .005, 4, 14, Math.PI).scale(1, .55, 1), '#1A1410', e, 0, .002, .012, { outline: false, cast: false });
    lash.rotation.x = -.25;
    c.eyes.push(e);
  }
  c.brows = [-1, 1].map((s) => {
    const b = mesh(cap(.009, .042).rotateZ(Math.PI / 2), hairC, face, s * .064, .078, .152, { outline: false, cast: false });
    b.rotation.z = s * -.12; return b;
  });
  c.mouth = mesh(new THREE.TorusGeometry(.032, .0075, 6, 18, Math.PI), '#7A2E2E', face, 0, -.058, .157, { outline: false, cast: false });
  c.mouth.rotation.z = Math.PI;
  c.mouthOpen = mesh(sph(.022, 12, 8).scale(1.2, .7, .4), '#5A1E22', face, 0, -.064, .155, { outline: false, cast: false });
  c.mouthOpen.visible = false;
  for (const s of [-1, 1]) {
    const ch = mesh(new THREE.CircleGeometry(.026, 16), toon('#F08F8F', { transparent: true, opacity: .4 }), face, s * .1, -.03, .135, { outline: false, cast: false });
    ch.rotation.y = s * .55;
  }
  if (cfg.glasses) {
    for (const s of [-1, 1]) mesh(new THREE.TorusGeometry(.04, .006, 6, 22), cfg.glasses, face, s * .064, .022, .175, { outline: false, cast: false });
    mesh(cap(.005, .03).rotateZ(Math.PI / 2), cfg.glasses, face, 0, .028, .178, { outline: false, cast: false });
    for (const s of [-1, 1]) mesh(cap(.005, .14).rotateX(Math.PI / 2), cfg.glasses, face, s * .1, .03, .1, { outline: false, cast: false });
  }
  if (cfg.beard) mesh(new THREE.SphereGeometry(.176, 24, 14, 0, Math.PI * 2, Math.PI * .66, Math.PI * .34), cfg.beard, face, 0, .0, -.004);

  // hair
  const hair = G(head, 0, .11, 0);
  const capGeo = new THREE.SphereGeometry(.18, 28, 18, 0, Math.PI * 2, 0, Math.PI * .52);
  const hcap = mesh(capGeo, hairC, hair, 0, .012, -.012); hcap.rotation.x = -.38;
  if (cfg.hairStyle === 'bun') {
    mesh(sph(.075, 16, 12), hairC, hair, 0, .19, -.1);
    mesh(new THREE.TorusGeometry(.05, .012, 6, 16).rotateX(Math.PI / 2.6), cfg.accent || P.signal, hair, 0, .15, -.085, { outline: false });
    for (const s of [-1, 1]) mesh(cap(.03, .09).rotateZ(s * .35), hairC, hair, s * .13, .02, .07);
  } else if (cfg.hairStyle === 'swoop') {
    const sw = mesh(cap(.05, .2).rotateZ(Math.PI / 2 - .3), hairC, hair, .03, .14, .1); sw.scale.z = .7;
    mesh(cap(.04, .08), hairC, hair, -.16, .04, 0);
    mesh(cap(.04, .08), hairC, hair, .16, .04, 0);
  } else if (cfg.hairStyle === 'curly') {
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2;
      mesh(sph(.06, 10, 8), hairC, hair, Math.cos(a) * .13, .1 + Math.sin(i * 1.7) * .03, Math.sin(a) * .12 - .03);
    }
    mesh(sph(.08, 12, 10), hairC, hair, 0, .18, -.02);
  } else if (cfg.hairStyle === 'long') {
    const back = mesh(cap(.15, .2), hairC, hair, 0, -.1, -.08); back.scale.z = .55;
    mesh(cap(.035, .16).rotateZ(-.2), hairC, hair, .13, .04, .08);
  }
  if (cfg.headset) {
    mesh(new THREE.TorusGeometry(.19, .012, 8, 24, Math.PI), '#26343C', head, 0, .12, 0, { outline: false });
    for (const s of [-1, 1]) mesh(cyl(.045, .045, .03, 16).rotateZ(Math.PI / 2), '#26343C', head, s * .18, .1, 0);
    const mic = mesh(cap(.007, .13).rotateX(Math.PI / 2 - .3).rotateY(.6), '#26343C', head, -.14, .04, .08, { outline: false });
    mesh(sph(.016, 8, 6), P.signal, mic, 0, -.05, .06, { outline: false });
  }

  // arms
  const armColor = sleeveLong ? (cfg.coat || cfg.shirt) : skin;
  const mkArm = (s) => {
    const sh = G(spine, s * .2, .43, 0);
    mesh(sph(.06, 14, 10), cfg.coat || cfg.shirt, sh, 0, 0, 0);
    mesh(cap(.052, .24), cfg.coat || cfg.shirt, sh, 0, -.12, 0);
    const el = G(sh, 0, -.25, 0);
    mesh(cap(.045, .22), armColor, el, 0, -.11, 0);
    if (sleeveLong) mesh(new THREE.TorusGeometry(.047, .012, 6, 16).rotateX(Math.PI / 2), cfg.cuff || armColor, el, 0, -.22, 0, { outline: false });
    if (cfg.watch && s === 1) mesh(new THREE.TorusGeometry(.045, .012, 6, 16).rotateX(Math.PI / 2), cfg.watch, el, 0, -.2, 0, { outline: false });
    const wr = G(el, 0, -.25, 0);
    mesh(sph(.048, 14, 10).scale(.85, 1.15, .6), skin, wr, 0, -.03, 0);
    const th = mesh(cap(.016, .03).rotateZ(s * .6), skin, wr, s * -.035, -.015, .02);
    th.rotation.x = -.4;
    for (let i = 0; i < 4; i++) mesh(cap(.011, .025), skin, wr, (i - 1.5) * .019 * s, -.085, .005, { outline: false });
    return { sh, el, wr };
  };
  const L = mkArm(1), R = mkArm(-1);
  c.shoulderL = L.sh; c.elbowL = L.el; c.wristL = L.wr;
  c.shoulderR = R.sh; c.elbowR = R.el; c.wristR = R.wr;
  c.shoulderL.rotation.z = .08; c.shoulderR.rotation.z = -.08;

  // legs
  const mkLeg = (s) => {
    const hp = G(hips, s * .092, -.05, 0);
    mesh(cap(.068, .36), cfg.pants, hp, 0, -.2, 0);
    const kn = G(hp, 0, -.4, 0);
    mesh(cap(.058, .34), cfg.pants, kn, 0, -.18, 0);
    if (cfg.cuffs) mesh(new THREE.TorusGeometry(.058, .014, 6, 16).rotateX(Math.PI / 2), cfg.cuffs, kn, 0, -.33, 0, { outline: false });
    const an = G(kn, 0, -.39, 0);
    const shoe = mesh(cap(.052, .1).rotateX(Math.PI / 2), cfg.shoes, an, 0, -.025, .04);
    shoe.scale.set(1.05, .8, 1);
    mesh(box(.1, .018, .2), cfg.sole || '#F2F2F2', an, 0, -.062, .04, { outline: false });
    if (cfg.laces) mesh(box(.05, .006, .05), cfg.laces, an, 0, .012, .07, { outline: false, cast: false });
    return { hp, kn, an };
  };
  const LL = mkLeg(1), RL = mkLeg(-1);
  c.hipL = LL.hp; c.kneeL = LL.kn; c.ankleL = LL.an;
  c.hipR = RL.hp; c.kneeR = RL.kn; c.ankleR = RL.an;

  // name tag anchor (top of head)
  c.tagAnchor = G(head, 0, .42, 0);
  c.skull = skull;
  return c;
}

/* ---------- character behaviours ---------- */
function resetPose(c) {
  for (const k of ['hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'spine', 'neck', 'head']) {
    c[k].rotation.set(0, 0, 0);
  }
  c.shoulderL.rotation.z = .08; c.shoulderR.rotation.z = -.08;
  c.elbowL.rotation.x = -.12; c.elbowR.rotation.x = -.12;
  c.hips.position.set(0, .92, 0); c.hips.rotation.set(0, 0, 0);
}
function idle(c, t, amt = 1) {
  const br = Math.sin(t * 1.6 + c.cfg.seed);
  c.spine.rotation.x = -.02 + br * .012 * amt;
  c.spine.scale.y = 1 + br * .006 * amt;
  c.shoulderL.rotation.z += br * .02 * amt; c.shoulderR.rotation.z -= br * .02 * amt;
  c.head.rotation.z += Math.sin(t * .7 + c.cfg.seed) * .03 * amt;
  c.head.rotation.y += Math.sin(t * .45 + c.cfg.seed * 2) * .06 * amt;
}
function face(c, t, mood = 'neutral') {
  // blinking
  if (t > c.blinkAt) { c.blink = t; c.blinkAt = t + 2 + Math.random() * 3.5; }
  if (t < c.blink) { c.blink = -9; c.blinkAt = t + 1; }
  const b = t - c.blink, sy = (b >= 0 && b < .16) ? Math.max(.08, Math.abs(1 - b / .08)) : 1;
  c.eyes.forEach((e) => { e.scale.y = sy; });
  const happy = mood === 'happy' || mood === 'joy';
  c.brows.forEach((br, i) => { br.position.y = .078 + (happy ? .012 : mood === 'focus' ? -.006 : 0); br.rotation.z = (i ? -1 : 1) * (mood === 'focus' ? .2 : -.12); });
  c.mouth.visible = mood !== 'joy'; c.mouthOpen.visible = mood === 'joy';
  c.mouth.scale.set(happy ? 1.15 : mood === 'focus' ? .7 : 1, happy ? 1.25 : mood === 'focus' ? .4 : .8, 1);
}
function walk(c, phase, amt) {
  const s = Math.sin(phase), co = Math.cos(phase);
  c.hipL.rotation.x = -.48 * s * amt; c.hipR.rotation.x = .48 * s * amt;
  c.kneeL.rotation.x = (.12 + .75 * Math.max(0, co)) * amt;
  c.kneeR.rotation.x = (.12 + .75 * Math.max(0, -co)) * amt;
  c.ankleL.rotation.x = -c.hipL.rotation.x * .4 - c.kneeL.rotation.x * .3;
  c.ankleR.rotation.x = -c.hipR.rotation.x * .4 - c.kneeR.rotation.x * .3;
  c.shoulderL.rotation.x = .4 * s * amt; c.shoulderR.rotation.x = -.4 * s * amt;
  c.elbowL.rotation.x = -.25 - .2 * Math.max(0, -s) * amt; c.elbowR.rotation.x = -.25 - .2 * Math.max(0, s) * amt;
  c.hips.position.y = .92 - .035 * amt + .035 * Math.abs(co) * amt;
  c.hips.rotation.y = .08 * s * amt; c.spine.rotation.y = -.14 * s * amt;
  c.spine.rotation.x = .05 * amt;
}
function wave(c, t, amt, side = 'R') {
  const sh = side === 'R' ? c.shoulderR : c.shoulderL, el = side === 'R' ? c.elbowR : c.elbowL, wr = side === 'R' ? c.wristR : c.wristL;
  const sgn = side === 'R' ? -1 : 1;
  sh.rotation.z = lerp(sh.rotation.z, sgn * 2.5, amt);
  sh.rotation.x = lerp(sh.rotation.x, -.2, amt);
  el.rotation.z = lerp(0, sgn * (.5 + .45 * Math.sin(t * 9)), amt);
  el.rotation.x = lerp(el.rotation.x, -.2, amt);
  wr.rotation.z = lerp(0, sgn * .2 * Math.sin(t * 9 + .6), amt);
}
function sit(c, kneeExt = 0) {
  c.hips.position.y = .53;
  c.hipL.rotation.x = c.hipR.rotation.x = -1.5;
  c.kneeL.rotation.x = 1.5;
  c.kneeR.rotation.x = lerp(1.5, .12, kneeExt);
  c.ankleL.rotation.x = 0; c.ankleR.rotation.x = lerp(0, -.35, kneeExt);
  c.hipL.rotation.z = .06; c.hipR.rotation.z = -.06;
  c.spine.rotation.x = -.1;
  c.shoulderL.rotation.x = c.shoulderR.rotation.x = -.35;
  c.elbowL.rotation.x = c.elbowR.rotation.x = -.6;
  c.shoulderL.rotation.z = .25; c.shoulderR.rotation.z = -.25;
}

/* =====================================================================
   Canvas textures (screens, claim form, dashboard)
   ===================================================================== */
const MONO = '"JetBrains Mono", ui-monospace, monospace', DISP = '"Bricolage Grotesque", system-ui, sans-serif', BODY = '"Source Sans 3", system-ui, sans-serif';
function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  let key = null;
  return { tex, reset() { key = null; }, set(k, ...a) { if (k === key) return; key = k; ctx.clearRect(0, 0, w, h); draw(ctx, w, h, ...a); tex.needsUpdate = true; } };
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function checkMark(ctx, x, y, s, col) { ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 4 * s; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(x - 7 * s, y); ctx.lineTo(x - 2 * s, y + 5 * s); ctx.lineTo(x + 8 * s, y - 6 * s); ctx.stroke(); ctx.restore(); }

const monitorTex = canvasTex(320, 200, (ctx, w, h, state, dots) => {
  ctx.fillStyle = '#0C2630'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#123744'; ctx.fillRect(0, 0, w, 34);
  ctx.fillStyle = '#8EDDE6'; ctx.font = `600 15px ${MONO}`; ctx.fillText('ELIGIBILITY · 270/271', 14, 23);
  if (state === 'ready') { ctx.fillStyle = '#9FB4BC'; ctx.font = `600 26px ${MONO}`; ctx.fillText('READY', 112, 122); }
  else if (state === 'verify') {
    ctx.fillStyle = '#FF8A5B'; ctx.font = `600 22px ${MONO}`; ctx.fillText('VERIFYING', 92, 110);
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i === dots ? '#FF8A5B' : 'rgba(255,138,91,.25)'; ctx.beginPath(); ctx.arc(140 + i * 20, 140, 6, 0, 7); ctx.fill(); }
  } else {
    ctx.fillStyle = '#4CC3D1'; ctx.beginPath(); ctx.arc(70, 108, 26, 0, 7); ctx.fill(); checkMark(ctx, 70, 108, 1.6, '#0C2630');
    ctx.font = `800 30px ${DISP}`; ctx.fillText('ELIGIBLE', 110, 104);
    ctx.fillStyle = '#9FB4BC'; ctx.font = `500 15px ${MONO}`; ctx.fillText('PLAN ACTIVE · COPAY $20', 110, 132);
  }
  ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(14, 170, w - 28, 12);
});

const docTex = canvasTex(300, 400, (ctx, w, h, fill, scrub, stamp) => {
  ctx.fillStyle = '#FFFFFF'; rr(ctx, 0, 0, w, h, 18); ctx.fill();
  ctx.fillStyle = '#0B7A87'; rr(ctx, 0, 0, w, 54, [18, 18, 0, 0]); ctx.fill();
  ctx.fillStyle = '#FFFFFF'; ctx.font = `700 18px ${MONO}`; ctx.fillText('CLAIM · CMS-1500', 18, 34);
  const rows = [['PATIENT', 'M. SINGH'], ['DOS', '11/27/2026'], ['ICD-10', 'M17.11'], ['CPT', '97110 ×3'], ['CPT', '97140'], ['PAYER', 'BLUE HEALTH'], ['TOTAL', '$420.00']];
  rows.forEach((r, i) => {
    const y = 92 + i * 40, k = clamp(fill * rows.length - i);
    ctx.fillStyle = '#E3F0F1'; rr(ctx, 18, y - 20, w - 36, 30, 6); ctx.fill();
    ctx.fillStyle = '#4B5F6B'; ctx.font = `600 13px ${MONO}`; ctx.fillText(r[0], 28, y);
    if (k > 0) {
      const s = r[1].slice(0, Math.ceil(r[1].length * k));
      ctx.fillStyle = '#0B1F2A'; ctx.font = `700 15px ${MONO}`; ctx.fillText(s, 120, y);
    }
    if (scrub > (i + .5) / rows.length) { ctx.fillStyle = '#0B7A87'; ctx.beginPath(); ctx.arc(w - 38, y - 5, 10, 0, 7); ctx.fill(); checkMark(ctx, w - 38, y - 5, .7, '#FFFFFF'); }
  });
  if (stamp > 0) {
    ctx.save(); ctx.translate(w / 2, 330); ctx.rotate(-.18); ctx.globalAlpha = stamp;
    ctx.strokeStyle = '#D9480F'; ctx.lineWidth = 5; rr(ctx, -110, -30, 220, 60, 10); ctx.stroke();
    ctx.fillStyle = '#D9480F'; ctx.font = `800 30px ${DISP}`; ctx.textAlign = 'center'; ctx.fillText('CLEAN CLAIM', 0, 11); ctx.restore();
  }
});

const signTex = canvasTex(400, 140, (ctx, w, h, approved) => {
  ctx.fillStyle = '#0B1F2A'; rr(ctx, 0, 0, w, h, 16); ctx.fill();
  ctx.fillStyle = '#FFFFFF'; ctx.font = `800 40px ${DISP}`; ctx.textAlign = 'center'; ctx.fillText('PAYER', w / 2, 62);
  ctx.fillStyle = '#9FB4BC'; ctx.font = `600 16px ${MONO}`; ctx.fillText(approved ? 'ERA 835 · PAID $420' : 'EDI 837 · ADJUDICATING', w / 2, 100);
  if (approved) { ctx.fillStyle = '#4CC3D1'; ctx.beginPath(); ctx.arc(46, 70, 24, 0, 7); ctx.fill(); checkMark(ctx, 46, 70, 1.5, '#0B1F2A'); }
});

const phoneTex = canvasTex(120, 220, (ctx, w, h, angle, on) => {
  ctx.fillStyle = '#061219'; ctx.fillRect(0, 0, w, h);
  if (!on) return;
  ctx.fillStyle = '#FF8A5B'; ctx.beginPath(); ctx.arc(16, 16, 5, 0, 7); ctx.fill();
  ctx.fillStyle = '#E6F0F2'; ctx.font = `600 11px ${MONO}`; ctx.fillText('REC', 26, 20);
  ctx.fillStyle = '#4CC3D1'; ctx.font = `800 34px ${DISP}`; ctx.textAlign = 'center'; ctx.fillText(angle + '°', w / 2, 120);
  ctx.fillStyle = '#9FB4BC'; ctx.font = `600 11px ${MONO}`; ctx.fillText('KNEE', w / 2, 140);
});

const dashTex = canvasTex(640, 380, (ctx, w, h, k, reps) => {
  ctx.fillStyle = '#0C2630'; rr(ctx, 0, 0, w, h, 20); ctx.fill();
  ctx.fillStyle = '#E6F0F2'; ctx.font = `800 28px ${DISP}`; ctx.fillText('Maya · knee extension', 28, 50);
  ctx.fillStyle = '#9FB4BC'; ctx.font = `600 15px ${MONO}`; ctx.fillText('REMOTE SESSION · LIVE', 28, 78);
  ctx.fillStyle = '#FF8A5B'; ctx.beginPath(); ctx.arc(w - 40, 44, 8, 0, 7); ctx.fill();
  const x0 = 60, x1 = w - 40, y0 = 320, y1 = 110, toY = (v) => y0 - (v - 110) / 75 * (y0 - y1);
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
  for (let v = 110; v <= 185; v += 15) { ctx.beginPath(); ctx.moveTo(x0, toY(v)); ctx.lineTo(x1, toY(v)); ctx.stroke(); ctx.fillStyle = '#5E7782'; ctx.font = `500 12px ${MONO}`; ctx.fillText(v + '°', 18, toY(v) + 4); }
  ctx.setLineDash([8, 8]); ctx.strokeStyle = '#FF8A5B'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, toY(170)); ctx.lineTo(x1, toY(170)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#FF8A5B'; ctx.font = `600 12px ${MONO}`; ctx.fillText('TARGET 170°', x1 - 92, toY(170) - 8);
  const data = [128, 134, 139, 143, 150, 152, 158, 161, 165, 168, 171];
  const n = Math.max(1, Math.round(data.length * k));
  const px = (i) => x0 + i / (data.length - 1) * (x1 - x0);
  const grd = ctx.createLinearGradient(0, y1, 0, y0); grd.addColorStop(0, 'rgba(76,195,209,.35)'); grd.addColorStop(1, 'rgba(76,195,209,0)');
  ctx.beginPath(); ctx.moveTo(px(0), y0); for (let i = 0; i < n; i++) ctx.lineTo(px(i), toY(data[i])); ctx.lineTo(px(n - 1), y0); ctx.fillStyle = grd; ctx.fill();
  ctx.beginPath(); for (let i = 0; i < n; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, px(i), toY(data[i])); ctx.strokeStyle = '#4CC3D1'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();
  for (let i = 0; i < n; i++) { ctx.fillStyle = i === n - 1 ? '#FF8A5B' : '#4CC3D1'; ctx.beginPath(); ctx.arc(px(i), toY(data[i]), i === n - 1 ? 7 : 4, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#E6F0F2'; ctx.font = `800 40px ${DISP}`; ctx.textAlign = 'right'; ctx.fillText(data[n - 1] + '°', w - 30, 360);
  ctx.textAlign = 'left'; ctx.fillStyle = '#9FB4BC'; ctx.font = `600 14px ${MONO}`; ctx.fillText('REPS ' + String(reps).padStart(2, '0') + ' · PEAK ANGLE', 28, 360);
});

/* =====================================================================
   World
   ===================================================================== */
const world = G(scene);
const ground = mesh(new THREE.PlaneGeometry(160, 60), toon(P.wall), world, 14, 0, 0, { outline: false, cast: false, receive: true });
ground.rotation.x = -Math.PI / 2;
function platform(x, z, r, rim) {
  mesh(cyl(r, r + .06, .14, 64), '#FFFFFF', world, x, .07, z, { receive: true, cast: false }).receiveShadow = true;
  mesh(new THREE.TorusGeometry(r + .03, .03, 8, 80).rotateX(Math.PI / 2), rim, world, x, .14, z, { outline: false, cast: false });
}
// dashed route connecting all stations
for (let x = -5; x < 31; x += .5) mesh(box(.24, .012, .06), P.tealLite, world, x, .006, 1.9, { outline: false, cast: false });

/* --- 01 front desk --- */
platform(.6, 0, 2.6, P.teal);
const desk = G(world, 1.15, 0, -.1);
mesh(box(.62, 1.02, 1.5), P.teal, desk, 0, .51, 0);
mesh(box(.78, .06, 1.66), '#FFFFFF', desk, 0, 1.05, 0);
mesh(box(.02, .4, 1.3), P.tealDeep, desk, -.32, .55, 0, { outline: false });
const monitor = G(desk, .06, 1.08, .22); monitor.rotation.y = -.95;
mesh(cyl(.025, .03, .2, 10), '#26343C', monitor, 0, .1, 0);
mesh(box(.42, .28, .03), '#26343C', monitor, 0, .32, 0);
const screen = mesh(new THREE.PlaneGeometry(.38, .24), new THREE.MeshBasicMaterial({ map: monitorTex.tex, toneMapped: false }), monitor, 0, .32, .017, { outline: false, cast: false });
mesh(cyl(.07, .09, .09, 14), P.white, desk, .1, 1.12, -.45);
for (let i = 0; i < 5; i++) mesh(cap(.008, .12).rotateZ((i - 2) * .2), P.signal, desk, .1 + (i - 2) * .012, 1.24, -.45, { outline: false });
const plantA = G(world, -1.2, .14, -1.2);
mesh(cyl(.17, .13, .32, 16), P.signal, plantA, 0, .16, 0);
for (let i = 0; i < 7; i++) { const l = mesh(sph(.12, 10, 8).scale(.5, 1.3, .25), i % 2 ? P.plant : P.plantDark, plantA, Math.cos(i) * .07, .5 + (i % 3) * .06, Math.sin(i) * .07); l.rotation.set(Math.sin(i) * .6, i, Math.cos(i) * .6); }
const waitSign = G(world, -.4, 0, -1.6);
mesh(cyl(.02, .02, 1.6, 8), '#26343C', waitSign, 0, .8, 0);
mesh(box(.7, .3, .03), P.teal, waitSign, 0, 1.55, 0);

/* --- 02 coding + scrubbing --- */
platform(6.2, 0, 2.2, P.signal);
const holo = G(world, 6.2, 0, -.2);
mesh(cyl(.42, .5, .16, 32), '#26343C', holo, 0, .22, 0);
const holoRing = mesh(new THREE.TorusGeometry(.4, .02, 8, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: P.tealLite, toneMapped: false }), holo, 0, .31, 0, { outline: false, cast: false });
const beam = mesh(cyl(.36, .42, 1.6, 32, 1, true), new THREE.MeshBasicMaterial({ color: P.tealLite, transparent: true, opacity: .1, side: THREE.DoubleSide, depthWrite: false }), holo, 0, 1.1, 0, { outline: false, cast: false });
// code chips that orbit the claim
const chipTex = (label, col) => canvasTex(220, 70, (ctx, w, h) => { ctx.fillStyle = col; rr(ctx, 0, 0, w, h, 35); ctx.fill(); ctx.fillStyle = '#FFFFFF'; ctx.font = `700 28px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText(label, w / 2, 46); });
const chips = [['ICD-10 M17.11', P.teal], ['CPT 97110', P.signal], ['CPT 97140', P.tealDeep], ['NPI ✓', P.teal]].map(([l, col], i) => {
  const ct = chipTex(l, col); ct.set(1);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct.tex, transparent: true, depthWrite: false }));
  sp.scale.set(.62, .2, 1); scene.add(sp); sp.userData.i = i; return sp;
});

// Scrub-bot: a little hovering claim-scrubber robot
const bot = G(world, 7.1, 1.7, .3);
const botBody = mesh(sph(.24, 28, 20).scale(1, .92, 1), '#FFFFFF', bot, 0, 0, 0);
mesh(new THREE.TorusGeometry(.245, .025, 8, 40).rotateX(Math.PI / 2), P.teal, bot, 0, -.02, 0, { outline: false });
const visor = mesh(sph(.18, 24, 16).scale(1, .6, .75), '#0B1F2A', bot, 0, .03, .1, { outline: false });
const botEyes = [-1, 1].map((s) => mesh(cap(.022, .03), new THREE.MeshBasicMaterial({ color: P.tealLite, toneMapped: false }), bot, s * .06, .04, .245, { outline: false, cast: false }));
const antenna = G(bot, 0, .22, 0);
mesh(cyl(.01, .01, .14, 6), '#26343C', antenna, 0, .07, 0, { outline: false });
const bulb = mesh(sph(.035, 10, 8), new THREE.MeshBasicMaterial({ color: P.signalLite, toneMapped: false }), antenna, 0, .16, 0, { outline: false });
const prop = G(bot, 0, -.26, 0);
mesh(cyl(.06, .08, .06, 16), '#26343C', bot, 0, -.22, 0);
for (let i = 0; i < 3; i++) { const bl = mesh(box(.3, .01, .05), P.tealDeep, prop, 0, 0, 0, { outline: false }); bl.rotation.y = i * Math.PI / 3 * 2; }
for (const s of [-1, 1]) { const arm = mesh(cap(.03, .12).rotateZ(s * 1.1), '#FFFFFF', bot, s * .27, -.05, 0); mesh(sph(.04, 10, 8), P.signal, arm, s * .06, -.04, 0); }
const laser = mesh(new THREE.PlaneGeometry(.9, .02), new THREE.MeshBasicMaterial({ color: P.signalLite, transparent: true, opacity: .9, toneMapped: false, side: THREE.DoubleSide }), scene, 0, 0, 0, { outline: false, cast: false });
const laserFan = mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: P.signalLite, transparent: true, opacity: .14, side: THREE.DoubleSide, depthWrite: false }), scene, 0, 0, 0, { outline: false, cast: false });
laserFan.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9 * 2), 3));

/* claim document: a card that later folds into a paper plane */
const doc = G(scene);
const docCard = mesh(new THREE.PlaneGeometry(.6, .8), new THREE.MeshBasicMaterial({ map: docTex.tex, side: THREE.DoubleSide, transparent: true, toneMapped: false }), doc, 0, 0, 0, { outline: false });
const planeGeo = new THREE.BufferGeometry();
planeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
  .5, 0, 0, -.35, .02, -.32, -.2, 0, 0,   .5, 0, 0, -.2, 0, 0, -.35, .02, .32,
  .5, 0, 0, -.2, 0, 0, -.35, -.14, 0,
]), 3));
planeGeo.computeVertexNormals();
const paperPlane = mesh(planeGeo, toon('#FFFFFF', { side: THREE.DoubleSide }), doc, 0, 0, 0, { outline: false });
const trailLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: P.signal, dashSize: .12, gapSize: .1, transparent: true }));
scene.add(trailLine);
const card = mesh(box(.16, .1, .008), P.white, scene, 0, 0, 0);
mesh(box(.07, .02, .002), P.teal, card, -.03, .02, .006, { outline: false, cast: false });
mesh(box(.04, .03, .002), P.gold, card, .045, -.01, .006, { outline: false, cast: false });

/* --- 03 payer + payment --- */
platform(12.4, -.2, 2.6, P.tealDeep);
const payer = G(world, 12.2, .14, -.8);
mesh(box(2.0, 2.5, 1.3), '#F4F8F8', payer, 0, 1.25, 0);
mesh(box(2.2, .14, 1.45), P.tealDeep, payer, 0, 2.55, 0);
for (let r = 0; r < 3; r++) for (let q = 0; q < 4; q++) mesh(box(.3, .34, .02), r === 1 && q === 2 ? P.signal : P.sky, payer, -.67 + q * .45, .62 + r * .6, .66, { outline: false, cast: false });
mesh(box(.5, .72, .04), P.tealDeep, payer, 0, .36, .66);
for (const s of [-1, 1]) mesh(cyl(.07, .07, 2.4, 14), '#FFFFFF', payer, s * 1.08, 1.2, .72);
const sign = mesh(new THREE.PlaneGeometry(1.5, .52), new THREE.MeshBasicMaterial({ map: signTex.tex, transparent: true, toneMapped: false }), payer, 0, 3.0, .2, { outline: false, cast: false });
mesh(box(.04, .45, .04), '#26343C', payer, -.5, 2.8, .2); mesh(box(.04, .45, .04), '#26343C', payer, .5, 2.8, .2);
// approval stamp that slams down
const stamp = G(scene);
mesh(cyl(.05, .05, .3, 12), P.woodDark, stamp, 0, .25, 0);
mesh(sph(.09, 12, 10), P.wood, stamp, 0, .45, 0);
mesh(cyl(.18, .18, .08, 24), P.signal, stamp, 0, .05, 0);
// coin jar
const jar = G(world, 13.8, .14, .6);
mesh(cyl(.32, .3, .62, 32, 1, true), new THREE.MeshToonMaterial({ color: '#BFE6EE', gradientMap: gradTex, transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false }), jar, 0, .31, 0, { cast: false });
mesh(new THREE.TorusGeometry(.32, .03, 8, 36).rotateX(Math.PI / 2), P.tealDeep, jar, 0, .62, 0, { outline: false });
mesh(cyl(.3, .3, .03, 32), '#BFE6EE', jar, 0, .015, 0, { outline: false });
const labelTex = canvasTex(200, 90, (ctx, w, h) => { ctx.fillStyle = '#FFF8EE'; rr(ctx, 0, 0, w, h, 12); ctx.fill(); ctx.fillStyle = '#0B1F2A'; ctx.font = `800 30px ${DISP}`; ctx.textAlign = 'center'; ctx.fillText('POSTED', w / 2, 58); });
labelTex.set(1);
mesh(new THREE.PlaneGeometry(.3, .14), new THREE.MeshBasicMaterial({ map: labelTex.tex, transparent: true }), jar, 0, .32, .325, { outline: false, cast: false });
const COINS = 16;
const coinGeo = cyl(.075, .075, .022, 20);
const coins = new THREE.InstancedMesh(coinGeo, toon(P.gold), COINS);
coins.castShadow = true; coins.frustumCulled = false; scene.add(coins);
const dummy = new THREE.Object3D();

/* --- 04 home: knee extensions on camera --- */
platform(20.4, -.2, 2.8, P.signal);
const room = G(world, 20.4, .14, -.2);
mesh(box(5.2, 2.7, .12), '#F3E9DC', room, 0, 1.35, -2.1, { receive: true });
const windowF = G(room, -1.3, 1.6, -2.03);
mesh(box(1.1, .9, .05), '#FFFFFF', windowF, 0, 0, 0);
mesh(box(.98, .78, .02), toon(P.sky, { emissive: '#3A6F7A', emissiveIntensity: .25 }), windowF, 0, 0, .03, { outline: false });
mesh(box(.03, .78, .03), '#FFFFFF', windowF, 0, 0, .04, { outline: false }); mesh(box(.98, .03, .03), '#FFFFFF', windowF, 0, 0, .04, { outline: false });
const picFrame = G(room, 1.1, 1.75, -2.03);
mesh(box(.6, .44, .04), P.woodDark, picFrame, 0, 0, 0);
mesh(box(.5, .34, .02), P.tealLite, picFrame, 0, 0, .025, { outline: false });
mesh(new THREE.CircleGeometry(2.2, 48).rotateX(-Math.PI / 2), '#E9C9A5', room, 0, .01, -.2, { outline: false, cast: false, receive: true });
// chair
const chair = G(room, -.55, 0, .05); chair.rotation.y = .55;
mesh(box(.56, .08, .5), P.wood, chair, 0, .45, 0);
mesh(box(.56, .6, .07), P.wood, chair, 0, .78, -.25);
for (const [x, z] of [[-.24, -.2], [.24, -.2], [-.24, .2], [.24, .2]]) mesh(cyl(.025, .025, .45, 8), P.woodDark, chair, x, .225, z);
// floor lamp
const lamp = G(room, -2.0, 0, -1.3);
mesh(cyl(.18, .2, .04, 20), '#26343C', lamp, 0, .02, 0);
mesh(cyl(.018, .018, 1.6, 8), '#26343C', lamp, 0, .8, 0);
mesh(cyl(.14, .26, .32, 24, 1, true), toon('#FFE3A8', { emissive: '#FFB84D', emissiveIntensity: .45, side: THREE.DoubleSide }), lamp, 0, 1.65, 0);
const plantB = G(room, 2.0, 0, -1.5);
mesh(cyl(.2, .15, .38, 16), '#FFFFFF', plantB, 0, .19, 0);
for (let i = 0; i < 9; i++) { const l = mesh(sph(.14, 10, 8).scale(.45, 1.4, .22), i % 2 ? P.plant : P.plantDark, plantB, Math.cos(i * 2) * .1, .6 + (i % 3) * .1, Math.sin(i * 2) * .1); l.rotation.set(Math.sin(i) * .7, i * 1.3, Math.cos(i) * .7); }
// side table + mug
const table = G(room, .55, 0, -.85);
mesh(cyl(.28, .28, .05, 24), P.wood, table, 0, .55, 0); mesh(cyl(.04, .06, .55, 10), P.woodDark, table, 0, .275, 0);
mesh(cyl(.06, .055, .12, 16), P.signal, table, .05, .64, 0);
// phone on tripod
const tripod = G(room, 1.15, 0, .55); tripod.rotation.y = -1.85;
for (let i = 0; i < 3; i++) { const leg = mesh(cyl(.012, .012, .95, 6), '#26343C', tripod, 0, .45, 0, { outline: false }); leg.rotation.set(Math.cos(i * 2.1) * .18, 0, Math.sin(i * 2.1) * .18); leg.position.set(Math.sin(i * 2.1) * .08, .45, Math.cos(i * 2.1) * .08); }
const phone = G(tripod, 0, 1.05, 0);
mesh(box(.12, .22, .016), '#0B1F2A', phone, 0, 0, 0);
mesh(new THREE.PlaneGeometry(.1, .19), new THREE.MeshBasicMaterial({ map: phoneTex.tex, toneMapped: false }), phone, 0, 0, -.0095, { outline: false, cast: false }).rotation.y = Math.PI;
const lens = mesh(sph(.012, 8, 6), '#26343C', phone, .03, .08, .01, { outline: false });
const cone = mesh(new THREE.ConeGeometry(.9, 1.6, 32, 1, true).rotateX(-Math.PI / 2).translate(0, 0, .8), new THREE.MeshBasicMaterial({ color: P.tealLite, transparent: true, opacity: .08, side: THREE.DoubleSide, depthWrite: false }), phone, 0, 0, 0, { outline: false, cast: false });
cone.scale.set(1, .8, 1);

// skeleton overlay (pose landmarks)
const lmMat = new THREE.MeshBasicMaterial({ color: P.signalLite, transparent: true, depthTest: false, toneMapped: false });
const boneMat = new THREE.LineBasicMaterial({ color: P.tealLite, transparent: true, depthTest: false, toneMapped: false });
const skel = G(scene); skel.renderOrder = 10;
const lmGeo = sph(.028, 10, 8);
const LM = 15, lmMeshes = [];
for (let i = 0; i < LM; i++) { const m = new THREE.Mesh(lmGeo, lmMat); m.renderOrder = 11; skel.add(m); lmMeshes.push(m); }
const boneGeo = new THREE.BufferGeometry(); boneGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 6), 3));
const bones = new THREE.LineSegments(boneGeo, boneMat); bones.renderOrder = 10; skel.add(bones);
const kneeArc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: P.signalLite, transparent: true, depthTest: false, toneMapped: false }));
kneeArc.renderOrder = 12; kneeArc.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(25 * 3), 3)); skel.add(kneeArc);

// neural network that lights up as the frames are processed
const nn = G(world, 23.0, 1.6, -1.4);
const layers = [4, 6, 6, 3], nodes = [];
layers.forEach((n, li) => {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(sph(.065, 14, 10), new THREE.MeshBasicMaterial({ color: P.tealDeep, toneMapped: false }));
    m.position.set(li * .5 - .75, (i - (n - 1) / 2) * .24, 0); nn.add(m); nodes.push({ m, li, i });
  }
});
const edgePos = [];
nodes.forEach((a) => nodes.forEach((b) => { if (b.li === a.li + 1) edgePos.push(a.m.position.x, a.m.position.y, 0, b.m.position.x, b.m.position.y, 0); }));
const edgeGeo = new THREE.BufferGeometry(); edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: P.tealLite, transparent: true, opacity: .18 })); nn.add(edges);
const pulses = [];
for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(sph(.025, 8, 6), new THREE.MeshBasicMaterial({ color: P.signalLite, toneMapped: false })); nn.add(m); pulses.push(m); }
const nnFrame = mesh(box(2.1, 1.75, .04), toon('#0C2630'), nn, 0, 0, -.08, { cast: false });

/* --- 05 clinic --- */
platform(28.2, -.2, 2.6, P.teal);
const clinic = G(world, 28.2, .14, -.2);
mesh(box(4.6, 2.8, .12), '#E3F0F1', clinic, 0, 1.4, -2.0, { receive: true });
const dash = G(clinic, .55, 1.62, -1.9);
mesh(box(2.1, 1.28, .08), '#26343C', dash, 0, 0, 0);
mesh(new THREE.PlaneGeometry(2.0, 1.19), new THREE.MeshBasicMaterial({ map: dashTex.tex, transparent: true, toneMapped: false }), dash, 0, 0, .045, { outline: false, cast: false });
const cdesk = G(clinic, 1.1, 0, -.4);
mesh(box(1.5, .06, .7), '#FFFFFF', cdesk, 0, .76, 0);
for (const [x, z] of [[-.68, -.3], [.68, -.3], [-.68, .3], [.68, .3]]) mesh(cyl(.025, .025, .76, 8), '#26343C', cdesk, x, .38, z);
const laptop = G(cdesk, -.25, .79, .05); laptop.rotation.y = -.5;
mesh(box(.4, .02, .28), '#C7D3D8', laptop, 0, 0, 0);
const lid = mesh(box(.4, .27, .015), '#C7D3D8', laptop, 0, .135, -.14); lid.rotation.x = -.2;
mesh(cyl(.06, .05, .13, 14), P.white, cdesk, .5, .86, -.1);
const plantC = G(clinic, -1.9, 0, -1.4);
mesh(cyl(.2, .16, .4, 16), P.teal, plantC, 0, .2, 0);
for (let i = 0; i < 8; i++) { const l = mesh(sph(.13, 10, 8).scale(.45, 1.4, .22), i % 2 ? P.plant : P.plantDark, plantC, Math.cos(i * 2) * .1, .62 + (i % 3) * .1, Math.sin(i * 2) * .1); l.rotation.set(Math.sin(i) * .7, i * 1.3, Math.cos(i) * .7); }
const tablet = mesh(box(.2, .28, .015), '#26343C', null, 0, 0, 0);
mesh(new THREE.PlaneGeometry(.18, .25), new THREE.MeshBasicMaterial({ color: P.tealLite, toneMapped: false }), tablet, 0, 0, .009, { outline: false, cast: false });

// packets streaming from the phone to the dashboard
const packets = [];
for (let i = 0; i < 10; i++) {
  const m = mesh(box(.09, .09, .09), new THREE.MeshBasicMaterial({ color: i % 3 ? P.tealLite : P.signalLite, toneMapped: false }), scene, 0, 0, 0, { outline: true, cast: false });
  packets.push(m);
}

/* ---------- the cast ---------- */
const maya = Character({ seed: 1, skin: '#C98E6B', nose: '#B87C5B', hair: '#2A1A14', hairStyle: 'bun', accent: P.signal, eye: '#4A2E1F', shirt: P.teal, collar: P.tealDeep, hoodie: true, pants: P.denim, cuffs: '#33507A', shoes: '#FFFFFF', sole: P.signal, laces: P.signal, watch: P.signal, sleeves: 'long', cuff: P.tealDeep });
const raj = Character({ seed: 2, skin: '#A8714F', nose: '#966242', hair: '#1B1714', hairStyle: 'swoop', beard: '#1B1714', eye: '#2E1D14', shirt: '#FFFFFF', collar: '#E6EEF0', buttons: P.tealDeep, pants: '#2F3E4A', shoes: '#3A2A20', sole: '#1A1410', headset: true, badge: P.signal, glasses: '#26343C', sleeves: 'long', cuff: '#E6EEF0' });
const drLee = Character({ seed: 3, skin: '#E8B996', nose: '#D9A47F', hair: '#3B2C24', hairStyle: 'long', eye: '#3A5A40', shirt: '#6C8EA0', collar: '#FFFFFF', coat: '#FFFFFF', stethoscope: true, pants: '#2F3E4A', shoes: '#26343C', sole: '#111', glasses: P.signal, sleeves: 'long', cuff: '#FFFFFF' });
for (const c of [maya, raj, drLee]) c.root.traverse((o) => { if (o.isMesh && o.material !== outlineMat) o.castShadow = true; });
scene.add(maya.root, raj.root, drLee.root);
raj.root.position.set(1.75, .14, -.15);
drLee.root.position.set(27.55, .14, .15);

/* ---------- lights ---------- */
const hemi = new THREE.HemisphereLight('#FFFFFF', '#9FC6CC', 1.6); scene.add(hemi);
const sun = new THREE.DirectionalLight('#FFF3E0', 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -5, near: .5, far: 40 });
sun.shadow.bias = -.0004; sun.shadow.normalBias = .02;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight('#8EDDE6', .9); scene.add(rim, rim.target);

/* ---------- theme ---------- */
function applyTheme() {
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue('--bg').trim() || '#F4F8F8';
  const dark = new THREE.Color(bg).getHSL({ h: 0, s: 0, l: 0 }).l < .3;
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, 14, 34);
  ground.material = toon(dark ? '#0F2B35' : '#E7EFEF');
  hemi.intensity = dark ? 1.25 : 1.6;
  hemi.groundColor.set(dark ? '#0F2B35' : '#9FC6CC');
}
applyTheme();
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

/* =====================================================================
   Camera path
   ===================================================================== */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const KEYS = [
  [0.00, V(-4.2, 2.6, 8.2), V(-1.2, 1.0, 0)],
  [0.07, V(-2.0, 1.8, 5.2), V(-.6, 1.1, 0)],
  [0.14, V(.2, 1.55, 3.6), V(.6, 1.3, 0)],
  [0.22, V(.9, 1.45, 3.0), V(.85, 1.35, 0)],
  [0.30, V(4.8, 2.1, 5.2), V(6.2, 1.5, 0)],
  [0.38, V(6.3, 1.75, 3.7), V(6.4, 1.55, 0)],
  [0.45, V(8.0, 2.6, 6.2), V(9.6, 2.0, 0)],
  [0.52, V(10.4, 2.8, 8.0), V(12.3, 2.0, -.5)],
  [0.58, V(13.0, 2.0, 4.6), V(13.4, .9, .2)],
  [0.65, V(19.2, 1.9, 5.0), V(20.3, 1.0, 0)],
  [0.73, V(20.2, 1.25, 2.9), V(20.1, .85, 0)],
  [0.81, V(21.6, 1.9, 4.6), V(21.6, 1.25, -.6)],
  [0.89, V(27.0, 1.8, 4.4), V(28.4, 1.45, -.6)],
  [0.95, V(27.6, 1.65, 3.4), V(28.4, 1.5, -1)],
  [1.00, V(14.0, 9.0, 21.0), V(13.2, .6, 0)],
];
const camPos = V(0, 0, 0), camLook = V(0, 0, 0);
function cameraAt(p) {
  let i = 0; while (i < KEYS.length - 2 && p > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1], u = ease(prog(p, a[0], b[0]));
  camPos.lerpVectors(a[1], b[1], u); camLook.lerpVectors(a[2], b[2], u);
  const asp = camera.aspect;
  if (asp < 1.2) { const k = 1 + (1.2 - asp) * 1.1; camPos.sub(camLook).multiplyScalar(k).add(camLook); }
}

/* =====================================================================
   HTML overlays: captions, name tags, knee readout
   ===================================================================== */
const caps = Array.from(section.querySelectorAll('.story-cap'));
const dots = Array.from(section.querySelectorAll('.story-dots i'));
const bar = section.querySelector('.story-bar i');
const tags = {
  maya: section.querySelector('[data-tag="maya"]'), raj: section.querySelector('[data-tag="raj"]'),
  bot: section.querySelector('[data-tag="bot"]'), lee: section.querySelector('[data-tag="lee"]'),
  knee: section.querySelector('[data-tag="knee"]'),
};
const tmpV = V(0, 0, 0);
function placeTag(el, worldPos, show) {
  if (!el) return;
  tmpV.copy(worldPos).project(camera);
  const vis = show > .01 && tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1;
  el.style.opacity = vis ? show : 0;
  if (vis) el.style.transform = `translate(${(tmpV.x * .5 + .5) * W}px, ${(-tmpV.y * .5 + .5) * H}px) translate(-50%, -100%)`;
}

/* =====================================================================
   Story state as a function of p
   ===================================================================== */
const wp = (o, v = V(0, 0, 0)) => o.getWorldPosition(v);
const handPos = V(0, 0, 0), a0 = V(0, 0, 0), a1 = V(0, 0, 0), a2 = V(0, 0, 0);
let lastReps = -1;

function update(p, t) {
  /* ----- 01 Maya walks in, everyone says hi, card is verified ----- */
  resetPose(maya); resetPose(raj); resetPose(drLee);
  const atHome = p >= .6;
  if (!atHome) {
    const wk = prog(p, .015, .12);
    const x = lerp(-4.4, .05, ease(wk));
    maya.root.position.set(x, .14, .1);
    const walking = wk > 0 && wk < 1;
    const turn = sm(prog(p, .115, .14));
    maya.root.rotation.y = lerp(Math.PI / 2, .75, turn);
    if (walking || wk === 0) walk(maya, x * 5.2, wk === 0 ? .25 : Math.min(1, Math.sin(wk * Math.PI) * 2.2));
    idle(maya, t, walking ? .3 : 1);
    // wave back, then hand over the card
    wave(maya, t, win(p, .145, .185));
    const give = win(p, .19, .245);
    maya.shoulderR.rotation.x = lerp(maya.shoulderR.rotation.x, -1.15, give);
    maya.elbowR.rotation.x = lerp(maya.elbowR.rotation.x, -.35, give);
    maya.head.rotation.y = lerp(maya.head.rotation.y, .35, win(p, .2, .3));
    face(maya, t, p > .25 && p < .32 ? 'joy' : p > .14 ? 'happy' : 'neutral');
  }
  // Raj
  raj.root.rotation.y = -1.0;
  idle(raj, t);
  wave(raj, t, win(p, .1, .155));
  const typing = win(p, .22, .26);
  raj.shoulderL.rotation.x -= .7 * typing; raj.elbowL.rotation.x -= .8 * typing; raj.shoulderR.rotation.x -= .7 * typing; raj.elbowR.rotation.x -= .8 * typing;
  raj.wristL.rotation.x = Math.sin(t * 22) * .25 * typing; raj.wristR.rotation.x = Math.cos(t * 19) * .25 * typing;
  raj.head.rotation.y += lerp(.0, .55, win(p, .2, .27));
  face(raj, t, p > .25 && p < .4 ? 'joy' : p > .09 ? 'happy' : 'neutral');

  // eligibility screen
  if (p < .225) monitorTex.set('ready', 'ready');
  else if (p < .255) { const d = Math.floor(t * 5) % 3; monitorTex.set('v' + d, 'verify', d); }
  else monitorTex.set('ok', 'ok');

  // insurance card
  const cardK = prog(p, .205, .235);
  card.visible = !atHome && p > .17 && cardK < 1;
  if (card.visible) {
    wp(maya.wristR, handPos);
    const target = wp(screen, a0);
    const k = ease(cardK);
    card.position.lerpVectors(handPos, target, k); card.position.y += Math.sin(k * Math.PI) * .25;
    card.rotation.set(-.3, maya.root.rotation.y + k * 2, 0);
    card.scale.setScalar(1 - k * .5);
  }

  /* ----- 02 claim document: rises, gets coded, gets scrubbed ----- */
  const docOn = p > .25 && p < .58;
  doc.visible = docOn;
  const fold = prog(p, .44, .47);
  if (docOn) {
    const start = wp(screen, a0), mid = V(6.2, 1.45, -.2);
    const rise = ease(prog(p, .25, .31));
    if (p < .44) {
      doc.position.lerpVectors(start, mid, rise);
      doc.position.y += Math.sin(rise * Math.PI) * .9 + Math.sin(t * 1.6) * .02 * rise;
      doc.rotation.set(0, lerp(-1, 0, rise) + Math.sin(t * .8) * .05, Math.sin(rise * Math.PI) * .3);
      doc.scale.setScalar(lerp(.4, 1, rise));
    } else {
      // folds into a plane and flies to the payer roof
      const fly = ease(prog(p, .465, .52));
      const from = mid, to = V(12.2, 3.2, -.3);
      doc.position.lerpVectors(from, to, fly); doc.position.y += Math.sin(fly * Math.PI) * .7;
      const dy = Math.cos(fly * Math.PI) * .7 * Math.PI * .4;
      doc.rotation.set(0, 0, Math.atan2(dy + (to.y - from.y) * .4, 1) * .6);
      doc.scale.setScalar(lerp(1, .9, fly) * (fly >= 1 ? 1 - prog(p, .52, .54) : 1));
    }
    docCard.visible = fold < .5; paperPlane.visible = fold >= .5;
    docCard.scale.set(lerp(1, .1, sm(fold * 2)), lerp(1, .6, sm(fold * 2)), 1);
    paperPlane.scale.setScalar(sm((fold - .5) * 2) * 1.4);
    const fillK = prog(p, .315, .375), scrubK = prog(p, .375, .43), stampK = prog(p, .43, .445);
    docTex.set([Math.round(fillK * 40), Math.round(scrubK * 14), Math.round(stampK * 6)].join(), fillK, scrubK, stampK);
  }
  // trail behind the plane
  const trailOn = p > .47 && p < .56;
  trailLine.visible = trailOn;
  if (trailOn) {
    const pts = [];
    const f = ease(prog(p, .465, .52));
    for (let i = 0; i <= 30; i++) { const u = i / 30 * f; const pt = V(lerp(6.2, 12.2, u), lerp(1.45, 3.2, u) + Math.sin(u * Math.PI) * .7, lerp(-.2, -.3, u)); pts.push(pt); }
    trailLine.geometry.setFromPoints(pts); trailLine.computeLineDistances();
    trailLine.material.opacity = 1 - prog(p, .53, .56);
  }
  // orbiting code chips
  const chipK = win(p, .32, .43);
  chips.forEach((sp) => {
    const i = sp.userData.i, a = t * .9 + i * Math.PI / 2;
    sp.visible = chipK > 0;
    const appear = backOut(prog(p, .32 + i * .012, .345 + i * .012));
    sp.position.set(6.2 + Math.cos(a) * .85, 1.05 + i * .2 + Math.sin(t * 2 + i) * .03, -.45 + Math.sin(a) * .45);
    sp.material.opacity = chipK; sp.scale.set(.42 * appear, .135 * appear, 1);
  });
  holoRing.scale.setScalar(1 + Math.sin(t * 3) * .03);
  beam.material.opacity = .05 + .08 * win(p, .27, .46);

  // Scrub-bot
  const botActive = win(p, .33, .46);
  bot.position.set(lerp(7.5, 6.95, botActive) + Math.sin(t * .9) * .05, 1.8 + Math.sin(t * 2.2) * .06, lerp(.2, -.05, botActive));
  bot.rotation.y = lerp(-.3, -.55, botActive) + Math.sin(t * .7) * .1;
  bot.rotation.z = Math.sin(t * 1.3) * .06;
  prop.rotation.y = t * 18;
  bulb.scale.setScalar(1 + Math.sin(t * 6) * .15);
  const scanning = win(p, .375, .43);
  botEyes.forEach((e) => { e.scale.set(1, p > .43 && p < .5 ? .35 : 1, 1); e.rotation.z = p > .43 && p < .5 ? Math.PI / 2 : 0; });
  laser.visible = laserFan.visible = scanning > .01 && docOn;
  if (laser.visible) {
    const sy = 1.45 + Math.sin(t * 5) * .36;
    laser.position.set(6.2, sy, -.18); laser.scale.x = .95;
    laser.material.opacity = .9 * scanning;
    const eye = wp(visor, a1);
    const arr = laserFan.geometry.attributes.position.array;
    arr.set([eye.x, eye.y, eye.z, 5.75, sy, -.18, 6.65, sy, -.18, eye.x, eye.y, eye.z, 6.65, sy, -.18, 5.75, sy, -.18]);
    laserFan.geometry.attributes.position.needsUpdate = true; laserFan.geometry.computeBoundingSphere();
    laserFan.material.opacity = .16 * scanning;
  }

  /* ----- 03 payer stamps, coins pour into the jar ----- */
  signTex.set(p > .535 ? 'ok' : 'wait', p > .535);
  const slam = prog(p, .515, .535), lift = prog(p, .54, .56);
  stamp.visible = p > .5 && p < .6;
  stamp.position.set(12.2, 3.9 - .55 * (slam < 1 ? Math.pow(slam, 3) : 1) + .55 * ease(lift), -.3);
  stamp.scale.setScalar(backOut(prog(p, .5, .515)) * (1 - prog(p, .575, .6)) + .0001);
  for (let i = 0; i < COINS; i++) {
    const k = prog(p, .54 + i * .0035, .565 + i * .0035);
    const lvl = Math.floor(i / 4), slot = i % 4;
    const rest = V(13.8 + (slot - 1.5) * .11, .19 + lvl * .03, .6 + ((slot % 2) - .5) * .12);
    const from = V(12.9 + Math.sin(i * 7) * .2, 2.6 + (i % 3) * .1, .3);
    const fall = k * k;
    dummy.position.set(lerp(from.x, rest.x, k), lerp(from.y, rest.y, fall) + Math.sin(k * Math.PI) * .35, lerp(from.z, rest.z, k));
    dummy.rotation.set(k < 1 ? t * 6 + i : 0, i, k < 1 ? t * 4 : 0);
    dummy.scale.setScalar(k > 0 ? 1 : .0001);
    dummy.updateMatrix(); coins.setMatrixAt(i, dummy.matrix);
  }
  coins.instanceMatrix.needsUpdate = true;

  /* ----- 04 home: seated knee extensions, tracked by the phone ----- */
  let kneeExt = 0;
  if (atHome) {
    maya.root.position.set(20.4 - .55, .14, -.2 + .05);
    maya.root.rotation.y = .55 + 1.57 * 0 + 0;
    maya.root.position.x += 0; maya.root.position.z += .02;
    const reps = (t * .55) % 1;
    kneeExt = sm(prog(reps, .05, .45)) * (1 - sm(prog(reps, .6, .95)));
    const exertion = win(p, .62, 1);
    sit(maya, kneeExt * exertion);
    idle(maya, t, .6);
    maya.root.rotation.y = .55 + .2;
    maya.head.rotation.y = .25; maya.head.rotation.x = .05;
    face(maya, t, kneeExt > .7 ? 'focus' : 'happy');
    // after the session she waves at the camera
    wave(maya, t, win(p, .93, 1.05));
  }
  const tracking = win(p, .665, .86);
  phoneTex.set(atHome ? 'on' + Math.round(lerp(90, 168, kneeExt)) : 'off', Math.round(lerp(90, 168, kneeExt)), atHome && p > .64);
  cone.material.opacity = .1 * win(p, .64, .9) * (.75 + .25 * Math.sin(t * 8));
  skel.visible = tracking > .01;
  if (skel.visible) {
    lmMat.opacity = tracking; boneMat.opacity = tracking * .9; kneeArc.material.opacity = tracking;
    const J = [maya.face, maya.shoulderL, maya.shoulderR, maya.elbowL, maya.elbowR, maya.wristL, maya.wristR, maya.hipL, maya.hipR, maya.kneeL, maya.kneeR, maya.ankleL, maya.ankleR, maya.spine, maya.neck];
    const pos = J.map((j, i) => { const v = wp(j, V(0, 0, 0)); if (i === 5 || i === 6) v.y -= .05; return v; });
    pos[0].y += .02; pos[0].add(V(0, 0, 0));
    pos.forEach((v, i) => { lmMeshes[i].position.copy(v); lmMeshes[i].scale.setScalar(i === 10 ? 1.5 + Math.sin(t * 6) * .2 : 1); });
    const pairs = [[0, 14], [14, 1], [14, 2], [1, 3], [3, 5], [2, 4], [4, 6], [1, 7], [2, 8], [7, 8], [7, 9], [9, 11], [8, 10], [10, 12], [1, 2], [14, 13]];
    const arr = boneGeo.attributes.position.array;
    pairs.forEach(([a, b], k) => { arr.set([pos[a].x, pos[a].y, pos[a].z, pos[b].x, pos[b].y, pos[b].z], k * 6); });
    boneGeo.attributes.position.needsUpdate = true; boneGeo.computeBoundingSphere();
    // knee angle arc between thigh and shin
    const hip = pos[8], knee = pos[10], ank = pos[12];
    const u1 = a1.subVectors(hip, knee).normalize(), u2 = a2.subVectors(ank, knee).normalize();
    const ang = Math.acos(clamp(u1.dot(u2), -1, 1));
    const aa = kneeArc.geometry.attributes.position.array;
    for (let i = 0; i < 25; i++) { const v = a0.copy(u1).lerp(u2, i / 24).normalize().multiplyScalar(.14).add(knee); aa.set([v.x, v.y, v.z], i * 3); }
    kneeArc.geometry.attributes.position.needsUpdate = true; kneeArc.geometry.computeBoundingSphere();
    if (tags.knee) tags.knee.querySelector('b').textContent = Math.round(ang * 180 / Math.PI) + '°';
    placeTag(tags.knee, knee.clone().add(V(0, .32, 0)), tracking);
  } else placeTag(tags.knee, a0, 0);

  // neural net lights up
  const nnK = win(p, .7, .9);
  nn.visible = p > .62 && p < .99;
  nn.scale.setScalar(backOut(prog(p, .68, .72)) * .72 + .0001);
  nn.lookAt(camera.position.x, nn.position.y, camera.position.z);
  nodes.forEach(({ m, li, i }) => {
    const wv = .5 + .5 * Math.sin(t * 4 - li * 1.2 + i * .3);
    m.material.color.set(P.tealDeep).lerp(new THREE.Color(li === layers.length - 1 && i === 1 ? P.signalLite : P.tealLite), wv * nnK);
    m.scale.setScalar(1 + wv * .25 * nnK);
  });
  pulses.forEach((m, k) => {
    const li = k % (layers.length - 1), ph = (t * .9 + k * .37) % 1;
    const n0 = nodes.filter((n) => n.li === li), n1 = nodes.filter((n) => n.li === li + 1);
    const a = n0[(k * 3) % n0.length].m.position, b = n1[(k * 5) % n1.length].m.position;
    m.position.lerpVectors(a, b, ph); m.visible = nnK > .05;
  });
  edges.material.opacity = .12 + .22 * nnK;

  /* ----- 05 packets stream to the clinician's dashboard ----- */
  const stream = win(p, .78, .97);
  const from = wp(phone, a0), to = V(28.75, 1.75, -2.0);
  packets.forEach((m, i) => {
    const ph = ((t * .35 + i / packets.length) % 1);
    m.visible = stream > .02;
    m.position.lerpVectors(from, to, ph); m.position.y += Math.sin(ph * Math.PI) * 2.0;
    m.rotation.set(t * 2 + i, t * 3 + i, 0);
    m.scale.setScalar(stream * Math.sin(ph * Math.PI) * 1.1 + .0001);
  });
  const chartK = prog(p, .84, .93);
  const reps = Math.round(chartK * 10) + 1;
  if (reps !== lastReps) lastReps = reps;
  dashTex.set('c' + Math.round(chartK * 50), chartK, reps);

  // Dr Lee: reads the dashboard, then turns to camera and gives a thumbs-up
  const turnK = sm(prog(p, .9, .94));
  drLee.root.rotation.y = lerp(1.25, .3, turnK);
  idle(drLee, t);
  drLee.head.rotation.y += lerp(.4, 0, turnK) + .25 * win(p, .84, .9) * Math.sin(t * 1.2);
  drLee.head.rotation.x = lerp(.05, -.05, turnK) + Math.sin(t * 5) * .04 * win(p, .86, .9);
  // tablet in the left hand
  drLee.shoulderL.rotation.x = -.75; drLee.elbowL.rotation.x = -1.0; drLee.shoulderL.rotation.z = .15;
  if (!tablet.parent) drLee.wristL.add(tablet);
  tablet.position.set(.02, -.1, .07); tablet.rotation.set(-1.0, 0, 0);
  const thumbs = win(p, .94, 1.05);
  drLee.shoulderR.rotation.x = lerp(0, -1.0, thumbs); drLee.elbowR.rotation.x = lerp(-.12, -1.3, thumbs);
  drLee.shoulderR.rotation.z = lerp(-.08, -.35, thumbs);
  face(drLee, t, p > .92 ? 'joy' : p > .86 ? 'happy' : 'focus');

  /* ----- name tags ----- */
  placeTag(tags.maya, wp(maya.tagAnchor, a0), win(p, .05, .3) + win(p, .62, .7));
  placeTag(tags.raj, wp(raj.tagAnchor, a0), win(p, .08, .3));
  placeTag(tags.bot, a1.copy(bot.position).add(V(0, .42, 0)), win(p, .335, .45));
  placeTag(tags.lee, wp(drLee.tagAnchor, a0), win(p, .86, .97));

  /* ----- captions + progress ----- */
  let active = 0;
  caps.forEach((c, i) => { const a = +c.dataset.from, b = +c.dataset.to; const on = p >= a && p < b || (i === caps.length - 1 && p >= a); if (on) active = i; c.classList.toggle('on', on); });
  dots.forEach((d, i) => d.classList.toggle('on', i <= active));
  if (bar) bar.style.transform = `scaleX(${p})`;
}

/* =====================================================================
   Loop + scroll
   ===================================================================== */
let W = 1, H = 1, target = 0, cur = 0, running = false, clock = new THREE.Clock(), tIdle = 0;
function resize() {
  W = canvas.clientWidth; H = canvas.clientHeight;
  renderer.setSize(W, H, false); camera.aspect = W / H;
  camera.fov = camera.aspect < 1 ? 52 : 38; camera.updateProjectionMatrix();
}
resize();
new ResizeObserver(() => { resize(); if (!running) frame(true); }).observe(canvas);

function frame(force) {
  const dt = Math.min(.05, clock.getDelta());
  if (!reduce) tIdle += dt;
  cur += (target - cur) * (force === true ? 1 : Math.min(1, dt * 6));
  if (Math.abs(target - cur) < 1e-4) cur = target;
  cameraAt(cur);
  camera.position.copy(camPos); camera.lookAt(camLook);
  sun.position.set(camLook.x + 4, 9, 6); sun.target.position.set(camLook.x, 0, 0);
  rim.position.set(camLook.x - 5, 4, -6); rim.target.position.copy(camLook);
  update(cur, reduce ? 1.2 : tIdle);
  renderer.render(scene, camera);
}
function loop() { if (!running) return; frame(); requestAnimationFrame(loop); }
function start() { if (running) return; running = true; clock.getDelta(); requestAnimationFrame(loop); }
function stop() { running = false; }

gsap.registerPlugin(ScrollTrigger);
const st = ScrollTrigger.create({
  trigger: section,
  start: 'top top',
  end: () => '+=' + Math.round(window.innerHeight * (mobile ? 6 : 7)),
  pin: true,
  scrub: true,
  anticipatePin: 1,
  invalidateOnRefresh: true,
  onUpdate: (self) => { target = self.progress; if (!running) frame(true); },
});
new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? start() : stop())), { rootMargin: '200px' }).observe(section);
ScrollTrigger.sort();
ScrollTrigger.refresh();
target = cur = st.progress;
frame(true);
section.classList.add('ready');

if (document.fonts) document.fonts.ready.then(() => { [monitorTex, docTex, signTex, phoneTex, dashTex].forEach((t) => t.reset && t.reset()); frame(true); });
