'use strict';
const crypto = require('node:crypto');
const card = c => ({ 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[c.r] || String(c.r)) + c.s;
const observerHeaders = res => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
};
function roomSummary(code, room) {
  const t = room.table;
  return { code, mode: t.opts.noMoney === true ? 'pure' : 'settlement', practice: !!t.practice,
    host: t.players.find(p => p.token === t.hostToken)?.name || '', players: t.players.length,
    humans: t.players.filter(p => !p.bot).length, connected: t.players.filter(p => !p.bot && p.connected).length,
    phase: t.phase, handNo: t.handNo, paused: t.paused, ended: t.ended, pot: t.pot };
}
function roomDetail(code, room) {
  const t = room.table, pure = t.opts.noMoney === true;
  // An unmatchable identity: never reuse the host's or another player's token.
  const v = t.view(Symbol('observer'));
  const players = v.players.map((p, i) => ({ seat: i, name: p.name, chips: p.chips,
    bet: p.bet, folded: p.folded, allIn: p.allIn, inHand: p.inHand, connected: p.connected,
    bot: p.bot, host: p.host, lastAction: p.lastAction, won: p.won,
    cards: pure ? t.players[i].hole.map(card) : [...p.cards] }));
  // Include only voluntarily disclosed cards from this hand, not previous-hand events.
  if (!pure && t.phase === 'showdown' && t.bragUsed) {
    const ev = [...t.events].reverse().find(e => e.k === 'brag');
    if (ev && players[ev.i]) players[ev.i].cards = [...ev.cards];
  }
  // Engine deals by pop(), with no burn cards. Read a copy; never consume/re-shuffle.
  const upcoming = pure && t.inProgress() ? t.deck.slice(-(5 - t.community.length)).reverse().slice(0, 5 - t.community.length).map(card) : [];
  return { ...roomSummary(code, room), access: pure ? 'full' : 'public', serverNow: Date.now(),
    dealer: v.dealer, toAct: v.toAct, sb: v.sb, bb: v.bb, currentBet: v.currentBet,
    community: [...v.community], upcoming, players, log: [...v.log], deadline: v.deadline };
}
function createObserverHandler(rooms, getSecret = () => process.env.HOLDEM_OBSERVER_TOKEN || '') {
  const failures = new Map();
  const digest = s => crypto.createHash('sha256').update(s).digest();
  return (req, res, pathname) => {
    observerHeaders(res);
    const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const secret = getSecret();
    if (Buffer.byteLength(secret) < 32) return reply(503, { error: '관리자 키가 설정되지 않았어요. 서버의 HOLDEM_OBSERVER_TOKEN을 설정해 주세요.' });
    const given = String(req.headers['x-observer-token'] || '');
    const valid = given.length <= 512 && crypto.timingSafeEqual(digest(secret), digest(given));
    if (!valid) {
      const now = Date.now(), ip = req.socket.remoteAddress || 'unknown';
      for (const [k, v] of failures) if (v.until <= now) failures.delete(k);
      if (!failures.has(ip)) {
        if (failures.size >= 1000) return reply(429, { error: '잠시 후 다시 시도해 주세요.' });
        failures.set(ip, { count: 0, until: now + 60000 });
      }
      const f = failures.get(ip); f.count++;
      if (f.count > 10) { res.setHeader('Retry-After', '60'); return reply(429, { error: '잠시 후 다시 시도해 주세요.' }); }
      return reply(403, { error: '관리자 키를 확인해 주세요.' });
    }
    if (req.method !== 'GET') return reply(405, { error: '조회만 지원해요.' });
    if (pathname === '/api/observer/rooms') return reply(200, { serverNow: Date.now(), rooms: [...rooms].map(([c, r]) => roomSummary(c, r)) });
    const match = /^\/api\/observer\/rooms\/([A-Z]{4})$/.exec(pathname);
    if (!match) return reply(404, { error: '페이지를 찾을 수 없어요.' });
    const room = rooms.get(match[1]);
    if (!room) return reply(404, { error: '종료되었거나 삭제된 방이에요.' });
    return reply(200, roomDetail(match[1], room));
  };
}
module.exports = { createObserverHandler, observerHeaders, roomSummary, roomDetail };
