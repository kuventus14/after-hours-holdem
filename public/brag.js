// 카드 자랑하기 — 다 폴드해서 이긴 사람의 선택창(8초)과, 모두의 화면 가운데에서 도는 "과연 카드가 무엇이었을까요?" 연출(10초 안짝).
// 서버가 진실이다: S.brag{until, winner, used} 와 이벤트 {k:'brag', i, cards, show, at}. index.html 이 동적 import 하므로 이 파일이 깨져도 게임은 그대로 돈다.
// 연출은 DOM + Web Animations 만 쓴다(요소 약 50개, transform/opacity 만, 큰 블러·그림자 없음). 시각표 하나(TL)로 화면과 소리가 같이 움직인다.
const $ = (s) => document.querySelector(s);
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const rank = (c) => (c[0] === 'T' ? '10' : c[0]);
const label = (c) => rank(c) + SUIT[c[1]];
const isRed = (c) => c[1] === 'h' || c[1] === 'd';
// 시각표(ms): R = 카드가 공개되는 순간, end = 사라지기 시작하는 시각 (+0.5초 뒤 끝). 두 장 9.5초, 한 장 6.9초 → 모두 10초 안
const TL = { 2: { R: [4200, 6700], end: 9000 }, 1: { R: [4200], end: 6400 } };
let api, box, ov, last = null, seen = 0, inited = false, cd = 0, dismissed = -1;

const CSS = `
.bragbox{max-width:94%;text-align:center;background:#241c0eee;border:1px solid #c9a35a;color:#ffe9bd;border-radius:12px;padding:8px 12px;font-size:12px;line-height:1.45;pointer-events:auto}
.bragbox b{display:block;font-size:14px;color:#fff}.bragbox .bgbb{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:6px}
.bragbox button{border:1px solid #c9a35a;border-radius:9px;background:#3a2c12;color:#ffe9bd;font-weight:800;padding:6px 11px;font-size:13px}
.bragbox button.bgred{color:#ff9a8a}.bragbox button.bgboth{background:#c9a35a;color:#241800}.bragbox button.bgno{border-color:#4a5b5e;color:#9fb0b3;background:transparent;font-weight:600}
.bragbox .bgbar{height:3px;border-radius:2px;background:#5a4a28;margin-top:7px;overflow:hidden}.bragbox .bgbar i{display:block;height:100%;background:#ffd58a;transform-origin:left}
.bragov{position:fixed;inset:0;z-index:99980;pointer-events:none;display:grid;place-items:center;overflow:hidden;--cw:min(29vw,200px)}
.bragov>*{position:absolute}
.bragov .bgdim{inset:0;background:radial-gradient(ellipse at center,#0b2326f0 0%,#03080af5 78%);opacity:0}
.bragov .bgrays{left:50%;top:50%;width:150vmax;height:150vmax;margin:-75vmax 0 0 -75vmax;background:repeating-conic-gradient(from 0deg,#dfc18c2e 0 5deg,#0000 5deg 16deg);-webkit-mask:radial-gradient(circle,#000 0,#0000 52%);mask:radial-gradient(circle,#000 0,#0000 52%);opacity:0;will-change:transform}
.bragov .bgstage{position:relative;display:flex;flex-direction:column;align-items:center;gap:min(3.4vh,26px);transform:translateY(-1vh)}
.bragov .bgwho{font-size:clamp(12px,2.2vw,18px);letter-spacing:.42em;color:#dfc18c;opacity:0;padding-left:.42em}
.bragov .bgtitle{font-size:clamp(22px,5vw,54px);font-weight:900;letter-spacing:.01em;text-align:center;line-height:1.15;background:linear-gradient(110deg,#b69863,#ffe8b5 40%,#fff4d8 55%,#b69863);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 16px #dfc18c77);opacity:0}
.bragov .bgcards{display:flex;gap:min(7.5vw,76px);perspective:1100px;margin-top:min(3.5vh,28px)}
.bragov .bgslot{position:relative;flex:none;width:var(--cw);height:calc(var(--cw)*1.4)}
.bragov .bgcard{position:absolute;inset:0;transform-style:preserve-3d;opacity:0}
.bragov .bgin{position:absolute;inset:0;transform-style:preserve-3d}
.bragov .bgback,.bragov .bgface,.bragov .bgglow{position:absolute;inset:0;border-radius:9%;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.bragov .bgback{background:linear-gradient(135deg,#1f625b,#123a3a);border:calc(var(--cw)*.045) solid #efe3c4;box-shadow:0 18px 40px #000a}
.bragov .bgback:before{content:"♠";position:absolute;inset:0;display:grid;place-items:center;font-size:calc(var(--cw)*.5);color:#dfc18c;opacity:.85}
.bragov .bgface{transform:rotateY(180deg);background:linear-gradient(160deg,#fcf7ea,#e8dfc6);color:#1b2a2c;border:2px solid #dfc18c}
.bragov .bgface.red{color:#b8423b}
.bragov .bgface .bgrk{position:absolute;left:9%;top:5%;font-weight:800;font-size:calc(var(--cw)*.26);line-height:1.02;text-align:center}.bragov .bgface .bgrk s{display:block;text-decoration:none;font-size:.8em}
.bragov .bgface .bgbig{position:absolute;inset:0;display:grid;place-items:center;font-size:calc(var(--cw)*.62)}
.bragov .bgglow{inset:-3%;border-radius:12%;box-shadow:0 0 26px 6px #ffd58abb,inset 0 0 16px #ffd58a66;opacity:0}
.bragov .bgfxl{left:0;top:0;width:100%;height:100%}
.bragov .bgsp{left:50%;top:50%;width:calc(var(--cw)*.07);height:calc(var(--cw)*.07);background:#ffe3a0;transform:translate(-50%,-50%) rotate(45deg);opacity:0}
.bragov .bgflash{inset:0;background:radial-gradient(circle,#fff6d8cc 0,#ffd58a55 38%,#0000 70%);opacity:0}
.bragov .bgcap{font-size:clamp(18px,3.8vw,38px);font-weight:900;color:#fff1cf;letter-spacing:.06em;opacity:0;text-shadow:0 2px 14px #000}
`;

