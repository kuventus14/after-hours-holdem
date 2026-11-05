'use strict';
// 가상 플레이어 종합 시험: 실제 서버에 WebSocket 으로 접속해서 N판을 치르고, 종료·정산까지 규칙을 자동 검사한다.
//   URL=ws://localhost:3100 HANDS=20 node playtest.js
const WebSocket = require('ws');

const URL = process.env.URL || 'ws://localhost:3100';
const TARGET = +process.env.HANDS || 20;
const SETTINGS = JSON.parse(process.env.SETTINGS || '{"buyIn":10000,"chips":3000,"sb":25,"bb":50,"blindMinutes":3,"maxRebuys":9}');
const STALL_MS = 120000;
const MODE = process.env.MODE || 'host'; // host: N판 후 방장 종료 / winner: 1등이 나올 때까지(자동 종료)
const STYLES = (process.env.STYLES || '콜러:call,공격수:aggr,소심:tight,올인러:allin').split(',').map((x) => x.split(':'));
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

const violations = [];
const warnings = [];
const bad = (msg) => { if (violations.length < 60) violations.push(msg); };
const warn = (msg) => { if (warnings.length < 30) warnings.push(msg); };
const stats = { states: 0, showdowns: 0, uncontested: 0, sidePotHands: 0, allIns: 0, rebuys: 0, folds: 0, maxPlayers: 0, eventGaps: 0 };
const checks = {}; // 이름 → true/false
const expectCheck = (name, ok, detail) => { checks[name] = { ok: !!ok, detail }; if (!ok) bad(`[검사 실패] ${name}${detail ? ' — ' + detail : ''}`); };

const nextIn = (players, from, pred) => { const n = players.length; for (let k = 1; k <= n; k++) { const i = (((from + k) % n) + n) % n; if (pred(players[i])) return i; } return -1; };
const STREETS = ['preflop', 'flop', 'turn', 'river'];

