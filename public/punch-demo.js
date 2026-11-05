// 모션 시연 도구 — 주소 끝에 ?punch 를 붙였을 때만 불러온다 (친구들 화면에는 나오지 않는다)
// · 왼쪽 아래 '시연 도구' 패널(접힘): 때리기 B · 기절 보기 · 깨우기 · 속도 · 프레임 측정. 서버·돈과 무관하게 모션만 재생한다.
// · 진짜 때리기 흐름(버튼·확인창·합의금)은 hit.js 가 서버 상태대로 한다
import { Stage } from './game3d.js';
import { attachPunch, STYLES } from './punch.js';
attachPunch(Stage);
import('./punch-sheet.js');

const css = `#pd{position:fixed;left:10px;bottom:10px;z-index:99999;width:236px;padding:8px 10px;border-radius:12px;background:#0c1c1fe6;border:1px solid #dfc18c66;color:#f1eee5;font:12px/1.4 system-ui,sans-serif}
#pd select,#pd button{font:inherit;color:inherit;background:#17353a;border:1px solid #dfc18c55;border-radius:8px;padding:6px 8px}
#pd select{width:100%;margin:3px 0}#pd .r{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}#pd .r button{flex:1;min-width:46%}
#pd button.on{background:#dfc18c;color:#10201f;font-weight:700}#pd button:disabled{opacity:.4}
#pd b{color:#dfc18c}#pd .hd{cursor:pointer;user-select:none}#pd .bd{display:none}#pd.open .bd{display:block}#pd .fps{margin-top:8px;font-variant-numeric:tabular-nums;white-space:pre}`;
document.head.append(Object.assign(document.createElement('style'), { textContent: css }));
const box = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'pd' }));
box.innerHTML = `<div class="hd" id="pdHd"><b>⚾ 시연 도구</b> <span id="pdArrow">▸</span> <span id="pdFps" style="float:right;opacity:.8">-</span></div>
<div class="bd">
<select id="pdH"></select><select id="pdV"></select>
<div class="r"><button id="pdB">B 때리기 시연</button></div>
<div class="r"><button id="pdStun">기절 보기(맞는 자리)</button><button id="pdWake">깨우기</button></div>
<div class="r"><button data-sp="1" class="on">보통 속도</button><button data-sp="3">3배 느리게</button></div>
<div class="fps" id="pdF">-</div></div>`;
const $ = (s) => box.querySelector(s);
$('#pdHd').onclick = () => { box.classList.toggle('open'); $('#pdArrow').textContent = box.classList.contains('open') ? '▾' : '▸'; };

// 부드러움 측정: 화면이 그려지는 간격(ms)을 모아 평균 FPS 와 가장 긴 끊김을 보여준다
let last = performance.now(), win = [], run = null;
(function loop(now) {
  const dt = now - last; last = now;
  if (dt < 1000) { win.push(dt); if (win.length > 90) win.shift(); if (run) { run.n++; run.sum += dt; run.max = Math.max(run.max, dt); if (dt > 33.4) run.slow++; } }
  if ((loop.k = (loop.k || 0) + 1) % 15 === 0) {
    const avg = win.reduce((a, b) => a + b, 0) / Math.max(1, win.length);
    $('#pdFps').textContent = `${(1000 / avg).toFixed(0)} fps`;
    $('#pdF').textContent = `지금 ${(1000 / avg).toFixed(0)} fps` + (run ? `\n측정 중…` : window.__punchStat ? `\n마지막: 평균 ${window.__punchStat.fps} fps · 최대끊김 ${window.__punchStat.max}ms\n느린 프레임 ${window.__punchStat.slow}/${window.__punchStat.n}` : '');
  }
  requestAnimationFrame(loop);
})(last);

function fill() {
  const st = window.__stage; if (!st || !st.seats.length) return;
  const opts = st.seats.map((s, i) => `<option value="${i}">${i + 1}번 ${s.name}</option>`).join('');
  for (const id of ['#pdH', '#pdV']) { const el = $(id), v = el.value; el.innerHTML = opts; if (v && el.querySelector(`[value="${v}"]`)) el.value = v; }
  if (!fill.init) { fill.init = true; $('#pdH').value = '0'; $('#pdV').value = st.seats.length > 2 ? '2' : '1'; }
}
setInterval(fill, 700);

export async function go(style, hi, vi) {
  const st = window.__stage; if (!st) return false;
  hi = hi ?? +$('#pdH').value; vi = vi ?? +$('#pdV').value;
  if (hi === vi) return false;
  st.tw.scale = +box.querySelector('[data-sp].on').dataset.sp;
  run = { n: 0, sum: 0, max: 0, slow: 0 };
  const t0 = performance.now(), ok = await st.punch(hi, vi, style);
  const r = run; run = null; st.tw.scale = 1;
  if (ok && r.n) window.__punchStat = { fps: (1000 / (r.sum / r.n)).toFixed(0), max: r.max.toFixed(0), slow: r.slow, n: r.n, ms: Math.round(performance.now() - t0) };
  return ok;
}
const busy = (f) => async () => { box.querySelectorAll('button').forEach((x) => (x.disabled = true)); try { await f(); } finally { box.querySelectorAll('button').forEach((x) => (x.disabled = false)); } };
$('#pdB').onclick = busy(() => go('b'));
$('#pdStun').onclick = () => { const st = window.__stage, i = +$('#pdV').value; if (!st.seats[i]) return; st.seats[i].avatar.demo = true; st.faint(i); }; // demo: 서버 상태로 되돌려 깨우지 않게
$('#pdWake').onclick = async () => { const st = window.__stage; for (const s of st.seats) if (s.avatar.stunned) { await st.revive(s.i); s.avatar.demo = false; } };
box.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = () => { box.querySelectorAll('[data-sp]').forEach((x) => x.classList.toggle('on', x === b)); }));
window.__punchGo = go; window.__STYLES = STYLES;