// ───────── 선택창: 이긴 사람에게만, 8초 ─────────
function renderPrompt(s) {
  const b = s.brag, me = s.me >= 0 && s.players[s.me];
  const open = !!(b && me && b.winner === s.me && !b.used && b.until > api.now() && s.phase === 'showdown' && !s.ended && me.cards.length === 2 && me.cards[0] !== '??' && dismissed !== s.handNo);
  if (!open) { box.hidden = true; clearInterval(cd); cd = 0; box._k = ''; return; }
  const [a, c] = me.cards, key = `${s.handNo}|${a}${c}`;
  if (box._k !== key) { // 같은 핸드에서는 다시 그리지 않는다 (버튼 클릭이 씹히지 않게)
    box._k = key;
    box.innerHTML = `<b>🃏 다 폴드해서 이겼어요! 카드를 자랑할까요? <span class="bgsec"></span></b>
      <div class="bgbb"><button data-w="0" class="${isRed(a) ? 'bgred' : ''}">${label(a)} 만</button><button data-w="1" class="${isRed(c) ? 'bgred' : ''}">${label(c)} 만</button><button data-w="both" class="bgboth">두 장 모두</button><button data-w="no" class="bgno">괜찮아요</button></div>
      <div class="bgbar"><i></i></div>`;
    const left = b.until - api.now(); box.querySelector('.bgbar i').animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: Math.max(0, left), easing: 'linear', fill: 'forwards' });
  }
  box.hidden = false;
  clearInterval(cd); cd = setInterval(() => { const l = Math.ceil((b.until - api.now()) / 1000); const sec = box.querySelector('.bgsec'); if (sec) sec.textContent = `(${Math.max(0, l)})`; if (l <= 0) renderPrompt(last); }, 250);
}

