'use strict';
// 연습 테이블의 봇. 무작위가 아니라 사람이 쓰는 기준으로 판단한다.
//  프리플랍  = 카드 점수(Chen) × 포지션 × 앞사람 레이즈 크기 × 내 스택 깊이 (숏스택은 올인/폴드)
//  플랍~리버 = 남은 상대 수를 반영한 승률(몬테카를로) × 팟 오즈 × 드로우 여부 × 베팅 크기
// 봇은 자기 카드와 테이블에 공개된 정보만 쓴다 (다른 사람 카드는 보지 않는다).
const { best, STUN_PAY } = require('./engine');

// 성향: tight = 클수록 신중(프리플랍 기준점이 올라감), aggr = 베팅 빈도, bluff = 허세 빈도
const STYLES = {
  tight: { tight: 1.2, aggr: 0.8, bluff: 0.04 },
  balanced: { tight: 0, aggr: 1.0, bluff: 0.08 },
  loose: { tight: -1.3, aggr: 1.3, bluff: 0.14 },
};
const SUITS = ['s', 'h', 'd', 'c'];
const rnd = Math.random;

// 때리기(⚾)·합의금 확률 상수. 명세의 확률(아래 HIT_P/HIT_ADD)을 그대로 쓰면 봇 4명 연습에서 100핸드당 15회 넘게 때려서(쿨다운 상한은 33),
// test-hit-bots.js 로 재어 HIT_RULE.scale 로 낮췄다: 지금 값(0.5)은 봇 4명 연습에서 100핸드당 약 11회 (시험은 3~15회를 요구)
const HIT_P = { tight: 0.02, balanced: 0.05, loose: 0.09 };   // 핸드가 끝날 때 때리려고 마음먹을 기본 확률 (성향별)
const PAY_P = { tight: 0.6, balanced: 0.75, loose: 0.9 };     // 맞았을 때 합의금을 낼 확률 (성향별)
const HIT_ADD = { bigLoss: 0.2, revenge: 0.15 };              // 가산: 크게 졌다(total ≥ bigLossBB*bb 인데 won===0) / 최근 맞았고 때린 사람이 아직 있다(복수)
const HIT_RULE = { bigLossBB: 4, revengeHands: 6, scale: 0.5, max: 0.6, emote: 0.5 }; // revengeHands = 맞은 뒤 복수를 기억하는 핸드 수, scale = 전체 배율, emote = 말풍선 확률
const HIT_WAIT = [1200, 4000], PAY_WAIT = [1500, 4500], FAST_WAIT = 5; // 때리기/합의금 지불까지 사람처럼 뜸 들이는 시간(ms), 빠른 모드는 5ms
const OUCH = ['아야!', '으악!', '아얏!'], PAY_WORDS = ['합의금이다!', '합의하자!', '자, 합의금!'], HIT_WORDS = ['😤', '😤😤'];

// 프리플랍 카드 점수 (Chen 공식): AA=20, KK=16, AKs=12, AKo=10, T9s=8, 72o=-1
function chen(hole) {
  const [a, b] = hole[0].r >= hole[1].r ? hole : [hole[1], hole[0]];
  const val = (r) => ({ 14: 10, 13: 8, 12: 7, 11: 6 }[r] || r / 2);
  if (a.r === b.r) return Math.max(5, Math.ceil(val(a.r) * 2));
  const gap = a.r - b.r - 1;
  let s = val(a.r) + (a.s === b.s ? 2 : 0) - (gap < 4 ? [0, 1, 2, 4][gap] : 5);
  if (gap <= 1 && a.r < 12) s += 1;
  return Math.ceil(s);
}