class Client {
  constructor(name, style) {
    this.name = name; this.style = style; this.token = 'pt-' + name + '-' + Math.random().toString(36).slice(2, 10);
    this.emotesSeen = new Set(); this.removed = false;
    this.state = null; this.acted = ''; this.errors = []; this.ws = null; this.active = true; this.prevEv = 0; this.rebuyKey = ''; this.joinedAt = null;
  }
  connect(room, settings) {
    return new Promise((resolve, reject) => {
      let done = false;
      const ws = (this.ws = new WebSocket(URL));
      ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room: room || '', name: this.name, token: this.token, settings })));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.t === 'state') { this.onState(m); if (!done) { done = true; resolve(m.room); } }
        else if (m.t === 'error') { this.errors.push(m.msg); this.errAt = (this.errAt || []).concat(`핸드#${this.state ? this.state.handNo : 0}`); if (!done) { done = true; reject(new Error(m.msg)); } }
        else if (m.t === 'kicked') warn(`${this.name}: kicked 수신`);
        else if (m.t === 'removed') { this.removed = true; this.active = false; }
      });
      ws.on('error', (e) => { if (!done) { done = true; reject(e); } });
    });
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  disconnect() { this.active = false; try { this.ws.close(); } catch {} }

  onState(s) {
    this.state = s;
    stats.states++;
    this.check(s);
    hooks.onState(this, s);
    this.bot(s);
  }

  // ── 매 상태마다 규칙 검사 ──
  check(s) {
    const P = s.players, me = s.me, who = `${this.name}@핸드${s.handNo}/${s.phase}`;
    stats.maxPlayers = Math.max(stats.maxPlayers, P.length);
    const inProg = STREETS.includes(s.phase);
    const dep = s.departed || [];
    const totalChips = P.reduce((x, p) => x + p.chips, 0) + dep.reduce((x, d) => x + d.chips, 0);
    const buyTotal = P.reduce((x, p) => x + p.buyIns * s.startChips, 0) + dep.reduce((x, d) => x + d.buyIns * s.startChips, 0);
    const pot = P.reduce((x, p) => x + p.total, 0);
    if (s.pot !== pot) bad(`${who}: 팟(${s.pot}) != 개인 투입 합(${pot})`);
    if (inProg ? totalChips + pot !== buyTotal : totalChips !== buyTotal) bad(`${who}: 칩 합계 불일치 — 칩 ${totalChips} + 팟 ${inProg ? pot : 0} vs 바이인 ${buyTotal}`);
    for (const p of P) {
      if (p.chips < 0 || !Number.isInteger(p.chips)) bad(`${who}: ${p.name} 칩이 이상함 ${p.chips}`);
      if (p.bet > p.total) bad(`${who}: ${p.name} 이번 라운드 베팅이 총 투입보다 큼`);
      if (p.buyIns > SETTINGS.maxRebuys + 1) bad(`${who}: ${p.name} 바이인 ${p.buyIns}회가 한도(${SETTINGS.maxRebuys + 1})를 넘음`);
      if (p.rebuysLeft !== SETTINGS.maxRebuys - (p.buyIns - 1)) bad(`${who}: ${p.name} 남은 리바인 계산 오류`);
    }
    // 블라인드 단계
    if (s.sb !== SETTINGS.sb * 2 ** s.blindLevel || s.bb !== SETTINGS.bb * 2 ** s.blindLevel) bad(`${who}: 블라인드 ${s.sb}/${s.bb} 가 단계 ${s.blindLevel} 와 안 맞음`);
    // 카드 비공개
    const reveal = s.phase === 'showdown' && s.results && s.results.showdown;
    P.forEach((p, i) => {
      if (i === me) return;
      const alive = p.inHand && !p.folded;
      if (p.folded && p.cards.length) bad(`${who}: 폴드한 ${p.name} 카드가 ${this.name} 에게 전달됨`);
      if (!p.inHand && p.cards.length) bad(`${who}: 이번 핸드에 없는 ${p.name} 카드가 전달됨`);
      if (alive && p.cards.length) {
        const real = p.cards.some((c) => c !== '??');
        if (real && !reveal) bad(`${who}: 쇼다운 전에 ${p.name} 카드 노출 ${p.cards}`);
        if (reveal && !p.cards.every((c) => c !== '??')) bad(`${who}: 쇼다운인데 ${p.name} 카드가 비공개`);
      }
    });
    // 진행 중 차례
    if (inProg) {
      const a = P[s.toAct];
      if (!a || !a.inHand || a.folded || a.allIn) bad(`${who}: 차례인 사람이 행동할 수 없는 상태 (toAct=${s.toAct})`);
    }
    // 쇼다운/결과
    if (s.phase === 'showdown' && s.results) {
      const won = P.reduce((x, p) => x + p.won, 0);
      if (won !== pot) bad(`${who}: 지급된 칩(${won}) != 팟(${pot})`);
      const alive = P.map((p, i) => ({ p, i })).filter((x) => x.p.inHand && !x.p.folded);
      if (s.results.showdown) {
        const hs = s.results.hands || [];
        if (hs.length !== alive.length || !alive.every((x) => hs.some((h) => h.i === x.i))) bad(`${who}: 비교표 인원(${hs.length}) != 끝까지 간 인원(${alive.length})`);
        for (const h of hs) {
          if (P[h.i].folded) bad(`${who}: 비교표에 폴드한 사람 포함`);
          if (JSON.stringify(h.cards) !== JSON.stringify(P[h.i].cards)) bad(`${who}: 비교표 카드 != 공개 카드`);
          if (!h.hand) bad(`${who}: 족보 이름 없음`);
          if (!h.why) bad(`${who}: 이유 문구 없음 (${P[h.i].name})`);
        }
        if (!hs.some((h) => P[h.i].won > 0)) bad(`${who}: 승자 없음`);
      } else if (alive.length !== 1) bad(`${who}: 노쇼다운인데 생존자 ${alive.length}명`);
    }
    // 이벤트 순서
    const ids = s.events.map((e) => e.id);
    for (let k = 1; k < ids.length; k++) if (ids[k] <= ids[k - 1]) bad(`${who}: 이벤트 id 순서 오류`);
    if (s.evSeq < this.prevEv) bad(`${who}: evSeq 가 줄어듦`);
    const fresh = s.events.filter((e) => e.id > this.prevEv);
    if (fresh.length && this.prevEv > 0 && fresh[0].id > this.prevEv + 1) { stats.eventGaps++; warn(`${this.name}: 이벤트 누락 구간 ${this.prevEv}→${fresh[0].id}`); }
    for (const e of fresh) if (e.k === 'emote') this.emotesSeen.add(e.id);
    this.prevEv = s.evSeq;
  }

  // ── 가상 플레이어의 판단 ──
  bot(s) {
    if (!this.active || s.ended) return;
    const me = s.players[s.me];
    if (!me) return;
    if (me.chips === 0 && ['showdown', 'waiting'].includes(s.phase)) {
      const k = `${s.handNo}`;
      if (this.rebuyKey !== k) { this.rebuyKey = k; if (me.rebuysLeft > 0) { stats.rebuys++; setTimeout(() => this.send({ t: 'rebuy' }), 200 + Math.random() * 600); } }
    }
    if (s.toAct !== s.me || !STREETS.includes(s.phase)) return;
    const key = `${s.handNo}|${s.phase}|${s.evSeq}|${s.toAct}`;
    if (key === this.acted) return;
    this.acted = key;
    setTimeout(() => this.decide(s), 120 + Math.random() * 380);
  }
  decide(s) {
    if (!this.active) return;
    const me = s.players[s.me], toCall = s.currentBet - me.bet, maxTo = me.bet + me.chips, r = Math.random();
    const call = toCall > 0 ? 'call' : 'check';
    if (maxTo <= s.currentBet) { this.send({ t: 'act', a: 'call' }); return; } // 칩이 모자라면 올인 콜만 가능 (화면에서도 레이즈 버튼이 안 보임)
    const raiseTo = (k) => Math.min(maxTo, s.currentBet + s.minRaise * k + Math.floor(Math.random() * 3) * s.bb);
    let m;
    switch (this.style) {
      case 'call': m = { a: call }; break;
      case 'tight': m = toCall > 0 && r < 0.45 ? { a: 'fold' } : r > 0.93 ? { a: 'raise', amount: raiseTo(2) } : { a: call }; break;
      case 'aggr': m = toCall > 0 && r < 0.05 ? { a: 'fold' } : r < 0.5 ? { a: call } : r < 0.96 ? { a: 'raise', amount: raiseTo(1 + Math.floor(Math.random() * 4)) } : { a: 'raise', amount: maxTo }; break;
      case 'nit': m = toCall > 0 && r < 0.8 ? { a: 'fold' } : { a: call }; break;
      case 'allin': m = r < 0.1 ? { a: 'raise', amount: maxTo } : { a: call }; break;
      default: m = toCall > 0 && r < 0.12 ? { a: 'fold' } : r < 0.78 ? { a: call } : { a: 'raise', amount: raiseTo(1 + Math.floor(Math.random() * 3)) };
    }
    if (m.a === 'fold') stats.folds++;
    this.send({ t: 'act', ...m });
  }
}

