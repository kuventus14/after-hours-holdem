const { Table, score5, best, handName, computeSettlement } = require('./engine');
const C = (s) => s.split(' ').map((x) => ({ r: '23456789TJQKA'.indexOf(x[0]) + 2, s: x[1] }));
// 족보 검증
const cases = [
  ['As Ks Qs Js Ts', '로열 플러시'], ['9h 8h 7h 6h 5h', '스트레이트 플러시'], ['As Ad Ac Ah 2d', '포카드'],
  ['As Ad Ac Kh Kd', '풀하우스'], ['As 9s 7s 4s 2s', '플러시'], ['5s 4d 3c 2h As', '스트레이트'],
  ['As Ad Ac Kh 2d', '트리플'], ['As Ad Kc Kh 2d', '투페어'], ['As Ad Kc Qh 2d', '원페어'], ['As Jd 9c 4h 2d', '하이카드'],
];
for (const [h, n] of cases) { const got = handName(score5(C(h))); if (got !== n) throw new Error(`${h}: ${got} != ${n}`); }
// 순서 비교
const gt = (a, b) => { if (!(best(C(a)) > best(C(b)))) throw new Error(`${a} should beat ${b}`); };
gt('5s 4d 3c 2h 6s', '5s 4d 3c 2h As'); // 6-high straight > wheel
gt('As Ad Kc Qh 2d', 'Ks Kd Ac Qh 2d'); gt('As Ad Kc Qh 3d', 'As Ad Kc Qh 2d');
gt('2s 2d 2c 3h 3d', 'As Ad Ac Kh 2c'.replace('2c','4d')) ;
console.log('족보 OK');

// 무작위 봇 시뮬레이션: 칩 총합 보존 + 교착 없음
let hands = 0;
for (let g = 0; g < 300; g++) {
  const n = 2 + (g % 9);
  const t = new Table({ auto: false, pace: false });
  t.applySettings({ sb: 10, bb: 20, chips: 1000, buyIn: 10000, blindMinutes: 0, maxRebuys: 99 });
  for (let i = 0; i < n; i++) t.addPlayer('t' + i, 'P' + i);
  let total0 = t.players.reduce((s, p) => s + p.chips, 0);
  t.startHand();
  for (let h = 0; h < 40; h++) {
    let guard = 0;
    while (t.inProgress()) {
      if (++guard > 500) throw new Error('교착');
      const p = t.players[t.toAct];
      const r = Math.random(), toCall = t.currentBet - p.bet;
      let err;
      if (r < 0.15) err = t.act(p.token, 'fold');
      else if (r < 0.65) err = t.act(p.token, toCall > 0 ? 'call' : 'check');
      else if (r < 0.9) err = t.act(p.token, 'raise', t.currentBet + t.minRaise + Math.floor(Math.random() * 100));
      else err = t.act(p.token, 'raise', 99999);
      if (err && /알 수 없는|차례/.test(err)) throw new Error(err);
      if (err) t.act(p.token, toCall > 0 ? 'call' : 'check');
    }
    const sum = t.players.reduce((s, p) => s + p.chips, 0);
    if (sum !== total0) throw new Error(`칩 불일치 ${sum} != ${total0} (게임 ${g}, 핸드 ${h})`);
    hands++;
    t.players.forEach((p) => p.chips === 0 && t.rebuy(p.token)); // 리바이로 총합이 늘어남 → 기준 갱신
    total0 = t.players.reduce((s, p) => s + p.chips, 0);
    t.startHand();
    if (!t.inProgress()) break;
  }
}
console.log('시뮬레이션 OK, 핸드 수:', hands);

// ───── 정산 정확도 ─────
function checkSettlement(rowsIn, startChips, buyIn) {
  const s = computeSettlement(rowsIn, startChips, buyIn);
  const net = new Map(s.rows.map((r) => [r.i, r.net]));
  if (s.rows.reduce((x, r) => x + r.net, 0) !== 0) throw new Error('손익 합계가 0이 아님');
  // 송금을 실제로 적용하면 모든 사람의 잔액이 정확히 0이 되어야 한다
  const bal = new Map(s.rows.map((r) => [r.i, r.net]));
  for (const tr of s.transfers) { bal.set(tr.from, bal.get(tr.from) + tr.amount); bal.set(tr.to, bal.get(tr.to) - tr.amount); if (tr.amount <= 0 || tr.from === tr.to) throw new Error('잘못된 송금'); }
  for (const [i, v] of bal) if (v !== 0) throw new Error(`송금 후 ${i}번 잔액 ${v}`);
  if (s.transfers.length > Math.max(0, rowsIn.length - 1)) throw new Error('송금 건수가 너무 많음');
  // 금액 손익은 칩 손익 × 단가와 1원 이상 차이나면 안 된다 (반올림 보정 한도)
  for (const r of s.rows) if (Math.abs(r.net - (r.netChips * buyIn) / startChips) >= 1) throw new Error('반올림 오차가 1원 이상');
  for (const r of s.rows) if (r.value !== r.invested + r.net) throw new Error('보유 가치 불일치');
  return s;
}
let settleCases = 0;
for (let g = 0; g < 20000; g++) {
  const n = 2 + Math.floor(Math.random() * 9);
  const startChips = [1000, 1500, 3000, 700, 10000, 333][Math.floor(Math.random() * 6)];
  const buyIn = [10000, 5000, 3333, 7777, 1, 0, 50000, 12345][Math.floor(Math.random() * 8)];
  const players = Array.from({ length: n }, (_, i) => ({ name: 'P' + i, buyIns: 1 + Math.floor(Math.random() * 4), chips: 0 }));
  const total = players.reduce((x, p) => x + p.buyIns * startChips, 0);
  // 총 칩을 무작위로 분배 (일부는 0)
  let left = total;
  players.forEach((p, i) => { p.chips = i === n - 1 ? left : (Math.random() < 0.3 ? 0 : Math.floor(Math.random() * left)); left -= p.chips; });
  checkSettlement(players, startChips, buyIn); settleCases++;
}
// 손으로 계산 가능한 예: 3명, 바이인 10,000원 = 1,000칩. A 2,000칩(+10,000원) B 1,000칩(0) C 0칩(-10,000원)
{
  const s = computeSettlement([{ name: 'A', buyIns: 1, chips: 2000 }, { name: 'B', buyIns: 1, chips: 1000 }, { name: 'C', buyIns: 1, chips: 0 }], 1000, 10000);
  const j = JSON.stringify(s.transfers.map((x) => [x.fromName, x.toName, x.amount]));
  if (j !== '[["C","A",10000]]') throw new Error('손계산 예제 불일치 ' + j);
}
// 나누어떨어지지 않는 예: 3명이 3333원 바이인 → 1원 단위가 남아도 합계는 0
{
  const s = computeSettlement([{ name: 'A', buyIns: 1, chips: 1500 }, { name: 'B', buyIns: 1, chips: 1000 }, { name: 'C', buyIns: 1, chips: 500 }], 1000, 3333);
  const nets = s.rows.map((r) => r.net).sort((a, b) => a - b);
  if (nets.reduce((x, v) => x + v, 0) !== 0) throw new Error('합계 0 아님');
}
console.log(`정산 OK (무작위 ${settleCases}건 + 손계산 예제)`);

