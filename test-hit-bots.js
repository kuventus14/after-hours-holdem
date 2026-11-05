// 봇의 합의금·때리기 시험: node test-hit-bots.js   (환경변수 HANDS=핸드 수 배율, 예: HANDS=0.2 이면 빠르게 훑기 / WORKERS=작업 프로세스 수, 기본 4)
// 연습 테이블(빠른 모드)을 엔진 Table 로 직접 돌린다 (server 는 쓰지 않음). server.js 처럼 onChange 에서 bot.tick 을 부른다.
//  1부: 규칙 단위 시험 (합의금 확률·칩 가드·핸드당 한 번·쿨다운·실행 직전 재확인·방/봇이 사라진 경우)
//  2부: 사람 1명(항상 call/check)과 봇 4~9명이 수천 핸드 → ① 봇이 때림 ② 봇이 합의금 ③ 봇이 기절 ④ 쿨다운 H,H+1,H+2 불가 ⑤ 칩 합계 보존 ⑥ 교착·예외 없음
const { Table, HIT_COST, STUN_PAY, HIT_COOLDOWN } = require('./engine');
const bot = require('./bot');
const cp = require('child_process');

// 화면 연출 대기는 시험에서 건너뛴다 (test-practice.js 와 같은 방식). 때리기 연출 11초(hitUntil)는 rig 의 onChange 에서 건너뛴다
const emit0 = Table.prototype.emit;
Table.prototype.emit = function (ev) { emit0.call(this, ev); this.anim = 0; this.animUntil = 0; };

