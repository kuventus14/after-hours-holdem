// 효과음(카드·칩·테이블 두드리기)은 파일 없이 Web Audio 로 직접 합성하고,
// 베팅 음성("콜/레이즈/올인…")은 브라우저의 음성 합성(SpeechSynthesis)을 쓴다.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function hash(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const KEY = 'holdem_sound';
const VKEY = 'holdem_volume'; // 이 기기에서만 저장·적용되는 볼륨 (다른 사람에게 영향 없음)

export class Sound {
  constructor(ctx = null) {
    this.ctx = ctx; this.master = null; this.noise = null; this.testMode = false;
    this.stats = { sfx: 0, voice: 0, spoken: [] };
    try { this.enabled = localStorage.getItem(KEY) !== '0'; } catch { this.enabled = true; }
    this._warmed = false;
    let v = 0.7; try { const raw = localStorage.getItem(VKEY); if (raw !== null && !isNaN(+raw)) v = clamp(+raw, 0, 1); } catch {}
    this.volume = v; // 0 ~ 1 (기본 0.7 = 기존 소리 크기)
  }

  // ── 볼륨: 이 기기의 소리만 바꾼다 (서버로 보내지 않음) ──
  setVolume(v) {
    this.volume = clamp(+v || 0, 0, 1);
    try { localStorage.setItem(VKEY, String(this.volume)); } catch {}
    if (this.master) this.master.gain.value = this.volume * 1.3;
    if (this.volume <= 0 && typeof speechSynthesis !== 'undefined') { try { speechSynthesis.cancel(); } catch {} }
  }
  icon() { return !this.enabled || this.volume <= 0 ? '🔇' : this.volume < 0.35 ? '🔈' : this.volume < 0.7 ? '🔉' : '🔊'; }
  /** 슬라이더를 놓았을 때 들려주는 확인음 */
  preview() { if (!this.ok) return; const t = this.now(); this._click(t, 1, 0.3); this._click(t + 0.07, 1.2, 0.3); this._click(t + 0.15, 0.9, 0.3); }

