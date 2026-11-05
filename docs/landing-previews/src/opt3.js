(() => {
const cv = document.querySelector('#fx'), ctx = cv.getContext('2d'); let W, H, dpr;
const size = () => { dpr = Math.min(devicePixelRatio || 1, 2); W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr; }; addEventListener('resize', size); size();
const ember = () => ({ x: Math.random() * W, y: H * (.6 + Math.random() * .5), vx: (Math.random() - .5) * .35 * dpr, vy: -(.3 + Math.random() * .8) * dpr, life: 0, max: 360 + Math.random() * 420, r: (.8 + Math.random() * 1.9) * dpr });
const parts = Array.from({ length: 70 }, () => { const e = ember(); e.life = Math.random() * e.max; return e; });
(function tick() { ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'lighter'; ctx.shadowColor = '#efd095'; ctx.shadowBlur = 9 * dpr; ctx.fillStyle = '#efd095'; for (const p of parts) { p.life++; p.x += p.vx + Math.sin(p.life / 40) * .15 * dpr; p.y += p.vy; const t = p.life / p.max; if (t >= 1 || p.y < -20) Object.assign(p, ember()); ctx.globalAlpha = Math.sin(Math.min(1, t) * Math.PI) * .55; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); } requestAnimationFrame(tick); })();
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .25 });
document.querySelectorAll('.feat').forEach(el => io.observe(el));
document.querySelectorAll('[data-n]').forEach(b => { const n = +b.dataset.n, t0 = performance.now() + 1100; (function st(t) { const k = Math.max(0, Math.min(1, (t - t0) / 1200)); b.textContent = Math.round(n * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(st); })(t0); });
})();