// 내 승률: 남은 카드를 무작위로 깔고 상대 n명(무작위 핸드)과 겨뤄 본다.
// minChen 을 주면 첫 상대(레이즈한 사람)는 그 점수 이상의 핸드(= 좁은 범위)만 갖는 것으로 본다
function equity(hole, board, nOpp, samples, minChen) {
  const used = new Set([...hole, ...board].map((c) => c.r + c.s));
  const deck = [];
  for (let r = 2; r <= 14; r++) for (const s of SUITS) if (!used.has(r + s)) deck.push({ r, s });
  const rest = 5 - board.length, need = rest + 2 * nOpp;
  let sum = 0;
  for (let k = 0; k < samples; k++) {
    for (let j = 0; j < need; j++) { const x = j + Math.floor(rnd() * (deck.length - j)); [deck[j], deck[x]] = [deck[x], deck[j]]; }
    if (minChen !== undefined) // 첫 상대의 두 장을 범위 안에서 다시 뽑는다 (남은 카드 중에서)
      for (let tries = 0; tries < 40 && chen([deck[rest], deck[rest + 1]]) < minChen; tries++) {
        for (const j of [rest, rest + 1]) { const x = rest + 2 + Math.floor(rnd() * (deck.length - rest - 2)); [deck[j], deck[x]] = [deck[x], deck[j]]; }
      }
    const full = board.concat(deck.slice(0, rest));
    const mine = best(hole.concat(full));
    let lost = false, ties = 0;
    for (let o = 0; o < nOpp && !lost; o++) {
      const v = best([deck[rest + 2 * o], deck[rest + 2 * o + 1], ...full]);
      if (v > mine) lost = true; else if (v === mine) ties++;
    }
    if (!lost) sum += 1 / (1 + ties);
  }
  return sum / samples;
}

// 플러시 드로우(같은 무늬 4장) 또는 양쪽이 열린 스트레이트 드로우(연속 4장)
function hasDraw(hole, board) {
  const all = hole.concat(board);
  for (const s of SUITS) if (all.filter((c) => c.s === s).length === 4 && hole.some((c) => c.s === s)) return true;
  const rs = new Set(all.map((c) => c.r)); if (rs.has(14)) rs.add(1);
  for (let lo = 1; lo <= 10; lo++) {
    let k = 0; for (let r = lo; r < lo + 4; r++) if (rs.has(r)) k++;
    if (k === 4 && hole.some((c) => c.r >= lo && c.r < lo + 4)) return true;
  }
  return false;
}

// 프리플랍 내 순서: 큰 블라인드/작은 블라인드/뒤쪽(버튼·컷오프)/중간/앞쪽
function roleOf(t, i, n) {
  if (i === t.bbIdx) return 'bb';
  if (n === 2) return 'late';
  if (i === t.sbIdx) return 'sb';
  const seats = n - 2; // 블라인드를 뺀 자리 수
  let k = 0;
  for (let j = t.nextIdx(t.bbIdx, (p) => p.inHand); j !== i; j = t.nextIdx(j, (p) => p.inHand)) k++;
  const rel = seats <= 1 ? 1 : k / (seats - 1);
  return rel < 0.34 ? 'early' : rel < 0.67 ? 'mid' : 'late';
}

const OPEN = { early: 9, mid: 8, late: 6, sb: 6.5, bb: 9 };   // 앞에서 레이즈가 없을 때 레이즈할 카드 점수
const CALL = { early: 9.5, mid: 8.5, late: 7.5, sb: 8.5, bb: 6 }; // 레이즈에 콜할 카드 점수
const PUSH = { early: 8.5, mid: 7.5, late: 5.5, sb: 4.5, bb: 9 };  // 숏스택 올인 기준

// 규칙에 맞는 레이즈로 다듬는다: 최소 레이즈 이상, 남은 칩의 55% 넘게 쓰면 그냥 올인
function raiseTo(t, p, target) {
  const max = p.bet + p.chips, u = Math.max(1, t.sb);
  target = Math.max(Math.round(target / u) * u, t.currentBet + t.minRaise);
  if (target >= p.bet + p.chips * 0.55) target = max;
  return { a: 'raise', amount: Math.min(target, max) };
}