// ── 시나리오 진행 ──
const clients = [];
let host, room, TARGET_REACHED = false, endSent = false, lastProgress = Date.now(), lastSig = '';
const hand = { seen: new Set(), lastNo: 0, prevDealer: -1, lastLevel: 0, prevNextBlind: 0, levelTimes: [] };
const sent = { emotes: [], kick: null, pause: null };
const done = { kicked: false, paused: false, badEnd: false, actTurn: false, rebuyHas: false, joined: false, dropped: false, back: false, invalidSettings: false };
let dropper, late, outsider;
let dropBefore = null;

const hooks = {
  onState(c, s) {
    // 진행 정체 감시 (호스트 기준)
    if (c === host) {
      const sig = `${s.handNo}|${s.phase}|${s.toAct}|${s.evSeq}|${s.ended}`;
      if (sig !== lastSig) { lastSig = sig; lastProgress = Date.now(); }
      this.hostFlow(s);
    }
  },
  hostFlow(s) {
    const P = s.players;
    // 새 핸드: 딜러/블라인드 위치 검사
    if (s.handNo > hand.lastNo && STREETS.includes(s.phase) || (s.handNo > hand.lastNo && s.phase === 'showdown')) {
      const inHand = (p) => p.inHand;
      const cnt = P.filter(inHand).length;
      if (hand.lastNo !== s.handNo - 1 && hand.lastNo !== 0) bad(`핸드 번호가 건너뜀 ${hand.lastNo} → ${s.handNo}`);
      if (cnt < 2) bad(`핸드 ${s.handNo}: 참가자 ${cnt}명`);
      const expDealer = nextIn(P, hand.prevDealer, inHand);
      if (hand.prevDealer !== -1 && s.dealer !== expDealer) bad(`핸드 ${s.handNo}: 딜러가 순서대로 넘어가지 않음 (기대 ${expDealer}, 실제 ${s.dealer})`);
      if (!P[s.dealer] || !P[s.dealer].inHand) bad(`핸드 ${s.handNo}: 딜러가 핸드 참가자가 아님`);
      const sbExp = cnt === 2 ? s.dealer : nextIn(P, s.dealer, inHand);
      const bbExp = nextIn(P, sbExp, inHand);
      if (s.sbIdx !== sbExp || s.bbIdx !== bbExp) bad(`핸드 ${s.handNo}: SB/BB 위치 오류 (SB ${s.sbIdx}/${sbExp}, BB ${s.bbIdx}/${bbExp})`);
      hand.prevDealer = s.dealer; hand.lastNo = s.handNo;
      if (s.blindLevel > hand.lastLevel) {
        // 블라인드 인상은 설정한 주기 이후에만
        if (hand.prevNextBlind && s.serverNow + 1500 < hand.prevNextBlind) bad(`블라인드가 예정(${new Date(hand.prevNextBlind).toISOString()})보다 일찍 오름`);
        hand.levelTimes.push({ handNo: s.handNo, level: s.blindLevel, sb: s.sb, bb: s.bb, t: Math.round((Date.now() - T0) / 1000) });
        hand.lastLevel = s.blindLevel;
      }
      hand.prevNextBlind = s.nextBlindAt;
      log(`핸드 #${s.handNo} 시작 — 참가 ${cnt}명, 블라인드 ${s.sb}/${s.bb}, 딜러 ${P[s.dealer].name}`);
      this.scenario(s);
    }
    if (sent.kick && !sent.kick.checked) {
      const tgt = clients.find((x) => x.name === sent.kick.name);
      const stillThere = P.some((p) => p.name === sent.kick.name);
      if (tgt.removed && !sent.kick.removedMsg) { sent.kick.removedMsg = true; expectCheck('퇴장당한 사람에게 퇴장 알림 전달', true); }
      if (!stillThere) {
        sent.kick.checked = true;
        expectCheck('강제 퇴장 후 자리가 사라지고 인원이 줄어듦', P.length === sent.kick.before - 1, `${sent.kick.before} → ${P.length}`);
        expectCheck('퇴장자의 칩이 정산용 기록(departed)에 남음', (s.departed || []).some((d) => d.name.includes(sent.kick.name)), JSON.stringify(s.departed));
        log(`  ${sent.kick.name} 자리 삭제됨 (핸드 #${s.handNo}, 현재 ${P.length}명)`);
        // 같은 사람이 다시 들어오려 하면 거부되어야 한다
        const again = new Client(sent.kick.name, 'call'); again.token = sent.kick.tokenOf;
        again.connect(room).then(() => { expectCheck('퇴장당한 사람의 재입장 거부', false, '다시 들어왔음'); again.disconnect(); }, (e) => expectCheck('퇴장당한 사람의 재입장 거부', /강제 퇴장/.test(e.message), e.message));
      }
    }
    // 핸드 종료 기록
    if (s.phase === 'showdown' && s.results && !hand.seen.has(s.handNo)) {
      hand.seen.add(s.handNo);
      if (s.results.showdown) stats.showdowns++; else stats.uncontested++;
      if (s.results.pots.length > 1) stats.sidePotHands++;
      stats.allIns += s.events.filter((e) => e.k === 'bet' && e.kind === 'allin' && e.id > (hand.lastEvForCount || 0)).length;
      hand.lastEvForCount = s.evSeq;
      const winners = s.results.pots.flatMap((p) => p.winners.map((w) => P[w].name));
      log(`  결과 #${s.handNo}: ${s.results.showdown ? '쇼다운' : '전원 폴드'} · 승자 ${[...new Set(winners)].join(',')} · 팟 ${s.results.pots.map((p) => p.amount).join('+')}${s.results.pots.length > 1 ? ' (사이드팟)' : ''}`);
    }
    // 목표 핸드 수 도달 → 방장이 종료 요청
    if (MODE === 'host' && s.handNo >= TARGET && !endSent && !s.ended) {
      endSent = true;
      log(`목표 ${TARGET}판 도달 → 방장이 게임 종료 요청`);
      host.send({ t: 'end' });
    }
    if (sent.pause && !sent.pause.seen) {
      if (s.pauseAfterHand && !sent.pause.pending) { sent.pause.pending = true; sent.pause.handAtRequest = s.handNo; }
      if (s.paused) {
        sent.pause.seen = true; sent.pause.handAtPause = s.handNo; sent.pause.at = Date.now();
        expectCheck('핸드 도중 일시정지 요청은 그 핸드가 끝난 뒤 적용', s.handNo === sent.pause.handAtRequest && s.phase === 'showdown', `핸드 #${s.handNo} ${s.phase}`);
        log(`  일시정지 적용 (핸드 #${s.handNo} 종료 후) — 4초간 새 핸드가 시작되지 않아야 함`);
        setTimeout(() => {
          const st = host.state;
          expectCheck('일시정지 동안 새 핸드가 시작되지 않음', st.paused && st.handNo === sent.pause.handAtPause && st.phase === 'showdown', `paused=${st.paused} 핸드 #${st.handNo} ${st.phase}`);
          log('  방장이 계속하기');
          host.send({ t: 'resume' });
        }, 4000);
      }
    }
    if (sent.pause && sent.pause.seen && !sent.pause.resumed && !s.paused) {
      sent.pause.resumed = true;
      setTimeout(() => expectCheck('계속하기 뒤에 새 핸드가 다시 시작됨', host.state.handNo > sent.pause.handAtPause, `핸드 #${host.state.handNo}`), 6000);
    }
    if (s.endAfterHand && !checks['방장 종료 예약 반영']) expectCheck('방장 종료 예약 반영', true);
  },
  scenario(s) {
    const n = s.handNo;
    if (n === 2 && !done.badEnd) { // 방장이 아닌 사람의 종료 시도
      done.badEnd = true; const before = outsider.errors.length; outsider.send({ t: 'end' });
      setTimeout(() => expectCheck('방장이 아닌 사람의 종료 거부', outsider.errors.slice(before).some((e) => /방장/.test(e)), outsider.errors.slice(before).join('|')), 1500);
    }
    if (n === 2 && !done.actTurn) { // 내 차례가 아닐 때 행동 시도
      done.actTurn = true;
      const c = clients.find((x) => x.state && x.state.toAct !== x.state.me && x !== host) || outsider; const before = c.errors.length;
      c.send({ t: 'act', a: 'check' });
      setTimeout(() => expectCheck('내 차례가 아닐 때 행동 거부', c.errors.slice(before).some((e) => /차례/.test(e)), c.errors.slice(before).join('|')), 1500);
    }
    if (n === 3 && !done.rebuyHas) { // 칩이 남았는데 리바인 시도
      done.rebuyHas = true; const c = clients.find((x) => x.state && x.state.players[x.state.me].chips > 0 && x !== host) || outsider; const before = c.errors.length;
      c.send({ t: 'rebuy' });
      setTimeout(() => expectCheck('칩이 남았을 때 리바인 거부', c.errors.slice(before).some((e) => /칩이 남/.test(e)), c.errors.slice(before).join('|')), 1500);
    }
    if (n === 4 && !done.joined) { // 도중 입장
      done.joined = true;
      late = new Client('늦참', 'random');
      late.connect(room).then(() => {
        clients.push(late);
        const me = late.state.players[late.state.me];
        expectCheck('도중 입장 — 시작 칩과 바이인 1회', me.chips === SETTINGS.chips && me.buyIns === 1, `칩 ${me.chips}, 바이인 ${me.buyIns}`);
        log('  늦참 플레이어 입장');
      }).catch((e) => bad('도중 입장 실패: ' + e.message));
    }
    if ([3, 5, 7, 9].includes(n) && !done['emote' + n]) { // 감정표현: 차례와 상관없이 사용, 모두에게 전달
      done['emote' + n] = true;
      const kinds = ['angry', 'thanks', 'sad', 'hurry'];
      const c = clients.filter((x) => x.active && x.ws && x.ws.readyState === 1 && x.state && x.state.players[x.state.me])[n % 3];
      if (c) { const k = kinds[(n / 2 | 0) % 4]; const before = c.errors.length; c.send({ t: 'emote', k }); setTimeout(() => { sent.emotes.push({ by: c.name, k, err: c.errors.slice(before).join('|') }); }, 600); }
    }
    if (n === 10 && !done.kicked) { // 방장이 플레이어 한 명을 강제 퇴장
      done.kicked = true;
      const tgt = clients.find((x) => x.name === '올인러');
      const idx = host.state.players.findIndex((p) => p.name === tgt.name);
      sent.kick = { name: tgt.name, handNo: n, tokenOf: tgt.token, before: host.state.players.length };
      log(`  방장이 ${tgt.name} 님을 강제 퇴장 요청`);
      host.send({ t: 'kick', i: idx, name: tgt.name });
    }
    if (n === 12 && !done.paused) { // 핸드 진행 중 일시정지 요청 → 이번 핸드가 끝난 뒤 멈춰야 한다
      done.paused = true;
      sent.pause = { handNo: n, requestedAt: Date.now(), state: null };
      log('  방장이 일시정지 요청 (핸드 진행 중)');
      host.send({ t: 'pause' });
    }
    if (n === 6 && !done.dropped) { // 연결 끊김
      done.dropped = true; dropBefore = { chips: dropper.state.players[dropper.state.me].chips, buyIns: dropper.state.players[dropper.state.me].buyIns, handNo: s.handNo };
      log('  플레이어 연결 끊김 (재접속 예정)');
      dropper.disconnect();
    }
    if (n === 8 && !done.back) { // 재접속
      done.back = true; dropper.active = true;
      dropper.connect(room).then(() => {
        const me = dropper.state.players[dropper.state.me];
        expectCheck('재접속 — 같은 자리·같은 바이인 횟수 복구', me.name === dropper.name && me.connected && me.buyIns >= dropBefore.buyIns, `이름 ${me.name}, 연결 ${me.connected}`);
        log('  연결 끊겼던 플레이어 재접속 완료');
      }).catch((e) => bad('재접속 실패: ' + e.message));
    }
  },
};

