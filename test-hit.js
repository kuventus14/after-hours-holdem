// 때리기 엔진 시험: node test-hit.js
// 쿨다운(3핸드) · 기절 수명주기(패를 안 받음, 블라인드 안 냄, 핸드가 끝나면 깨어남) · 합의금 · 방장 스위치 · 가드 · 연습 테이블 · 무작위 대량 시험(칩 합계·교착·정산)
const { Table, computeSettlement, HIT_COST, STUN_PAY, HIT_COOLDOWN } = require('./engine');
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => ok(a === b, `${m}: ${a} != ${b}`);

const mk = (n, o = {}) => {
  const t = new Table({ auto: false, pace: false });
  t.applySettings({ sb: 10, bb: 20, chips: 10000, buyIn: 10000, blindMinutes: 0, maxRebuys: 99, ...o });
  for (let i = 0; i < n; i++) t.addPlayer('t' + i, 'P' + i);
  return t;
};
const playOut = (t) => { for (let g = 0; t.inProgress() && g < 600; g++) { const p = t.players[t.toAct]; t.act(p.token, t.currentBet - p.bet > 0 ? 'call' : 'check'); } ok(!t.inProgress(), '핸드가 끝나지 않음'); };
const foldAll = (t) => { for (let g = 0; t.inProgress() && g < 600; g++) { const p = t.players[t.toAct]; t.act(p.token, t.currentBet - p.bet > 0 ? 'fold' : 'check'); } ok(!t.inProgress(), '핸드가 끝나지 않음'); };
const chipsPlusPot = (t) => t.players.reduce((s, p) => s + p.chips, 0) + (t.inProgress() ? t.pot : 0);
const supply = (t) => t.players.reduce((s, p) => s + p.buyIns, 0) * t.startChips;
const free = (t) => { t.hitUntil = 0; }; // 화면 연출 시간(11초)은 시험에서 건너뛴다

// 1) 판 도중에 때리기: 앞 스택끼리만 옮기고 팟·베팅은 그대로, 맞은 사람은 기절 예고
{
  const t = mk(4); t.startHand();
  const pot0 = t.pot, bet0 = t.players.map((p) => p.bet), tot0 = t.players.map((p) => p.total), h = 1, v = 2;
  const c0 = [t.players[h].chips, t.players[v].chips], seq0 = t.evSeq;
  eq(t.hit('t1', v), null, '판 도중 때리기');
  eq(t.players[h].chips, c0[0] - HIT_COST, '때린 사람 칩'); eq(t.players[v].chips, c0[1] + HIT_COST, '맞은 사람 칩');
  eq(t.pot, pot0, '팟 불변'); ok(t.players.every((p, i) => p.bet === bet0[i] && p.total === tot0[i]), '베팅·투입액 불변');
  eq(t.players[v].stun, 'pending', '기절 예고'); eq(t.players[v].stunBy, 't1', '때린 사람 기록');
  eq(t.lastHitHand, t.handNo, '때린 핸드 기록'); eq(t.hitSeq, 1, 'hitSeq');
  const ev = t.events.filter((e) => e.id > seq0);
  ok(ev.some((e) => e.k === 'hit' && e.i === h && e.to === v && e.amt === HIT_COST), 'hit 이벤트');
  eq(t.animUntil <= Date.now() + 5000, true, '때리기는 판 진행 시간을 늘리지 않음');
  const vw = t.view('t2');
  eq(vw.players[v].stun, 'pending', 'view stun'); eq(vw.players[v].stunBy, h, 'view stunBy'); eq(vw.hit.on, true, 'view hit.on'); eq(vw.hit.lastHitHand, t.handNo, 'view lastHitHand');
  eq(chipsPlusPot(t), supply(t), '칩 합계 보존');
  playOut(t); eq(chipsPlusPot(t), supply(t), '핸드 뒤 칩 합계');
}