// 앞사람이 레이즈했을 때: 레이즈가 클수록 상대 핸드 범위가 좁다고 보고, 그 범위를 상대로 한 내 승률을 팟 오즈와 견준다.
// 승률이 아주 높으면 다시 올리고(리레이즈), 가격에 맞으면 콜, 아니면 폴드. (크기별 단계표가 아니라 연속적으로 판단)
function vsRaise(t, i, st, h, role, suited) {
  const p = t.players[i], size = t.currentBet / t.bb;
  const toCall = Math.min(t.currentBet - p.bet, p.chips);
  const live = t.players.filter((q) => q !== p && t.alive(q));
  const opps = live.filter((q) => q.bet >= t.currentBet).length || 1, behind = live.filter((q) => q.bet < t.currentBet).length; // 이미 돈을 낸 상대 / 아직 내 뒤에서 행동할 사람
  const eq = equity(p.hole, [], opps, 400, size <= 3.5 ? 6 : 6.5); // 큰 레이즈도 사람은 넓게 치는 경우가 많아서 범위를 더 좁히지 않는다 (대신 팟 오즈가 걸러 준다)
  const odds = toCall / (t.pot + toCall);
  const need = odds + (size <= 4 ? 0.03 : 0.015) + 0.011 * behind + st.tight * 0.02; // 작은 레이즈엔 신중하게, 큰 레이즈엔 가격이 맞으면 받아 준다
  const rr = 0.64 + (size > 3.5 ? 0.04 : 0) + (size > 8 ? 0.04 : 0) + 0.015 * behind + st.tight * 0.02;
  const bluff3 = size <= 4 && suited && h >= 7 && h < 10 && role !== 'early' && rnd() < st.bluff * 0.7;
  if (eq >= rr || bluff3) return raiseTo(t, p, t.currentBet * (role === 'late' ? 3 : 3.5));
  return { a: eq >= need ? 'call' : 'fold' };
}

function preflop(t, i, st) {
  const p = t.players[i], bb = t.bb, h = chen(p.hole);
  const n = t.players.filter((q) => q.inHand).length;
  const role = roleOf(t, i, n);
  const sh = Math.max(-4.5, st.tight + ({ 2: -4, 3: -3, 4: -2.5, 5: -2, 6: -1.7, 7: -1.3, 8: -0.9, 9: -0.4 }[n] || 0)); // 기준표는 9인용이라 인원이 적을수록 넓게 친다 (성향과 합쳐도 -4.5 까지만)
  const toCall = t.currentBet - p.bet;
  const pass = { a: toCall <= 0 ? 'check' : 'fold' }, call = { a: 'call' };
  const shove = { a: 'raise', amount: p.bet + p.chips };
  const suited = p.hole[0].s === p.hole[1].s, unopened = t.currentBet <= bb; // 앞에 레이즈 없음(림프만 있거나 없음)

  if (unopened && (p.chips + p.bet) / bb <= 10) return h >= PUSH[role] + sh ? shove : pass; // 숏스택: 올인 아니면 폴드
  if (unopened) {
    const limpers = t.players.filter((q) => q !== p && q.inHand && !q.folded && q.bet === bb && q !== t.players[t.bbIdx]).length;
    if (h >= OPEN[role] + sh) return raiseTo(t, p, ((role === 'bb' ? 4 : role === 'late' ? 2.5 : 3) + limpers + rnd() * 0.5 - 0.25) * bb);
    if (toCall > 0 && limpers > 0 && h >= OPEN[role] + sh - 2.5) return call;   // 림프 뒤에서 싸게 구경
    if (role === 'sb' && h >= OPEN.sb + sh - 2) return call;                       // 스몰블라인드 완성
    return pass;
  }
  return vsRaise(t, i, st, h, role, suited);
}

