(() => {
const $ = s => document.querySelector(s), wait = ms => new Promise(r => setTimeout(r, ms)), rnd = a => a[Math.floor(Math.random() * a.length)];
const live = $('#live'), seatsEl = $('#seats'), fly = $('#fly'), board = $('#board'), potv = $('#potv'), pot = $('#pot'), cv = $('#fx'), ctx = cv.getContext('2d');
let W, H, dpr; const size = () => { dpr = Math.min(devicePixelRatio || 1, 2); W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr; }; addEventListener('resize', size); size();
const parts = [];
const ember = () => ({ x: Math.random() * W, y: H * (.7 + Math.random() * .4), vx: (Math.random() - .5) * .3 * dpr, vy: -(.25 + Math.random() * .6) * dpr, life: 0, max: 380 + Math.random() * 420, r: (.8 + Math.random() * 1.6) * dpr, c: '#efd095', g: 0, amb: 1 });
for (let i = 0; i < 40; i++) { const e = ember(); e.life = Math.random() * e.max; parts.push(e); }
const burst = (x, y, n = 120) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = (2 + Math.random() * 6.5) * dpr; parts.push({ x: x * dpr, y: y * dpr, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3 * dpr, life: 0, max: 50 + Math.random() * 50, r: (1 + Math.random() * 2.6) * dpr, c: ['#ffe8b5', '#dfc18c', '#fff4d8', '#7cedd4'][i % 4], g: .14 * dpr }); } };
(function tick() { ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'lighter'; for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life++; p.vy += p.g; p.x += p.vx; p.y += p.vy; const t = p.life / p.max; if (t >= 1 || p.y < -20) { if (p.amb) Object.assign(p, ember()); else parts.splice(i, 1); continue; } ctx.globalAlpha = p.amb ? Math.sin(t * Math.PI) * .5 : 1 - t; ctx.fillStyle = p.c; ctx.shadowColor = p.c; ctx.shadowBlur = 9 * dpr; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); } requestAnimationFrame(tick); })();

const SEAT = [
  { n: '민영 (나)', x: 50, y: 95, col: '#c3a778', hair: '#2b2320', skin: '#e9c9a4', me: 1 },
  { n: '서연', x: 11, y: 76, col: '#3a6f6b', hair: '#6b4a2f', skin: '#e9c9a4' },
  { n: '민준', x: 24, y: 38, col: '#6a5a8a', hair: '#222', skin: '#d9b08a' },
  { n: '도윤', x: 76, y: 38, col: '#8a5a4a', hair: '#caa86b', skin: '#e9c9a4' },
  { n: '하은', x: 89, y: 76, col: '#4a7a9a', hair: '#a33', skin: '#f0d3b3' },
];
const seats = SEAT.map((s, i) => { const el = document.createElement('div'); el.className = 'seat' + (s.me ? ' me' : ''); el.style.left = s.x + '%'; el.style.top = s.y + '%';
  el.innerHTML = `<div class="say"></div><div class="av"><i class="body" style="--col:${s.col}"></i><i class="head" style="--skin:${s.skin}"></i><i class="hair" style="--hair:${s.hair}"></i></div><div class="plate"><div class="nm">${s.n}</div><div class="ch">10,000</div><div class="act"></div></div><div class="hole"><i class="mc"></i><i class="mc"></i></div>`;
  seatsEl.appendChild(el); return { el, say: el.querySelector('.say'), ch: el.querySelector('.ch'), act: el.querySelector('.act'), mc: [...el.querySelectorAll('.mc')], stack: 10000 }; });
const P = i => { const r = live.getBoundingClientRect(); return { x: r.width * SEAT[i].x / 100, y: r.height * (SEAT[i].y - 6) / 100 }; };
const potPos = () => { const r = live.getBoundingClientRect(); return { x: r.width / 2, y: r.height * .44 }; };
const dealerPos = () => { const r = live.getBoundingClientRect(); return { x: r.width / 2, y: r.height * .14 }; };
let potVal = 0; const setPot = v => { const from = potVal; potVal = v; pot.classList.remove('bump'); void pot.offsetWidth; pot.classList.add('bump'); const t0 = performance.now(); (function st(t) { const k = Math.min(1, (t - t0) / 500); potv.textContent = Math.round(from + (v - from) * k).toLocaleString('ko-KR'); if (k < 1) requestAnimationFrame(st); })(t0); };
const say = (i, t, ms = 1300, chat = false) => { const e = seats[i].say; e.textContent = t; e.className = 'say on' + (chat ? ' chat' : ''); setTimeout(() => e.classList.remove('on'), ms); };
const setStack = (i, v) => { seats[i].stack = v; seats[i].ch.textContent = v.toLocaleString('ko-KR'); };
const coins = (i, n, gold) => { const a = P(i), b = potPos(); for (let k = 0; k < n; k++) { const c = document.createElement('i'); c.className = 'coin' + (gold ? ' g' : ''); fly.appendChild(c); const dx = b.x - a.x + (Math.random() - .5) * 26, dy = b.y - a.y + (Math.random() - .5) * 14;
  c.animate([{ transform: `translate(${a.x}px,${a.y}px) scale(.6)`, opacity: 0 }, { transform: `translate(${a.x + dx * .5}px,${a.y + dy * .5 - 34}px) scale(1.1)`, opacity: 1, offset: .5 }, { transform: `translate(${b.x + dx * .1}px,${b.y + dy * .05}px) scale(.8)`, opacity: .9 }], { duration: 620 + k * 40, delay: k * 70, easing: 'cubic-bezier(.3,.7,.3,1)' }).finished.then(() => c.remove()); } };