let errCount = 0; // 봇이 console.error 로 남긴 오류 (판단/때리기/합의금 오류)
const err0 = console.error; console.error = (...a) => { errCount++; err0(...a); };
process.on('uncaughtException', (e) => { err0('실패(잡히지 않은 예외):', e); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => ok(a === b, `${m}: ${a} != ${b}`);
const until = async (f, what, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('시간 초과: ' + what); await sleep(5); } };
const setAll = (o, v) => { for (const k of Object.keys(o)) o[k] = v; };
const saved = JSON.stringify([bot.HIT_P, bot.PAY_P, bot.HIT_ADD, bot.HIT_RULE]);
const resetCfg = () => JSON.parse(saved).forEach((o, k) => Object.assign([bot.HIT_P, bot.PAY_P, bot.HIT_ADD, bot.HIT_RULE][k], o));

// 사람 1명('나', 방장, 항상 call/check) + 봇 nBots 명짜리 연습 테이블. 원장(L)에 때리기/합의금을 기록하고, 상태가 바뀔 때마다 불변식을 본다
function rig(nBots, o = {}) {
  const t = new Table({ auto: o.auto !== false, pace: false, nextHandMs: 150, showdownExtraMs: 0, absentMs: 300 });
  t.practice = true;
  t.applySettings({ sb: 10, bb: 20, chips: 10000, buyIn: 10000, blindMinutes: 0, maxRebuys: 99 });
  t.addPlayer('human', '나');
  for (let k = 0; k < nBots; k++) t.pushBot();
  const L = t.L = { hits: [], pays: [], hitErr: [], payErr: [], bad: [], hands: 0, stunBots: 0, stunHuman: 0, at: Date.now(), last: 0 };
  const bad = (m) => { if (L.bad.length < 5) L.bad.push(`핸드 ${t.handNo}: ${m}`); };
  const h = t.players[0], supply = () => t.players.reduce((s, p) => s + p.buyIns, 0) * t.startChips;
  t.hit = (tok, idx) => { // 엔진의 hit 을 감싸 기록한다
    const r = Table.prototype.hit.call(t, tok, idx), i = t.find(tok);
    if (r === null) {
      const prev = L.hits[L.hits.length - 1];
      if (prev && !(t.handNo - prev.hand >= HIT_COOLDOWN)) bad(`쿨다운 위반: 핸드 ${prev.hand} 에 때린 뒤 핸드 ${t.handNo} 에 또 때림`);
      L.hits.push({ hand: t.handNo, i, to: idx, byBot: !!t.players[i].bot, toBot: !!t.players[idx].bot, by: t.players[i].token, victim: t.players[idx].token });
    } else if (t.players[i] && t.players[i].bot) L.hitErr.push(r); // 봇은 hitCheck 를 통과한 것만 때리므로 거절이 나오면 안 된다
    return r;
  };
  t.payStun = (tok) => {
    const i = t.find(tok), c = t.players[i].chips, r = Table.prototype.payStun.call(t, tok);
    if (r === null) L.pays.push({ hand: t.handNo, i, byBot: !!t.players[i].bot, chipsBefore: c, paid: t.players[i].chips === c - STUN_PAY });
    else if (t.players[i].bot) L.payErr.push(r);
    return r;
  };
  t.onChange = () => {
    t.hitUntil = 0;
    if (o.check !== false) {
      if (t.players.reduce((s, p) => s + p.chips, 0) + (t.inProgress() ? t.pot : 0) !== supply()) bad('칩 합계가 어긋남');
      for (const p of t.players) {
        if (!Number.isInteger(p.chips) || p.chips < 0) bad(`칩 이상: ${p.name} ${p.chips}`);
        if (p.inHand && !p.folded && p.chips === 0 && !p.allIn) bad(`칩 0인데 올인 표시 없음: ${p.name}`);
        if (p.stun === 'out' && (p.inHand || p.hole.length || p.bet || p.total || p.lastAction !== '기절')) bad(`기절한 ${p.name} 가 패/블라인드를 가짐`);
        if (p.stun === 'pending' && !t.players.some((q) => q.token === p.stunBy)) bad(`기절 예고인데 때린 사람이 없음: ${p.name}`);
      }
      if (t.handNo !== L.hand) { // 새 핸드가 시작된 첫 상태
        L.hand = t.handNo; L.hands++; L.last = Date.now();
        L.stunBots += t.players.filter((p) => p.bot && p.stun === 'out').length; L.stunHuman += t.players.filter((p) => !p.bot && p.stun === 'out').length;
      }
    }
    if (o.until && o.until(t)) return o.done(t);
    bot.tick(t);
    if (o.afterTick) o.afterTick(t);
    human(t, h, o);
  };
  return t;
}

// 사람 쪽: 차례가 오면 call/check, 칩이 떨어지면 리바인, 맞으면 절반쯤은 합의금을 낸다. 별도 턴(setImmediate)에서 움직여 서버로 오는 메시지처럼 한다
function human(t, h, o) {
  if (o.human === false) return;
  if (t.inProgress() && t.toAct === 0) {
    const k = `${t.handNo}|${t.phase}|${t.currentBet}|${t.evSeq}`;
    if (t._hk !== k) { t._hk = k; setImmediate(() => { if (!t.ended && t.inProgress() && t.toAct === 0) t.act(h.token, t.currentBet > h.bet ? 'call' : 'check'); }); }
  }
  if (!t.inProgress() && h.chips === 0 && t.rebuysLeft(h) > 0 && !t._hr) t._hr = setImmediate(() => { t._hr = null; if (!t.ended && !t.rebuy(h.token)) t.onChange(); });
  if (h.stun === 'pending' && t._hp !== t.hitSeq) { t._hp = t.hitSeq; if (Math.random() < 0.5) setImmediate(() => { if (!t.ended) t.payStun(h.token); }); }
}

// ───────── 1부: 규칙 단위 시험 ─────────
async function units() {
  // 합의금: 사람이 봇을 때리면 봇이 (확률 1이면) 낸다 · 말풍선은 곁들이기라 2.5초 쿨다운에 걸려도 오류 없이 합의금은 낸다
  {
    resetCfg(); setAll(bot.HIT_P, 0); setAll(bot.HIT_ADD, 0); setAll(bot.PAY_P, 1); bot.HIT_RULE.emote = 1;
    const t = rig(3, { auto: false, human: false }); t.startHand();
    eq(t.hit('human', 1), null, '사람이 봇을 때림'); eq(t.players[1].stun, 'pending', '봇 기절 예고');
    await until(() => t.L.pays.length, '봇이 합의금을 냄');
    const p = t.L.pays[0]; ok(p.byBot && p.paid && p.i === 1, `봇 합의금 기록: ${JSON.stringify(p)}`); eq(t.players[1].stun, '', '기절 풀림');
    ok(t.events.some((e) => e.k === 'pay' && e.i === 1 && e.to === 0 && e.amt === STUN_PAY), 'pay 이벤트');
    const say = t.events.filter((e) => e.k === 'emote' && e.i === 1); ok(say.length === 1 && ['아야!', '으악!', '아얏!'].includes(say[0].text), `맞은 말풍선 하나만: ${JSON.stringify(say)}`);
    eq(errCount, 0, '오류 없음'); eq(t.L.bad.length, 0, `불변식 ${t.L.bad}`); t.destroy();
  }
  // 합의금 가드: 맞은 뒤 칩이 1500 + 2*bb 보다 클 때만 (경계: 딱 1540 이면 안 내고 1541 이면 낸다) · 확률 0 이면 안 냄
  {
    resetCfg(); setAll(bot.HIT_P, 0); setAll(bot.HIT_ADD, 0); setAll(bot.PAY_P, 1); bot.HIT_RULE.emote = 0;
    for (const [chips, pays] of [[STUN_PAY + 40, false], [STUN_PAY + 41, true]]) {
      const t = rig(3, { auto: false, human: false, check: false }); t.startHand();
      t.players[1].chips = chips - HIT_COST; t.hit('human', 1); // 맞으면 +1,000 이 먼저 들어오니 맞은 뒤 칩이 경계값이 되게 맞춘다
      await sleep(80); eq(t.players[1].stun, pays ? '' : 'pending', `칩 ${chips} 일 때 합의금 ${pays ? '냄' : '안 냄'}`); t.destroy();
    }
    setAll(bot.PAY_P, 0);
    const t = rig(3, { auto: false, human: false }); t.startHand(); t.hit('human', 1);
    await sleep(80); eq(t.players[1].stun, 'pending', '확률 0 이면 안 냄'); eq(t.L.pays.length, 0, '합의금 기록 없음'); t.destroy();
  }
  // 핸드당 한 번 · 쿨다운 H,H+1,H+2 불가 · H+3 부터 다시 · 때린 사람은 봇, 대상은 hitCheck 통과자 (확률을 1로 올려 놓고 핸드를 이어 붙인다)
  {
    resetCfg(); setAll(bot.HIT_P, 1); setAll(bot.PAY_P, 0); bot.HIT_RULE.max = 1; bot.HIT_RULE.scale = 1; bot.HIT_RULE.emote = 0;
    const t = rig(3, { auto: false }), L = t.L; t.startHand();
    const showdown = async (n) => { await until(() => t.handNo === n && t.phase === 'showdown', `핸드 ${n} 끝`, 20000); await sleep(60); };
    await showdown(1);
    eq(t.hitSeq, 1, '핸드 1 에서 한 번 때림'); eq(L.hits.length, 1, '기록 한 건'); ok(L.hits[0].byBot, '봇이 때림'); eq(L.hits[0].hand, 1, '핸드 1');
    const timer = t._botHitT; for (let k = 0; k < 5; k++) bot.tick(t); eq(t._botHitT, timer, '같은 핸드에서 tick 을 또 불러도 다시 굴리지 않음');
    for (const n of [2, 3]) { t.startHand(); await showdown(n); eq(t.hitSeq, 1, `핸드 ${n} 은 쿨다운이라 못 때림`); }
    t.startHand(); await showdown(4); eq(t.hitSeq, 2, '핸드 4(=H+3) 에는 다시 때림'); eq(L.hits[1].hand, 4, '두 번째는 핸드 4');
    eq(L.hitErr.length, 0, `봇은 거절당할 일을 하지 않음: ${L.hitErr}`); eq(L.bad.length, 0, `불변식 ${L.bad}`); eq(errCount, 0, '오류 없음'); t.destroy();
  }
  // 실행 직전 재확인: 예약한 뒤 스위치가 꺼지면 때리지 않는다 / 예약한 뒤 방이 지워지면 때리지도 합의금을 내지도 않고 오류도 없다
  {
    resetCfg(); setAll(bot.HIT_P, 1); setAll(bot.PAY_P, 1); bot.HIT_RULE.max = 1; bot.HIT_RULE.scale = 1; bot.HIT_RULE.emote = 0;
    const a = rig(3, { afterTick: (t) => { if (t._botHitT && t.hitOn) t.hitOn = false; } }); a.startHand();
    await until(() => a.phase === 'showdown', '스위치 시험 핸드 끝', 20000); await sleep(80);
    eq(a.hitSeq, 0, '스위치가 꺼지면 예약해 둔 때리기도 취소'); eq(a._botHitT, null, '타이머는 실행되고 비워짐'); a.destroy();
    const b = rig(3, { afterTick: (t) => { if (t._botHitT && !t.ended) t.destroy(); } }); b.startHand();
    await until(() => b.ended, '방 삭제', 20000); await sleep(80); eq(b.hitSeq, 0, '방이 지워지면 예약해 둔 때리기도 안 함');
    const c = rig(3, { auto: false, human: false }); c.startHand(); c.hit('human', 1); c.destroy();
    await sleep(80); eq(c.players[1].stun, 'pending', '방이 지워지면 합의금도 안 냄');
    const d = rig(3, { auto: false, human: false, check: false }); d.startHand(); d.hit('human', 1); d.removeAt(1);
    await sleep(80); eq(d.players.length, 3, '맞은 봇이 사라진 뒤에도 예외 없이 넘어감'); d.destroy();
    eq(errCount, 0, '오류 없음');
  }
  // 대기 시간: 일반 모드는 사람처럼 때리기 1.2~4.0초 · 합의금 1.5~4.5초, 빠른 모드는 5ms (setTimeout 에 넘기는 값을 가로채서 본다)
  {
    resetCfg(); setAll(bot.HIT_P, 1); bot.HIT_RULE.max = 1; bot.HIT_RULE.scale = 1; bot.HIT_RULE.emote = 0;
    const real = global.setTimeout, seen = [], delays = (pace, setup) => {
      const t = rig(3, { auto: false, human: false, check: false }); t.opts.pace = pace; t.startHand(); clearTimeout(t._botT);
      const out = []; global.setTimeout = (f, ms, ...r) => (seen.push(ms), real(f, ms, ...r));
      try { for (let k = 0; k < 40; k++) { seen.length = 0; setup(t, k); ok(seen.length === 1, `타이머가 하나만 걸려야 함: ${seen}`); out.push(seen[0]); } } finally { global.setTimeout = real; }
      t.destroy(); return out;
    };
    const hitWait = (t, k) => { t.phase = 'showdown'; t.handNo = 10 + k; bot.tick(t); clearTimeout(t._botHitT); }; // 핸드가 끝난 순간을 흉내 낸다 (핸드 번호를 바꿔 매번 새로 굴리게)
    const payWait = (t) => { const p = t.players[1]; p.stun = 'pending'; p.stunBy = 'human'; t.hitSeq++; bot.tick(t); clearTimeout(p._payT); p.stun = ''; };
    const lo = (a) => Math.min(...a), hi = (a) => Math.max(...a);
    let a = delays(true, hitWait); ok(lo(a) >= 1200 && hi(a) <= 4000 && hi(a) - lo(a) > 800, `일반 모드 때리기 대기 ${lo(a)}~${hi(a)}`);
    let b = delays(true, payWait); ok(lo(b) >= 1500 && hi(b) <= 4500 && hi(b) - lo(b) > 800, `일반 모드 합의금 대기 ${lo(b)}~${hi(b)}`);
    a = delays(false, hitWait); b = delays(false, payWait); ok([...a, ...b].every((ms) => ms === 5), '빠른 모드는 5ms');
  }
  // 연습 테이블이 아니면 봇 로직은 아무것도 하지 않는다
  {
    resetCfg(); setAll(bot.PAY_P, 1);
    const t = rig(3, { auto: false, human: false }); t.practice = false; t.startHand(); t.hit('human', 1);
    await sleep(80); eq(t.players[1].stun, 'pending', '연습이 아니면 봇이 합의금을 내지 않음'); eq(t.L.pays.length, 0, '기록 없음'); t.destroy();
  }
  resetCfg();
  console.log('단위 시험 OK (합의금 확률·칩 경계 · 핸드당 한 번 · 쿨다운 H+3 · 실행 직전 재확인 · 방/봇 사라짐 · 대기 시간 · 연습 아님)');
}

// ───────── 2부: 수천 핸드 ─────────
// 봇 판단(몬테카를로 승률)이 CPU 를 많이 써서 한 프로세스로는 느리다 → 작업 프로세스 여럿(WORKERS, 기본 4)에 테이블을 나눠 돌린다.
// 작업 프로세스는 같은 파일을 --worker 로 다시 실행해, 맡은 테이블을 동시에 돌리고 원장 요약을 돌려준다
function runTables(specs) {
  const tables = specs.map(({ n, hands }) => rig(n, { until: (t) => t.handNo >= hands && t.phase === 'showdown', done: (t) => { t.destroy(); t.fin(t); } }));
  return new Promise((res) => {
    let left = tables.length;
    tables.forEach((t) => { t.fin = () => { if (!--left) { clearInterval(dog); res(tables.map((x, i) => ({ n: specs[i].n, bb: x.bb, L: x.L }))); } }; });
    const dog = setInterval(() => { // 교착 감시: 30초 동안 새 핸드가 안 시작되면 실패
      for (const t of tables) if (!t.ended && Date.now() - Math.max(t.L.last, t.L.at) > 30000) { err0(`실패: 교착 (핸드 ${t.handNo}, phase ${t.phase}, toAct ${t.toAct})`); process.exit(1); }
    }, 500);
    tables.forEach((t) => t.startHand());
  });
}

async function stress() {
  resetCfg();
  const k = +process.env.HANDS || 1;
  // [봇 수, 테이블 수, 테이블당 핸드]: 기본 설정(봇 4명)이 가장 많다. 무거운 테이블(봇 많은 쪽)부터 나눠야 작업 프로세스끼리 고르게 나뉜다
  const plan = [[9, 3, Math.round(150 * k)], [6, 2, Math.round(250 * k)], [4, 8, Math.round(300 * k)]];
  const specs = plan.flatMap(([n, c, hands]) => Array.from({ length: c }, () => ({ n, hands })));
  const W = Math.min(+process.env.WORKERS || 4, specs.length), buckets = Array.from({ length: W }, () => []);
  specs.forEach((sp, i) => buckets[i % W].push(sp));
  const t0 = Date.now();
  const outs = await Promise.all(buckets.map((b) => new Promise((res, rej) => {
    const c = cp.fork(__filename, ['--worker'], { env: { ...process.env, PLAN: JSON.stringify(b) } });
    c.on('message', res);
    c.on('exit', (code) => rej(new Error(`작업 프로세스가 끝나기 전에 종료됨 (코드 ${code})`)));
  })));
  const secs = ((Date.now() - t0) / 1000).toFixed(1), rows = outs.flatMap((o) => o.rows);
  eq(outs.reduce((s, o) => s + o.errCount, 0), 0, '⑥ 봇 오류 로그가 없어야 함');

  const tot = { hands: 0, botHits: 0, humanHit: 0, botPays: 0, botPaid: 0, botStun: 0, humanStun: 0, revenge: 0 }, rate = {};
  for (const [n] of plan) {
    const s = { hands: 0, botHits: 0, humanHit: 0, botPays: 0, botPaid: 0, botStun: 0, humanStun: 0, revenge: 0 }, g = rows.filter((r) => r.n === n);
    for (const { L, bb } of g) {
      eq(L.bad.length, 0, `불변식 위반 (봇 ${n}명): ${L.bad.join(' / ')}`);
      eq(L.hitErr.length, 0, `봇이 거절당함: ${L.hitErr.slice(0, 3)}`); eq(L.payErr.length, 0, `봇 합의금이 거절당함: ${L.payErr.slice(0, 3)}`);
      for (let i = 1; i < L.hits.length; i++) ok(L.hits[i].hand - L.hits[i - 1].hand >= HIT_COOLDOWN, `④ 쿨다운 위반 ${L.hits[i - 1].hand} → ${L.hits[i].hand}`);
      ok(L.pays.filter((p) => p.byBot).every((p) => p.chipsBefore > STUN_PAY + 2 * bb), '봇이 칩 가드 아래에서 합의금을 냄');
      s.hands += L.hands; s.botHits += L.hits.filter((x) => x.byBot).length; s.humanHit += L.hits.filter((x) => x.byBot && !x.toBot).length;
      s.botPays += L.pays.filter((p) => p.byBot && p.paid).length; s.botPaid += L.hits.filter((x) => x.toBot).length; s.botStun += L.stunBots; s.humanStun += L.stunHuman;
      L.hits.forEach((x, i) => { if (x.byBot && L.hits.slice(0, i).some((y) => y.hand >= x.hand - 6 && y.victim === x.by && y.by === x.victim)) s.revenge++; }); // 최근 자기를 때린 사람을 때림
    }
    rate[n] = s.botHits / s.hands * 100;
    for (const key of Object.keys(tot)) tot[key] += s[key];
    console.log(`  봇 ${n}명 x ${g.length}판: 핸드 ${s.hands} · 봇이 때림 ${s.botHits} (100핸드당 ${rate[n].toFixed(1)}) · 그중 사람이 맞음 ${s.humanHit} · 봇이 맞음 ${s.botPaid} → 봇 합의금 ${s.botPays} · 봇 기절 핸드 ${s.botStun} · 사람 기절 핸드 ${s.humanStun} · 복수 ${s.revenge}`);
  }
  ok(rate[4] >= 3 && rate[4] <= 16, `기본 설정(봇 4명) 100핸드당 봇 때리기 ${rate[4].toFixed(1)} 가 3~16 범위를 벗어남 → bot.js 의 HIT 상수를 조정`);
  for (const n of Object.keys(rate)) ok(rate[n] <= 100 / HIT_COOLDOWN, `쿨다운 상한(100핸드당 ${(100 / HIT_COOLDOWN).toFixed(0)}회) 초과: 봇 ${n}명 ${rate[n]}`);
  const need = { botHits: 100 * k, humanHit: 10 * k, botPays: 20 * k, botStun: 15 * k };
  for (const key of Object.keys(need)) ok(tot[key] >= need[key], `① ② ③ 시험이 ${key} 를 충분히 다루지 못함: ${tot[key]} < ${need[key]}`);
  console.log(`무작위 OK  ${secs}초(작업 프로세스 ${W}개) · 핸드 ${tot.hands} · 봇이 때림 ${tot.botHits} (사람이 맞음 ${tot.humanHit}) · 봇이 합의금 ${tot.botPays}/${tot.botPaid} · 봇 기절 핸드 ${tot.botStun} · 사람 기절 핸드 ${tot.humanStun} · 복수 ${tot.revenge} · 쿨다운 위반 0 · 칩 합계 위반 0 · 교착·예외 0`);
}

if (process.argv[2] === '--worker') {
  runTables(JSON.parse(process.env.PLAN)).then((rows) => { process.send({ rows, errCount }, () => process.exit(0)); });
} else {
  (async () => {
    await units();
    await stress();
    console.log('봇 때리기·합의금 OK');
    process.exit(0);
  })().catch((e) => { err0('실패:', e.message); process.exit(1); });
}
