// 개발 전용(?punch): 연출 시계를 멈추고 한 프레임(1/60초)씩 진행하며 컷을 모아 한 장의 시트로 만든다.
// 사용: await __sheet('a', 때리는자리, 맞는자리, [ms…], {close:true, focus:자리, dx, dy, crop:[w,h]})  → 화면 전체에 시트가 덮인다 / __sheetOff() 로 닫기
const real = performance.now.bind(performance);
let off = 0, frozen = null;
performance.now = () => (frozen !== null ? frozen : real() - off);
const clk = { pause() { if (frozen === null) frozen = real() - off; }, resume() { if (frozen !== null) { off = real() - frozen; frozen = null; } }, adv(ms) { frozen += ms; } };
const raf = () => new Promise((r) => requestAnimationFrame(r));
let hooked = false;

window.__sheet = async (style, hi, vi, times, o = {}) => {
  const st = window.__stage, cv = st.renderer.domElement, R = st.renderer;
  if (!hooked) { const orig = R.render.bind(R); R.render = (a, b) => { orig(a, b); if (window.__afterRender) window.__afterRender(); }; hooked = true; }
  const cols = o.cols || 4, CW = o.cw || 290, close = !!o.close, crop = o.crop || [340, 270], dpr = 2;
  const CH = close ? Math.round((CW * crop[1]) / crop[0]) : Math.round((CW * cv.clientHeight) / cv.clientWidth);
  const rows = Math.ceil(times.length / cols), sheet = document.createElement('canvas');
  sheet.width = cols * CW * dpr; sheet.height = rows * CH * dpr;
  const g = sheet.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, sheet.width, sheet.height); g.font = `${12 * dpr}px system-ui`; g.textBaseline = 'top';
  const k = cv.width / cv.clientWidth, v = st.camera.position.clone();
  const pd = document.querySelector('#pd'); if (pd) pd.style.display = 'none';
  clk.pause(); st.tw.scale = 1;
  let done = false, ok = null, t = 0, idx = 0; const STEP = 1000 / 60;
  const prom = (o.run ? o.run(st) : st.punch(hi, vi, style)).then((r) => { done = true; ok = r; }); // o.run: punch 대신 다른 연출(기절 등)을 재생
  window.__afterRender = () => {
    while (idx < times.length && t >= times[idx]) {
      let sx = 0, sy = 0, sw = cv.width, sh = cv.height;
      if (close) { st.seats[o.focus ?? vi].avatar.head.getWorldPosition(v); v.project(st.camera); const cx = ((v.x + 1) / 2) * cv.clientWidth + (o.dx || 0), cy = ((1 - v.y) / 2) * cv.clientHeight + (o.dy || 0); sw = crop[0] * k; sh = crop[1] * k; sx = cx * k - sw / 2; sy = cy * k - sh / 2; }
      const c = idx % cols, r = Math.floor(idx / cols);
      g.drawImage(cv, sx, sy, sw, sh, c * CW * dpr, r * CH * dpr, CW * dpr, CH * dpr);
      g.fillStyle = '#ffd58a'; g.fillText(`${Math.round(times[idx])}ms`, c * CW * dpr + 6 * dpr, r * CH * dpr + 4 * dpr); idx++;
    }
  };
  for (let i = 0; i < 3000 && !done; i++) { clk.adv(STEP); t += STEP; window.__sheetT = t; await raf(); }
  window.__afterRender = null; clk.resume(); await prom; st.tw.scale = 1;
  if (pd) pd.style.display = '';
  const ov = Object.assign(document.createElement('div'), { id: '__ov' });
  ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#000;display:flex;justify-content:center;align-items:flex-start';
  sheet.style.cssText = `width:${cols * CW}px;height:${rows * CH}px`; ov.append(sheet); document.body.append(ov);
  return { ok, total: Math.round(t), sampled: idx };
};
window.__sheetOff = () => document.querySelector('#__ov')?.remove();
