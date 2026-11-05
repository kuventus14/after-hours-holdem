// 로비 히어로(ROYAL REVEAL): 카드가 날아와 뒤집히며 족보가 완성되고, 금빛이 터진다.
// 이 파일은 화면 장식뿐이다 — 서버와 통신하지 않고, 로비가 숨겨지거나 탭이 가려지면 멈추며,
// '효과 꺼짐' / 기기의 움직임 줄이기에서는 완성된 로열 플러시 정지 화면만 보여 준다.
const $ = (s) => document.querySelector(s);
const lobby = $('#lobby'), royal = $('#royal'), stage = $('#royalStage'), fan = $('#royalFan'), stamp = $('#royalStamp'), sweep = $('#royalSweep'), cv = $('.royal-fx');
const ctx = cv.getContext('2d'), reduce = matchMedia('(prefers-reduced-motion: reduce)');
// motion.js 가 body.dataset.motion 을 정하지만 이 파일이 먼저 실행될 수 있어서, 없으면 같은 기준으로 직접 계산한다
const motionOn = () => document.body.dataset.motion ? document.body.dataset.motion === 'on' : !(reduce.matches || (() => { try { return localStorage.getItem('holdem_motion') === 'off'; } catch { return false; } })());
const alive = () => motionOn() && !lobby.hidden && !document.hidden;

// ── 카드 ──
const RED = { '♥': 1, '♦': 1 };
const HANDS = [
  { en: 'ROYAL FLUSH', sub: 'THE PERFECT HAND', ko: '로열 플러시', cards: ['A♠', 'K♠', 'Q♠', 'J♠', '10♠'] },
  { en: 'FOUR OF A KIND', sub: 'QUADS · FOUR ACES', ko: '포카드', cards: ['A♠', 'A♥', 'A♦', 'A♣', 'K♠'] },
  { en: 'STRAIGHT FLUSH', sub: 'FIVE IN SEQUENCE', ko: '스트레이트 플러시', cards: ['9♥', '8♥', '7♥', '6♥', '5♥'] },
];
const make = (code) => {
  const rk = code.slice(0, -1), s = code.slice(-1), el = document.createElement('div');
  el.className = 'royal-card';
  el.innerHTML = `<div class="in"><div class="face ${RED[s] ? 'red' : ''}"><div class="r">${rk}<s>${s}</s></div><div class="big">${s}</div><div class="r b">${rk}<s>${s}</s></div></div><div class="back"></div></div>`;
  return el;
};
const pose = (i, n, cw, dy = 0) => { const k = i - (n - 1) / 2; return `translate(${k * cw * .66}px,${k * k * cw * .08 + dy}px) rotate(${k * 8.5}deg)`; };
// 큰 글씨는 어느 언어에서나 영어 족보 이름(글자가 하나씩 떠오른다), 작은 글씨는 고른 언어의 족보 이름(영어일 땐 한 줄 소개)
let curHand = HANDS[0];
const subText = (h) => (window.I18N && window.I18N.lang !== 'en' ? window.I18N.tr(h.ko) : h.sub);
const setText = (h) => {
  curHand = h;
  $('#royalSub').textContent = subText(h);
  $('#royalName').innerHTML = [...h.en].map((c, i) => `<i style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</i>`).join('');
  royal.setAttribute('aria-label', `카드 다섯 장이 펼쳐진 장면: ${h.ko}`); // 장면이 바뀔 때마다 스크린리더용 이름도 맞춘다 (i18n.js 가 언어에 맞게 바꿈)
};
document.addEventListener('holdem:lang', () => { $('#royalSub').textContent = subText(curHand); });