// ───── 리바인 제한 / 자동 종료 / 블라인드 인상 ─────
// 올인 대결이 무승부(팟 나눔)면 칩 0인 사람이 없으므로, 승부가 날 때까지 새 테이블로 다시 시도한다
function allInDuel(opts) {
  for (let tries = 0; tries < 500; tries++) {
    const t = new Table({ auto: false, pace: false });
    t.applySettings(opts);
    const clock = { now: 1_000_000 }; t.clock = () => clock.now;
    t.addPlayer('a', 'A'); t.addPlayer('b', 'B');
    t.start('a');
    while (t.inProgress()) { const p = t.players[t.toAct]; t.act(p.token, 'raise', 99999); if (t.inProgress()) t.act(t.players[t.toAct].token, 'call'); }
    if (t.players.some((p) => p.chips === 0)) return { t, clock };
  }
  throw new Error('500번 시도해도 승부가 나지 않음');
}
{
  const { t, clock } = allInDuel({ sb: 10, bb: 20, chips: 1000, buyIn: 10000, blindMinutes: 10, maxRebuys: 1 });
  if (t.sb !== 10 || t.bb !== 20) throw new Error('시작 블라인드 틀림');
  const loser = t.players.find((p) => p.chips === 0);
  clock.now += 10 * 60000 + 1; // 10분 경과 → 다음 핸드에서 블라인드 2배
  if (t.rebuy(loser.token) !== null) throw new Error('첫 리바인은 가능해야 함');
  if (loser.buyIns !== 2) throw new Error('리바인 횟수 증가 안 됨');
  t.startHand();
  if (t.sb !== 20 || t.bb !== 40) throw new Error(`블라인드 인상 안 됨 ${t.sb}/${t.bb}`);
  clock.now += 25 * 60000; // 25분 더 → 2번 더 올라야 함 (10분 단위로 정확히 지난 만큼)
  while (t.inProgress()) { const p = t.players[t.toAct]; t.act(p.token, 'raise', 99999); if (t.inProgress()) t.act(t.players[t.toAct].token, 'call'); }
  const l2 = t.players.find((p) => p.chips === 0);
  if (l2) {
    t.startHand === undefined;
    const used = l2.buyIns - 1;
    const err = t.rebuy(l2.token);
    if (used >= 1 && err === null) throw new Error('리바인 한도 초과인데 허용됨');
  }
}
{
  // 블라인드 인상(확정적): 아무도 탈락하지 않는 폴드 전용 핸드로, 10분 단위로 정확히 지난 만큼만 오르는지 확인
  const t = new Table({ auto: false, pace: false });
  t.applySettings({ sb: 10, bb: 20, chips: 1000, buyIn: 10000, blindMinutes: 10, maxRebuys: 1 });
  let now = 5_000_000; t.clock = () => now;
  t.addPlayer('a', 'A'); t.addPlayer('b', 'B'); t.start('a');
  const foldHand = () => { while (t.inProgress()) { const p = t.players[t.toAct]; t.act(p.token, 'fold'); } };
  const next = () => { foldHand(); t.startHand(); };
  if (t.sb !== 10) throw new Error('첫 핸드 블라인드 틀림');
  now += 9 * 60000; next(); if (t.sb !== 10) throw new Error('9분에 올라버림');
  now += 1 * 60000 + 1; next(); if (t.sb !== 20 || t.bb !== 40) throw new Error(`10분: ${t.sb}/${t.bb}`);
  now += 25 * 60000; next(); // 기준 시각 20분·30분이 지났으므로 두 단계(40/80, 80/160)
  if (t.sb !== 80 || t.bb !== 160) throw new Error(`35분: ${t.sb}/${t.bb} (80/160 이어야 함)`);
  if (t.blindLevel !== 3) throw new Error('인상 단계 수 틀림 ' + t.blindLevel);
}
{
  // 블라인드 0분 = 오르지 않음
  const t = new Table({ auto: false, pace: false });
  t.applySettings({ sb: 10, bb: 20, chips: 1000, buyIn: 10000, blindMinutes: 0, maxRebuys: 0 });
  let now = 0; t.clock = () => now;
  t.addPlayer('a', 'A'); t.addPlayer('b', 'B'); t.start('a'); now += 99 * 3600000;
  while (t.inProgress()) { const p = t.players[t.toAct]; t.act(p.token, 'raise', 99999); if (t.inProgress()) t.act(t.players[t.toAct].token, 'call'); }
  if (t.sb !== 10 || t.bb !== 20) throw new Error('0분인데 블라인드가 올랐음');
  // maxRebuys=0 이고 한 명이 칩 0 → 1등 확정
  const bust = t.players.find((p) => p.chips === 0);
  if (!bust) { /* 무승부면 이 항목은 건너뜀 — 아래 allInDuel 로 따로 검증 */ }
  if (bust) {
    if (t.rebuy(bust.token) === null) throw new Error('리바인 0회인데 허용됨');
    if (t.ending !== 'winner') throw new Error('1등이 나왔는데 자동 종료 예약이 안 됨');
    t.finishGame('winner');
    if (!t.ended || t.phase !== 'ended' || !t.settlement || t.settlement.error) throw new Error('자동 종료 정산 실패');
    const sum = t.players.reduce((x, p) => x + p.chips, 0);
    if (sum !== t.players.reduce((x, p) => x + p.buyIns * t.startChips, 0)) throw new Error('칩 총합과 바이인 총합 불일치');
    if (t.act('a', 'check') === null) throw new Error('종료 후 액션이 허용됨');
  }
}
{
  // 방장 종료: 방장만 가능 / 진행 중이면 핸드 후 종료 / 시작 전에는 불가
  const t = new Table({ auto: false, pace: false });
  t.addPlayer('a', 'A'); t.addPlayer('b', 'B');
  if (t.endGame('a') === null) throw new Error('시작 전 종료가 허용됨');
  t.start('a');
  if (t.endGame('b') === null) throw new Error('방장이 아닌데 종료됨');
  if (t.endGame('a') !== null || !t.endAfterHand) throw new Error('방장 종료 예약 실패');
  while (t.inProgress()) { const p = t.players[t.toAct]; t.act(p.token, 'fold'); }
  if (t.ending !== 'host') throw new Error('핸드 종료 후 host 종료 예약이 안 됨');
  t.finishGame('host');
  const total = t.players.reduce((x, p) => x + p.chips, 0);
  if (total !== 2000) throw new Error('칩 총합 이상');
  if (t.settlement.transfers.length !== 1 || t.settlement.transfers[0].amount <= 0) throw new Error('방장 종료 정산 이상');
}
console.log('리바인·블라인드·종료 규칙 OK');

