// 앱 모드 전용 화면(서버가 HOLDEM_APP=1 이면 index.html 에 window.APP_MODE 를 심는다): 로그인·회원가입·자동 로그인, 오픈/비공개 방, 열린 방 목록.
// 게임 화면·3D·모션은 건드리지 않는다. index.html 과는 window.APP_AUTH(로그인 정보), window.appJoinExtra(입장 메시지에 얹을 값),
// window.appHandleError(로그인 만료·비밀번호 필요), window.appApi(방 입장 함수) 로만 이어진다.
(() => {
  if (!window.APP_MODE) return;
  const KEY = 'holdem_auth';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getToken = () => { try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
  const setToken = (t, remember) => { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); (remember ? localStorage : sessionStorage).setItem(KEY, t); } catch {} };
  const clearToken = () => { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch {} };
  async function api(path, body) {
    const t = getToken();
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = {}; try { j = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, ...j };
  }

  let done; const ready = new Promise((res) => (done = res));
  const A = window.APP_AUTH = { ready, user: null, token: getToken };

  const css = document.createElement('style');
  css.textContent = `
.appmask{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:18px;background:#0b1519cc;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);overflow:auto}
.appcard{width:100%;max-width:400px;background:linear-gradient(180deg,#12282b,#0b171a);border:1px solid #ffffff2b;border-radius:26px;padding:24px 22px 22px;box-shadow:0 30px 80px #000c}
.appcard h2{font:700 26px Didot,"Bodoni 72",Georgia,serif;margin:8px 0 14px}
.apptop{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.appcard label{display:block;font:600 12px system-ui;color:var(--mute,#92a4a8);margin:0 0 12px}
.appcard label small{margin-left:6px;opacity:.8;font-weight:500}
.appcard label input:not([type=checkbox]){display:block;width:100%;margin-top:6px;height:50px;border-radius:14px;border:1px solid var(--line,#ffffff24);background:#0a1417;color:var(--ink,#f1eee5);padding:0 14px;font:16px system-ui}
.appcard label input:focus{outline:2px solid var(--gold,#dfc18c);outline-offset:1px}
.appcard label.chk{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--ink,#f1eee5);font-weight:500;border:0;padding:0;background:none}
.appcard label.chk input{width:18px;height:18px;accent-color:#c9a766}
.appseg{display:flex;background:#0a1417;border:1px solid var(--line,#ffffff24);border-radius:99px;padding:3px;margin-bottom:16px}
.appseg button{flex:1;border:0;background:none;color:var(--mute,#92a4a8);padding:9px 6px;border-radius:99px;font:700 13px system-ui;cursor:pointer}
.appseg button.on{background:linear-gradient(180deg,#f3dba8,#c9a766);color:#201807}
.apperr{min-height:20px;color:#ff9d92;font:600 13px system-ui;margin:2px 0 10px}
.appgo{width:100%;height:54px;border:0;border-radius:16px;font:700 16px system-ui;background:linear-gradient(180deg,#f3dba8,#c9a766);color:#201807;cursor:pointer;box-shadow:0 8px 28px #c9a76655}
.appgo:disabled{opacity:.5;cursor:wait}
.appgo.ghost{background:#12282b;color:var(--ink,#f1eee5);box-shadow:none;border:1px solid var(--line,#ffffff24)}
.approw{display:flex;gap:10px;margin-top:12px}.approw>*{flex:1}
.acct{position:relative}
.acct>button{display:inline-flex;align-items:center;gap:6px;border-radius:99px;padding:7px 12px;background:#0c1c1fcc;border:1px solid var(--line,#ffffff24);color:inherit;font:600 12px system-ui;cursor:pointer;max-width:150px}
.acct>button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acct ul{position:absolute;right:0;top:calc(100% + 6px);margin:0;padding:5px;list-style:none;min-width:150px;background:#0c1c1ff2;border:1px solid var(--gold,#dfc18c);border-radius:12px;box-shadow:0 14px 34px #000a;display:none;z-index:70}
.acct.open ul{display:block}
.acct li button{width:100%;text-align:left;border:0;background:none;color:#f1eee5;padding:9px 11px;border-radius:8px;font:13px system-ui;cursor:pointer}
.acct li button:hover{background:#ffffff1c}.acct li button.danger{color:#ff9d92}
.lobby-nav:has(.acct.open){z-index:5}
.applink{display:block;margin:12px auto 0;border:0;background:none;color:var(--mute,#92a4a8);font:600 13px system-ui;text-decoration:underline;cursor:pointer}
.appnote{color:var(--mint,#7cedd4);font:600 13px/1.5 system-ui;margin:2px 0 10px}
.prow2{display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--line,#ffffff24);font:14px system-ui}
.prow2 b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prow2 button{border:1px solid var(--line,#ffffff24);background:#12282b;color:inherit;border-radius:99px;padding:7px 12px;font:700 12px system-ui;cursor:pointer}
.prow2 button.warn{border-color:#c9553a;color:#ffb8a0}
.reasons{display:grid;gap:8px;margin:6px 0 12px}
.reasons label{display:flex;align-items:center;gap:10px;margin:0;padding:12px;border:1px solid var(--line,#ffffff24);border-radius:12px;font-size:14px;color:var(--ink,#f1eee5)}
.visbox{margin:0 0 12px}
.visbox .appseg{margin-bottom:8px}
.visbox small{display:block;color:var(--mute,#92a4a8);font-size:12px;margin:0 2px 8px}
.visbox input{display:block;width:100%;height:50px;border-radius:14px;border:1px solid var(--line,#ffffff24);background:#0a1417;color:inherit;padding:0 14px;font:16px system-ui}
.rooms{margin:14px 0 4px}
.rooms h3{display:flex;justify-content:space-between;align-items:center;font:700 11px system-ui;letter-spacing:.2em;color:var(--gold,#dfc18c);margin:0 0 8px}
.rooms h3 span{font-weight:600;letter-spacing:0;color:var(--mute,#92a4a8)}
.rooms .list{max-height:178px;overflow:auto;display:grid;gap:7px}
.rooms .empty{color:var(--mute,#92a4a8);font:13px system-ui;padding:12px;border:1px dashed var(--line,#ffffff24);border-radius:14px;text-align:center}
.roomrow{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:#0a1417;border:1px solid var(--line,#ffffff24);font:13px system-ui}
.roomrow b{display:block;font-size:14px}.roomrow small{color:var(--mute,#92a4a8)}
.roomrow div{flex:1;min-width:0}.roomrow div *{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.roomrow button{border:0;border-radius:99px;padding:8px 14px;font:700 12px system-ui;background:linear-gradient(180deg,#f3dba8,#c9a766);color:#201807;cursor:pointer}
.roomrow button:disabled{opacity:.4;background:#2a3a3d;color:#9db3a6}

/* 앱 랜딩 = 시안 L3: 위쪽은 족보 모션, 아래는 올라오는 시트 (폰·태블릿 폭에서) */
@media(max-width:900px){
body #lobby{padding:0;display:block;height:100dvh;min-height:0;max-width:none}
body #lobby .lobby-nav{position:absolute;left:18px;right:18px;top:max(env(safe-area-inset-top),14px);height:auto;border:0;z-index:6;padding:0}
body #lobby .lobby-layout{display:block;padding:0}
body #lobby .lobby-story{position:absolute;inset:0 0 auto 0;height:calc(100dvh - 44dvh);min-height:0;padding:0;display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch}
body #lobby .royal{order:1;margin:max(86px,calc(env(safe-area-inset-top) + 66px)) 0 0;--cw:clamp(54px,17.5vw,72px)!important}
body #lobby .lobby-nav-actions{gap:6px;flex-wrap:nowrap}
body #lobby .wordmark small{display:none}
body #lobby .motion-toggle{font-size:0;width:34px;height:34px;padding:0;display:grid;place-items:center;flex:none}body #lobby .motion-toggle:after{content:"✦";font-size:14px}
body #lobby .text-btn{width:34px;height:34px;padding:0;border:1px solid var(--line,#ffffff24);border-radius:50%;font-size:0;display:grid;place-items:center;flex:none}body #lobby .text-btn:after{content:"?";font:700 15px system-ui;color:var(--ink,#f1eee5)}body #lobby .text-btn span{display:none}
body #lobby .acct>button{max-width:104px;padding:7px 10px}
body #lobby .lobby-story>.eyebrow{order:2;margin:14px 24px 0;font-size:8px}
body #lobby .lobby-story h1{order:3;margin:8px 24px 0;font-size:27px;line-height:1.2;letter-spacing:-.04em;text-align:left}
body #lobby .lobby-story h1 .ln{display:inline-block}
body #lobby .hero-copy,body #lobby .scene-caption,body #lobby .lobby-footer,body #lobby .entry-copy,body #lobby .entry-note,body #lobby .panel-kicker{display:none}
body #lobby .entry-panel{position:fixed;left:0;right:0;bottom:0;z-index:8;max-height:46dvh;overflow:auto;border-radius:30px 30px 0 0;padding:6px 22px calc(18px + env(safe-area-inset-bottom));border:0;border-top:1px solid #ffffff30;background:linear-gradient(180deg,#10262af5,#0a1417);box-shadow:0 -24px 60px #000c;backdrop-filter:blur(12px);transition:max-height .28s ease}
body #lobby .entry-panel:before{display:none}
body #lobby .entry-panel.up{max-height:88dvh}
body #lobby .entry-panel h2{font-size:20px;margin:6px 0 12px}
.sheetgrab{position:sticky;top:0;z-index:2;display:block;width:100%;height:26px;border:0;background:none;cursor:pointer;margin:0 0 2px}
.sheetgrab:before{content:"";display:block;width:42px;height:5px;border-radius:9px;background:#ffffff4d;margin:10px auto 0}
}
`;
  document.head.appendChild(css);

  // ── 로그인 / 회원가입 화면 ──
  function showLogin() {
    const m = document.createElement('div'); m.className = 'appmask'; m.id = 'appAuth';
    m.innerHTML = `<div class="appcard">
      <div class="apptop"><div class="brand" style="display:flex;align-items:center;gap:10px;font:700 14px/1 system-ui;letter-spacing:.16em"><span style="width:30px;height:30px;border-radius:9px;border:1px solid #ffffff24;background:#0c1c1f;display:grid;place-items:center;color:#dfc18c;font-size:16px">♠</span><span>AFTER HOURS</span></div><span class="langslot" data-i18n-skip></span></div>
      <div class="eyebrow">WELCOME</div><h2 id="authTitle">로그인</h2>
      <div class="appseg" role="tablist"><button type="button" data-tab="login" class="on">로그인</button><button type="button" data-tab="signup">회원가입</button></div>
      <form id="authForm" novalidate>
        <label>아이디<input name="username" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="20" placeholder="영문 소문자·숫자·밑줄 4~20자"></label>
        <label data-su hidden>닉네임<small>게임에서 보이는 이름</small><input name="nickname" autocomplete="nickname" maxlength="12" placeholder="2~12자"></label>
        <label data-su hidden>이메일<small>비밀번호를 잊었을 때만 써요</small><input name="email" type="email" autocomplete="email" autocapitalize="off" maxlength="120" placeholder="name@example.com"></label>
        <label>비밀번호<input name="password" type="password" autocomplete="current-password" maxlength="64" placeholder="8자 이상"></label>
        <label data-su hidden>비밀번호 확인<input name="password2" type="password" autocomplete="new-password" maxlength="64"></label>
        <label class="chk" data-su hidden><input name="agree" type="checkbox"><span>만 17세 이상이며 <a href="/privacy.html" target="_blank" rel="noopener" style="color:#dfc18c">개인정보처리방침</a>에 동의해요</span></label>
        <label class="chk"><input name="remember" type="checkbox" checked>내 계정 기억하기 (자동 로그인)</label>
        <div class="apperr" role="alert"></div>
        <button class="appgo" type="submit">로그인</button>
        <button class="applink" type="button" data-forgot>비밀번호를 잊으셨나요?</button>
      </form></div>`;
    document.body.appendChild(m);
    if (window.I18N && window.I18N.mount) window.I18N.mount($('.langslot', m));
    let tab = 'login';
    const f = $('#authForm', m), err = $('.apperr', m), go = $('.appgo', m);
    const setTab = (t) => {
      tab = t; err.textContent = '';
      m.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
      m.querySelectorAll('[data-su]').forEach((l) => (l.hidden = t !== 'signup'));
      $('[data-forgot]', m).hidden = t !== 'login';
      $('#authTitle', m).textContent = t === 'login' ? '로그인' : '회원가입';
      go.textContent = t === 'login' ? '로그인' : '가입하고 시작하기';
      f.password.autocomplete = t === 'login' ? 'current-password' : 'new-password';
    };
    m.querySelector('.appseg').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); };
    f.onsubmit = async (e) => {
      e.preventDefault(); err.textContent = '';
      const v = Object.fromEntries(new FormData(f));
      if (!v.username.trim() || !v.password) return (err.textContent = '아이디와 비밀번호를 입력해 주세요');
      if (tab === 'signup' && v.password !== v.password2) return (err.textContent = '비밀번호가 서로 달라요');
      if (tab === 'signup' && !v.email.trim()) return (err.textContent = '이메일 주소를 확인해 주세요');
      if (tab === 'signup' && !v.agree) return (err.textContent = '만 17세 이상이며 개인정보처리방침에 동의해야 가입할 수 있어요');
      go.disabled = true;
      try {
        const r = await api(tab === 'login' ? '/api/login' : '/api/signup', { username: v.username, password: v.password, nickname: v.nickname, email: v.email, agree: !!v.agree, remember: !!v.remember });
        if (!r.ok) { err.textContent = r.error || '잠시 뒤에 다시 해 주세요'; return; }
        setToken(r.token, !!v.remember); A.user = r.user; m.remove(); done();
      } catch { err.textContent = '서버에 연결할 수 없어요. 잠시 뒤에 다시 해 주세요'; } finally { go.disabled = false; }
    };
    $('[data-forgot]', m).onclick = () => { m.remove(); showForgot(); };
    setTimeout(() => f.username.focus(), 50);
  }

  // ── 비밀번호 찾기 / 재설정 ──
  function card(html) {
    const m = document.createElement('div'); m.className = 'appmask'; m.innerHTML = `<div class="appcard">${html}</div>`; document.body.appendChild(m); return m;
  }
  function showForgot() {
    const m = card(`<div class="eyebrow">ACCOUNT</div><h2>비밀번호 찾기</h2><p style="color:#92a4a8;font:14px/1.6 system-ui;margin-bottom:14px">가입할 때 쓴 이메일을 입력하면 재설정 링크를 보내 드려요.</p><label>이메일<input type="email" autocomplete="email" autocapitalize="off" maxlength="120" placeholder="name@example.com"></label><div class="appnote" hidden></div><div class="apperr" role="alert"></div><div class="approw"><button class="appgo ghost" data-x>돌아가기</button><button class="appgo" data-ok>링크 받기</button></div>`);
    const inp = $('input', m), note = $('.appnote', m), err = $('.apperr', m);
    $('[data-x]', m).onclick = () => { m.remove(); showLogin(); };
    $('[data-ok]', m).onclick = async () => {
      err.textContent = ''; if (!inp.value.trim()) return (err.textContent = '이메일 주소를 확인해 주세요');
      try { await api('/api/forgot', { email: inp.value }); note.hidden = false; note.textContent = '가입한 이메일이라면 재설정 링크를 보냈어요. 메일함을 확인해 주세요 (30분 안에 쓸 수 있어요)'; } catch { err.textContent = '서버에 연결할 수 없어요. 잠시 뒤에 다시 해 주세요'; }
    };
    inp.focus();
  }
  function showReset(token) {
    const m = card(`<div class="eyebrow">ACCOUNT</div><h2>새 비밀번호</h2><label>새 비밀번호<input name="p1" type="password" autocomplete="new-password" maxlength="64" placeholder="8자 이상"></label><label>새 비밀번호 확인<input name="p2" type="password" autocomplete="new-password" maxlength="64"></label><div class="apperr" role="alert"></div><button class="appgo" data-ok>비밀번호 바꾸기</button>`);
    const [p1, p2] = m.querySelectorAll('input'), err = $('.apperr', m);
    $('[data-ok]', m).onclick = async () => {
      err.textContent = ''; if (p1.value !== p2.value) return (err.textContent = '비밀번호가 서로 달라요');
      const r = await api('/api/reset', { token, password: p1.value });
      if (!r.ok) return (err.textContent = r.error || '다시 해 주세요');
      history.replaceState(null, '', location.pathname); clearToken(); m.remove(); showLogin(); const e = $('.apperr', $('#appAuth')); if (e) { e.className = 'appnote'; e.textContent = '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요'; }
    };
    p1.focus();
  }

  // ── 시작할 때: 저장된 로그인으로 자동 로그인 ──
  async function boot() {
    const rt = new URLSearchParams(location.search).get('reset'); // 메일의 재설정 링크로 들어온 경우
    if (rt) { showReset(rt); return; }
    const t = getToken();
    if (t) {
      try { const r = await api('/api/me'); if (r.ok) { A.user = r.user; return done(); } if (r.status === 401) clearToken(); } catch {}
    }
    showLogin();
  }

  // ── 방 만들기 옵션 / 열린 방 목록 / 계정 메뉴 ──
  let vis = 'open', pendingPw = '';
  function decorate() {
    const nick = A.user.nickname;
    const nm = $('#name'); if (nm) { nm.value = nick; nm.hidden = true; const lb = $('label[for=name]'); if (lb) lb.hidden = true; }
    const t = $('#entryTitle'); if (t) t.textContent = `반가워요, ${nick} 님.`;
    const c = $('.entry-copy'); if (c) c.textContent = '오늘의 테이블을 열어볼까요?';
    const stt = $('#settleTitle'); if (stt) stt.textContent = '🏆 최종 순위';
    const note = $('.guide-note'); if (note) note.remove();
    document.querySelectorAll('.lobby-footer div span').forEach((s) => { if (/가상 칩/.test(s.textContent)) { const i = s.previousElementSibling; if (i && i.tagName === 'I') i.remove(); s.remove(); } });
    const steps = [...document.querySelectorAll('dialog p, dialog li, .guide p')];
    steps.forEach((p) => { if (/바이인/.test(p.textContent) && /닉네임/.test(p.textContent)) p.textContent = '시작 칩·블라인드·리바인 횟수를 정하고, 방을 오픈형으로 할지 비밀번호를 건 비공개로 할지 골라요.'; if (/정산 결과/.test(p.textContent)) p.textContent = '방장이 게임을 종료하면 현재 핸드를 마친 뒤 모두에게 최종 칩 순위가 표시돼요.'; });

    const create = $('#create');
    if (create && !$('.visbox')) {
      const v = document.createElement('div'); v.className = 'visbox';
      v.innerHTML = `<div class="eyebrow" style="margin-bottom:8px">방 공개 범위</div><div class="appseg"><button type="button" data-vis="open" class="on">오픈형</button><button type="button" data-vis="private">비공개</button></div><small id="visHint">누구나 목록에서 보고, 빈자리가 있으면 들어올 수 있어요</small><input id="roomPw" type="password" maxlength="20" autocomplete="off" placeholder="방 비밀번호 (4~20자)" hidden>`;
      create.before(v);
      v.querySelector('.appseg').onclick = (e) => {
        const b = e.target.closest('[data-vis]'); if (!b) return; vis = b.dataset.vis;
        v.querySelectorAll('[data-vis]').forEach((x) => x.classList.toggle('on', x === b));
        $('#roomPw').hidden = vis !== 'private';
        $('#visHint').textContent = vis === 'open' ? '누구나 목록에서 보고, 빈자리가 있으면 들어올 수 있어요' : '비밀번호를 아는 사람만 들어올 수 있어요';
      };
    }
    const panel = $('.entry-panel');
    if (panel && !$('.sheetgrab')) {
      const g = document.createElement('button'); g.type = 'button'; g.className = 'sheetgrab'; g.setAttribute('aria-label', '시트 펼치기/접기');
      g.onclick = () => panel.classList.toggle('up'); panel.prepend(g);
    }
    const joinRow = $('.or');
    if (joinRow && !$('.rooms')) {
      const r = document.createElement('div'); r.className = 'rooms';
      r.innerHTML = `<h3>지금 열린 방 <span id="roomCount"></span></h3><div class="list" id="roomList"></div>`;
      joinRow.before(r); refreshRooms();
    }
    const nav = $('.lobby-nav-actions');
    if (nav && !$('.acct')) {
      const a = document.createElement('div'); a.className = 'acct';
      a.innerHTML = `<button type="button" aria-haspopup="menu">👤 <span data-i18n-skip>${esc(nick)}</span> ▾</button><ul role="menu"><li><button type="button" data-acct="blocks">차단 목록</button></li><li><button type="button" data-acct="privacy">개인정보처리방침</button></li><li><button type="button" data-acct="out">로그아웃</button></li><li><button type="button" class="danger" data-acct="del">회원 탈퇴</button></li></ul>`;
      nav.prepend(a);
      a.firstElementChild.onclick = (e) => { e.stopPropagation(); a.classList.toggle('open'); };
      document.addEventListener('click', () => a.classList.remove('open'));
      a.querySelector('ul').onclick = (e) => { const b = e.target.closest('[data-acct]'); if (!b) return; a.classList.remove('open'); if (b.dataset.acct === 'out') logout(); else if (b.dataset.acct === 'blocks') showBlocks(); else if (b.dataset.acct === 'privacy') window.open('/privacy.html', '_blank', 'noopener'); else askDelete(); };
    }
  }
  async function refreshRooms() {
    const lobby = $('#lobby'), list = $('#roomList'); if (!list) return;
    if (lobby && lobby.hidden) return;
    try {
      const r = await api('/api/rooms');
      if (r.status === 401) { clearToken(); return location.reload(); }
      if (!r.ok) return;
      $('#roomCount').textContent = r.rooms.length ? `${r.rooms.length}` : '';
      list.innerHTML = r.rooms.length ? r.rooms.map((x) => `<div class="roomrow"><div><b>${esc(x.host)}</b><small>${x.players}/${x.max}명 · ${x.sb}/${x.bb} · ${x.started ? '게임 중' : '대기 중'}</small></div><button data-room="${esc(x.code)}" ${x.players >= x.max ? 'disabled' : ''}>${x.players >= x.max ? '가득 참' : '입장'}</button></div>`).join('') : '<div class="empty">지금 열린 방이 없어요. 첫 방을 열어 볼까요?</div>';
    } catch {}
  }
  setInterval(() => { if (!document.hidden) refreshRooms(); }, 4000);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-room]'); if (!b || b.disabled) return;
    const code = $('#code'); if (code) { code.value = b.dataset.room; $('#join').click(); }
  });

  async function showBlocks() {
    const m = card(`<div class="eyebrow">SAFETY</div><h2>차단 목록</h2><div id="blkList"></div><div class="approw"><button class="appgo ghost" data-x>닫기</button></div>`);
    $('[data-x]', m).onclick = () => m.remove();
    const draw = async () => {
      const r = await api('/api/blocks'), box = $('#blkList', m);
      box.innerHTML = (r.blocks || []).length ? r.blocks.map((b) => `<div class="prow2"><b data-i18n-skip>${esc(b.nickname)}</b><button data-un="${esc(b.id)}">차단 해제</button></div>`).join('') : '<div class="empty" style="color:#92a4a8;padding:14px 0">차단한 사람이 없어요</div>';
    };
    m.addEventListener('click', async (e) => { const b = e.target.closest('[data-un]'); if (!b) return; await api('/api/unblock', { id: b.dataset.un }); draw(); });
    draw();
  }
  async function logout() { try { await api('/api/logout', {}); } catch {} clearToken(); location.href = location.pathname; }
  function askDelete() {
    const m = document.createElement('div'); m.className = 'appmask';
    m.innerHTML = `<div class="appcard"><h2>회원 탈퇴</h2><p style="color:#92a4a8;font:14px/1.6 system-ui;margin-bottom:14px">계정이 바로 삭제되고 되돌릴 수 없어요. 계속하려면 비밀번호를 입력해 주세요.</p><label>비밀번호<input type="password" autocomplete="current-password" maxlength="64"></label><div class="apperr" role="alert"></div><div class="approw"><button class="appgo ghost" data-x>취소</button><button class="appgo" data-ok style="background:#c9553a;color:#fff;box-shadow:none">탈퇴하기</button></div></div>`;
    document.body.appendChild(m);
    const inp = $('input', m), err = $('.apperr', m);
    $('[data-x]', m).onclick = () => m.remove();
    $('[data-ok]', m).onclick = async () => {
      err.textContent = ''; const r = await api('/api/delete-account', { password: inp.value });
      if (!r.ok) return (err.textContent = r.error || '다시 해 주세요');
      clearToken(); location.href = location.pathname;
    };
    inp.focus();
  }

  // ── 비공개 방 비밀번호 입력 ──
  function askPassword(room) {
    const m = document.createElement('div'); m.className = 'appmask';
    m.innerHTML = `<div class="appcard"><div class="eyebrow">PRIVATE TABLE</div><h2>비공개 방이에요</h2><label>방 비밀번호<input type="password" autocomplete="off" maxlength="20"></label><div class="apperr" role="alert"></div><div class="approw"><button class="appgo ghost" data-x>취소</button><button class="appgo" data-ok>입장</button></div></div>`;
    document.body.appendChild(m);
    const inp = $('input', m);
    const ok = () => { if (!inp.value) return; pendingPw = inp.value; m.remove(); window.appApi.join(room); };
    $('[data-ok]', m).onclick = ok; $('[data-x]', m).onclick = () => { m.remove(); };
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && ok());
    inp.focus();
  }

  // index.html 과 이어지는 곳
  window.appJoinExtra = (room) => ({ auth: getToken(), ...(room === '' ? { vis, password: vis === 'private' ? ($('#roomPw') || {}).value : undefined } : pendingPw ? { password: pendingPw } : {}) });
  window.appHandleError = (m) => {
    if (m.auth) { clearToken(); location.reload(); return true; }
    if (m.needPw) {
      if (m.msg && /맞지/.test(m.msg)) { const e = $('#err'); if (e) e.textContent = m.msg; }
      pendingPw = ''; askPassword(m.room || ''); return true;
    }
    return false;
  };
  // 게임 화면의 신고·차단 (같은 방의 사람 목록에서 고른다)
  function gameTools() {
    const top = $('#game .top'); if (!top || $('#rbBtn')) return;
    const b = document.createElement('button'); b.className = 'pill'; b.id = 'rbBtn'; b.title = '신고·차단'; b.setAttribute('aria-label', '신고·차단'); b.textContent = '🚩';
    const sb = $('#sndBtn'); top.insertBefore(b, sb && sb.parentNode === top ? sb : null); b.onclick = openSafety;
  }
  function openSafety() {
    const S = window.appApi.getState(); if (!S) return;
    const people = S.players.map((p, i) => ({ p, i })).filter(({ p, i }) => !p.bot && i !== S.me);
    const m = card(`<div class="eyebrow">SAFETY</div><h2>신고·차단</h2><p style="color:#92a4a8;font:13px/1.6 system-ui;margin-bottom:8px">불쾌한 사람을 신고하면 운영자가 확인해요. 차단하면 그 사람의 채팅이 내 화면에서 사라져요.</p>${people.length ? people.map(({ p, i }) => `<div class="prow2"><b data-i18n-skip>${esc(p.name)}</b><button data-rep="${i}">신고</button><button class="warn" data-blk="${i}">차단</button></div>`).join('') : '<div style="color:#92a4a8;padding:14px 0">같은 방에 다른 사람이 없어요</div>'}<div class="approw"><button class="appgo ghost" data-x>닫기</button></div>`);
    $('[data-x]', m).onclick = () => m.remove();
    m.addEventListener('click', (e) => {
      const r = e.target.closest('[data-rep]'), bl = e.target.closest('[data-blk]');
      if (bl) { window.appApi.send({ t: 'block', i: +bl.dataset.blk }); m.remove(); }
      if (r) { const i = +r.dataset.rep; m.remove(); askReason(i); }
    });
  }
  function askReason(i) {
    const m = card(`<div class="eyebrow">SAFETY</div><h2>신고 이유</h2><div class="reasons">${['욕설·괴롭힘', '불쾌한 닉네임·내용', '부정행위', '기타'].map((r, k) => `<label><input type="radio" name="rs" value="${r}" ${k === 0 ? 'checked' : ''}>${r}</label>`).join('')}</div><div class="approw"><button class="appgo ghost" data-x>취소</button><button class="appgo" data-ok>신고하기</button></div>`);
    $('[data-x]', m).onclick = () => m.remove();
    $('[data-ok]', m).onclick = () => { const v = (m.querySelector('input:checked') || {}).value; window.appApi.send({ t: 'report', i, reason: v }); m.remove(); };
  }
  A.ready.then(() => { decorate(); gameTools(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