// 2) 쿨다운: 때린 핸드 H, H+1, H+2 는 불가, H+3 부터 가능 (테이블 전체)
{
  const t = mk(5); t.startHand(); const H = t.handNo;
  eq(t.hit('t1', 2), null, 'H 에서 때리기');
  free(t); ok(/이미 .*때렸어요/.test(t.hit('t3', 4)), `같은 핸드 거절 문구: ${t.hit('t3', 4)}`);
  ok(/이미 .*때렸어요/.test(t.hit('t1', 3)), '때린 사람도 같은 핸드 거절');
  playOut(t); t.startHand(); eq(t.handNo, H + 1, 'H+1'); free(t);
  ok(/2핸드 뒤부터/.test(t.hit('t3', 4)), `H+1 거절: ${t.hit('t3', 4)}`);
  playOut(t); t.startHand(); eq(t.handNo, H + 2, 'H+2'); free(t);
  ok(/1핸드 뒤부터/.test(t.hit('t3', 4)), `H+2 거절: ${t.hit('t3', 4)}`);
  playOut(t); t.startHand(); eq(t.handNo, H + HIT_COOLDOWN, 'H+3'); free(t);
  eq(t.hit('t3', 4), null, 'H+3 에는 다시 가능'); eq(t.lastHitHand, H + 3, '새 기록');
  // 연출이 진행 중이면 그 사실을 먼저 알린다
  const u = mk(4); u.startHand(); u.hit('t1', 2); ok(/때리는 중/.test(u.hit('t0', 3)), '연출 진행 중 문구');
}

// 3) 기절 수명주기: 다음 핸드 시작 때 기절 → 패를 받지 않고(블라인드도 안 냄) → 핸드가 끝나면 깨어남 → 그다음 핸드는 정상
{
  const t = mk(5); t.startHand(); const H = t.handNo, v = 2;
  t.hit('t1', v); eq(t.players[v].stun, 'pending', '핸드 도중엔 예고만'); ok(t.players[v].inHand, '이번 핸드는 그대로 뜀');
  playOut(t); eq(t.players[v].stun, 'pending', '핸드가 끝나도 예고 유지');
  const chipsBefore = t.players[v].chips;
  t.startHand(); eq(t.handNo, H + 1, 'H+1 시작');
  const p = t.players[v];
  eq(p.stun, 'out', '기절 중'); eq(p.inHand, false, '핸드에 안 들어감'); eq(p.hole.length, 0, '패를 안 받음'); eq(p.bet, 0, '블라인드 안 냄'); eq(p.chips, chipsBefore, '칩 그대로');
  ok(t.sbIdx !== v && t.bbIdx !== v, '블라인드 자리에서 빠짐'); ok(!t.events.some((e) => e.k === 'deal' && e.to === v && e.id > t.evSeq - 40 && t.events.filter((x) => x.k === 'hand').pop().id < e.id), '이번 핸드 deal 이벤트가 기절한 사람에게 가지 않음');
  eq(t.players.filter((q) => q.inHand).length, 4, '나머지 4명이 핸드에 참여');
  eq(t.view('t2').players[v].stun, 'out', 'view: out'); eq(t.view('t2').players[v].cards.length, 0, 'view: 카드 없음');
  ok(p.lastAction === '기절', '플레이트 표시용 lastAction');
  eq(chipsPlusPot(t), supply(t), '기절 핸드 칩 합계');
  playOut(t); eq(p.stun, '', '핸드가 끝나면 깨어남'); eq(p.stunBy, '', 'stunBy 비움');
  t.startHand(); eq(t.players[v].inHand, true, '그다음 핸드는 정상 참여'); eq(t.players[v].hole.length, 2, '패를 받음');
}

