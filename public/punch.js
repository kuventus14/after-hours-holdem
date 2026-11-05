// 때리기 연출 (화면 전용): 의자에서 일어나 → 고른 아바타 옆까지 걸어가 → 방망이로 때리고 → 돌아와 앉는다.
// 서버·돈과는 무관하다. 사용: attachPunch(Stage) 한 번 → stage.punch(때리는 자리, 맞는 자리, 'a'|'b'|'c')
//
// 렉 방지 원칙 (이전 랜딩에서 데인 것):
//  - 새 조명·그림자·타이머를 만들지 않는다. 기존 연출 시계(stage.tw, 프레임마다 도는 트윈)만 쓴다.
//  - 프레임마다 새 객체를 만들지 않는다 (임시 벡터는 미리 만들어 재사용).
//  - 다리 같은 새 메시는 아바타당 한 번만 만들어 재사용하고, 평소엔 숨겨 둔다(보이지 않는 메시는 그려지지 않는다).
import * as THREE from './vendor/three.module.js';
import { box, mat, makeBat, easeInOut, easeOut, lerp, clamp, UP, TABLE_Y } from './game3d.js';
const { Vector3, Group, Quaternion, Mesh } = THREE;

const HIP = 1.0;   // 앉았을 때 몸통 기준점(엉덩이) 높이
const RISE = 0.8;  // 일어서면 엉덩이가 이만큼 올라간다 → 다리 길이 1.8 (허벅지 .9 + 정강이 .9)
const Y0 = HIP + RISE; // 일어선 몸통 기준 높이
const PI = Math.PI;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const aLerp = (a, b, t) => a + wrap(b - a) * t;
const lin = (t) => t;
const easeIn = (t) => t * t * t;
const wait = (st, ms) => st.tw.run(ms, () => {}, lin); // setTimeout 이 아니라 연출 시계를 쓴다 (느린 화면 배율·프레임 단위 확인이 가능)
const T = { a: new Vector3(), b: new Vector3(), c: new Vector3(), d: new Vector3() }; // 재사용 임시 값

// ───────── 카메라: 걷는 동안 뒤로 빼 의자 뒤로 도는 길이 화면에 담기게 한다 ─────────
function camState(st, c) { const cam = st.camera; return c.cam || (c.cam = { pos: cam.position.clone(), quat: cam.quaternion.clone(), dir: cam.getWorldDirection(new Vector3()), len: cam.position.distanceTo(T.d.set(0, 1.3, 0.5)) }); }
const camGo = (st, pos, quat, ms) => { const cam = st.camera, p0 = cam.position.clone(), q0 = cam.quaternion.clone(); return st.tw.run(ms, (p) => { cam.position.lerpVectors(p0, pos, p); cam.quaternion.slerpQuaternions(q0, quat, p); }, easeInOut); };
const camBack = (st, c, k, ms) => { const z = camState(st, c); return camGo(st, z.pos.clone().addScaledVector(z.dir, -(k - 1) * z.len), z.quat, ms); }; // k=1 원래 구도, 1.2 = 20% 뒤로
const camPush = (st, c, target, t, ms) => { // target 쪽으로 t(0~1)만큼 다가가며 그쪽을 본다
  camState(st, c);
  const cam = st.camera, p0 = cam.position.clone(), q0 = cam.quaternion.clone(), pos = p0.clone().lerp(target, t);
  cam.position.copy(pos); cam.lookAt(target); const q = cam.quaternion.clone(); cam.position.copy(p0); cam.quaternion.copy(q0);
  return camGo(st, pos, q, ms);
};

// ───────── 서 있는 다리 (아바타당 한 번만 만든다) ─────────
function ensureLegs(av) {
  if (av.stand) return av.stand;
  const g = new Group(); g.visible = false;
  const leg = (sx) => {
    const hip = new Group(); hip.position.set(sx, HIP, 0);
    const th = box(0.27, 0.9, 0.27, av.o.pants); th.position.y = -0.45;
    const knee = new Group(); knee.position.y = -0.9;
    const sh = box(0.23, 0.9, 0.24, av.o.pants); sh.position.y = -0.45;
    const shoe = box(0.26, 0.13, 0.44, 0x15151a); shoe.position.set(0, -0.87, 0.1);
    knee.add(sh, shoe); hip.add(th, knee); g.add(hip);
    return { hip, knee };
  };
  av.stand = { g, L: leg(0.2), R: leg(-0.2) };
  av.root.add(g);
  return av.stand;
}
function legs(av, hl, kl, hr, kr) { // 왼 엉덩이/무릎, 오른 엉덩이/무릎 각도 (엉덩이 음수 = 다리가 앞으로)
  const s = av.stand, y = HIP + (av.hipY || 0);
  s.L.hip.rotation.x = hl; s.L.knee.rotation.x = kl; s.R.hip.rotation.x = hr; s.R.knee.rotation.x = kr;
  s.L.hip.position.y = s.R.hip.position.y = y;
}
const SEATED = [-PI / 2, PI / 2, -PI / 2, PI / 2];

