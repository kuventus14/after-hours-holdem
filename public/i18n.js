// 다국어(한국어·日本語·中文·English): 화면에 나오는 한글 문구를 고른 언어로 바꿔 보여 준다.
// 원문(한국어)은 코드·서버에 그대로 두고, 여기서 사전(i18n-data.js)으로 글자만 바꾼다 — 그래서 서버·게임 규칙·정산은 언어와 무관하다.
//  - 사전의 {} 는 이름·숫자 자리, 번역문에서는 {1} {2} 로 받는다(순서를 바꿔도 됨).
//  - 화면 글자는 MutationObserver 로 바꾸고, 고른 언어에서 원문 한국어는 노드마다 기억해 두었다가 언어를 바꿀 때 다시 쓴다.
//  - 금액('원')은 고른 나라 화폐로 환산해 보여 준다. 환산율은 고정한 대략 값이라 숫자 앞에 ≈ 를 붙인다(진짜 정산은 늘 원 기준).
(() => {
  const KEY = 'holdem_lang', HAN = /[가-힣]/, WON = /(\d[\d,]*)원/g;
  const APP = !!window.APP_MODE; // 앱: 돈(원)이 아니라 칩 개수로만 보여 준다 (환산 표시 없음)
  const DATA = window.I18N_DATA || {};
  // shortcut: 환산율은 고정값(2025년 말 기준 대략), 실시간 환율이 필요해지면 서버에서 받아오게 바꾼다
  const LANGS = {
    ko: { name: '한국어', html: 'ko', speech: 'ko-KR' },
    ja: { name: '日本語', html: 'ja', speech: 'ja-JP', cur: 'JPY', loc: 'ja-JP', per: 9.5 },
    zh: { name: '中文', html: 'zh-CN', speech: 'zh-CN', cur: 'CNY', loc: 'zh-CN', per: 195 },
    en: { name: 'English', html: 'en', speech: 'en-US', cur: 'USD', loc: 'en-US', per: 1400 },
  };
  let lang = 'ko';
  try { const s = localStorage.getItem(KEY); if (LANGS[s]) lang = s; } catch {}

  // ── 사전 → 검색 구조 ──
  const exact = new Map(), pats = [];
  const entry = {};
  for (const l of ['en', 'ja', 'zh']) for (const [k, v] of Object.entries(DATA[l] || {})) (entry[k] = entry[k] || {})[l] = v;
  for (const [k, t] of Object.entries(entry)) {
    if (!k.includes('{}')) {
      exact.set(k, t);
      // 앞뒤 장식('· ', '(' ')')을 뗀 알맹이도 등록: 다른 글에 붙어 나온 한글 덩어리(runs)가 찾을 수 있게
      const m = k.match(/^(· |\()?([^({}]*?)(\))?$/);
      if (m && (m[1] || m[3]) && m[2] && !entry[m[2]]) {
        const cut = {};
        for (const l of ['en', 'ja', 'zh']) { let v = t[l] || ''; if (m[1] && v.startsWith(m[1])) v = v.slice(m[1].length); if (m[3] && v.endsWith(m[3])) v = v.slice(0, -1); if (m[1] === '(' && v.startsWith('(')) v = v.slice(1); cut[l] = v; }
        if (!exact.has(m[2])) exact.set(m[2], cut);
      }
      continue;
    }
    const parts = k.split('{}');
    pats.push({ parts, t, len: k.replace(/\{\}/g, '').length });
  }
  pats.sort((a, b) => b.len - a.len); // 고정 글자가 많은(더 구체적인) 틀부터

  const CHIP = { ko: (n) => n + '칩', en: (n) => n + ' chips', ja: (n) => n + 'チップ', zh: (n) => n + '筹码' };
  const fmtMoney = (won, raw) => {
    if (APP) return CHIP[lang](raw);
    const c = LANGS[lang]; if (!c.cur) return null;
    const v = won / c.per;
    return '≈' + new Intl.NumberFormat(c.loc, { style: 'currency', currency: c.cur, maximumFractionDigits: c.cur === 'JPY' ? 0 : 2, minimumFractionDigits: c.cur === 'JPY' ? 0 : 2 }).format(v);
  };
  const cache = new Map();
  // 틀과 맞춰 보기: {} 사이의 고정 글자를 가능한 모든 자리에서 찾아 보고, 가장 잘 번역되는 나눔을 고른다
  // ('딴 금액 5,000원' 이 '딴' + '금액 5,000' 으로 잘못 나뉘는 것을 막는다)
  function fit(p, s, L) {
    const P = p.parts, last = P[P.length - 1];
    if (!s.startsWith(P[0]) || !s.endsWith(last) || s.length < P[0].length + last.length) return null;
    for (let i = 1; i < P.length - 1; i++) if (!s.includes(P[i])) return null;
    let best = null, tries = 0;
    const rec = (pi, pos, caps) => {
      if (tries > 200) return;
      if (pi === P.length - 1) {
        const end = s.length - last.length; if (end < pos) return; tries++;
        const c = [...caps, s.slice(pos, end)].map((x) => tr(x, L));
        const score = c.reduce((n, x) => n + (HAN.test(x) ? 0 : 1), 0);
        if (!best || score > best.score) best = { score, c };
        return;
      }
      for (let from = pos, i; from <= s.length && (i = s.indexOf(P[pi], from)) >= 0 && i + P[pi].length <= s.length - last.length && tries <= 200; from = i + 1) rec(pi + 1, i + P[pi].length, [...caps, s.slice(pos, i)]);
    };
    rec(1, P[0].length, []);
    return best && best.c;
  }
  // 한글이 이어진 덩어리를 사전의 고정 문구로 하나씩 바꾼다 (사전에 통째로 없으면 단어 앞부분부터 가장 긴 것으로)
  function runs(s, L) {
    s = s.replace(WON, (_, n) => (L === lang && fmtMoney(Number(n.replace(/,/g, '')), n)) || _); // '원' 단독 문구가 숫자 뒤 단위를 가로채지 않게 먼저 환산
    return s.replace(/[가-힣](?:[가-힣 ]*[가-힣])?/g, (run) => {
      const hit = exact.get(run)?.[L]; if (hit != null) return hit;
      const w = run.split(' '), out = [];
      for (let i = 0; i < w.length;) {
        let j = w.length, got = null;
        for (; j > i; j--) { got = exact.get(w.slice(i, j).join(' '))?.[L]; if (got != null) break; }
        if (got != null) { out.push(got); i = j; } else out.push(w[i++]);
      }
      return out.join(' ');
    });
  }
  function tr(s, L = lang) {
    if (typeof s !== 'string' || !HAN.test(s)) return s;
    if (L === 'ko') return APP ? s.replace(WON, (_, n) => CHIP.ko(n)) : s;
    const ck = L + '\u0001' + s; let hit = cache.get(ck); if (hit !== undefined) return hit;
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/), core = m[2].replace(/\s+/g, ' ');
    let out = exact.get(core)?.[L];
    if (out == null) {
      for (const p of pats) {
        if (!p.t[L]) continue;
        const caps = fit(p, core, L); if (!caps) continue;
        out = p.t[L].replace(/\{(\d+)\}/g, (_, i) => caps[i - 1] ?? ''); break;
      }
    }
    if (out == null) out = runs(core, L); // 통째로 맞는 틀이 없으면 한글 덩어리마다 따로 (여러 조각이 붙어 나온 줄)
    out = m[1] + out + m[3];
    if (L === lang) out = out.replace(WON, (_, n) => fmtMoney(Number(n.replace(/,/g, '')), n) ?? _);
    if (cache.size > 6000) cache.clear();
    cache.set(ck, out); return out;
  }

  // ── DOM 바꾸기 ──
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const tOrig = new WeakMap(), aOrig = new WeakMap(); // 텍스트 노드 → {ko, shown} / 요소 → {속성: {ko, shown}}
  const skip = (n) => { const e = n.nodeType === 1 ? n : n.parentElement; return !e || e.closest('script,style,[data-i18n-skip]'); };
  function doText(n) {
    if (skip(n)) return;
    const v = n.nodeValue, o = tOrig.get(n);
    if (o && o.shown === v) { const s = tr(o.ko); if (s !== v) { n.nodeValue = s; o.shown = s; } return; } // 언어를 바꾼 뒤 다시 적용
    if (!HAN.test(v)) { if (o) tOrig.delete(n); return; }
    const s = tr(v); tOrig.set(n, { ko: v, shown: s }); if (s !== v) n.nodeValue = s;
  }
  function doAttrs(el) {
    if (skip(el)) return;
    for (const a of ATTRS) {
      const v = el.getAttribute?.(a); if (v == null) continue;
      let rec = aOrig.get(el); const o = rec && rec[a];
      if (o && o.shown === v) { const s = tr(o.ko); if (s !== v) { el.setAttribute(a, s); o.shown = s; } continue; }
      if (!HAN.test(v)) { if (o) delete rec[a]; continue; }
      const s = tr(v); (rec = rec || {}); rec[a] = { ko: v, shown: s }; aOrig.set(el, rec); if (s !== v) el.setAttribute(a, s);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) doAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? doText(n) : doAttrs(n);
  }
  const mo = new MutationObserver((list) => {
    for (const r of list) {
      if (r.type === 'childList') r.addedNodes.forEach(walk);
      else if (r.type === 'characterData') doText(r.target);
      else doAttrs(r.target);
    }
  });
  const watch = () => mo.observe(document, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ATTRS });

  function setLang(l, silent) {
    if (!LANGS[l]) return;
    lang = l; cache.clear();
    try { localStorage.setItem(KEY, l); } catch {}
    document.documentElement.lang = LANGS[l].html;
    mo.disconnect();
    if (document.body) walk(document.documentElement);
    if (l !== 'ko' || document.body) watch();
    renderPicker();
    if (!silent) document.dispatchEvent(new CustomEvent('holdem:lang', { detail: { lang: l } }));
  }
  // 한국어일 때는 관찰자가 하는 일이 없다(원문 그대로) → 켜 두면 잦은 화면 갱신마다 헛일이라 끈다
  function watchIfNeeded() { mo.disconnect(); if (lang !== 'ko') watch(); }

  // ── 국기 ──
  const star = (cx, cy, R, rot = -90) => Array.from({ length: 10 }, (_, i) => { const a = (rot + i * 36) * Math.PI / 180, r = i % 2 ? R * .382 : R; return (cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2); }).join(' ');
  const FLAGS = {
    ko: `<rect width="30" height="20" fill="#fff"/><path d="M10,10a5,5 0 0 1 10,0a2.5,2.5 0 0 1 -5,0a2.5,2.5 0 0 0 -5,0z" fill="#cd2e3a"/><path d="M10,10a5,5 0 0 0 10,0a2.5,2.5 0 0 0 -5,0a2.5,2.5 0 0 1 -5,0z" fill="#0047a0"/>` +
      [[-56, 1], [56, 0], [124, 0], [236, 1]].map(([a, brk]) => `<g transform="rotate(${a} 15 10)" stroke="#111" stroke-width=".9">${brk ? '<path d="M12.4,2.2h5.2M12.4,3.6h5.2M12.4,5h5.2"/>' : '<path d="M12.4,2.2h2.2M15.4,2.2h2.2M12.4,3.6h2.2M15.4,3.6h2.2M12.4,5h2.2M15.4,5h2.2"/>'}</g>`).join(''),
    ja: '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/>',
    zh: `<rect width="30" height="20" fill="#de2910"/><polygon points="${star(5.5, 5.2, 3.2)}" fill="#ffde00"/>` + [[10.5, 2.2], [12.5, 4.6], [12.5, 7.6], [10.5, 9.8]].map(([x, y]) => `<polygon points="${star(x, y, 1, -90)}" fill="#ffde00"/>`).join(''),
    en: '<rect width="30" height="20" fill="#fff"/>' + Array.from({ length: 7 }, (_, i) => `<rect y="${(i * 20 / 13 * 2).toFixed(2)}" width="30" height="${(20 / 13).toFixed(2)}" fill="#b22234"/>`).join('') + '<rect width="13" height="10.77" fill="#3c3b6e"/>' + Array.from({ length: 12 }, (_, i) => `<circle cx="${(2 + (i % 4) * 3).toFixed(1)}" cy="${(2 + Math.floor(i / 4) * 3).toFixed(1)}" r=".7" fill="#fff"/>`).join(''),
  };
  const flagSvg = (l, w = 28) => `<svg viewBox="0 0 30 20" width="${w}" height="${w * 2 / 3}" aria-hidden="true" focusable="false"><clipPath id="fc-${l}-${w}"><rect width="30" height="20" rx="3"/></clipPath><g clip-path="url(#fc-${l}-${w})">${FLAGS[l]}</g><rect width="30" height="20" rx="3" fill="none" stroke="#0006"/></svg>`;

  const css = document.createElement('style');
  css.textContent = `.langpick{position:relative;display:inline-flex}.langpick.open{z-index:60}.lobby-nav:has(.langpick.open){z-index:5}
.langpick>button{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:999px;border:1px solid var(--line,#ffffff33);background:var(--panel,#0c1c1fcc);color:inherit;font:inherit;font-size:12px;cursor:pointer;line-height:1}
.langpick>button:hover,.langpick>button[aria-expanded=true]{border-color:var(--gold,#dfc18c)}
.langpick>button svg,.langpick li svg{display:block;border-radius:3px}
.langpick .caret{font-size:9px;opacity:.7}
.langpick ul{position:absolute;right:0;top:calc(100% + 6px);margin:0;padding:5px;list-style:none;min-width:150px;background:#0c1c1ff2;border:1px solid var(--gold,#dfc18c);border-radius:12px;box-shadow:0 14px 34px #000a;display:none;backdrop-filter:blur(8px)}
.langpick.open ul{display:block}
.langpick li button{width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;border:0;border-radius:8px;background:none;color:#f1eee5;font:inherit;font-size:13px;cursor:pointer;text-align:left}
.langpick li button:hover,.langpick li button:focus-visible{background:#ffffff1c;outline:none}
.langpick li button[aria-checked=true]{color:var(--gold,#dfc18c);font-weight:700}
.langpick li button[aria-checked=true]:after{content:"✓";margin-left:auto}
@media(max-width:700px){.langpick>button{padding:4px 7px}.langpick>button .nm{display:none}}`;
  document.head.appendChild(css);

  const pickers = [];
  function renderPicker() {
    for (const el of pickers) {
      el.querySelector('button').innerHTML = `${flagSvg(lang)}<span class="nm">${LANGS[lang].name}</span><span class="caret" aria-hidden="true">▾</span>`;
      el.querySelectorAll('li button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.l === lang)));
    }
  }
  function mountPicker(host, before) {
    if (!host) return;
    const el = document.createElement('div'); el.className = 'langpick'; el.setAttribute('data-i18n-skip', '');
    el.innerHTML = `<button type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="Language"></button><ul role="listbox" aria-label="Language">${Object.keys(LANGS).map((l) => `<li><button type="button" role="option" data-l="${l}" lang="${LANGS[l].html}">${flagSvg(l, 26)}<span>${LANGS[l].name}</span></button></li>`).join('')}</ul>`;
    const btn = el.querySelector('button'), setOpen = (o) => { el.classList.toggle('open', o); btn.setAttribute('aria-expanded', String(o)); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); const o = !el.classList.contains('open'); pickers.forEach((p) => p !== el && p.classList.remove('open')); setOpen(o); });
    el.querySelector('ul').addEventListener('click', (e) => { const b = e.target.closest('[data-l]'); if (b) { setOpen(false); setLang(b.dataset.l); } });
    document.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    host.insertBefore(el, before || host.firstChild); pickers.push(el); renderPicker();
  }

  window.I18N = { mount: (host) => mountPicker(host), get lang() { return lang; }, set: setLang, tr: (s) => tr(s), money: (won) => fmtMoney(won), speech: () => LANGS[lang].speech };
  window.tr = window.I18N.tr;
  const boot = () => {
    mountPicker(document.querySelector('.lobby-nav-actions'));
    mountPicker(document.querySelector('#game .top'), document.getElementById('sndBtn'));
    document.documentElement.lang = LANGS[lang].html;
    if (lang !== 'ko' || APP) { walk(document.documentElement); watch(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