// 4) 합의금: 맞은 사람이 다음 핸드 전에 1,500 을 내면 기절이 풀린다
{
  const t = mk(4); t.startHand(); t.hit('t1', 2); playOut(t); free(t);
  const [a, b] = [t.players[1].chips, t.players[2].chips];
  eq(t.payStun('t0'), '기절 상태가 아니에요', '맞지 않은 사람'); ok(t.payStun('t1') === '기절 상태가 아니에요', '때린 사람은 해당 없음');
  const seq0 = t.evSeq; eq(t.payStun('t2'), null, '합의금');
  eq(t.players[1].chips, a + STUN_PAY, '때린 사람이 받음'); eq(t.players[2].chips, b - STUN_PAY, '맞은 사람이 냄'); eq(t.players[2].stun, '', '기절 풀림');
  ok(t.events.some((e) => e.id > seq0 && e.k === 'pay' && e.i === 2 && e.to === 1 && e.amt === STUN_PAY), 'pay 이벤트');
  eq(t.payStun('t2'), '기절 상태가 아니에요', '두 번은 안 됨');
  t.startHand(); eq(t.players[2].inHand, true, '합의금을 냈으면 다음 핸드 참여'); eq(t.players[2].hole.length, 2, '패를 받음');
  // 기절이 시작된 뒤에는 늦음
  const u = mk(4); u.startHand(); u.hit('t1', 2); playOut(u); u.startHand(); eq(u.payStun('t2'), '이미 이번 핸드를 쉬는 중이에요', '기절 핸드 중에는 못 품');
  // 칩 부족
  const w = mk(4, { chips: 3000, buyIn: 3000 }); w.startHand(); w.hit('t1', 2); w.players[2].chips = STUN_PAY; eq(w.payStun('t2'), '칩이 부족해서 합의금을 낼 수 없어요', '칩이 딱 1,500 이면 부족');
  eq(w.players[2].stun, 'pending', '실패하면 그대로');
  // 판 도중에도 낼 수 있고 판돈은 그대로
  const x = mk(4); x.startHand(); x.hit('t1', 2); const pot = x.pot; eq(x.payStun('t2'), null, '판 도중 합의금'); eq(x.pot, pot, '팟 불변'); eq(chipsPlusPot(x), supply(x), '합계 보존');
}

// 5) 방장 스위치: 꺼져 있으면 '방장 권한으로 폭력은 안됩니다.', 방장만 바꿈, 이미 맞은 사람의 합의금은 꺼도 가능
{
  const t = mk(4); t.startHand();
  eq(t.hitOn, true, '기본 켜짐'); eq(t.hitSwitch('t1', false), '방장만 바꿀 수 있어요', '방장 아님');
  eq(t.hitSwitch('t0', false), null, '끄기'); eq(t.view('t1').hit.on, false, 'view 에 반영');
  const c2 = t.players[2].chips; eq(t.hit('t1', 2), '방장 권한으로 폭력은 안됩니다.', '꺼진 상태 문구'); eq(t.players[2].chips, c2, '칩 불변');
  eq(t.hitSwitch('t0', true), null, '켜기'); eq(t.hit('t1', 2), null, '켜면 가능');
  t.hitSwitch('t0', false); eq(t.payStun('t2'), null, '꺼도 이미 맞은 사람은 합의금 가능');
}