// ───────── 의자를 떼어 제자리에 남긴다 ─────────
function detachChair(st, h) {
  const c = h.av.chair;
  h.chairHome = { pos: c.position.clone(), rot: c.rotation.clone() };
  h.av.root.updateWorldMatrix(true, true);
  c.getWorldPosition(h.chairW = new Vector3()); c.getWorldQuaternion(h.chairQ = new Quaternion());
  st.scene.add(c); c.position.copy(h.chairW); c.quaternion.copy(h.chairQ);
  h.chairYaw = c.rotation.y;
}
function attachChair(h) {
  if (!h.chairHome) return;
  h.av.root.add(h.av.chair); h.av.chair.position.copy(h.chairHome.pos); h.av.chair.rotation.copy(h.chairHome.rot); h.chairHome = null;
}

// ───────── 준비 / 정리 ─────────
function prep(st, i) {
  const s = st.seats[i], av = s && s.avatar;
  if (!av || av.busy || !s.a) return null;
  const h = { s, av, i, seat: s.a.seat.clone(), yaw: s.a.avYaw };
  av.busy = true; av.emoteUntil = Infinity; av.lockLook = true; av.armsSnap = false;
  ensureLegs(av);
  h.look0 = av.look && av.look.clone(); h.wasFirst = av.firstPerson; av.setFirstPerson(false); // 내 아바타도 걷는 동안은 몸 전체가 보여야 한다
  return h;
}
function restore(st, h) {
  const av = h.av;
  attachChair(h);
  av.stand.g.visible = false;
  av.setFirstPerson(!!h.wasFirst);
  av.hipY = av.walkY = av.leanBias = av.twist = av.tilt = av.headTwist = av.headBias = 0; av.armsSnap = false;
  av.root.position.set(h.seat.x, 0, h.seat.z); av.root.rotation.y = h.yaw;
  av.emoteUntil = 0; av.release(); av.lockLook = false; av.look = h.look0;
  av.busy = false; av.setMood('neutral');
}

// ───────── 일어서기 / 앉기 ─────────
async function standUp(st, h, ms = 480, pop = 0) {
  const { av, s } = h;
  detachChair(st, h);
  av.legs.visible = false; av.stand.g.visible = true; legs(av, ...SEATED);
  const c = av.chair, c0 = c.position.clone(), n = s.a.n;
  await st.tw.run(ms, (p) => {
    const q = clamp((p - 0.2) / 0.8, 0, 1), e = easeOut(q);
    av.hipY = RISE * e + pop * RISE * Math.sin(q * PI); av.leanBias = Math.sin(clamp(p / 0.65, 0, 1) * PI) * 0.4; // 앞으로 숙였다가 일어선다
    legs(av, lerp(-PI / 2, 0, e), lerp(PI / 2, 0, e), lerp(-PI / 2, 0, e), lerp(PI / 2, 0, e));
    c.position.copy(c0).addScaledVector(n, 0.6 * easeOut(p)); c.rotation.y = h.chairYaw + 0.5 * easeOut(p); // 의자가 뒤로 밀려난다
  }, lin);
  av.leanBias = 0; av.hipY = RISE;
}
async function sitDown(st, h, ms = 480) {
  const { av } = h, c = av.chair, c0 = c.position.clone(), y0 = c.rotation.y;
  av.root.rotation.y = h.yaw; av.root.position.set(h.seat.x, 0, h.seat.z);
  await st.tw.run(ms, (p) => {
    const e = easeInOut(p), q = easeInOut(clamp(p / 0.8, 0, 1));
    av.hipY = RISE * (1 - q); av.leanBias = Math.sin(clamp((p - 0.3) / 0.7, 0, 1) * PI) * 0.3;
    legs(av, lerp(0, -PI / 2, q), lerp(0, PI / 2, q), lerp(0, -PI / 2, q), lerp(0, PI / 2, q));
    c.position.lerpVectors(c0, h.chairW, e); c.rotation.y = lerp(y0, h.chairYaw, e); // 의자가 제자리로 들어온다
  }, lin);
  av.hipY = 0; av.leanBias = 0;
}

