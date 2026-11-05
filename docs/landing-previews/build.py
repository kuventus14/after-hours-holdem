import html, pathlib
D = pathlib.Path(__file__).parent; S = D / 'src'
r = lambda n: (S / n).read_text(encoding='utf8')
BASE, SHELL = r('base.css'), r('shell.html')
OPTS = [('opt1', '시안 1 · ROYAL REVEAL', '카드가 날아와 뒤집히며 로열 플러시가 완성되는 순간'), ('opt2', '시안 2 · LIVE TABLE', '아바타가 한 판을 치는 모습이 계속 돌아가는 살아있는 테이블'), ('opt3', '시안 3 · NEON NIGHT', '거대한 타이포와 빛, 스크롤하면 기능이 움직이며 소개')]
pages = {}
for key, title, _ in OPTS:
    after = r('opt3.after.html') if key == 'opt3' else ''
    body = SHELL.replace('__HERO__', r(key + '.html')).replace('__AFTER__', after)
    pages[key] = f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AFTER HOURS — {title}</title><style>{BASE}\n{r(key + ".css")}</style></head><body>{body}<script>{r(key + ".js")}</script></body></html>'
    (D / f'{key}.html').write_text(pages[key], encoding='utf8')
# 한 파일로 고르는 화면 (iframe srcdoc 으로 세 시안을 모두 담는다 → 이 파일 하나만 열면 된다)
tabs = ''.join(f'<button class="tab{" on" if i == 0 else ""}" data-i="{i}"><b>{t}</b><small>{d}</small></button>' for i, (k, t, d) in enumerate(OPTS))
frames = ''.join(f'<iframe class="fr{" on" if i == 0 else ""}" title="{t}" srcdoc="{html.escape(pages[k], quote=True)}"></iframe>' for i, (k, t, d) in enumerate(OPTS))
(D / 'options.html').write_text(f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>랜딩 시안 3가지</title>
<style>*{{box-sizing:border-box}}html,body{{margin:0;height:100%;background:#070e11;color:#f1eee5;font-family:"Pretendard","Apple SD Gothic Neo",system-ui,sans-serif}}
.bar{{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid #1f2f34;align-items:stretch;background:#0b1519}}
.tab{{flex:1;text-align:left;background:#13222700;border:1px solid #2b3b40;border-radius:10px;color:inherit;padding:9px 12px;cursor:pointer;font:inherit}}.tab b{{display:block;font-size:13px}}.tab small{{display:block;font-size:10px;color:#92a4a8;margin-top:3px}}
.tab.on{{border-color:#dfc18c;background:#1b2b30;box-shadow:0 0 0 2px #dfc18c22}}.dev{{display:flex;gap:6px;align-items:center}}.dev button{{border:1px solid #2b3b40;background:none;color:#c4cecb;border-radius:8px;padding:8px 12px;cursor:pointer;font:inherit;font-size:12px}}.dev button.on{{border-color:#dfc18c;color:#dfc18c}}
.stage{{height:calc(100% - 66px);display:grid;place-items:center;overflow:hidden}}.fr{{display:none;border:0;background:#0b1519;width:100%;height:100%}}.fr.on{{display:block}}.stage.phone .fr{{width:393px;height:min(852px,100%);border:1px solid #2b3b40;border-radius:26px;box-shadow:0 20px 60px #000a}}
@media(max-width:700px){{.bar{{flex-wrap:wrap}}.tab small{{display:none}}.dev{{width:100%}}}}</style></head><body>
<div class="bar">{tabs}<div class="dev"><button class="on" data-d="pc">데스크탑</button><button data-d="phone">폰</button></div></div>
<div class="stage" id="st">{frames}</div>
<script>const T=[...document.querySelectorAll('.tab')],F=[...document.querySelectorAll('.fr')],D=[...document.querySelectorAll('.dev button')],st=document.getElementById('st');
T.forEach((t,i)=>t.onclick=()=>{{T.forEach(x=>x.classList.toggle('on',x===t));F.forEach((f,j)=>f.classList.toggle('on',j===i));}});
D.forEach(b=>b.onclick=()=>{{D.forEach(x=>x.classList.toggle('on',x===b));st.classList.toggle('phone',b.dataset.d==='phone');}});</script></body></html>''', encoding='utf8')
print({k: len(v) for k, v in pages.items()})