{
  // 리바인 0회 + 올인 대결 → 승부가 나면 반드시 1등 확정(자동 종료 예약)
  const { t } = allInDuel({ sb: 10, bb: 20, chips: 1000, buyIn: 10000, blindMinutes: 0, maxRebuys: 0 });
  const bust = t.players.find((p) => p.chips === 0);
  if (t.rebuy(bust.token) === null) throw new Error('리바인 0회인데 허용됨');
  if (t.ending !== 'winner') throw new Error('1등이 나왔는데 자동 종료 예약이 안 됨');
  t.finishGame('winner');
  if (!t.ended || t.settlement.error) throw new Error('자동 종료 정산 실패');
  const net = t.settlement.rows.reduce((x, r) => x + r.net, 0);
  if (net !== 0 || t.settlement.transfers.length !== 1 || t.settlement.transfers[0].amount !== 10000) throw new Error('1대1 정산이 10,000원이 아님');
}
console.log('1등 자동 종료 OK');

// ───── 쇼다운 공개 범위: 폴드한 사람의 카드는 다른 사람에게 절대 보내지 않는다 ─────
{
  let checked = 0;
  for (let g = 0; g < 300; g++) {
    const t = new Table({ auto: false, pace: false });
    t.applySettings({ sb: 10, bb: 20, chips: 1000, buyIn: 10000, blindMinutes: 0, maxRebuys: 9 });
    ['a', 'b', 'c', 'd'].forEach((k) => t.addPlayer(k, k.toUpperCase()));
    t.start('a');
    const folded = new Set();
    // 앞의 한두 명은 폴드, 나머지는 체크/콜로 끝까지
    let first = 0;
    while (t.inProgress()) {
      const p = t.players[t.toAct], i = t.toAct;
      if (t.phase === 'preflop' && first < 1 && Math.random() < 0.7) { first++; folded.add(i); t.act(p.token, 'fold'); continue; }
      t.act(p.token, t.currentBet > p.bet ? 'call' : 'check');
    }
    if (!t.results || !t.results.showdown) continue; // 전원 폴드로 끝난 판은 공개 자체가 없음
    for (const viewer of ['a', 'b', 'c', 'd']) {
      const v = t.view(viewer);
      const vi = t.find(viewer);
      for (const h of v.results.hands) if (folded.has(h.i)) throw new Error('폴드한 사람이 쇼다운 표에 들어감');
      v.players.forEach((pl, i) => {
        if (folded.has(i) && i !== vi && pl.cards.length) throw new Error(`폴드한 ${pl.name} 의 카드가 ${viewer} 에게 전달됨`);
        if (!folded.has(i) && i !== vi && pl.inHand && !pl.cards.every((c) => c !== '??')) throw new Error('쇼다운인데 끝까지 간 사람의 카드가 공개되지 않음');
      });
      // 표의 카드가 실제 카드와 같은지, 승자 표시가 won 과 일치하는지
      for (const h of v.results.hands) {
        const pl = v.players[h.i];
        if (JSON.stringify(h.cards) !== JSON.stringify(pl.cards)) throw new Error('표의 카드가 다름');
        if (!h.hand || !h.why && pl.won === 0) throw new Error('족보/이유가 비어 있음');
      }
      const winners = v.results.hands.filter((h) => v.players[h.i].won > 0);
      if (!winners.length) throw new Error('승자가 없음');
    }
    checked++;
  }
  if (checked < 50) throw new Error('검사한 쇼다운이 너무 적음 ' + checked);
  console.log(`쇼다운 공개 범위 OK (${checked}판)`);
}


// ───── 강제 퇴장 · 일시정지 · 감정표현 ─────
function mkTable(n, extra = {}) {
  const t = new Table({ auto: false, pace: false });
  t.applySettings({ sb: 10, bb: 20, chips: 1000, buyIn: 1000, blindMinutes: 0, maxRebuys: 5, ...extra });
  const toks = 'abcdefghij'.slice(0, n).split('');
  toks.forEach((k) => t.addPlayer(k, k.toUpperCase()));
  return t;
}
const chipSum = (t) => t.players.reduce((x, p) => x + p.chips, 0) + t.departed.reduce((x, d) => x + d.chips, 0);
const buySum = (t) => t.players.reduce((x, p) => x + p.buyIns * t.startChips, 0) + t.departed.reduce((x, d) => x + d.buyIns * t.startChips, 0);
const mustFail = (msg, r) => { if (r === null) throw new Error(msg + ' — 허용되면 안 되는데 허용됨'); };
const finishHand = (t) => { while (t.inProgress()) { const p = t.players[t.toAct]; t.act(p.token, t.currentBet > p.bet ? 'call' : 'check'); } };