// ── 금빛 입자 (불씨 + 족보 완성 때 터지는 폭죽) ──
// 입자마다 shadowBlur 를 걸면 매 프레임 번짐 연산이 쌓여 크게 느려진다(측정: 0.6fps → 18fps).
// 그래서 빛 번짐을 한 번만 미리 그려 두고 drawImage 로 찍는다. 캔버스는 레티나여도 1배 해상도면 충분하다(번지는 빛이라서).
let W = 1, H = 1, running = false;
const dpr = 1, parts = [];
const sprite = Object.fromEntries(['#efd095', '#ffe8b5', '#dfc18c', '#fff4d8', '#7cedd4'].map((c) => { const k = document.createElement('canvas'); k.width = k.height = 32; const g = k.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, '#fffaf0'); gr.addColorStop(.3, c); gr.addColorStop(1, 'transparent'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return [c, k]; }));
const size = () => { const r = lobby.getBoundingClientRect(); W = cv.width = Math.max(1, Math.round(r.width)); H = cv.height = Math.max(1, Math.round(r.height)); };
new ResizeObserver(size).observe(lobby); size();
const ember = () => ({ x: Math.random() * W, y: H * (.7 + Math.random() * .4), vx: (Math.random() - .5) * .3 * dpr, vy: -(.25 + Math.random() * .6) * dpr, life: 0, max: 380 + Math.random() * 420, r: .8 + Math.random() * 1.7, c: '#efd095', g: 0, amb: 1 });
const burst = (x, y, n = 100) => { if (lite || lobby.hidden) return; for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (2 + Math.random() * 7.5) * dpr; parts.push({ x: x * dpr, y: y * dpr, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2.5 * dpr, life: 0, max: 55 + Math.random() * 55, r: 1 + Math.random() * 2.8, c: ['#ffe8b5', '#dfc18c', '#fff4d8', '#7cedd4'][i % 4], g: .13 * dpr }); } };
for (let i = 0, n = innerWidth < 700 ? 16 : 30; i < n; i++) { const e = ember(); e.life = Math.random() * e.max; parts.push(e); }

// ── 마우스(또는 자동으로 천천히) 따라 기우는 시차 ──
const chips = [...document.querySelectorAll('.royal-chip')];
let tx = 0, ty = 0, px = 0, py = 0, hasPtr = false;
addEventListener('pointermove', (e) => { hasPtr = true; tx = (e.clientX / innerWidth - .5) * 2; ty = (e.clientY / innerHeight - .5) * 2; }, { passive: true });

// 가벼운 모드: 프레임이 계속 느리면(약 22fps 미만) 큰 반투명 층·입자·3D 기울기를 끄고 카드 연출만 남긴다.
// (GPU 없이 그리는 환경에서는 이런 층 겹침만으로 프레임이 크게 떨어진다 — 측정으로 확인함)
let lite = false, lastT = 0, warmEnd = 0, slow = 0;
try { lite = sessionStorage.getItem('royal_lite') === '1'; } catch {}
const goLite = () => {
  lite = true; lobby.classList.add('lite'); parts.length = 0; ctx.clearRect(0, 0, W, H);
  stage.style.transform = ''; chips.forEach((c) => { c.style.transform = ''; });
  try { sessionStorage.setItem('royal_lite', '1'); } catch {}
};
function frame(t) {
  if (!alive() || lite) { running = false; ctx.clearRect(0, 0, W, H); lastT = 0; return; }
  const dt = t - lastT; lastT = t;
  if (!warmEnd) warmEnd = t + 1500; // 로딩 직후 1.5초는 재지 않는다 (스크립트·글꼴 로딩으로 잠깐 느린 것을 오판하지 않게)
  if (t > warmEnd && dt > 0 && dt < 500) { slow = dt > 45 ? slow + 1 : Math.max(0, slow - 1); if (slow > 30) { goLite(); return; } } // 탭을 다녀온 큰 간격은 무시
  ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'lighter';
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life++; p.vy += p.g; p.x += p.vx; p.y += p.vy;
    const k = p.life / p.max;
    if (k >= 1 || p.y < -20) { if (p.amb) Object.assign(p, ember()); else parts.splice(i, 1); continue; }
    ctx.globalAlpha = p.amb ? Math.sin(k * Math.PI) * .55 : 1 - k;
    const d = p.r * 5; ctx.drawImage(sprite[p.c], p.x - d / 2, p.y - d / 2, d, d);
  }
  const ax = hasPtr ? tx : Math.sin(t / 2600) * .55, ay = hasPtr ? ty : Math.cos(t / 3300) * .35;
  px += (ax - px) * .06; py += (ay - py) * .06;
  stage.style.transform = `rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 8).toFixed(2)}deg)`;
  chips.forEach((c, i) => { const d = [1.4, 2.2, 1, 1.8][i % 4]; c.style.transform = `translate3d(${(-px * 22 * d).toFixed(1)}px,${(-py * 14 * d).toFixed(1)}px,0)`; });
  requestAnimationFrame(frame);
}
const kick = () => { if (!running && alive()) { running = true; requestAnimationFrame(frame); } };

