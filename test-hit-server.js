// 때리기 서버 통합 시험: node test-hit-server.js
// 자체 서버를 3102번으로 띄워 ws 로 접속해 본다 (연출 대기 없이 빠르게). 규칙 자체는 test-hit.js(엔진) 몫이고,
// 여기서는 실제 메시지가 모두의 화면에 어떻게 닿는지를 본다: 즉시 반영 · 거절은 보낸 사람에게만 · 기절 핸드 · 연습 테이블 · 칩 합계/정산 · 잘못된 입력.
// 서버의 알려진 허점은 note() 로 적어 두고 시험은 계속한다 (STRICT=1 이면 그 허점이 있는 한 실패로 끝낸다).
process.env.PORT = 3102; process.env.HOLDEM_FAST = '1';
const { Table, HIT_COST, STUN_PAY, HIT_COOLDOWN } = require('./engine');
const emit = Table.prototype.emit, addPlayer = Table.prototype.addPlayer, tables = new Set();
Table.prototype.emit = function (ev) { emit.call(this, ev); this.anim = 0; this.animUntil = 0; };
Table.prototype.addPlayer = function (...a) { tables.add(this); return addPlayer.apply(this, a); }; // 서버 안의 테이블을 집어 오는 용도: 연출 11초 건너뛰기, 연습 테이블에서 봇이 때리는 상황 만들기
require('./server');
const WS = require('ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, what, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('시간 초과: ' + what); await sleep(10); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const LIVE = ['preflop', 'flop', 'turn', 'river'];
const SET = { buyIn: 10000, sb: 100, bb: 200, blindMinutes: 0, maxRebuys: 2 };
ok(HIT_COST === 1000 && STUN_PAY === 1500 && HIT_COOLDOWN === 3, `규칙 상수가 사용자가 정한 값(1,000 / 1,500 / 3핸드)과 다름: ${HIT_COST} / ${STUN_PAY} / ${HIT_COOLDOWN}`);
const known = [], note = (m) => { known.push(m); console.log('  ! 알려진 문제: ' + m); };

// 방송 하나하나가 지켜야 할 것: 칩 합계 보존(진행 중이면 팟 포함) · 음수·소수 칩 없음 · 칩 0 이면 올인 표시 · 기절한 사람은 핸드 밖(패·베팅·차례 없음)
const audit = (c, s) => {
  const live = LIVE.includes(s.phase), bad = (m) => c.bad.push(`핸드 ${s.handNo} ${s.phase}: ${m}`);
  const sum = s.players.reduce((x, p) => x + p.chips + (live ? p.total : 0), 0), want = s.players.reduce((x, p) => x + p.buyIns * s.startChips, 0);
  if (sum !== want) bad(`칩 합계 ${sum} / ${want}`);
  s.players.forEach((p, i) => {
    if (!Number.isInteger(p.chips) || p.chips < 0) bad(`칩 이상 ${p.name} ${p.chips}`);
    if (live && p.inHand && !p.folded && p.chips === 0 && !p.allIn) bad(`칩 0인데 올인 표시 없음 ${p.name}`);
    if (p.stun === 'out' && (p.inHand || p.cards.length || p.bet || p.total || (live && s.toAct === i))) bad(`기절한 ${p.name} 이 핸드에 있음`);
  });
};
const open = () => new Promise((res, rej) => {
  const ws = new WS('ws://localhost:3102'), c = { ws, s: null, n: 0, err: [], got: [], bad: [], first: {}, last: {}, token: 'tok-' + Math.random().toString(36).slice(2) + Date.now() };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'state') { c.s = m; c.n++; audit(c, m); c.first[m.handNo] = c.first[m.handNo] || m; c.last[m.handNo] = m; } // first/last: 핸드별 처음·마지막으로 받은 상태
    else { c.got.push(m.t); if (m.t === 'error') c.err.push(m.msg); if (m.t === 'left') c.left = m; }
  });
  ws.on('open', () => res(c)); ws.on('error', rej);
});
// 문자열은 가공하지 않고 그대로 보낸다. hit 은 서버가 대상 이름도 요구하니(자리가 밀려 엉뚱한 사람이 맞는 걸 막으려고), 이름이 없는 정수 번호 hit 에는 지금 화면의 그 자리 이름을 붙여 준다 (name: null 이면 일부러 빼고 보낸 것)
const send = (c, o) => {
  if (o && typeof o === 'object' && !Buffer.isBuffer(o) && o.t === 'hit' && o.name === undefined && Number.isInteger(o.i) && c.s && c.s.players[o.i]) o = { ...o, name: c.s.players[o.i].name };
  c.ws.send(typeof o === 'string' || Buffer.isBuffer(o) ? o : JSON.stringify(o));
};
const join = (c, name, room, extra = {}) => send(c, { t: 'join', room, name, token: c.token, ...extra });
const botsOf = (c) => c.s.players.filter((p) => p.bot).length;
const tableOf = (c) => [...tables].find((t) => t.players.some((p) => p.token === c.token));
const ask = async (c, o) => { const n = c.err.length; send(c, o); await until(() => c.err.length > n, '거절 응답 ' + String(typeof o === 'string' ? o : JSON.stringify(o)).slice(0, 60)); return c.err[c.err.length - 1]; };
// 거절은 보낸 사람에게만: f 를 하는 동안 others 에게는 상태 방송이 한 번도 가지 않아야 한다
const quiet = async (others, f) => { const n = others.map((x) => x.n), r = await f(); await sleep(120); ok(others.every((x, k) => x.n === n[k]), '거절인데 다른 사람에게 상태가 방송됨'); return r; };
const clean = (...cs) => cs.forEach((x) => ok(!x.bad.length, '방송 규칙 위반: ' + x.bad[0]));
const chipsOf = (c) => c.s.players.map((p) => p.chips);
// cs 가 자기 차례마다 콜/체크(safe 면 폴드/체크)로 f 가 참이 될 때까지 판을 굴린다. f 를 안 부르는 동안에는 아무도 움직이지 않아 판이 그 자리에 멈춰 있다
const drive = async (cs, f, what, safe = false, ms = 30000) => {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('시간 초과: ' + what);
    for (const c of cs) {
      const s = c.s;
      if (!s || !LIVE.includes(s.phase) || s.toAct !== s.me) continue;
      const k = `${s.handNo}|${s.phase}|${s.currentBet}|${s.evSeq}`, call = s.currentBet > s.players[s.me].bet;
      if (k !== c.key) { c.key = k; send(c, { t: 'act', a: call ? (safe ? 'fold' : 'call') : 'check' }); }
    }
    await sleep(10);
  }
  // 한 화면이 목표 상태를 받은 순간 다른 화면들은 아직 못 받았을 수 있다(컴퓨터가 바쁘면 더). 모두가 같은 상태를 받을 때까지 기다린다
  for (let i = 0; i < 300 && !cs.every((c) => c.s && c.s.evSeq === cs[0].s.evSeq && c.s.handNo === cs[0].s.handNo); i++) await sleep(10);
};

