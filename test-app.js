'use strict';
// 앱 모드 시험: 가입·로그인·세션·탈퇴, 오픈/비공개 방, 칩 전용 정산.  사용: node test-app.js
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const WebSocket = require('ws');
const { Table } = require('./engine');

let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('  ✗', msg); } else console.log('  ✓', msg); };
const PORT = 3400 + Math.floor(Math.random() * 400);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holdem-app-'));
const base = `http://localhost:${PORT}`;
const call = async (p, body, token) => { if (p === '/api/signup' && body && body.email === undefined) body = { ...body, email: String(body.username).replace(/[^a-z0-9_]/gi, '') + '@x.test' };
  if (p === '/api/signup' && body && body.agree === undefined) body = { ...body, agree: true }; const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; };
const open = () => new Promise((res) => { const ws = new WebSocket(`ws://localhost:${PORT}`); ws.msgs = []; ws.on('message', (d) => ws.msgs.push(JSON.parse(d))); ws.on('open', () => res(ws)); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const last = (ws, t) => [...ws.msgs].reverse().find((m) => m.t === t);

(async () => {
  console.log('── 엔진: 칩 전용(noMoney) ──');
  const t = new Table({ auto: false, pace: false, noMoney: true });
  ok(t.applySettings({ chips: 5000, sb: 50, bb: 100, blindMinutes: 0, maxRebuys: 1 }) === null && t.startChips === 5000 && t.buyIn === 5000, '시작 칩만으로 설정되고 바이인 = 시작 칩');
  t.addPlayer('tok-aaaaaaaa', 'A'); t.addPlayer('tok-bbbbbbbb', 'B'); t.start('tok-aaaaaaaa');
  for (let g = 0; t.inProgress() && g < 20; g++) t.act(t.players[t.toAct].token, 'fold'); // 한 판을 끝낸 뒤에 종료(진행 중에는 정산하지 않는다)
  t.finishGame('host');
  const st = t.view('tok-aaaaaaaa').settlement;
  ok(st && st.rows.length === 2 && st.rows.every((r) => r.netChips !== undefined && r.invested === undefined && r.value === undefined && r.net === undefined), '정산에 돈 칸(투입 금액·환산)이 없고 칩 손익만 있음');
  ok(st.transfers === undefined && st.totals === undefined && st.buyInWon === undefined, '송금 안내·합계가 서버에서 아예 나가지 않음');
  const t2 = new Table({ auto: false, pace: false });
  t2.addPlayer('tok-aaaaaaaa', 'A'); t2.addPlayer('tok-bbbbbbbb', 'B'); t2.start('tok-aaaaaaaa'); for (let g = 0; t2.inProgress() && g < 20; g++) t2.act(t2.players[t2.toAct].token, 'fold'); t2.finishGame('host');
  ok(Array.isArray(t2.view('tok-aaaaaaaa').settlement.transfers), '웹(기본) 모드는 지금처럼 송금 안내가 있음');

  console.log('── 서버 기동 (앱 모드) ──');
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, HOLDEM_APP: '1', HOLDEM_DATA: dir, HOLDEM_FAST: '1', HOLDEM_MAIL_DIR: path.join(dir, 'mail'), HOLDEM_ADMIN_TOKEN: 'admin-token-0123456789' }, stdio: 'ignore' });
  await wait(900);
  try {
    ok((await call('/api/config')).app === true, '/api/config 가 앱 모드를 알림');
    const html = await (await fetch(base + '/')).text();
    ok(html.includes('window.APP_MODE=true'), 'index.html 에 앱 모드 표시가 심어짐');

    console.log('── 가입 / 로그인 ──');
    ok((await call('/api/signup', { username: 'ab', password: 'password1', nickname: '철수' })).error?.includes('아이디'), '짧은 아이디 거부');
    ok((await call('/api/signup', { username: 'chulsoo', password: 'short', nickname: '철수' })).error?.includes('8자'), '짧은 비밀번호 거부');
    ok((await call('/api/signup', { username: 'chulsoo', password: 'password1', nickname: '<b>' })).error?.includes('닉네임'), '특수문자 닉네임 거부');
    const a = await call('/api/signup', { username: 'Chulsoo', password: 'password1', nickname: '철수', remember: true });
    ok(a.status === 200 && a.token && a.user.nickname === '철수', '가입 성공 → 토큰');
    ok((await call('/api/signup', { username: 'chulsoo', password: 'password1', nickname: '영희' })).error?.includes('아이디'), '같은 아이디(대소문자 무시) 거부');
    ok((await call('/api/signup', { username: 'other01', password: 'password1', nickname: '철수' })).error?.includes('닉네임'), '같은 닉네임 거부');
    const b = await call('/api/signup', { username: 'younghee', password: 'password2', nickname: '영희' });
    ok(b.status === 200, '두 번째 계정 가입');
    ok((await call('/api/me', null, a.token)).user?.nickname === '철수', '토큰으로 내 정보 확인(자동 로그인 경로)');
    ok((await call('/api/me', null, 'x'.repeat(43))).status === 401 && (await call('/api/me')).status === 401, '잘못된·없는 토큰은 401');
    ok((await call('/api/login', { username: 'chulsoo', password: 'wrongpass' })).status === 401, '틀린 비밀번호 거부');
    const a2 = await call('/api/login', { username: 'chulsoo', password: 'password1' });
    ok(a2.status === 200 && a2.token !== a.token, '로그인 성공(새 토큰)');
    const users = fs.readFileSync(path.join(dir, 'users.json'), 'utf8'), sess = fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8');
    ok(!users.includes('password1') && !sess.includes(a.token) && !sess.includes(a2.token), '파일에 비밀번호·세션 토큰 원문이 없음');
    ok((fs.statSync(path.join(dir, 'users.json')).mode & 0o077) === 0, '계정 파일은 나만 읽을 수 있음');

    console.log('── 방: 로그인 필수 / 오픈 · 비공개 ──');
    const anon = await open();
    anon.send(JSON.stringify({ t: 'join', room: '', name: '아무개', token: 'anon-token-123', vis: 'open' }));
    await wait(200);
    ok(last(anon, 'error')?.auth === true && !last(anon, 'state'), '로그인 없이는 방에 못 들어감');
    const forged = await open();
    forged.send(JSON.stringify({ t: 'join', room: '', name: '철수', token: a.token, auth: 'f'.repeat(43) }));
    await wait(200);
    ok(last(forged, 'error')?.auth === true, '가짜 토큰도 거부');

    const w1 = await open();
    w1.send(JSON.stringify({ t: 'join', room: '', name: '가짜이름', token: 'ignored-token-1', auth: a.token, vis: 'open', settings: { chips: 5000, sb: 50, bb: 100, blindMinutes: 0, maxRebuys: 1 } }));
    await wait(300);
    const s1 = last(w1, 'state');
    ok(s1 && s1.players[s1.me].name === '철수', '이름은 계정 닉네임(보낸 이름은 무시)');
    ok(s1.startChips === 5000 && s1.settlement === null, '칩 단위 설정으로 방 생성');
    const openCode = s1.room;
    const list = await call('/api/rooms', null, b.token);
    ok(list.rooms?.some((r) => r.code === openCode && r.host === '철수' && r.players === 1 && r.max === 10), '오픈형 방은 목록에 보임');
    ok((await call('/api/rooms')).status === 401, '목록은 로그인해야 볼 수 있음');

    const w2 = await open();
    w2.send(JSON.stringify({ t: 'join', room: openCode, token: 'ignored-token-2', auth: b.token }));
    await wait(300);
    ok(last(w2, 'state')?.players.length === 2, '오픈형 방은 비밀번호 없이 입장');

    const w3 = await open();
    w3.send(JSON.stringify({ t: 'join', room: '', token: 'ignored-token-3', auth: a.token, vis: 'private' }));
    await wait(200);
    ok(last(w3, 'error')?.msg.includes('비밀번호') && !last(w3, 'state'), '비공개 방은 비밀번호 없이 못 만듦');
    w3.send(JSON.stringify({ t: 'join', room: '', token: 'ignored-token-3', auth: a.token, vis: 'private', password: 'abcd' }));
    await wait(300);
    const privCode = last(w3, 'state')?.room;
    ok(!!privCode, '비공개 방 생성 (방장은 비밀번호를 정함)');
    ok(!(await call('/api/rooms', null, b.token)).rooms.some((r) => r.code === privCode), '비공개 방은 목록에 안 보임');

    const w4 = await open();
    w4.send(JSON.stringify({ t: 'join', room: privCode, token: 'x-token-0001', auth: b.token }));
    await wait(200);
    ok(last(w4, 'error')?.needPw === true && !last(w4, 'state'), '비밀번호 없이 비공개 방 입장 막힘 (비밀번호를 물어봄)');
    w4.send(JSON.stringify({ t: 'join', room: privCode, token: 'x-token-0001', auth: b.token, password: 'wrong' }));
    await wait(200);
    ok(last(w4, 'error')?.msg.includes('맞지') && !last(w4, 'state'), '틀린 비밀번호 거부');
    w4.send(JSON.stringify({ t: 'join', room: privCode, token: 'x-token-0001', auth: b.token, password: 'abcd' }));
    await wait(300);
    ok(last(w4, 'state')?.players.length === 2, '맞는 비밀번호로 입장');
    const w5 = await open();
    w5.send(JSON.stringify({ t: 'join', room: privCode, token: 'x', auth: a.token })); // 방장 다시 접속: 비밀번호 필요 없음
    await wait(300);
    ok(last(w5, 'state')?.isHost === true, '이미 앉은 사람(방장)은 다시 접속할 때 비밀번호 불필요');
    const c = await call('/api/signup', { username: 'minsu03', password: 'password3', nickname: '민수' });
    const w6 = await open();
    for (let i = 0; i < 6; i++) { w6.send(JSON.stringify({ t: 'join', room: privCode, token: 'x', auth: c.token, password: 'bad' + i })); await wait(60); }
    await wait(200);
    ok(w6.readyState !== 1, '비밀번호를 연달아 틀리면 연결이 끊김');
    ok(!JSON.stringify(last(w4, 'state')).includes('abcd'), '상태에 방 비밀번호가 실리지 않음');

    ok((await call('/api/signup', { username: 'noagree1', password: 'password1', nickname: '동의안함', agree: false })).error?.includes('동의'), '연령·개인정보 동의 없이는 가입 못 함');
    console.log('── 이메일 · 닉네임 필터 ──');
    ok((await call('/api/signup', { username: 'mailbad1', password: 'password1', nickname: '영수', email: 'not-an-email' })).error?.includes('이메일'), '이메일 형식이 틀리면 거부');
    ok((await call('/api/signup', { username: 'mailbad2', password: 'password1', nickname: '영수', email: 'chulsoo@x.test' })).error?.includes('이메일'), '같은 이메일로 두 번 가입 못 함');
    ok((await call('/api/signup', { username: 'badnick1', password: 'password1', nickname: '씨 발 놈' })).error?.includes('닉네임'), '욕설 닉네임 거부 (띄어쓰기로 피해도)');

    console.log('── 채팅 필터 · 차단 · 신고 ──');
    w1.send(JSON.stringify({ t: 'chat', text: '시 발 안녕' })); await wait(250);
    ok(last(w2, 'chat')?.m.text === '*** 안녕', '욕설은 *** 로 가려져서 전달됨');
    w2.send(JSON.stringify({ t: 'block', i: 0 })); await wait(250);
    ok(last(w2, 'notice')?.msg.includes('차단'), '차단 성공 안내');
    const before = w2.msgs.filter((m) => m.t === 'chat').length;
    await wait(1300); w1.send(JSON.stringify({ t: 'chat', text: '차단 뒤 메시지' })); await wait(250);
    ok(w2.msgs.filter((m) => m.t === 'chat').length === before && last(w1, 'chat')?.m.text === '차단 뒤 메시지', '차단한 사람의 채팅은 내게 안 오고, 보낸 사람 화면엔 그대로');
    w1.send(JSON.stringify({ t: 'emote', k: 'text', text: '반가워요' })); await wait(300);
    ok(last(w1, 'state').events.some((e) => e.text === '반가워요') && !last(w2, 'state').events.some((e) => e.text === '반가워요'), '차단한 사람의 한마디 말풍선도 내게는 안 옴 (본인과 다른 사람에겐 그대로)');
    const bl = await call('/api/blocks', null, b.token);
    ok(bl.blocks?.length === 1 && bl.blocks[0].nickname === '철수', '차단 목록에 보임');
    await call('/api/unblock', { id: bl.blocks[0].id }, b.token);
    await wait(1300); w1.send(JSON.stringify({ t: 'chat', text: '해제 뒤 메시지' })); await wait(250);
    ok(last(w2, 'chat')?.m.text === '해제 뒤 메시지', '차단 해제하면 다시 옴');
    await wait(2600); w1.send(JSON.stringify({ t: 'emote', k: 'text', text: '다시 안녕' })); await wait(300);
    ok(last(w2, 'state').events.some((e) => e.text === '다시 안녕'), '차단을 풀면 말풍선도 다시 옴');
    w2.send(JSON.stringify({ t: 'block', i: 1 })); await wait(200);
    ok(last(w2, 'error')?.msg.includes('없는'), '나 자신은 차단할 수 없음');
    w2.send(JSON.stringify({ t: 'report', i: 0, reason: '욕설·괴롭힘' })); await wait(250);
    ok(last(w2, 'notice')?.msg.includes('신고'), '신고 접수 안내');
    ok((await fetch(base + '/api/admin/reports')).status === 403, '운영자 토큰 없이는 신고 목록을 못 봄');
    const rep = await (await fetch(base + '/api/admin/reports', { headers: { 'x-admin-token': 'admin-token-0123456789' } })).json();
    ok(rep.reports?.[0]?.targetName === '철수' && rep.reports[0].reporterName === '영희' && rep.reports[0].context.includes('안녕'), '운영자는 신고와 최근 채팅을 볼 수 있음');

    console.log('── 비밀번호 재설정 ──');
    const c2 = await call('/api/signup', { username: 'resetme1', password: 'oldpassword1', nickname: '잊은이', email: 'forgetful@x.test' });
    await call('/api/forgot', { email: 'nobody@x.test' }); await wait(150);
    const mailDir = path.join(dir, 'mail');
    ok(!fs.existsSync(mailDir) || fs.readdirSync(mailDir).length === 0, '없는 이메일엔 메일을 보내지 않음 (응답은 똑같이 성공)');
    ok((await call('/api/forgot', { email: 'forgetful@x.test' })).ok === true, '재설정 요청 응답');
    await wait(300);
    const mail = fs.readdirSync(mailDir).map((f) => fs.readFileSync(path.join(mailDir, f), 'utf8'))[0] || '';
    const tok = (mail.match(/\?reset=([A-Za-z0-9_-]+)/) || [])[1];
    ok(!!tok && mail.includes('forgetful@x.test'), '가입한 이메일로 링크가 감');
    ok((await call('/api/reset', { token: tok, password: 'short' })).error?.includes('8자'), '새 비밀번호가 짧으면 거부');
    ok((await call('/api/reset', { token: 'wrong-token', password: 'newpassword1' })).status === 400, '틀린 링크 거부');
    ok((await call('/api/reset', { token: tok, password: 'newpassword1' })).ok === true, '비밀번호 재설정 성공');
    ok((await call('/api/reset', { token: tok, password: 'another-pass1' })).status === 400, '링크는 한 번만 쓸 수 있음');
    ok((await call('/api/login', { username: 'resetme1', password: 'oldpassword1' })).status === 401 && (await call('/api/login', { username: 'resetme1', password: 'newpassword1' })).status === 200, '옛 비밀번호는 안 되고 새 비밀번호로 로그인');
    ok((await call('/api/me', null, c2.token)).status === 401, '재설정하면 기존 로그인(다른 기기)은 모두 풀림');

    console.log('── 이용 제한 ──');
    const d = await call('/api/signup', { username: 'dave0004', password: 'password4', nickname: '데이브' });
    const wd = await open();
    wd.send(JSON.stringify({ t: 'join', room: openCode, token: 'x', auth: d.token })); await wait(300);
    ok(last(wd, 'state')?.players.length >= 2, '(준비) 제한받을 사람이 방에 있음');
    const adm = { 'x-admin-token': 'admin-token-0123456789', 'Content-Type': 'application/json' };
    ok((await (await fetch(base + '/api/admin/ban', { method: 'POST', headers: adm, body: JSON.stringify({ username: 'dave0004' }) })).json()).ok === true, '이용 제한 걸기');
    await wait(300);
    ok(wd.readyState !== 1, '접속 중이던 사람은 바로 내보내짐');
    ok((await call('/api/login', { username: 'dave0004', password: 'password4' })).error?.includes('제한'), '제한된 계정은 로그인 못 함');
    ok((await call('/api/me', null, d.token)).status === 401, '제한되면 기존 로그인도 무효');
    await fetch(base + '/api/admin/ban', { method: 'POST', headers: adm, body: JSON.stringify({ username: 'dave0004', on: false }) });
    ok((await call('/api/login', { username: 'dave0004', password: 'password4' })).status === 200, '제한을 풀면 다시 로그인');
    try { wd.close(); } catch {}

    console.log('── 시도 제한 / 탈퇴 ──');
    let limited = false;
    for (let i = 0; i < 12; i++) { const r = await call('/api/login', { username: 'younghee', password: 'nope-' + i }); if (r.error?.includes('너무 많')) limited = true; }
    ok(limited, '로그인을 계속 틀리면 잠시 막힘');
    ok((await call('/api/delete-account', { password: 'wrong' }, a.token)).status === 400, '탈퇴: 틀린 비밀번호 거부');
    ok((await call('/api/delete-account', { password: 'password1' }, a.token)).ok === true || (await call('/api/me', null, a.token)).status === 401, '탈퇴: 비밀번호 확인 후 삭제');
    ok((await call('/api/me', null, a.token)).status === 401 && (await call('/api/me', null, a2.token)).status === 401, '탈퇴 후 그 계정의 모든 토큰이 무효');
    ok((await call('/api/signup', { username: 'chulsoo', password: 'password1', nickname: '철수' })).status === 200, '탈퇴한 아이디·닉네임은 다시 쓸 수 있음');
    for (const w of [anon, forged, w1, w2, w3, w4, w5, w6]) try { w.close(); } catch {}
  } finally { srv.kill(); }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
