// 연습 테이블 서버 통합 시험: node test-practice.js
// 자체 서버를 3101번으로 띄워 접속해 본다 (연출 대기 없이 빠르게).
process.env.PORT = 3101; process.env.HOLDEM_FAST = '1';
const { Table } = require('./engine');
const emit = Table.prototype.emit;
Table.prototype.emit = function (ev) { emit.call(this, ev); this.anim = 0; this.animUntil = 0; };
require('./server');
const WS = require('ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, what, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('시간 초과: ' + what); await sleep(25); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const open = () => new Promise((res) => {
  const ws = new WS('ws://localhost:3101'), c = { ws, s: null, err: [], got: [], token: 'tok-' + Math.random().toString(36).slice(2) + Date.now() };
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'state') c.s = m; else { c.got.push(m.t); if (m.t === 'error') c.err.push(m.msg); if (m.t === 'chat') (c.chat = c.chat || []).push(m.m); if (m.t === 'chatlog') c.chatlog = m.msgs; } });
  ws.on('open', () => res(c));
});
const send = (c, o) => c.ws.send(JSON.stringify(o));
const join = (c, name, room, extra = {}) => send(c, { t: 'join', room, name, token: c.token, ...extra });
const SET = { buyIn: 10000, sb: 100, bb: 200, blindMinutes: 0, maxRebuys: 2 };
const botsOf = (c) => c.s.players.filter((p) => p.bot).length;

