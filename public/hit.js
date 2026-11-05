// 때리기(야구방망이) 화면 — 서버가 진실이다(S.hit · players[i].stun · 이벤트 hit/pay). 여기서는 그것을 보여 주기만 한다.
// 규칙과 거절 문구는 engine.js 의 hitCheck 와 같다. index.html 이 동적 import 하므로 이 파일이 깨져도 게임은 그대로 돈다.
// 모션(때리기·기절)은 game3d.js 의 pushHits/syncStun 이 하고, 이 파일은 버튼·대상 고르기·확인창·배너·배지·떠오르는 글자·암막을 맡는다.
const $ = (s) => document.querySelector(s);
const fmt = (n) => Number(n).toLocaleString('ko-KR');
let api, pill, sw, hint, banner, modal, veil, last = null, picking = false, target = -1, targetName = '', payAt = 0, busyT = 0, outAt = 0, outT = 0;
const stage = () => api.getStage();

// ───────── 모양 ─────────
const CSS = `
.hitpill{border-color:#c9553a !important;background:#3a1a12 !important;color:#ffd2c2 !important;font-weight:800}
.hitpill.dim{background:#16262a !important;color:#7d9193 !important;border-color:#2a4146 !important}.hitpill.on{background:#c9553a !important;color:#fff !important}
.hitsw{font-weight:800;border-color:#2f8f6a !important;background:#12301f !important;color:#9ff0c4 !important}.hitsw.off{border-color:#c9553a !important;background:#3a1a12 !important;color:#ffb8a0 !important}
body.hitmode .p3d:not(.dealer):not(.me){pointer-events:auto;cursor:not-allowed;outline:2px dotted #5d6f73;border-radius:14px}
body.hitmode .p3d[data-hitok]:not(.dealer):not(.me){cursor:pointer;outline:2px dashed #ff9d4d;animation:hitpulse 1s infinite}@keyframes hitpulse{50%{outline-color:#ffe0c2}}
.kickhint.hit{background:#3a2210;border-color:#9a5a22;color:#ffd0a0}.kickhint.hit button{border-color:#9a5a22;color:#ffe0c2}
.hitbanner{max-width:min(94%,430px);text-align:center;background:#2b1620ee;border:1px solid #b8477a;color:#ffd0e4;border-radius:11px;padding:6px 11px;font-size:12px;line-height:1.4;pointer-events:auto}
.hitbanner b{display:block;font-size:13px;color:#fff}.hitbanner button{margin:4px 0 0 4px;border:0;border-radius:8px;background:#e0a13a;color:#201300;font-weight:800;padding:5px 11px;font-size:12px}
.hitbanner button:disabled{opacity:.4;cursor:not-allowed}.hitbanner small{display:block;color:#ffb8a0;margin-top:3px}
.hitbadge{position:absolute;left:50%;top:-22px;transform:translateX(-50%);white-space:nowrap;font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;background:#2b1620;border:1px solid #b8477a;color:#ffd0e4;pointer-events:none;z-index:3}
#stunVeil{position:fixed;inset:0;z-index:99990;pointer-events:none;display:grid;place-items:center;font:900 56px system-ui;color:#fff;text-shadow:0 4px 24px #000;background:radial-gradient(closest-side,#0000 38%,#000c 100%);opacity:0}
/* 쇼다운 결과 패널(z-index 가 같고 나중에 그려짐)이 위 안내·배너를 덮지 않도록, 안내·배너 높이만큼 패널을 내린다 (--hitH 는 layoutTop 이 건다) */
.showdown{transform:translateY(var(--hitH,0px));max-height:calc(75% - var(--hitH,0px))}
@media(max-width:700px){.showdown{max-height:calc(83% - var(--hitH,0px))}}
@media(max-width:700px){.hitbadge{font-size:9px;padding:2px 7px;top:auto;bottom:calc(100% + 2px);white-space:normal;width:max-content;max-width:calc(100% + 6px);text-align:center;line-height:1.3;border-radius:9px}#stunVeil{font-size:40px}.hitbanner{font-size:11px;padding:5px 9px}}
`;