// 6) 가드
{
  const t = mk(4); t.startHand();
  eq(t.hit('t1', 1), '때릴 사람을 다시 골라 주세요', '자기 자신'); eq(t.hit('t1', 9), '때릴 사람을 다시 골라 주세요', '없는 사람'); eq(t.hit('t1', NaN), '때릴 사람을 다시 골라 주세요', 'NaN'); eq(t.hit('nobody', 2), '플레이어가 아니에요', '모르는 토큰');
  t.players[1].chips = HIT_COST + t.bb - 1; ok(/칩이 부족/.test(t.hit('t1', 2)), '때린 뒤 빅블라인드 미만이면 거절'); eq(t.players[1].chips, HIT_COST + t.bb - 1, '칩 불변');
  t.players[1].chips = HIT_COST + t.bb; eq(t.hit('t1', 2), null, '딱 빅블라인드 남기면 가능'); eq(t.players[1].chips, t.bb, '빅블라인드가 남음');
  const u = mk(4); u.startHand(); u.players[2].chips = 0; ok(/칩이 없거나/.test(u.hit('t1', 2)), '칩 없는 사람');
  const w = mk(4); w.startHand(); w.players[2].connected = false; ok(/칩이 없거나|나간/.test(w.hit('t1', 2)), '연결 끊긴 사람');
  const x = mk(3); x.startHand(); x.players[0].connected = false; ok(/남는 사람이 적어서/.test(x.hit('t1', 2)), '남는 사람이 2명 미만');
  const y = mk(2); y.startHand(); ok(/남는 사람이 적어서/.test(y.hit('t0', 1)), '2명이면 못 때림');
  const z = mk(4); z.startHand(); z.endAfterHand = true; ok(/마지막 핸드/.test(z.hit('t1', 2)), '종료 예약 중'); z.endAfterHand = false; z.paused = true; ok(/휴식/.test(z.hit('t1', 2)), '일시정지 중'); z.paused = false; z.ended = true; eq(z.hit('t1', 2), '게임이 끝났어요', '끝난 게임');
  const q = mk(4); eq(q.hit('t1', 2), '게임이 시작된 뒤에 쓸 수 있어요', '시작 전');
  // 기절한 사람은 때릴 수 없다(쿨다운 뒤에도 기절 중이면)
  const r = mk(5); r.startHand(); r.hit('t1', 2); playOut(r); r.startHand(); free(r); r.lastHitHand = -99; eq(r.players[2].stun, 'out', '기절 중'); ok(/기절한 사람은 때릴 수 없어요/.test(r.hit('t2', 3)), '기절한 사람은 못 때림'); ok(/이미 기절/.test(r.hit('t3', 2)), '이미 기절한 사람은 못 맞음');
}

// 7) 기절 때문에 판이 안 돌아가면 기절은 풀린다 / 때린 사람이 나가면 풀린다
{
  const t = mk(3); t.startHand(); t.hit('t0', 1); playOut(t);
  t.players[2].connected = false; // 남은 건 때린 사람(0)과 맞은 사람(1)뿐 → 맞은 사람까지 쉬면 판이 안 돌아간다
  t.startHand(); eq(t.players[1].stun, '', '기절 해제'); ok(t.phase === 'preflop', '판이 시작됨'); ok(t.players[1].inHand, '맞은 사람도 참여');
  const u = mk(4); u.startHand(); u.hit('t1', 2); playOut(u); u.players[1].kicked = true; u.startHand(); eq(u.players[2].stun, '', '때린 사람이 나가서 기절 해제'); ok(u.players[2].inHand, '참여');
  const w = mk(4); w.startHand(); const wc = w.players[2].chips; w.hit('t1', 2); w.players[1].kicked = true; eq(w.payStun('t2'), null, '때린 사람이 없으면 합의금 없이 풀림'); eq(w.players[2].stun, '', '풀림'); eq(w.players[2].chips, wc + 1000, '합의금은 안 나감 (맞은 값 1,000 만 받은 상태)');
}

