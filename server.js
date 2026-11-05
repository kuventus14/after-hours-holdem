'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const { Table } = require('./engine');
const { tick: tickBots } = require('./bot');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// 시험용: HOLDEM_FAST=1 이면 연출 대기 없이 빠르게, HOLDEM_NEXT_MS 로 핸드 간격만 조절
const TABLE_OPTS = process.env.HOLDEM_FAST ? { pace: false, nextHandMs: 150, showdownExtraMs: 0, absentMs: 300 }
  : process.env.HOLDEM_NEXT_MS ? { nextHandMs: +process.env.HOLDEM_NEXT_MS } : {};
const rooms = new Map(); // code → { table, clients: Map(token → ws), lastActive }
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

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

function broadcast(code) {
  const room = rooms.get(code);
  if (!room) return;
  room.lastActive = Date.now();
  for (const [token, ws] of room.clients) {
    if (ws.readyState !== 1) continue;
    if (ws.bufferedAmount > MAX_BACKLOG) { ws.terminate(); continue; }
    ws.send(JSON.stringify({ ...room.table.view(token), room: code }));
  }
}

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  let code = null, token = null;
  ws.isAlive = true;
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
      const name = String(m.name || '').trim().slice(0, 12);
      if (!name) return send({ t: 'error', msg: '이름을 입력해 주세요' });
      if (typeof m.token !== 'string' || m.token.length < 8) return send({ t: 'error', msg: '잘못된 요청이에요' });
      let rc = String(m.room || '').toUpperCase().trim();
      const created = !rc;
      if (created) {
        const table = new Table(TABLE_OPTS);
        table.practice = !!m.practice; // 연습 테이블: 봇과 혼자 연습
        if (m.settings) { const e = table.applySettings(m.settings); if (e) return send({ t: 'error', msg: e }); }
        rc = newCode();
        table.onChange = () => { if (table.practice && table.ended) return closePractice(rc); broadcast(rc); tickBots(table); };
        table.onChat = (m) => { const r = rooms.get(rc); if (r) for (const [tok, w] of r.clients) if (w.readyState === 1) w.send(JSON.stringify({ t: 'chat', m: chatFor(m, tok) })); };
        rooms.set(rc, { table, clients: new Map(), lastActive: Date.now() });
      }
      const room = rooms.get(rc);
      if (!room) return send({ t: 'error', msg: `${rc} 방을 찾을 수 없어요`, fatal: true });
      const r = room.table.addPlayer(m.token, name);
      if (r.error) return send({ t: 'error', msg: r.error, fatal: true });
      const old = room.clients.get(m.token);
      if (old && old !== ws) { try { old.send(JSON.stringify({ t: 'kicked' })); } catch {} old.close(); }
      room.clients.set(m.token, ws);
      code = rc; token = m.token;
      room.table.setConnected(token, true);
      if (created && room.table.practice) for (let k = 0; k < 4; k++) room.table.pushBot(); // 연습 테이블 기본 봇 4명
      broadcast(code);
      send({ t: 'chatlog', msgs: room.table.chatLog.slice(-50).map((c) => chatFor(c, token)) }); // 늦게 들어와도 최근 대화를 본다
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
    else if (m.t === 'emote') err = t.emote(token, m.k, m.text);
    else if (m.t === 'hit') err = Number.isInteger(m.i) && typeof m.name === 'string' ? t.hit(token, m.i, m.name) : '때릴 사람을 다시 골라 주세요'; // 번호는 정수, 이름도 함께 (숫자 문자열·null 이 0번 자리로 읽히거나, 그 사이 자리가 밀려 엉뚱한 사람이 맞는 일을 막는다)
    else if (m.t === 'payStun') err = t.payStun(token);
    else if (m.t === 'brag') err = t.brag(token, m.which);
    else if (m.t === 'hitSwitch') err = t.hitSwitch(token, m.on);
    else if (m.t === 'chat') { err = t.chat(token, m.text); if (!err) return; } // 채팅은 게임 상태를 바꾸지 않으니 상태 방송은 하지 않는다
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
      send({ ...t.view(token), room: code });
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
