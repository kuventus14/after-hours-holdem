// 폰 게임 화면 (C-3): 카드 밀기 · 작은 버튼 · 레이즈 화면 · 이모지/채팅 버튼 · ☰ 메뉴. 앱 모드·웹 모드 모두, 폭 700px 이하에서만 켜진다.
// 서버·게임 규칙·웹의 원 단위 기능은 건드리지 않고, 기존 버튼(data-do)과 appApi.send 만 쓴다. 맨 위 주소에 ?classic=1 을 붙이면(또는 ☰ 메뉴) 예전 화면.
(() => {
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  const q = new URLSearchParams(location.search).get('classic');
  if (q === '1' || q === '0') store.set('holdem_classic', q === '1' ? '1' : null);
  const classic = store.get('holdem_classic') === '1';
  const $ = (s, r = document) => r.querySelector(s);
  const mq = matchMedia('(max-width:700px)');
  const fmt = (n) => Number(n).toLocaleString();
  const api = () => window.appApi;
  const st = () => (api() && api().getState()) || null;
  const toast = (m) => { const t = $('#toast'); if (t) { t.textContent = m; t.hidden = false; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => { t.classList.remove('show'); t.hidden = true; }, 2200); } };

  // 내 차례 정보 (index.html 의 renderBar 와 같은 식)
  function turnInfo() {
    const s = st(); if (!s) return null;
    const mp = s.players && s.players[s.me]; if (!mp) return null;
    const live = ['preflop', 'flop', 'turn', 'river'].includes(s.phase) && mp.inHand && !mp.folded && !s.ended;
    const myTurn = live && s.toAct === s.me && !s.paused;
    const toCallRaw = Math.max(0, s.currentBet - mp.bet);
    const maxTo = mp.bet + mp.chips;
    const minTo = Math.min(s.currentBet + s.minRaise, maxTo);
    const canRaise = myTurn && !mp.allIn && mp.chips > toCallRaw;
    return { s, mp, myTurn, canRaise, toCall: Math.min(toCallRaw, mp.chips), minTo, maxTo, verb: s.currentBet === 0 ? '벳' : '레이즈' };
  }


  // 내 카드를 실제 트럼프처럼: 모서리 숫자·무늬, 가운데 무늬 배치(2~10), A 큰 무늬, J·Q·K 장식 프레임
  const L = 0.12, C = 0.5, R = 0.88;
  const PIPS = {
    2: [[C, 0], [C, 1]], 3: [[C, 0], [C, .5], [C, 1]], 4: [[L, 0], [R, 0], [L, 1], [R, 1]],
    5: [[L, 0], [R, 0], [C, .5], [L, 1], [R, 1]], 6: [[L, 0], [R, 0], [L, .5], [R, .5], [L, 1], [R, 1]],
    7: [[L, 0], [R, 0], [C, .25], [L, .5], [R, .5], [L, 1], [R, 1]],
    8: [[L, 0], [R, 0], [C, .25], [L, .5], [R, .5], [C, .75], [L, 1], [R, 1]],
    9: [[L, 0], [R, 0], [L, 1 / 3], [R, 1 / 3], [C, .5], [L, 2 / 3], [R, 2 / 3], [L, 1], [R, 1]],
    10: [[L, 0], [R, 0], [C, 1 / 6], [L, 1 / 3], [R, 1 / 3], [L, 2 / 3], [R, 2 / 3], [C, 5 / 6], [L, 1], [R, 1]],
  };
  const CROWN = { K: '♚', Q: '♛', J: '♞' };
  function dress(card) {
    if (card.classList.contains('ag') || card.classList.contains('slot')) return;
    const r = ($('.r', card) || {}).textContent, s = ($('.s', card) || {}).textContent; if (!r || !s) return;
    card.classList.add('ag');
    let mid;
    if (r === 'A') mid = `<i class="pip ace" style="left:50%;top:50%">${s}</i>`;
    else if (CROWN[r]) mid = `<div class="face"><i class="fs a">${s}</i><i class="fs b">${s}</i><span class="fcrown">${CROWN[r]}</span><b class="fletter">${r}</b></div>`;
    else mid = (PIPS[+r] || []).map(([x, y]) => `<i class="pip${y > .5 ? ' dn' : ''}" style="left:${x * 100}%;top:${y * 100}%">${s}</i>`).join('');
    card.innerHTML = `<div class="idx"><b class="${r === '10' ? 'ten' : ''}">${r}</b><i>${s}</i></div><div class="idx bt"><b class="${r === '10' ? 'ten' : ''}">${r}</b><i>${s}</i></div><div class="pips">${mid}</div>`;
  }
  const dressAll = (root) => root.querySelectorAll('.pcard').forEach(dress);
  window.appgameDress = dressAll; // 시험·미리보기용

  function build() {
    const game = $('#game'); if (!game || $('#agRaise')) return;
    // ☰ 메뉴: 소리·효과·신고·방장 버튼을 한곳에 모은다 (버튼 자체를 옮기므로 기존 동작 그대로)
    const top = $('.top', game);
    const menuBtn = Object.assign(document.createElement('button'), { id: 'agMenuBtn', textContent: '☰', title: '메뉴' });
    menuBtn.setAttribute('aria-label', '메뉴');
    top.appendChild(menuBtn);
    const menu = Object.assign(document.createElement('div'), { id: 'agMenu' });
    document.body.appendChild(menu);
    const gather = () => ['#rbBtn', '#sndBtn', '.motion-toggle', '#hostBtns', '.langpick'].forEach((q) => { const el = $(q, top) || $(q, menu); if (el && el.parentNode !== menu) menu.appendChild(el); });
    const cl = Object.assign(document.createElement('button'), { className: 'pill', id: 'agClassicBtn', textContent: '기존 화면으로 보기' });
    cl.onclick = () => { store.set('holdem_classic', '1'); location.reload(); };
    menu.appendChild(cl);
    gather();
    new MutationObserver(gather).observe(top, { childList: true });
    const toggleMenu = (on) => menu.classList.toggle('open', on);
    menuBtn.onclick = (e) => { e.stopPropagation(); toggleMenu(!menu.classList.contains('open')); };
    document.addEventListener('click', (e) => { if (!e.target.closest('#agMenu,#agMenuBtn,#volBox')) toggleMenu(false); });

    // 이모지(왼쪽)·채팅(오른쪽) 둥근 버튼
    const emoBtn = Object.assign(document.createElement('button'), { id: 'agEmoBtn', className: 'ag-fab', textContent: '😀', title: '이모지' });
    const chatBtn = Object.assign(document.createElement('button'), { id: 'agChatBtn', className: 'ag-fab', title: '채팅' });
    chatBtn.innerHTML = '💬<i hidden></i>';
    emoBtn.setAttribute('aria-label', '이모지와 한마디'); chatBtn.setAttribute('aria-label', '채팅 열기');
    document.body.append(emoBtn, chatBtn);
    const badge = $('#chatBadge'), mirror = () => { const i = $('i', chatBtn); i.hidden = badge.hidden; i.textContent = badge.textContent; };
    new MutationObserver(mirror).observe(badge, { attributes: true, childList: true, characterData: true, subtree: true });
    chatBtn.onclick = () => $('#chatBtn').click();

    // 이모지·한마디 시트
    const back = Object.assign(document.createElement('div'), { id: 'agSheetBack' });
    const sheet = Object.assign(document.createElement('div'), { id: 'agSheet' });
    sheet.innerHTML = '<div class="grab"></div><div class="emotes"><button data-emote="angry">😡 화남</button><button data-emote="thanks">💖 감사</button><button data-emote="sad">😭 슬픔</button><button data-emote="hurry">⚾ 빨리</button></div>';
    sheet.appendChild($('#sayRow'));
    document.body.append(back, sheet);
    const setSheet = (on) => { back.classList.toggle('open', on); sheet.classList.toggle('open', on); };
    emoBtn.onclick = () => setSheet(!sheet.classList.contains('open'));
    back.onclick = () => setSheet(false);
    sheet.addEventListener('click', (e) => { if (e.target.closest('[data-emote]')) setTimeout(() => setSheet(false), 150); });

    // 레이즈 화면
    const rz = Object.assign(document.createElement('div'), { id: 'agRaise' });
    rz.innerHTML = '<div class="pot"></div><div class="big"><small>RAISE TO</small><b></b></div><div class="lb lbt" data-v="max">올인 ▲</div><div class="trk"><div class="fill"></div><div class="knob"></div></div><div class="lb lbb" data-v="min">최소</div><div class="hand"></div><div class="btns"><button class="cn">취소</button><button class="ok"></button></div>';
    document.body.appendChild(rz);
    const strip = $('#cardstrip'), hintEl = Object.assign(document.createElement('div'), { className: 'hint-swipe', textContent: '▲ 위로 밀어 레이즈 · ‹ 폴드 · 콜 ›' });
    $('.control-dock').appendChild(hintEl);

    // 보드(공용 카드): 숨겨 둔 카드 띠의 보드 칸을 큰 카드로 내 패 위에 따로 보여준다
    const board = Object.assign(document.createElement('div'), { id: 'agBoard', hidden: true });
    board.innerHTML = '<div class="lbl"></div><div class="bd"></div>';
    $('.stage').appendChild(board);
    const STREET = { preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버', showdown: '쇼다운' };
    const syncBoard = () => {
      const src = $('.grp + .grp .cs', strip), s = st();
      board.hidden = !src || strip.classList.contains('off');
      if (board.hidden) return;
      const bd = $('.bd', board); if (bd.innerHTML !== src.innerHTML) { bd.innerHTML = src.innerHTML; dressAll(bd); }
      $('.lbl', board).textContent = `${STREET[s && s.phase] || ''} · 보드`;
    };
    const syncStrip = () => { dressAll(strip); syncBoard(); };
    syncStrip(); new MutationObserver(syncStrip).observe(strip, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    let R = null; // { mode:'drag'|'tap', val, info }
    const trk = $('.trk', rz), fill = $('.fill', rz), knob = $('.knob', rz), ok = $('.ok', rz), cn = $('.cn', rz);
    const step = () => Math.max(1, (R.info.s.bb || 1));
    function setVal(ratio) {
      const { minTo, maxTo } = R.info; ratio = Math.max(0, Math.min(1, ratio));
      let v = minTo + (maxTo - minTo) * ratio;
      v = ratio >= 0.985 ? maxTo : Math.max(minTo, Math.min(maxTo, Math.round(v / step()) * step()));
      R.val = v; paint();
    }
    function paint() {
      const { minTo, maxTo, s, mp, toCall } = R.info, r = maxTo > minTo ? (R.val - minTo) / (maxTo - minTo) : 1;
      $('.big b', rz).textContent = fmt(R.val);
      $('.big small', rz).textContent = R.val >= maxTo ? 'ALL IN' : R.info.verb === '벳' ? 'BET' : 'RAISE TO';
      $('.pot', rz).textContent = `🪙 ${fmt(s.pot)} + ${fmt(R.val - mp.bet)}`;
      fill.style.height = `${r * 100}%`; knob.style.bottom = `${r * 100}%`;
      ok.textContent = R.mode === 'drag' ? '손 떼면 베팅' : `${R.val >= maxTo ? '올인' : '베팅'} ${fmt(R.val)}`;
    }
    function openRaise(mode, info) {
      R = { mode, info, val: info.minTo };
      const mine = $('.cs', strip); $('.hand', rz).innerHTML = mine ? mine.innerHTML : '';
      rz.classList.add('open'); document.body.classList.add('ag-raising'); paint();
    }
    function closeRaise() { R = null; rz.classList.remove('open'); document.body.classList.remove('ag-raising'); cn.classList.remove('hot'); }
    function commit() { if (!R) return; const v = R.val; closeRaise(); api().send({ t: 'act', a: 'raise', amount: v }); }
    cn.onclick = closeRaise;
    ok.onclick = () => { if (R && R.mode === 'tap') commit(); };
    rz.addEventListener('click', (e) => { const l = e.target.closest('[data-v]'); if (l && R) setVal(l.dataset.v === 'max' ? 1 : 0); });
    // 슬라이더 직접 끌기
    const fromY = (y) => { const b = trk.getBoundingClientRect(); return 1 - (y - b.top) / b.height; };
    trk.addEventListener('pointerdown', (e) => { if (!R) return; trk.setPointerCapture(e.pointerId); setVal(fromY(e.clientY)); });
    trk.addEventListener('pointermove', (e) => { if (R && trk.hasPointerCapture(e.pointerId)) setVal(fromY(e.clientY)); });

    // 작은 레이즈 버튼 → 레이즈 화면 (기존 즉시 베팅 대신)
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('appgame')) return;
      const b = e.target.closest('#raiseBtn'); if (!b) return;
      e.stopImmediatePropagation(); e.preventDefault();
      const info = turnInfo(); if (!info || !info.canRaise) { toast('지금은 레이즈할 수 없어요'); return; }
      openRaise('tap', info);
    }, true);

    // 카드 밀기: 위=레이즈(끌어올리는 동안 금액 증가, 손 떼면 베팅), 왼쪽=폴드, 오른쪽=콜/체크
    const OPEN = 50, SIDE = 90;
    let g = null;
    strip.addEventListener('pointerdown', (e) => {
      if (!document.body.classList.contains('appgame') || strip.classList.contains('off')) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, dir: '', info: null };
    });
    strip.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.dir) {
        if (Math.hypot(dx, dy) < 12) return;
        g.info = turnInfo();
        if (!g.info || !g.info.myTurn) { toast('아직 배팅 차례가 아닙니다'); g = null; return; }
        g.dir = Math.abs(dy) > Math.abs(dx) && dy < 0 ? 'up' : Math.abs(dx) >= Math.abs(dy) ? 'side' : 'down';
        if (g.dir === 'up' && !g.info.canRaise) { toast('지금은 레이즈할 수 없어요'); g = null; return; }
        try { strip.setPointerCapture(e.pointerId); } catch {}
        strip.classList.add('dragging');
      }
      if (g.dir === 'side') { $('.cs', strip).style.transform = `translateX(${dx}px) rotate(${dx / 14}deg)`; }
      else if (g.dir === 'up') {
        if (!R && -dy >= OPEN) openRaise('drag', g.info);
        if (R) {
          setVal((-dy - OPEN) / (innerHeight * 0.4));
          const hot = e.clientY > innerHeight - 110; cn.classList.toggle('hot', hot);
        }
      }
    });
    const end = (e, cancelled) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, cs = $('.cs', strip), was = g; g = null;
      strip.classList.remove('dragging'); if (cs) cs.style.transform = '';
      if (was.dir === 'side' && !cancelled) {
        if (dx <= -SIDE) $('.a-fold', $('#bar')) && $('.a-fold', $('#bar')).click();
        else if (dx >= SIDE) { const b = $('.a-call', $('#bar')); b && b.click(); }
      } else if (was.dir === 'up' && R && R.mode === 'drag') {
        if (cancelled || e.clientY > innerHeight - 110) closeRaise(); else commit();
      }
    };
    strip.addEventListener('pointerup', (e) => end(e, false));
    strip.addEventListener('pointercancel', (e) => end(e, true));

    // 밀기 안내 문구는 내 차례일 때만
    const syncHint = () => { const i = turnInfo(); hintEl.hidden = !(i && i.myTurn) || document.body.dataset.phase === 'waiting'; };
    new MutationObserver(syncHint).observe($('#bar'), { childList: true, subtree: true });
    syncHint();
    // 레이즈 중에 차례가 넘어가거나 판이 끝나면 닫는다
    new MutationObserver(() => { if (R) { const i = turnInfo(); if (!i || !i.myTurn) closeRaise(); } }).observe($('#bar'), { childList: true, subtree: true });
  }

  const apply = () => document.body.classList.toggle('appgame', mq.matches && !classic);
  const init = () => {
    if (classic) { // 예전 화면: 새 화면으로 돌아가는 작은 버튼만 둔다
      const top = $('#game .top'); if (!top) return;
      const b = Object.assign(document.createElement('button'), { className: 'pill', id: 'agNewBtn', textContent: '✦ 새 화면' });
      b.onclick = () => { store.set('holdem_classic', null); location.reload(); };
      top.appendChild(b); return;
    }
    apply(); build(); mq.addEventListener('change', apply);
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