// ───────── 걷기 ─────────
function buildPath(st, h, v) {
  const a0 = h.s.a, a1 = v.s.a, D = 2.5;
  const dphi = wrap(a1.phi - a0.phi), sgn = dphi >= 0 ? 1 : -1; // 짧은 쪽으로 돌아간다
  const ring = (phi) => { const A = st.anchors(phi); return A.E.clone().addScaledVector(A.n, D).setY(0); };
  const pts = [h.seat.clone().setY(0)];
  const r0 = ring(a0.phi), r0n = ring(a0.phi + sgn * 0.2);
  pts.push(h.seat.clone().addScaledVector(r0n.clone().sub(r0).setY(0).normalize(), 1.05).setY(0)); // 의자 옆으로 한 걸음
  if (Math.abs(dphi) > 0.5) {
    pts.push(r0n);
    for (let phi = a0.phi + sgn * 0.3; sgn * ((a1.phi - sgn * 0.3) - phi) > 0; phi += sgn * 0.1) pts.push(ring(phi));
  }
  const arrive = ring(a1.phi - sgn * 0.2).sub(ring(a1.phi)).setY(0).normalize(); // 도착 쪽(맞는 사람 옆)
  const spot = a1.seat.clone().addScaledVector(arrive, 1.3).setY(0);
  pts.push(spot.clone().addScaledVector(a1.n, 1.5)); // 의자 사이 틈으로 들어온다
  pts.push(spot);
  v.av.head.getWorldPosition(T.a);
  return { pts, spot, face: Math.atan2(T.a.x - spot.x, T.a.z - spot.z) };
}
const reversed = (pts) => pts.slice().reverse();

// opts: speed(유닛/초), step(한 걸음 길이), amp(다리 흔들림), knee(무릎 굽힘), carry(av, 걸음 위상, 세기) 팔 자세, eye(맞는 사람이 쳐다볼 점)
async function walk(st, h, pts, opts = {}) {
  const { av } = h, seg = []; let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = pts[i].distanceTo(pts[i - 1]); seg.push(d); total += d; }
  if (total < 0.01) return;
  const speed = opts.speed || 3.4, step = opts.step || 1.0, A = opts.amp || 0.6, K = opts.knee || 0.95;
  const at = (s, out) => { let k = 0; while (k < seg.length - 1 && s > seg[k]) { s -= seg[k]; k++; } return out.lerpVectors(pts[k], pts[k + 1], seg[k] ? clamp(s / seg[k], 0, 1) : 1); };
  const root = av.root;
  await st.tw.run((total / speed) * 1000, (u) => {
    const s = u * total; at(s, T.a); at(Math.min(total, s + 0.45), T.b);
    root.position.x = T.a.x; root.position.z = T.a.z;
    const dx = T.b.x - T.a.x, dz = T.b.z - T.a.z;
    if (dx * dx + dz * dz > 1e-5) root.rotation.y = aLerp(root.rotation.y, Math.atan2(dx, dz), 0.22);
    const ph = (s * PI) / step, amp = Math.min(1, u / 0.06, (1 - u) / 0.08), sw = Math.sin(ph), cw = Math.cos(ph); // 시작/끝에서는 다리가 부드럽게 멈춘다
    legs(av, -A * sw * amp, K * Math.max(0, cw) * amp, A * sw * amp, K * Math.max(0, -cw) * amp);
    av.walkY = 0.09 * Math.abs(sw) * amp; av.twist = 0.12 * sw * amp; av.tilt = 0.025 * cw * amp;
    if (opts.eye) opts.eye.set(T.a.x, 2.4, T.a.z);
    if (opts.carry) opts.carry(av, ph, amp);
  }, easeInOut);
  legs(av, 0, 0, 0, 0); av.walkY = av.twist = av.tilt = av.headTwist = av.leanBias = 0;
}
const turnTo = (st, h, yaw, ms = 220) => { const y0 = h.av.root.rotation.y; return st.tw.run(ms, (p) => { h.av.root.rotation.y = aLerp(y0, yaw, p); }, easeInOut); };

// 일어나서 맞는 사람 옆까지 / 돌아와서 앉기 (세 시안 공통 골격)
async function approach(st, c, o) {
  c.pending.push(camBack(st, c, 1.25, 800));
  await standUp(st, c.h, o.standMs || 520, o.pop || 0);
  const path = (c.path = buildPath(st, c.h, c.v));
  await walk(st, c.h, path.pts, { ...o.walk, eye: c.eye });
  return path;
}
async function leave(st, c, o) {
  const { h, path } = c, pts = path.pts, n = pts.length;
  await turnTo(st, h, Math.atan2(pts[n - 2].x - path.spot.x, pts[n - 2].z - path.spot.z), 260);
  await walk(st, h, reversed(pts), { ...o.walk, eye: c.eye });
  c.pending.push(camBack(st, c, 1, 700));
  await sitDown(st, h, o.sitMs || 520);
}

