// 카드 자랑하기 엔진 시험: node test-brag.js
// 다 폴드해서 이긴 사람만 · 8초 안에 · 한 번만 · 안 고른 카드는 내보내지 않음 · 다음 핸드는 연출이 끝난 뒤
const { Table, BRAG_MS, BRAG_ANIM_MS } = require('./engine');
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => ok(a === b, `${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const mk = (n) => { const t = new Table({ auto: false, pace: false }); t.applySettings({ sb: 10, bb: 20, chips: 10000, buyIn: 10000, blindMinutes: 0, maxRebuys: 9 }); for (let i = 0; i < n; i++) t.addPlayer('t' + i, 'P' + i); return t; };
const foldOut = (t) => { for (let g = 0; t.inProgress() && g < 100; g++) t.act(t.players[t.toAct].token, 'fold'); ok(!t.inProgress(), '폴드로 끝나야 함'); };
const callOut = (t) => { for (let g = 0; t.inProgress() && g < 600; g++) { const p = t.players[t.toAct]; t.act(p.token, t.currentBet - p.bet > 0 ? 'call' : 'check'); } ok(!t.inProgress(), '핸드가 끝나야 함'); };

// 1) 다 폴드해서 이긴 판: 이긴 사람만, 한 번만, 고른 카드만 공개
{
  const t = mk(4); t.startHand(); foldOut(t);
  const w = t.players.findIndex((p) => p.won > 0), other = (w + 1) % 4, wt = t.players[w].token, hole = t.players[w].hole.map((c) => (({ 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T' })[c.r] || String(c.r)) + c.s);
  const v = t.view(t.players[other].token);
  eq(v.brag.winner, w, 'view 의 이긴 사람'); eq(v.brag.used, false, '아직 안 씀'); ok(v.brag.until > Date.now() + BRAG_MS - 500 && v.brag.until <= Date.now() + BRAG_MS, '자랑 시한은 핸드가 끝난 뒤 8초');
  eq(t.brag(t.players[other].token, 0), '이긴 사람만 자랑할 수 있어요', '다른 사람');
  for (const bad of [2, '0', null, undefined, -1, 0.5, 'all', {}]) eq(t.brag(wt, bad), '보여 줄 카드를 다시 골라 주세요', `이상한 which ${JSON.stringify(bad)}`);
  eq(t.bragUsed, false, '거절이 상태를 바꾸지 않음');
  const seq0 = t.evSeq;
  eq(t.brag(wt, 1), null, '둘째 장만 자랑');
  const ev = t.events.find((e) => e.id > seq0 && e.k === 'brag');
  ok(ev && ev.i === w && JSON.stringify(ev.show) === '[1]', '이벤트');
  eq(ev.cards[1], hole[1], '고른 카드는 공개'); eq(ev.cards[0], '??', '안 고른 카드는 내보내지 않음');
  ok(!JSON.stringify(t.events).includes(hole[0]) || hole[0] === hole[1], '안 고른 카드가 이벤트 어디에도 없음');
  eq(t.brag(wt, 'both'), '이미 자랑했어요', '두 번은 안 됨'); eq(t.view(t.players[other].token).brag.used, true, 'view: 사용함');
  ok(t.log.some((l) => /자랑했어요/.test(l)), '로그');
}

// 2) 두 장 다 / 첫째 장
{
  const t = mk(3); t.startHand(); foldOut(t); const w = t.players.findIndex((p) => p.won > 0);
  const seq0 = t.evSeq; eq(t.brag(t.players[w].token, 'both'), null, '두 장'); const ev = t.events.find((e) => e.id > seq0 && e.k === 'brag');
  ok(ev.cards.every((c) => c !== '??') && JSON.stringify(ev.show) === '[0,1]', '둘 다 공개');
  const u = mk(3); u.startHand(); foldOut(u); const w2 = u.players.findIndex((p) => p.won > 0); u.brag(u.players[w2].token, 0);
  const e2 = u.events.filter((e) => e.k === 'brag')[0]; eq(e2.cards[1], '??', '첫째 장만이면 둘째는 숨김'); ok(e2.cards[0] !== '??', '첫째 공개');
}

// 3) 시간(8초)이 지나면 못 한다 / 끝난 게임 / 핸드 중
{
  const t = mk(4); t.startHand(); eq(t.brag('t0', 0), '다른 사람이 모두 폴드해서 이긴 판에서만 자랑할 수 있어요', '핸드 중');
  foldOut(t); const w = t.players.findIndex((p) => p.won > 0), tok = t.players[w].token;
  t.bragUntil = Date.now() - 1; eq(t.brag(tok, 0), '자랑할 수 있는 시간(8초)이 지났어요', '시간 초과'); eq(t.bragUsed, false, '상태 불변');
  t.bragUntil = Date.now() + 1000; t.ended = true; eq(t.brag(tok, 0), '게임이 끝났어요', '끝난 게임');
}

// 4) 쇼다운까지 간 판에서는 못 한다 · 새 핸드가 시작되면 닫힌다
{
  const t = mk(3); t.startHand(); callOut(t); ok(t.results.showdown, '쇼다운까지 감');
  eq(t.view('t0').brag.winner, -1, '쇼다운 판은 자랑 없음'); eq(t.brag(t.players.find((p) => p.won > 0).token, 0), '다른 사람이 모두 폴드해서 이긴 판에서만 자랑할 수 있어요', '쇼다운 판');
  const u = mk(3); u.startHand(); foldOut(u); ok(u.view('t0').brag.winner >= 0, '자랑 가능'); u.startHand(); eq(u.view('t0').brag.winner, -1, '새 핸드에서 닫힘'); eq(u.bragUntil, 0, 'bragUntil 초기화');
}

// 5) 자랑하면 다음 핸드 시작이 연출이 끝날 때까지 늦춰진다 (자동 진행 모드)
{
  const t = new Table({ auto: true, pace: false, nextHandMs: 1000, turnMs: 600000 }); t.applySettings({ sb: 10, bb: 20, chips: 10000, buyIn: 10000, blindMinutes: 0, maxRebuys: 9 });
  for (let i = 0; i < 3; i++) t.addPlayer('t' + i, 'P' + i);
  t.startHand(); foldOut(t);
  ok(t.nextAt - Date.now() < BRAG_ANIM_MS - 500, `자랑 전에는 연출 시간보다 일찍 다음 핸드: ${t.nextAt - Date.now()}ms`); const w = t.players.findIndex((p) => p.won > 0);
  eq(t.brag(t.players[w].token, 'both'), null, '자랑'); ok(t.nextAt - Date.now() >= BRAG_ANIM_MS - 100, `다음 핸드가 연출 뒤로 늦춰짐: ${t.nextAt - Date.now()}ms`);
  const hn = t.handNo; setTimeout(() => { eq(t.handNo, hn, '연출 중에는 다음 핸드가 시작되지 않음'); t.destroy(); console.log('카드 자랑하기 엔진 OK'); }, 1800);
}
