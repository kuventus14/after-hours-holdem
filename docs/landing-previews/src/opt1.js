(() => {
const $ = s => document.querySelector(s), wait = ms => new Promise(r => setTimeout(r, ms));
const fan = $('#fan'), stage = $('#stage'), stamp = $('#stamp'), sweep = $('#sweep'), cv = $('#fx'), ctx = cv.getContext('2d');
let W, H, dpr; const size = () => { dpr = Math.min(devicePixelRatio || 1, 2); W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr; }; addEventListener('resize', size); size();
const parts = [];
const ember = () => ({ x: Math.random() * W, y: H * (0.7 + Math.random() * .4), vx: (Math.random() - .5) * .3 * dpr, vy: -(.25 + Math.random() * .6) * dpr, life: 0, max: 380 + Math.random() * 420, r: (.8 + Math.random() * 1.7) * dpr, c: '#efd095', g: 0, amb: 1 });
for (let i = 0; i < 48; i++) { const e = ember(); e.life = Math.random() * e.max; parts.push(e); }
function burst(x, y, n = 150) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = (2 + Math.random() * 7.5) * dpr; parts.push({ x: x * dpr, y: y * dpr, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2.5 * dpr, life: 0, max: 55 + Math.random() * 55, r: (1 + Math.random() * 2.8) * dpr, c: ['#ffe8b5', '#dfc18c', '#fff4d8', '#7cedd4'][i % 4], g: .13 * dpr }); } }
(function tick() { ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'lighter'; for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life++; p.vy += p.g; p.x += p.vx; p.y += p.vy; const t = p.life / p.max; if (t >= 1 || p.y < -20) { if (p.amb) Object.assign(p, ember()); else parts.splice(i, 1); continue; } ctx.globalAlpha = p.amb ? Math.sin(t * Math.PI) * .5 : 1 - t; ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 9 * dpr; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); } requestAnimationFrame(tick); })();

const RED = { '♥': 1, '♦': 1 };
const make = code => { const rk = code.slice(0, -1), s = code.slice(-1), el = document.createElement('div'); el.className = 'card'; el.innerHTML = `<div class="in"><div class="face ${RED[s] ? 'red' : ''}"><div class="r">${rk}<s>${s}</s></div><div class="big">${s}</div><div class="r b">${rk}<s>${s}</s></div></div><div class="back"></div></div>`; return el; };
const HANDS = [
  { en: 'ROYAL FLUSH', ko: '로열 플러시', cards: ['A♠', 'K♠', 'Q♠', 'J♠', '10♠'] },
  { en: 'FOUR OF A KIND', ko: '포카드', cards: ['A♠', 'A♥', 'A♦', 'A♣', 'K♠'] },
  { en: 'STRAIGHT FLUSH', ko: '스트레이트 플러시', cards: ['9♥', '8♥', '7♥', '6♥', '5♥'] },
];
async function play(h) {
  fan.innerHTML = ''; const els = h.cards.map(make); els.forEach(e => fan.appendChild(e));
  const n = els.length, cw = els[0].offsetWidth;
  const pose = (i, dy = 0) => { const k = i - (n - 1) / 2; return `translate(${k * cw * .66}px,${k * k * cw * .08 + dy}px) rotate(${k * 8.5}deg)`; };
  const from = `translate(${cw * 3.2}px,${-cw * .15}px) rotate(26deg) scale(.5)`;
  await Promise.all(els.map((e, i) => e.animate([{ transform: from, opacity: 0 }, { opacity: 1, offset: .25 }, { transform: pose(i), opacity: 1 }], { duration: 780, delay: i * 120, easing: 'cubic-bezier(.2,.9,.25,1.08)', fill: 'forwards' }).finished));
  await wait(260);
  for (let i = 0; i < n; i++) {
    els[i].animate([{ transform: pose(i) }, { transform: pose(i, -cw * .28) }, { transform: pose(i) }], { duration: 640, easing: 'ease-in-out', fill: 'forwards' });
    els[i].querySelector('.in').animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], { duration: 640, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
    await wait(170);
  }
  await wait(520);
  els.forEach(e => e.classList.add('hit'));
  const r = stage.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height * .56);
  sweep.animate([{ transform: 'translateX(-130%)' }, { transform: 'translateX(130%)' }], { duration: 1100, easing: 'ease-out' });
  stage.animate([{ translate: '0 0' }, { translate: '-3px 2px' }, { translate: '3px -2px' }, { translate: '0 0' }], { duration: 280 });
  $('#stampEn').textContent = h.en; $('#stampKo').textContent = h.ko; stamp.classList.remove('on'); void stamp.offsetWidth; stamp.classList.add('on');
  await wait(3100);
  await Promise.all(els.map((e, i) => e.animate([{ transform: pose(i), opacity: 1 }, { transform: pose(i, -cw * .7) + ' scale(.92)', opacity: 0 }], { duration: 540, delay: i * 60, easing: 'ease-in', fill: 'forwards' }).finished));
}
(async () => { await wait(1300); for (let i = 0; ; i++) await play(HANDS[i % HANDS.length]); })();
// 마우스(또는 자동) 시차
const chips = [...document.querySelectorAll('.chip')]; let tx = 0, ty = 0, px = 0, py = 0, hasPtr = false;
addEventListener('pointermove', e => { hasPtr = true; tx = (e.clientX / innerWidth - .5) * 2; ty = (e.clientY / innerHeight - .5) * 2; });
(function loop(t) { const ax = hasPtr ? tx : Math.sin(t / 2600) * .55, ay = hasPtr ? ty : Math.cos(t / 3300) * .35; px += (ax - px) * .06; py += (ay - py) * .06;
  stage.style.transform = `rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 8).toFixed(2)}deg)`;
  chips.forEach(c => { const d = +c.dataset.d; c.style.transform = `translate3d(${(-px * 22 * d).toFixed(1)}px,${(-py * 14 * d).toFixed(1)}px,0)`; });
  requestAnimationFrame(loop); })(0);
})();