// ───────── 규칙 (서버 hitCheck 와 같은 순서·문구) ─────────
function blocked(s) { // 지금 때릴 수 없는 이유 (없으면 null). 대상과 무관한 것만
  const h = s.hit, me = s.players[s.me];
  if (!me || s.ended) return '게임이 끝났어요';
  if (!h.on) return '방장 권한으로 폭력은 안됩니다.';
  if (!s.handNo) return '게임이 시작된 뒤에 쓸 수 있어요';
  if (s.paused) return '휴식 중에는 때릴 수 없어요';
  if (s.endAfterHand || s.ending) return '마지막 핸드에는 때릴 수 없어요';
  if (s.phase === 'showdown' && s.nextAt && s.nextAt - api.now() < 4000) return '다음 핸드가 곧 시작돼요 · 지금은 때릴 수 없어요';
  if (api.now() < h.busyUntil) return `지금 ${h.lastHitBy}님이 때리는 중이에요`;
  if (s.handNo === h.lastHitHand) return `이번 핸드에는 이미 ${h.lastHitBy}님이 때렸어요`;
  if (s.handNo < h.lastHitHand + h.cooldown) return `때리기는 연달아 쓸 수 없어요 · ${h.lastHitHand + h.cooldown - s.handNo}핸드 뒤부터 가능해요`;
  if (me.kicked || !me.connected) return '지금은 때릴 수 없어요';
  if (me.stun) return '기절한 사람은 때릴 수 없어요';
  if (!(me.chips >= h.cost + s.bb)) return '칩이 부족해서 때릴 수 없어요 (때린 뒤에도 빅블라인드 이상 남아야 해요)';
  if (s.players.filter((p) => !p.kicked && p.connected && p.chips > 0).length < 3) return '남는 사람이 적어서 때릴 수 없어요 (기절하면 판이 안 돌아가요)';
  return null;
}
function victimWhy(s, i) { // i 번을 때릴 수 없는 이유 (없으면 null)
  const v = s.players[i];
  if (!v || i === s.me) return '때릴 사람을 다시 골라 주세요';
  if (v.kicked || !v.connected || !(v.chips > 0)) return '칩이 없거나 나간 사람은 때릴 수 없어요';
  if (v.stun) return '이미 기절한 사람이에요';
  if (s.players.filter((p, k) => k !== i && !p.kicked && p.connected && p.chips > 0).length < 2) return '남는 사람이 적어서 때릴 수 없어요 (기절하면 판이 안 돌아가요)';
  return null;
}
// 화면에 보이는 기절 상태: 서버 값 + 아직 쓰러져 있는 모습(깨어나는 모션이 끝날 때까지는 '쉬는 중'으로 보여 준다)
const shownStun = (s, i) => s.players[i].stun || (stage() && stage().seats[i] && stage().seats[i].avatar.stunned ? 'out' : '');

// ───────── 대상 고르기 → 확인 → 실행 ─────────
function layoutTop() { // 안내·배너가 차지하는 높이를 쇼다운 패널에 알린다
  const h = (hint.hidden ? 0 : hint.offsetHeight + 7) + (banner.hidden ? 0 : banner.offsetHeight + 7);
  const tw = $('#tw'); if (tw && tw._h !== h) { tw._h = h; tw.style.setProperty('--hitH', h + 'px'); }
}
function startPick() {
  if (document.body.classList.contains('kickmode')) $('#kickCancel').click(); // 강제 퇴장 고르기와 동시에 켜지지 않게
  picking = true; document.body.classList.add('hitmode'); hint.hidden = false; pill.classList.add('on'); mark(last); layoutTop();
}
function stopPick() {
  picking = false; document.body.classList.remove('hitmode'); hint.hidden = true; pill.classList.remove('on'); layoutTop();
  if (stage()) for (const seat of stage().seats) delete seat.el.dataset.hitok;
}
function mark(s) { // 때릴 수 있는 사람의 플레이트에 주황 점선 (className 은 상태마다 다시 쓰여서 data 속성으로)
  stage().seats.forEach((seat, i) => { if (s && !victimWhy(s, i)) seat.el.dataset.hitok = '1'; else delete seat.el.dataset.hitok; });
}
function askConfirm(i) {
  const s = last, v = s.players[i], me = s.players[s.me], h = s.hit;
  target = i; targetName = v.name; // 번호가 그 사이 밀려도 엉뚱한 사람이 맞지 않게, 보낼 때 이름도 함께
  $('#hitConfirmBody').innerHTML = `<b style="color:var(--ink);font-size:16px">${api.esc(v.name)}</b> 님을 때릴까요?<br>
    내 칩 <b style="color:#ffb27a">${fmt(h.cost)}</b>이 ${api.esc(v.name)} 님에게 넘어가요. <span style="color:#8fd9b0">내 칩 ${fmt(me.chips)} → ${fmt(me.chips - h.cost)}</span><br>
    맞은 사람은 <b style="color:var(--ink)">다음 핸드를 기절해서 쉬어요.</b> (${fmt(h.pay)}원을 내면 풀 수 있어요)<br>
    <span style="font-size:12px">때린 핸드부터 ${h.cooldown}핸드 동안은 아무도 때릴 수 없어요.</span>`;
  modal.hidden = false;
}

