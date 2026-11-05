// 3D 홀덤 테이블: 에셋 파일 없이 전부 코드로 만든 테이블·의자·카드·칩·아바타
import * as THREE from './vendor/three.module.js';
import { TableEffects } from './table-effects.js';
const { Vector3, Group, Mesh } = THREE;

const TAU = Math.PI * 2;
const TABLE_Y = 1.4;
const CW = 0.62, CH = 0.88, CT = 0.012; // 카드 크기
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeLin = (t) => t;
const rad = (d) => (d * Math.PI) / 180;
const ANG10 = [0, 30, 60, 90, 120, 150, -120, -90, -60, -30].map(rad);
const DEALER_PHI = rad(195);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString('ko-KR');
function hash(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// ───────── 재질/텍스처 캐시 ─────────
const matCache = new Map();
function mat(color, rough = 0.7, metal = 0) {
  const k = color + '|' + rough + '|' + metal;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return matCache.get(k);
}
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
const SUITSYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
const faceCache = new Map();
function cardFaceMat(code) {
  if (faceCache.has(code)) return faceCache.get(code);
  const rank = code[0] === 'T' ? '10' : code[0], suit = code[1], red = suit === 'h' || suit === 'd';
  const tex = canvasTex(256, 362, (g, w, h) => {
    g.fillStyle = '#f6f1e6'; roundRect(g, 0, 0, w, h, 22); g.fill();
    g.strokeStyle = '#c9c9c4'; g.lineWidth = 4; roundRect(g, 3, 3, w - 6, h - 6, 20); g.stroke();
    g.fillStyle = red ? '#ad494c' : '#15171a';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const corner = () => { g.font = `bold ${rank.length > 1 ? 54 : 66}px "Helvetica Neue", Arial, sans-serif`; g.fillText(rank, 40, 56); g.font = '50px "Apple Symbols", Arial, sans-serif'; g.fillText(SUITSYM[suit], 40, 112); };
    corner();
    g.save(); g.translate(w, h); g.rotate(Math.PI); corner(); g.restore();
    if ('JQKA'.includes(rank)) { g.font = 'bold 150px Georgia, serif'; g.fillText(rank, w / 2, h / 2 - 12); g.font = '72px "Apple Symbols", Arial, sans-serif'; g.fillText(SUITSYM[suit], w / 2, h / 2 + 86); }
    else { g.font = '140px "Apple Symbols", Arial, sans-serif'; g.fillText(SUITSYM[suit], w / 2, h / 2 + 6); }
  });
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
  faceCache.set(code, m);
  return m;
}
let _back;
function cardBackMat() {
  if (_back) return _back;
  const tex = canvasTex(256, 362, (g, w, h) => {
    g.fillStyle = '#f6f1e6'; roundRect(g, 0, 0, w, h, 22); g.fill();
    g.fillStyle = '#164d4a'; roundRect(g, 14, 14, w - 28, h - 28, 14); g.fill();
    g.strokeStyle = '#d5b878'; g.lineWidth = 3; roundRect(g, 24, 24, w - 48, h - 48, 10); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 3;
    for (let i = -h; i < w + h; i += 22) { g.beginPath(); g.moveTo(i, 24); g.lineTo(i + h, h - 24); g.stroke(); g.beginPath(); g.moveTo(i + h, 24); g.lineTo(i, h - 24); g.stroke(); }
    g.fillStyle = '#d5b878'; g.beginPath(); g.arc(w / 2, h / 2, 34, 0, TAU); g.fill();
    g.fillStyle = '#164d4a'; g.font = 'bold 44px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♠', w / 2, h / 2 + 2);
  });
  _back = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
  return _back;
}
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf3f3ee, roughness: 0.8 });
const cardGeo = new THREE.BoxGeometry(CW, CT, CH);

