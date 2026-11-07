'use strict';
const crypto = require('crypto');

const SUITS = ['s', 'h', 'd', 'c'];
const RANK_CH = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 10: 'T' };
const HAND_NAMES = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];
const MAX_PLAYERS = 10;
const BOT_NAMES = ['민준', '서연', '도윤', '하은', '지호', '수아', '준우', '예린', '시우', '하윤'];
const BOT_STYLES = ['balanced', 'tight', 'loose']; // 봇 성향 (bot.js 의 STYLES)

const cardStr = (c) => (RANK_CH[c.r] || String(c.r)) + c.s;

function newDeck() {
  const d = [];
  for (let r = 2; r <= 14; r++) for (const s of SUITS) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// 5장 점수: 카테고리 * 15^5 + 키커 순서대로
function score5(c) {
  const rs = c.map((x) => x.r).sort((a, b) => b - a);
  const flush = c.every((x) => x.s === c[0].s);
  const cnt = {};
  rs.forEach((r) => (cnt[r] = (cnt[r] || 0) + 1));
  const groups = Object.entries(cnt)
    .map(([r, n]) => [+r, n])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  let straightHigh = 0;
  if (new Set(rs).size === 5) {
    if (rs[0] - rs[4] === 4) straightHigh = rs[0];
    else if (rs[0] === 14 && rs[1] === 5 && rs[4] === 2) straightHigh = 5; // A-2-3-4-5
  }
  let cat, ranks;
  if (straightHigh && flush) { cat = 8; ranks = [straightHigh]; }
  else if (groups[0][1] === 4) { cat = 7; ranks = [groups[0][0], groups[1][0]]; }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { cat = 6; ranks = [groups[0][0], groups[1][0]]; }
  else if (flush) { cat = 5; ranks = rs; }
  else if (straightHigh) { cat = 4; ranks = [straightHigh]; }
  else if (groups[0][1] === 3) { cat = 3; ranks = groups.map((g) => g[0]); }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { cat = 2; ranks = groups.map((g) => g[0]); }
  else if (groups[0][1] === 2) { cat = 1; ranks = groups.map((g) => g[0]); }
  else { cat = 0; ranks = rs; }
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 15 + (ranks[i] || 0);
  return s;
}

const POW = 15 ** 5;
function handName(score) {
  const cat = Math.floor(score / POW);
  if (cat === 8 && score % POW === 14 * 15 ** 4) return '로열 플러시';
  return HAND_NAMES[cat];
}

// 5~7장 중 최고의 5장
function best(cards) {
  const n = cards.length;
  let top = -1;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const s = score5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (s > top) top = s;
          }
  return top;
}

const STREETS = ['preflop', 'flop', 'turn', 'river'];

// 점수 → [족보 번호, 비교 순서대로 정렬된 숫자 5개]
function scoreParts(score) {
  const d = [];
  let v = score;
  for (let i = 0; i < 5; i++) { d.unshift(v % 15); v = Math.floor(v / 15); }
  return { cat: v, d };
}
const rk = (n) => ({ 14: 'A', 13: 'K', 12: 'Q', 11: 'J' }[n] || String(n));
// 같은 족보일 때 어디서 갈렸는지
function diffText(cat, k, w, l) {
  const cmp = `${rk(w)} > ${rk(l)}`;
  switch (cat) {
    case 0: return k === 0 ? `하이카드 ${cmp}` : `${k + 1}번째로 높은 카드 ${cmp}`;
    case 1: return k === 0 ? `페어 ${cmp}` : `키커 ${cmp}`;
    case 2: return k === 0 ? `높은 페어 ${cmp}` : k === 1 ? `낮은 페어 ${cmp}` : `키커 ${cmp}`;
    case 3: return k === 0 ? `트리플 ${cmp}` : `키커 ${cmp}`;
    case 4: case 8: return `${rk(w)} 하이 > ${rk(l)} 하이`;
    case 5: return `${k + 1}번째로 높은 카드 ${cmp}`;
    case 6: return k === 0 ? `트리플 ${cmp}` : `페어 ${cmp}`;
    case 7: return k === 0 ? `포카드 ${cmp}` : `키커 ${cmp}`;
  }
  return cmp;
}
// 높은 점수(w)가 낮은 점수(l)보다 앞선 이유
function explainDiff(wScore, lScore) {
  const w = scoreParts(wScore), l = scoreParts(lScore);
  if (wScore === lScore) return '같은 족보·같은 숫자라 비겨요';
  if (w.cat !== l.cat) return `족보 차이 — ${HAND_NAMES[w.cat]} > ${HAND_NAMES[l.cat]}`;
  for (let k = 0; k < 5; k++) if (w.d[k] !== l.d[k]) return `같은 ${HAND_NAMES[w.cat]} · ${diffText(w.cat, k, w.d[k], l.d[k])}`;
  return '';
}

// 앱(noMoney): 돈 관련 칸(투입 금액·송금 안내·합계)은 서버에서 아예 내보내지 않고, 칩 순위와 칩 손익만 준다
function chipsOnly(st) {
  if (!st) return st;
  return { reason: st.reason, startChips: st.startChips, error: st.error, rows: (st.rows || []).map((r) => ({ i: r.i, name: r.name, rank: r.rank, buyIns: r.buyIns, chips: r.chips, netChips: r.netChips })) };
}

/**
 * 정산 계산. 전부 정수 연산이라 어긋나지 않는다.
 *  - 칩 손익 = 최종 칩 - 바이인 횟수 × 시작 칩   (칩은 보존되므로 합계가 반드시 0)
 *  - 금액 손익 = 칩 손익 × 바이인 금액 ÷ 시작 칩  → 내림 후, 남는 1원 단위를 나머지가 큰 순서로 나눠 합계를 정확히 0으로 맞춤
 *  - 송금 = 돈을 잃은 사람(채무자)과 딴 사람(채권자)을 큰 금액끼리 짝지어 소진 (최대 인원-1 건)
 */