// 8) 연습 테이블: 사람 한 명 + 봇 3명. 사람이 기절해도 그 핸드는 봇끼리 돌고, 다음 핸드부터 정상
{
  const t = new Table({ auto: false, pace: false }); t.practice = true;
  t.applySettings({ sb: 10, bb: 20, chips: 10000, buyIn: 10000, blindMinutes: 0, maxRebuys: 9 });
  t.addPlayer('human', '나'); for (let i = 0; i < 3; i++) t.pushBot();
  t.startHand(); const bot = t.players.find((p) => p.bot);
  eq(t.hit(bot.token, 0), null, '봇이 사람을 때림'); eq(t.players[0].stun, 'pending', '사람 기절 예고');
  playOut(t); t.startHand();
  ok(t.phase === 'preflop', '사람이 기절해도 연습 핸드는 시작됨'); eq(t.players[0].stun, 'out', '기절'); eq(t.players[0].inHand, false, '사람은 쉼'); eq(t.players.filter((p) => p.inHand).length, 3, '봇 3명이 핸드를 침');
  for (let g = 0; t.inProgress() && g < 600; g++) { const p = t.players[t.toAct]; t.act(p.token, t.currentBet - p.bet > 0 ? 'call' : 'check'); }
  eq(t.players[0].stun, '', '깨어남'); t.startHand(); eq(t.players[0].inHand, true, '다음 핸드는 사람도 참여');
}