// ── 최종 검증 ──
function verifyFinal() {
  const finals = clients.filter((c) => c.state && c.state.ended);
  expectCheck('모든 접속자에게 게임 종료 전달', finals.length === clients.filter((c) => c.ws && c.ws.readyState === 1).length, `${finals.length}/${clients.length}`);
  const s = host.state;
  expectCheck('게임 종료 상태', s.ended && s.phase === 'ended' && s.settlement && !s.settlement.error, s.settlement && s.settlement.error);
  if (MODE === 'host') {
    expectCheck(`정확히 ${TARGET}판 진행 후 종료`, hand.seen.size === TARGET && s.handNo === TARGET, `기록된 핸드 ${hand.seen.size}, 마지막 핸드 #${s.handNo}`);
    expectCheck('종료 사유 = 방장', s.settlement.reason === 'host', s.settlement.reason);
  } else {
    const withChips = s.players.filter((p) => p.chips > 0);
    expectCheck('종료 사유 = 1등 확정(자동 종료)', s.settlement.reason === 'winner', s.settlement.reason);
    expectCheck('칩이 남은 사람이 정확히 1명', withChips.length === 1, `${withChips.length}명`);
    expectCheck('나머지는 모두 탈락(칩 0·리바인 소진)', s.players.every((p) => p.chips > 0 || (p.chips === 0 && p.rebuysLeft === 0)));
    expectCheck('1등이 가장 높은 순위·흑자', s.settlement.rows[0].rank === 1 && s.settlement.rows[0].net > 0 && s.settlement.rows[0].chips === withChips[0].chips);
    expectCheck('자동 종료 때 모든 탈락자의 리바인 횟수가 한도까지 사용됨', s.players.every((p) => p.chips > 0 || p.buyIns === SETTINGS.maxRebuys + 1), JSON.stringify(s.players.map((p) => [p.name, p.buyIns])));
  }
  const st = s.settlement, P = s.players;
  // 독립 계산
  const dep = s.departed || [];
  const allP = [...P, ...dep];
  const rowsIn = allP.map((p, i) => ({ i, name: p.name, buyIns: p.buyIns, chips: p.chips }));
  const sumNetChips = rowsIn.reduce((x, r) => x + r.chips - r.buyIns * s.startChips, 0);
  expectCheck('최종 칩 총합 = 바이인 총합 (칩이 새거나 생기지 않음)', sumNetChips === 0, `차이 ${sumNetChips}`);
  expectCheck('정산 합계 0원', st.rows.reduce((x, r) => x + r.net, 0) === 0);
  const bal = new Map(st.rows.map((r) => [r.i, r.net]));
  for (const t of st.transfers) { bal.set(t.from, bal.get(t.from) + t.amount); bal.set(t.to, bal.get(t.to) - t.amount); }
  expectCheck('송금을 모두 적용하면 모든 사람 잔액 0원', [...bal.values()].every((v) => v === 0), JSON.stringify([...bal]));
  expectCheck(`송금 건수 ≤ 정산 대상 인원−1 (${st.transfers.length}건 / ${st.rows.length}명)`, st.transfers.length <= st.rows.length - 1);
  let rowOk = true, detail = '';
  for (const r of st.rows) {
    const p = allP[r.i], exactNet = ((p.chips - p.buyIns * s.startChips) * s.buyIn) / s.startChips;
    if (r.chips !== p.chips || r.buyIns !== p.buyIns || r.invested !== p.buyIns * s.buyIn) { rowOk = false; detail += ` ${r.name}:값불일치`; }
    if (Math.abs(r.net - exactNet) >= 1) { rowOk = false; detail += ` ${r.name}:오차${(r.net - exactNet).toFixed(2)}`; }
  }
  expectCheck('플레이어별 손익 = 칩 손익 × 단가 (오차 1원 미만)', rowOk, detail);
  const ranked = st.rows.every((r, k) => k === 0 || st.rows[k - 1].chips >= r.chips);
  expectCheck('순위가 최종 칩 순서', ranked);
  const sig = JSON.stringify(st);
  expectCheck('모든 접속자가 똑같은 정산 결과를 받음', finals.every((c) => JSON.stringify(c.state.settlement) === sig), `${finals.length}명 비교`);
  if (done.joined) expectCheck('도중 입장자가 정산에 포함', st.rows.some((r) => r.name === '늦참'));
  expectCheck('연결이 끊겼던 사람도 정산에 포함', st.rows.some((r) => r.name === dropper.name));
  expectCheck('강제 퇴장자가 정산에 포함 (칩 그대로)', st.rows.some((r) => r.name.includes('올인러') && /퇴장/.test(r.name)));
  const emoOk = sent.emotes.length >= 3 && sent.emotes.every((e) => !e.err);
  expectCheck('감정표현 사용 성공 (차례 아닐 때도)', emoOk, JSON.stringify(sent.emotes));
  const steady = clients.filter((c) => ['방장', '콜러', '공격수'].includes(c.name)); // 처음부터 끝까지 접속해 있던 사람들
  const sizes = steady.map((c) => c.emotesSeen.size);
  expectCheck('감정표현이 접속한 모든 사람에게 똑같이 전달', sizes.every((n) => n === sizes[0]) && sizes[0] >= 3, `사람별 수신 ${JSON.stringify(steady.map((c) => [c.name, c.emotesSeen.size]))}`);
  expectCheck('종료 후 행동 거부', true);
  return st;
}