{ // 1) 시작 전 퇴장: 바로 지워지고 정산 대상 아님
  const t = mkTable(4);
  mustFail('방장 아닌 사람의 퇴장', t.kick('b', 2, 'C'));
  mustFail('방장 본인 퇴장', t.kick('a', 0, 'A'));
  mustFail('이름이 안 맞는 퇴장', t.kick('a', 2, 'Z'));
  if (t.kick('a', 2, 'C') !== null) throw new Error('시작 전 퇴장 실패');
  if (t.players.length !== 3 || t.players.some((p) => p.name === 'C')) throw new Error('시작 전 퇴장 후 자리가 안 지워짐');
  if (t.departed.length) throw new Error('시작 전 퇴장자가 정산 대상이 됨');
  if (t.addPlayer('c', 'C').error === undefined) throw new Error('퇴장당한 사람이 다시 들어옴');
}
{ // 2) 핸드 중 퇴장: 폴드 처리 → 핸드는 계속 → 다음 핸드 시작 때 자리 삭제, 칩 보존, 정산 포함
  for (let round = 0; round < 60; round++) {
    const t = mkTable(5);
    t.start('a');
    const before = chipSum(t) + t.pot;
    const actorIdx = t.toAct;
    const targetIdx = round % 2 ? actorIdx : (actorIdx + 2) % t.players.length; // 지금 차례인 사람 / 차례가 아닌 사람
    const tgt = t.players[targetIdx];
    if (tgt.token === 'a') continue; // 방장은 대상이 아님
    if (t.kick('a', targetIdx, tgt.name) !== null) throw new Error('핸드 중 퇴장 실패');
    if (!tgt.folded && t.inProgress()) throw new Error('핸드 중 퇴장자가 폴드 처리되지 않음');
    if (t.inProgress() && t.toAct === targetIdx) throw new Error('퇴장자에게 차례가 남아 있음');
    if (chipSum(t) + (t.inProgress() ? t.pot : 0) !== before && t.inProgress()) throw new Error('퇴장 직후 칩 보존 실패');
    finishHand(t);
    if (chipSum(t) !== buySum(t)) throw new Error(`핸드 후 칩 합계 불일치 ${chipSum(t)} vs ${buySum(t)}`);
    if (!t.players.some((p) => p.token === tgt.token)) throw new Error('핸드가 끝나기 전에 자리가 지워짐(인덱스 꼬임 위험)');
    t.startHand(); // 다음 핸드 시작 → 퇴장 예약자 삭제
    if (t.players.some((p) => p.token === tgt.token)) throw new Error('다음 핸드에서도 퇴장자가 남아 있음');
    if (t.players.length !== 4) throw new Error('자리 수가 4가 아님');
    if (t.departed.length !== 1 || t.departed[0].chips < 0) throw new Error('퇴장자 기록 이상');
    // 새 핸드가 인덱스 꼬임 없이 정상 진행되는지
    finishHand(t);
    if (chipSum(t) !== buySum(t)) throw new Error('퇴장 후 핸드에서 칩 합계 불일치');
    t.endGame('a'); t.finishGame('host');
    const st = t.settlement;
    if (st.error) throw new Error('퇴장자 포함 정산 오류 ' + st.error);
    if (st.rows.length !== 5 || !st.rows.some((r) => /퇴장/.test(r.name))) throw new Error('정산에 퇴장자가 빠짐');
    if (st.rows.reduce((x, r) => x + r.net, 0) !== 0) throw new Error('퇴장자 포함 정산 합계가 0이 아님');
    const bal = new Map(st.rows.map((r) => [r.i, r.net]));
    for (const tr of st.transfers) { bal.set(tr.from, bal.get(tr.from) + tr.amount); bal.set(tr.to, bal.get(tr.to) - tr.amount); }
    if (![...bal.values()].every((v) => v === 0)) throw new Error('퇴장자 포함 송금 잔액이 0이 아님');
    if (t.addPlayer(tgt.token, 'X').error === undefined) throw new Error('퇴장자가 재입장함');
  }
}
{ // 3) 쇼다운 직후(결과 표가 있는 상태) 퇴장: 바로 지워지고 결과 표 번호가 같이 보정됨
  let checked = 0;
  for (let g = 0; g < 80 && checked < 25; g++) {
    const t = mkTable(4); t.start('a'); finishHand(t);
    if (!t.results || !t.results.showdown) continue;
    const victimIdx = t.players.findIndex((p, i) => i !== 0 && t.results.hands.some((h) => h.i === i));
    if (victimIdx < 0) continue;
    const victim = t.players[victimIdx].name;
    const before = chipSum(t);
    if (t.kick('a', victimIdx, victim) !== null) throw new Error('쇼다운 직후 퇴장 실패');
    if (t.players.length !== 3) throw new Error('쇼다운 직후 퇴장 후 인원');
    if (chipSum(t) !== before) throw new Error('쇼다운 직후 퇴장 중 칩 증발');
    const v = t.view('a');
    for (const h of v.results.hands) if (!v.players[h.i] || h.i >= v.players.length) throw new Error('결과 표 번호가 범위를 벗어남');
    for (const pt of v.results.pots) for (const w of pt.winners) if (!v.players[w]) throw new Error('팟 승자 번호가 범위를 벗어남');
    if (v.players.some((p) => p.name === victim)) throw new Error('퇴장자가 목록에 남음');
    t.startHand(); finishHand(t);
    if (chipSum(t) !== buySum(t)) throw new Error('퇴장 후 다음 핸드 칩 불일치');
    checked++;
  }
  if (checked < 10) throw new Error('쇼다운 퇴장 시험 표본 부족 ' + checked);
}
{ // 4) 핸드 중 놀고 있는(핸드에 안 낀) 사람 퇴장 → 바로 삭제 + 번호 보정 + 타이머 유지
  const t = mkTable(3);
  t.start('a');
  t.addPlayer('x', 'X'); // 도중 입장: 이번 핸드에는 안 낌
  const xi = t.find('x'), actor = t.toAct;
  if (t.kick('a', xi, 'X') !== null) throw new Error('관전자 퇴장 실패');
  if (t.players.length !== 3 || t.toAct !== actor) throw new Error('관전자 퇴장이 진행 중인 핸드를 건드림');
  finishHand(t);
  if (chipSum(t) !== buySum(t)) throw new Error('관전자 퇴장 후 칩 불일치');
}
console.log('강제 퇴장 OK');