function makeCard(code) {
  const known = code && code !== '??';
  const m = new Mesh(cardGeo, [edgeMat, edgeMat, known ? cardFaceMat(code) : cardBackMat(), cardBackMat(), edgeMat, edgeMat]);
  m.rotation.order = 'YXZ';
  m.rotation.z = Math.PI; // 기본은 뒷면이 위
  m.userData.code = known ? code : '??';
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function setFront(card, code) {
  card.material[2] = code && code !== '??' ? cardFaceMat(code) : cardBackMat();
  card.userData.code = code && code !== '??' ? code : '??';
}

// ───────── 칩 ─────────
const DENOMS = [[25000, 0x2b2b3a], [5000, 0xe0679f], [1000, 0xf2c230], [500, 0x7b3fc4], [100, 0x202020], [50, 0xef8a24], [25, 0x2f9e55], [10, 0x2d6fd6], [5, 0xd23b3b], [1, 0xf4f4f4]];
const chipGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.07, 28);
const chipMatCache = new Map();
function chipMats(v, color) {
  if (chipMatCache.has(v)) return chipMatCache.get(v);
  const css = '#' + color.toString(16).padStart(6, '0');
  const side = canvasTex(256, 16, (g, w, h) => { g.fillStyle = css; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; for (let i = 0; i < 12; i++) g.fillRect(i * (w / 12) + 4, 0, w / 24, h); });
  const top = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = css; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 6; g.setLineDash([10, 9]); g.beginPath(); g.arc(64, 64, 54, 0, TAU); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.arc(64, 64, 34, 0, TAU); g.fill();
    g.fillStyle = v === 1 ? '#555' : css; g.font = `bold ${v >= 1000 ? 26 : 32}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(v >= 1000 ? v / 1000 + 'K' : String(v), 64, 66);
  });
  const arr = [new THREE.MeshStandardMaterial({ map: side, roughness: 0.45 }), new THREE.MeshStandardMaterial({ map: top, roughness: 0.45 }), new THREE.MeshStandardMaterial({ map: top, roughness: 0.45 })];
  chipMatCache.set(v, arr);
  return arr;
}
let chipShadows = true;
function buildPile(amount) {
  const g = new Group();
  g.userData.amount = amount;
  if (amount <= 0) return g;
  const parts = [];
  let r = amount;
  for (const [v, c] of DENOMS) { const n = Math.floor(r / v); if (n > 0) { parts.push([v, c, Math.min(n, 10)]); r -= n * v; } }
  const perRow = Math.min(parts.length, 4);
  parts.forEach(([v, c, n], si) => {
    const col = si % 4, row = Math.floor(si / 4);
    const x = (col - (perRow - 1) / 2) * 0.48, z = row * 0.48;
    for (let k = 0; k < n; k++) {
      const m = new Mesh(chipGeo, chipMats(v, c));
      const j = hash(v + ':' + k + ':' + si);
      m.position.set(x + ((j % 7) - 3) * 0.004, k * 0.072 + 0.035, z + (((j >> 3) % 7) - 3) * 0.004);
      m.rotation.y = (j % 100) / 16;
      m.castShadow = chipShadows;
      g.add(m);
    }
  });
  return g;
}

// ───────── 아바타 ─────────
const SKINS = [0xf1c9a5, 0xe0ac82, 0xc68642, 0x8d5524, 0xffdbb4, 0xd9a07a];
const SHIRTS = [0x527b91, 0xb4655c, 0x507b65, 0x7d688e, 0xb3945a, 0x558b8e, 0xa76a85, 0x7c9061, 0x656f9b, 0xb07c59];
const HAIRS = [0x2b1b12, 0x6b3e1e, 0xd4a24c, 0x111111, 0xb5441f, 0x8a8a8a];
const L1 = 0.8, L2 = 0.75; // 위팔/아래팔
const UP = new Vector3(0, 1, 0);
const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
const upperGeo = new THREE.CylinderGeometry(0.135, 0.12, L1, 12).translate(0, L1 / 2, 0);
const lowerGeo = new THREE.CylinderGeometry(0.115, 0.095, L2, 12).translate(0, L2 / 2, 0);
const capsuleGeo = new THREE.CapsuleGeometry(0.43, 0.22, 8, 18);

function sph(r, color, sx = 1, sy = 1, sz = 1, rough = 0.7) { const m = new Mesh(sphereGeo, mat(color, rough)); m.scale.set(r * sx, r * sy, r * sz); m.castShadow = true; return m; }
function box(w, h, d, color, rough = 0.7) { const m = new Mesh(new THREE.BoxGeometry(w, h, d), mat(color, rough)); m.castShadow = true; return m; }

class Avatar {
  constructor(o) {
    this.o = o;
    const root = (this.root = new Group());
    this.phase = Math.random() * 10;
    this.emoteUntil = 0; this._em = false; this.headBias = 0; // 감정표현 중 표시
    this.lean = 0; this.bounce = 0; this.nextBlink = 2 + Math.random() * 3; this.blinkT = 0;
    this.look = null; this.yaw = 0; this.pitch = 0;
    const skin = o.skin, shirt = o.shirt;

    // 의자
    const chair = (this.chair = new Group());
    const leather = mat(o.dealer ? 0x202a30 : 0x263e45, 0.48);
    const seat = new Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 24), leather); seat.position.set(0, 0.88, -0.02); seat.castShadow = seat.receiveShadow = true;
    const back = new Mesh(new THREE.CylinderGeometry(0.72, 0.72, 1.15, 20, 1, true, Math.PI * 0.62, Math.PI * 0.76), leather); back.material = leather.clone(); back.material.side = THREE.DoubleSide; back.position.set(0, 1.55, -0.02); back.castShadow = true;
    const col = new Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.8, 10), mat(0x222226, 0.4, 0.6)); col.position.set(0, 0.45, 0);
    const base = new Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.06, 5), mat(0x222226, 0.4, 0.6)); base.position.y = 0.04;
    chair.add(seat, back, col, base);
    root.add(chair);

    // 다리
    const legs = (this.legs = new Group());
    for (const sx of [-0.2, 0.2]) {
      const th = box(0.26, 0.26, 0.85, o.pants); th.position.set(sx, 1.05, 0.38);
      const sh = box(0.22, 0.95, 0.24, o.pants); sh.position.set(sx, 0.52, 0.8);
      const shoe = box(0.26, 0.14, 0.42, 0x15151a); shoe.position.set(sx, 0.07, 0.9);
      legs.add(th, sh, shoe);
    }
    root.add(legs);

    // 상체
    const torso = (this.torso = new Group()); torso.position.set(0, 1.0, 0);
    const body = new Mesh(capsuleGeo, mat(o.dealer ? 0xf4f4f4 : shirt, 0.8)); body.scale.set(1.0, 1, 0.72); body.position.y = 0.5; body.castShadow = true;
    torso.add(body);
    if (o.dealer) { // 조끼 + 보타이
      const vest = new Mesh(capsuleGeo, mat(0x15151a, 0.7)); vest.scale.set(1.04, 0.98, 0.76); vest.position.y = 0.5; vest.castShadow = true;
      const front = box(0.22, 0.75, 0.05, 0xf4f4f4); front.position.set(0, 0.55, 0.34);
      torso.add(vest, front);
      const tie = new Group();
      for (const sx of [-1, 1]) { const w = new Mesh(new THREE.ConeGeometry(0.1, 0.17, 8), mat(0xc4161c, 0.5)); w.rotation.z = sx * -Math.PI / 2; w.position.set(sx * 0.09, 0, 0); tie.add(w); }
      tie.add(sph(0.045, 0xc4161c)); tie.position.set(0, 1.04, 0.3); torso.add(tie);
    } else if (o.stripe) {
      const st = box(0.9, 0.12, 0.62, o.stripe); st.position.set(0, 0.55, 0); st.scale.set(1, 1, 0.9); torso.add(st);
    }
    const neck = new Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.2, 12), mat(skin, 0.7)); neck.position.y = 1.08; torso.add(neck);

    // 머리
    const head = (this.head = new Group()); head.position.set(0, 1.12, 0);
    const skull = sph(0.4, skin, 1, 1.05, 1.0, 0.65); skull.position.y = 0.4; head.add(skull);
    for (const sx of [-1, 1]) {
      const ear = sph(0.085, skin, 0.7, 1, 0.9); ear.position.set(sx * 0.4, 0.38, 0); head.add(ear);
      const eye = sph(0.085, 0xffffff, 1, 1.1, 0.7, 0.3); eye.position.set(sx * 0.15, 0.46, 0.34); eye.castShadow = false;
      const pup = sph(0.045, 0x15110f, 1, 1, 0.6, 0.2); pup.position.set(sx * 0.15, 0.46, 0.4);
      const brow = box(0.17, 0.035, 0.04, o.hair, 0.9); brow.position.set(sx * 0.15, 0.58, 0.35); brow.rotation.z = sx * 0.1;
      head.add(eye, pup, brow);
      (this.eyes ||= []).push(eye, pup);
    }
    const nose = sph(0.06, skin, 1, 1, 1, 0.8); nose.material = mat(new THREE.Color(skin).multiplyScalar(0.92).getHex(), 0.8); nose.position.set(0, 0.38, 0.42); head.add(nose);
    const mouth = (this.mouth = new Mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 14, Math.PI), mat(0x5a1c1c, 0.6)));
    mouth.position.set(0, 0.25, 0.37); mouth.rotation.z = Math.PI; head.add(mouth);
    // 머리카락
    const hairM = mat(o.hair, 0.85);
    const style = o.hairStyle;
    if (style !== 4) {
      const cap = new Mesh(new THREE.SphereGeometry(0.43, 20, 14, 0, TAU, 0, Math.PI * (style === 3 ? 0.42 : 0.56)), hairM);
      cap.position.set(0, 0.42, -0.03); cap.rotation.x = -0.18; cap.castShadow = true; head.add(cap);
    }
    if (style === 1) { const lg = box(0.84, 0.95, 0.24, o.hair, 0.85); lg.position.set(0, 0.0, -0.3); head.add(lg); }
    if (style === 2) { const bun = sph(0.17, o.hair, 1, 1, 1, 0.85); bun.position.set(0, 0.88, -0.18); head.add(bun); }
    if (style === 3) { const mo = box(0.1, 0.22, 0.6, o.hair, 0.85); mo.position.set(0, 0.88, -0.05); head.add(mo); }
    if (style === 4 || o.beard) { const bd = new Mesh(new THREE.SphereGeometry(0.415, 18, 12, 0, TAU, Math.PI * 0.58, Math.PI * 0.3), hairM); bd.position.set(0, 0.4, 0.02); bd.scale.set(1, 1.05, 1.02); head.add(bd); }
    if (o.glasses) {
      for (const sx of [-1, 1]) { const r = new Mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 16), mat(0x111111, 0.4)); r.position.set(sx * 0.15, 0.46, 0.4); head.add(r); }
      const br = box(0.1, 0.014, 0.014, 0x111111); br.position.set(0, 0.47, 0.4); head.add(br);
    }
    if (o.dealer) { // 카지노 바이저
      const band = new Mesh(new THREE.TorusGeometry(0.405, 0.04, 8, 28), mat(0x0f7a46, 0.5)); band.rotation.x = Math.PI / 2; band.position.y = 0.66; head.add(band);
      const brim = new Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.03, 24, 1, false, -Math.PI / 2 + 0.3, Math.PI - 0.6), mat(0x0f7a46, 0.5)); brim.position.set(0, 0.64, 0.14); head.add(brim);
    }
    torso.add(head);
    root.add(torso);

    // 팔 (IK)
    const slv = o.dealer ? mat(0xf4f4f4, 0.8) : mat(shirt, 0.8);
    const forearm = o.dealer || o.longSleeve ? slv : mat(skin, 0.7);
    this.arms = {
      R: this.makeArm(-0.52, slv, forearm, skin),
      L: this.makeArm(0.52, slv, forearm, skin),
    };
    this.setRestPose();
  }

  makeArm(sx, slv, fore, skin) {
    const upper = new Mesh(upperGeo, slv); upper.castShadow = true;
    const lower = new Mesh(lowerGeo, fore); lower.castShadow = true;
    const js = sph(0.17, 0xffffff); js.material = slv;
    const je = sph(0.13, 0xffffff); je.material = fore;
    const hand = sph(0.17, skin, 1, 0.8, 1.15, 0.6);
    this.root.add(upper, lower, js, je, hand);
    return { sx, upper, lower, js, je, hand, goal: new Vector3(), desired: new Vector3(), rest: new Vector3(), pole: new Vector3(sx > 0 ? 0.5 : -0.5, -1, -0.35), shoulder: new Vector3() };
  }

  setRestPose() {
    const y = TABLE_Y + 0.17;
    this.arms.R.rest.set(-0.46, y, this.o.dealer ? 1.2 : 0.88);
    this.arms.L.rest.set(0.46, y, this.o.dealer ? 1.2 : 0.88);
    for (const a of Object.values(this.arms)) { a.desired.copy(a.rest); a.goal.copy(a.rest); }
    this.torso.updateMatrix();
    for (const a of Object.values(this.arms)) this.solve(a);
  }

  setFirstPerson(on) {
    this.torso.visible = !on; this.legs.visible = !on; this.chair.visible = !on; this.firstPerson = on;
    for (const a of Object.values(this.arms)) { a.js.visible = !on; a.upper.castShadow = a.lower.castShadow = a.hand.castShadow = !on; }
  }

  locked() { return !this._em && performance.now() < this.emoteUntil; } // 감정표현 중이면 다른 동작이 팔을 못 움직인다
  reach(side, local) { if (this.locked()) return; this.arms[side].desired.copy(local); }
  reachWorld(side, world) { if (this.locked()) return; this.arms[side].desired.copy(this.root.worldToLocal(world.clone())); }
  release(side) { if (this.locked()) return; if (side) this.arms[side].desired.copy(this.arms[side].rest); else for (const a of Object.values(this.arms)) a.desired.copy(a.rest); }
  lookWorld(p) { if (!this.lockLook) this.look = p; } // lockLook: 때리는 동안은 상대를 계속 본다
  setMood(m) {
    const mo = this.mouth;
    if (m === 'happy') { mo.rotation.z = Math.PI; mo.scale.set(1.25, 1.5, 1); mo.position.y = 0.26; }
    else if (m === 'sad') { mo.rotation.z = 0; mo.scale.set(0.8, 0.8, 1); mo.position.y = 0.21; }
    else { mo.rotation.z = Math.PI; mo.scale.set(1, 0.55, 1); mo.position.y = 0.25; }
  }

  solve(arm) {
    const S = arm.shoulder.set(arm.sx, 0.95, 0).applyMatrix4(this.torso.matrix);
    const d = arm.goal.clone().sub(S);
    let dist = d.length();
    const max = L1 + L2 - 0.02;
    if (dist > max) { d.multiplyScalar(max / dist); dist = max; }
    if (dist < 0.3) { d.setLength(0.3); dist = 0.3; }
    const dir = d.clone().divideScalar(dist);
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = arm.pole.clone();
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-4) pole.set(0, -1, 0);
    pole.normalize();
    const elbow = S.clone().addScaledVector(dir, a).addScaledVector(pole, h);
    const hand = S.clone().add(d);
    arm.upper.position.copy(S); arm.upper.quaternion.setFromUnitVectors(UP, elbow.clone().sub(S).normalize());
    arm.lower.position.copy(elbow); arm.lower.quaternion.setFromUnitVectors(UP, hand.clone().sub(elbow).normalize());
    arm.js.position.copy(S); arm.je.position.copy(elbow); arm.hand.position.copy(hand);
    arm.hand.quaternion.copy(arm.lower.quaternion);
  }

  update(dt, t) {
    const k = 1 - Math.exp(-dt * 9);
    // 앞으로 숙이기: 손이 멀리 있으면 상체를 기울임
    let want = 0;
    for (const a of Object.values(this.arms)) {
      const h = Math.hypot(a.desired.x - a.sx, a.desired.z - 0.1);
      want = Math.max(want, clamp((h - 1.2) * 0.5, 0, 0.62));
    }
    this.lean += (want - this.lean) * k;
    const breath = Math.sin(t * 1.7 + this.phase);
    this.torso.rotation.set(this.lean + breath * 0.012 + (this.leanBias || 0), this.twist || 0, this.tilt || 0); // 때리기 연출용: 숙이기/비틀기/기울기
    this.torso.position.y = 1.0 + (this.hipY || 0); // 일어서면 몸통이 올라간다
    this.torso.scale.set(1 + breath * 0.008, 1 + breath * 0.012, 1);
    this.torso.updateMatrix();
    this.root.position.y = Math.max(0, Math.sin(this.bounce * 14)) * 0.12 * Math.min(1, this.bounce) + (this.walkY || 0);
    for (const a of Object.values(this.arms)) { if (this.armsSnap) a.goal.copy(a.desired); else a.goal.lerp(a.desired, 1 - Math.exp(-dt * 11)); this.solve(a); } // armsSnap: 방망이를 휘두를 때 팔이 늦지 않게
    // 시선
    if (this.look && !this.firstPerson) {
      const l = this.root.worldToLocal(this.look.clone());
      const ty = clamp(Math.atan2(l.x, l.z), -1.1, 1.1);
      const tp = clamp(-Math.atan2(l.y - 2.4, Math.hypot(l.x, l.z)), -0.45, 0.45);
      this.yaw += (ty - this.yaw) * k * 0.7; this.pitch += (tp - this.pitch) * k * 0.7;
    }
    this.head.rotation.set(this.pitch + this.headBias, this.yaw + (this.headTwist || 0), Math.sin(t * 0.7 + this.phase) * 0.02);
    // 눈 깜빡임
    this.nextBlink -= dt;
    if (this.nextBlink < 0) { this.blinkT = 0.12; this.nextBlink = 2.5 + Math.random() * 3.5; }
    if (this.blinkT > 0) { this.blinkT -= dt; for (const e of this.eyes) e.visible = false; } else for (const e of this.eyes) e.visible = true;
  }
}

let _heart;
function heartGeo() { // 위가 둥글고 아래가 뾰족한 하트
  if (_heart) return _heart;
  const pts = [];
  for (let i = 0; i <= 64; i++) { const t = (i / 64) * TAU; pts.push(new THREE.Vector2(16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))); }
  _heart = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 5, bevelEnabled: true, bevelSize: 1, bevelThickness: 1, bevelSegments: 2, curveSegments: 16 });
  _heart.translate(0, 2.5, -2.5); _heart.scale(0.03, 0.03, 0.03);
  return _heart;
}
function makeBat() { // 손잡이가 가늘고 끝이 굵은 야구 배트 (손잡이 끝이 원점, +Y 방향이 배트 끝)
  const prof = [[0.03, 0], [0.034, 0.25], [0.05, 0.7], [0.085, 1.1], [0.1, 1.28], [0.07, 1.34], [0, 1.35]].map(([r, y]) => new THREE.Vector2(r, y));
  const bat = new Mesh(new THREE.LatheGeometry(prof, 14), mat(0xcaa15a, 0.55)); bat.castShadow = true;
  const grip = new Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 10), mat(0x222222, 0.8)); grip.position.y = 0.15; bat.add(grip);
  return bat;
}

function avatarOpts(name) {
  const h = hash(name);
  return { skin: SKINS[h % SKINS.length], shirt: SHIRTS[(h >>> 3) % SHIRTS.length], hair: HAIRS[(h >>> 6) % HAIRS.length], hairStyle: (h >>> 9) % 5, pants: 0x2b3040,
    glasses: (h >>> 12) % 4 === 0, beard: (h >>> 14) % 5 === 0 && (h >>> 9) % 5 !== 1, stripe: (h >>> 16) % 3 === 0 ? 0xffffff : 0, longSleeve: (h >>> 18) % 3 === 0 };
}

// ───────── 트윈 ─────────
class Tweens {
  constructor() { this.list = []; this.fast = false; this.scale = 1; }
  run(dur, fn, ease = easeInOut) {
    dur *= this.scale; // 개발용 느린 화면 배율 (평소 1)
    if (this.fast || dur <= 0) { fn(1); return Promise.resolve(); }
    return new Promise((res) => this.list.push({ t0: performance.now(), dur, fn, ease, res }));
  }
  update(now) {
    for (const tw of this.list.slice()) {
      const p = clamp((now - tw.t0) / tw.dur, 0, 1);
      tw.fn(tw.ease(p));
      if (p >= 1) { this.list.splice(this.list.indexOf(tw), 1); tw.res(); }
    }
  }
}

// ───────── 무대 ─────────
export class Stage {
  constructor(host) {
    this.host = host;
    this.tw = new Tweens();
    this.sleep = (ms) => (this.tw.fast ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
    this.first = true; this.lastEv = -1; this.state = null; this.shownState = null;
    this.seats = []; this.community = []; this.muck = []; this.potAmt = 0; this.potGroup = null;
    this.layoutKey = ''; this.portrait = null;
    this.strip = { board: [], mine: [], hasHand: false, folded: false }; // 화면 아래 2D 카드 패널용 (연출에 맞춰 갱신)
    this.onStrip = () => {};
    this.onCue = () => {};
    this.onMyBubble = null;      // 내 감정표현 말풍선(화면 위 오버레이)
    this.onShow = () => {};      // 쇼다운 패 공개 시작 (결과 패널용)
    this.onHandStart = () => {}; // 새 핸드 시작
    this.sfx = null;             // 효과음/음성 (sound.js) — 연출 순간마다 호출
    this.emoteSeen = 0;          // 이미 재생한 감정표현 이벤트 번호
    this.hitSeen = 0;            // 이미 반영한 때리기·합의금 이벤트 번호
    this.onHit = null;           // (ev) 때리기/합의금 이벤트가 도착한 순간 (떠오르는 글자용, hit.js 가 건다)
    this.onImpact = null;        // (ev) 세 번째 타격 순간
    this.onFaint = null;         // () 내가 쓰러질 때 (암막)
    this.onStunChange = null;    // () 아바타가 쓰러지거나 깨어난 뒤 (배지·배너 새로고침)
    const coarse = matchMedia('(pointer:coarse)').matches || innerWidth < 700;
    this.lowQ = coarse;
    chipShadows = !coarse;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.6 : 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.18;
    r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    host.appendChild(r.domElement);
    this.ui = document.createElement('div'); this.ui.className = 'ui3d'; host.appendChild(this.ui);

    const sc = (this.scene = new THREE.Scene());
    sc.background = new THREE.Color(0x0d1b21);
    sc.fog = new THREE.Fog(0x0d1b21, 27, 55);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 120);

    sc.add(new THREE.HemisphereLight(0xdcecf3, 0x243c3e, 1.4));
    const spot = (this.spot = new THREE.SpotLight(0xffe6bd, 3.8, 0, 0.9, 0.85, 0));
    spot.position.set(0, 12.5, 1.5); spot.target.position.set(0, 1, 0.3);
    spot.castShadow = true; spot.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    spot.shadow.camera.near = 4; spot.shadow.camera.far = 30; spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.04;
    sc.add(spot, spot.target);
    const fill = new THREE.DirectionalLight(0xd6e8f4, 0.85); fill.position.set(0, 7, 14); sc.add(fill);
    const rim = new THREE.DirectionalLight(0x9ed4ce, 1.15); rim.position.set(-8, 6, -6); sc.add(rim);

    this.world = new Group(); this.dyn = new Group(); sc.add(this.world, this.dyn);
    this.effects = new TableEffects(sc, coarse);
    this.last = performance.now();
    r.setAnimationLoop((now) => this.frame(now));
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  // ── 레이아웃/월드 ──
  dims() { return this.portrait ? { a: 4.4, b: 3.0 } : { a: 4.7, b: 3.0 }; }
  resize() {
    const w = this.host.clientWidth || 800, h = this.host.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    const portrait = innerHeight > innerWidth; // 화면(기기)이 세로인지로 판단 — 3D 화면 높이를 잘라 쓰므로 3D 화면 비율로는 판단하지 않는다
    const pt = portrait;
    this.host.style.setProperty('--ps', clamp(Math.min(w / (pt ? 540 : 920), h / (pt ? 820 : 640)), pt ? 0.72 : 0.65, 1.15).toFixed(3));
    this.camera.aspect = w / h;
    if (portrait !== this.portrait) { this.portrait = portrait; this.buildWorld(); if (this.state) { this.layoutKey = ''; this.layout(this.state); this.reconcile(this.state); this.hud(this.shownState || this.state); } }
    this.fitCamera();
  }

  edge(phi) { const { a, b } = this.dims(); return new Vector3(-a * Math.sin(phi), 0, b * Math.cos(phi)); }
  anchors(phi) {
    const { a, b } = this.dims();
    const E = this.edge(phi);
    const n = new Vector3(E.x / (a * a), 0, E.z / (b * b)).normalize();
    const f = n.clone().negate();
    const right = new Vector3(-f.z, 0, f.x);
    const at = (inw, lat, y = TABLE_Y) => E.clone().addScaledVector(n, -inw).addScaledVector(right, lat).setY(y);
    let bi = 1.55;
    for (; bi > 0.85; bi -= 0.1) { const q = at(bi, 0); if (Math.abs(q.x) >= 2.45 || Math.abs(q.z) >= 1.25) break; }
    return { phi, E, n, right, cardYaw: Math.atan2(n.x, n.z), avYaw: Math.atan2(-n.x, -n.z),
      seat: E.clone().addScaledVector(n, 1.25).setY(0), at,
      cards: (k) => at(0.8, (k - 0.5) * 0.74, TABLE_Y + CT / 2 + 0.003), stack: at(0.5, 1.6), bet: at(bi, 0), button: at(1.2, -1.5, TABLE_Y + 0.04) };
  }

  buildWorld() {
    this.world.clear(); this.dyn.clear();
    this.seats = []; this.community = []; this.muck = []; this.potGroup = null; this.potAmt = 0; this.dealer = null; this.button = null;
    this.ui.innerHTML = '';
    const { a, b } = this.dims();
    this.effects.configure(a, b);
    // 바닥
    const floor = new Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({
      map: canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#12232b'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(139,178,179,.035)'; g.lineWidth = 1; for (let i = -w; i < w * 2; i += 32) { g.beginPath(); g.moveTo(i,0); g.lineTo(i+w,h); g.stroke(); g.beginPath(); g.moveTo(i+w,0); g.lineTo(i,h); g.stroke(); } }, [12, 12]), roughness: 0.94 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.world.add(floor);
    // 테이블
    const ell = (ax, bz) => { const s = new THREE.Shape(); s.absellipse(0, 0, ax, bz, 0, TAU, false, 0); return s; };
    const felt = new Mesh(new THREE.ShapeGeometry(ell(a, b), 64), new THREE.MeshStandardMaterial({
      map: canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#145957'; g.fillRect(0, 0, w, h); for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.045})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, [a / 2.2, b / 2.2]), roughness: 0.95 }));
    felt.rotation.x = -Math.PI / 2; felt.position.y = TABLE_Y; felt.receiveShadow = true; this.world.add(felt);
    const railShape = ell(a + 0.45, b + 0.45); railShape.holes.push(ell(a, b));
    const rail = new Mesh(new THREE.ExtrudeGeometry(railShape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 3, curveSegments: 64 }), mat(0x17292e, 0.5));
    rail.rotation.x = -Math.PI / 2; rail.position.y = TABLE_Y - 0.02; rail.castShadow = rail.receiveShadow = true; this.world.add(rail);
    const trim = new Mesh(new THREE.ExtrudeGeometry((() => { const s = ell(a + 0.02, b + 0.02); s.holes.push(ell(a - 0.03, b - 0.03)); return s; })(), { depth: 0.02, bevelEnabled: false, curveSegments: 64 }), mat(0xc5a779, 0.36, 0.72));
    trim.rotation.x = -Math.PI / 2; trim.position.y = TABLE_Y + 0.001; this.world.add(trim);
    const apron = new Mesh(new THREE.ExtrudeGeometry(ell(a + 0.4, b + 0.4), { depth: 0.35, bevelEnabled: false, curveSegments: 64 }), mat(0x1c3036, 0.46));
    apron.rotation.x = -Math.PI / 2; apron.position.y = TABLE_Y - 0.37; apron.castShadow = true; this.world.add(apron);
    const ped = new Mesh(new THREE.CylinderGeometry(0.9, 1.4, TABLE_Y - 0.35, 20), mat(0x203139, 0.4, 0.5)); ped.position.y = (TABLE_Y - 0.35) / 2; ped.castShadow = true; this.world.add(ped);
    // 펠트 위 라인
    const pts = []; for (let i = 0; i <= 96; i++) { const t = (i / 96) * TAU; pts.push(new Vector3(Math.cos(t) * (a - 0.45), TABLE_Y + 0.004, Math.sin(t) * (b - 0.45))); }
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xd7c192, transparent: true, opacity: 0.28 })); this.world.add(line);
    const logo = new Mesh(new THREE.PlaneGeometry(2.4, 0.65), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false,
      map: canvasTex(512, 128, (g, w, h) => { g.fillStyle = 'rgba(225,211,170,.36)'; g.font = '42px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText("AFTER HOURS", w / 2, h / 2 - 15); g.font = '14px Arial'; g.fillStyle = 'rgba(225,211,170,.24)'; g.fillText("P R I V A T E   P O K E R   C L U B", w / 2, h / 2 + 32); }) }));
    logo.rotation.x = -Math.PI / 2; logo.position.set(0, TABLE_Y + 0.006, -(b - 0.9)); this.world.add(logo);

    // Brushed brass outer rail and a soft, continuous under-table light.
    const outerShape = ell(a + 0.46, b + 0.46); outerShape.holes.push(ell(a + 0.42, b + 0.42));
    const outerTrim = new Mesh(new THREE.ExtrudeGeometry(outerShape, { depth: 0.025, bevelEnabled: false, curveSegments: 64 }), mat(0xbca075, 0.4, 0.65));
    outerTrim.rotation.x = -Math.PI / 2; outerTrim.position.y = TABLE_Y - 0.025; this.world.add(outerTrim);
    const glowShape = ell(a + 0.4, b + 0.4); glowShape.holes.push(ell(a + 0.36, b + 0.36));
    const glow = new Mesh(new THREE.ExtrudeGeometry(glowShape, { depth: 0.018, bevelEnabled: false, curveSegments: 64 }), new THREE.MeshBasicMaterial({color:0x598e85}));
    glow.rotation.x = -Math.PI / 2; glow.position.y = TABLE_Y - 0.27; this.world.add(glow);
    // 딜러
    const an = (this.dealerA = this.anchors(DEALER_PHI));
    const dav = new Avatar({ skin: 0xe8bf9a, shirt: 0xf4f4f4, hair: 0x1a1a1a, hairStyle: 0, pants: 0x15151a, dealer: true });
    dav.root.position.copy(an.seat); dav.root.rotation.y = an.avYaw; this.dyn.add(dav.root);
    this.dealer = { avatar: dav, deck: an.at(0.55, 0.0, TABLE_Y), muck: an.at(0.9, 1.7, TABLE_Y + CT / 2 + 0.003), burn: an.at(0.9, -1.7, TABLE_Y + CT / 2 + 0.003) };
    // 덱
    const deck = new Group();
    for (let i = 0; i < 9; i++) { const c = new Mesh(cardGeo, [edgeMat, edgeMat, cardBackMat(), cardBackMat(), edgeMat, edgeMat]); c.position.y = TABLE_Y + 0.01 + i * CT; c.rotation.y = an.cardYaw + (i % 2) * 0.02; c.castShadow = true; deck.add(c); }
    deck.position.copy(this.dealer.deck); deck.position.y = 0; this.dyn.add(deck);
    this.dealer.deck.y = TABLE_Y + 0.12;
    this.dealerEl = this.makePlate(); this.dealerEl.el.classList.add('dealer'); this.dealerEl.plate.innerHTML = '<div class="nm">♠ HOUSE DEALER</div>';
    // 딜러 버튼
    const btn = new Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 28), [mat(0xf4f1e6, 0.4), new THREE.MeshStandardMaterial({ roughness: 0.4, map: canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#f4f1e6'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c9a23f'; g.lineWidth = 8; g.beginPath(); g.arc(64, 64, 52, 0, TAU); g.stroke(); g.fillStyle = '#222'; g.font = 'bold 66px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('D', 64, 68); }) }), mat(0xf4f1e6, 0.4)]);
    btn.castShadow = true; btn.visible = false; this.button = btn; this.dyn.add(btn);
    // 팟 라벨
    this.potEl = document.createElement('div'); this.potEl.className = 'lab3d pot'; this.ui.appendChild(this.potEl);
    this.layoutKey = '';
  }

  fitCamera() {
    if (!this.dealer) return;
    const cam = this.camera;
    cam.fov = this.portrait ? 42 : 36; cam.updateProjectionMatrix();
    const el = rad(this.portrait ? 60 : 46);
    const T = new Vector3(0, TABLE_Y - 0.1, this.portrait ? 0.6 : 0.5);
    const pts = [];
    for (const phi of ANG10) {
      const an = this.anchors(phi);
      if (phi === 0) { pts.push(an.E.clone().addScaledVector(an.n, 2.1).setY(1.0), an.stack, an.cards(0).setY(TABLE_Y)); }
      else pts.push(an.seat.clone().setY(3.35), an.seat.clone().setY(1.0), an.stack);
    }
    pts.push(this.dealerA.seat.clone().setY(3.35));
    const v = new Vector3();
    let dBest = 60;
    for (let d = 8; d < 70; d += 0.4) {
      cam.position.copy(T).add(new Vector3(0, Math.sin(el), Math.cos(el)).multiplyScalar(d));
      cam.lookAt(T); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      let ok = true;
      for (const p of pts) { v.copy(p).project(cam); if (Math.abs(v.x) > (this.portrait ? 0.85 : 0.88) || v.y > 0.8 || v.y < -0.9) { ok = false; break; } }
      if (ok) { dBest = d; break; }
    }
    cam.position.copy(T).add(new Vector3(0, Math.sin(el), Math.cos(el)).multiplyScalar(dBest));
    cam.lookAt(T);
  }

  phiFor(i, me, n) { const k = (i - me + n) % n; return ANG10[Math.round((k * 10) / n) % 10]; }

  makePlate() {
    const el = document.createElement('div'); el.className = 'p3d';
    el.innerHTML = '<div class="say"></div><div class="plate"></div>';
    this.ui.appendChild(el);
    return { el, plate: el.querySelector('.plate'), say: el.querySelector('.say') };
  }

  layout(st) {
    const n = st.players.length, me = st.me;
    const key = `${n}|${me}|${this.portrait}`;
    while (this.seats.length > n) { const s = this.seats.pop(); this.removeSeat(s); }
    while (this.seats.length < n) {
      const i = this.seats.length, p = st.players[i];
      const av = new Avatar(avatarOpts(p.name));
      this.dyn.add(av.root);
      const pl = this.makePlate();
      const bet = document.createElement('div'); bet.className = 'lab3d'; this.ui.appendChild(bet);
      this.seats.push({ i, avatar: av, name: p.name, el: pl.el, plate: pl.plate, say: pl.say, betEl: bet, cards: [], stack: null, stackAmt: 0, bet: null, betAmt: 0, sayT: 0, a: null });
    }
    this.seats.forEach((s, i) => {
      if (s.name !== st.players[i].name) { // 이름이 바뀐(재사용된) 자리 → 아바타 교체
        this.dyn.remove(s.avatar.root); s.avatar = new Avatar(avatarOpts(st.players[i].name)); s.name = st.players[i].name; this.dyn.add(s.avatar.root); this.layoutKey = '';
      }
    });
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.seats.forEach((s, i) => {
      s.a = this.anchors(this.phiFor(i, me, n));
      s.avatar.root.position.copy(s.a.seat); s.avatar.root.rotation.y = s.a.avYaw;
      s.avatar.setFirstPerson(i === me);
      s.avatar.lookWorld(new Vector3(0, TABLE_Y + 1, 0));
      s.fresh = true; // 카드/칩을 새 위치에 다시 놓는다
    });
  }
  removeSeat(s) {
    this.dyn.remove(s.avatar.root); s.el.remove(); s.betEl.remove();
    for (const c of s.cards) this.dyn.remove(c);
    if (s.stack) this.dyn.remove(s.stack); if (s.bet) this.dyn.remove(s.bet);
  }

  // 소리: 건너뛰기(fast) 중에는 내지 않는다
  fx(name, ...args) { if (!this.sfx || this.tw.fast) return; try { this.sfx[name](...args); } catch {} }

  setStrip(patch) { Object.assign(this.strip, patch); this.onStrip(this.strip); }

  cue(kind, data, position) {
    if (this.tw.fast || document.hidden || document.body.dataset.motion === 'off') return;
    try {
      if (position) this.effects.pulse(position, kind === 'allin' ? 0xffce76 : 0x80f6d1, kind === 'allin' ? 2 : 1);
      if (kind === 'win') for (const winner of data.winners) this.effects.pulse(this.seats[winner.i].a.stack, 0xffd58a, 2);
      this.onCue(kind, data, position);
    } catch (error) { console.warn('화면 효과:', error.message); }
  }

  // ── 칩/카드 배치 ──
  setStack(s, amt) { if (s.stack) this.dyn.remove(s.stack); s.stackAmt = amt; s.stack = buildPile(amt); s.stack.position.copy(s.a.stack); s.stack.rotation.y = s.a.cardYaw; this.dyn.add(s.stack); }
  setBet(s, amt) {
    if (s.bet) this.dyn.remove(s.bet);
    s.betAmt = amt; s.bet = buildPile(amt); s.bet.position.copy(s.a.bet); this.dyn.add(s.bet);
    s.betEl.textContent = amt > 0 ? fmt(amt) : ''; s.betEl.style.display = amt > 0 ? '' : 'none';
  }
  setPot(amt) {
    if (this.potGroup) this.dyn.remove(this.potGroup);
    this.potAmt = amt; this.potGroup = buildPile(amt); this.potGroup.position.set(0, TABLE_Y, this.potZ()); this.dyn.add(this.potGroup);
    this.potEl.textContent = amt > 0 ? '팟 ' + fmt(amt) : ''; this.potEl.style.display = amt > 0 ? '' : 'none';
  }
  potZ() { return 0.75; }
  boardPos(k) { return new Vector3((k - 2) * 0.82, TABLE_Y + CT / 2 + 0.003, -0.45); }

  holePose(s, m, k, mode) {
    const a = s.a, p = a.cards(k);
    m.rotation.order = 'YXZ';
    if (mode === 'peek') { // 내 카드: 살짝 들어서 본다
      p.addScaledVector(a.n, 0.15).setY(TABLE_Y + 0.42); m.position.copy(p); m.rotation.set(0.98, a.cardYaw + (k ? -0.07 : 0.07), 0); m.scale.setScalar(1.28);
    } else if (mode === 'show') {
      const q = a.at(0.85, (k - 0.5) * 0.9, TABLE_Y + 0.05); m.position.copy(q); m.rotation.set(0.35, a.cardYaw, 0); m.scale.setScalar(1.3);
    } else { m.position.copy(p); m.rotation.set(0, a.cardYaw + (k ? -0.08 : 0.08), Math.PI); m.scale.setScalar(1); }
  }

  reconcile(st) {
    const P = st.players;
    this.seats.forEach((s, i) => {
      const p = P[i];
      const want = p.inHand && !p.folded && p.cards.length ? p.cards : [];
      const mode = (c) => (i === st.me ? 'peek' : c !== '??' ? 'show' : 'down');
      let rebuild = s.fresh || s.cards.length !== want.length;
      if (!rebuild) rebuild = want.some((c, k) => c !== '??' && s.cards[k].userData.code !== c);
      if (rebuild) {
        for (const c of s.cards) this.dyn.remove(c);
        s.cards = want.map((c, k) => { const m = makeCard(c); this.holePose(s, m, k, mode(c)); if (mode(c) !== 'down') m.rotation.z = 0; this.dyn.add(m); return m; });
      }
      if (s.fresh || s.betAmt !== p.bet) this.setBet(s, p.bet);
      if (s.fresh || s.stackAmt !== p.chips) this.setStack(s, p.chips);
      s.fresh = false;
    });
    // 커뮤니티 카드
    if (this.community.length !== st.community.length || this.community.some((c, k) => c.userData.code !== st.community[k])) {
      for (const c of this.community) this.dyn.remove(c);
      this.community = st.community.map((code, k) => { const m = makeCard(code); m.position.copy(this.boardPos(k)); m.rotation.set(0, 0, 0); m.scale.setScalar(1.28); this.dyn.add(m); return m; });
    }
    const bets = P.reduce((x, p) => x + p.bet, 0);
    const inPot = st.phase === 'showdown' || st.phase === 'waiting' || st.phase === 'ended' ? 0 : Math.max(0, st.pot - bets);
    if (inPot !== this.potAmt) this.setPot(inPot);
    this.placeButton(st.dealer, false);
    const mp = P[st.me];
    this.setStrip({ board: st.community.slice(), hasHand: !!(mp && mp.inHand), folded: !!(mp && mp.folded), mine: mp && mp.inHand ? (mp.cards.length ? mp.cards.slice() : this.strip.mine) : [] });
  }

  placeButton(idx, animate) {
    const s = this.seats[idx];
    if (!s || idx < 0) { this.button.visible = false; return Promise.resolve(); }
    const target = s.a.button.clone();
    this.button.visible = true;
    if (!animate || !this.buttonAt) { this.button.position.copy(target); this.buttonAt = target; return Promise.resolve(); }
    const from = this.button.position.clone();
    this.buttonAt = target;
    return this.tw.run(700, (p) => { this.button.position.lerpVectors(from, target, p); this.button.position.y = TABLE_Y + 0.04 + Math.sin(p * Math.PI) * 0.7; });
  }

  // ── HUD (이름판) ──
  hud(st) {
    this.shownState = st;
    st.players.forEach((p, i) => {
      const s = this.seats[i]; if (!s) return;
      const winner = st.phase === 'showdown' && p.won > 0;
      s.el.dataset.seat = i;
      s.el.className = ['p3d', i === st.me ? 'me' : '', p.kicked ? 'out' : '', p.folded ? 'folded' : '', st.toAct === i ? 'turn' : '', !p.inHand && st.handNo ? 'out' : '', winner ? 'winner' : ''].join(' ');
      const tags = [i === st.dealer ? '<span class="tag">D</span>' : '', i === st.sbIdx ? '<span class="tag sb">SB</span>' : '', i === st.bbIdx ? '<span class="tag bb">BB</span>' : ''].join('');
      let act;
      if (p.handName) act = `<div class="act hn">${esc(p.handName)}</div>`;
      else if (p.kicked) act = '<div class="act bad">퇴장</div>';
      else if (p.out) act = '<div class="act bad">탈락</div>';
      else if (!p.connected) act = '<div class="act bad">연결 끊김</div>';
      else if (p.chips === 0 && !p.inHand && st.handNo) act = '<div class="act bad">칩 없음</div>';
      else if (p.folded) act = '<div class="act fold">폴드</div>';
      else act = `<div class="act ${p.allIn ? 'allin' : ''}">${esc(p.lastAction || (p.allIn ? '올인' : ''))}</div>`;
      s.plate.innerHTML = `${winner ? `<div class="won">+${fmt(p.won)}</div>` : ''}<div class="tags">${tags}</div><div class="nm">${p.host ? '👑 ' : ''}${esc(p.name)}${i === st.me ? ' (나)' : ''}</div><div class="ch">${fmt(p.chips)}</div>${act}<div class="timer" ${st.toAct === i ? '' : 'style="visibility:hidden"'}><i></i></div>`;
    });
    // 시선: 차례인 사람을 본다
    const target = st.toAct >= 0 && this.seats[st.toAct] ? this.seats[st.toAct].a.seat.clone().setY(2.4) : new Vector3(0, TABLE_Y + 1, 0);
    this.seats.forEach((s, i) => s.avatar.lookWorld(i === st.toAct ? new Vector3(0, TABLE_Y + 1, 0.5) : target));
    this.dealer.avatar.lookWorld(target);
    this.syncStun(st);
  }
  // 서버의 기절 상태를 아바타에 맞춘다 (hud 때마다): 이번 핸드를 쉬는 사람('out')은 쓰러뜨리고, 풀렸으면 깨운다
  syncStun(st) {
    if (!this.stun || !this.wake) return; // punch.js 가 아직 안 붙었거나 못 불렀으면 건너뜀
    let again = false;
    st.players.forEach((p, i) => {
      const av = this.seats[i] && this.seats[i].avatar;
      if (!av || av.demo || av.waking) return; // demo: 시연 도구가 직접 쓰러뜨린 아바타
      if (p.stun === 'out' && !av.stunned) { if (!this.faint(i)) again = true; }
      else if (!p.stun && av.stunned) this.revive(i);
    });
    clearTimeout(this.stunRetryT);
    if (again) this.stunRetryT = setTimeout(() => this.shownState && this.syncStun(this.shownState), 600); // 때리는 모션 등으로 바빠서 못 쓰러뜨렸으면 곧 다시
  }
  faint(i) { // 쓰러지는 모션 + 😵 (내가 쓰러지면 암막). 하는 중이라 못 쓰러뜨리면 false
    const av = this.seats[i] && this.seats[i].avatar; if (!av || !this.stun) return false;
    this.stun(i).catch(console.error);
    if (!av.stunned) return false;
    this.say(i, '😵', 2500);
    if (this.state && i === this.state.me && this.onFaint) this.onFaint();
    if (this.onStunChange) this.onStunChange();
    return true;
  }
  async revive(i) { // 깨어나는 모션 + 🥴
    const av = this.seats[i] && this.seats[i].avatar; if (!av || !av.stunned || av.waking) return;
    av.waking = true;
    try { await this.wake(i); this.say(i, '🥴', 1600); } finally { av.waking = false; }
    if (this.onStunChange) this.onStunChange();
  }
  say(i, text, ms = 1500, big = false, chat = false) { // chat: 사람이 직접 친 한마디 (행동 말풍선과 색·크기를 다르게)
    const s = this.seats[i]; if (!s) return;
    if (big && this.state && i === this.state.me && this.onMyBubble) this.onMyBubble(text, ms); // 내 감정표현: 내 카드 패널에 가리지 않게 화면 위쪽에 따로 띄운다
    s.say.textContent = text; s.say.classList.toggle('chat', chat); s.say.classList.add('on'); clearTimeout(s.sayT);
    s.sayT = setTimeout(() => s.say.classList.remove('on'), ms);
  }

  // ── 프레임 ──
  frame(now) {
    const dt = clamp((now - this.last) / 1000, 0, 0.05); this.last = now;
    this.tw.update(performance.now());
    const t = now / 1000;
    for (const s of this.seats) s.avatar.update(dt, t);
    this.dealer && this.dealer.avatar.update(dt, t);
    this.effects.update(now, this.seats[this.shownState?.toAct], !this.tw.fast && !document.hidden && document.body.dataset.motion !== 'off');
    this.project();
    this.renderer.render(this.scene, this.camera);
  }
  project() {
    const w = this.host.clientWidth, h = this.host.clientHeight, v = new Vector3();
    const put = (el, p) => { v.copy(p).project(this.camera); el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px,${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%,-100%)`; };
    // On phones keep nameplates on a regular outer ring, clear of cards and each other.
    const compact = innerWidth <= 700 && this.portrait;
    const ringLabel = (el, phi, dealer = false) => {
      const x = w * (.5 - Math.sin(phi) * .4);
      const y = h * (.5 + Math.cos(phi) * (dealer ? .38 : .33));
      el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
    };
    this.seats.forEach((s, i) => {
      if (!s.a) return;
      if (this.state && i === this.state.me) put(s.el, s.a.E.clone().addScaledVector(s.a.n, 2.0).setY(TABLE_Y - 0.3));
      else if (s.a.n.z > 0.3) put(s.el, s.a.E.clone().addScaledVector(s.a.n, 2.0).setY(TABLE_Y - 0.3)); // 카메라 쪽 자리: 이름판을 의자 바깥 아래로
      else put(s.el, s.a.seat.clone().setY(3.2));
      if (compact) ringLabel(s.el, s.a.phi);
      if (s.betAmt > 0) put(s.betEl, s.a.bet.clone().setY(TABLE_Y + 0.35 + Math.min(10, s.betAmt / 40) * 0.0));
    });
    put(this.dealerEl.el, this.dealerA.seat.clone().setY(3.3));
    if (compact) ringLabel(this.dealerEl.el, DEALER_PHI, true);
    if (this.potAmt > 0) put(this.potEl, new Vector3(0, TABLE_Y + 0.9, this.potZ()));
  }

  // ── 상태 반영 + 이벤트 연출 ──
  async play(st) {
    this.state = st;
    if (!this.dealer) this.buildWorld();
    const evs = st.events.filter((e) => e.id > this.lastEv);
    const gap = evs.length && evs[0].id > this.lastEv + 1 && this.lastEv >= 0;
    this.layout(st);
    if (this.first || gap || st.evSeq < this.lastEv) {
      this.first = false;
      this.emoteSeen = Math.max(this.emoteSeen, st.evSeq); // 들어오기 전의 감정표현은 재생하지 않는다
      this.hitSeen = Math.max(this.hitSeen, st.evSeq);
      this.clearVolatile();
      this.reconcile(st);
      this.lastEv = st.evSeq;
      this.hud(st);
      return;
    }
    for (const ev of evs) { try { await this.handle(ev, st); } catch (e) { console.error('연출 오류', ev, e); } this.lastEv = ev.id; }
    this.lastEv = st.evSeq;
    this.reconcile(st);
    this.hud(st);
  }
  clearVolatile() { for (const m of this.muck) this.dyn.remove(m); this.muck = []; for (const s of this.seats) { s.avatar.release(); s.avatar.bounce = 0; s.avatar.setMood('neutral'); } this.dealer.avatar.release(); }

  async handle(ev, st) {
    const S = this.seats[ev.k === 'deal' ? ev.to : ev.i], me = st.me;
    switch (ev.k) {
      case 'hand': {
        this.onHandStart(st);
        this.effects.clear();
        this.cue('hand', {number:ev.n});
        this.clearVolatile();
        for (const s of this.seats) { for (const c of s.cards) this.dyn.remove(c); s.cards = []; if (s.bet) { this.dyn.remove(s.bet); s.bet = null; } s.betAmt = 0; s.betEl.style.display = 'none'; }
        for (const c of this.community) this.dyn.remove(c); this.community = [];
        this.setPot(0);
        this.setStrip({ board: [], mine: [], folded: false, hasHand: !!(st.players[me] && st.players[me].inHand) });
        this.hud({ ...st, toAct: -1 });
        await this.placeButton(ev.dealer, true);
        break;
      }
      case 'bet': {
        if (!S) break;
        const av = S.avatar, from = S.a.stack.clone(), to = S.a.bet.clone();
        const tmp = buildPile(ev.add); tmp.position.copy(from); this.dyn.add(tmp);
        S.stackAmt = Math.max(0, S.stackAmt - ev.add); this.setStack(S, S.stackAmt);
        const blind = ev.kind === 'blind';
        if (ev.kind === 'allin') this.cue('allin', {name:S.name, amount:ev.total}, to);
        this.fx('chipsOut', ev.add, blind);
        { const word = { call: '콜', raise: `레이즈 ${ev.total}`, bet: `벳 ${ev.total}`, allin: '올인' }[ev.kind]; if (word) this.fx('say', word, S.name); }
        av.reachWorld('R', from.clone().setY(TABLE_Y + 0.35)); await this.sleep(blind ? 120 : 240);
        await this.tw.run(blind ? 420 : 560, (p) => {
          tmp.position.lerpVectors(from, to, p); tmp.position.y = TABLE_Y + Math.sin(p * Math.PI) * 0.55;
          av.reachWorld('R', tmp.position.clone().setY(tmp.position.y + 0.25));
        }, easeInOut);
        this.dyn.remove(tmp);
        this.fx('chipsLand', ev.add, blind);
        if (!blind) this.cue('bet', {amount:ev.add}, to);
        this.setBet(S, ev.total);
        if (ev.kind !== 'blind') this.say(ev.i, { call: '콜', raise: `레이즈 ${fmt(ev.total)}`, bet: `벳 ${fmt(ev.total)}`, allin: '올인!' }[ev.kind] || '', 1400);
        if (ev.kind === 'allin') av.reachWorld('L', to.clone().setY(TABLE_Y + 0.3));
        await this.sleep(ev.kind === 'allin' ? 360 : blind ? 60 : 140);
        av.release();
        break;
      }
      case 'check': {
        if (!S) break;
        const av = S.avatar, base = av.arms.R.rest;
        this.fx('say', '체크', S.name);
        for (let k = 0; k < 2; k++) { av.reach('R', base.clone().add(new Vector3(0, 0.3, 0.1))); await this.sleep(150); av.reach('R', base.clone().add(new Vector3(0, -0.12, 0.1))); this.fx('knock'); await this.sleep(130); }
        this.say(ev.i, '체크', 1200); av.release(); await this.sleep(100);
        break;
      }
      case 'fold': {
        if (!S) break;
        const av = S.avatar, to = this.dealer.muck.clone();
        av.setMood('sad'); this.say(ev.i, '폴드', 1300);
        this.fx('say', '폴드', S.name); this.fx('fold');
        if (ev.i === me) this.setStrip({ folded: true });
        const cards = S.cards.slice(); S.cards = [];
        const froms = cards.map((c) => c.position.clone());
        if (cards[0]) av.reachWorld('R', cards[0].position.clone().setY(TABLE_Y + 0.3));
        await this.sleep(200);
        await this.tw.run(620, (p) => {
          cards.forEach((c, k) => { c.position.lerpVectors(froms[k], to, p); c.position.y = TABLE_Y + 0.05 + Math.sin(p * Math.PI) * 0.4; c.rotation.y += 0.03; c.rotation.z = lerp(c.rotation.z, Math.PI, p); c.scale.setScalar(lerp(c.scale.x, 1, p)); });
          if (cards[0]) av.reachWorld('R', cards[0].position.clone().setY(TABLE_Y + 0.3));
        }, easeInOut);
        cards.forEach((c, k) => { c.position.y = TABLE_Y + 0.012 + this.muck.length * CT; this.muck.push(c); });
        av.release(); await this.sleep(120);
        setTimeout(() => av.setMood('neutral'), 1500);
        break;
      }
      case 'sweep': {
        const movers = this.seats.filter((s) => s.betAmt > 0 && s.bet);
        const total = movers.reduce((x, s) => x + s.betAmt, 0);
        const potZ = this.potZ();
        this.fx('sweep');
        const froms = movers.map((s) => s.bet.position.clone());
        await this.tw.run(650, (p) => movers.forEach((s, k) => { s.bet.position.set(lerp(froms[k].x, 0, p), TABLE_Y + Math.sin(p * Math.PI) * 0.25, lerp(froms[k].z, potZ, p)); }), easeInOut);
        for (const s of movers) { this.dyn.remove(s.bet); s.bet = null; s.betAmt = 0; s.betEl.style.display = 'none'; }
        this.setPot(this.potAmt + total);
        await this.sleep(120);
        break;
      }
      case 'deal': {
        if (!S) break;
        const d = this.dealer, av = d.avatar, k = S.cards.length;
        const myCode = ev.to === me ? st.players[me].cards[k] : '??';
        const card = makeCard(myCode);
        card.position.copy(d.deck); card.position.y = TABLE_Y + 0.2; this.dyn.add(card); S.cards.push(card);
        const to = S.a.cards(k), yaw = S.a.cardYaw + (k ? -0.08 : 0.08);
        const dir = to.clone().sub(d.deck).setY(0); const dist = dir.length(); dir.normalize();
        this.fx('deal', 380 + dist * 45);
        av.reachWorld('L', d.deck.clone().add(new Vector3(0, 0.1, 0)));
        av.reachWorld('R', d.deck.clone().add(new Vector3(0, 0.2, 0)));
        await this.sleep(40);
        av.reachWorld('R', d.deck.clone().addScaledVector(dir, Math.min(1.1, dist * 0.35)).add(new Vector3(0, 0.25, 0)));
        const from = card.position.clone(), yaw0 = yaw + (Math.random() - 0.5) * 2.5;
        const fl = this.tw.run(380 + dist * 45, (p) => {
          card.position.lerpVectors(from, to, p); card.position.y = lerp(from.y, to.y, p) + Math.sin(p * Math.PI) * 0.8;
          card.rotation.y = lerp(yaw0, yaw, p);
        }, easeOut);
        await this.sleep(100);
        av.reachWorld('R', d.deck.clone().add(new Vector3(0, 0.2, 0)));
        S.avatar.lookWorld(d.deck);
        fl.then(() => { if (ev.to === me) this.setStrip({ mine: this.strip.mine.concat(myCode) }); if (ev.to === me && S.cards.length === 2 && this.state && this.state.players[me].cards.length === 2) setTimeout(() => this.peek(), 350); });
        break;
      }
      case 'street': {
        const d = this.dealer, av = d.avatar;
        // 번 카드
        const burn = makeCard('??'); burn.position.copy(d.deck); burn.position.y = TABLE_Y + 0.2; this.dyn.add(burn);
        const bFrom = burn.position.clone(), bTo = d.burn.clone().add(new Vector3(0, this.muck.length * 0.002, 0));
        av.reachWorld('R', d.deck.clone().add(new Vector3(0, 0.2, 0)));
        this.fx('deal', 420);
        await this.tw.run(420, (p) => { burn.position.lerpVectors(bFrom, bTo, p); burn.position.y = lerp(bFrom.y, bTo.y, p) + Math.sin(p * Math.PI) * 0.5; });
        this.muck.push(burn);
        const newCards = [];
        const flights = [];
        for (let j = 0; j < ev.cards.length; j++) {
          const slot = this.community.length;
          const c = makeCard(ev.cards[j]); c.position.copy(d.deck); c.position.y = TABLE_Y + 0.2; c.scale.setScalar(1.28); this.dyn.add(c);
          this.community.push(c); newCards.push(c);
          const to = this.boardPos(slot), from = c.position.clone(), y0 = (Math.random() - 0.5) * 2;
          av.reachWorld('R', to.clone().lerp(d.deck, 0.55).setY(TABLE_Y + 0.35));
          this.fx('deal', 480);
          flights.push(this.tw.run(480, (p) => { c.position.lerpVectors(from, to, p); c.position.y = lerp(from.y, to.y, p) + Math.sin(p * Math.PI) * 0.7; c.rotation.y = lerp(y0, 0, p); }, easeOut));
          await this.sleep(190);
        }
        await Promise.all(flights);
        av.release();
        await this.sleep(150);
        // 뒤집기
        this.fx('flip', ev.cards.length);
        this.cue('street', {phase:ev.phase}, new Vector3(0, TABLE_Y + .03, -.45));
        this.setStrip({ board: this.strip.board.concat(ev.cards) });
        await this.tw.run(520, (p) => newCards.forEach((c) => { c.rotation.z = lerp(Math.PI, 0, p); c.position.y = TABLE_Y + CT / 2 + 0.003 + Math.sin(p * Math.PI) * 0.45; }), easeInOut);
        this.seats.forEach((s) => s.avatar.lookWorld(new Vector3(0, TABLE_Y + 0.5, -0.4)));
        await this.sleep(ev.cards.length > 1 ? 350 : 200);
        break;
      }
      case 'show': {
        this.onShow(st);
        const idxs = Object.keys(ev.hands).map(Number);
        for (const i of idxs) {
          const s = this.seats[i]; if (!s) continue;
          const codes = ev.hands[i];
          const mine = i === me;
          s.cards.forEach((c, k) => setFront(c, codes[k]));
          const metas = s.cards.map((c, k) => ({ c, p0: c.position.clone(), r0: c.rotation.clone(), s0: c.scale.x }));
          const tmp = new THREE.Object3D(); const poses = s.cards.map((c, k) => { this.holePose(s, tmp, k, mine ? 'peek' : 'show'); return { p: tmp.position.clone(), r: tmp.rotation.clone(), sc: tmp.scale.x }; });
          s.avatar.reachWorld('R', s.cards[0] ? s.cards[0].position.clone().setY(TABLE_Y + 0.4) : s.a.cards(0)); s.avatar.reachWorld('L', s.cards[1] ? s.cards[1].position.clone().setY(TABLE_Y + 0.4) : s.a.cards(1));
          this.fx('flip', 2);
          const flip = this.tw.run(560, (p) => metas.forEach((m, k) => {
            m.c.position.lerpVectors(m.p0, poses[k].p, p); m.c.position.y += Math.sin(p * Math.PI) * 0.5;
            m.c.rotation.x = lerp(m.r0.x, poses[k].r.x, p); m.c.rotation.y = lerp(m.r0.y, poses[k].r.y, p); m.c.rotation.z = lerp(Math.PI, 0, p);
            m.c.scale.setScalar(lerp(m.s0, poses[k].sc, p));
          }), easeInOut);
          await this.sleep(200);
          flip.then(() => s.avatar.release());
        }
        await this.sleep(1200);
        break;
      }
      case 'win': {
        const potFrom = new Vector3(0, TABLE_Y, this.potZ());
        const winners = ev.winners.filter((w) => this.seats[w.i]);
        this.cue('win', {winners:winners.map(w => ({...w, name:this.seats[w.i].name}))});
        this.setPot(0);
        await Promise.all(winners.map(async (w, n) => {
          await this.sleep(n * 200);
          const s = this.seats[w.i], to = s.a.stack.clone();
          const tmp = buildPile(w.amount); tmp.position.copy(potFrom); this.dyn.add(tmp);
          s.avatar.setMood('happy'); s.avatar.bounce = 1;
          s.avatar.reachWorld('R', potFrom.clone().setY(TABLE_Y + 0.4));
          this.fx('win', w.amount);
          await this.tw.run(850, (p) => { tmp.position.lerpVectors(potFrom, to, p); tmp.position.y = TABLE_Y + Math.sin(p * Math.PI) * 0.6; });
          this.dyn.remove(tmp);
          this.setStack(s, s.stackAmt + w.amount);
          this.say(w.i, `+${fmt(w.amount)}`, 2200);
          // 환호
          s.avatar.reach('R', new Vector3(-0.7, 3.1, 0.35)); s.avatar.reach('L', new Vector3(0.7, 3.1, 0.35));
        }));
        if (ev.showdown) this.seats.forEach((s, i) => { if (!winners.find((w) => w.i === i) && s.cards.length) s.avatar.setMood('sad'); });
        await this.sleep(1100);
        this.seats.forEach((s) => { s.avatar.release(); s.avatar.bounce = 0; });
        setTimeout(() => this.seats.forEach((s) => s.avatar.setMood('neutral')), 800);
        break;
      }
    }
  }

  // ── 감정표현 (차례·연출 순서와 상관없이 도착하는 즉시 재생) ──
  pushEmotes(st) {
    const top = st.events.reduce((m, e) => Math.max(m, e.id), 0);
    if (this.first || !this.dealer) { this.emoteSeen = Math.max(this.emoteSeen, top); return; }
    for (const ev of st.events) {
      if (ev.k !== 'emote' || ev.id <= this.emoteSeen) continue;
      this.emoteSeen = ev.id;
      if (!document.hidden) this.doEmote(ev).catch(() => {});
    }
    this.emoteSeen = Math.max(this.emoteSeen, top);
  }
  // ── 때리기·합의금 (연출 순서를 기다리지 않고 이벤트가 도착하는 즉시: 칩 숫자 · 떠오르는 글자 · 때리는 모션은 판 진행과 함께) ──
  // older: 아직 화면에 반영되지 않은 옛 상태들 (index.html 의 현재 상태 + 대기열). 같은 만큼 같이 옮겨 두어야 뒤늦게 재생될 때 숫자가 되돌아가지 않는다.
  pushHits(st, older = []) {
    const top = st.events.reduce((m, e) => Math.max(m, e.id), 0);
    if (this.first || !this.dealer) { this.hitSeen = Math.max(this.hitSeen, top); return; }
    const lastHit = st.events.reduce((m, e) => (e.k === 'hit' ? Math.max(m, e.id) : m), 0);
    for (const ev of st.events) {
      if ((ev.k !== 'hit' && ev.k !== 'pay') || ev.id <= this.hitSeen) continue;
      this.hitSeen = ev.id;
      this.shiftChips(ev.i, -ev.amt, older); this.shiftChips(ev.to, ev.amt, older); // 낸 사람 −, 받은 사람 + (hit·pay 공통)
      if (ev.k === 'hit' && !(ev.id === lastHit && st.hit && st.hit.busyUntil > st.serverNow)) continue; // 재접속 직후 놓쳤던 옛 때리기는 모션·글자를 재생하지 않는다 (숫자만 맞춤)
      if (this.onHit) this.onHit(ev);
      if (document.hidden) continue; // 숨겨진 탭은 연출 생략 (숫자는 이미 바뀜)
      if (ev.k === 'hit') { if (this.punch) this.punch(ev.i, ev.to, 'b', { hit: (k) => { if (k === 3 && this.onImpact) this.onImpact(ev); } }).catch(console.error); }
      else this.say(ev.i, '💸 합의금', 2000);
    }
    this.hitSeen = Math.max(this.hitSeen, top);
  }
  shiftChips(i, d, older) { // i 번 자리의 칩을 d 만큼: 지금 상태·보이는 상태·옛 상태의 숫자와 이름판·칩 더미
    const seen = new Set();
    for (const x of [this.state, this.shownState, ...older]) { const p = x && x.players && x.players[i]; if (p && !seen.has(p)) { seen.add(p); p.chips = Math.max(0, p.chips + d); } } // 옛 상태가 올인 직후라 칩이 0 에 가까우면 음수로 보이지 않게 // 같은 선수 객체를 두 번 더하지 않게
    const s = this.seats[i], p = this.shownState && this.shownState.players[i];
    if (!s || !s.a || !p) return;
    const ch = s.plate.querySelector('.ch'); if (ch) ch.textContent = fmt(p.chips);
    this.setStack(s, Math.max(0, s.stackAmt + d));
  }
  shake(amp = 0.06) { // 쾅! 할 때 화면이 살짝 흔들린다
    // 카메라의 '원래 자리'를 기억해 뒀다가 되돌리지 않고, 더한 흔들림만 정확히 뺀다
    // (그 사이 카메라가 다른 연출로 옮겨졌어도 옛 자리로 되돌려 놓지 않게. 화면이 밀려 즉시 끝나는 fast 모드에서도 남는 것이 없다)
    const cam = this.camera, d = new Vector3();
    this.tw.run(200, (p) => { cam.position.sub(d); const k = p >= 1 ? 0 : (1 - p) * amp; d.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, 0); cam.position.add(d); });
  }
  tear(av, side) {
    const m = new Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.9, roughness: 0.2 }));
    m.scale.setScalar(0.045); m.position.set(side * 0.15, 2.5, 0.4); av.root.add(m);
    this.tw.run(520, (p) => { m.position.y = 2.5 - p * 0.55; m.material.opacity = 0.9 * (1 - p); }, easeInOut).then(() => av.root.remove(m));
  }
  heart(av, dx, size) {
    const m = new Mesh(heartGeo(), new THREE.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff2d55, emissiveIntensity: 0.7, roughness: 0.4, transparent: true }));
    m.position.set(dx, 2.35, 0.95); m.scale.setScalar(0.001); av.root.add(m);
    this.tw.run(1500, (p) => { m.scale.setScalar(size * (p < 0.2 ? p / 0.2 : 1)); m.position.y = 2.35 + p * 0.9; m.rotation.y = Math.sin(p * 6) * 0.4; m.material.opacity = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1; }, easeLin).then(() => av.root.remove(m));
  }
  async doEmote(ev) {
    const s = this.seats.find((x) => x.name === ev.name);
    if (!s) return;
    const av = s.avatar, i = this.seats.indexOf(s), t0 = performance.now();
    if (ev.e === 'text') { this.say(i, ev.text, 3500, false, true); return; } // 한마디: 동작 없이 말풍선만 (하던 감정표현 동작도 방해하지 않는다)
    const TEXT = { angry: '💢 화났어요!', thanks: '💖 감사해요!', sad: '😭 슬퍼요…', hurry: '⚾ 빨리빨리!!' };
    if (t0 < av.emoteUntil) { if (av.busy) this.say(i, TEXT[ev.e], 1800, true); return; } // 이미 하는 중 (때리거나 맞거나 기절한 중이면 동작은 못 해도 말풍선은 보여 준다)
    const TOTAL = { angry: 2300, thanks: 2500, sad: 2700, hurry: 2700 }[ev.e];
    this.say(i, TEXT[ev.e], TOTAL - 200, true);
    if (this.tw.fast) return; // 화면이 밀려 있을 땐 말풍선만
    av.emoteUntil = t0 + TOTAL;
    const em = (side, v) => { av._em = true; av.reach(side, v); av._em = false; };
    const V = (x, y, z) => new Vector3(x, y, z);
    try {
      if (ev.e === 'angry') { // 양손으로 책상을 쾅쾅쾅
        av.setMood('sad');
        for (let k = 0; k < 3; k++) {
          em('R', V(-0.6, 2.75, 0.55)); em('L', V(0.6, 2.75, 0.55)); await this.sleep(300);
          em('R', V(-0.5, TABLE_Y + 0.12, 0.95)); em('L', V(0.5, TABLE_Y + 0.12, 0.95)); await this.sleep(110);
          this.fx('slam'); this.shake(0.07); await this.sleep(200);
        }
      } else if (ev.e === 'sad') { // 양손으로 얼굴을 가리고 흐느낌
        av.setMood('sad'); av.headBias = 0.4; this.fx('sob');
        for (let k = 0; k < 12; k++) {
          const dy = Math.sin(k * 1.7) * 0.035;
          em('R', V(-0.17, 2.46 + dy, 0.62)); em('L', V(0.17, 2.46 - dy, 0.62));
          if (k % 2 === 0) this.tear(av, k % 4 === 0 ? -1 : 1);
          await this.sleep(190);
        }
      } else if (ev.e === 'thanks') { // 양손으로 하트 모양
        av.setMood('happy');
        em('R', V(-0.12, 2.05, 0.82)); em('L', V(0.12, 2.05, 0.82)); await this.sleep(260);
        this.fx('chime'); this.heart(av, 0, 0.55); setTimeout(() => this.heart(av, -0.3, 0.4), 250); setTimeout(() => this.heart(av, 0.3, 0.35), 500);
        for (let k = 0; k < 4; k++) { em('R', V(-0.12, 2.18, 0.82)); em('L', V(0.12, 2.18, 0.82)); await this.sleep(240); em('R', V(-0.12, 2.05, 0.82)); em('L', V(0.12, 2.05, 0.82)); await this.sleep(240); }
      } else if (ev.e === 'hurry') { // 야구 배트를 들어 휘두름 (책상을 때리며 "빨리!")
        const bat = makeBat(); av.root.add(bat);
        const pivot = V(-0.3, 2.15, 0.45), dir = (a) => V(0, Math.cos(a), Math.sin(a));
        const place = (a) => { const d = dir(a); bat.position.copy(av.arms.R.hand.position); bat.quaternion.setFromUnitVectors(UP, d); em('R', pivot.clone().addScaledVector(d, 0.22)); em('L', pivot.clone().add(V(0.22, -0.05, 0.02)).addScaledVector(d, 0.1)); };
        try {
          await this.tw.run(320, (p) => place(lerp(0, -0.9, p)), easeOut);
          for (let k = 0; k < 2; k++) {
            this.fx('swing');
            await this.tw.run(140, (p) => place(lerp(-0.9, 2.15, p)), easeInOut);
            this.fx('hit'); this.shake(0.08); await this.sleep(150);
            if (k === 0) await this.tw.run(260, (p) => place(lerp(2.15, -0.9, p)), easeInOut);
          }
          await this.tw.run(300, (p) => place(lerp(2.15, 0, p)), easeInOut);
        } finally { av.root.remove(bat); }
      }
    } finally {
      av._em = true; av.release(); av._em = false; av.headBias = 0; av.setMood('neutral');
      av.emoteUntil = performance.now() + 30;
    }
  }

  // 내 카드를 들어서 확인
  peek() {
    const st = this.state; if (!st) return;
    const s = this.seats[st.me]; if (!s || !s.cards.length) return;
    const mine = st.players[st.me].cards;
    s.cards.forEach((c, k) => setFront(c, mine[k]));
    const metas = s.cards.map((c) => ({ c, p0: c.position.clone(), r0: c.rotation.clone(), s0: c.scale.x }));
    const tmp = new THREE.Object3D();
    const poses = s.cards.map((c, k) => { this.holePose(s, tmp, k, 'peek'); return { p: tmp.position.clone(), r: tmp.rotation.clone(), sc: tmp.scale.x }; });
    this.tw.run(480, (p) => metas.forEach((m, k) => {
      m.c.position.lerpVectors(m.p0, poses[k].p, p); m.c.rotation.x = lerp(m.r0.x, poses[k].r.x, p); m.c.rotation.y = lerp(m.r0.y, poses[k].r.y, p);
      m.c.rotation.z = lerp(Math.PI, 0, p); m.c.scale.setScalar(lerp(m.s0, poses[k].sc, p));
    }), easeInOut);
  }

  setFast(on) { this.tw.fast = on; }
}

// 때리기 연출(punch.js)이 같은 재료를 쓰도록 내보낸다
export { box, mat, makeBat, easeInOut, easeOut, lerp, clamp, UP, TABLE_Y };