// ───────── 연출 ─────────
function mk(cls, html = '') { const d = document.createElement('div'); d.className = cls; if (html) d.innerHTML = html; return d; }
function play(ev, name) {
  if (ov) ov.remove();
  const lite = document.body.dataset.motion === 'off', shown = ev.show, n = shown.length, { R, end } = TL[n];
  ov = mk('bragov');
  const dim = mk('bgdim'), rays = mk('bgrays'), stage = mk('bgstage'), who = mk('bgwho'), title = mk('bgtitle'), cards = mk('bgcards'), cap = mk('bgcap');
  who.textContent = `${name} 님의 카드는…`; title.innerHTML = '과연 카드가<br>무엇이었을까요?'; cap.textContent = shown.map((k) => label(ev.cards[k])).join('   ');
  const slots = [0, 1].map((k) => {
    const sl = mk('bgslot'), bc = mk('bgcard'), inn = mk('bgin'), glow = mk('bgglow'), fx = mk('bgfxl');
    inn.append(mk('bgback'));
    if (shown.includes(k)) { const c = ev.cards[k]; inn.append(mk(`bgface ${isRed(c) ? 'red' : ''}`, `<span class="bgrk">${rank(c)}<s>${SUIT[c[1]]}</s></span><span class="bgbig">${SUIT[c[1]]}</span>`)); }
    bc.append(inn, glow); sl.append(bc, fx); cards.append(sl);
    return { bc, inn, glow, fx };
  });
  stage.append(who, title, cards, cap); ov.append(dim, ...(lite ? [] : [rays]), stage); document.body.append(ov);
  const A = (el, kf, o) => el.animate(kf, { fill: 'both', ...o });
  const E = 'cubic-bezier(.2,.9,.2,1)';
  A(dim, [{ opacity: 0 }, { opacity: 1 }], { duration: 450 }); A(dim, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: end, fill: 'forwards' });
  if (!lite) { A(rays, [{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 300 }); A(rays, [{ transform: 'rotate(0)' }, { transform: 'rotate(120deg)' }], { duration: end + 500, easing: 'linear', composite: 'replace' }); A(rays, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: end, fill: 'forwards' }); }
  A(who, [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 250, easing: E });
  A(title, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.06)', offset: .7 }, { opacity: 1, transform: 'scale(1)' }], { duration: 750, delay: 300, easing: E });
  A(title, [{ transform: 'scale(1)' }, { transform: 'scale(1.045)' }, { transform: 'scale(1)' }], { duration: 1100, delay: 1500, iterations: 2, easing: 'ease-in-out', fill: 'none' }); // 두근두근
  slots.forEach((c, k) => {
    const side = k ? 1 : -1;
    A(c.bc, [{ opacity: 0, transform: `translate(${side * 24}vw,52vh) rotate(${side * 28}deg) scale(.5)` }, { opacity: 1, transform: 'translate(0,-2%) rotate(0) scale(1.04)', offset: .7 }, { opacity: 1, transform: 'none' }], { duration: 800, delay: 650 + k * 140, easing: E });
    A(c.glow, [{ opacity: 0 }, { opacity: .9 }, { opacity: .25 }, { opacity: .9 }, { opacity: .25 }], { duration: 2000, delay: 1500 + k * 120, easing: 'ease-in-out', fill: 'none' }); // 기다리는 동안 테두리가 두근두근
    A(c.bc, [{ transform: 'translateX(0)' }, { transform: 'translateX(-1.2px)' }, { transform: 'translateX(1.2px)' }, { transform: 'translateX(0)' }], { duration: 130, delay: 1500 + k * 60, iterations: 14, fill: 'none' }); // 떨림
  });
  R.forEach((r, i) => { // i 번째로 공개되는 카드 = shown[i]
    const c = slots[shown[i]];
    A(c.glow, [{ opacity: 0 }, { opacity: 1 }], { duration: 800, delay: r - 1500, fill: 'forwards' });
    A(c.bc, [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-3%) scale(1.06)' }], { duration: 500, delay: r - 1500, easing: E, fill: 'forwards' });
    A(c.inn, [{ transform: 'rotateY(0)' }, { transform: 'rotateY(84deg)', offset: .62, easing: 'ease-in' }, { transform: 'rotateY(90deg)', offset: .8 }, { transform: 'rotateY(180deg)' }], { duration: 1300, delay: r - 1300, easing: 'linear', fill: 'forwards' }); // 천천히 세우고 → 잠깐 멈칫 → 확 넘김
    A(c.bc, [{ transform: 'translateY(-3%) scale(1.06)' }, { transform: 'translateY(-5%) scale(1.2)', offset: .35 }, { transform: 'translateY(-3%) scale(1.1)' }], { duration: 550, delay: r, easing: E, fill: 'forwards' }); // 공개: 커졌다 안착
    A(stage, [{ transform: 'translate(0,-1vh)' }, { transform: 'translate(7px,-1vh)' }, { transform: 'translate(-6px,-.6vh)' }, { transform: 'translate(0,-1vh)' }], { duration: 260, delay: r, fill: 'none' });
    if (lite) return;
    const fl = mk('bgflash'); ov.append(fl); A(fl, [{ opacity: 0 }, { opacity: 1, offset: .18 }, { opacity: 0 }], { duration: 650, delay: r });
    for (let j = 0; j < 14; j++) { // 반짝이 터짐
      const sp = mk('bgsp'), ang = (j / 14) * Math.PI * 2 + Math.random() * 0.4, d = 110 + Math.random() * 140; c.fx.append(sp);
      A(sp, [{ opacity: 0, transform: 'translate(-50%,-50%) rotate(45deg) scale(.2)' }, { opacity: 1, offset: .12 }, { opacity: 0, transform: `translate(${Math.cos(ang) * d}px,${Math.sin(ang) * d}px) rotate(225deg) scale(1.1)` }], { duration: 850, delay: r + Math.random() * 60, easing: 'cubic-bezier(.1,.7,.2,1)' });
    }
  });
  const lastR = R[R.length - 1];
  A(cap, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 450, delay: lastR + 350, easing: E });
  if (n === 1) { const other = slots[shown[0] ? 0 : 1]; A(other.bc, [{ opacity: 1 }, { opacity: .45 }], { duration: 500, delay: lastR + 300, fill: 'forwards' }); }
  A(stage, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: end, fill: 'forwards' });
  try { api.sound.brag(R.map((r) => r / 1000)); } catch {}
  const mine = ov; setTimeout(() => { if (ov === mine) { mine.remove(); ov = null; } }, end + 650);
}