// ── 연출 ──
let gen = 0; const ABORT = Symbol('abort');
async function play(h, ck, sleep) {
  fan.innerHTML = ''; const els = h.cards.map(make); els.forEach((e) => fan.appendChild(e));
  const n = els.length, cw = els[0].offsetWidth;
  const from = `translate(${cw * 3.2}px,${-cw * .15}px) rotate(26deg) scale(.5)`;
  await Promise.all(els.map((e, i) => e.animate([{ transform: from, opacity: 0 }, { opacity: 1, offset: .25 }, { transform: pose(i, n, cw), opacity: 1 }], { duration: 780, delay: i * 120, easing: 'cubic-bezier(.2,.9,.25,1.08)', fill: 'forwards' }).finished)); ck();
  await sleep(260);
  for (let i = 0; i < n; i++) {
    els[i].animate([{ transform: pose(i, n, cw) }, { transform: pose(i, n, cw, -cw * .28) }, { transform: pose(i, n, cw) }], { duration: 640, easing: 'ease-in-out', fill: 'forwards' });
    els[i].querySelector('.in').animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], { duration: 640, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
    await sleep(170);
  }
  await sleep(520);
  els.forEach((e) => e.classList.add('hit'));
  const L = lobby.getBoundingClientRect(), r = stage.getBoundingClientRect(); burst(r.left - L.left + r.width / 2, r.top - L.top + r.height * .56);
  sweep.style.visibility = 'visible'; sweep.animate([{ transform: 'translateX(-130%)' }, { transform: 'translateX(130%)' }], { duration: 1100, easing: 'ease-out' }).finished.then(() => { sweep.style.visibility = ''; });
  stage.animate([{ translate: '0 0' }, { translate: '-3px 2px' }, { translate: '3px -2px' }, { translate: '0 0' }], { duration: 280 });
  setText(h); stamp.classList.remove('on'); void stamp.offsetWidth; stamp.classList.add('on');
  await sleep(3100);
  await Promise.all(els.map((e, i) => e.animate([{ transform: pose(i, n, cw), opacity: 1 }, { transform: pose(i, n, cw, -cw * .7) + ' scale(.92)', opacity: 0 }], { duration: 540, delay: i * 60, easing: 'ease-in', fill: 'forwards' }).finished)); ck();
}
function direct() {
  fan.innerHTML = ''; stamp.classList.remove('on'); // 껐다 켜거나 크기가 바뀌어 다시 시작할 때 이전 판의 카드·스탬프가 남아 재생되지 않게
  const my = ++gen, ck = () => { if (my !== gen) throw ABORT; };
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms)).then(ck);
  (async () => {
    try {
      await sleep(1200);
      for (let i = 0; ; i++) { while (!alive()) await sleep(400); await play(HANDS[i % HANDS.length], ck, sleep); }
    } catch (e) { if (e !== ABORT) console.warn('로비 연출 중단:', e); }
  })();
}

// 효과 꺼짐/움직임 줄이기: 완성된 로열 플러시를 정지 화면으로 보여 준다 (숨겨 둔 채 끝나는 일이 없게)
function layoutStatic() {
  const els = [...fan.children], n = els.length; if (!n) return;
  const cw = els[0].offsetWidth; if (!cw) return; // 로비가 숨겨진 동안은 폭을 알 수 없다 → 다시 보일 때 배치
  els.forEach((e, i) => { e.style.transform = pose(i, n, cw); });
}
function renderStatic() {
  gen++; parts.length = 0; ctx.clearRect(0, 0, W, H); stage.style.transform = ''; chips.forEach((c) => { c.style.transform = ''; });
  stamp.classList.remove('on'); fan.innerHTML = ''; HANDS[0].cards.map(make).forEach((e) => { e.style.opacity = 1; e.classList.add('hit'); e.querySelector('.in').style.transform = 'none'; fan.appendChild(e); });
  setText(HANDS[0]); royal.classList.add('static'); layoutStatic();
}
let mode = null;
function sync() {
  const on = motionOn(); if (on === mode) return; mode = on; // 상태가 그대로면 연출을 다시 시작하지 않는다
  if (!on) return renderStatic();
  royal.classList.remove('static');
  if (!parts.some((p) => p.amb)) for (let i = 0, n = innerWidth < 700 ? 16 : 30; i < n; i++) { const e = ember(); e.life = Math.random() * e.max; parts.push(e); }
  direct(); kick();
}
document.addEventListener('holdem:motion-preference', sync);
document.addEventListener('visibilitychange', kick);
new MutationObserver(() => { kick(); if (royal.classList.contains('static')) layoutStatic(); }).observe(lobby, { attributes: true, attributeFilter: ['hidden'] });
let lastH = 0;
new ResizeObserver(() => {
  const h = stage.offsetHeight;
  if (royal.classList.contains('static')) layoutStatic();
  else if (lastH && Math.abs(h - lastH) > 24 && alive()) direct(); // 한 판 도중 크기가 바뀌면 배치가 어긋나므로 처음부터
  lastH = h;
}).observe(stage);
if (lite) lobby.classList.add('lite');
sync();