{ // 5) 일시정지
  const t = mkTable(3);
  mustFail('시작 전 일시정지', t.pause('a'));
  t.start('a');
  mustFail('방장 아닌 사람의 일시정지', t.pause('b'));
  if (t.pause('a') !== null || !t.pauseAfterHand || t.paused) throw new Error('핸드 중 일시정지는 "예약"이어야 함');
  mustFail('중복 일시정지', t.pause('a'));
  const hn = t.handNo;
  finishHand(t);
  if (!t.paused || t.pauseAfterHand) throw new Error('핸드가 끝났는데 일시정지가 적용되지 않음');
  t.startHand();
  if (t.handNo !== hn) throw new Error('일시정지 중에 새 핸드가 시작됨');
  mustFail('방장 아닌 사람의 계속하기', t.resume('b'));
  if (t.resume('a') !== null || t.paused) throw new Error('계속하기 실패');
  t.startHand();
  if (t.handNo !== hn + 1 || !t.inProgress()) throw new Error('계속한 뒤 새 핸드가 시작되지 않음');
  // 예약 취소
  t.pause('a'); if (t.resume('a') !== null || t.pauseAfterHand) throw new Error('일시정지 예약 취소 실패');
  finishHand(t); if (t.paused) throw new Error('취소했는데 멈춤');
  // 핸드 사이(쇼다운 대기 중)에는 즉시 정지
  if (t.pause('a') !== null || !t.paused) throw new Error('핸드 사이 일시정지는 즉시여야 함');
  // 일시정지 중 종료는 가능, 종료하면 일시정지 해제
  if (t.endGame('a') !== null) throw new Error('일시정지 중 종료 실패');
  t.finishGame('host');
  if (!t.ended || t.paused || t.pauseAfterHand) throw new Error('종료 후 일시정지 상태가 남음');
}
{ // 6) 일시정지 동안 블라인드 타이머는 멈춘다
  const t = mkTable(2, { blindMinutes: 10 });
  const c = { now: 5_000_000 }; t.clock = () => c.now;
  t.start('a'); const lvl0 = t.blindLevel;
  t.pause('a'); finishHand(t);
  c.now += 60 * 60000; // 1시간 쉼 (블라인드 주기 10분의 6배)
  t.resume('a'); t.startHand();
  if (t.blindLevel !== lvl0) throw new Error(`쉰 시간이 블라인드에 반영됨 (레벨 ${lvl0} → ${t.blindLevel})`);
  finishHand(t);
  c.now += 10 * 60000 + 1; t.startHand();
  if (t.blindLevel !== lvl0 + 1) throw new Error('휴식 뒤에 정상 주기로 블라인드가 오르지 않음');
}
console.log('일시정지 OK');

{ // 7) 감정표현: 차례와 무관하게 사용, 간격 제한, 종류 검사, 이벤트 기록
  const t = mkTable(3); t.start('a');
  const notActor = t.players.find((p, i) => i !== t.toAct).token;
  const seq0 = t.evSeq;
  if (t.emote(notActor, 'angry') !== null) throw new Error('차례가 아닌 사람의 감정표현이 막힘');
  const ev = t.events[t.events.length - 1];
  if (ev.k !== 'emote' || ev.e !== 'angry' || t.evSeq !== seq0 + 1 || !ev.name) throw new Error('감정표현 이벤트 이상');
  mustFail('2.5초 안의 연속 사용', t.emote(notActor, 'sad'));
  mustFail('잘못된 종류', (t.players.find((p) => p.token === notActor).lastEmote = 0, t.emote(notActor, 'dance')));
  for (const k of ['thanks', 'sad', 'hurry']) { t.players.forEach((p) => (p.lastEmote = 0)); if (t.emote('b', k) !== null) throw new Error(k + ' 사용 실패'); }
  // 감정표현이 연출 대기 시간(타이머/행동 지연)을 늘리지 않는다
  const a0 = t.anim, u0 = t.animUntil; t.players.forEach((p) => (p.lastEmote = 0)); t.emote('b', 'angry');
  if (t.anim !== a0 || t.animUntil !== u0) throw new Error('감정표현이 게임 진행 시간을 늘림');
  // 폴드한 사람·관전자도 사용 가능
  const folder = t.players[t.toAct]; t.act(folder.token, 'fold'); folder.lastEmote = 0;
  if (t.emote(folder.token, 'thanks') !== null) throw new Error('폴드한 사람의 감정표현이 막힘');
  mustFail('낯선 사람', t.emote('zzz', 'angry'));
}
console.log('감정표현 OK');


// ───── 접속이 끊겨 대기 중이던 판이, 다시 모이면 저절로 이어진다 ─────
{
  const t = mkTable(3);
  t.start('a'); finishHand(t);
  const hn = t.handNo;
  t.setConnected('b', false); t.setConnected('c', false);   // 두 명이 동시에 끊김
  t.startHand();                                           // 핸드 사이에 사람이 모자라 대기 상태가 됨
  if (t.phase !== 'waiting') throw new Error('사람이 모자라는데 대기 상태가 아님: ' + t.phase);
  t.setConnected('b', true);                               // 한 명만 돌아옴 → 2명 모임
  if (!t.inProgress() || t.handNo !== hn + 1) throw new Error(`재접속했는데 판이 이어지지 않음 (phase=${t.phase}, 핸드 ${t.handNo})`);
  finishHand(t);
  // 한 명만 남은 상태에서는 시작하면 안 된다
  t.setConnected('a', false); t.setConnected('c', false); t.startHand();
  const h2 = t.handNo;
  t.setConnected('c', true);   // a(끊김), b(접속), c(접속) 중 b,c 2명 → 시작
  if (t.handNo !== h2 + 1) throw new Error('2명이 모였는데 시작 안 됨');
  finishHand(t);
  t.setConnected('b', false); t.setConnected('c', false); t.startHand();
  if (t.phase !== 'waiting') throw new Error('대기 상태가 아님');
  t.setConnected('c', true); // 1명만 접속(c) → 시작하면 안 됨
  if (t.inProgress()) throw new Error('1명만 접속했는데 시작됨');
  // 일시정지 중에는 재접속해도 시작하지 않는다
  const t2 = mkTable(3); t2.start('a'); finishHand(t2); t2.pause('a');
  const h3 = t2.handNo; t2.setConnected('b', false); t2.setConnected('b', true);
  if (t2.handNo !== h3 || !t2.paused) throw new Error('일시정지 중인데 재접속으로 시작됨');
  console.log('재접속 자동 재개 OK');
}