// ───────── 떠오르는 글자 · 암막 ─────────
function floaty(i, text, color) { // 플레이트 위로 1.5초 (DOM 한 개)
  const seat = stage().seats[i]; if (!seat || document.hidden) return;
  const r = seat.el.getBoundingClientRect(), d = document.createElement('div');
  d.textContent = text; d.style.cssText = `position:fixed;left:${r.left + r.width / 2}px;top:${r.top}px;transform:translate(-50%,0);z-index:99998;font:800 20px system-ui;color:${color};text-shadow:0 2px 8px #000;pointer-events:none`;
  document.body.append(d);
  const a = d.animate([{ opacity: 1, transform: 'translate(-50%,0)' }, { opacity: 0, transform: 'translate(-50%,-46px)' }], { duration: 1500, easing: 'ease-out' });
  a.onfinish = a.oncancel = () => d.remove();
}
function flash() { const d = document.createElement('div'); d.style.cssText = 'position:fixed;inset:0;z-index:99991;pointer-events:none;background:#ff2a2a'; document.body.append(d); const a = d.animate([{ opacity: 0.4 }, { opacity: 0 }], { duration: 500 }); a.onfinish = () => d.remove(); }
function onHit(ev) { // hit/pay 이벤트가 도착한 순간: 숫자는 game3d 가 이미 옮겼다
  const s = last, a = fmt(ev.amt);
  floaty(ev.i, `−${a}`, '#ff9a8a'); floaty(ev.to, `+${a}`, '#9ff0c4');
  if (ev.k !== 'pay' || !s) return;
  const nm = (k) => (s.players[k] ? s.players[k].name : '');
  if (ev.i === s.me) api.toast(`${nm(ev.to)}님에게 ${a}원을 보냈어요 · 다음 핸드부터 뛸 수 있어요`);
  else if (ev.to === s.me) api.toast(`${nm(ev.i)}님이 합의금 ${a}원을 보냈어요`);
}

// ───────── 화면 갱신 (상태가 올 때·아바타가 쓰러지거나 깨어날 때만) ─────────
export function update(s) {
  if (!api || !s) return;
  last = s;
  const on = !!(s.hit && s.me >= 0 && s.players[s.me] && !s.ended); // 옛 서버(S.hit 없음)·관전·끝난 게임이면 전부 숨긴다
  pill.hidden = !(on && s.handNo > 0);
  sw.hidden = !(s.hit && s.isHost && !s.ended);
  if (!on) { if (picking) stopPick(); modal.hidden = true; banner.hidden = hint.hidden = true; clearBadges(); layoutTop(); return; }
  const why = blocked(s);
  if ((picking || !modal.hidden) && why) { // 고르는 사이 규칙이 바뀌었다(다른 사람이 먼저 때림·방장이 끔 등): 조용히 닫지 말고 이유를 알려 준다
    if (picking) stopPick();
    modal.hidden = true; api.toast(why);
  }
  pill.classList.toggle('dim', !!why && !picking);
  sw.classList.toggle('off', !s.hit.on); sw.textContent = s.hit.on ? '⚾ 때리기 허용 ON' : '⚾ 때리기 허용 OFF';
  if (picking) mark(s);
  clearTimeout(busyT);
  const left = s.hit.busyUntil - api.now();
  if (left > 0 && left < 20000) busyT = setTimeout(() => update(api.getState()), left + 60); // 연출 중 표시가 끝나는 순간 버튼을 다시 밝게
  const mine = shownStun(s, s.me), me = s.players[s.me];
  if (mine !== 'out') outAt = 0;
  else if (!outAt) { outAt = Date.now(); clearTimeout(outT); outT = setTimeout(() => update(api.getState()), 5100); } // '기절 중' 안내는 5초만 크게: 그 뒤엔 내 이름판 배지만 남겨 위쪽 자리를 가리지 않는다
  if (mine && !(mine === 'out' && Date.now() - outAt > 5000)) {
    banner.hidden = false;
    const by = s.players[me.stunBy], can = me.chips > s.hit.pay;
    const html = mine === 'pending'
      ? `<b>😵 기절로 인한 다음 핸드는 플레이가 불가합니다</b>다음 핸드를 뛰려면 때린 ${by ? api.esc(by.name) : '사람'}님에게 ${fmt(s.hit.pay)}원을 보내야 해요 <button id="hitPay"${can ? '' : ' disabled'}>${fmt(s.hit.pay)}원 보내고 뛰기</button>${can ? '' : '<small>칩이 부족해요</small>'}`
      : `<b>😵 기절 중 · 이번 핸드는 쉬어요</b>이 핸드가 끝나면 깨어나요`;
    if (banner._h !== html) { banner.innerHTML = html; banner._h = html; } // 바뀔 때만 다시 그린다 (자주 갈아끼우면 버튼 클릭이 씹힌다)
  } else banner.hidden = true;
  badges(s);
  layoutTop();
}
function badges(s) { // 플레이트는 상태마다 다시 그려지니, 배지는 플레이트 바깥(seat.el 의 별도 자식)에 둔다
  stage().seats.forEach((seat, i) => {
    let b = seat.el.querySelector('.hitbadge');
    const z = s.players[i] ? shownStun(s, i) : '';
    const text = z === 'out' ? '😵 기절 중 · 이번 핸드 쉼' : z === 'pending' ? '💫 기절 예정 · 다음 핸드 쉼' : '';
    if (text) { if (!b) { b = document.createElement('span'); b.className = 'hitbadge'; seat.el.append(b); } if (b.textContent !== text) b.textContent = text; } else if (b) b.remove();
  });
}
function clearBadges() { const st = stage(); if (st) st.seats.forEach((seat) => { const b = seat.el.querySelector('.hitbadge'); if (b) b.remove(); }); }
export function cancel() { if (api && picking) stopPick(); }