function computeSettlement(players, startChips, buyInWon) {
  const rows = players.map((p, i) => ({
    i, name: p.name, buyIns: p.buyIns, chips: p.chips,
    invested: p.buyIns * buyInWon,
    netChips: p.chips - p.buyIns * startChips,
  }));
  const sumChips = rows.reduce((x, r) => x + r.netChips, 0);
  if (sumChips !== 0) throw new Error(`칩 합계가 맞지 않아요 (${sumChips})`);
  const num = rows.map((r) => r.netChips * buyInWon);
  const q = num.map((v) => Math.floor(v / startChips));
  const rem = num.map((v, k) => v - q[k] * startChips); // 0 <= rem < startChips
  let diff = -q.reduce((x, v) => x + v, 0); // 남는 1원 단위 개수 (0 이상)
  const order = rows.map((_, k) => k).sort((a, b) => rem[b] - rem[a] || a - b);
  for (const k of order) { if (diff <= 0) break; q[k] += 1; diff--; }
  if (diff !== 0) throw new Error('정산 반올림 보정에 실패했어요');
  rows.forEach((r, k) => { r.net = q[k]; r.value = r.invested + q[k]; });
  const sumNet = rows.reduce((x, r) => x + r.net, 0);
  if (sumNet !== 0) throw new Error(`손익 합계가 0이 아니에요 (${sumNet})`);

  const debt = rows.filter((r) => r.net < 0).map((r) => ({ i: r.i, amt: -r.net }));
  const cred = rows.filter((r) => r.net > 0).map((r) => ({ i: r.i, amt: r.net }));
  const transfers = [];
  const byAmt = (a, b) => b.amt - a.amt || a.i - b.i;
  while (debt.length && cred.length) {
    debt.sort(byAmt); cred.sort(byAmt);
    const d = debt[0], c = cred[0], t = Math.min(d.amt, c.amt);
    transfers.push({ from: d.i, to: c.i, fromName: rows[d.i].name, toName: rows[c.i].name, amount: t });
    d.amt -= t; c.amt -= t;
    if (d.amt === 0) debt.shift();
    if (c.amt === 0) cred.shift();
  }
  const sent = transfers.reduce((x, t) => x + t.amount, 0);
  const lost = rows.filter((r) => r.net < 0).reduce((x, r) => x - r.net, 0);
  const won = rows.filter((r) => r.net > 0).reduce((x, r) => x + r.net, 0);
  if (sent !== lost || sent !== won) throw new Error('송금 합계가 맞지 않아요');
  // 순위: 최종 칩이 많은 순 (동률은 같은 순위)
  const sorted = rows.slice().sort((a, b) => b.chips - a.chips || a.i - b.i);
  let rank = 0, prev = null;
  sorted.forEach((r, k) => { if (r.chips !== prev) { rank = k + 1; prev = r.chips; } r.rank = rank; });
  return { startChips, buyInWon, rows: rows.sort((a, b) => a.rank - b.rank || a.i - b.i), transfers, totals: { net: sumNet, sent, lost, won, chips: sumChips } };
}

// 때리기: 때리면 HIT_COST 가 맞은 사람에게 바로 넘어가고, 맞은 사람은 '맞은 뒤 처음 시작하는 핸드'를 패도 못 받고 쉰다(기절).
// 쉬기 싫으면 시작 전에 STUN_PAY 를 때린 사람에게 보내 풀 수 있다. 테이블 전체로 때린 핸드부터 HIT_COOLDOWN 핸드 동안은 다시 못 때린다.
const HIT_COST = 1000, STUN_PAY = 1500, HIT_COOLDOWN = 3, HIT_ANIM_MS = 13000, PAY_WINDOW_MS = 4000; // 연출은 약 11~12초 / 다음 핸드 시작 PAY_WINDOW_MS 전부터는 못 때린다(맞은 사람이 합의금을 낼 시간)

// 카드 자랑하기: 다 폴드해서 이긴 사람이 핸드가 끝나고 BRAG_MS 안에 한 장/두 장을 골라 보여 줄 수 있다. 화면 연출은 BRAG_ANIM_MS 안에 끝나서, 자랑하면 다음 핸드는 그만큼 늦춘다.
const BRAG_MS = 8000, BRAG_ANIM_MS = 10000;

class Table {
  constructor(opts = {}) {
    this.opts = Object.assign({ auto: true, pace: true, turnMs: 30000, nextHandMs: 7000, absentMs: 3000, showdownExtraMs: 4000 }, opts);
    this.players = [];
    this.sb = 10;
    this.bb = 20;
    this.startChips = 1000;
    this.buyIn = 10000;        // 바이인 1회 금액(원) = 시작 칩
    this.blindMinutes = 0;     // N분마다 블라인드 2배 (0 = 고정)
    this.maxRebuys = 2;        // 플레이어당 리바인 가능 횟수
    this.blindLevel = 0; this.nextBlindAt = 0;
    this.ended = false; this.endAfterHand = false; this.ending = null; this.settlement = null;
    this.clock = () => Date.now();
    this.paused = false; this.pauseAfterHand = false; this.pausedAt = 0; // 일시정지(휴식)
    this.departed = [];        // 강제 퇴장으로 나간 사람들 (정산에는 포함)
    this.banned = new Set();   // 강제 퇴장된 사람은 같은 방에 다시 못 들어옴
    this.phase = 'waiting'; // waiting | preflop | flop | turn | river | showdown
    this.handNo = 0;
    this.dealer = -1;
    this.toAct = -1;
    this.currentBet = 0;
    this.minRaise = 0;
    this.community = [];
    this.deck = [];
    this.results = null;
    this.deadline = 0;
    this.nextAt = 0;
    this.log = [];
    this.hostToken = null;
    this.onChange = () => {};
    this.turnTimer = null;
    this.nextTimer = null;
    this.events = [];   // 화면 연출용 이벤트 (id 순서대로)
    this.evSeq = 0;
    this.anim = 0;      // 아직 반영 안 된 연출 시간(ms): 타이머에 더해서 연출 중 시간이 깎이지 않게 함
    this.animUntil = 0; // 이 시각까지는 화면이 연출 중이라 액션을 미룬다
    this.chatLog = []; this.chatSeq = 0; this.onChat = () => {}; // 일반 채팅: 최근 100개만 보관
    this.hitOn = true;          // 방장이 인게임에서 켜고 끄는 때리기 스위치 (기본 켜짐)
    this.hitSeq = 0;            // 때리기가 일어난 횟수 (봇이 '방금 맞았나'를 알아채는 용도)
    this.lastHitHand = -99;     // 마지막으로 때린 핸드 번호
    this.lastHitBy = '';        // 마지막으로 때린 사람 이름
    this.hitUntil = 0;          // 이 시각까지는 화면에서 때리는 연출이 진행 중
    this.bragUntil = 0; this.bragBy = ''; this.bragUsed = false; // 카드 자랑 가능 시한 · 이긴 사람(token) · 이미 자랑했나
  }

  emit(ev) {
    ev.id = ++this.evSeq;
    this.events.push(ev);
    if (this.events.length > 80) this.events.shift();
    const dur = { hand: 800, bet: ev.kind === 'blind' ? 700 : ev.kind === 'allin' ? 1250 : 1050, check: 700, fold: 950, sweep: 800, deal: 140, show: 1300 + 200 * Object.keys(ev.hands || {}).length, win: 2800 };
    const d = ev.k === 'street' ? (ev.cards.length > 1 ? 2450 : 1850) : (dur[ev.k] || 0);
    this.anim += d;
    this.animUntil = Math.max(this.animUntil, Date.now()) + d;
  }

