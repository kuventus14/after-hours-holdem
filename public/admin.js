'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('ko-KR');
  const phases = { waiting: '대기 중', preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버', showdown: '쇼다운', ended: '종료' };
  const phase = r => r.paused ? '일시정지' : phases[r.phase] || r.phase;
  let key = '', rooms = [], selected = '', generation = 0, timer, controller;
  const empty = text => `<div class="empty"><span>♧</span><h2>${esc(text)}</h2><p>목록에서 테이블을 선택하면 상세 정보를 볼 수 있어요.</p></div>`;
  function invalidate() { generation++; clearTimeout(timer); controller?.abort(); }
  function lock(message = '') {
    invalidate(); key = ''; rooms = []; selected = '';
    $('adminKey').value = ''; $('roomList').replaceChildren(); $('detail').innerHTML = empty('테이블을 선택해 주세요');
    $('dashboard').hidden = true; $('logout').hidden = true; $('login').hidden = false;
    $('loginError').textContent = message; $('connection').textContent = '잠김';
  }
  async function request(path, signal) {
    const r = await fetch(path, { headers: { 'X-Observer-Token': key }, cache: 'no-store', credentials: 'omit', signal });
    let data; try { data = await r.json(); } catch { data = {}; }
    if (!r.ok) throw Object.assign(new Error(data.error || '서버에 연결하지 못했어요.'), { status: r.status });
    return data;
  }
  function renderList() {
    const active = $('roomList').contains(document.activeElement) ? document.activeElement.dataset.room : null;
    const filter = $('modeFilter').value, search = $('search').value.trim().toLowerCase();
    const shown = rooms.filter(r => (filter === 'all' || r.mode === filter) && (r.code + ' ' + r.host).toLowerCase().includes(search));
    $('roomList').innerHTML = shown.length ? shown.map(r => `<button class="room-row ${selected === r.code ? 'active' : ''}" data-room="${esc(r.code)}" aria-pressed="${selected === r.code}"><span class="room-top"><b>${esc(r.code)}</b><span class="badge ${r.mode === 'pure' ? '' : 'limited'}">${r.mode === 'pure' ? '미정산' : '정산'}</span></span><p>${esc(r.host)}의 테이블 ${r.practice ? '· 연습' : ''}</p><span class="room-bottom"><span>${esc(phase(r))} · #${r.handNo}</span><span>${r.players}명 · 접속 ${r.connected}명</span></span></button>`).join('') : '<p>표시할 테이블이 없어요.</p>';
    if (active) [...$('roomList').querySelectorAll('button')].find(b => b.dataset.room === active)?.focus({ preventScroll: true });
  }
  const suits = { s: '♠', h: '♥', d: '♦', c: '♣' };
  function card(c, pending = false) {
    if (!/^(?:[2-9TJQKA])[shdc]$/.test(c || '')) return '<span class="card hidden-card" aria-label="비공개 카드">♠</span>';
    const rank = c[0] === 'T' ? '10' : c[0], suit = suits[c[1]];
    return `<span class="card ${/[hd]$/.test(c) ? 'red' : ''} ${pending ? 'pending' : ''}" aria-label="${rank}${suit}${pending ? ' 예정' : ''}"><span>${rank}</span><span>${suit}</span></span>`;
  }
  function renderDetail(r) {
    const logScroll = $('detail').querySelector('.log-list')?.scrollTop || 0;
    const pure = r.access === 'full';
    $('detail').innerHTML = `<div class="detail-head"><div><div class="eyebrow">TABLE DETAIL</div><h2>${esc(r.code)}</h2><p>${esc(r.host)}의 테이블 · 핸드 #${r.handNo}</p></div><div><span class="badge ${pure ? '' : 'limited'}">${pure ? '미정산 · 전체 관전' : '정산 · 공개 관전'}</span><p>${esc(phase(r))}</p></div></div>
    <div class="access-note">${pure ? '가상 칩 전용 테이블입니다. 모든 플레이어의 패와 예정 보드를 확인할 수 있습니다.' : '공개된 카드와 게임 상황만 표시합니다. 비공개 패와 예정 보드는 서버에서 전달하지 않습니다.'}</div>
    <div class="table-board"><div class="board-title">COMMUNITY CARDS · 공개된 보드</div><div class="cards">${Array.from({ length: 5 }, (_, i) => card(r.community[i])).join('')}</div><div class="pot">POT <b>${fmt(r.pot)}</b> 칩</div><small class="muted">블라인드 ${fmt(r.sb)} / ${fmt(r.bb)}</small>
    ${pure ? `<div class="future"><div class="board-title">UP NEXT · 아직 공개되지 않은 보드</div>${r.upcoming.length ? `<div class="cards">${r.upcoming.map(c => card(c, true)).join('')}</div><small>왼쪽부터 나올 순서 · 핸드가 계속 진행될 경우</small>` : '<p>현재 예정 카드가 없습니다.</p>'}</div>` : ''}</div>
    <h2>플레이어 <span class="muted">${r.players.length}명</span></h2><div class="seat-grid">${r.players.map(p => `<article class="seat ${r.toAct === p.seat ? 'turn' : ''}"><div class="seat-top"><span class="seat-name">${p.seat + 1}. ${esc(p.name)} ${p.host ? '♛' : ''}</span><small>${p.bot ? 'BOT' : p.connected ? '접속 중' : '연결 끊김'}${r.dealer === p.seat ? ' · D' : ''}</small></div><div class="cards">${p.cards.length ? p.cards.map(c => card(c)).join('') : '<small>패 없음 / 비공개</small>'}</div><div class="numbers">보유 <b>${fmt(p.chips)}</b> · 베팅 <b>${fmt(p.bet)}</b></div><div class="seat-status">${r.toAct === p.seat ? '● 현재 차례 · ' : ''}${p.folded ? '폴드' : p.allIn ? '올인' : esc(p.lastAction || '대기')}</div></article>`).join('')}</div>
    <div class="log"><h2>최근 진행 기록</h2><div class="log-list">${r.log.map(l => `<div>${esc(l)}</div>`).join('') || '아직 기록이 없어요.'}</div></div>`;
    $('detail').querySelector('.log-list').scrollTop = logScroll;
  }
  async function refresh() {
    if (!key || document.hidden) return;
    invalidate(); const revision = generation; controller = new AbortController();
    const currentController = controller;
    const timeout = setTimeout(() => currentController.abort(), 10000);
    try {
      const list = await request('/api/observer/rooms', controller.signal);
      if (revision !== generation) return;
      rooms = list.rooms; $('countRooms').textContent = rooms.length;
      $('countLive').textContent = rooms.filter(r => r.handNo > 0 && !r.ended).length;
      $('countHumans').textContent = rooms.reduce((n, r) => n + r.connected, 0);
      if (selected && !rooms.some(r => r.code === selected)) { selected = ''; $('detail').innerHTML = empty('종료되었거나 삭제된 방이에요'); }
      renderList();
      if (selected) {
        try { const detail = await request('/api/observer/rooms/' + selected, controller.signal); if (revision === generation) renderDetail(detail); }
        catch (e) { if (e.status !== 404) throw e; selected = ''; $('detail').innerHTML = empty(e.message); renderList(); }
      }
      if (revision !== generation) return;
      $('login').hidden = true; $('dashboard').hidden = false; $('logout').hidden = false;
      $('loginError').textContent = ''; $('dashboardError').textContent = '';
      $('connection').textContent = '● 실시간 연결';
      $('updated').textContent = '마지막 갱신 ' + new Date(list.serverNow).toLocaleTimeString('ko-KR');
    } catch (e) {
      if (revision !== generation) return;
      if ([403, 429, 503].includes(e.status) || !$('login').hidden) { lock(e.message); return; }
      $('connection').textContent = '연결 끊김 · 재시도 중';
      $('dashboardError').textContent = '최신 정보를 가져오지 못했어요. 연결을 다시 확인하고 있어요.';
      $('detail').innerHTML = empty('연결 확인 중'); $('roomList').replaceChildren(); rooms = [];
      for (const id of ['countRooms', 'countLive', 'countHumans']) $(id).textContent = '—';
      $('updated').textContent = '갱신 중단';
    } finally {
      clearTimeout(timeout);
      if (revision === generation && key && !document.hidden) timer = setTimeout(refresh, 2000);
    }
  }
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); key = $('adminKey').value.trim(); $('adminKey').value = '';
    $('unlock').disabled = true; $('connection').textContent = '인증 확인 중';
    try { await refresh(); } finally { $('unlock').disabled = false; }
  });
  $('logout').addEventListener('click', () => lock());
  $('roomList').addEventListener('click', e => { const button = e.target.closest('[data-room]'); if (!button) return; selected = button.dataset.room; $('detail').innerHTML = empty('테이블을 불러오는 중'); renderList(); refresh(); });
  $('modeFilter').addEventListener('change', () => { selected = ''; $('detail').innerHTML = empty('테이블을 선택해 주세요'); renderList(); refresh(); });
  $('search').addEventListener('input', renderList);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { invalidate(); $('detail').innerHTML = empty('관전 일시 중지'); $('connection').textContent = '일시 중지'; }
    else if (key) refresh();
  });
  window.addEventListener('pagehide', () => lock());
})();
