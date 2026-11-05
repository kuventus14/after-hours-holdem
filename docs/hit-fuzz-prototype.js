// 판 도중 아무 때나 '때리기 칩 이동'을 끼워 넣어도 돈·진행이 안 꼬이는지 보는 무작위 시험 (프로젝트 코드는 건드리지 않음)
// 사용: node hit-fuzz.js [naive|guard]   — 엔진은 그대로, hit() 만 이 파일에서 흉내 낸다
const path = require('path').join(__dirname, '..', 'engine.js');
const { Table, computeSettlement } = require(path);
const MODE = process.argv[2] || 'guard';
const AMT = 1000;

// 후보 서버 구현: 때리는 사람의 '앞에 남은 칩(chips)'만 맞는 사람에게 옮긴다. 팟(total)·이번 라운드 베팅(bet)은 건드리지 않는다.
Table.prototype.hit = function (token, ti, amt = AMT) {
  const i = this.find(token), h = this.players[i], v = this.players[ti];
  if (!h || !v || i === ti) return '대상이 올바르지 않아요';
  if (MODE === 'naive') { h.chips -= amt; v.chips += amt; return null; }
  if (this.ended) return '끝난 게임이에요';
  if (h.kicked || v.kicked) return '퇴장 예약된 사람이에요';
  if (!(h.chips > amt)) return '칩이 부족해요';          // 낸 뒤에도 1칩 이상 남게 → 칩 0 이 commit 밖에서 생기지 않는다
  h.chips -= amt; v.chips += amt;
  return null;
};

const stats = { games: 0, hands: 0, hits: 0, hitRejected: 0, viol: {} };
const viol = (k, msg) => { stats.viol[k] = stats.viol[k] || { n: 0, first: msg }; stats.viol[k].n++; };
const supply = (t) => t.players.reduce((s, p) => s + p.buyIns, 0) * t.startChips;
const total = (t) => t.players.reduce((s, p) => s + p.chips, 0) + (t.inProgress() ? t.pot : 0); // 판이 끝나면 total(투입액)은 이미 칩에 반영돼 있다

function check(t, where) {
  if (total(t) !== supply(t)) viol('칩합+팟 불일치', `${where}: ${total(t)} != ${supply(t)}`);
  for (const p of t.players) {
    if (!Number.isInteger(p.chips)) viol('칩이 정수가 아님', `${where}: ${p.name} ${p.chips}`);
    if (p.chips < 0) viol('칩 음수', `${where}: ${p.name} ${p.chips}`);
    if (t.inProgress() && p.inHand && !p.folded && p.chips === 0 && !p.allIn) viol('칩 0인데 올인 표시 없음', `${where}: ${p.name} bet=${p.bet} cur=${t.currentBet}`);
  }
  if (t.inProgress()) {
    const a = t.players[t.toAct];
    if (!a || !t.canAct(a)) viol('내 차례 대상이 잘못됨', `${where}: toAct=${t.toAct}`);
  }
}

for (let g = 0; g < 400; g++) {
  const n = 2 + (g % 9);
  const t = new Table({ auto: false, pace: false });
  t.applySettings({ sb: 10, bb: 20, chips: 3000, buyIn: 3000, blindMinutes: 0, maxRebuys: 99 });
  for (let i = 0; i < n; i++) t.addPlayer('t' + i, 'P' + i);
  t.startHand(); stats.games++;
  for (let h = 0; h < 30; h++) {
    let guard = 0;
    while (t.inProgress()) {
      if (++guard > 600) { viol('교착', `game ${g} hand ${h}`); break; }
      // 행동 직전·직후 아무 때나 때리기 시도 (폴드한 사람/올인한 사람/칩 0인 사람/내 차례인 사람 모두 대상)
      if (Math.random() < 0.35) {
        const hi = Math.floor(Math.random() * t.players.length), vi = Math.floor(Math.random() * t.players.length);
        const err = t.hit(t.players[hi].token, vi);
        if (err) stats.hitRejected++; else stats.hits++;
        check(t, `hit g${g}h${h}`);
        if (!t.inProgress()) break;
      }
      const p = t.players[t.toAct];
      const r = Math.random(), toCall = t.currentBet - p.bet;
      let err;
      if (r < 0.15) err = t.act(p.token, 'fold');
      else if (r < 0.62) err = t.act(p.token, toCall > 0 ? 'call' : 'check');
      else if (r < 0.9) err = t.act(p.token, 'raise', t.currentBet + t.minRaise + Math.floor(Math.random() * 200));
      else err = t.act(p.token, 'raise', 999999);
      if (err && /알 수 없는|차례/.test(err)) { viol('act 가 차례를 어김', err); break; }
      if (err) t.act(p.token, toCall > 0 ? 'call' : 'check');
      check(t, `act g${g}h${h}`);
    }
    check(t, `end g${g}h${h}`);
    stats.hands++;
    // 판이 끝난 직후에도 한 번 (쉬는 시간)
    if (Math.random() < 0.5) { const hi = Math.floor(Math.random() * t.players.length), vi = Math.floor(Math.random() * t.players.length); t.hit(t.players[hi].token, vi) ? stats.hitRejected++ : stats.hits++; check(t, 'break'); }
    t.players.forEach((p) => p.chips === 0 && t.rebuy(p.token));
    t.startHand();
    if (!t.inProgress()) break;
  }
  // 진행 중인 판은 끝까지 마친 뒤에 정산한다 (실제 서버도 핸드가 끝난 뒤에만 정산)
  for (let k = 0; t.inProgress() && k < 600; k++) { const p = t.players[t.toAct], toCall = t.currentBet - p.bet; t.act(p.token, toCall > 0 ? 'call' : 'check'); }
  // 정산: 합계 0
  try {
    const s = computeSettlement(t.players, t.startChips, t.buyIn);
    const sum = s.rows.reduce((x, r) => x + r.net, 0);
    if (sum !== 0) viol('정산 합계가 0 아님', `game ${g}: ${sum}`);
  } catch (e) { viol('정산 예외', e.message); }
}
console.log(`[${MODE}] games=${stats.games} hands=${stats.hands} hits=${stats.hits} rejected=${stats.hitRejected}`);
console.log(Object.keys(stats.viol).length ? '위반: ' + JSON.stringify(stats.viol, null, 1) : '위반 없음 (칩합+팟 일정, 올인 표시 일치, 교착 없음, 정산 합계 0)');