function postflop(t, i, st) {
  const p = t.players[i], board = t.community, street = board.length; // 3 플랍 · 4 턴 · 5 리버
  const n = t.players.filter((q) => q !== p && t.alive(q)).length;
  const toCall = Math.min(t.currentBet - p.bet, p.chips), pot = t.pot;
  const eq = equity(p.hole, board, n, n > 3 ? 140 : 220);
  const draw = street < 5 && hasDraw(p.hole, board);
  const base = 1 / (n + 1);
  const STRONG = Math.max(0.66, base + 0.3), VALUE = Math.max(0.5, base + 0.17);
  const size = (f) => raiseTo(t, p, t.currentBet + Math.max(t.bb, pot * f));

  if (toCall > 0) { // 상대가 베팅했다: 상대는 랜덤 핸드보다 강하니 큰 베팅일수록 내 승률을 깎아서 본다
    const f = toCall / Math.max(1, pot - toCall);
    const adj = eq - Math.min(0.32, 0.06 + 0.2 * f) - 0.02 * (street - 3); // 베팅했다는 것 자체로 상대 범위는 랜덤보다 강하다
    const odds = toCall / (pot + toCall);
    if (adj >= STRONG && rnd() < (adj >= 0.9 ? 0.85 : 0.5)) return size(0.75);
    if (adj >= odds + 0.03) return { a: 'call' };
    if (draw && adj >= odds - 0.06) return { a: 'call' };                          // 드로우: 임플라이드 오즈
    if (draw && n === 1 && rnd() < st.bluff * 0.25) return size(0.75);              // 드물게 세미블러프 레이즈
    return { a: 'fold' };
  }
  if (eq >= STRONG) return eq >= 0.92 && n <= 2 && street < 5 && rnd() < 0.25 ? { a: 'check' } : rnd() < 0.85 ? size(0.55 + rnd() * 0.25) : { a: 'check' }; // 괴물은 가끔 슬로우플레이
  if (eq >= VALUE) return rnd() < 0.55 * st.aggr ? size(0.33 + rnd() * 0.15) : { a: 'check' };   // 얇은 밸류벳
  if (draw && rnd() < (n <= 2 ? 0.45 : 0.25) * st.aggr) return size(0.5 + rnd() * 0.16);          // 세미블러프
  if (street > 3 && n <= 2 && rnd() < st.bluff) return size(0.55);                                // 다 체크했을 때 허세
  return { a: 'check' };
}

function decide(t, i) {
  const p = t.players[i], st = STYLES[p.style] || STYLES.balanced;
  const d = t.community.length ? postflop(t, i, st) : preflop(t, i, st);
  if (d.a === 'raise' && p.bet + p.chips <= t.currentBet) return { a: 'call' }; // 레이즈할 칩이 없으면 콜
  return d;
}

// ───── 때리기(⚾)·합의금: 봇도 사람과 같은 규칙으로 (가능 여부·쿨다운·칩 가드는 전부 엔진이 판단, 봇 전용 우회 없음) ─────
const wait = (t, [lo, hi]) => (t.opts.pace ? lo + rnd() * (hi - lo) : FAST_WAIT);
// 말풍선은 곁들이기: 엔진이 거절(2.5초 쿨다운 등)해도 그냥 넘어간다
function chatter(t, p, words) { if (rnd() < HIT_RULE.emote) t.emote(p.token, 'text', words[Math.floor(rnd() * words.length)]); }

// 방금 맞은 봇: 사람처럼 잠깐 뒤에 합의금을 낼지 정한다 (안 내면 그냥 기절)
function onHit(t, p) {
  p._seenHit = t.hitSeq; p._hitBy = p.stunBy; p._hitHand = t.handNo; // 복수 상대는 합의금을 내도 기억해 둔다
  chatter(t, p, OUCH);
  clearTimeout(p._payT);
  p._payT = setTimeout(() => {
    p._payT = null;
    try {
      if (t.ended || !t.players.includes(p) || p.stun !== 'pending') return; // 방/봇이 사라졌거나 이미 풀렸다/기절 핸드가 시작됐다
      if (p.chips > STUN_PAY + 2 * t.bb && rnd() < (PAY_P[p.style] || PAY_P.balanced) && !t.payStun(p.token)) chatter(t, p, PAY_WORDS);
    } catch (e) { console.error('봇 합의금 오류', e); }
  }, wait(t, PAY_WAIT));
}