// 9) 무작위 대량 시험: 아무 때나 때리기·합의금·스위치를 끼워 넣어도 칩 합계·진행·정산이 어긋나지 않는다
{
  const stats = { games: 0, hands: 0, hits: 0, pays: 0, stunnedHands: 0, waived: 0 };
  for (let g = 0; g < 300; g++) {
    const n = 3 + (g % 8), t = mk(n, { chips: 5000, buyIn: 5000 });
    t.startHand(); stats.games++;
    for (let h = 0; h < 30 && t.handNo > 0; h++) {
      let guard = 0;
      while (t.inProgress()) {
        if (++guard > 700) throw new Error('교착');
        if (Math.random() < 0.3) {
          const a = Math.floor(Math.random() * t.players.length), b = Math.floor(Math.random() * t.players.length), r = Math.random();
          if (r < 0.6) { t.hitUntil = 0; if (!t.hit(t.players[a].token, b)) stats.hits++; }
          else if (r < 0.9) { if (!t.payStun(t.players[a].token)) stats.pays++; }
          else t.hitSwitch(t.hostToken, Math.random() < 0.7);
        }
        const p = t.players[t.toAct], rr = Math.random(), toCall = t.currentBet - p.bet;
        let err;
        if (rr < 0.15) err = t.act(p.token, 'fold'); else if (rr < 0.6) err = t.act(p.token, toCall > 0 ? 'call' : 'check');
        else if (rr < 0.9) err = t.act(p.token, 'raise', t.currentBet + t.minRaise + Math.floor(Math.random() * 200)); else err = t.act(p.token, 'raise', 999999);
        if (err && /알 수 없는|차례/.test(err)) throw new Error('act: ' + err);
        if (err) t.act(p.token, toCall > 0 ? 'call' : 'check');
        eq(chipsPlusPot(t), supply(t), `진행 중 칩 합계 (게임 ${g} 핸드 ${h})`);
        for (const q of t.players) { ok(Number.isInteger(q.chips) && q.chips >= 0, `칩 이상: ${q.name} ${q.chips}`); if (q.inHand && !q.folded && q.chips === 0) ok(q.allIn, `칩 0인데 올인 표시 없음: ${q.name}`); ok(!(q.stun === 'out' && (q.inHand || q.hole.length)), '기절한 사람이 패를 가짐'); }
      }
      stats.hands++;
      eq(chipsPlusPot(t), supply(t), `핸드 뒤 칩 합계 (게임 ${g} 핸드 ${h})`);
      t.players.forEach((q) => q.chips === 0 && t.rebuy(q.token));
      t.startHand(); stats.stunnedHands += t.players.filter((q) => q.stun === 'out').length; // 기절은 핸드가 시작될 때 걸린다
      ok(t.players.every((q) => q.stun !== 'out' || (!q.inHand && q.hole.length === 0)), '기절자는 핸드 밖');
      if (!t.inProgress()) break;
    }
    for (let k = 0; t.inProgress() && k < 700; k++) { const p = t.players[t.toAct]; t.act(p.token, t.currentBet - p.bet > 0 ? 'call' : 'check'); }
    const s = computeSettlement(t.players, t.startChips, t.buyIn);
    eq(s.rows.reduce((x, r) => x + r.net, 0), 0, `정산 합계 0 (게임 ${g})`);
  }
  console.log(`무작위 OK  게임 ${stats.games} · 핸드 ${stats.hands} · 때리기 ${stats.hits} · 합의금 ${stats.pays} · 기절 핸드 ${stats.stunnedHands}`);
  ok(stats.hits > 500 && stats.stunnedHands > 100, '시험이 때리기·기절을 충분히 다루지 못함');
}
// 10) 검증 보고서에서 나온 허점들: 연습 대기 중 기절 새어 나감 · 게임 종료 뒤 기절 잔존 · 자리가 밀린 hit · 다음 핸드 직전 때리기
{
  // 연습 테이블에서 핸드가 못 시작돼 waiting 으로 떨어지면 기절은 시작되지 않은 것: 'pending' 으로 남아 합의금으로 풀 수 있다
  const t = new Table({ auto: false, pace: false }); t.practice = true;
  t.applySettings({ sb: 10, bb: 20, chips: 10000, buyIn: 10000, blindMinutes: 0, maxRebuys: 9 });
  t.addPlayer('human', '나'); for (let i = 0; i < 3; i++) t.pushBot();
  t.startHand(); const bot = t.players.find((p) => p.bot && p !== t.players[2]);
  eq(t.hit(t.players[1].token, 2), null, '봇이 봇을 때림'); eq(t.players[2].stun, 'pending', '예고');
  playOut(t); t.setConnected('human', false); t.startHand();
  eq(t.phase, 'waiting', '사람이 없어 대기'); eq(t.players[2].stun, 'pending', '대기로 떨어지면 기절은 시작 안 됨');
  eq(t.payStun(t.players[2].token), null, '대기 중에도 합의금으로 풀 수 있음'); eq(t.players[2].stun, '', '풀림');
  // 게임이 끝나면 기절 표시도 남지 않는다
  const u = mk(4); u.startHand(); u.hit('t1', 2); playOut(u); u.finishGame('host'); // 실제 서버처럼 핸드가 끝난 뒤에 종료
  ok(u.players.every((p) => p.stun === '' && p.stunBy === ''), '끝난 게임에 기절이 남음'); eq(u.view('t0').players[2].stun, '', 'view 에도 없음');
  // 이름 대조: 그 사이 자리가 밀렸으면 엉뚱한 사람을 때리지 않는다
  const w = mk(5); w.startHand();
  ok(/플레이어 정보가 바뀌었어요/.test(w.hit('t1', 3, 'P2')), '이름이 다르면 거절'); eq(w.players[3].stun, '', '아무도 맞지 않음'); eq(w.hitSeq, 0, 'hitSeq 불변');
  ok(/플레이어 정보가 바뀌었어요/.test(w.hit('t1', 9, 'P9')), '없는 자리도 거절');
  eq(w.hit('t1', 3, 'P3'), null, '이름이 맞으면 때림'); eq(w.players[3].stun, 'pending', '맞음');
  // 다음 핸드가 곧 시작되면(합의금 낼 시간이 없으면) 못 때린다
  const x = mk(4); x.startHand(); playOut(x); x.opts.nextHandMs = 7000;
  x.nextAt = Date.now() + 1000; ok(/곧 시작돼요/.test(x.hit('t1', 2)), '시작 1초 전엔 거절'); eq(x.players[2].stun, '', '불변');
  x.nextAt = Date.now() + 6000; eq(x.hit('t1', 2), null, '시작 6초 전엔 가능');
  const y = mk(4); y.opts.nextHandMs = 150; y.startHand(); playOut(y); y.nextAt = Date.now() + 100; eq(y.hit('t1', 2), null, '빠른 시험 모드(nextHandMs<3000)에서는 이 제한이 없다');
}
console.log('때리기 엔진 OK');