  // ───── 유틸 ─────
  say(msg) {
    this.log.push(msg);
    if (this.log.length > 60) this.log.shift();
  }
  find(token) { return this.players.findIndex((p) => p.token === token); }
  get pot() { return this.players.reduce((s, p) => s + p.total, 0); }
  alive(p) { return p.inHand && !p.folded; }
  canAct(p) { return p.inHand && !p.folded && !p.allIn; }
  inProgress() { return STREETS.includes(this.phase); }
  nextIdx(from, pred) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + k) % n) + n) % n;
      if (pred(this.players[i])) return i;
    }
    return -1;
  }

  // ───── 입장/설정 ─────
  addPlayer(token, name) {
    if (this.banned.has(token)) return { error: '이 방에서 강제 퇴장되어 다시 입장할 수 없어요' };
    let i = this.find(token);
    if (i >= 0) {
      this.players[i].connected = true;
      if (name) this.players[i].name = name;
      return { idx: i };
    }
    if (this.ended) return { error: '이미 끝난 게임이에요' };
    if (this.players.length >= MAX_PLAYERS) return { error: '방이 가득 찼어요 (최대 10명)' };
    if (this.players.some((p) => p.name === name)) name = name + ' ' + (this.players.length + 1);
    this.players.push({
      token, name, chips: this.startChips, buyIns: 1, connected: true, sitOut: false,
      hole: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, inHand: false,
      revealed: false, lastAction: '', handName: '', won: 0, stun: '', stunBy: '',
    });
    if (!this.hostToken) this.hostToken = this.creator = token;
    this.say(`${name} 님이 입장했어요`);
    return { idx: this.players.length - 1 };
  }

  // ───── 연습 테이블: 봇 / 대기실 나가기 ─────
  pushBot() {
    const name = BOT_NAMES.find((n) => !this.players.some((p) => p.name === n)) || '봇' + (this.players.length + 1);
    const b = this.players[this.addPlayer('bot-' + crypto.randomUUID(), name).idx];
    b.bot = true; b.style = BOT_STYLES[(this.botSeq = (this.botSeq || 0) + 1) % 3];
  }
  botEdit(token) { // 봇을 늘리고 줄이는 건 방장이, 연습 테이블의 대기실에서만
    if (token !== this.hostToken) return '방장만 바꿀 수 있어요';
    if (!this.practice) return '연습 테이블에서만 쓸 수 있어요';
    if (this.handNo > 0 || this.phase !== 'waiting') return '게임 시작 전에만 바꿀 수 있어요';
    return null;
  }
  addBot(token) {
    const err = this.botEdit(token);
    if (err) return err;
    if (this.players.length >= MAX_PLAYERS) return '자리가 가득 찼어요 (최대 10명)';
    this.pushBot();
    this.onChange();
    return null;
  }
  removeBot(token, idx) {
    const err = this.botEdit(token);
    if (err) return err;
    const b = this.players[idx];
    if (!b || !b.bot) return '봇이 아니에요';
    if (this.players.length <= 2) return '최소 2명이 필요해요';
    this.removeAt(idx);
    this.say(`${b.name} 봇이 나갔어요`);
    this.onChange();
    return null;
  }
  // 시작 전 대기실에서 나가기 (시작 뒤에는 칩·정산이 얽혀 있어서 막는다)
  leave(token) {
    if (this.handNo > 0) return '게임이 시작된 뒤에는 나갈 수 없어요';
    const i = this.find(token);
    if (i < 0) return null;
    const name = this.players[i].name;
    this.removeAt(i);
    this.say(`${name} 님이 나갔어요`);
    if (token === this.hostToken || token === this.creator) { // 방장 자리를 남은 사람에게 넘긴다
      const next = this.players.find((p) => !p.bot && p.connected);
      this.hostToken = this.creator = next ? next.token : null;
    }
    this.onChange();
    return null;
  }
  // 방을 지울 때 남은 타이머를 모두 끈다 (안 그러면 빈 방에서 봇끼리 계속 칠 수 있다)
  destroy() {
    this.ended = true; this.onChange = () => {};
    for (const k of ['turnTimer', 'nextTimer', '_resumeT', '_botT', '_botHitT']) clearTimeout(this[k]);
    this.players.forEach((p) => { clearTimeout(p._rb); clearTimeout(p._payT); }); // _rb 리바인, _payT 봇의 합의금 지불, _botHitT 봇의 때리기 예약
  }

  setConnected(token, on) {
    const i = this.find(token);
    if (i < 0) return;
    this.players[i].connected = on;
    if (!on) {
      this.say(`${this.players[i].name} 님 연결이 끊겼어요`);
      if (this.hostToken === token) {
        const other = this.players.find((p) => p.connected && p.token !== token);
        if (other) this.hostToken = other.token;
      }
      if (this.inProgress() && this.toAct === i) this.armTimer();
    } else {
      if (token === this.creator || !this.players.find((p) => p.token === this.hostToken)?.connected) {
        this.hostToken = token; // 처음 방을 만든 사람이 돌아오면 방장 복귀
      }
      // 사람이 모자라 '대기 중'이었다면, 다시 모였을 때 저절로 이어간다 (예전에는 리바인해야만 풀렸다)
      if (this.opts.auto) { clearTimeout(this._resumeT); this._resumeT = setTimeout(() => this.tryResume(), 1500); }
      else this.tryResume();
    }
  }

  // 설정 값 검사 + 적용 (방 만들 때, 시작 전 방장이 바꿀 때 공통)
  applySettings(o) {
    const int = (v) => Math.floor(+v);
    const sb = int(o.sb), bb = int(o.bb);
    const chipsGiven = o.chips ?? o.startChips; // 지정하지 않으면 칩 1개 = 1원 (시작 칩 = 바이인 금액)
    const buyIn = this.opts.noMoney ? int(chipsGiven ?? o.buyIn) : int(o.buyIn); // 앱(noMoney): 금액 개념이 없어 바이인 = 시작 칩 개수로만 쓴다
    const chips = chipsGiven === undefined ? buyIn : int(chipsGiven);
    const mins = int(o.blindMinutes ?? 0), rebuys = int(o.maxRebuys ?? 0);
    if (![sb, bb, chips, buyIn, mins, rebuys].every(Number.isFinite)) return '숫자를 입력해 주세요';
    if (!(sb > 0 && bb >= sb)) return '블라인드 값을 확인해 주세요 (빅블라인드는 스몰블라인드 이상)';
    if (!(chips >= bb * 10)) return chipsGiven === undefined ? '바이인 금액은 빅블라인드의 10배 이상이어야 해요' : '시작 칩은 빅블라인드의 10배 이상이어야 해요';
    if (!(buyIn >= 0 && buyIn <= 100000000)) return '바이인 금액은 0 ~ 1억 원 사이로 입력해 주세요';
    if (!(mins >= 0 && mins <= 600)) return '블라인드 인상 주기는 0 ~ 600분이에요 (0이면 오르지 않아요)';
    if (!(rebuys >= 0 && rebuys <= 99)) return '리바인 횟수는 0 ~ 99회예요';
    this.sb = sb; this.bb = bb; this.startChips = chips; this.buyIn = buyIn; this.blindMinutes = mins; this.maxRebuys = rebuys;
    this.players.forEach((p) => { p.chips = chips; p.buyIns = 1; });
    return null;
  }

  settings(token, o) {
    if (token !== this.hostToken) return '방장만 바꿀 수 있어요';
    if (this.handNo > 0 || this.phase !== 'waiting') return '게임 시작 전에만 바꿀 수 있어요';
    return this.applySettings(o);
  }

  rebuysLeft(p) { return Math.max(0, this.maxRebuys - (p.buyIns - 1)); }
  canRebuy(p) { return p.chips === 0 && this.rebuysLeft(p) > 0; }
  eliminated(p) { return this.handNo > 0 && p.chips === 0 && this.rebuysLeft(p) === 0 && !(this.inProgress() && p.inHand && !p.folded); }

  start(token) {
    if (token !== this.hostToken) return '방장만 시작할 수 있어요';
    if (this.phase !== 'waiting') return '이미 진행 중이에요';
    if (this.players.filter((p) => p.connected && p.chips > 0).length < 2) return '2명 이상 필요해요';
    this.startHand();
    return null;
  }

  rebuy(token) {
    const i = this.find(token);
    if (i < 0) return '플레이어가 아니에요';
    const p = this.players[i];
    if (this.ended) return '게임이 끝났어요';
    if (this.handNo === 0) return '게임 시작 전에는 리바인할 수 없어요';
    if (p.chips > 0) return '아직 칩이 남아있어요';
    if (this.inProgress() && p.inHand && !p.folded) return '이번 핸드가 끝나면 가능해요';
    if (this.rebuysLeft(p) <= 0) return '리바인 횟수를 모두 사용했어요';
    p.chips = this.startChips;
    p.buyIns += 1;
    p.sitOut = false;
    this.say(`${p.name} 님이 리바인했어요 (${p.buyIns - 1}/${this.maxRebuys}회 · 칩 ${this.startChips.toLocaleString()})`);
    if (this.phase === 'waiting' && this.handNo > 0) this.tryResume();
    return null;
  }

  // ───── 방장 권한: 강제 퇴장 ─────
  // 핸드를 치르는 중인 사람은 폴드 처리하고 이번 핸드가 끝난 뒤(다음 핸드 시작 때) 자리를 지운다.
  // 그 밖의 사람은 바로 지운다. 나가는 사람의 남은 칩은 정산에 포함된다.
  kick(token, idx, name) {
    if (token !== this.hostToken) return '방장만 강제 퇴장시킬 수 있어요';
    if (this.ended) return '게임이 끝났어요';
    const p = this.players[idx];
    if (!p || p.name !== name) return '플레이어 정보가 바뀌었어요. 다시 선택해 주세요';
    if (p.token === this.hostToken) return '방장 본인은 퇴장시킬 수 없어요';
    if (p.kicked) return '이미 퇴장 처리 중이에요';
    p.kicked = true; p.connected = false; this.banned.add(p.token);
    this.say(`🚪 ${p.name} 님이 방장에 의해 강제 퇴장되었어요`);
    const playing = this.inProgress() && p.inHand;
    if (playing && !p.folded) this.foldForKick(idx);
    if (!playing) this.removeAt(idx);
    this.onChange();
    return null;
  }

  foldForKick(i) {
    const p = this.players[i], n = this.players.length, wasTurn = this.toAct === i;
    p.folded = true; p.acted = true; p.lastAction = '퇴장';
    this.emit({ k: 'fold', i });
    if (wasTurn) this.proceed(i);
    else this.proceed((this.toAct - 1 + n) % n); // 지금 차례인 사람은 그대로 두고 라운드가 끝났는지만 다시 본다
  }

  // 자리를 지우고, 번호가 밀리는 만큼 딜러·차례·블라인드 위치·결과 표를 같이 보정한다
  removeAt(i) {
    const p = this.players[i];
    if (this.handNo > 0) this.departed.push({ name: p.name + ' (퇴장)', buyIns: p.buyIns, chips: p.chips });
    this.players.splice(i, 1);
    const fix = (x) => (x < 0 ? x : x > i ? x - 1 : x === i ? -1 : x);
    this.toAct = fix(this.toAct); this.sbIdx = fix(this.sbIdx); this.bbIdx = fix(this.bbIdx);
    if (this.dealer > i) this.dealer--; else if (this.dealer === i) this.dealer = i - 1; // 다음 딜러는 그 다음 사람
    if (this.results) {
      const r = this.results;
      r.pots.forEach((pt) => { pt.winners = pt.winners.filter((w) => w !== i).map((w) => (w > i ? w - 1 : w)); });
      if (r.hands) r.hands = r.hands.filter((h) => h.i !== i).map((h) => ({ ...h, i: h.i > i ? h.i - 1 : h.i }));
    }
    if (this.inProgress()) this.armTimer(); // 차례 번호가 바뀌었으니 타이머를 새 번호로 다시 건다
  }

  // 핸드 중에 퇴장 예약된 사람들을 다음 핸드 시작 때 지운다
  applyKicks() {
    for (let i = this.players.length - 1; i >= 0; i--) if (this.players[i].kicked) this.removeAt(i);
  }

  // ───── 방장 권한: 일시정지(휴식) ─────
  pause(token) {
    if (token !== this.hostToken) return '방장만 일시정지할 수 있어요';
    if (this.ended) return '게임이 끝났어요';
    if (this.handNo === 0) return '게임을 시작한 뒤에 쓸 수 있어요';
    if (this.endAfterHand || this.ending) return '게임 종료가 예약되어 있어요';
    if (this.paused || this.pauseAfterHand) return '이미 일시정지 중이에요';
    if (this.inProgress()) this.say('⏸ 방장이 일시정지를 요청했어요. 이번 핸드가 끝나면 쉬어요'), (this.pauseAfterHand = true);
    else this.enterPause();
    this.onChange();
    return null;
  }
  enterPause() {
    this.paused = true; this.pauseAfterHand = false; this.pausedAt = this.clock();
    clearTimeout(this.nextTimer); this.nextAt = 0;
    this.say('⏸ 게임이 일시정지됐어요 (휴식 중)');
  }
  resume(token) {
    if (token !== this.hostToken) return '방장만 계속할 수 있어요';
    if (!this.paused && !this.pauseAfterHand) return '일시정지 상태가 아니에요';
    if (!this.paused) { this.pauseAfterHand = false; this.say('▶ 일시정지 요청을 취소했어요'); this.onChange(); return null; }
    if (this.nextBlindAt) this.nextBlindAt += this.clock() - this.pausedAt; // 쉰 시간은 블라인드 타이머에서 뺀다
    this.paused = false;
    this.say('▶ 게임을 계속해요');
    if (this.opts.auto && !this.inProgress()) {
      this.nextAt = Date.now() + 1500;
      this.nextTimer = setTimeout(() => this.startHand(), 1500);
    }
    this.onChange();
    return null;
  }

  // ───── 때리기 ─────
  // 돈은 '앞에 남은 칩(chips)'끼리만 옮긴다: 팟(total)·이번 라운드 베팅(bet)·올인 표시는 건드리지 않으니 판 도중에 일어나도 판돈·사이드 팟·정산 계산이 그대로 맞는다.
  // 때리는 사람은 낸 뒤에도 칩이 남아야 한다(칩 0 이 commit 밖에서 생기면 '칩 0인데 올인 표시 없음' 상태가 된다).
  hitCheck(hi, vi) { // 부작용 없이 '지금 hi 가 vi 를 때릴 수 있는지' 확인: 안 되면 이유(문장), 되면 null
    const h = this.players[hi], v = this.players[vi];
    if (!h || !v || hi === vi) return '때릴 사람을 다시 골라 주세요';
    if (this.ended) return '게임이 끝났어요';
    if (!this.hitOn) return '방장 권한으로 폭력은 안됩니다.';
    if (this.handNo === 0) return '게임이 시작된 뒤에 쓸 수 있어요';
    if (this.paused) return '휴식 중에는 때릴 수 없어요';
    if (this.endAfterHand || this.ending) return '마지막 핸드에는 때릴 수 없어요';
    if (this.phase === 'showdown' && this.nextAt && this.opts.nextHandMs >= 3000 && this.nextAt - Date.now() < PAY_WINDOW_MS) return '다음 핸드가 곧 시작돼요 · 지금은 때릴 수 없어요'; // 맞은 사람이 합의금을 낼 시간
    if (Date.now() < this.hitUntil) return `지금 ${this.lastHitBy}님이 때리는 중이에요`;
    if (this.handNo === this.lastHitHand) return `이번 핸드에는 이미 ${this.lastHitBy}님이 때렸어요`;
    if (this.handNo < this.lastHitHand + HIT_COOLDOWN) return `때리기는 연달아 쓸 수 없어요 · ${this.lastHitHand + HIT_COOLDOWN - this.handNo}핸드 뒤부터 가능해요`;
    if (h.kicked || !h.connected) return '지금은 때릴 수 없어요';
    if (h.stun) return '기절한 사람은 때릴 수 없어요';
    if (!(h.chips >= HIT_COST + this.bb)) return '칩이 부족해서 때릴 수 없어요 (때린 뒤에도 빅블라인드 이상 남아야 해요)';
    if (v.kicked || !v.connected || !(v.chips > 0)) return '칩이 없거나 나간 사람은 때릴 수 없어요';
    if (v.stun) return '이미 기절한 사람이에요';
    if (this.players.filter((p) => p !== v && !p.kicked && p.connected && p.chips > 0).length < 2) return '남는 사람이 적어서 때릴 수 없어요 (기절하면 판이 안 돌아가요)';
    return null;
  }

  hit(token, idx, name) { // name 을 주면 그 자리의 사람 이름과 맞는지 본다 (그 사이 자리가 밀렸으면 엉뚱한 사람이 맞지 않게)
    const hi = this.find(token);
    if (hi < 0) return '플레이어가 아니에요';
    if (name !== undefined && !(this.players[idx] && this.players[idx].name === name)) return '플레이어 정보가 바뀌었어요. 다시 선택해 주세요';
    const err = this.hitCheck(hi, idx);
    if (err) return err;
    const h = this.players[hi], v = this.players[idx];
    h.chips -= HIT_COST; v.chips += HIT_COST;
    v.stun = 'pending'; v.stunBy = h.token;
    this.lastHitHand = this.handNo; this.lastHitBy = h.name; this.hitUntil = Date.now() + HIT_ANIM_MS; this.hitSeq++;
    this.emit({ k: 'hit', i: hi, to: idx, amt: HIT_COST }); // 화면 연출 시간은 더하지 않는다: 때리는 동안에도 판은 그대로 진행
    this.say(`⚾ ${h.name} 님이 ${v.name} 님을 때렸어요 (${HIT_COST.toLocaleString()}원 → ${v.name}) · ${v.name} 님은 다음 핸드를 기절해서 쉬어요`);
    this.onChange();
    return null;
  }

  // 맞은 사람이 다음 핸드가 시작되기 전에 합의금을 내고 기절을 푼다 (이미 기절한 핸드가 시작됐으면 늦음)
  payStun(token) {
    const vi = this.find(token);
    if (vi < 0) return '플레이어가 아니에요';
    const v = this.players[vi];
    if (this.ended) return '게임이 끝났어요';
    if (v.stun === 'out') return '이미 이번 핸드를 쉬는 중이에요';
    if (v.stun !== 'pending') return '기절 상태가 아니에요';
    const h = this.players.find((p) => p.token === v.stunBy && !p.kicked);
    if (!h) { v.stun = ''; v.stunBy = ''; this.onChange(); return null; } // 때린 사람이 이미 없으면 그냥 풀린다
    if (!(v.chips > STUN_PAY)) return '칩이 부족해서 합의금을 낼 수 없어요';
    v.chips -= STUN_PAY; h.chips += STUN_PAY; v.stun = ''; v.stunBy = '';
    this.emit({ k: 'pay', i: vi, to: this.players.indexOf(h), amt: STUN_PAY });
    this.say(`💸 ${v.name} 님이 ${h.name} 님에게 ${STUN_PAY.toLocaleString()}원을 내고 기절을 풀었어요`);
    this.onChange();
    return null;
  }

  // ───── 카드 자랑하기: which = 0(첫째 장)·1(둘째 장)·'both'. 안 고른 카드는 이벤트에 아예 싣지 않는다 ─────
  brag(token, which) {
    const i = this.find(token);
    if (i < 0) return '플레이어가 아니에요';
    if (this.ended) return '게임이 끝났어요';
    if (this.phase !== 'showdown' || !this.results || this.results.showdown || !this.bragBy) return '다른 사람이 모두 폴드해서 이긴 판에서만 자랑할 수 있어요';
    if (token !== this.bragBy) return '이긴 사람만 자랑할 수 있어요';
    if (this.bragUsed) return '이미 자랑했어요';
    if (Date.now() > this.bragUntil) return '자랑할 수 있는 시간(8초)이 지났어요';
    const p = this.players[i];
    if (!(which === 0 || which === 1 || which === 'both') || p.hole.length !== 2) return '보여 줄 카드를 다시 골라 주세요';
    this.bragUsed = true;
    const show = which === 'both' ? [0, 1] : [which], cs = p.hole.map(cardStr);
    this.emit({ k: 'brag', i, cards: cs.map((c, k) => (show.includes(k) ? c : '??')), show, at: Date.now() });
    this.say(`🃏 ${p.name} 님이 카드를 자랑했어요: ${show.map((k) => cs[k]).join(' ')}`);
    if (this.opts.auto && this.phase === 'showdown' && !this.paused && this.nextAt) { // 연출이 끝나기 전에 다음 핸드가 시작되지 않게 늦춘다
      const at = Date.now() + BRAG_ANIM_MS;
      if (this.nextAt < at) {
        clearTimeout(this.nextTimer); this.nextAt = at;
        this.nextTimer = setTimeout(() => (this.ending ? this.finishGame(this.ending) : this.startHand()), BRAG_ANIM_MS);
      }
    }
    this.onChange();
    return null;
  }

  hitSwitch(token, on) {
    if (token !== this.hostToken) return '방장만 바꿀 수 있어요';
    if (this.ended) return '게임이 끝났어요';
    if (typeof on !== 'boolean') return '잘못된 요청이에요';
    this.hitOn = on;
    this.say(this.hitOn ? '⚾ 방장이 때리기를 켰어요' : '🚫 방장이 때리기를 껐어요');
    this.onChange();
    return null;
  }

  // 맞은 뒤 처음 시작하는 핸드부터 기절 (때린 사람이 이미 나갔으면 그냥 풀린다)
  promoteStuns() {
    for (const p of this.players) {
      if (p.stun !== 'pending') continue;
      if (p.kicked || !(p.chips > 0) || !this.players.some((q) => q.token === p.stunBy && !q.kicked)) { p.stun = ''; p.stunBy = ''; continue; }
      p.stun = 'out';
    }
  }

  // ───── 감정표현 (차례와 상관없이 언제든) ─────
  // 사람이 친 글: 줄바꿈·제어문자를 공백으로, 연속 공백은 하나로, 글자(이모지 포함) 수는 max 로 자른다
  cleanText(text, max) {
    return Array.from(String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim();
  }

  emote(token, kind, text) {
    const i = this.find(token);
    if (i < 0) return '플레이어가 아니에요';
    if (this.ended) return '게임이 끝났어요';
    if (kind === 'text') { // 한마디: 아바타 위 말풍선에 최대 10자
      text = this.cleanText(text, 10);
      if (!text) return '한마디를 입력해 주세요';
    } else if (!['angry', 'thanks', 'sad', 'hurry'].includes(kind)) return '알 수 없는 표현이에요';
    const p = this.players[i], now = Date.now();
    if (now - (p.lastEmote || 0) < 2500) return '표현은 잠시 뒤에 다시 쓸 수 있어요';
    p.lastEmote = now;
    this.emit(kind === 'text' ? { k: 'emote', i, e: 'text', text, name: p.name } : { k: 'emote', i, e: kind, name: p.name });
    this.onChange();
    return null;
  }

  // ───── 일반 채팅 (게임 상태와 따로 전달) ─────
  chat(token, text) {
    const i = this.find(token);
    if (i < 0) return '플레이어가 아니에요';
    text = this.cleanText(text, 200);
    if (!text) return '메시지를 입력해 주세요';
    const p = this.players[i], now = Date.now();
    if (now - (p.lastChat || 0) < 700) return '메시지는 잠시 뒤에 다시 보낼 수 있어요';
    p.lastChat = now;
    const msg = { id: ++this.chatSeq, by: token, name: p.name, text, at: now };
    this.chatLog.push(msg);
    if (this.chatLog.length > 100) this.chatLog.shift();
    this.onChat(msg);
    return null;
  }

  // ───── 핸드 진행 ─────
  tryResume() {
    if (this.phase === 'waiting' && this.handNo > 0 &&
        this.players.filter((p) => p.connected && p.chips > 0 && !p.sitOut).length >= 2) {
      this.startHand();
    }
  }

  startHand() {
    clearTimeout(this.nextTimer);
    if (this.ended || this.paused) return;
    this.applyKicks();
    this.promoteStuns();
    let elig = this.players.filter((p) => p.chips > 0 && !p.sitOut && p.connected && p.stun !== 'out'); // 기절한 사람은 패를 받지 않고 이번 핸드를 쉰다 (블라인드도 안 낸다)
    if (elig.length < 2 && this.players.some((p) => p.stun === 'out')) { // 기절 때문에 판이 안 돌아가면 기절은 풀어 준다
      for (const p of this.players) if (p.stun === 'out') { p.stun = ''; p.stunBy = ''; }
      this.say('기절한 사람이 있으면 판이 안 돌아가서 기절을 풀었어요');
      elig = this.players.filter((p) => p.chips > 0 && !p.sitOut && p.connected);
    }
    if (elig.length < 2 || (this.practice && !this.players.some((p) => !p.bot && p.connected && p.chips > 0))) { // 연습 테이블은 사람이 한 명도 없으면 봇끼리 계속 치지 않고 기다린다
      for (const p of this.players) if (p.stun === 'out') p.stun = 'pending'; // 핸드가 시작되지 않았으니 기절도 시작되지 않은 것 (합의금으로 풀 수 있게)
      this.phase = 'waiting';
      this.toAct = -1;
      this.say('플레이어가 부족해서 대기 중이에요');
      this.onChange();
      return;
    }
    for (const p of this.players) {
      Object.assign(p, { hole: [], bet: 0, total: 0, folded: false, allIn: false, acted: false,
        inHand: false, revealed: false, lastAction: '', handName: '', won: 0 });
    }
    elig.forEach((p) => (p.inHand = true));
    this.bragUntil = 0; this.bragBy = ''; this.bragUsed = false;
    for (const p of this.players) if (p.stun === 'out') p.lastAction = '기절';
    this.handNo++;
    this.raiseBlinds();
    this.results = null;
    this.community = [];
    this.deck = newDeck();
    const inHand = (p) => p.inHand;
    this.dealer = this.nextIdx(this.dealer, inHand);
    const heads = elig.length === 2;
    const sbIdx = heads ? this.dealer : this.nextIdx(this.dealer, inHand);
    const bbIdx = this.nextIdx(sbIdx, inHand);
    this.say(`── 핸드 #${this.handNo} 시작 · 딜러 ${this.players[this.dealer].name} ──`);
    this.anim = 0;
    this.emit({ k: 'hand', n: this.handNo, dealer: this.dealer, sb: sbIdx, bb: bbIdx });
    this.commit(this.players[sbIdx], Math.min(this.sb, this.players[sbIdx].chips));
    this.emit({ k: 'bet', i: sbIdx, add: this.players[sbIdx].bet, total: this.players[sbIdx].bet, kind: 'blind' });
    this.commit(this.players[bbIdx], Math.min(this.bb, this.players[bbIdx].chips));
    this.emit({ k: 'bet', i: bbIdx, add: this.players[bbIdx].bet, total: this.players[bbIdx].bet, kind: 'blind' });
    this.players[sbIdx].lastAction = `SB ${this.players[sbIdx].bet}`;
    this.players[bbIdx].lastAction = `BB ${this.players[bbIdx].bet}`;
    this.sbIdx = sbIdx; this.bbIdx = bbIdx;
    for (let r = 0; r < 2; r++) {
      let i = this.dealer;
      for (let k = 0; k < elig.length; k++) {
        i = this.nextIdx(i, inHand);
        this.players[i].hole.push(this.deck.pop());
        this.emit({ k: 'deal', to: i });
      }
    }
    this.phase = 'preflop';
    this.currentBet = Math.max(this.players[sbIdx].bet, this.players[bbIdx].bet);
    this.minRaise = this.bb;
    this.proceed(bbIdx);
  }

  // 블라인드 자동 인상: 게임 시작 후 N분마다 2배 (핸드 시작 시점에 적용)
  raiseBlinds() {
    if (this.blindMinutes <= 0) { this.nextBlindAt = 0; return; }
    const step = this.blindMinutes * 60000, now = this.clock();
    if (!this.nextBlindAt) this.nextBlindAt = now + step;
    let raised = false;
    while (now >= this.nextBlindAt) { this.sb *= 2; this.bb *= 2; this.blindLevel++; this.nextBlindAt += step; raised = true; }
    if (raised) this.say(`⬆ 블라인드가 올랐어요: ${this.sb.toLocaleString()} / ${this.bb.toLocaleString()}`);
  }

  commit(p, amt) {
    amt = Math.max(0, Math.min(amt, p.chips));
    p.chips -= amt;
    p.bet += amt;
    p.total += amt;
    if (p.chips === 0) p.allIn = true;
  }

  roundDone() {
    const ca = this.players.filter((p) => this.canAct(p));
    if (ca.length === 0) return true;
    return ca.every((p) => p.bet === this.currentBet && (p.acted || ca.length === 1));
  }

  proceed(from) {
    clearTimeout(this.turnTimer);
    const alive = this.players.filter((p) => this.alive(p));
    if (alive.length === 1) return this.finishUncontested(alive[0]);
    while (this.roundDone()) {
      if (this.phase === 'river') return this.showdown();
      this.nextStreet();
      from = this.dealer;
    }
    this.toAct = this.nextIdx(from, (p) => this.canAct(p));
    this.armTimer();
    this.onChange();
  }

  sweepEvent() {
    if (this.players.some((p) => p.bet > 0)) this.emit({ k: 'sweep' });
  }

  nextStreet() {
    this.sweepEvent();
    for (const p of this.players) { p.bet = 0; p.acted = false; if (this.alive(p) && !p.allIn) p.lastAction = ''; }
    this.currentBet = 0;
    this.minRaise = this.bb;
    const next = STREETS[STREETS.indexOf(this.phase) + 1];
    this.phase = next;
    const n = next === 'flop' ? 3 : 1;
    const before = this.community.length;
    for (let i = 0; i < n; i++) this.community.push(this.deck.pop());
    this.emit({ k: 'street', phase: next, cards: this.community.slice(before).map(cardStr) });
    this.say(`${{ flop: '플랍', turn: '턴', river: '리버' }[next]}: ${this.community.map(cardStr).join(' ')}`);
  }

  armTimer() {
    clearTimeout(this.turnTimer);
    if (!this.opts.auto || !this.inProgress() || this.toAct < 0) return;
    const p = this.players[this.toAct];
    const ms = (p.connected ? this.opts.turnMs : this.opts.absentMs) + this.anim;
    this.anim = 0;
    this.deadline = Date.now() + ms;
    const idx = this.toAct;
    this.turnTimer = setTimeout(() => {
      if (this.toAct !== idx || !this.inProgress()) return;
      const q = this.players[idx];
      const toCall = this.currentBet - q.bet;
      this.say(`${q.name} 님 시간 초과`);
      this.act(q.token, toCall > 0 ? 'fold' : 'check');
    }, ms);
  }

  act(token, a, amount) {
    const i = this.find(token);
    if (this.ended) return '게임이 끝났어요';
    if (i < 0 || !this.inProgress() || this.toAct !== i) return '지금은 내 차례가 아니에요';
    const wait = this.animUntil - Date.now();
    if (this.opts.pace && !this._now && wait > 30) { // 화면 연출이 끝난 뒤에 처리
      clearTimeout(this.turnTimer);
      setTimeout(() => { this._now = true; try { this.act(token, a, amount); } finally { this._now = false; } }, wait);
      return null;
    }
    const p = this.players[i];
    const toCall = this.currentBet - p.bet;
    if (a === 'fold') {
      p.folded = true;
      this.emit({ k: 'fold', i });
      p.lastAction = '폴드';
      this.say(`${p.name}: 폴드`);
    } else if (a === 'check' || (a === 'call' && toCall <= 0)) {
      if (toCall > 0) return '체크할 수 없어요';
      p.lastAction = '체크';
      this.emit({ k: 'check', i });
      this.say(`${p.name}: 체크`);
    } else if (a === 'call') {
      const paid = Math.min(toCall, p.chips);
      this.commit(p, toCall);
      this.emit({ k: 'bet', i, add: paid, total: p.bet, kind: p.allIn ? 'allin' : 'call' });
      p.lastAction = p.allIn ? '올인' : '콜';
      this.say(`${p.name}: ${p.allIn ? '올인(콜)' : '콜'} ${paid.toLocaleString()}`);
    } else if (a === 'raise') {
      let target = Math.floor(+amount);
      if (!Number.isFinite(target)) return '금액이 올바르지 않아요';
      const maxTarget = p.bet + p.chips;
      if (target > maxTarget) target = maxTarget;
      if (target <= this.currentBet) return '레이즈 금액이 너무 작아요';
      const inc = target - this.currentBet;
      const full = inc >= this.minRaise;
      if (!full && target < maxTarget) return `최소 ${(this.currentBet + this.minRaise).toLocaleString()} 까지 올려야 해요`;
      const label = this.currentBet === 0 ? '벳' : '레이즈';
      const before = p.bet;
      this.commit(p, target - p.bet);
      this.emit({ k: 'bet', i, add: target - before, total: target, kind: p.allIn ? 'allin' : label === '벳' ? 'bet' : 'raise' });
      if (full) this.minRaise = inc;
      this.currentBet = target;
      for (const q of this.players) if (q !== p && this.canAct(q)) q.acted = false;
      p.lastAction = p.allIn ? `올인 ${target}` : `${label} ${target}`;
      this.say(`${p.name}: ${p.allIn ? '올인' : label} ${target.toLocaleString()}`);
    } else return '알 수 없는 행동이에요';
    p.acted = true;
    this.proceed(i);
    return null;
  }

  // ───── 종료 ─────
  finishUncontested(w) {
    const amount = this.pot;
    w.chips += amount;
    w.won = amount;
    this.sweepEvent();
    this.emit({ k: 'win', winners: [{ i: this.players.indexOf(w), amount }], showdown: false });
    this.results = { showdown: false, pots: [{ amount, winners: [this.players.indexOf(w)], hand: '' }] };
    this.say(`${w.name} 님이 ${amount.toLocaleString()} 획득 (다른 플레이어 모두 폴드)`);
    this.bragBy = w.token; this.bragUsed = false; this.bragUntil = Date.now() + BRAG_MS;
    this.endHand();
  }

  calcPots() {
    const contrib = this.players.filter((p) => p.total > 0);
    const levels = [...new Set(contrib.filter((p) => this.alive(p)).map((p) => p.total))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const lv of levels) {
      let amount = 0;
      for (const p of contrib) amount += Math.max(0, Math.min(p.total, lv) - prev);
      pots.push({ amount, elig: contrib.filter((p) => this.alive(p) && p.total >= lv) });
      prev = lv;
    }
    const sum = pots.reduce((s, x) => s + x.amount, 0);
    if (pots.length && sum < this.pot) pots[pots.length - 1].amount += this.pot - sum;
    return pots;
  }

  showdown() {
    const alive = this.players.filter((p) => this.alive(p));
    for (const p of alive) {
      p.score = best([...p.hole, ...this.community]);
      p.handName = handName(p.score);
      p.revealed = true;
    }
    this.sweepEvent();
    const hands = {};
    for (const p of alive) hands[this.players.indexOf(p)] = p.hole.map(cardStr);
    this.emit({ k: 'show', hands });
    const pots = this.calcPots();
    const out = [];
    pots.forEach((pot, n) => {
      const top = Math.max(...pot.elig.map((p) => p.score));
      const winners = pot.elig.filter((p) => p.score === top);
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      // 나머지 칩은 딜러 왼쪽부터
      const order = [];
      let i = this.dealer;
      for (let k = 0; k < this.players.length; k++) {
        i = (i + 1) % this.players.length;
        if (winners.includes(this.players[i])) order.push(this.players[i]);
      }
      for (const w of order) {
        const got = share + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        w.chips += got;
        w.won += got;
      }
      out.push({ amount: pot.amount, winners: order.map((w) => this.players.indexOf(w)), hand: winners[0].handName, side: n > 0 });
      this.say(`${n === 0 ? '메인 팟' : '사이드 팟 ' + n} ${pot.amount.toLocaleString()} → ${order.map((w) => w.name).join(', ')} (${winners[0].handName})`);
    });
    this.emit({ k: 'win', showdown: true, winners: this.players.map((p, i) => ({ i, amount: p.won })).filter((x) => x.amount > 0) });
    // 승패 비교표: 폴드하지 않고 끝까지 남은 사람만 (폴드한 사람의 카드는 절대 포함하지 않는다)
    const sorted = alive.slice().sort((a, b) => b.score - a.score);
    const top = sorted[0];
    const tied = sorted.filter((q) => q.score === top.score).length > 1;
    const compare = sorted.map((p) => {
      let why;
      if (p.won > 0 && p.score === top.score) {
        const runner = sorted.find((q) => q.score < top.score);
        why = tied ? '같은 족보·같은 숫자라 팟을 나눠 가져요' : runner ? `${runner.name}(${runner.handName})보다 높아요 · ${explainDiff(top.score, runner.score)}` : '';
      } else if (p.won > 0) {
        why = '사이드 팟에서 이겼어요';
      } else {
        why = `${top.name}(${top.handName})에게 졌어요 · ${explainDiff(top.score, p.score)}`;
      }
      return { i: this.players.indexOf(p), cards: p.hole.map(cardStr), hand: p.handName, why };
    });
    this.results = { showdown: true, pots: out, hands: compare };
    this.endHand();
  }

  endHand() {
    clearTimeout(this.turnTimer);
    for (const p of this.players) if (p.stun === 'out') { p.stun = ''; p.stunBy = ''; } // 기절은 한 핸드만: 핸드가 끝나면 깨어난다
    this.phase = 'showdown';
    this.toAct = -1;
    this.deadline = 0;
    for (const p of this.players) {
      if (p.inHand && p.chips === 0) this.say(`${p.name} 님 칩이 바닥났어요`);
    }
    const reason = this.endAfterHand ? 'host' : this.soleWinner() ? 'winner' : this.practiceOut() ? 'out' : null;
    if (reason) this.ending = reason;
    if (this.pauseAfterHand && !reason) {
      this.enterPause();
    } else if (this.opts.auto) {
      const wait = this.opts.nextHandMs + this.anim + (this.results && this.results.showdown ? this.opts.showdownExtraMs : 0);
      this.anim = 0;
      this.nextAt = Date.now() + wait;
      this.nextTimer = setTimeout(() => (reason ? this.finishGame(reason) : this.startHand()), wait);
    }
    this.onChange();
  }

  // 연습 테이블에서 사람이 모두 탈락했는지 (봇끼리 칩이 남아 있어도 의미 없으니 끝낸다)
  practiceOut() {
    return !!this.practice && !this.players.some((p) => !p.bot && !p.kicked && (p.chips > 0 || this.rebuysLeft(p) > 0));
  }

  // 1등이 가려졌는지: 칩이 있는 사람이 한 명뿐이고, 나머지는 칩이 없고 리바인도 못 하는 경우
  soleWinner() {
    const act = this.players.filter((p) => !p.kicked); // 퇴장 예약된 사람은 빼고 센다
    const withChips = act.filter((p) => p.chips > 0);
    if (withChips.length !== 1 || act.length < 2) return false;
    return act.every((p) => p === withChips[0] || (p.chips === 0 && this.rebuysLeft(p) === 0));
  }

  // 방장이 종료: 진행 중이면 이번 핸드가 끝난 뒤 종료, 핸드 사이면 바로 종료
  endGame(token) {
    if (token !== this.hostToken) return '방장만 게임을 종료할 수 있어요';
    if (this.ended) return '이미 종료됐어요';
    if (this.handNo === 0) return '게임을 시작하기 전에는 종료할 수 없어요';
    this.endAfterHand = true;
    if (this.inProgress()) {
      this.say('⏹ 방장이 게임 종료를 요청했어요. 이번 핸드가 끝나면 정산해요');
    } else if (this.phase === 'showdown') {
      this.ending = 'host';
      clearTimeout(this.nextTimer);
      if (this.opts.auto) {
        const wait = Math.max(1500, (this.nextAt || 0) - Date.now());
        this.nextAt = Date.now() + wait;
        this.nextTimer = setTimeout(() => this.finishGame('host'), wait);
      }
      this.say('⏹ 방장이 게임을 종료해요');
    } else {
      this.finishGame('host');
      return null;
    }
    this.onChange();
    return null;
  }

  finishGame(reason) {
    clearTimeout(this.nextTimer); clearTimeout(this.turnTimer);
    if (this.ended) return;
    this.ended = true; this.phase = 'ended'; this.toAct = -1; this.deadline = 0; this.nextAt = 0; this.ending = null; this.paused = false; this.pauseAfterHand = false;
    for (const p of this.players) { p.stun = ''; p.stunBy = ''; } // 끝난 게임에는 기절도 남기지 않는다
    try { this.settlement = { reason, ...computeSettlement([...this.players, ...this.departed], this.startChips, this.buyIn) }; }
    catch (e) { console.error('정산 오류', e); this.settlement = { reason, error: e.message, rows: [], transfers: [] }; }
    this.say(reason === 'winner' ? '🏆 1등이 가려져서 게임이 끝났어요' : reason === 'out' ? '🏁 칩이 모두 떨어져 연습이 끝났어요' : '⏹ 방장이 게임을 종료했어요');
    this.onChange();
  }

  // ───── 클라이언트에 보낼 상태 ─────
  view(token) {
    const me = this.find(token);
    const showAll = this.phase === 'showdown' && this.results && this.results.showdown;
    let myHand = '';
    if (me >= 0 && this.players[me].hole.length && this.community.length >= 3 && this.alive(this.players[me])) {
      myHand = handName(best([...this.players[me].hole, ...this.community]));
    }
    return {
      t: 'state',
      phase: this.phase, handNo: this.handNo, dealer: this.dealer, toAct: this.toAct,
      sbIdx: this.inProgress() || this.phase === 'showdown' ? this.sbIdx : -1,
      bbIdx: this.inProgress() || this.phase === 'showdown' ? this.bbIdx : -1,
      currentBet: this.currentBet, minRaise: this.minRaise, sb: this.sb, bb: this.bb,
      startChips: this.startChips, pot: this.pot, community: this.community.map(cardStr),
      buyIn: this.buyIn, blindMinutes: this.blindMinutes, maxRebuys: this.maxRebuys, blindLevel: this.blindLevel, nextBlindAt: this.nextBlindAt,
      practice: !!this.practice,
      ended: this.ended, endAfterHand: this.endAfterHand, ending: this.ending, settlement: this.opts.noMoney ? chipsOnly(this.settlement) : this.settlement,
      paused: this.paused, pauseAfterHand: this.pauseAfterHand, departed: this.departed.map((d) => ({ name: d.name, buyIns: d.buyIns, chips: d.chips })),
      deadline: this.deadline, nextAt: this.phase === 'showdown' ? this.nextAt : 0, serverNow: Date.now(),
      me, isHost: token === this.hostToken, results: this.results, myHand,
      brag: { until: this.bragUntil, winner: this.bragBy ? this.players.findIndex((q) => q.token === this.bragBy) : -1, used: this.bragUsed },
      hit: { on: this.hitOn, cost: HIT_COST, pay: STUN_PAY, cooldown: HIT_COOLDOWN, lastHitHand: this.lastHitHand, lastHitBy: this.lastHitBy, busyUntil: this.hitUntil, seq: this.hitSeq },
      log: this.log.slice(-40), events: this.events.slice(-60), evSeq: this.evSeq,
      players: this.players.map((p, i) => {
        let cards = [];
        if (p.inHand && p.hole.length) {
          if (i === me || (showAll && p.revealed)) cards = p.hole.map(cardStr);
          else if (!p.folded) cards = ['??', '??'];
        }
        return {
          name: p.name, chips: p.chips, bet: p.bet, total: p.total, folded: p.folded, allIn: p.allIn,
          inHand: p.inHand, connected: p.connected, lastAction: p.lastAction, cards,
          handName: showAll && p.revealed ? p.handName : '', won: p.won, host: p.token === this.hostToken,
          buyIns: p.buyIns, rebuysLeft: this.rebuysLeft(p), out: this.eliminated(p), kicked: !!p.kicked, bot: !!p.bot, style: p.style || '',
          stun: p.stun, stunBy: p.stun ? this.players.findIndex((q) => q.token === p.stunBy) : -1,
        };
      }),
    };
  }
}

module.exports = { Table, best, score5, handName, computeSettlement, explainDiff, MAX_PLAYERS, HIT_COST, STUN_PAY, HIT_COOLDOWN, HIT_ANIM_MS, PAY_WINDOW_MS, BRAG_MS, BRAG_ANIM_MS };