// 핸드가 끝난 순간(핸드당 한 번) 봇마다 때릴지 굴리고, 마음먹은 봇 중 한 명만 예약한다
function rollHit(t) {
  let top = -1; // 이번 핸드 최대 승자
  t.players.forEach((q, i) => { if (q.won > 0 && (top < 0 || q.won > t.players[top].won)) top = i; });
  const picks = [];
  t.players.forEach((p, i) => {
    if (!p.bot) return;
    const ok = t.players.map((_, j) => j).filter((j) => t.hitCheck(i, j) === null); // 지금 때릴 수 있는 사람들
    if (!ok.length) return;
    const big = p.won === 0 && p.total >= HIT_RULE.bigLossBB * t.bb;
    const rj = t.players.findIndex((q) => q.token === p._hitBy);
    const rev = rj >= 0 && t.handNo - p._hitHand <= HIT_RULE.revengeHands && ok.includes(rj);
    const prob = Math.min(HIT_RULE.max, (HIT_P[p.style] || HIT_P.balanced) + (big ? HIT_ADD.bigLoss : 0) + (rev ? HIT_ADD.revenge : 0)) * HIT_RULE.scale;
    if (rnd() < prob) picks.push([p, t.players[big && ok.includes(top) ? top : rev ? rj : ok[Math.floor(rnd() * ok.length)]]]);
  });
  if (!picks.length) return;
  const [bot, victim] = picks[Math.floor(rnd() * picks.length)]; // 자리 번호는 밀릴 수 있어서 사람(객체)으로 기억한다
  clearTimeout(t._botHitT);
  t._botHitT = setTimeout(() => {
    t._botHitT = null;
    try {
      const i = t.players.indexOf(bot), j = t.players.indexOf(victim);
      if (t.ended || i < 0 || j < 0 || t.hitCheck(i, j) !== null) return; // 기다리는 사이 상황이 바뀌었으면 포기
      if (!t.hit(bot.token, j, victim.name)) chatter(t, bot, HIT_WORDS);
    } catch (e) { console.error('봇 때리기 오류', e); }
  }, wait(t, HIT_WAIT));
}

function tickHits(t) {
  if (t.ended) return;
  for (const p of t.players) if (p.bot && p.stun === 'pending' && p._seenHit !== t.hitSeq) onHit(t, p); // hitSeq 가 바뀐 뒤 처음 보는 기절 예고 = 방금 맞은 봇
  if (t.phase === 'showdown' && t._botRollHand !== t.handNo) { t._botRollHand = t.handNo; rollHit(t); }
}

// 방 상태가 바뀔 때마다 부른다: 봇 차례면 사람처럼 잠깐 생각한 뒤 행동하고, 칩이 떨어진 봇은 리바인한다
function tick(t) {
  if (!t.practice) return;
  const fast = !t.opts.pace, now = Date.now();
  const lag = fast ? 0 : Math.max(0, t.animUntil - now);
  for (const p of t.players) {
    if (!p.bot || p.chips > 0 || !t.canRebuy(p) || t.handNo === 0 || p._rb || (t.inProgress() && p.inHand && !p.folded)) continue;
    p._rb = setTimeout(() => { p._rb = null; if (!t.rebuy(p.token)) t.onChange(); }, fast ? 5 : lag + 1500 + rnd() * 2000);
  }
  tickHits(t);
  if (!t.inProgress() || t.toAct < 0 || !t.players[t.toAct].bot) return;
  const i = t.toAct, p = t.players[i], key = `${t.handNo}|${t.phase}|${i}|${t.currentBet}`;
  if (t._botKey === key) return;
  t._botKey = key;
  clearTimeout(t._botT);
  t._botT = setTimeout(() => {
    if (t.toAct !== i || t.players[i] !== p || !t.inProgress()) return;
    t._botKey = null;
    let d = null;
    try { d = decide(t, i); } catch (e) { console.error('봇 판단 오류', e); }
    if (d && !t.act(p.token, d.a, d.amount)) return;
    t.act(p.token, t.currentBet - p.bet > 0 ? 'fold' : 'check'); // 안전망: 판단이 막히면 체크/폴드
  }, fast ? 5 : lag + (rnd() < 0.15 ? 500 : 800) + rnd() * 1400);
}

module.exports = { decide, tick, chen, equity, hasDraw, roleOf, STYLES, HIT_P, PAY_P, HIT_ADD, HIT_RULE };
