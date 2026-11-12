'use strict';
// Local-only tests: never connect to a deployed game or use a production secret.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { Table } = require('./engine');
const { roomDetail, createObserverHandler } = require('./observer');
const WebSocket = require('ws');
const wait = ms => new Promise(r => setTimeout(r, ms));
const settings = { chips: 10000, buyIn: 10000, sb: 100, bb: 200, maxRebuys: 0 };
function table(pure) {
  const t = new Table({ auto: false, pace: false, noMoney: pure });
  t.applySettings(settings);
  t.addPlayer('observer-test-player-a', 'A'); t.addPlayer('observer-test-player-b', 'B');
  t.start('observer-test-player-a'); return t;
}
function noSecrets(value) {
  const s = JSON.stringify(value);
  for (const word of ['observer-test-player', '"token"', '"deck"', '"password"', '"clients"', '"transfers"', '"settlement":']) assert(!s.includes(word), word);
}
(async () => {
  for (const secret of ['', 'too-short']) {
    let status;
    const fakeRes = { setHeader() {}, writeHead(code) { status = code; }, end() {} };
    createObserverHandler(new Map(), () => secret)({ headers: {}, socket: {} }, fakeRes, '/api/observer/rooms');
    assert.equal(status, 503);
  }
  const pure = table(true), paid = table(false);
  try {
    assert.throws(() => { pure.opts.noMoney = false; }, TypeError);
    assert.throws(() => { paid.opts.noMoney = true; }, TypeError);
    const before = JSON.stringify({ deck: pure.deck, community: pure.community, players: pure.players });
    const d = roomDetail('AAAA', { table: pure });
    assert.equal(d.access, 'full'); assert.equal(d.upcoming.length, 5);
    assert(d.players.every(p => p.cards.length === 2 && !p.cards.includes('??')));
    assert.equal(JSON.stringify({ deck: pure.deck, community: pure.community, players: pure.players }), before);
    noSecrets(d);
    const expected = [...d.upcoming];
    for (const street of ['flop', 'turn', 'river']) {
      while (pure.inProgress() && pure.phase !== street) {
        const p = pure.players[pure.toAct];
        assert.equal(pure.act(p.token, p.bet < pure.currentBet ? 'call' : 'check'), null);
      }
      const current = roomDetail('AAAA', { table: pure });
      assert.deepEqual([...current.community, ...current.upcoming], expected);
    }
    while (pure.inProgress()) assert.equal(pure.act(pure.players[pure.toAct].token, 'check'), null);
    assert.deepEqual(roomDetail('AAAA', { table: pure }).upcoming, []);
    pure.finishGame('host');
    for (const r of [pure.settlement, pure.view('observer-test-player-a').settlement]) {
      assert(!('transfers' in r)); assert(!('buyInWon' in r)); assert(r.rows.every(p => !('invested' in p) && !('net' in p)));
    }
    assert(!('buyIn' in pure.view('observer-test-player-a')));
    const limited = roomDetail('BBBB', { table: paid });
    assert.equal(limited.access, 'public'); assert.deepEqual(limited.upcoming, []);
    assert(limited.players.every(p => p.cards.every(c => c === '??'))); noSecrets(limited);
    paid.act(paid.players[paid.toAct].token, 'fold');
    assert(roomDetail('BBBB', { table: paid }).players.every(p => p.cards.every(c => c === '??')));
    const winner = paid.players.find(p => !p.folded);
    assert.equal(paid.brag(winner.token, 0), null);
    const brag = roomDetail('BBBB', { table: paid }).players.find(p => p.name === winner.name);
    assert.notEqual(brag.cards[0], '??'); assert.equal(brag.cards[1], '??');
    console.log('PASS engine: immutable modes, exact upcoming streets, read-only snapshots, redaction, chip-only results, selective public reveal');
  } finally { pure.destroy(); paid.destroy(); }

  const port = 37000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
  const secret = randomBytes(32).toString('hex');
  const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), HOLDEM_APP: '', HOLDEM_OBSERVER_TOKEN: secret, HOLDEM_FAST: '1' }, stdio: 'pipe' });
  let logs = ''; srv.stderr.on('data', x => { logs += x; });
  const sockets = [];
  const request = (path, token = secret, options = {}) => fetch(base + path, { ...options, headers: { 'X-Observer-Token': token, ...options.headers } });
  async function open() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`); sockets.push(ws); ws.msgs = [];
    ws.on('message', d => ws.msgs.push(JSON.parse(d))); await once(ws, 'open'); return ws;
  }
  async function sendState(ws, data) {
    const n = ws.msgs.length; ws.send(JSON.stringify(data));
    for (let i = 0; i < 200; i++) {
      const m = ws.msgs.slice(n).find(m => m.t === 'state'); if (m) return m; await wait(10);
    }
    throw new Error('no state ' + JSON.stringify(ws.msgs.slice(n)));
  }
  try {
    for (let i = 0; i < 200; i++) { try { if ((await fetch(base)).ok) break; } catch {} await wait(20); }
    assert.equal((await request('/api/observer/rooms', '')).status, 403);
    assert.equal((await request('/api/observer/rooms/AAAA', '')).status, 403);
    assert.equal((await request('/api/observer/rooms', 'é'.repeat(64))).status, 403);
    assert.equal((await request('/api/observer/rooms?token=' + secret, '')).status, 403);
    assert.equal((await request('/api/observer/rooms', secret, { method: 'POST' })).status, 405);
    assert.equal((await request('/api/observer/rooms/ZZZZ')).status, 404);
    const res = await request('/api/observer/rooms');
    assert.equal(res.headers.get('cache-control'), 'no-store'); assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert((await fetch(base + '/admin')).headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    const a = await open(), b = await open();
    let s = await sendState(a, { t: 'join', room: '', mode: 'pure', token: 'observer-test-player-a', name: 'A', settings });
    const code = s.room; assert.equal(s.noMoney, true);
    await sendState(b, { t: 'join', room: code, mode: 'settlement', token: 'observer-test-player-b', name: 'B' });
    s = await sendState(a, { t: 'settings', ...settings, mode: 'settlement', noMoney: false, opts: { noMoney: false } });
    assert.equal(s.mode, 'pure');
    s = await sendState(a, { t: 'start', settings: { ...settings, mode: 'settlement', noMoney: false } });
    assert.equal(s.noMoney, true); assert(s.players[1].cards.every(c => c === '??'));
    const admin = await (await request('/api/observer/rooms/' + code)).json();
    assert.equal(admin.access, 'full'); assert.equal(admin.upcoming.length, 5); noSecrets(admin);
    assert(!(await (await request('/api/observer/rooms')).text()).includes(secret));
    const c = await open(), e = await open();
    const old = await sendState(c, { t: 'join', room: '', token: 'observer-test-player-c', name: 'C', settings });
    assert.equal(old.mode, 'settlement');
    await sendState(e, { t: 'join', room: old.room, token: 'observer-test-player-e', name: 'E' });
    await sendState(c, { t: 'settings', ...settings, mode: 'pure', noMoney: true });
    await sendState(c, { t: 'start' });
    const hidden = await (await request('/api/observer/rooms/' + old.room + '?mode=pure')).json();
    assert.equal(hidden.access, 'public'); assert.deepEqual(hidden.upcoming, []); assert(hidden.players.every(p => p.cards.every(c => c === '??')));
    assert.equal((await fetch(base + '/api/online').then(r => r.json())).inRooms, 4);
    for (let i = 0; i < 12; i++) await request('/api/observer/rooms', 'wrong');
    assert.equal((await request('/api/observer/rooms', 'wrong')).status, 429);
    assert.equal((await request('/api/observer/rooms')).status, 200);
    console.log('PASS HTTP/WebSocket: authentication, rate limits, no cache/CORS, mode spoofing blocked, player cards hidden, public-only legacy rooms, observer does not count as player');
  } finally {
    for (const w of sockets) w.terminate(); srv.kill(); await once(srv, 'exit');
    if (logs) console.error(logs);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