// ───────── 방망이 ─────────
// 오른손(손잡이 끝)을 P(루트 기준)에 두고 방망이가 d 방향을 가리키게 한다. 왼손은 조금 위를 잡는다.
function batDir(av, bat, P, d) {
  av.arms.R.desired.copy(P);
  av.arms.L.desired.set(P.x + 0.34, P.y + d.y * 0.3, P.z + d.z * 0.3);
  bat.position.copy(av.armsSnap ? P : av.arms.R.hand.position); bat.quaternion.setFromUnitVectors(UP, d);
  bat.userData.d.copy(d); // 마지막 방향 기억(자세 이어붙이기용)
}
// 세로 휘두름: a = 0 위, π/2 앞, π 아래
const batPose = (av, bat, P, a) => batDir(av, bat, P, T.d.set(0, Math.cos(a), Math.sin(a)));
async function toShoulder(st, c, ms = 360) { // 방망이를 어깨에 걸친다
  const { av } = c.h, P0 = av.arms.R.desired.clone(), d0 = c.bat.userData.d.clone(), tw0 = av.twist, lb0 = av.leanBias;
  const P1 = new Vector3(-0.55, Y0 + 0.95, 0.05), d1 = new Vector3(0, Math.cos(0.25), Math.sin(0.25));
  av.armsSnap = false;
  await st.tw.run(ms, (p) => { batDir(av, c.bat, T.b.lerpVectors(P0, P1, p), T.d.lerpVectors(d0, d1, p).normalize()); av.twist = tw0 * (1 - p); av.leanBias = lb0 * (1 - p); }, easeInOut);
}
const carryShoulder = (c) => (av, ph, amp) => { batPose(av, c.bat, T.b.set(-0.55, Y0 + 0.95, 0.05), 0.25); av.arms.L.desired.set(0.62, Y0 + 0.1, 0.05 + 0.4 * Math.sin(ph) * amp); };

// ───────── 맞는 쪽 반응: 스프링 (맞을 때마다 충격을 받아 흔들리다 가라앉는다) ─────────
function victimRig(st, c) {
  const av = c.v.av, chair = av.chair, y0 = chair.rotation.y;
  const r = (c.vr = { x: 0, vx: 0, y: 0, vy: 0, slump: 0, spin: 0, cspin: 0, y0, entry: null });
  let last = performance.now();
  const n0 = st.tw.list.length;
  st.tw.run(6e5, () => {
    const now = performance.now(), dt = Math.min(0.033, (now - last) / 1000) / st.tw.scale; last = now; // 느린 화면 배율에도 맞춰 흔들린다
    r.vx += (-170 * r.x - 10 * r.vx) * dt; r.x += r.vx * dt;
    r.vy += (-170 * r.y - 10 * r.vy) * dt; r.y += r.vy * dt;
    av.tilt = r.x * 0.5; av.headTwist = -r.x * 0.9 + r.spin;
    av.leanBias = Math.max(0, r.y) * 0.4 + r.slump * 0.4; av.headBias = r.y * 0.8 + r.slump * 0.9;
    chair.rotation.y = y0 + r.x * 0.1 + r.cspin;
  }, lin);
  r.entry = st.tw.list.length > n0 ? st.tw.list[st.tw.list.length - 1] : null; // 끝나면 이 항목을 빼서 남기지 않는다
}
function endRig(st, c) {
  const r = c.vr, av = c.v.av; if (!r) return;
  if (r.entry) { const i = st.tw.list.indexOf(r.entry); if (i >= 0) st.tw.list.splice(i, 1); }
  av.tilt = av.leanBias = av.headBias = av.headTwist = 0; av.chair.rotation.y = r.y0;
}
function impact(st, c, power = 1) {
  st.fx('hit'); st.shake(0.05 + 0.04 * power);
  c.vr.vy += 8 * power; c.vr.vx += c.sign * 6 * power;
  c.nHit = (c.nHit || 0) + 1; if (c.hooks.hit) c.hooks.hit(c.nHit); // 화면 쪽(칩 글자·기절 표시)이 몇 번째 타격인지 알 수 있게
}
async function slump(st, c, hold = 500) { // 마지막으로 맞고 축 처짐 → 천천히 회복
  const r = c.vr;
  await st.tw.run(300, (p) => { r.slump = p; }, easeOut);
  await wait(st, hold);
  await st.tw.run(800, (p) => { r.slump = 1 - p; }, easeInOut);
}

// ───────── 세로 내려치기 (시안 A·B) ─────────
function strikeGeom(c) { // 맞는 사람 머리를 향한 손 위치/각도(때리는 사람 루트 기준)
  const { h, v } = c;
  v.av.head.getWorldPosition(T.c); h.av.root.worldToLocal(T.c);
  const P1 = new Vector3(-0.2, Y0 + 1.05, clamp(T.c.z - 0.95, 0.2, 0.7)); // 맞히는 순간의 손
  const d = T.d.copy(T.c).sub(P1).normalize();
  const aEnd = Math.atan2(d.z, d.y);
  return { P0: new Vector3(-0.15, Y0 + 1.95, -0.1), P1, aRaise: aEnd - 2.75, aEnd };
}
async function raise(st, c, g, ms = 320, over = 0) { // 방망이를 머리 위로 치켜든다 (over: 더 뒤로 젖히는 각)
  const { av } = c.h, p0 = av.arms.R.desired.clone(), a0 = c.a, a1 = g.aRaise - over, lb0 = av.leanBias;
  av.armsSnap = true;
  await st.tw.run(ms, (p) => { const e = easeOut(p); batPose(av, c.bat, T.b.lerpVectors(p0, g.P0, e), lerp(a0, a1, e)); if (over) av.leanBias = lerp(lb0, -0.45 * over, e); }, lin);
  c.a = a1;
}
async function smash(st, c, g, ms = 150, power = 1) { // 내려친다
  const { av } = c.h, a0 = c.a, lb0 = av.leanBias; av.armsSnap = true;
  st.fx('swing');
  await st.tw.run(ms, (p) => { const e = easeIn(p); batPose(av, c.bat, T.b.lerpVectors(g.P0, g.P1, e), lerp(a0, g.aEnd, e)); av.twist = -0.25 * e; av.leanBias = lerp(lb0, 0.12, e); }, lin);
  c.a = g.aEnd; impact(st, c, power);
}