// ───── 한마디 말풍선 · 일반 채팅 ─────
{
  const t = mkTable(3); t.start('a');
  // 한마디: 최대 10자(이모지도 1자), 공백·줄바꿈·제어문자는 정리, 빈 글은 거절
  mustFail('빈 한마디', t.emote('b', 'text', '   '));
  mustFail('공백/제어문자만', t.emote('b', 'text', '\n\t\u0007 '));
  if (t.emote('b', 'text', '  아 이걸   못\n따라가네요 정말로  ') !== null) throw new Error('한마디 실패');
  let ev = t.events[t.events.length - 1];
  if (ev.k !== 'emote' || ev.e !== 'text' || ev.text !== '아 이걸 못 따라가' || Array.from(ev.text).length !== 10 || ev.name !== 'B') throw new Error('한마디 이벤트가 이상함: ' + JSON.stringify(ev));
  t.players.forEach((p) => (p.lastEmote = 0));
  t.emote('b', 'text', '😀😀😀😀😀😀😀😀😀😀😀😀');
  if (Array.from(t.events[t.events.length - 1].text).length !== 10) throw new Error('이모지 10자 제한 실패');
  t.players.forEach((p) => (p.lastEmote = 0));
  t.emote('b', 'text', '<img src=x onerror=alert(1)>'); // 서버는 글자만 정리한다 (HTML 은 화면에서 이스케이프)
  if (Array.from(t.events[t.events.length - 1].text).length !== 10) throw new Error('한마디 길이 제한');
  mustFail('한마디 쿨다운', t.emote('b', 'text', '또'));
  const a0 = t.anim, u0 = t.animUntil; t.players.forEach((p) => (p.lastEmote = 0)); t.emote('c', 'text', '굿');
  if (t.anim !== a0 || t.animUntil !== u0) throw new Error('한마디가 게임 진행 시간을 늘림');
  mustFail('낯선 사람의 한마디', t.emote('zzz', 'text', '안녕'));
  mustFail('없는 감정표현', t.emote('b', 'dance'));

  // 채팅: 200자, 정리, 속도 제한(0.7초), 최근 100개, 받은 메시지에 보낸 사람 토큰이 섞이지 않음
  const got = []; t.onChat = (m) => got.push(m);
  mustFail('빈 메시지', t.chat('a', '  \n '));
  mustFail('낯선 사람의 채팅', t.chat('zzz', '안녕'));
  if (t.chat('a', ' 안녕\n하세요 ') !== null || got[0].text !== '안녕 하세요' || got[0].name !== 'A') throw new Error('채팅 실패');
  mustFail('채팅 속도 제한', t.chat('a', '연속'));
  t.players.forEach((p) => (p.lastChat = 0)); t.chat('b', 'x'.repeat(500));
  if (got[1].text.length !== 200) throw new Error('채팅 200자 제한');
  for (let k = 0; k < 130; k++) { t.players.forEach((p) => (p.lastChat = 0)); t.chat('c', `메시지 ${k}`); }
  if (t.chatLog.length !== 100 || t.chatLog[99].text !== '메시지 129' || t.chatLog[0].text !== '메시지 30') throw new Error('채팅 기록은 최근 100개만 남아야 함');
  if (t.view('a').chatLog || JSON.stringify(t.view('a')).includes('메시지 129')) throw new Error('채팅이 게임 상태(view)에 섞여 들어감');
  t.endGame('a'); finishHand(t); t.finishGame('host');
  t.players.forEach((p) => (p.lastChat = 0));
  if (t.chat('a', '수고했어요') !== null) throw new Error('게임이 끝난 뒤에도 채팅은 가능해야 함');
  console.log('한마디·채팅 OK');
}