const RED = { '♥': 1, '♦': 1 }, SU = ['♠', '♥', '♦', '♣'], RK = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
const rcard = () => RK[Math.floor(Math.random() * RK.length)] + rnd(SU);
const setCard = (el, code) => { const s = code.slice(-1); el.textContent = code; el.classList.toggle('red', !!RED[s]); };
async function dealAll() { const d = dealerPos();
  for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) { const t = P(i), f = document.createElement('i'); f.className = 'fc'; fly.appendChild(f);
    f.animate([{ transform: `translate(${d.x}px,${d.y}px) rotate(0) scale(.7)`, opacity: 0 }, { opacity: 1, offset: .2 }, { transform: `translate(${t.x + (r ? 8 : -8)}px,${t.y + 20}px) rotate(${r ? 14 : -14}deg) scale(1)`, opacity: 1 }], { duration: 480, easing: 'cubic-bezier(.2,.8,.3,1)' }).finished.then(() => { f.remove(); seats[i].mc[r].classList.add('on'); });
    await wait(95); }
  await wait(450); }
async function flip(code, k) { const bc = board.children[k]; bc.querySelector('.f').className = 'f' + (RED[code.slice(-1)] ? ' red' : ''); bc.querySelector('.f').textContent = code; bc.style.opacity = 1;
  bc.animate([{ transform: 'translateY(-30px) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'ease-out', fill: 'forwards' });
  bc.querySelector('.in').animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0)' }], { duration: 600, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }); }
async function bet(i, label, amt, nCoins = 3, gold = false) { say(i, label, 1100); seats[i].act.textContent = label; coins(i, nCoins, gold); setStack(i, Math.max(0, seats[i].stack - amt)); setPot(potVal + amt); await wait(900); }
const LINES = ['아 짜증나', '굿 샷!', '이게 되네', 'ㅋㅋ 콜', '한 판만 더!', '심장 아파', '대박이다'];
let hn = 0;
async function hand() {
  hn++; $('#handn').textContent = `핸드 #${hn}`; potVal = 0; potv.textContent = '0';
  seats.forEach((s, i) => { s.el.classList.remove('win', 'fold'); s.act.textContent = ''; s.mc.forEach(m => { m.className = 'mc'; m.textContent = ''; }); setStack(i, 10000); });
  board.innerHTML = Array.from({ length: 5 }, () => '<div class="bc"><div class="in"><div class="f"></div><div class="b"></div></div></div>').join('');
  await dealAll();
  const me = [rcard(), rcard()]; me.forEach((c, k) => { seats[0].mc[k].classList.add('up'); setCard(seats[0].mc[k], c); });
  const alive = [0, 1, 2, 3, 4], foldOne = i => { seats[i].el.classList.add('fold'); seats[i].act.textContent = '폴드'; say(i, '폴드', 900); alive.splice(alive.indexOf(i), 1); };
  await bet(2, '콜 200', 200, 2); await bet(3, '레이즈 600', 600, 4); foldOne(4); await wait(500); await bet(0, '콜 600', 600, 3); foldOne(1); await wait(500);
  const bd = Array.from({ length: 5 }, rcard);
  for (let k = 0; k < 3; k++) { flip(bd[k], k); await wait(260); } await wait(700);
  say(rnd(alive), rnd(LINES), 1900, true); await wait(900);
  await bet(3, '벳 1,200', 1200, 4); await bet(0, '레이즈 3,000', 3000, 5, true); foldOne(2); await wait(400);
  flip(bd[3], 3); await wait(1100); flip(bd[4], 4); await wait(1000);
  await bet(3, '올인!', 5600, 8, true); await bet(0, '올인!', 5600, 8, true);
  alive.forEach(i => { if (i) { seats[i].mc.forEach(m => { m.classList.add('up'); setCard(m, rcard()); }); } });
  await wait(900);
  const w = rnd(alive); seats[w].el.classList.add('win'); [...board.children].forEach(b => b.classList.add('hit')); const pos = P(w);
  say(w, rnd(['굿 샷!', '이게 되네', '대박이다', 'ㅎㅎ 감사']), 2100, true);
  const fl = document.createElement('div'); fl.className = 'float'; fl.textContent = `+${(potVal).toLocaleString('ko-KR')}`; fly.appendChild(fl);
  fl.animate([{ transform: `translate(${pos.x - 36}px,${pos.y + 30}px) scale(.6)`, opacity: 0 }, { opacity: 1, offset: .2 }, { transform: `translate(${pos.x - 36}px,${pos.y - 40}px) scale(1.1)`, opacity: 0 }], { duration: 2000, easing: 'ease-out' }).finished.then(() => fl.remove());
  const r = live.getBoundingClientRect(); burst(r.left + pos.x, r.top + pos.y + 30); setStack(w, seats[w].stack + potVal);
  const loser = rnd(alive.filter(i => i !== w)); if (loser !== undefined) setTimeout(() => say(loser, 'ㅠㅠ', 1500, true), 700);
  await wait(3300);
}
(async () => { await wait(1200); for (;;) await hand(); })();
})();