// ───────── 시안 A · 직진 응징 ─────────
// 묵직하게 걸어가서 정확히 3번 내려친다. 방망이를 끌고 가다가 머리 위로 치켜든다.
async function styleA(st, c) {
  const { h } = c;
  const carry = (av, ph, amp) => { // 오른손: 방망이를 아래로 늘어뜨려 끈다 / 왼팔: 걸음에 맞춰 흔든다
    batPose(av, c.bat, T.b.set(-0.62, Y0 + 0.05, 0.2), 2.45);
    av.arms.L.desired.set(0.62, Y0 + 0.1, 0.05 + 0.4 * Math.sin(ph) * amp);
  };
  const path = await approach(st, c, { standMs: 520, walk: { speed: 3.6, carry } });
  await turnTo(st, h, path.face, 240);
  const g = strikeGeom(c); c.a = 2.45;
  await raise(st, c, g, 380); await wait(st, 220);
  for (let k = 0; k < 3; k++) {
    await smash(st, c, g, 150, k === 2 ? 1.6 : 1);
    await wait(st, 140);
    if (k < 2) await raise(st, c, g, 300);
  }
  c.pending.push(slump(st, c, 500));
  await wait(st, 450);
  await toShoulder(st, c, 360);
  await wait(st, 300);
  await leave(st, c, { walk: { speed: 3.6, carry: carryShoulder(c) }, sitMs: 520 });
}

// ───────── 시안 B · 만화 폭주 ─────────
// 💢 하고 벌떡 일어나 씩씩대며 달려가서, 폴짝 뛰어올라 연달아 내려친다. 맞은 쪽은 💫, 때린 쪽은 방방 뛰며 신나게 돌아간다.
const hop = (st, c, ms, hgt = 0.38) => st.tw.run(ms, (p) => { const s = Math.sin(p * PI), av = c.h.av; av.walkY = hgt * s; legs(av, -0.55 * s, 0.95 * s, -0.25 * s, 0.6 * s); }, lin); // 공중에서 다리를 접는다
async function styleB(st, c) {
  const { h, v } = c, { av } = h;
  st.say(h.i, '💢', 1500);
  const stomp = (a, ph, amp) => { // 씩씩대는 걸음: 방망이를 어깨 위에서 까딱, 머리는 도리도리, 몸은 앞으로 숙임
    batPose(a, c.bat, T.b.set(-0.55, Y0 + 0.9, 0.1), 0.3 + 0.4 * Math.sin(ph) * amp);
    a.arms.L.desired.set(0.6, Y0 + 0.1, 0.05 + 0.5 * Math.sin(ph) * amp);
    a.headTwist = 0.3 * Math.sin(ph * 2) * amp; a.leanBias = 0.2 * amp; a.walkY += 0.06 * amp * Math.abs(Math.sin(ph));
  };
  const path = await approach(st, c, { standMs: 360, pop: 0.4, walk: { speed: 5.4, step: 0.8, amp: 0.9, knee: 1.3, carry: stomp } });
  await st.tw.run(160, (p) => { av.leanBias = -0.3 * Math.sin(p * PI); }, lin); // 급정지
  await turnTo(st, h, path.face, 140);
  const g = strikeGeom(c); c.a = 0.3;
  await raise(st, c, g, 300, 0.7); // 한껏 젖힌 채
  await st.tw.run(480, (p) => { const j = Math.sin(p * 90) * 0.035 * (1 - p * 0.3); batPose(av, c.bat, T.b.copy(g.P0).add(T.a.set(j, -j * 0.7, 0)), c.a); av.twist = j * 2; }, lin); // 부들부들
  for (let k = 0; k < 3; k++) {
    if (k) await Promise.all([hop(st, c, 240), raise(st, c, g, 240, 0.4)]); // 폴짝 뛰며 다시 들어올린다
    await smash(st, c, g, 105, [1.1, 1.3, 2][k]);
  }
  st.say(h.i, '😤', 1800); st.say(v.i, '💫', 1800);
  c.pending.push(slump(st, c, 600));
  for (let k = 0; k < 2; k++) { // 신나서 방방
    await st.tw.run(360, (p) => { const s = Math.sin(p * PI); av.walkY = 0.3 * s; legs(av, -0.4 * s, 0.7 * s, -0.4 * s, 0.7 * s); batPose(av, c.bat, T.b.set(-0.3, Y0 + 1.75 + 0.1 * s, 0.1), 0.2 * Math.sin(p * PI * 4)); av.twist = 0; }, lin);
  }
  av.walkY = 0; legs(av, 0, 0, 0, 0);
  await toShoulder(st, c, 300);
  const twirl = (a, ph, amp) => { // 방망이를 빙글빙글 돌리며 깡충깡충
    batPose(a, c.bat, T.b.set(-0.55, Y0 + 0.9, 0.05), ph * 0.7);
    a.arms.L.desired.set(0.6, Y0 + 0.2, 0.05 + 0.4 * Math.sin(ph) * amp); a.walkY += 0.07 * amp * Math.abs(Math.sin(ph));
  };
  await leave(st, c, { walk: { speed: 4.2, step: 0.9, amp: 0.55, knee: 0.8, carry: twirl }, sitMs: 380 });
}