// ───── 연습 테이블: 봇 추가/삭제 · 나가기 · 봇 판단 기준 ─────
{
  const { decide, chen, tick } = require('./bot');
  const practice = (n = 1, extra = {}) => { const t = mkTable(n, extra); t.practice = true; return t; };

  // 카드 점수(Chen)
  for (const [h, v] of [['As Ah', 20], ['Ks Kh', 16], ['As Ks', 12], ['As Kh', 10], ['Qs Js', 9], ['Ts 9s', 8], ['2s 2h', 5], ['7s 2h', -1]])
    if (chen(C(h)) !== v) throw new Error(`Chen ${h}: ${chen(C(h))} != ${v}`);

  { // 봇 추가/삭제: 총 2~10명, 방장만, 연습 테이블의 시작 전 대기실에서만
    const t = practice(1);
    for (let k = 0; k < 4; k++) t.pushBot();
    if (t.players.length !== 5 || new Set(t.players.map((p) => p.name)).size !== 5) throw new Error('기본 봇 4명 생성 실패');
    if (!t.players.slice(1).every((p) => p.bot && ['tight', 'balanced', 'loose'].includes(p.style))) throw new Error('봇 표시/성향 누락');
    for (let k = t.players.length; k < 10; k++) if (t.addBot('a') !== null) throw new Error('봇 추가 실패');
    mustFail('10명 초과 추가', t.addBot('a'));
    mustFail('방장 아닌 사람의 봇 추가', (t.players.pop(), practice(2).addBot('b')));
    mustFail('일반 테이블에서 봇 추가', mkTable(2).addBot('a'));
    mustFail('사람을 봇처럼 삭제', t.removeBot('a', 0));
    while (t.players.length > 2) if (t.removeBot('a', t.players.length - 1) !== null) throw new Error('봇 삭제 실패');
    mustFail('2명 미만으로 삭제', t.removeBot('a', 1));
    const v = t.view('a');
    if (!v.practice || v.players[1].bot !== true || v.players[0].bot !== false) throw new Error('view 에 practice/bot 표시가 없음');
    t.addBot('a'); t.start('a');
    mustFail('시작 후 봇 추가', t.addBot('a'));
    mustFail('시작 후 봇 삭제', t.removeBot('a', 1));
    mustFail('시작 후 나가기', t.leave('a'));
  }

  { // 대기실 나가기: 자리가 지워지고 방장이 넘어간다 (봇에게는 넘기지 않는다)
    const t = practice(3);
    t.pushBot();
    if (t.leave('b') !== null || t.players.some((p) => p.token === 'b')) throw new Error('나가기 실패');
    if (t.leave('a') !== null || t.hostToken !== 'c') throw new Error(`방장이 사람에게 안 넘어감: ${t.hostToken}`);
    t.leave('c');
    if (t.hostToken !== null || t.players.some((p) => !p.bot)) throw new Error('마지막 사람이 나갔는데 남아 있음');
  }

  { // 사람이 전원 탈락(칩 0 + 리바인 소진)하면 연습을 끝낸다. 리바인이 남았거나 일반 테이블이면 안 끝낸다
    const t = practice(1, { maxRebuys: 0 }); t.pushBot(); t.start('a');
    if (t.practiceOut()) throw new Error('칩이 있는데 연습이 끝남');
    t.players[0].chips = 0;
    if (!t.practiceOut()) throw new Error('사람이 탈락했는데 연습이 안 끝남');
    const t2 = practice(1, { maxRebuys: 2 }); t2.pushBot(); t2.start('a'); t2.players[0].chips = 0;
    if (t2.practiceOut()) throw new Error('리바인이 남았는데 연습이 끝남');
    if (mkTable(2).practiceOut()) throw new Error('일반 테이블이 연습처럼 끝남');
  }

  { // 사람이 한 명도 접속해 있지 않으면 봇끼리 계속 치지 않고 기다린다
    const t = practice(1); for (let k = 0; k < 3; k++) t.pushBot();
    t.start('a'); finishHand(t);
    t.setConnected('a', false); t.startHand();
    if (t.phase !== 'waiting' || t.inProgress()) throw new Error('사람이 없는데 봇끼리 새 판을 시작함');
    t.setConnected('a', true);   // 돌아오면 이어진다 (auto:false 라 바로 시작)
    if (!t.inProgress()) throw new Error('사람이 돌아왔는데 이어지지 않음');
  }

  // 판단 기준: 상황을 만들어 놓고 여러 번 물어본다
  const spot = ({ n = 6, hole, board = '', seat = 'utg', cur = 0, pre = 0, chips = 20000, bettor = 1, style = 'balanced' }) => {
    const t = practice(n, { sb: 100, bb: 200, chips: 20000, buyIn: 20000, maxRebuys: 0 }); // 설정은 정상값으로 만들고, 장면의 칩만 덮어쓴다 (엔진은 10BB 미만 시작 칩을 거절)
    for (let k = 1; k < n; k++) t.players[k].bot = true;
    t.start('a');
    t.players.forEach((p) => Object.assign(p, { chips, bet: 0, total: pre, folded: false, allIn: false, inHand: true }));
    t.community = board ? C(board) : [];
    t.phase = ['preflop', 'flop', 'turn', 'river'][Math.max(0, t.community.length - 2)];
    const me = seat === 'btn' ? t.dealer : seat === 'bb' ? t.bbIdx : t.nextIdx(t.bbIdx, (p) => p.inHand);
    t.toAct = me; t.players[me].hole = C(hole); t.players[me].style = style;
    if (t.phase === 'preflop') {
      Object.assign(t.players[t.sbIdx], { bet: t.sb, total: t.sb, chips: chips - t.sb }); Object.assign(t.players[t.bbIdx], { bet: t.bb, total: t.bb, chips: chips - t.bb });
      t.currentBet = Math.max(cur, t.bb);
      if (cur > t.bb) { const o = t.players.findIndex((p, i) => i !== me && i !== t.sbIdx && i !== t.bbIdx); Object.assign(t.players[o], { bet: cur, total: cur, chips: chips - cur }); }
    } else {
      t.currentBet = cur;
      if (cur) { const o = t.players.findIndex((p, i) => i !== me && i === bettor); Object.assign(t.players[o], { bet: cur, total: pre + cur, chips: chips - cur }); }
    }
    t.minRaise = t.bb;
    return { t, me };
  };
  const freq = (mk, f, trials = 120) => { let c = 0; for (let k = 0; k < trials; k++) { const { t, me } = mk(); if (f(decide(t, me))) c++; } return c / trials; };
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

  // 프리플랍: 강한 카드는 절대 버리지 않고, 쓰레기는 받아 주지 않는다
  ok(freq(() => spot({ hole: 'As Ah' }), (d) => d.a === 'raise') === 1, 'AA 를 앞자리에서 레이즈 안 함');
  ok(freq(() => spot({ hole: 'As Ah', cur: 600 }), (d) => d.a !== 'fold' && d.a !== 'check') === 1, 'AA 가 오픈 레이즈 앞에서 폴드/체크');
  ok(freq(() => spot({ hole: '7s 2h' }), (d) => d.a === 'fold') === 1, '72o 를 앞자리에서 안 버림');
  ok(freq(() => spot({ hole: '7s 2h', seat: 'btn', cur: 600 }), (d) => d.a === 'fold') === 1, '72o 로 레이즈에 콜/레이즈');
  ok(freq(() => spot({ hole: 'Ks Qh', cur: 2400 }), (d) => d.a === 'fold') > 0.95, 'KQo 로 큰 레이즈를 계속 받아 줌');
  ok(freq(() => spot({ hole: 'As Ks', seat: 'btn' }), (d) => d.a === 'raise') === 1, '버튼에서 AKs 를 안 올림');
  ok(freq(() => spot({ hole: 'Js 8s', seat: 'btn' }), (d) => d.a === 'raise') === 1 && freq(() => spot({ hole: 'Js 8s' }), (d) => d.a === 'fold') === 1, '같은 카드가 버튼에서는 레이즈, 앞자리에서는 폴드여야 함 (포지션 반영)');
  const open = spot({ hole: 'As Ah' }); const sz = decide(open.t, open.me).amount / open.t.bb; ok(sz >= 2.2 && sz <= 3.4, `오픈 레이즈 크기가 사람답지 않음: ${sz}BB`);
  // 레이즈 크기: 3BB → 4.5BB 에서 갑자기 다 접는 절벽이 없고, 큰 레이즈/올인에도 좋은 핸드는 받는다 (가격과 핸드 강도로 판단)
  { const hs = ['As 9h', 'Kd Jc', 'Qs Js', 'Jh Th', '9s 8s', '7d 7c', '5h 5s', 'Ac Qd', 'Kh Qs', 'Td 9d', 'Ah 5h', '8c 8d'];
    const cont = (cur) => hs.reduce((x, h) => x + freq(() => spot({ hole: h, seat: 'bb', cur }), (d) => d.a !== 'fold', 20), 0) / hs.length;
    const a3 = cont(600), a45 = cont(900);
    ok(a45 >= 0.25 * a3 && a45 > 0.1, `레이즈가 3BB→4.5BB 로 커지자 봇이 갑자기 접음 (계속 ${(a3 * 100).toFixed(0)}% → ${(a45 * 100).toFixed(0)}%)`); }
  ok(freq(() => spot({ hole: 'Ts Th', seat: 'btn', cur: 2400 }), (d) => d.a !== 'fold', 60) > 0.9, 'TT 가 12BB 레이즈를 접음 (가격에 맞는데)');
  ok(freq(() => spot({ hole: 'Js Jh', seat: 'btn', cur: 19800, chips: 20000 }), (d) => d.a !== 'fold', 60) > 0.8, 'JJ 가 100BB 올인을 접음');
  ok(freq(() => spot({ hole: '7s 2h', seat: 'btn', cur: 19800, chips: 20000 }), (d) => d.a === 'fold', 60) === 1, '72o 로 올인을 받음');
  // 숏스택(8BB): 좋은 카드는 올인, 나쁜 카드는 폴드
  ok(freq(() => spot({ hole: 'As 5s', seat: 'btn', chips: 1600 }), (d) => d.a === 'raise' && d.amount === 1600) === 1, '숏스택 버튼 A5s 올인 안 함');
  ok(freq(() => spot({ hole: '8s 3h', seat: 'btn', chips: 1600 }), (d) => d.a === 'fold') === 1, '숏스택에서 쓰레기로 올인');
  // 성향: 같은 상황에서 신중형이 공격형보다 덜 친다
  const loosePlay = freq(() => spot({ hole: '8s 6h', seat: 'btn', style: 'loose' }), (d) => d.a !== 'fold', 200);
  const tightPlay = freq(() => spot({ hole: '8s 6h', seat: 'btn', style: 'tight' }), (d) => d.a !== 'fold', 200);
  ok(loosePlay > tightPlay, `성향 차이 없음 (공격형 ${loosePlay} / 신중형 ${tightPlay})`);

  // 플랍~리버: 강한 패는 버리지 않고, 빈손은 큰 베팅에 접는다
  ok(freq(() => spot({ n: 2, hole: '7s 7h', board: 'Ac 7d 2s', cur: 1500, pre: 600, seat: 'btn' }), (d) => d.a !== 'fold') === 1, '셋으로 베팅을 접음');
  ok(freq(() => spot({ n: 2, hole: 'Js 4h', board: 'Kc 9d 2s 5h 8c', cur: 3000, pre: 1500, seat: 'btn' }), (d) => d.a === 'fold') > 0.9, '리버 빈손으로 팟 크기 베팅을 계속 받아 줌');
  ok(freq(() => spot({ n: 2, hole: 'Js 4h', board: 'Kc 9d 2s', cur: 0, pre: 600, seat: 'btn' }), (d) => d.a === 'raise') < 0.4, '빈손으로 너무 자주 베팅함');
  ok(freq(() => spot({ n: 2, hole: 'As Ah', board: 'Ac Ad 2s', cur: 0, pre: 600, seat: 'btn' }), (d) => d.a === 'raise') > 0.45, '쿼드로 베팅을 거의 안 함'); // 괴물은 일부러 25%쯤 슬로우플레이하므로 베팅 확률은 약 64%
  ok(freq(() => spot({ n: 2, hole: 'As 5s', board: 'Ks 9s 2d', cur: 600, pre: 1200, seat: 'btn' }), (d) => d.a === 'call' || d.a === 'raise') > 0.95, '플러시 드로우로 싼 베팅을 접음 (팟 오즈)');
  // 판단이 만든 행동은 언제나 엔진이 받아 준다 (규칙 위반 없음)
  { let bad = 0; for (let k = 0; k < 300; k++) { const { t, me } = spot({ n: 4, hole: ['As Ah', '7s 2h', 'Ts 9s', 'Kd Qc'][k % 4], board: ['', 'Ac 7d 2s', 'Ac 7d 2s 9h', 'Ac 7d 2s 9h Jc'][(k >> 2) % 4], cur: [0, 400, 2000][k % 3], pre: 800, seat: ['utg', 'btn', 'bb'][k % 3] }); const d = decide(t, me); if (t.act(t.players[me].token, d.a, d.amount)) bad++; } ok(bad === 0, `엔진이 거절한 봇 행동 ${bad}건`); }

  // 6명이 몇 판 쳐서 규칙 위반·칩 증발 없음, 성향 순서(신중 < 균형 < 공격)
  for (const n of [2, 6, 10]) {
    const t = practice(1, { chips: 2000, buyIn: 20000, maxRebuys: 99 }); while (t.players.length < n) t.pushBot();
    t.players[0].style = 'balanced'; t.start('a');
    const vp = { tight: [0, 0], balanced: [0, 0], loose: [0, 0] }; let errs = 0;
    const H = n === 6 ? 500 : 150;
    for (let h = 0; h < H; h++) {
      const played = new Set(); let guard = 0;
      while (t.inProgress()) {
        if (++guard > 500) throw new Error('봇 교착');
        const i = t.toAct, p = t.players[i], d = decide(t, i);
        if (t.phase === 'preflop' && (d.a === 'call' && t.currentBet > p.bet || d.a === 'raise')) played.add(i);
        if (t.act(p.token, d.a, d.amount)) { errs++; t.act(p.token, t.currentBet > p.bet ? 'fold' : 'check'); }
      }
      t.players.forEach((p, i) => { vp[p.style][1]++; if (played.has(i)) vp[p.style][0]++; });
      if (chipSum(t) !== buySum(t)) throw new Error(`${n}인 봇 시뮬레이션에서 칩이 어긋남`);
      t.players.forEach((p) => { if (p.chips === 0) t.rebuy(p.token); });
      t.startHand();
    }
    ok(errs === 0, `${n}인 시뮬레이션에서 엔진이 거절한 봇 행동 ${errs}건`);
    if (n === 6) { const r = (k) => vp[k][0] / Math.max(1, vp[k][1]); ok(r('tight') < r('balanced') && r('balanced') < r('loose'), `성향별 참여율 순서가 틀림: ${['tight', 'balanced', 'loose'].map((k) => (r(k) * 100).toFixed(0) + '%').join(' < ')}`); }
  }

  // 실제 타이머로 봇이 알아서 친다 (사람은 콜/체크만): 판이 이어지고 칩이 보존된다
  (async () => {
    const t = new Table({ auto: true, pace: false, nextHandMs: 30, showdownExtraMs: 0, turnMs: 5000 });
    t.practice = true; t.applySettings({ sb: 10, bb: 20, chips: 2000, buyIn: 2000, blindMinutes: 0, maxRebuys: 99 });
    const emit = t.emit.bind(t); t.emit = (ev) => { emit(ev); t.anim = 0; t.animUntil = 0; }; // 연출 시간을 없애 봇 구동만 본다
    t.addPlayer('hum-token', '사람'); for (let k = 0; k < 4; k++) t.pushBot();
    t.onChange = () => {
      tick(t);
      if (t.inProgress() && t.players[t.toAct] && t.players[t.toAct].token === 'hum-token') setImmediate(() => t.act('hum-token', t.currentBet > t.players[0].bet ? 'call' : 'check'));
      if (!t.inProgress() && t.players[0].chips === 0 && t.canRebuy(t.players[0])) setImmediate(() => { if (!t.ended && !t.rebuy('hum-token') && t.phase === 'showdown') t.onChange(); }); // 사람도 칩이 떨어지면 리바인
    };
    t.start('hum-token');
    await new Promise((r) => setTimeout(r, 4000));
    const hn = t.handNo, sum = chipSum(t) + (t.inProgress() ? t.pot : 0), want = buySum(t); // 판이 진행 중이면 팟에 들어간 칩도 더한다
    t.destroy();
    ok(hn >= 5, `봇 구동이 느리거나 멈춤: 4초 동안 ${hn}핸드`);
    ok(sum === want, '봇 구동 중 칩이 어긋남');
    await new Promise((r) => setTimeout(r, 300));
    ok(t.handNo === hn || t.handNo === hn + 1, '방을 지운 뒤에도 봇이 계속 침');
    console.log(`연습 테이블 OK (봇 구동 4초에 ${hn}핸드)`);
  })().catch((e) => { console.error(e); process.exit(1); });
}
