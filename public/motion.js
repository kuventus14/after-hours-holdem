// Motion is a client-side view of existing events. This module sends no game messages.
const $ = selector => document.querySelector(selector);
const fmt = value => Number(value).toLocaleString('ko-KR');

class MotionDirector {
  constructor() {
    this.preference = matchMedia('(prefers-reduced-motion: reduce)');
    try { this.optOut = localStorage.getItem('holdem_motion') === 'off'; } catch { this.optOut = false; }
    this.animations = new Set();
    this.particles = [];
    this.previousCards = {mine:[], board:[]};
    this.table = $('.table-wrap');
    this.layer = document.createElement('div');
    this.layer.className = 'motion-layer'; this.layer.setAttribute('aria-hidden', 'true');
    this.layer.innerHTML = '<canvas class="motion-particles"></canvas><div class="motion-vignette"></div><div class="motion-announcement" hidden><span class="motion-kicker"></span><strong></strong><span class="motion-detail"></span></div>';
    this.table.appendChild(this.layer);
    this.canvas = this.layer.querySelector('canvas');
    this.context = this.canvas.getContext('2d');
    this.announcement = this.layer.querySelector('.motion-announcement');
    this.preference.addEventListener('change', () => this.syncPreference());
    document.querySelectorAll('[data-motion-toggle]').forEach(button => button.addEventListener('click', () => {
      this.optOut = !this.optOut;
      try { localStorage.setItem('holdem_motion', this.optOut ? 'off' : 'on'); } catch {}
      this.syncPreference();
    }));
    document.addEventListener('visibilitychange', () => {
      document.body.classList.toggle('motion-suspended', document.hidden);
      if (document.hidden) this.clear();
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.table);
    this.syncPreference();
    document.addEventListener('pointerdown', event => {
      const button = event.target.closest('button');
      if (!button || button.disabled || button.dataset.lock || !this.active || event.button !== 0) return;
      this.animate(button, [{filter:'brightness(1.35)'},{filter:'brightness(1)'}], {duration:320});
    });
    addEventListener('pagehide', () => { this.clear(); this.observer.disconnect(); }, {once:true});
  }

  get active() { return !this.optOut && !this.preference.matches && !document.hidden; }

  syncPreference() {
    document.body.dataset.motion = !this.optOut && !this.preference.matches ? 'on' : 'off';
    document.querySelectorAll('[data-motion-toggle]').forEach(button => {
      button.textContent = this.preference.matches ? '✦ 효과 최소' : this.optOut ? '✦ 효과 꺼짐' : '✦ 효과 켜짐';
      button.setAttribute('aria-pressed', String(!this.optOut && !this.preference.matches));
      button.disabled = this.preference.matches;
      button.title = this.preference.matches ? '기기의 움직임 줄이기 설정을 따르고 있어요' : '장식 효과 켜기/끄기';
    });
    if (!this.active) this.clear();
    document.dispatchEvent(new Event('holdem:motion-preference'));
  }

  bind(stage) {
    this.stage = stage;
    stage.onCue = (kind, data, position) => this.cue(kind, data, position);
  }

  resize() {
    this.width = this.table.clientWidth;
    this.height = this.table.clientHeight;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  animate(element, frames, options) {
    if (!this.active || !element?.animate) return;
    const animation = element.animate(frames, {easing:'cubic-bezier(.18,.75,.25,1)', ...options});
    this.animations.add(animation);
    animation.finished.catch(() => {}).finally(() => this.animations.delete(animation));
    return animation;
  }

  clear() {
    this.announcementToken = (this.announcementToken || 0) + 1;
    this.animations.forEach(animation => animation.cancel());
    this.animations.clear();
    cancelAnimationFrame(this.frameId); this.frameId = 0;
    this.particles = [];
    this.context?.clearRect(0, 0, this.width || 0, this.height || 0);
    clearTimeout(this.titleTimer); this.announcement.hidden = true;
    this.layer.querySelectorAll('.motion-amount').forEach(element => element.remove());
  }

  point(position) {
    if (!position || !this.stage) return {x:this.width / 2, y:this.height * .52};
    const point = position.clone().project(this.stage.camera);
    const host = this.stage.host.getBoundingClientRect(), table = this.table.getBoundingClientRect();
    return {x:host.left - table.left + (point.x + 1) * host.width / 2, y:host.top - table.top + (1 - point.y) * host.height / 2};
  }

  announce(kind, title, detail, kicker) {
    if (!this.active) return;
    const token = this.announcementToken = (this.announcementToken || 0) + 1;
    this.announcement.getAnimations().forEach(animation => animation.cancel());
    this.announcement.className = 'motion-announcement ' + kind;
    this.announcement.querySelector('strong').textContent = title;
    this.announcement.querySelector('.motion-detail').textContent = detail;
    this.announcement.querySelector('.motion-kicker').textContent = kicker;
    this.announcement.hidden = false;
    const animation = this.animate(this.announcement, [
      {opacity:0, transform:'translate(-50%, 18px) scale(.88)', offset:0},
      {opacity:1, transform:'translate(-50%, 0) scale(1)', offset:.17},
      {opacity:1, transform:'translate(-50%, 0) scale(1)', offset:.78},
      {opacity:0, transform:'translate(-50%, -12px) scale(1.02)', offset:1}
    ], {duration:kind === 'victory' ? 2400 : 1700});
    clearTimeout(this.titleTimer);
    const dismiss = () => { if (token === this.announcementToken) this.announcement.hidden = true; };
    // Start/end with actual rendered frames, including on slower mobile GPUs.
    if (animation) animation.finished.then(dismiss, () => {});
    else this.titleTimer = setTimeout(dismiss, kind === 'victory' ? 2400 : 1700);
  }

  burst(point, victory = false) {
    if (!this.active || !this.context) return;
    const cap = innerWidth < 700 ? 48 : 110;
    const count = victory ? cap / 2 : 14;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, speed = 45 + Math.random() * (victory ? 190 : 65);
      this.particles.push({x:point.x, y:point.y, vx:Math.cos(angle) * speed, vy:victory ? -100 - Math.random() * 220 : Math.sin(angle) * speed, life:0, total:victory ? 2.4 + Math.random() * .6 : .7, rotation:Math.random() * 6, spin:Math.random() * 8 - 4, color:['#ffe4a2','#69f4d1','#c7a5ff','#fff6d7'][i % 4], size:victory ? 3 + Math.random() * 3 : 2, gravity:victory ? 170 : 35});
    }
    this.particles = this.particles.slice(-cap);
    if (!this.frameId) { this.lastFrame = performance.now(); this.frameId = requestAnimationFrame(time => this.draw(time)); }
  }

  draw(time) {
    this.frameId = 0;
    if (!this.active) { this.clear(); return; }
    const elapsed = Math.max(0, (time - this.lastFrame) / 1000);
    const dt = Math.min(elapsed, .045); this.lastFrame = time;
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    this.particles = this.particles.filter(particle => particle.life < particle.total);
    for (const particle of this.particles) {
      particle.life += elapsed; particle.vy += particle.gravity * dt;
      particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.rotation += particle.spin * dt;
      context.save(); context.translate(particle.x, particle.y); context.rotate(particle.rotation);
      context.globalAlpha = Math.max(0, Math.min(1, (particle.total - particle.life) * 3));
      context.fillStyle = particle.color;
      context.fillRect(-particle.size / 2, -particle.size, particle.size, particle.size * 1.7);
      context.restore();
    }
    if (this.particles.length) this.frameId = requestAnimationFrame(next => this.draw(next));
  }

  cue(kind, data = {}, position) {
    if (!this.active) return;
    const point = this.point(position);
    if (kind === 'hand') {
      this.previousCards = {mine:[], board:[]};
      this.announce('deal', `HAND ${String(data.number).padStart(2, '0')}`, '새로운 한 수가 시작됩니다', 'THE NEXT CHAPTER');
    } else if (kind === 'allin') {
      this.announce('all-in', 'ALL IN', `${data.name} · ${fmt(data.amount)} 칩`, 'NO HOLDING BACK');
      this.animate(this.layer.querySelector('.motion-vignette'), [{opacity:0},{opacity:.8, offset:.25},{opacity:0}], {duration:1500});
    } else if (kind === 'bet') {
      this.burst(point);
      const label = document.createElement('span'); label.className = 'motion-amount';
      label.textContent = '+' + fmt(data.amount);
      label.style.left = `${Math.max(45, Math.min(this.width - 45, point.x))}px`;
      label.style.top = `${point.y}px`; this.layer.appendChild(label);
      const animation = this.animate(label, [{opacity:0, transform:'translate(-50%,0) scale(.7)'},{opacity:1, transform:'translate(-50%,-18px) scale(1)',offset:.2},{opacity:0,transform:'translate(-50%,-55px) scale(.95)'}], {duration:950});
      animation?.finished.catch(() => {}).finally(() => label.remove());
    } else if (kind === 'street') {
      const text = {flop:['THE FLOP','세 장의 카드, 새로운 가능성'],turn:['THE TURN','흐름을 바꾸는 네 번째 카드'],river:['THE RIVER','마지막 한 장, 당신의 선택']}[data.phase];
      if (text) this.announce('street', text[0], text[1], 'REVEAL THE POSSIBILITIES');
      this.burst(point);
    } else if (kind === 'win') {
      const winners = data.winners;
      this.announce('victory', winners.length > 1 ? 'SPLIT POT' : 'WINNER', winners.map(winner => `${winner.name} +${fmt(winner.amount)}`).join(' · '), 'THE MOMENT IS YOURS');
      this.burst({x:this.width * .18, y:this.height * .68}, true);
      this.burst({x:this.width * .82, y:this.height * .68}, true);
      if (winners.some(winner => winner.i === this.stage.state.me)) this.animate($('.control-dock'), [{boxShadow:'0 0 0 1px #f2cf86, 0 0 65px #e5b95966'},{boxShadow:'0 0 0 1px #f2cf8600, 0 0 0 #e5b95900'}], {duration:2300});
    }
  }

  cards(element, strip) {
    const groups = element.querySelectorAll('.grp');
    for (const [key, group] of [['mine',groups.length > 1 ? groups[0] : null],['board',groups[groups.length - 1]]]) {
      group?.querySelectorAll('.pcard').forEach((card, index) => {
        if (!this.stage?.tw.fast && strip[key][index] && strip[key][index] !== this.previousCards[key][index]) this.animate(card, [{opacity:0,transform:'perspective(600px) rotateY(-80deg) translateY(8px)'},{opacity:1,transform:'perspective(600px) rotateY(0) translateY(0)'}], {duration:520,delay:index * 55});
      });
      this.previousCards[key] = [...strip[key]];
    }
  }

  update(state) {
    const mine = state.toAct === state.me && state.me >= 0 && !state.ended;
    document.body.classList.toggle('my-turn', mine);
    if (mine && !this.wasMyTurn) this.animate($('.control-dock'), [{boxShadow:'0 0 40px #7ce4c44d',borderColor:'#83e7c6'},{boxShadow:'0 0 0 #7ce4c400',borderColor:'#baaa75'}], {duration:900});
    const chips = state.players[state.me]?.chips;
    if (this.lastChips != null && this.lastChips !== chips) this.animate($('#seatChips'), [{color:'#fff7d7',transform:'scale(1.1)'},{color:'#dfc18c',transform:'scale(1)'}], {duration:480});
    this.wasMyTurn = mine; this.lastChips = chips;
  }
}

export const motion = new MotionDirector();