// ───────── 가로 휘두르기 (시안 C): 몸통을 비틀며 방망이를 옆으로 쓸어 친다 ─────────
// φ: 방망이가 수평으로 가리키는 각 (0=정면, +=왼쪽), lead: 손이 방망이보다 얼마나 뒤처지는지, th: 방망이 끝의 높낮이 각
function sideAt(S, phi, lead, th, P, d) {
  const psi = phi - lead, ct = Math.cos(th);
  P.set(S.c0.x + 0.6 * Math.sin(psi), S.c0.y, S.c0.z + 0.6 * Math.cos(psi));
  d.set(Math.sin(phi) * ct, Math.sin(th), Math.cos(phi) * ct);
}
function sideGeom(c) { // 방망이가 맞는 사람 머리를 정확히 지나가는 각(φc)과 높낮이를 찾는다
  const { h, v } = c, S = { c0: new Vector3(0, Y0 + 0.85, 0.05) }, P = new Vector3(), d = new Vector3();
  v.av.head.getWorldPosition(T.c); h.av.root.worldToLocal(T.c);
  const hx = T.c.x, hy = T.c.y, hz = T.c.z; let best = 9;
  for (let phi = -0.9; phi < 1.2; phi += 0.01) {
    sideAt(S, phi, 0.8, 0, P, d);
    const e = (P.x + d.x * 1.05 - hx) ** 2 + (P.z + d.z * 1.05 - hz) ** 2;
    if (e < best) { best = e; S.phiC = phi; }
  }
  sideAt(S, S.phiC, 0.8, 0, P, d);
  S.thC = Math.atan2(hy - P.y, Math.hypot(hx - P.x, hz - P.z));
  return S;
}
// o: back(젖히는 각) wind(와인드업 ms) hold(멈춤 ms) swing(ms) stop(맞는 순간 정지 ms) power through(휘두른 뒤 ms) lean finale
async function sideSwing(st, c, S, o) {
  const { av } = c.h, P = new Vector3(), d = new Vector3(), P0 = av.arms.R.desired.clone(), d0 = c.bat.userData.d.clone();
  const phi0 = S.phiC - o.back, th0 = 0.55, lb0 = av.leanBias, tw0 = av.twist;
  av.armsSnap = true;
  sideAt(S, phi0, -0.2, th0, P, d);
  await st.tw.run(o.wind, (p) => { const e = easeOut(p); batDir(av, c.bat, T.b.lerpVectors(P0, P, e), T.d.lerpVectors(d0, d, e).normalize()); av.twist = lerp(tw0, -0.3 * o.back, e); av.leanBias = lerp(lb0, o.lean, e); }, lin);
  if (o.hold) await wait(st, o.hold);
  st.fx('swing');
  await st.tw.run(o.swing, (u) => { const phi = lerp(phi0, S.phiC, u); sideAt(S, phi, lerp(-0.2, 0.8, u), lerp(th0, S.thC, u), T.b, T.d); batDir(av, c.bat, T.b, T.d); av.twist = -0.3 * (S.phiC - phi); av.leanBias = lerp(o.lean, 0.05, u); }, easeIn);
  if (o.stop) await wait(st, o.stop); // 맞는 순간 화면이 잠깐 멈춘다
  impact(st, c, o.power);
  if (o.finale) {
    const r = c.vr;
    st.say(c.h.i, '홈런!!', 1800);
    c.pending.push(st.tw.run(1000, (p) => { const e = easeOut(p); r.spin = 4 * PI * e; r.cspin = 2 * PI * e; }, lin).then(() => { r.spin = r.cspin = 0; })); // 머리가 팽글팽글, 의자도 한 바퀴
  }
  await st.tw.run(o.through, (u) => { const phi = S.phiC + 0.6 * u; sideAt(S, phi, lerp(0.8, 1.0, u), lerp(S.thC, S.thC - 0.1, u), T.b, T.d); batDir(av, c.bat, T.b, T.d); av.twist = 0.18 * u; }, easeOut);
}