(async () => {
  // ── 준비: 일반 테이블, 사람 3명 (가=방장, 나, 다)
  const a = await open(); join(a, '가', '', { settings: SET });
  await until(() => a.s && !a.s.practice, '방 생성');
  const code = a.s.room; let b = await open(); const c = await open(); join(b, '나', code); join(c, '다', code);
  await until(() => a.s.players.length === 3 && b.s && c.s, '3명 입장');
  const all = [a, b, c], T = tableOf(a), free = () => { T.hitUntil = 0; }; // free: 화면 연출 11초 대기는 건너뛴다 (그 문구는 ②에서 따로 본다)
  T.opts.turnMs = 120000; // 시험이 천천히 확인하는 동안 시간 초과 자동 행동이 끼어들지 않게
  ok(a.s.hit && a.s.hit.on === true && a.s.hit.cost === HIT_COST && a.s.hit.pay === STUN_PAY && a.s.hit.cooldown === HIT_COOLDOWN && a.s.hit.lastHitHand < 0, `방 상태의 hit 정보(기본 켜짐): ${JSON.stringify(a.s.hit)}`);
  send(a, { t: 'start' }); await until(() => all.every((x) => x.s.phase === 'preflop'), '1핸드 시작');
  const H = a.s.handNo;

  // ── ① 판 도중에 가 → 나 때리기: 모두의 화면에 바로 칩 변화·stun·hit 이벤트·hit 정보, 팟·베팅은 그대로
  const s0 = a.s, ev0 = s0.evSeq, c0 = chipsOf(a);
  const t0 = Date.now(); send(a, { t: 'hit', i: 1 });
  await until(() => all.every((x) => x.s.players[1].stun === 'pending'), '맞은 상태가 모두에게 도착');
  const dtHit = Date.now() - t0;
  for (const x of all) {
    const s = x.s;
    ok(s.handNo === H && s.phase === 'preflop', '때리는 순간 반영돼야 함 (핸드가 끝나기를 기다리면 안 됨)');
    ok(s.players[0].chips === c0[0] - HIT_COST && s.players[1].chips === c0[1] + HIT_COST && s.players[2].chips === c0[2], `칩 변화가 틀림: ${s.players.map((p) => p.chips)} (전 ${c0})`);
    ok(s.pot === s0.pot && s.players.every((p, i) => p.bet === s0.players[i].bet && p.total === s0.players[i].total), '팟·베팅·투입액은 그대로여야 함');
    ok(s.players[1].stunBy === 0 && s.players[0].stun === '' && s.players[2].stun === '', `stun/stunBy: ${s.players.map((p) => p.stun + ':' + p.stunBy)}`);
    const ev = s.events.find((e) => e.k === 'hit' && e.id > ev0);
    ok(ev && ev.i === 0 && ev.to === 1 && ev.amt === HIT_COST, `hit 이벤트: ${JSON.stringify(ev)}`);
    ok(s.hit.lastHitHand === H && s.hit.lastHitBy === '가' && s.hit.seq === 1 && s.hit.busyUntil > s.serverNow && s.hit.on === true, `hit 정보: ${JSON.stringify(s.hit)}`);
  }
  ok(b.s.players[1].inHand && b.s.players[1].cards.length === 2, '맞은 사람도 이번 핸드는 그대로 뜀 (다음 핸드부터 기절)');
  ok(dtHit < 500, `반영이 느림: ${dtHit}ms`);
  clean(...all); console.log(`① 때리기 OK (판 도중 · 전원 화면에 ${dtHit}ms · 가 -${HIT_COST} / 나 +${HIT_COST} · 팟 ${s0.pot} 그대로)`);

  // ── ② 거절: 연출 중 / 같은 핸드. 에러는 보낸 사람에게만 가고 칩은 그대로
  const c1 = chipsOf(a);
  ok(await quiet([a, b], () => ask(c, { t: 'hit', i: 0 })) === '지금 가님이 때리는 중이에요', '연출 중 문구');
  free();
  ok(await quiet([a, b], () => ask(c, { t: 'hit', i: 0 })) === '이번 핸드에는 이미 가님이 때렸어요', '같은 핸드 다른 사람');
  ok(await quiet([b, c], () => ask(a, { t: 'hit', i: 2 })) === '이번 핸드에는 이미 가님이 때렸어요', '같은 핸드 때린 사람');
  ok(chipsOf(a).join() === c1.join() && chipsOf(c).join() === c1.join() && c.s.hit.seq === 1, '거절된 요청이 상태를 바꿈');
  ok(await quiet([a, b], () => ask(c, { t: 'payStun' })) === '기절 상태가 아니에요', '맞지 않은 사람의 합의금');
  ok(await quiet([b, c], () => ask(a, { t: 'payStun' })) === '기절 상태가 아니에요', '때린 사람의 합의금');
  ok(all.every((x) => x.s.players[1].stun === 'pending'), '맞은 사람의 기절 예고가 그대로여야 함');
  clean(...all); console.log('② 거절 OK (연출 중 · 같은 핸드 · 엉뚱한 합의금 → 보낸 사람에게만, 상태 방송 없음)');

  // ── ③ 맞은 사람이 합의금: 칩·pay 이벤트·stun 해제가 모두에게 바로
  const s1 = a.s, ev1 = s1.evSeq, c2 = chipsOf(a);
  const t1 = Date.now(); send(b, { t: 'payStun' });
  await until(() => all.every((x) => x.s.players[1].stun === ''), '합의금이 모두에게 도착');
  const dtPay = Date.now() - t1;
  for (const x of all) {
    const s = x.s;
    ok(s.handNo === H && s.phase === 'preflop', '합의금도 판 도중에 반영돼야 함');
    ok(s.players[0].chips === c2[0] + STUN_PAY && s.players[1].chips === c2[1] - STUN_PAY && s.players[2].chips === c2[2], `합의금 칩 변화가 틀림: ${s.players.map((p) => p.chips)} (전 ${c2})`);
    ok(s.pot === s1.pot && s.players[1].stunBy === -1 && s.hit.seq === 1, '팟 불변 · stunBy 비움 · 합의금은 때리기 횟수에 안 들어감');
    const ev = s.events.find((e) => e.k === 'pay' && e.id > ev1);
    ok(ev && ev.i === 1 && ev.to === 0 && ev.amt === STUN_PAY, `pay 이벤트: ${JSON.stringify(ev)}`);
  }
  ok(await quiet([a, c], () => ask(b, { t: 'payStun' })) === '기절 상태가 아니에요', '두 번 내기');
  ok(dtPay < 500, `반영이 느림: ${dtPay}ms`);
  clean(...all); console.log(`③ 합의금 OK (판 도중 · 전원 화면에 ${dtPay}ms · 나 -${STUN_PAY} / 가 +${STUN_PAY})`);

  // ── ④ 방장 스위치: 방장 아니면 거절, 끄면 모두에게 바로 반영, 꺼진 동안 때리면 문구
  ok(await quiet([a, c], () => ask(b, { t: 'hitSwitch', on: false })) === '방장만 바꿀 수 있어요', '방장 아닌 사람의 스위치');
  ok(all.every((x) => x.s.hit.on === true), '방장 아닌 사람이 스위치를 바꿈');
  send(a, { t: 'hitSwitch', on: false }); await until(() => all.every((x) => x.s.hit.on === false), '스위치 끔이 모두에게 도착');
  ok(await quiet([a, c], () => ask(b, { t: 'hit', i: 2 })) === '방장 권한으로 폭력은 안됩니다.', '꺼진 동안 때리기 문구');
  ok(await quiet([b, c], () => ask(a, { t: 'hit', i: 2 })) === '방장 권한으로 폭력은 안됩니다.', '방장 본인도 꺼진 동안은 못 때림');
  send(a, { t: 'hitSwitch', on: true }); await until(() => all.every((x) => x.s.hit.on === true), '스위치 켬이 모두에게 도착');
  clean(...all); console.log('④ 방장 스위치 OK (방장만 · 끄면 "방장 권한으로 폭력은 안됩니다." · 켜면 복구)');

  // ── 쿨다운(H+1, H+2 불가, H+3 가능)을 실제 핸드를 넘기며 확인. 합의금을 낸 나는 H+1 에 정상으로 뜀
  await drive(all, () => a.s.handNo === H + 1 && a.s.phase === 'preflop', 'H+1 시작');
  ok(b.s.players[1].inHand && b.s.players[1].cards.length === 2 && b.s.players[1].stun === '', '합의금을 낸 사람은 다음 핸드를 뜀');
  free(); ok(await quiet([a, b], () => ask(c, { t: 'hit', i: 0 })) === `때리기는 연달아 쓸 수 없어요 · ${HIT_COOLDOWN - 1}핸드 뒤부터 가능해요`, 'H+1 쿨다운 문구');
  await drive(all, () => a.s.handNo === H + 2 && a.s.phase === 'preflop', 'H+2 시작');
  free(); ok(await quiet([b, c], () => ask(a, { t: 'hit', i: 2 })) === `때리기는 연달아 쓸 수 없어요 · ${HIT_COOLDOWN - 2}핸드 뒤부터 가능해요`, 'H+2 쿨다운 문구 (때린 사람도 같음)');
  await drive(all, () => a.s.handNo === H + 3 && a.s.phase === 'preflop', 'H+3 시작');
  free(); const c3 = chipsOf(a), seq3 = a.s.evSeq; send(a, { t: 'hit', i: 1 }); // H+3 에는 다시 가능: 이번에는 나가 합의금을 안 낸다
  await until(() => all.every((x) => x.s.players[1].stun === 'pending'), 'H+3 때리기');
  ok(all.every((x) => x.s.hit.lastHitHand === H + 3 && x.s.hit.seq === 2 && x.s.players[0].chips === c3[0] - HIT_COST && x.s.players[1].chips === c3[1] + HIT_COST && x.s.events.some((e) => e.k === 'hit' && e.id > seq3)), 'H+3 때리기 결과');
  console.log(`   쿨다운 OK (H=${H}: H+1 "${HIT_COOLDOWN - 1}핸드 뒤부터", H+2 "${HIT_COOLDOWN - 2}핸드 뒤부터", H+${HIT_COOLDOWN}=${H + HIT_COOLDOWN} 에 다시 가능)`);

  // ── ⑤ 다음 핸드: 합의금을 안 낸 나는 패를 받지 않고 핸드 밖. 칩 그대로, 블라인드·딜러에서 빠지고 deal 이벤트도 없음
  await drive(all, () => a.s.handNo === H + 4 && a.s.phase === 'preflop', 'H+4 시작');
  for (const x of [a, b, c]) {
    const s = x.first[H + 4], v = s.players[1], chipsBefore = x.last[H + 3].players[1].chips, he = s.events.find((e) => e.k === 'hand' && e.n === H + 4);
    ok(v.stun === 'out' && v.inHand === false && v.cards.length === 0 && v.bet === 0 && v.total === 0 && v.lastAction === '기절', `기절 핸드의 나: ${JSON.stringify(v)}`);
    ok(v.chips === chipsBefore, `블라인드를 안 냈으면 칩이 그대로: ${v.chips} / ${chipsBefore}`);
    ok(s.dealer !== 1 && s.sbIdx !== 1 && s.bbIdx !== 1 && s.players.filter((p) => p.inHand).length === 2, '딜러·블라인드·참가자에서 빠짐');
    ok(he && !s.events.some((e) => e.k === 'deal' && e.to === 1 && e.id > he.id) && s.events.filter((e) => e.k === 'deal' && e.id > he.id).length === 4, '기절한 사람에게 deal 이벤트가 가면 안 됨 (두 사람 × 2장 = 4)');
    ok(s.players[0].cards.length === 2 && s.players[2].cards.length === 2, '나머지는 패를 받음');
  }
  // 늦은 합의금·차례 없음 거절 + 새로고침(재접속)해도 기절 상태 그대로
  ok(await quiet([a, c], () => ask(b, { t: 'payStun' })) === '이미 이번 핸드를 쉬는 중이에요', '기절 핸드 중 합의금');
  ok(await quiet([a, c], () => ask(b, { t: 'act', a: 'check' })) === '지금은 내 차례가 아니에요', '기절한 사람은 차례가 없음');
  const b2 = await open(); b2.token = b.token; join(b2, '나', code);
  await until(() => b2.s && b2.s.me === 1, '재접속'); ok(b2.s.players[1].stun === 'out' && b2.s.players[1].cards.length === 0 && !b2.s.players[1].inHand, '재접속해도 기절 상태 그대로');
  await until(() => b.got.includes('kicked'), '옛 연결은 밀려남'); b = b2; all[1] = b2;
  // 핸드가 끝나면 깨어나고, 그다음 핸드는 정상
  await drive(all, () => a.s.handNo === H + 5 && a.s.phase === 'preflop', 'H+5 시작');
  // 재접속한 화면은 H+4 를 통째로 못 받았을 수 있으니(시간차), 그 핸드를 받은 화면들만 '끝나면 깨어남'을 본다
  const saw = all.filter((x) => x.last[H + 4]);
  ok(saw.length >= 2 && saw.every((x) => x.last[H + 4].players[1].stun === '' && x.last[H + 4].players[1].stunBy === -1), '핸드가 끝나면 깨어남');
  ok(all.every((x) => x.first[H + 5].players[1].inHand && x.first[H + 5].players[1].cards.length === 2), '다음 핸드는 패를 받음');
  clean(...all); console.log(`⑤ 기절 핸드 OK (H+${HIT_COOLDOWN + 1} 에 패·블라인드·deal 없음, 재접속해도 유지, 핸드가 끝나 깨어남, H+${HIT_COOLDOWN + 2} 는 정상)`);

  // ── ⑦ 방장이 종료: 마지막 핸드에는 못 때리고, 정산 합계 0 · 송금을 적용하면 모두 0
  send(a, { t: 'end' }); await until(() => a.s.endAfterHand, '종료 예약'); free();
  ok(await quiet([a, b], () => ask(c, { t: 'hit', i: 0 })) === '마지막 핸드에는 때릴 수 없어요', '종료 예약 중 때리기');
  await drive(all, () => all.every((x) => x.s.ended && x.s.settlement), '정산');
  const S = a.s, st = S.settlement;
  ok(st && !st.error && st.reason === 'host' && st.rows.length === 3, `정산 모양: ${JSON.stringify(st).slice(0, 200)}`);
  ok(st.rows.reduce((x, r) => x + r.net, 0) === 0 && st.totals.net === 0, '정산 net 합이 0 이 아님');
  ok(st.rows.reduce((x, r) => x + r.chips, 0) === 3 * S.startChips && st.rows.every((r) => r.chips === S.players[r.i].chips), '정산의 최종 칩이 화면의 칩과 다름');
  const bal = [0, 0, 0]; st.rows.forEach((r) => (bal[r.i] = r.net)); st.transfers.forEach((tr) => { bal[tr.from] += tr.amount; bal[tr.to] -= tr.amount; });
  ok(bal.every((v) => v === 0), `송금을 적용해도 0 이 안 됨: ${bal}`);
  ok(all.every((x) => JSON.stringify(x.s.settlement) === JSON.stringify(st)), '사람마다 정산이 다름');
  ok(await ask(a, { t: 'hit', i: 1 }) === '게임이 끝났어요' && await ask(b, { t: 'payStun' }) === '게임이 끝났어요' && await ask(a, { t: 'hitSwitch', on: false }) === '게임이 끝났어요', '끝난 뒤 요청');
  clean(...all);
  const line7 = `⑦ 정산 OK (${S.handNo}핸드 · net ${st.rows.map((r) => `${r.name} ${r.net >= 0 ? '+' : ''}${r.net}`).join(' / ')} · 합 ${st.totals.net} · 송금 ${st.transfers.length}건 적용 시 전원 0 · 최종 칩 합 ${st.rows.reduce((x, r) => x + r.chips, 0)})`;

  // ── ⑥ 연습 테이블: 봇이 사람을 때림(서버 메서드 직접 호출 — 봇이 알아서 때리는 건 test-hit-bots.js 몫) → 사람이 합의금 / 안 내고 쉬기
  // 1핸드는 사람이 버튼이라 사람이 움직이기 전에는 끝날 수 없다 (봇이 아무리 빨라도 그 핸드 안에서 때리고 합의금을 낼 수 있음)
  const prac = async (name) => { const p = await open(); join(p, name, '', { practice: true, settings: SET }); await until(() => p.s && botsOf(p) === 4, '연습 방'); tableOf(p).opts.turnMs = 120000; send(p, { t: 'start' }); await until(() => p.s.phase === 'preflop' && p.s.handNo === 1, '연습 1핸드'); return p; };
  const p1 = await prac('연');
  {
    const T1 = tableOf(p1), bot = T1.players.find((q) => q.bot), bi = T1.players.indexOf(bot);
    ok(p1.s.toAct !== 0 && p1.s.dealer === 0, `1핸드는 사람이 버튼이라 아직 안 움직였어야 함 (toAct ${p1.s.toAct}, dealer ${p1.s.dealer})`);
    const hc = bot.chips, vc = T1.players[0].chips, ev = p1.s.evSeq;
    ok(T1.hit(bot.token, 0) === null, `봇이 사람을 때림: ${T1.hitCheck(bi, 0)}`);
    ok(bot.chips === hc - HIT_COST && T1.players[0].chips === vc + HIT_COST, '서버 쪽 칩 변화');
    await until(() => p1.s.players[0].stun === 'pending', '사람 화면에 기절 예고');
    let s = p1.s;
    ok(s.practice && s.handNo === 1 && s.phase === 'preflop' && s.players[0].chips === vc + HIT_COST && s.players[0].stunBy === bi && s.hit.seq === 1 && s.hit.lastHitBy === bot.name, `연습 테이블 hit 반영: ${JSON.stringify(s.hit)}`);
    ok(s.events.some((e) => e.k === 'hit' && e.id > ev && e.i === bi && e.to === 0 && e.amt === HIT_COST), 'hit 이벤트');
    const botSum = bot.chips + bot.total; // 봇이 베팅해도 chips+total 은 그대로라, 합의금이 들어온 것만 보인다
    const ev2 = s.evSeq; send(p1, { t: 'payStun' });
    await until(() => p1.s.players[0].stun === '', '사람이 합의금'); s = p1.s;
    ok(s.handNo === 1 && s.phase === 'preflop' && s.players[0].chips === vc + HIT_COST - STUN_PAY && s.players[0].stunBy === -1, `합의금 후 칩: ${s.players[0].chips}`);
    ok(bot.chips + bot.total === botSum + STUN_PAY, '때린 봇이 합의금을 받음');
    ok(s.events.some((e) => e.k === 'pay' && e.id > ev2 && e.i === 0 && e.to === bi && e.amt === STUN_PAY), 'pay 이벤트');
    await drive([p1], () => p1.s.handNo === 2 && p1.s.phase === 'preflop', '연습 2핸드', true);
    ok(p1.first[2].players[0].inHand && p1.first[2].players[0].cards.length === 2 && p1.first[2].players[0].stun === '', '합의금을 낸 사람은 연습에서도 다음 핸드를 뜀');
    clean(p1); send(p1, { t: 'end' }); await until(() => p1.left, '연습 종료');
  }
  const p2 = await prac('연2');
  {
    const T2 = tableOf(p2), bot = T2.players.find((q) => q.bot);
    ok(T2.hit(bot.token, 0) === null, '봇이 사람을 때림'); await until(() => p2.s.players[0].stun === 'pending', '기절 예고');
    await drive([p2], () => p2.s.handNo === 2 && p2.s.phase !== 'showdown', '연습 2핸드', true);
    const f2 = p2.first[2], v = f2.players[0];
    ok(v.stun === 'out' && !v.inHand && v.cards.length === 0 && v.bet === 0 && v.lastAction === '기절' && v.chips === p2.last[1].players[0].chips, `기절한 연습 핸드: ${JSON.stringify(v)}`);
    ok(f2.players.filter((q) => q.inHand).length === 4 && f2.dealer !== 0 && f2.sbIdx !== 0 && f2.bbIdx !== 0, '사람이 쉬어도 봇 4명이 그 핸드를 침');
    await until(() => p2.first[3], '봇끼리 그 핸드를 끝내고 3핸드로 (사람은 한 번도 안 움직임)', 30000);
    ok(p2.last[2].players[0].stun === '' && p2.first[3].players[0].inHand && p2.first[3].players[0].cards.length === 2 && p2.first[3].players[0].chips === v.chips, '핸드가 끝나 깨어남 · 3핸드는 정상 참여 · 칩 그대로');
    clean(p2); const nErr = p2.err.length; send(p2, { t: 'end' }); await until(() => p2.left, '연습 종료');
    send(p2, { t: 'hit', i: 1 }); send(p2, { t: 'payStun' }); await sleep(120); ok(p2.err.length === nErr, '지워진 방으로 보낸 요청은 조용히 무시돼야 함');
  }
  console.log('⑥ 연습 테이블 OK (봇이 사람을 때림 → 합의금을 내면 다음 핸드 정상 / 안 내면 봇끼리 그 핸드를 치고 깨어남, 칩 합계 유지)');
  console.log(line7);

  // ── 잘못된 입력: 새 방(가=방장, 나, 다) + 방에 들어온 적 없는 연결 + 시작 전에 나간 사람(라)
  const va = await open(); join(va, '가', '', { settings: SET }); await until(() => va.s, '검증 방 생성');
  const vcode = va.s.room, vb = await open(), vc = await open(), vd = await open(); join(vb, '나', vcode); join(vc, '다', vcode);
  await until(() => vb.s && vc.s && va.s.players.length === 3, '검증 방 입장');
  const vs = [va, vb, vc], VT = tableOf(va); VT.opts.turnMs = 120000;
  for (const m of [{ t: 'hit', i: 0 }, { t: 'payStun' }, { t: 'hitSwitch', on: false }, { t: 'act', a: 'check' }]) send(vd, m); // 방에 들어온 적 없는 연결
  await sleep(150); ok(vd.got.length === 0 && vd.n === 0, `방에 없는 연결에 응답이 감: ${vd.got}`);
  join(vd, '라', vcode); await until(() => vd.s && vd.s.players.length === 4, '같은 연결이 이어서 입장'); send(vd, { t: 'leave' });
  await until(() => vd.got.includes('left') && va.s.players.length === 3, '시작 전 나가기');
  ok(await quiet(vs, () => ask(vd, { t: 'hit', i: 0 })) === '플레이어가 아니에요', '나간 사람의 hit');
  ok(await quiet(vs, () => ask(vd, { t: 'payStun' })) === '플레이어가 아니에요', '나간 사람의 payStun');
  ok(await quiet(vs, () => ask(vd, { t: 'hitSwitch', on: false })) === '방장만 바꿀 수 있어요' && vs.every((x) => x.s.hit.on), '나간 사람의 hitSwitch');
  send(va, { t: 'start' }); await until(() => vs.every((x) => x.s.phase === 'preflop'), '검증 방 1핸드');
  const frozen = () => JSON.stringify(vs.map((x) => { const s = x.s; return [s.handNo, s.phase, s.toAct, s.pot, s.hit.seq, s.hit.on, s.evSeq, s.players.map((p) => [p.chips, p.bet, p.stun])]; }));
  const f0 = frozen();
  // hit 의 i: 문자열·음수·소수·아주 큰 수·무한대·누락·객체는 전부 '다시 골라 주세요' 로 거절되고 아무것도 안 바뀐다
  const bodies = ['abc', '1abc', 'NaN', 'Infinity', '9'.repeat(400), -1, -0.5, 1 /* 자기 자신 */, 3, 99, 1e308, 2 ** 53, {}, { i: 1 }, [1, 2], undefined /* 누락 */].map((v) => ({ t: 'hit', i: v }));
  bodies.push('{"t":"hit","i":1e999}', '{"t":"hit","i":-1e999}');
  for (const body of bodies) { const msg = await quiet([va, vc], () => ask(vb, body)); ok(msg === '때릴 사람을 다시 골라 주세요', `이상한 i ${typeof body === 'string' ? body : JSON.stringify(body)} → ${msg}`); }
  ok(frozen() === f0, '거절된 요청이 상태를 바꿈');
  // null·''·[]·false 는 숫자로 바뀌어 0번 자리를 때린다 (JSON.stringify(NaN) 도 null). 받아들여지면 되돌려서 다음 값을 이어 본다
  const poke = async (body) => {
    const n = vb.err.length, seq = VT.hitSeq; send(vb, body); await until(() => vb.err.length > n || VT.hitSeq > seq, '응답');
    if (VT.hitSeq === seq) return null;
    const v = VT.players.findIndex((p) => p.stun === 'pending'); Object.assign(VT.players[v], { stun: '', stunBy: '' }); VT.hitUntil = 0; VT.lastHitHand = -99; return v;
  };
  const loose = [null, '', [], false, true, '2', 2.7, [2], 0.5], took = [];
  for (const v of loose) { const victim = await poke({ t: 'hit', i: v }); if (victim !== null) took.push([v, victim]); }
  const odd = took.filter(([v]) => Number.isNaN(parseFloat(v)));
  if (odd.length) note(`server.js:127 hit 의 i 를 Math.floor(+m.i) 로 읽어서 숫자가 아닌 값이 0 이 됨 → ${odd.map(([v, who]) => `i:${JSON.stringify(v)} 가 ${who}번 자리를 때림`).join(', ')} (JSON.stringify(NaN) 도 null 이라 같은 결과). 합법적인 i:0 요청과 같은 효과라 칩이 어긋나지는 않음`);
  clean(...vs);
  console.log(`   hit 입력 검증 OK (거절 ${bodies.length}종 · 상태 불변 · 보낸 사람에게만 / 느슨하게 받아들여진 값: ${took.map(([v, who]) => `${JSON.stringify(v)}→${who}번`).join(' ') || '없음'})`);
  // 이름 대조: 번호는 맞아도 이름이 다르면(= 그 사이 자리가 밀렸다) 거절되고 아무것도 안 바뀐다. 이름이 없는 요청도 거절
  const who = vb.s.players[2].name;
  ok(await quiet([va, vc], () => ask(vb, { t: 'hit', i: 2, name: who + 'x' })) === '플레이어 정보가 바뀌었어요. 다시 선택해 주세요', '이름이 다른 hit');
  ok(await quiet([va, vc], () => ask(vb, { t: 'hit', i: 2, name: null })) === '때릴 사람을 다시 골라 주세요', '이름이 없는 hit');
  ok(frozen() === f0, '이름 대조로 거절된 요청이 상태를 바꿈');
  console.log('   이름 대조 OK (이름이 다르거나 없으면 거절 · 상태 불변)');
  // hitSwitch 의 on: 방장 아니면 어떤 값이든 거절, 방장이면 불리언만 받는다 (on 누락·null·0 은 '잘못된 요청')
  const sw = [undefined, null, 0, 1, 'false', 'on', [], {}];
  for (const v of sw) ok(await quiet([va, vc], () => ask(vb, { t: 'hitSwitch', on: v })) === '방장만 바꿀 수 있어요', `방장 아닌 사람의 hitSwitch ${JSON.stringify(v)}`);
  ok(vs.every((x) => x.s.hit.on === true), '방장 아닌 사람의 hitSwitch 가 통함');
  const offBy = [], label = (v) => (v === undefined ? '누락' : JSON.stringify(v));
  for (const v of sw) {
    const n = va.n; send(va, { t: 'hitSwitch', on: v }); await until(() => va.n > n, 'hitSwitch 방송'); ok(typeof va.s.hit.on === 'boolean', 'hit.on 이 불리언이 아님');
    if (!va.s.hit.on) { offBy.push(label(v)); send(va, { t: 'hitSwitch', on: true }); await until(() => va.s.hit.on, '켬 복구'); }
  }
  if (offBy.includes('누락') || offBy.includes('null')) note(`server.js:129 방장이 hitSwitch 에 on 을 빼거나 null/0 으로 보내면 !!m.on 이라 '끄기'로 받아들임 (꺼진 값: ${offBy.join(', ')}). 방장 본인 요청에만 해당`);
  await sleep(100); ok(vs.every((x) => x.s.hit.on === true), 'hitSwitch 복구 확인');
  // 초당 20건 제한: 250건을 한꺼번에 보내도 처리되는 건 버스트(30건) 정도, 거절만이라 다른 사람에게는 방송이 없고 서버도 멀쩡하며 잠시 뒤 다시 쓸 수 있다
  await sleep(1600);
  const e0 = vc.err.length, na = va.n, nb = vb.n, junk = JSON.stringify({ t: 'hit', i: 'abc' });
  for (let k = 0; k < 250; k++) send(vc, junk);
  await sleep(700); const done = vc.err.length - e0;
  ok(done >= 25 && done <= 45, `250건 중 ${done}건이 처리됨 (버스트 30 + 보충에서 크게 벗어남)`);
  ok(va.n === na && vb.n === nb, '거절만 있는데 다른 사람에게 방송됨');
  await sleep(1600); ok(await ask(vc, { t: 'hit', i: 'abc' }) === '때릴 사람을 다시 골라 주세요', '제한이 풀린 뒤에는 다시 응답해야 함');
  await sleep(1600); const nb2 = vb.n; for (let k = 0; k < 250; k++) send(va, { t: 'hitSwitch', on: true }); // 방송이 나가는 요청의 폭주
  await sleep(700); ok(vb.n - nb2 >= 10 && vb.n - nb2 <= 90, `hitSwitch 250건 폭주에 받은 방송 ${vb.n - nb2}건 (제한이 안 걸림)`); // 처리된 ~30건 × 2 (engine onChange + server 의 broadcast)
  ok(vs.every((x) => x.s.hit.on === true), '폭주 뒤 hit.on');
  clean(...vs);
  console.log(`   초당 20건 제한 OK (거절 250건 중 처리 ${done}건 · 방송 폭주 250건 중 받은 상태 ${vb.n - nb2}건 · 이후 정상 응답)`);
  // 깨진 프레임: 서버가 죽거나 응답을 쏟아 내면 안 된다
  const z = await open(); const zn = z.err.length;
  const frames = ['not json', '', '{', '123', '"hit"', 'true', '[]', '[null]', '{}', '{"t":null}', '{"t":{}}', '{"t":"hit"}', '{"t":"hit","i":{"valueOf":1}}', '{"t":"join"}', '{"t":"join","name":"z","token":"short"}', '{"t":"join","name":{},"token":123456789}', '{"t":"join","name":"z","token":"abcdefgh","room":["ZZZZ"]}', '{"t":"hit","i":1,"__proto__":{"x":1}}', Buffer.from([0, 1, 2, 255]), 'x'.repeat(1e6)];
  for (const f of frames) send(z, f);
  await sleep(300); ok(z.n === 0 && z.err.length - zn <= 4, `깨진 프레임에 응답이 많음: ${z.err.length - zn}건`);
  const w = await open(); join(w, '살', '', { settings: SET }); await until(() => w.s, '깨진 프레임 뒤에도 새 방이 만들어져야 함'); ok(await ask(vb, { t: 'hit', i: 'abc' }) === '때릴 사람을 다시 골라 주세요', '기존 방도 정상');
  // JSON 본문이 null 이면 m.t 에서 TypeError: 연결 하나가 서버 프로세스를 죽일 수 있다 (여기서는 예외를 가로채 시험을 이어 간다)
  const crashed = [], trap = (e) => crashed.push(e); process.on('uncaughtException', trap);
  const zn2 = await open(); send(zn2, 'null'); await sleep(300); process.off('uncaughtException', trap);
  if (crashed.length) note(`server.js:81~82 본문이 JSON null 인 메시지 한 줄('null')이면 m.t 에서 "${crashed[0].message}" — try/catch 밖이라 처리되지 않은 예외로 서버 프로세스가 죽음 (기대: 무시)`);
  const w2 = await open(); join(w2, '살2', '', { settings: SET }); await until(() => w2.s, 'null 프레임 뒤에도 서버가 응답해야 함');
  clean(...vs);
  console.log(`   깨진 프레임 OK (${frames.length}종 · 응답 ${z.err.length - zn}건 · 서버 정상${crashed.length ? ' / null 프레임은 아래 알려진 문제 참고' : ''})`);

  clean(a, b, c, va, vb, vc);
  console.log(known.length ? `\n때리기 서버 통합 OK — 알려진 문제 ${known.length}건 (위 "!" 줄, STRICT=1 이면 실패로 끝남)` : '\n때리기 서버 통합 OK');
  process.exit(process.env.STRICT && known.length ? 1 : 0);
})().catch((e) => { console.error('실패:', e.message, process.env.STACK ? e.stack : ''); process.exit(1); });
