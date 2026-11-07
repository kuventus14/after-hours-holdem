'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const { Table, MAX_PLAYERS } = require('./engine');
const { tick: tickBots } = require('./bot');
const { createAuth } = require('./auth');
const { clean } = require('./filter');
const { sendMail } = require('./mailer');

const PORT = process.env.PORT || 3000;
// 앱 모드(HOLDEM_APP=1): 로그인 필수 · 오픈/비공개 방 · 돈(원) 개념 없는 칩 전용. 켜지 않으면 지금까지의 웹 게임 그대로다.
const APP = !!process.env.HOLDEM_APP;
const ORIGIN = process.env.HOLDEM_ORIGIN || `http://localhost:${PORT}`; // 재설정 메일 링크의 주소 (요청 헤더를 믿지 않는다)
const uidByTok = new Map(); // 게임 자리 열쇠 → 계정 번호 (차단·신고에 쓴다)
const auth = APP ? createAuth(process.env.HOLDEM_DATA || path.join(__dirname, 'data')) : null;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
function readJson(req) {
  return new Promise((resolve) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 4096) { resolve(null); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { const o = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); resolve(o && typeof o === 'object' && !Array.isArray(o) ? o : null); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
const bearer = (req) => { const h = String(req.headers.authorization || ''); return h.startsWith('Bearer ') ? h.slice(7) : ''; };
// shortcut: 접속 주소는 소켓 주소만 쓴다(프록시 뒤에서는 모두 같은 주소로 보여 주소별 제한이 느슨해진다 — 아이디별 제한이 주된 방어), 프록시 헤더를 믿으려면 HOLDEM_TRUST_PROXY=1
const clientIp = (req) => (process.env.HOLDEM_TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';

// 오픈형 방 목록 (로그인한 사람만 볼 수 있다)
function openRooms() {
  const out = [];
  for (const [code, r] of rooms) {
    const t = r.table;
    if (r.vis !== 'open' || t.practice || t.ended) continue;
    const host = t.players.find((p) => p.token === t.hostToken);
    out.push({ code, host: host ? host.name : '', players: t.players.length, max: MAX_PLAYERS, started: t.handNo > 0, sb: t.sb, bb: t.bb, chips: t.startChips });
  }
  return out.sort((a, b) => Number(a.players >= a.max) - Number(b.players >= b.max) || b.players - a.players);
}

async function api(req, res, url) {
  try {
    if (url === '/api/config') return json(res, 200, { app: true });
    if (req.method === 'GET' && url === '/api/me') { const u = auth.verify(bearer(req)); return u ? json(res, 200, { user: { nickname: u.nickname, username: u.username } }) : json(res, 401, { error: '로그인이 필요해요' }); }
    if (url.startsWith('/api/admin/')) { // 운영자 전용: HOLDEM_ADMIN_TOKEN 을 정해 둬야 켜진다 (신고 확인·이용 제한)
      const want = process.env.HOLDEM_ADMIN_TOKEN || '', got = String(req.headers['x-admin-token'] || '');
      const okTok = want.length >= 16 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
      if (!okTok) return json(res, 403, { error: 'forbidden' });
      if (req.method === 'GET' && url === '/api/admin/reports') return json(res, 200, { reports: auth.listReports().slice(-200).reverse() });
      if (req.method === 'POST' && url === '/api/admin/ban') {
        const b = await readJson(req); if (!b) return json(res, 400, { error: 'bad' });
        const r = auth.setBan(b.username, b.on !== false); if (r.ok && b.on !== false) for (const w of wss.clients) if (w.uid === r.id) try { w.close(); } catch {} // 접속 중이면 바로 내보낸다
        return json(res, r.error ? 400 : 200, r.error ? r : { ok: true });
      }
      return json(res, 404, { error: 'not found' });
    }
    if (req.method === 'GET' && url === '/api/blocks') { const u = auth.verify(bearer(req)); return u ? json(res, 200, { blocks: auth.blocksOf(u.id) }) : json(res, 401, { error: '로그인이 필요해요' }); }
    if (req.method === 'GET' && url === '/api/rooms') return auth.verify(bearer(req)) ? json(res, 200, { rooms: openRooms() }) : json(res, 401, { error: '로그인이 필요해요' });
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    const b = await readJson(req); if (!b) return json(res, 400, { error: '잘못된 요청이에요' });
    const ip = clientIp(req);
    if (url === '/api/signup') { const r = await auth.signup({ ...b, ip }); return json(res, r.error ? 400 : 200, r.error ? { error: r.error } : { token: r.token, user: { nickname: r.user.nickname, username: r.user.username } }); }
    if (url === '/api/login') { const r = await auth.login({ ...b, ip }); return json(res, r.error ? 401 : 200, r.error ? { error: r.error } : { token: r.token, user: { nickname: r.user.nickname, username: r.user.username } }); }
    if (url === '/api/forgot') { // 있든 없든 같은 응답 (가입 여부를 알려 주지 않는다)
      const r = auth.forgot({ email: b.email, ip });
      if (r) sendMail({ to: r.to, subject: '[AFTER HOURS] 비밀번호 재설정', text: `${r.nickname} 님, 비밀번호 재설정을 요청하셨어요.\n아래 링크에서 새 비밀번호를 정해 주세요. (30분 안에, 한 번만 쓸 수 있어요)\n\n${ORIGIN}/?reset=${r.token}\n\n요청하신 적이 없다면 이 메일은 무시하셔도 돼요.` }).catch(() => {});
      return json(res, 200, { ok: true });
    }
    if (url === '/api/reset') { const r = await auth.reset({ token: b.token, password: b.password, ip }); return json(res, r.error ? 400 : 200, r); }
    if (url === '/api/unblock') { const u = auth.verify(bearer(req)); if (!u) return json(res, 401, { error: '로그인이 필요해요' }); return json(res, 200, auth.unblock(u.id, String(b.id || ''))); }
    if (url === '/api/logout') { auth.logout(bearer(req)); return json(res, 200, { ok: true }); }
    if (url === '/api/delete-account') { const r = await auth.deleteAccount(bearer(req), b.password); return json(res, r.error ? 400 : 200, r); }
    return json(res, 404, { error: 'not found' });
  } catch (e) { console.error('api 오류', e); return json(res, 500, { error: '서버에 문제가 생겼어요' }); }
}

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (req.method === 'GET' && p === '/api/online') {
    const connected = new Set([...wss.clients].filter(ws => ws.readyState === 1));
    const seated = new Set();
    for (const room of rooms.values()) {
      for (const ws of room.clients.values()) if (connected.has(ws)) seated.add(ws);
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ online: connected.size, lobby: connected.size - seated.size, inRooms: seated.size }));
  }
  if (APP && p.startsWith('/api/')) return api(req, res, p);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    if (APP && p === '/index.html') data = Buffer.from(data.toString('utf8').replace('<head>', '<head>\n<script>window.APP_MODE=true</script>')); // 앱 모드 표시 (브라우저가 가장 먼저 읽는다)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// 시험용: HOLDEM_FAST=1 이면 연출 대기 없이 빠르게, HOLDEM_NEXT_MS 로 핸드 간격만 조절
const TABLE_OPTS = Object.assign(process.env.HOLDEM_FAST ? { pace: false, nextHandMs: 150, showdownExtraMs: 0, absentMs: 300 }
  : process.env.HOLDEM_NEXT_MS ? { nextHandMs: +process.env.HOLDEM_NEXT_MS } : {}, APP ? { noMoney: true } : {});
const rooms = new Map(); // code → { table, clients: Map(token → ws), lastActive }
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

// 비공개 방 비밀번호: 솔트 + scrypt 로만 보관한다
const roomPw = (pw) => { const salt = crypto.randomBytes(8); return { salt, hash: crypto.scryptSync(pw, salt, 32, { N: 4096 }) }; };
const roomPwOk = (rec, pw) => { const h = crypto.scryptSync(String(pw || ''), rec.salt, 32, { N: 4096 }); return crypto.timingSafeEqual(h, rec.hash); };

// 받는 사람이 보낸 사람을 차단했으면 그 사람 채팅은 보내지 않는다 (앱 모드)
const blockedFor = (w, senderTok) => { if (!APP || !w.uid) return false; const su = uidByTok.get(senderTok); return !!su && auth.isBlocked(w.uid, su); };

// 받지 않는 연결에 상태를 계속 쌓으면 서버 메모리가 불어난다 → 밀린 양이 크면 끊는다 (다시 접속하면 전체 상태를 받는다)
const MAX_BACKLOG = 2 * 1024 * 1024;

// 채팅 한 줄을 받는 사람 기준으로 만든다 (보낸 사람의 토큰은 내보내지 않고, '내가 보낸 것'인지만 알려 준다)
const chatFor = (m, token) => ({ id: m.id, name: m.name, text: m.text, at: m.at, mine: m.by === token });

// 연습 테이블은 정산 없이 끝난다: 모두를 메인 화면으로 보내고 방을 지운다 (자동 종료 땐 이유를 알려 준다)
const PRACTICE_END = { winner: '🏆 1등이 가려져서 연습이 끝났어요', out: '🏁 칩이 모두 떨어져 연습이 끝났어요' };
function closePractice(code) {
  const room = rooms.get(code);
  if (!room) return;
  const reason = room.table.settlement && room.table.settlement.reason;
  for (const w of room.clients.values()) if (w.readyState === 1) w.send(JSON.stringify({ t: 'left', msg: PRACTICE_END[reason] }));
  room.table.destroy(); rooms.delete(code);
}

// 받는 사람마다 만든 상태: 내가 차단한 사람의 한마디 말풍선 이벤트는 빼고 보낸다 (앱 모드)
function viewFor(room, token, w) {
  const v = room.table.view(token);
  if (APP && w && w.uid && v.events) v.events = v.events.filter((ev) => !(ev.k === 'emote' && ev.e === 'text' && blockedFor(w, (room.table.players[ev.i] || {}).token)));
  return v;
}
function broadcast(code) {
  const room = rooms.get(code);
  if (!room) return;
  room.lastActive = Date.now();
  for (const [token, ws] of room.clients) {
    if (ws.readyState !== 1) continue;
    if (ws.bufferedAmount > MAX_BACKLOG) { ws.terminate(); continue; }
    ws.send(JSON.stringify({ ...viewFor(room, token, ws), room: code }));
  }
}

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  let code = null, token = null;
  ws.isAlive = true; ws.pwFails = 0;
  ws.on('pong', () => (ws.isAlive = true));
  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  // 한 연결이 초당 20건을 넘게 보내는 건 정상 사용이 아니다. 초과분은 무시해서 (응답 ↔ 재요청) 폭주가 번지지 않게 한다
  let tokens = 30, tokenAt = Date.now();

  ws.on('message', (raw) => {
    const now = Date.now();
    tokens = Math.min(30, tokens + (now - tokenAt) / 1000 * 20); tokenAt = now;
    if (tokens < 1) return;
    tokens--;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return; // 'null'·숫자·문자열·배열 본문은 m.t 에서 TypeError 로 프로세스가 죽는다
    if (m.t === 'join') {
      let name = String(m.name || '').trim().slice(0, 12), tk = m.token;
      if (APP) { // 앱: 로그인한 계정만. 이름은 계정 닉네임, 자리 열쇠는 계정에서 만든다 (클라이언트가 보낸 값은 쓰지 않는다)
        const u = auth.verify(m.auth);
        if (!u) return send({ t: 'error', msg: '로그인이 필요해요', auth: true, fatal: true });
        name = u.nickname; tk = auth.playerToken(u.id); ws.uid = u.id; uidByTok.set(tk, u.id);
      }
      if (!name) return send({ t: 'error', msg: '이름을 입력해 주세요' });
      if (typeof tk !== 'string' || tk.length < 8) return send({ t: 'error', msg: '잘못된 요청이에요' });
      let rc = String(m.room || '').toUpperCase().trim();
      const created = !rc;
      let vis = 'private', pw = null;
      if (created) {
        const table = new Table(TABLE_OPTS);
        table.practice = !!m.practice; // 연습 테이블: 봇과 혼자 연습
        if (APP && !table.practice) { // 방 공개 범위: 오픈형은 목록에 보이고, 비공개는 비밀번호를 아는 사람만 들어온다
          vis = m.vis === 'open' ? 'open' : 'private';
          if (vis === 'private') {
            const pass = String(m.password || '');
            if (pass.length < 4 || pass.length > 20) return send({ t: 'error', msg: '비밀번호는 4~20자로 정해 주세요' });
            pw = roomPw(pass);
          }
        }
        if (m.settings) { const e = table.applySettings(m.settings); if (e) return send({ t: 'error', msg: e }); }
        rc = newCode();
        table.onChange = () => { if (table.practice && table.ended) return closePractice(rc); broadcast(rc); tickBots(table); };
        table.onChat = (m) => { const r = rooms.get(rc); if (r) for (const [tok, w] of r.clients) if (w.readyState === 1 && !blockedFor(w, m.by)) w.send(JSON.stringify({ t: 'chat', m: chatFor(m, tok) })); };
        rooms.set(rc, { table, clients: new Map(), lastActive: Date.now(), vis, pw });
      }
      const room = rooms.get(rc);
      if (!room) return send({ t: 'error', msg: `${rc} 방을 찾을 수 없어요`, fatal: true });
      if (room.pw && room.table.find(tk) < 0) { // 비공개 방: 이미 앉아 있던 사람(방장 포함)이 아니면 비밀번호가 맞아야 한다
        if (!roomPwOk(room.pw, m.password)) {
          if (m.password && ++ws.pwFails >= 5) { send({ t: 'error', msg: '비밀번호를 너무 많이 틀렸어요', fatal: true }); return ws.close(); }
          return send({ t: 'error', msg: m.password ? '비밀번호가 맞지 않아요' : '비공개 방이에요. 비밀번호를 입력해 주세요', needPw: true, room: rc });
        }
      }
      const r = room.table.addPlayer(tk, name);
      if (r.error) return send({ t: 'error', msg: r.error, fatal: true });
      const old = room.clients.get(tk);
      if (old && old !== ws) { try { old.send(JSON.stringify({ t: 'kicked' })); } catch {} old.close(); }
      room.clients.set(tk, ws);
      code = rc; token = tk;
      room.table.setConnected(token, true);
      if (created && room.table.practice) for (let k = 0; k < 4; k++) room.table.pushBot(); // 연습 테이블 기본 봇 4명
      broadcast(code);
      send({ t: 'chatlog', msgs: room.table.chatLog.slice(-50).filter((c) => !blockedFor(ws, c.by)).map((c) => chatFor(c, token)) }); // 늦게 들어와도 최근 대화를 본다
      return;
    }
    const room = rooms.get(code);
    if (!room) return;
    const t = room.table;
    let err = null;
    if (m.t === 'start') { if (m.settings) err = t.settings(token, m.settings); if (!err) err = t.start(token); }
    else if (m.t === 'act') err = t.act(token, m.a, m.amount);
    else if (m.t === 'rebuy') err = t.rebuy(token);
    else if (m.t === 'settings') err = t.settings(token, m);
    else if (m.t === 'end') {
      if (!t.practice) err = t.endGame(token);
      else if (token !== t.hostToken) err = '방장만 게임을 종료할 수 있어요';
      else return closePractice(code); // 연습: 진행 중인 판도 기다리지 않고 바로 끝, 정산 없음
    }
    else if (m.t === 'pause') err = t.pause(token);
    else if (m.t === 'resume') err = t.resume(token);
    else if (m.t === 'emote') err = t.emote(token, m.k, APP && typeof m.text === 'string' ? clean(m.text) : m.text);
    else if (m.t === 'hit') err = Number.isInteger(m.i) && typeof m.name === 'string' ? t.hit(token, m.i, m.name) : '때릴 사람을 다시 골라 주세요'; // 번호는 정수, 이름도 함께 (숫자 문자열·null 이 0번 자리로 읽히거나, 그 사이 자리가 밀려 엉뚱한 사람이 맞는 일을 막는다)
    else if (m.t === 'payStun') err = t.payStun(token);
    else if (m.t === 'brag') err = t.brag(token, m.which);
    else if (m.t === 'hitSwitch') err = t.hitSwitch(token, m.on);
    else if (m.t === 'chat') { err = t.chat(token, APP && typeof m.text === 'string' ? clean(m.text) : m.text); if (!err) return; } // 채팅은 게임 상태를 바꾸지 않으니 상태 방송은 하지 않는다
    else if (APP && (m.t === 'report' || m.t === 'block')) { // 신고·차단: 낯선 사람과 함께하는 앱이라 꼭 필요하다
      const tgt = Number.isInteger(m.i) ? t.players[m.i] : null, tuid = tgt && uidByTok.get(tgt.token);
      if (!tuid || tgt.token === token) err = '신고·차단할 수 없는 사람이에요';
      else if (m.t === 'report') {
        const ctx = t.chatLog.slice(-8).map((c) => `${c.name}: ${c.text}`).join('\n');
        const r = auth.report({ reporter: ws.uid, target: tuid, room: code, reason: m.reason, context: ctx });
        if (r.error) err = r.error; else return send({ t: 'notice', msg: '신고했어요. 확인한 뒤 조치할게요' });
      } else {
        const r = auth.block(ws.uid, tuid);
        if (r.error) err = r.error; else return send({ t: 'notice', msg: `${tgt.name} 님을 차단했어요` });
      }
    }
    else if (m.t === 'addBot') err = t.addBot(token);
    else if (m.t === 'removeBot') err = t.removeBot(token, m.i);
    else if (m.t === 'leave') { // 대기실에서 나가기: 알려 주고, 사람이 아무도 안 남으면 방을 지운다
      err = t.leave(token);
      if (!err) {
        send({ t: 'left' });
        room.clients.delete(token);
        if (!t.players.some((p) => !p.bot)) { t.destroy(); rooms.delete(code); return; }
      }
    }
    else if (m.t === 'kick') {
      const target = t.players[m.i] && t.players[m.i].token;
      err = t.kick(token, m.i, m.name);
      if (!err && target) { // 퇴장당한 사람에게 알리고 연결을 끊는다
        const w = room.clients.get(target);
        if (w) { try { w.send(JSON.stringify({ t: 'removed', msg: '방장에 의해 강제 퇴장되었어요' })); } catch {} room.clients.delete(target); try { w.close(); } catch {} }
      }
    }
    if (err && m.t !== 'start') { // 실패한 요청은 상태가 바뀌지 않았다: 보낸 사람에게만 알리고 전체 방송은 하지 않는다
      send({ t: 'error', msg: err });
      send({ ...viewFor(room, token, ws), room: code });
      return;
    }
    if (err) send({ t: 'error', msg: err });
    broadcast(code);
  });

  ws.on('close', () => {
    const room = rooms.get(code);
    if (!room || room.clients.get(token) !== ws) return;
    room.clients.delete(token);
    room.table.setConnected(token, false);
    broadcast(code);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  // 1시간 동안 아무도 없던 방은 정리
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 && Date.now() - room.lastActive > 3600e3) { room.table.destroy(); rooms.delete(code); }
  }
}, 25000);

server.listen(PORT, () => {
  console.log(`\n♠ 홀덤 서버 실행 중`);
  console.log(`  내 컴퓨터:        http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list) if (i.family === 'IPv4' && !i.internal) console.log(`  같은 와이파이 친구: http://${i.address}:${PORT}`);
});