// ───────── 시작 ─────────
export function init(a) {
  api = a;
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  pill = Object.assign(document.createElement('button'), { className: 'pill hitpill', id: 'hitPill', textContent: '⚾ 때리기', hidden: true });
  $('#chatBtn').after(pill);
  sw = Object.assign(document.createElement('button'), { className: 'pill hitsw', id: 'hitSw', textContent: '⚾ 때리기 허용 ON', hidden: true });
  $('#hostBtns').prepend(sw);
  hint = Object.assign(document.createElement('div'), { className: 'kickhint hit', id: 'hitHint', hidden: true, innerHTML: '⚾ 때릴 사람을 눌러주세요 · 1,000칩 <button id="hitCancel">취소</button>' });
  banner = Object.assign(document.createElement('div'), { className: 'hitbanner', id: 'hitBanner', hidden: true });
  $('.hudmid').prepend(hint, banner);
  modal = Object.assign(document.createElement('div'), { className: 'modal', id: 'hitConfirm', hidden: true, innerHTML: `
    <div class="sheet" style="max-height:none"><div class="sh-head"><h2>⚾ 때리기</h2></div>
    <div id="hitConfirmBody" style="padding:4px 18px 14px;color:var(--mute);font-size:14px;line-height:1.7"></div>
    <div class="sh-foot"><button class="btn ghost" id="hitNo">취소</button><button class="btn" id="hitYes" style="background:#c9553a;color:#fff">⚾ 때리기</button></div></div>` });
  veil = Object.assign(document.createElement('div'), { id: 'stunVeil', textContent: '😵 기절!' });
  document.body.append(modal, veil);

  const st = stage();
  st.onHit = onHit;
  st.onImpact = (ev) => { if (last && ev.to === last.me) flash(); };
  st.onFaint = () => veil.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 2400 });
  st.onStunChange = () => update(api.getState());

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#hitPill')) {
      if (picking) { stopPick(); return; }
      const s = last, why = s && s.hit ? blocked(s) : null;
      if (why) { api.toast(why); return; } // 흐리게 보여도 사라지지 않고 이유를 알려 준다
      startPick(); return;
    }
    if (t.closest('#hitCancel')) { stopPick(); return; }
    if (t.closest('#hitSw')) { api.send({ t: 'hitSwitch', on: !(last && last.hit && last.hit.on) }); return; }
    if (t.closest('#hitNo')) { modal.hidden = true; return; }
    if (t.closest('#hitYes')) {
      modal.hidden = true; stopPick();
      const s = last, v = s && s.players[target];
      if (!v || v.name !== targetName) { api.toast('플레이어 정보가 바뀌었어요. 다시 선택해 주세요'); return; } // 확인창이 열려 있는 사이 자리가 밀렸다
      const why = blocked(s) || victimWhy(s, target);
      if (why) { api.toast(why); return; }
      api.send({ t: 'hit', i: target, name: targetName }); return;
    }
    if (t.closest('#hitPay')) { if (Date.now() - payAt > 1200) { payAt = Date.now(); api.send({ t: 'payStun' }); } return; }
    const pl = picking && t.closest('.p3d[data-seat]');
    if (pl && !pl.classList.contains('dealer') && !pl.classList.contains('me')) {
      const i = +pl.dataset.seat, why = victimWhy(last, i);
      if (why) api.toast(why); else askConfirm(i);
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!modal.hidden) modal.hidden = true; else if (picking) stopPick(); } });
}