// ───────── 연결 ─────────
export function onState(s) { // 상태가 도착한 즉시: 새 brag 이벤트를 재생 (연출 큐를 기다리지 않는다)
  if (!api || !s || !s.events) return;
  const top = s.events.reduce((m, e) => Math.max(m, e.id), 0);
  if (!inited) { inited = true; seen = top; return; } // 들어오기 전의 일은 재생하지 않는다
  for (const ev of s.events) {
    if (ev.k !== 'brag' || ev.id <= seen) continue;
    seen = ev.id;
    if (document.hidden || api.now() - ev.at > 2500) continue; // 숨은 탭·재접속 직후 놓친 옛 이벤트는 건너뜀
    play(ev, s.players[ev.i] ? s.players[ev.i].name : '');
  }
  seen = Math.max(seen, top);
}
export function update(s) { if (!api || !s) return; last = s; renderPrompt(s); }
export function init(a) {
  api = a;
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  box = Object.assign(document.createElement('div'), { className: 'bragbox', hidden: true });
  $('.hudmid').prepend(box);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]'); if (!b) return;
    const w = b.dataset.w;
    if (last) dismissed = last.handNo; // 어느 쪽이든 선택창은 닫는다
    box.hidden = true; clearInterval(cd); cd = 0;
    if (w !== 'no') api.send({ t: 'brag', which: w === 'both' ? 'both' : +w });
  });
}