(async () => {
  // 1) 연습 테이블: 기본 봇 4명, 방장만 추가/삭제, 총 2~10명
  const a = await open(); join(a, '가', '', { practice: true, settings: SET });
  await until(() => a.s && a.s.practice, '연습 방 생성');
  ok(botsOf(a) === 4 && a.s.players.length === 5, `기본 봇이 4명이 아님: ${botsOf(a)}`);
  for (let k = 0; k < 5; k++) send(a, { t: 'addBot' });
  await until(() => a.s.players.length === 10, '10명까지 추가');
  send(a, { t: 'addBot' }); await until(() => a.err.some((e) => /가득/.test(e)), '10명 초과 거절');
  while (a.s.players.length > 2) { const n = a.s.players.length; send(a, { t: 'removeBot', i: n - 1 }); await until(() => a.s.players.length === n - 1, '봇 삭제'); }
  send(a, { t: 'removeBot', i: 1 }); await until(() => a.err.some((e) => /최소 2명/.test(e)), '2명 미만 삭제 거절');
  send(a, { t: 'removeBot', i: 0 }); await until(() => a.err.some((e) => /봇이 아니에요|최소/.test(e)), '사람 삭제 거절');

  // 2) 다른 사람이 같은 연습 방에 들어와도 봇 관리는 방장만
  const code = a.s.room, b = await open(); join(b, '나', code);
  await until(() => b.s && b.s.players.length === 3, '다른 사람 입장');
  send(b, { t: 'addBot' }); await until(() => b.err.some((e) => /방장만/.test(e)), '방장 아닌 사람의 봇 추가 거절');
  send(b, { t: 'leave' }); await until(() => b.got.includes('left'), '나가기 응답');
  await until(() => a.s.players.length === 2, '나간 자리가 지워짐');

  // 3) 방장이 나가면 방이 지워진다 (사람이 없으니 봇만 남는 방은 만들지 않는다)
  send(a, { t: 'leave' }); await until(() => a.got.includes('left'), '방장 나가기 응답'); await sleep(100);
  const c = await open(); join(c, '다', code); await until(() => c.err.some((e) => /찾을 수 없/.test(e)), '지워진 방 입장 거절');

  // 4) 일반 테이블에서는 봇을 못 쓰고, 나가기는 된다
  const d = await open(); join(d, '라', '', { settings: SET }); await until(() => d.s && d.s.players.length === 1 && !d.s.practice, '일반 방 생성');
  send(d, { t: 'addBot' }); await until(() => d.err.some((e) => /연습 테이블에서만/.test(e)), '일반 방 봇 추가 거절');
  send(d, { t: 'leave' }); await until(() => d.got.includes('left'), '일반 방 나가기');

  // 5) 연습 게임을 끝까지: 사람은 콜/체크만, 봇이 알아서 치고, 방장이 끝내면 정산 합계 0
  const e = await open(); join(e, '마', '', { practice: true, settings: SET });
  await until(() => e.s && botsOf(e) === 4, '게임용 방');
  send(e, { t: 'leave' }); // 시작 전에는 나갔다가 다시 만들 수 있다
  await until(() => e.got.includes('left'), '나가기'); const f = await open(); join(f, '바', '', { practice: true, settings: SET });
  await until(() => f.s && botsOf(f) === 4, '게임용 방 2'); send(f, { t: 'start' });
  const me = () => f.s.me, myTurn = () => f.s.toAct === me() && ['preflop', 'flop', 'turn', 'river'].includes(f.s.phase);
  let key = '', gone = false;
  const t0 = Date.now();
  while (!gone) {
    if (Date.now() - t0 > 60000) throw new Error(`게임이 진행되지 않음 (핸드 ${f.s.handNo}, phase ${f.s.phase})`);
    if (f.s.players[me()].chips === 0 && f.s.players[me()].rebuysLeft > 0 && !['preflop', 'flop', 'turn', 'river'].includes(f.s.phase)) send(f, { t: 'rebuy' });
    if (myTurn()) { const k = `${f.s.handNo}|${f.s.phase}|${f.s.currentBet}|${f.s.evSeq}`; if (k !== key) { key = k; send(f, { t: 'act', a: f.s.currentBet > f.s.players[me()].bet ? 'call' : 'check' }); } }
    const live = ['preflop', 'flop', 'turn', 'river'].includes(f.s.phase); // 판이 끝나면 total(투입액)은 이미 칩에 반영돼 있다
    const sum = f.s.players.reduce((x, p) => x + p.chips + (live ? p.total : 0), 0), want = f.s.players.reduce((x, p) => x + p.buyIns * f.s.startChips, 0);
    ok(sum === want, `진행 중 칩 합계가 어긋남 (${sum} / ${want})`);
    if (f.s.handNo >= 8 && !f.endSent) { f.endSent = true; send(f, { t: 'end' }); } // 방장이 종료: 판이 진행 중이어도 바로
    gone = f.got.includes('left');
    ok(!f.s.ended, '연습인데 정산 화면 상태(ended)가 방송됨');
    await sleep(20);
  }
  const code5 = f.s.room, f2 = await open(); join(f2, '타', code5); await until(() => f2.err.some((m) => /찾을 수 없/.test(m)), '종료한 연습 방은 지워짐');
  console.log(`연습 테이블 통합 OK (${f.s.handNo}핸드에서 방장이 종료 → 정산 없이 메인으로, 방 삭제)`);

  // 6) 사람이 올인만 하면(리바인 없음) 곧 끝난다: 정산 없이 이유와 함께 메인으로
  const z = await open(); let leftMsg = null; z.ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.t === 'left') leftMsg = m; });
  join(z, '올', '', { practice: true, settings: { ...SET, maxRebuys: 0 } }); await until(() => z.s && botsOf(z) === 4, '올인용 방'); send(z, { t: 'start' });
  const t1 = Date.now(); let zk = '';
  while (!leftMsg) {
    if (Date.now() - t1 > 90000) throw new Error('올인만 하는데도 연습이 끝나지 않음');
    if (z.s.toAct === z.s.me && ['preflop', 'flop', 'turn', 'river'].includes(z.s.phase)) { const k = `${z.s.handNo}|${z.s.phase}|${z.s.currentBet}|${z.s.evSeq}`; if (k !== zk) { zk = k; send(z, { t: 'act', a: 'raise', amount: 1e9 }); } }
    ok(!z.s.ended, '자동 종료인데 정산 화면 상태(ended)가 방송됨');
    await sleep(20);
  }
  ok(/연습이 끝났어요/.test(leftMsg.msg || ''), `자동 종료 안내 문구가 없음: ${JSON.stringify(leftMsg)}`);
  console.log(`연습 자동 종료 OK ("${leftMsg.msg}")`);
  // 한마디 말풍선: 방 안 모두의 상태에 같은 이벤트로 실린다 / 채팅: 방 안 모두에게 가고, 나중에 들어온 사람은 최근 대화를 받는다
  const g = await open(); join(g, '사', '', { practice: true, settings: SET }); await until(() => g.s && botsOf(g) === 4, '채팅용 방');
  const h2 = await open(); join(h2, '아', g.s.room); await until(() => h2.s && h2.s.players.length === 6, '두 번째 사람 입장');
  send(g, { t: 'emote', k: 'text', text: '안녕하세요 반가워요 모두' });
  await until(() => h2.s.events.some((e) => e.e === 'text'), '한마디 이벤트 전달');
  ok(h2.s.events.find((e) => e.e === 'text').text === '안녕하세요 반가워요' && h2.s.events.find((e) => e.e === 'text').name === '사', '한마디 내용/길이가 이상함');
  send(g, { t: 'chat', text: '채팅 첫 줄' }); await until(() => h2.chat && h2.chat.length === 1 && g.chat && g.chat.length === 1, '채팅 전달');
  ok(h2.chat[0].text === '채팅 첫 줄' && h2.chat[0].name === '사' && h2.chat[0].mine === false && g.chat[0].mine === true, '채팅 mine 표시가 틀림');
  ok(!JSON.stringify(h2.chat[0]).includes('tok-'), '채팅에 토큰이 새어 나감');
  send(g, { t: 'chat', text: '또' }); await until(() => g.err.some((e) => /잠시 뒤/.test(e)), '채팅 속도 제한');
  const late = await open(); join(late, '자', g.s.room); await until(() => late.chatlog, '늦게 입장'); ok(late.chatlog.length === 1 && late.chatlog[0].text === '채팅 첫 줄', '늦게 들어온 사람이 최근 대화를 못 받음');
  process.exit(0);
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