async function main() {
  log(`시험 시작: ${URL} · 목표 ${TARGET}판 · 설정 ${JSON.stringify(SETTINGS)}`);
  // 잘못된 설정은 방이 만들어지지 않아야 한다
  {
    const c = new Client('설정오류', 'call');
    const err = await c.connect('', { ...SETTINGS, bb: 5000, sb: 25 }).then(() => null, (e) => e.message);
    expectCheck('잘못된 설정(칩 < BB×10)이면 방 생성 거부', !!err, err || '방이 만들어짐');
    c.disconnect();
  }
  host = new Client('방장', 'random');
  clients.push(host);
  room = await host.connect('', SETTINGS);
  log(`방 생성 ${room}`);
  for (const [n, st] of STYLES) { const c = new Client(n, st); clients.push(c); await c.connect(room); }
  outsider = clients.find((c) => c.name === '콜러');
  dropper = clients.find((c) => c.name === '소심');
  expectCheck('시작 전 종료 요청 거부', await new Promise((res) => { const b = host.errors.length; host.send({ t: 'end' }); setTimeout(() => res(host.errors.slice(b).some((e) => /시작하기 전|시작 전/.test(e))), 800); }));
  log(`참가자 ${host.state.players.length}명 입장 → 게임 시작`);
  host.send({ t: 'start' });

  // 종료까지 대기
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      if (host.state && host.state.ended) { clearInterval(iv); setTimeout(resolve, 1500); }
      else if (Date.now() - lastProgress > STALL_MS) { clearInterval(iv); bad(`진행이 ${STALL_MS / 1000}초 동안 멈춤 — 마지막 상태 핸드 #${host.state.handNo} ${host.state.phase} toAct=${host.state.toAct}`); resolve(); }
      else if (Date.now() - T0 > 40 * 60000) { clearInterval(iv); bad('시험 시간 초과'); resolve(); }
    }, 500);
  });

  let st = null;
  if (host.state && host.state.ended) st = verifyFinal();
  // 종료 후 행동/리바인 거부
  {
    const b = host.errors.length; host.send({ t: 'act', a: 'check' }); host.send({ t: 'rebuy' });
    await new Promise((r) => setTimeout(r, 800));
    const errs = host.errors.slice(b);
    expectCheck('종료 후 행동·리바인 거부', errs.length >= 2 && errs.every((e) => /끝났|종료/.test(e)), errs.join('|'));
  }
  report(st);
  clients.forEach((c) => c.disconnect());
  process.exit(violations.length ? 1 : 0);
}