// ───────── 시안 C · 홈런 한 방 ─────────
// 느릿하고 불길하게 걸어가 카메라가 다가오고, 야구 스윙으로 두 번 툭툭 치다가 마지막은 크게 젖혔다 때리는 홈런 한 방 (맞는 순간 화면이 잠깐 멈춤).
async function styleC(st, c) {
  const { h, v } = c, { av } = h;
  const drag = (a, ph, amp) => { // 방망이를 질질 끌며 느릿하게
    batPose(a, c.bat, T.b.set(-0.6, Y0 - 0.15, 0.15), 3.35);
    a.arms.L.desired.set(0.55, Y0, 0.1 + 0.25 * Math.sin(ph) * amp); a.leanBias = 0.12 * amp;
  };
  const path = await approach(st, c, { standMs: 900, walk: { speed: 2.9, step: 1.15, amp: 0.5, knee: 0.8, carry: drag } });
  v.av.head.getWorldPosition(T.a); const headW = T.a.clone();
  const push = camPush(st, c, headW, 0.3, 1200); // 카메라가 맞는 사람 쪽으로 천천히 다가간다
  await turnTo(st, h, path.face, 450);
  await push;
  const S = sideGeom(c);
  av.armsSnap = true;
  await sideSwing(st, c, S, { back: 2.2, wind: 380, hold: 120, swing: 170, stop: 0, power: 1.2, through: 260, lean: -0.1 });
  await wait(st, 160);
  await sideSwing(st, c, S, { back: 2.4, wind: 340, hold: 0, swing: 160, stop: 0, power: 1.5, through: 260, lean: -0.15 });
  await wait(st, 300);
  const push2 = camPush(st, c, headW, 0.2, 900);
  await sideSwing(st, c, S, { back: 3.0, wind: 900, hold: 380, swing: 190, stop: 140, power: 2.4, through: 520, lean: -0.35, finale: true });
  await push2;
  c.pending.push(slump(st, c, 900));
  await wait(st, 700); // 홈런 자세로 잠깐 서 있는다
  await Promise.all([camBack(st, c, 1.25, 1000), toShoulder(st, c, 420)]);
  await wait(st, 250);
  await leave(st, c, { walk: { speed: 3.2, step: 1.1, amp: 0.5, knee: 0.8, carry: carryShoulder(c) }, sitMs: 560 });
}
export const STYLES = { a: styleA, b: styleB, c: styleC };

// ───────── 진입점 ─────────
export async function punch(st, hi, vi, style = 'a', hooks = {}) {
  if (st._punching) return false;
  const h = prep(st, hi), v = prep(st, vi);
  if (!h || !v || hi === vi) { if (h) restore(st, h); if (v) restore(st, v); return false; }
  // 맞는 사람은 앉은 채로 있는다 — 걷기용 준비는 필요 없으니 즉시 원상태로 돌리고 바쁨 표시만 둔다
  restore(st, v); v.av.busy = true; v.av.emoteUntil = Infinity; v.av.lockLook = true;
  st._punching = true;
  const bat = st._bat || (st._bat = makeBat()); bat.userData.d = bat.userData.d || new Vector3(); bat.userData.d.set(0, 1, 0); h.av.root.add(bat); // 때릴 때마다 새로 만들면 지오메트리가 쌓인다: 한 번 만들어 계속 쓴다
  v.av.head.getWorldPosition(T.a);
  h.av.look = T.a.clone(); // 때리는 사람은 맞는 사람의 머리를 본다
  const c = { st, h, v, bat, hooks, a: 2.45, pending: [], sign: 1, eye: new Vector3(h.seat.x, 2.4, h.seat.z) };
  v.av.look = c.eye; // 맞는 사람은 다가오는 사람을 쳐다본다
  try {
    // 맞는 사람 기준으로 때리는 사람이 어느 쪽에 서는지(좌우)를 정해, 반대로 쏠리게 한다
    const path = buildPath(st, h, v); v.av.root.updateWorldMatrix(true, false);
    T.b.copy(path.spot); v.av.root.worldToLocal(T.b); c.sign = T.b.x >= 0 ? 1 : -1;
    victimRig(st, c);
    await (STYLES[style] || styleA)(st, c);
    await Promise.all(c.pending);
  } finally {
    h.av.root.remove(bat); st._punching = false;
    if (c.cam) st.fitCamera(); // 연출 도중 창 크기가 바뀌었어도 지금 크기에 맞는 원래 구도로 (시작 때 저장한 값으로 되돌리면 옛 구도로 돌아간다)
    endRig(st, c);
    restore(st, h);
    v.av.busy = false; v.av.lockLook = false; v.av.emoteUntil = 0; v.av.look = v.look0;
  }
  return true;
}