  // 소리를 낼 수 있는 상태인가 (사용자가 한 번 화면을 건드려 오디오가 깨어난 뒤)
  get ok() { return this.enabled && this.volume > 0 && !!this.ctx && !!this.master && (this.testMode || this.ctx.state === 'running'); }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (!this.master) {
      const c = this.ctx;
      this.master = c.createGain(); this.master.gain.value = this.volume * 1.3;
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
      // 마지막에 부드러운 리미터: 소리가 많이 겹쳐도 깨지지 않게 (tanh 로 둥글게 눌러준다)
      const lim = c.createWaveShaper(), curve = new Float32Array(2048);
      for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * 1.1) / Math.tanh(1.1) * 0.9; }
      lim.curve = curve;
      this.master.connect(comp); comp.connect(lim); lim.connect(c.destination);
      const len = Math.floor(c.sampleRate * 1.5), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    return this.ctx;
  }

  // 브라우저 정책상 화면을 한 번 누른 뒤에야 소리가 난다 → 첫 터치/클릭에서 호출
  unlock() {
    const c = this.ensure();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    if (!this._warmed && typeof speechSynthesis !== 'undefined') { // iOS 등에서 첫 음성이 막히지 않게 미리 한 번 깨워 둔다
      this._warmed = true;
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); speechSynthesis.getVoices(); } catch {}
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(KEY, this.enabled ? '1' : '0'); } catch {}
    if (!this.enabled && typeof speechSynthesis !== 'undefined') { try { speechSynthesis.cancel(); } catch {} }
    if (this.enabled) this.unlock();
    return this.enabled;
  }

  now() { return this.ctx.currentTime + 0.005; }

  // ── 합성 재료 ──
  _noise(t, dur, { type = 'bandpass', f0 = 3000, f1 = 0, q = 1, gain = 0.25, atk = 0.003 } = {}) {
    const c = this.ctx, src = c.createBufferSource(), flt = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise; flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t); if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.03);
  }
  _tone(t, { f0 = 440, f1 = 0, dur = 0.1, type = 'sine', gain = 0.2, atk = 0.002 } = {}) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.03);
  }

  // ── 카드 ──
  _flick(t) { this._noise(t, 0.085, { type: 'bandpass', f0: 6200, f1: 2400, q: 0.9, gain: 0.6 }); this._noise(t + 0.01, 0.05, { type: 'highpass', f0: 3500, gain: 0.2 }); }
  _land(t) { this._noise(t, 0.055, { type: 'lowpass', f0: 1100, f1: 500, gain: 0.3 }); this._tone(t, { f0: 190, f1: 90, dur: 0.06, gain: 0.16 }); }
  _flap(t) { this._noise(t, 0.1, { type: 'bandpass', f0: 2600, f1: 4200, q: 0.7, gain: 0.6 }); this._noise(t + 0.05, 0.05, { type: 'highpass', f0: 3000, gain: 0.25 }); }

  /** 카드를 던져 보냄: 휙 소리 + (날아가는 시간 뒤) 테이블에 툭 */
  deal(landMs = 500) { if (!this.ok) return; const t = this.now(); this._flick(t); this._land(t + landMs / 1000); this.stats.sfx++; }
  /** 카드 뒤집기 (n장이면 살짝 시차를 두고) */
  flip(n = 1) { if (!this.ok) return; const t = this.now(); for (let i = 0; i < n; i++) this._flap(t + i * 0.06); this.stats.sfx++; }
  fold() { if (!this.ok) return; const t = this.now(); this._noise(t, 0.26, { type: 'bandpass', f0: 3400, f1: 800, q: 0.8, gain: 1.6 }); this.stats.sfx++; }

  // ── 칩 ──
  _click(t, pitch = 1, gain = 0.2) {
    this._tone(t, { f0: 2700 * pitch, f1: 1900 * pitch, dur: 0.05, type: 'triangle', gain });
    this._tone(t, { f0: 4300 * pitch, f1: 3300 * pitch, dur: 0.035, type: 'sine', gain: gain * 0.5 });
    this._noise(t, 0.025, { type: 'bandpass', f0: 5200, q: 1.2, gain: gain * 0.7 });
  }
  _count(amount) { return clamp(Math.round(Math.log2(1 + amount / 20) * 1.2) + 1, 2, 7); }
  _slide(t, dur = 0.28, gain = 0.1) { this._noise(t, dur, { type: 'bandpass', f0: 1500, f1: 2600, q: 0.6, gain }); }

  /** 칩을 집어서 밀어냄 (플레이어 앞 → 베팅 자리) */
  chipsOut(amount, soft = false) {
    if (!this.ok) return; const t = this.now(), n = this._count(amount), g = soft ? 0.1 : 0.16;
    this._slide(t, 0.25, soft ? 0.05 : 0.09);
    for (let i = 0; i < n; i++) this._click(t + 0.02 + Math.random() * 0.14, 0.9 + Math.random() * 0.25, g);
    this.stats.sfx++;
  }
  /** 칩이 베팅 자리에 내려앉음 */
  chipsLand(amount, soft = false) {
    if (!this.ok) return; const t = this.now(), n = this._count(amount), g = soft ? 0.14 : 0.24;
    for (let i = 0; i < n; i++) this._click(t + i * (0.025 + Math.random() * 0.03), 0.85 + Math.random() * 0.4, g);
    this.stats.sfx++;
  }
  /** 모든 베팅 칩이 가운데 팟으로 쓸려감 */
  sweep() {
    if (!this.ok) return; const t = this.now();
    this._slide(t, 0.5, 0.14);
    for (let i = 0; i < 8; i++) this._click(t + 0.05 + i * 0.065 + Math.random() * 0.03, 0.8 + Math.random() * 0.35, 0.15);
    this.stats.sfx++;
  }
  /** 이긴 사람에게 팟이 날아옴 */
  win(amount = 100) {
    if (!this.ok) return; const t = this.now(), n = clamp(this._count(amount) + 4, 6, 12);
    this._slide(t, 0.7, 0.12);
    for (let i = 0; i < n; i++) this._click(t + 0.1 + i * 0.07 + Math.random() * 0.03, 0.9 + (i / n) * 0.55, 0.2);
    this.stats.sfx++;
  }
  /** 체크: 테이블을 톡 두드림 */
  knock() { if (!this.ok) return; const t = this.now(); this._tone(t, { f0: 150, f1: 70, dur: 0.12, gain: 1.0 }); this._noise(t, 0.05, { type: 'lowpass', f0: 600, gain: 0.7 }); this.stats.sfx++; }

  // ── 내 차례 알림 / 감정표현 ──
  /** 배팅 차례 알림음: 맑은 두 음 */
  turn() {
    if (!this.ok) return; const t = this.now();
    this._tone(t, { f0: 880, dur: 0.38, type: 'sine', gain: 0.5 }); this._tone(t, { f0: 1760, dur: 0.22, type: 'sine', gain: 0.12 });
    this._tone(t + 0.17, { f0: 1319, dur: 0.5, type: 'sine', gain: 0.5 }); this._tone(t + 0.17, { f0: 2638, dur: 0.3, type: 'sine', gain: 0.12 });
    this.stats.sfx++;
  }
  /** 화남: 책상을 쾅 */
  slam() { if (!this.ok) return; const t = this.now(); this._tone(t, { f0: 120, f1: 45, dur: 0.22, gain: 1.2 }); this._noise(t, 0.09, { type: 'lowpass', f0: 700, gain: 0.9 }); this._noise(t, 0.04, { type: 'highpass', f0: 2500, gain: 0.35 }); this.stats.sfx++; }
  /** 빨리: 배트 휘두르는 소리 / 맞는 소리 */
  swing() { if (!this.ok) return; const t = this.now(); this._noise(t, 0.24, { type: 'bandpass', f0: 700, f1: 3400, q: 0.7, gain: 0.9 }); this.stats.sfx++; }
  hit() { if (!this.ok) return; const t = this.now(); this._tone(t, { f0: 200, f1: 60, dur: 0.18, gain: 1.1 }); this._noise(t, 0.05, { type: 'highpass', f0: 1800, gain: 0.7 }); this.stats.sfx++; }
  /** 감사: 포근한 종소리 */
  /** 카드 자랑하기: 저음이 차오르고 심장 박동이 점점 빨라지다가, flips(초) 마다 휙 → 쾅 → 반짝. 첫 공개 전엔 긴 긴장, 그다음 공개 전엔 짧은 긴장 */
  brag(flips) {
    if (!this.ok) return; const t = this.now(), c = this.ctx, f0 = flips[0];
    const o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain(); // 저음 드론: 낮게 시작해 점점 올라가고 공개 직전에 끊긴다
    o.type = 'sawtooth'; o.frequency.setValueAtTime(52, t); o.frequency.exponentialRampToValueAtTime(110, t + f0);
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(160, t); lp.frequency.exponentialRampToValueAtTime(1000, t + f0);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + f0 - 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + f0 + 0.08);
    o.connect(lp); lp.connect(g); g.connect(this.master); o.start(t); o.stop(t + f0 + 0.2);
    flips.forEach((f, k) => {
      for (let b = k ? flips[k - 1] + 0.9 : 0.5, gap = k ? 0.55 : 0.9; b < f - 0.35; b += gap, gap = Math.max(0.38, gap * 0.9)) { // 심장 박동 (쿵-쿵), 점점 빨라진다
        this._tone(t + b, { f0: 80, f1: 42, dur: 0.18, gain: 0.55 }); this._tone(t + b + 0.17, { f0: 70, f1: 40, dur: 0.14, gain: 0.35 });
      }
      this._noise(t + f - 1.2, 1.1, { type: 'bandpass', f0: 500, f1: 7000, q: 1.2, gain: 0.3 }); // 차오르는 휙
      this._flap(t + f - 0.55);                                                                  // 카드가 넘어가는 소리
      this._tone(t + f, { f0: 220, f1: 45, dur: 0.5, type: 'triangle', gain: 0.9 }); this._noise(t + f, 0.12, { type: 'highpass', f0: 1800, gain: 0.8 }); // 쾅
      [1047, 1319, 1568, 2093].forEach((fr, i) => this._tone(t + f + 0.05 + i * 0.07, { f0: fr, dur: 0.7, gain: 0.2 })); // 반짝
    });
    this.stats.sfx++;
  }
  chime() { if (!this.ok) return; const t = this.now(); [1047, 1319, 1568].forEach((f, i) => this._tone(t + i * 0.11, { f0: f, dur: 0.6, type: 'sine', gain: 0.28 })); this.stats.sfx++; }
  /** 슬픔: 풀 죽은 소리 */
  sob() { if (!this.ok) return; const t = this.now(); this._tone(t, { f0: 392, f1: 294, dur: 0.45, type: 'sine', gain: 0.3 }); this._tone(t + 0.55, { f0: 349, f1: 262, dur: 0.5, type: 'sine', gain: 0.28 }); this.stats.sfx++; }

  // ── 음성 ──
  _voice() {
    if (this._v) return this._v;
    try { const vs = speechSynthesis.getVoices(); const v = vs.find((x) => /^ko/i.test(x.lang)) || null; if (v) this._v = v; return v; } catch { return null; }
  }
  /** "콜", "레이즈 400" 처럼 한마디. 사람마다 목소리 높낮이를 다르게 해서 누가 말하는지 구분되게 한다 */
  say(text, who = '') {
    if (!this.enabled || this.volume <= 0 || !text) return;
    this.stats.voice++; this.stats.spoken.push(text); if (this.stats.spoken.length > 200) this.stats.spoken.shift();
    if (this.testMode || typeof speechSynthesis === 'undefined') return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; const v = this._voice(); if (v) u.voice = v;
      u.rate = 1.12; u.pitch = clamp(0.8 + (hash(who) % 7) * 0.1, 0.8, 1.4); u.volume = Math.min(1, this.volume / 0.7);
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel(); // 밀리지 않게 최신 말만
      setTimeout(() => { try { speechSynthesis.speak(u); } catch {} }, speechSynthesis.speaking ? 40 : 0);
    } catch {}
  }
}