function report(st) {
  console.log('\n══════════ 시험 결과 ══════════');
  console.log(`소요 시간 ${((Date.now() - T0) / 60000).toFixed(1)}분 · 수신 상태 ${stats.states}건 검사`);
  console.log(`진행 ${hand.seen.size}판 — 쇼다운 ${stats.showdowns} / 전원 폴드 ${stats.uncontested} / 사이드 팟 발생 ${stats.sidePotHands}판 / 올인 ${stats.allIns}회 / 리바인 ${stats.rebuys}회 / 최대 동시 참가 ${stats.maxPlayers}명`);
  console.log(`블라인드 단계: ${hand.levelTimes.map((l) => `핸드#${l.handNo}→${l.sb}/${l.bb}(${l.t}초)`).join(', ') || '오르지 않음'}`);
  console.log('\n[기능 검사]');
  for (const [k, v] of Object.entries(checks)) console.log(` ${v.ok ? '✅' : '❌'} ${k}${v.ok ? '' : ' — ' + (v.detail || '')}`);
  if (st) {
    console.log('\n[정산]');
    st.rows.forEach((r) => console.log(` ${String(r.rank).padStart(2)}위 ${r.name.padEnd(5)} 바이인 ${r.buyIns}회 투입 ${String(r.invested).padStart(7)}원 · 최종칩 ${String(r.chips).padStart(6)} → ${String(r.value).padStart(7)}원 · 손익 ${(r.net >= 0 ? '+' : '') + r.net}원`));
    st.transfers.forEach((t) => console.log(`   송금 ${t.fromName} → ${t.toName} ${t.amount}원`));
  }
  const intended = /방장|차례|칩이 남|시작하기 전|시작 전|끝났|종료|바이인|칩은|블라인드|리바인 횟수/;
  const rejected = clients.flatMap((c) => c.errors.map((e, i) => `${c.name}(${c.style}) ${(c.errAt || [])[i] || ''}: ${e}`)).filter((e) => !intended.test(e));
  console.log(`\n[서버가 거부한 가상 플레이어 행동 — 의도한 시험 외] ${rejected.length}건`);
  rejected.slice(0, 15).forEach((e) => console.log(' ·', e));
  if (warnings.length) { console.log('\n[참고]'); warnings.forEach((w) => console.log(' ·', w)); }
  console.log(`\n[규칙 위반] ${violations.length}건`);
  violations.forEach((v) => console.log(' ✗', v));
  console.log(violations.length ? '\n결과: ❌ 문제 발견' : '\n결과: ✅ 모든 검사 통과');
}

main().catch((e) => { console.error('시험 프로그램 오류', e); process.exit(2); });