// ───────── 기절 / 깨어남: 맞은 사람이 다음 핸드를 쉴 때 (핸드가 시작되면 쓰러지고, 그 핸드가 끝나면 깨어난다) ─────────
function starsOf(av) { // 머리 위에서 도는 별 3개 (아바타당 한 번만 만들고, 평소엔 숨긴다)
  if (av.stunFx) return av.stunFx;
  const g = new Group(); g.visible = false; const ms = [];
  for (let k = 0; k < 3; k++) { const m = new Mesh(new THREE.OctahedronGeometry(0.1, 0), mat(0xffd54a, 0.35)); m.material.emissive.set(0xffa000); g.add(m); ms.push(m); }
  av.root.add(g); // 머리가 아니라 몸 쪽에 붙여, 쓰러져도 별이 머리 '위'(세계 기준)에서 돈다
  return (av.stunFx = { g, ms, entry: null });
}
export async function stun(st, i) {
  const s = st.seats[i], av = s && s.avatar;
  if (!av || av.busy || av.stunned || !s.a) return false;
  av.busy = av.stunned = true; av.emoteUntil = Infinity; av.lockLook = true;
  const tok = (av.stunTok = (av.stunTok || 0) + 1); // wake 가 이 값을 올리면 아직 남은 아래 트윈은 아무것도 하지 않는다
  av.stunFirst = av.firstPerson; av.setFirstPerson(false); // 내가 기절하면 내 몸도 보여야 한다
  const fx = starsOf(av); fx.g.visible = true;
  av.blinkT = 1e6; av.nextBlink = 1e9; av.setMood('sad'); // 눈 감김 (blinkT 가 남아 있는 동안 눈을 숨긴다. nextBlink 도 미뤄 두지 않으면 곧 깜빡임 코드가 blinkT 를 0.12 로 되돌려 눈이 떠진다)
  st.fx('knock'); st.shake(0.06);
  const n0 = st.tw.list.length;
  st.tw.run(6e5, () => { av.head.getWorldPosition(T.a); av.root.worldToLocal(T.a); fx.g.position.set(T.a.x, T.a.y + 0.85, T.a.z); const t = performance.now() / 380; fx.ms.forEach((m, k) => { const a = t + k * 2.094; m.position.set(Math.cos(a) * 0.55, Math.sin(t * 1.3 + k) * 0.05, Math.sin(a) * 0.55); m.rotation.y = t * 2; }); }, lin); // 별이 빙글빙글 (깨어날 때까지)
  fx.entry = st.tw.list.length > n0 ? st.tw.list[st.tw.list.length - 1] : null;
  const r0 = av.arms.R.desired.clone(), l0 = av.arms.L.desired.clone(), rEnd = new Vector3(-0.62, TABLE_Y + 0.2, 1.45), lEnd = new Vector3(0.62, TABLE_Y + 0.2, 1.45);
  await st.tw.run(200, (p) => { if (av.stunTok !== tok) return; av.headBias = -0.55 * p; av.leanBias = -0.1 * p; }, easeOut); // 퍽! 머리가 뒤로 꺾인다
  await st.tw.run(620, (p) => { // 앞으로 푹 쓰러지며 팔이 탁자 위로 늘어진다
    if (av.stunTok !== tok) return;
    av.leanBias = lerp(-0.1, 0.95, p); av.headBias = lerp(-0.55, 0.8, p); av.tilt = 0.08 * p;
    av.arms.R.desired.lerpVectors(r0, rEnd, p); av.arms.L.desired.lerpVectors(l0, lEnd, p);
  }, easeIn);
  st.fx('knock'); st.shake(0.03);
  return true;
}
export async function wake(st, i) {
  const s = st.seats[i], av = s && s.avatar;
  if (!av || !av.stunned) return false;
  av.stunTok = (av.stunTok || 0) + 1; // 쓰러지는 중이던 트윈을 멈춘다
  const fx = starsOf(av), lb0 = av.leanBias, hb0 = av.headBias, tl0 = av.tilt;
  av.blinkT = 0; av.nextBlink = 1.5; av.setMood('neutral'); // 눈을 뜬다
  await st.tw.run(700, (p) => { const e = easeInOut(p); av.leanBias = lb0 * (1 - e); av.headBias = hb0 * (1 - e); av.tilt = tl0 * (1 - e); av.headTwist = Math.sin(p * PI * 4) * 0.5 * (1 - p); }, lin); // 머리를 들고 도리도리
  if (fx.entry) { const k = st.tw.list.indexOf(fx.entry); if (k >= 0) st.tw.list.splice(k, 1); fx.entry = null; }
  fx.g.visible = false;
  av.leanBias = av.headBias = av.headTwist = av.tilt = 0;
  av.emoteUntil = 0; av.release(); av.lockLook = false;
  av.setFirstPerson(!!av.stunFirst); av.stunned = av.busy = false;
  return true;
}

export function attachPunch(Stage) {
  Stage.prototype.punch = function (hi, vi, style, hooks) { return punch(this, hi, vi, style, hooks); };
  Stage.prototype.stun = function (i) { return stun(this, i); };
  Stage.prototype.wake = function (i) { return wake(this, i); };
}
