/* =========================================================
   NEON PINBALL — mobil için tam özellikli pinball oyunu
   Saf Canvas + WebAudio, sıfır bağımlılık.
   ========================================================= */
'use strict';

(() => {

/* ---------------- Sabitler ---------------- */
const W = 540, H = 960;            // sanal oyun alanı
const BALL_R = 12;
const GRAVITY = 1800;
const MAX_SPEED = 1900;
const STEP = 1 / 240;              // fizik alt adımı
const LANE_X = 487;                // fırlatma kanalı iç duvarı
const DRAIN_Y = H + 60;
const BALL_SAVE_TIME = 12;         // saniye
const EXTRA_BALL_AT = [200000, 500000, 1000000];

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ---------------- Canvas kurulumu ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let viewScale = 1;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fit = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = (W * fit) + 'px';
  canvas.style.height = (H * fit) + 'px';
  viewScale = fit * dpr;
  canvas.width = Math.round(W * viewScale);
  canvas.height = Math.round(H * viewScale);
  buildTableCache();
}
window.addEventListener('resize', resize);

/* ---------------- Ses motoru (WebAudio synth) ---------------- */
const SFX = (() => {
  let ac = null, master = null, muted = false;
  function ensure() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = 0.5;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
  }
  function tone(f1, f2, dur, type, vol, delay = 0) {
    if (muted || !ac) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f1, t);
    if (f2 !== f1) o.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function thump(dur, vol, freq = 700) {
    if (muted || !ac) return;
    const t = ac.currentTime;
    const len = Math.max(1, (dur * ac.sampleRate) | 0);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource(); src.buffer = buf;
    const flt = ac.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = freq;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t);
  }
  return {
    ensure,
    get muted() { return muted; },
    toggle() { muted = !muted; return muted; },
    flipper()   { thump(0.06, 0.5, 900); },
    launch()    { tone(120, 900, 0.35, 'sawtooth', 0.25); thump(0.2, 0.3, 500); },
    bumper()    { tone(rand(620, 700), 320, 0.12, 'sine', 0.5); tone(1240, 640, 0.08, 'sine', 0.2); },
    sling()     { tone(200, 90, 0.09, 'square', 0.3); },
    target()    { tone(880, 660, 0.1, 'triangle', 0.4); },
    bank()      { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.14, 'square', 0.22, i * 0.08)); },
    lane()      { tone(1320, 990, 0.09, 'sine', 0.3); },
    lanesAll()  { [784, 988, 1175].forEach((f, i) => tone(f, f, 0.12, 'triangle', 0.3, i * 0.07)); },
    spinner()   { tone(1600, 1200, 0.03, 'square', 0.12); },
    saucer()    { tone(220, 880, 0.3, 'sawtooth', 0.25); },
    eject()     { tone(500, 150, 0.15, 'square', 0.3); },
    multiball() { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.18, 'square', 0.24, i * 0.09)); },
    extraBall() { [660, 880, 1100, 1320].forEach((f, i) => tone(f, f, 0.15, 'triangle', 0.3, i * 0.09)); },
    drain()     { tone(300, 60, 0.55, 'sawtooth', 0.3); },
    ballSave()  { tone(440, 880, 0.2, 'square', 0.3); tone(880, 1320, 0.2, 'square', 0.2, 0.1); },
    gameOver()  { [392, 330, 262, 196].forEach((f, i) => tone(f, f, 0.3, 'triangle', 0.3, i * 0.22)); },
    wall()      { thump(0.03, 0.12, 1200); },
  };
})();

function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) {} }

/* ---------------- Tohumlu RNG (bölüm üretimi) ---------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ---------------- Çizim yardımcıları ---------------- */
function ln(c, x1, y1, x2, y2) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
function cFill(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
function cStroke(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke(); }

/* =========================================================
   BÖLÜM TEMALARI — her biri kendi sanat yönetimine sahip:
   arkaplan ressamı, bumper tasarımı, duvar stili, ortam
   parçacıkları ve HUD rengi.
   ========================================================= */
const THEMES = [

  { // 1 — mimari plan kağıdı: kesikli beyaz çizgiler, milimetrik kağıt
    name: 'TEKNİK ÇİZİM',
    hud: '#a8d8ff',
    wallStyle: { color: '#d8ecff', width: 3, blur: 0, dash: [12, 7] },
    accent: '#ffd166', target: '#ffe08a', targetGlow: '#ffd166',
    saucer: '#7fd4ff', saucerHi: '#c8ecff',
    flipA: '#f2f8ff', flipB: '#8fbde0',
    trail: '#d8ecff', spark: '#ffffff',
    ambient: null,
    bg(c, rng) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#17395c'); g.addColorStop(1, '#0d2338');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(200, 230, 255, 0.07)';
      for (let y = 0; y <= H; y += 24) ln(c, 0, y, W, y);
      for (let x = 0; x <= W; x += 24) ln(c, x, 0, x, H);
      c.strokeStyle = 'rgba(200, 230, 255, 0.15)';
      for (let y = 0; y <= H; y += 120) ln(c, 0, y, W, y);
      for (let x = 0; x <= W; x += 120) ln(c, x, 0, x, H);
      // ölçü işaretleri
      c.strokeStyle = 'rgba(216, 236, 255, 0.4)';
      c.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const x = 60 + rng() * 420, y = 80 + rng() * 780;
        ln(c, x - 9, y, x + 9, y); ln(c, x, y - 9, x, y + 9);
      }
    },
    drawBumper(c, b, f) {
      c.save();
      c.strokeStyle = f > 0 ? '#ffffff' : '#d8ecff';
      c.lineWidth = 2.5;
      c.setLineDash([6, 4]);
      cStroke(c, b.x, b.y, b.r);
      c.setLineDash([]);
      cStroke(c, b.x, b.y, b.r * 0.55);
      c.lineWidth = 1.5;
      ln(c, b.x - b.r * 0.82, b.y, b.x + b.r * 0.82, b.y);
      ln(c, b.x, b.y - b.r * 0.82, b.x, b.y + b.r * 0.82);
      if (f > 0) { c.globalAlpha = f * 0.7; c.fillStyle = '#fff'; cFill(c, b.x, b.y, b.r); }
      c.restore();
    },
  },

  { // 2 — eski tüplü ekran: fosfor yeşili, tarama çizgileri
    name: 'RETRO CRT',
    hud: '#4fff7f',
    wallStyle: { color: '#33ff66', width: 5, blur: 9, dash: null },
    accent: '#1fd455', target: '#8fffb0', targetGlow: '#33ff66',
    saucer: '#1fd455', saucerHi: '#a8ffc4',
    flipA: '#a8ffc4', flipB: '#12a03c',
    trail: '#66ff8f', spark: '#a8ffc4',
    ambient: { type: 'scan' },
    bg(c) {
      c.fillStyle = '#04140a'; c.fillRect(0, 0, W, H);
      const v = c.createRadialGradient(270, 480, 120, 270, 480, 620);
      v.addColorStop(0, 'rgba(30, 90, 45, 0.30)');
      v.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      c.fillStyle = v; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(0, 0, 0, 0.28)';
      for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 2);
    },
    drawBumper(c, b, f) {
      c.fillStyle = f > 0 ? '#eaffea' : '#0a2f14';
      cFill(c, b.x, b.y, b.r);
      c.strokeStyle = '#33ff66'; c.lineWidth = 3;
      c.shadowColor = '#33ff66'; c.shadowBlur = 10 + f * 22;
      cStroke(c, b.x, b.y, b.r);
      c.shadowBlur = 0;
      cStroke(c, b.x, b.y, b.r * 0.58);
      c.fillStyle = '#33ff66';
      cFill(c, b.x, b.y, b.r * 0.22);
      c.strokeStyle = 'rgba(0, 0, 0, 0.4)'; c.lineWidth = 2;
      for (let y = b.y - b.r + 4; y < b.y + b.r; y += 6) {
        const hw = Math.sqrt(Math.max(0, b.r * b.r - (y - b.y) * (y - b.y))) - 2;
        if (hw > 2) ln(c, b.x - hw, y, b.x + hw, y);
      }
    },
  },

  { // 3 — günbatımı: degrade gök, şeritli güneş, dağ silüetleri
    name: 'GÜNBATIMI',
    hud: '#ffbf80',
    wallStyle: { color: '#ffb36b', width: 5, blur: 5, dash: null },
    accent: '#e0533f', target: '#ffd166', targetGlow: '#ffb021',
    saucer: '#c44e9e', saucerHi: '#ff9fd0',
    flipA: '#ffd166', flipB: '#ff6b4a',
    trail: '#ffcf9f', spark: '#ffd166',
    ambient: null,
    bg(c) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1b1f4e'); g.addColorStop(0.34, '#75295f');
      g.addColorStop(0.58, '#d4543c'); g.addColorStop(0.76, '#38173f');
      g.addColorStop(1, '#150c20');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      // şeritli güneş
      const sg = c.createLinearGradient(0, 320, 0, 580);
      sg.addColorStop(0, '#ffd166'); sg.addColorStop(1, '#ff5f3f');
      c.fillStyle = sg;
      cFill(c, 270, 450, 135);
      c.fillStyle = 'rgba(56, 23, 63, 0.9)';
      for (let i = 0; i < 6; i++) c.fillRect(120, 462 + i * 20, 300, 3 + i * 1.4);
      // dağ silüetleri
      c.fillStyle = '#110820';
      c.beginPath();
      c.moveTo(0, 700); c.lineTo(85, 598); c.lineTo(175, 688); c.lineTo(262, 615);
      c.lineTo(360, 700); c.lineTo(452, 636); c.lineTo(540, 712);
      c.lineTo(540, H); c.lineTo(0, H); c.closePath(); c.fill();
    },
    drawBumper(c, b, f) {
      const g = c.createRadialGradient(b.x, b.y - b.r * 0.3, 2, b.x, b.y, b.r);
      g.addColorStop(0, f > 0 ? '#ffffff' : '#ffe9a8');
      g.addColorStop(0.6, '#ffb04a'); g.addColorStop(1, '#ff5f3f');
      c.fillStyle = g;
      c.shadowColor = '#ff8f4a'; c.shadowBlur = 10 + f * 20;
      cFill(c, b.x, b.y, b.r);
      c.shadowBlur = 0;
      c.strokeStyle = 'rgba(45, 12, 45, 0.75)'; c.lineWidth = 2.5;
      for (let i = 1; i <= 3; i++) {
        const dy = b.r * 0.22 * i + 1;
        const hw = Math.sqrt(Math.max(0, b.r * b.r - dy * dy)) - 1;
        if (hw > 2) ln(c, b.x - hw, b.y + dy, b.x + hw, b.y + dy);
      }
    },
  },

  { // 4 — derin okyanus: ışık hüzmeleri, kabarcıklar, denizanası bumperlar
    name: 'DERİN OKYANUS',
    hud: '#7fe8dc',
    wallStyle: { color: '#39d0c4', width: 5, blur: 8, dash: null },
    accent: '#2f8fb8', target: '#aef4e4', targetGlow: '#39d0c4',
    saucer: '#2f7fbf', saucerHi: '#9fd0ff',
    flipA: '#d8fff6', flipB: '#39d0c4',
    trail: '#aef4e4', spark: '#bfe8ff',
    ambient: { type: 'bubbles', color: '#bfe8ff', max: 22, rate: 10 },
    bg(c, rng) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#06395c'); g.addColorStop(0.5, '#03274a'); g.addColorStop(1, '#021226');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      // ışık hüzmeleri
      for (let i = 0; i < 4; i++) {
        const x = 60 + rng() * 380, w = 40 + rng() * 60;
        const r = c.createLinearGradient(x, 0, x + 140, H);
        r.addColorStop(0, 'rgba(160, 230, 255, 0.10)');
        r.addColorStop(1, 'rgba(160, 230, 255, 0)');
        c.fillStyle = r;
        c.beginPath();
        c.moveTo(x, 0); c.lineTo(x + w, 0); c.lineTo(x + w + 150, H); c.lineTo(x + 150, H);
        c.closePath(); c.fill();
      }
      // yakamoz benekleri
      c.fillStyle = 'rgba(140, 220, 240, 0.06)';
      for (let i = 0; i < 24; i++) {
        c.beginPath();
        c.ellipse(rng() * W, rng() * H, 18 + rng() * 34, 7 + rng() * 12, rng() * TAU, 0, TAU);
        c.fill();
      }
    },
    drawBumper(c, b, f, t) {
      c.strokeStyle = 'rgba(150, 230, 220, 0.6)'; c.lineWidth = 2.5; c.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        const px = b.x + i * b.r * 0.45;
        c.beginPath();
        c.moveTo(px, b.y + b.r * 0.25);
        c.quadraticCurveTo(px + Math.sin(t * 2.2 + i) * 7, b.y + b.r * 0.9,
                           px + Math.sin(t * 2.2 + i + 1.2) * 9, b.y + b.r * 1.55);
        c.stroke();
      }
      const g = c.createRadialGradient(b.x, b.y - 3, 2, b.x, b.y, b.r);
      g.addColorStop(0, f > 0 ? '#ffffff' : '#d8fff6');
      g.addColorStop(0.7, '#4fd0c4'); g.addColorStop(1, 'rgba(36, 120, 140, 0.92)');
      c.fillStyle = g;
      c.shadowColor = '#7fe8dc'; c.shadowBlur = 12 + f * 18;
      c.beginPath();
      c.arc(b.x, b.y, b.r, Math.PI, 0);
      c.quadraticCurveTo(b.x + b.r * 0.55, b.y + b.r * 0.55, b.x, b.y + b.r * 0.42);
      c.quadraticCurveTo(b.x - b.r * 0.55, b.y + b.r * 0.55, b.x - b.r, b.y);
      c.fill();
      c.shadowBlur = 0;
    },
  },

  { // 5 — volkan: çatlaklı zemin, yükselen korlar, lav küresi bumperlar
    name: 'VOLKAN',
    hud: '#ff9f6b',
    wallStyle: { color: '#ff7a3c', width: 5, blur: 10, dash: null },
    accent: '#c43b2b', target: '#ffd166', targetGlow: '#ffb021',
    saucer: '#8f2413', saucerHi: '#ff9f7a',
    flipA: '#ffd166', flipB: '#ff5f3f',
    trail: '#ffb08a', spark: '#ff9f4a',
    ambient: { type: 'embers', color: '#ff9f4a', max: 24, rate: 12 },
    bg(c, rng) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#170a0a'); g.addColorStop(0.6, '#200c08'); g.addColorStop(1, '#0c0404');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      // magma çatlakları
      c.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        let x = rng() * W, y = rng() * H;
        c.strokeStyle = `rgba(255, ${90 + (rng() * 60) | 0}, 40, ${0.14 + rng() * 0.12})`;
        c.lineWidth = 1.5 + rng() * 1.5;
        c.shadowColor = '#ff6b2f'; c.shadowBlur = 6;
        c.beginPath(); c.moveTo(x, y);
        for (let s = 0; s < 5; s++) {
          x += rng() * 70 - 35; y += 25 + rng() * 45;
          c.lineTo(x, y);
        }
        c.stroke();
      }
      c.shadowBlur = 0;
      // kor benekleri
      for (let i = 0; i < 14; i++) {
        const x = rng() * W, y = rng() * H;
        const r = c.createRadialGradient(x, y, 0, x, y, 14 + rng() * 22);
        r.addColorStop(0, 'rgba(255, 120, 50, 0.16)'); r.addColorStop(1, 'transparent');
        c.fillStyle = r; cFill(c, x, y, 40);
      }
    },
    drawBumper(c, b, f, t) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 3 + b.x * 0.05);
      const g = c.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.r);
      g.addColorStop(0, f > 0 ? '#ffffff' : '#ffe9a8');
      g.addColorStop(0.45, '#ff7a3c'); g.addColorStop(1, '#3a120a');
      c.fillStyle = g;
      c.shadowColor = '#ff7a3c'; c.shadowBlur = 8 + pulse * 10 + f * 20;
      cFill(c, b.x, b.y, b.r);
      c.shadowBlur = 0;
      c.strokeStyle = 'rgba(28, 8, 4, 0.8)'; c.lineWidth = 2;
      c.beginPath(); c.arc(b.x, b.y, b.r * 0.72, 0.4, 1.5); c.stroke();
      c.beginPath(); c.arc(b.x, b.y, b.r * 0.55, 2.6, 3.8); c.stroke();
      c.beginPath(); c.arc(b.x, b.y, b.r * 0.85, 4.2, 5.1); c.stroke();
    },
  },

  { // 6 — galaksi: yıldız alanı, bulutsular, halkalı gezegen bumperlar
    name: 'GALAKSİ',
    hud: '#c7b8ff',
    wallStyle: { color: '#b8a6ff', width: 4, blur: 7, dash: null },
    accent: '#8f5fd8', target: '#ffd9f2', targetGlow: '#ff8fd8',
    saucer: '#c78bff', saucerHi: '#e8d8ff',
    flipA: '#e0d8ff', flipB: '#8f7bff',
    trail: '#cfc3ff', spark: '#e8d8ff',
    ambient: { type: 'stars', color: '#ffffff', max: 14, rate: 6 },
    bg(c, rng) {
      c.fillStyle = '#0a0618'; c.fillRect(0, 0, W, H);
      // bulutsular
      const cols = ['rgba(140, 80, 220, 0.16)', 'rgba(60, 90, 200, 0.14)', 'rgba(220, 80, 170, 0.10)'];
      for (let i = 0; i < 3; i++) {
        const x = rng() * W, y = rng() * H, r = 140 + rng() * 160;
        const n = c.createRadialGradient(x, y, 0, x, y, r);
        n.addColorStop(0, cols[i]); n.addColorStop(1, 'transparent');
        c.fillStyle = n; cFill(c, x, y, r);
      }
      // yıldızlar
      for (let i = 0; i < 110; i++) {
        const x = rng() * W, y = rng() * H, r = rng() < 0.85 ? 0.8 + rng() : 1.6 + rng();
        c.fillStyle = `rgba(255, 255, 255, ${0.25 + rng() * 0.6})`;
        cFill(c, x, y, r);
      }
      // parlak yıldız artıları
      c.strokeStyle = 'rgba(255, 255, 255, 0.5)'; c.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const x = rng() * W, y = rng() * H;
        ln(c, x - 6, y, x + 6, y); ln(c, x, y - 6, x, y + 6);
      }
    },
    drawBumper(c, b, f) {
      const hue = ((b.x * 3 + b.y * 7) | 0) % 360;
      const g = c.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, 2, b.x, b.y, b.r);
      g.addColorStop(0, f > 0 ? '#ffffff' : `hsl(${hue}, 70%, 76%)`);
      g.addColorStop(1, `hsl(${hue}, 62%, 28%)`);
      c.fillStyle = g;
      cFill(c, b.x, b.y, b.r);
      c.save();
      c.translate(b.x, b.y); c.rotate(-0.5);
      c.strokeStyle = `hsla(${(hue + 45) % 360}, 80%, 80%, 0.9)`; c.lineWidth = 3;
      c.beginPath(); c.ellipse(0, 0, b.r * 1.45, b.r * 0.42, 0, 0, TAU); c.stroke();
      c.restore();
      if (f > 0) { c.globalAlpha = f * 0.6; c.fillStyle = '#fff'; cFill(c, b.x, b.y, b.r); c.globalAlpha = 1; }
    },
  },

  { // 7 — orman: yaprak silüetleri, ateşböcekleri, mantar bumperlar
    name: 'ORMAN',
    hud: '#b8e08a',
    wallStyle: { color: '#8fc46b', width: 5, blur: 4, dash: null },
    accent: '#c49a5f', target: '#eaffb0', targetGlow: '#b8e08a',
    saucer: '#4a7a3a', saucerHi: '#c8ffa8',
    flipA: '#e8d0a8', flipB: '#a8783f',
    trail: '#d8f0b0', spark: '#eaffb0',
    ambient: { type: 'fireflies', color: '#ffe98a', max: 12, rate: 5 },
    bg(c, rng) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#12300f'); g.addColorStop(0.55, '#0c2410'); g.addColorStop(1, '#06140a');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      // yaprak silüetleri
      for (let i = 0; i < 26; i++) {
        const x = rng() * W, y = rng() * H, r = 16 + rng() * 30, a = rng() * TAU;
        c.fillStyle = `rgba(${20 + (rng() * 30) | 0}, ${60 + (rng() * 50) | 0}, 30, ${0.10 + rng() * 0.12})`;
        c.beginPath(); c.ellipse(x, y, r, r * 0.42, a, 0, TAU); c.fill();
      }
      // ay ışığı
      const m = c.createRadialGradient(420, 120, 10, 420, 120, 240);
      m.addColorStop(0, 'rgba(230, 255, 200, 0.14)'); m.addColorStop(1, 'transparent');
      c.fillStyle = m; cFill(c, 420, 120, 240);
    },
    drawBumper(c, b, f) {
      // sap
      c.fillStyle = '#efe0c2';
      c.fillRect(b.x - b.r * 0.28, b.y, b.r * 0.56, b.r * 0.8);
      // şapka
      const g = c.createRadialGradient(b.x, b.y - b.r * 0.35, 2, b.x, b.y, b.r);
      g.addColorStop(0, f > 0 ? '#ffffff' : '#ff6b5e');
      g.addColorStop(1, '#a81f1c');
      c.fillStyle = g;
      c.beginPath();
      c.arc(b.x, b.y, b.r, Math.PI, 0);
      c.quadraticCurveTo(b.x, b.y + b.r * 0.32, b.x - b.r, b.y);
      c.fill();
      // benekler
      c.fillStyle = 'rgba(255, 246, 232, 0.95)';
      cFill(c, b.x - b.r * 0.42, b.y - b.r * 0.32, b.r * 0.14);
      cFill(c, b.x + b.r * 0.3, b.y - b.r * 0.5, b.r * 0.12);
      cFill(c, b.x + b.r * 0.05, b.y - b.r * 0.12, b.r * 0.10);
    },
  },

  { // 8 — şeker gecesi: puantiyeler, düşen şeker taneleri, naneli şeker bumperlar
    name: 'ŞEKER',
    hud: '#ff9fc0',
    wallStyle: { color: '#ff8fb3', width: 5, blur: 5, dash: null },
    accent: '#d84f8f', target: '#9fdcff', targetGlow: '#6bb8ff',
    saucer: '#8f4fd8', saucerHi: '#d8b8ff',
    flipA: '#ffd1e0', flipB: '#ff6b9e',
    trail: '#ffd1e0', spark: '#ffd1e0',
    ambient: { type: 'sprinkles', max: 18, rate: 8 },
    bg(c, rng) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#3d1030'); g.addColorStop(1, '#22081e');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      // çapraz şeker şeritleri
      c.save();
      c.rotate(-0.4);
      for (let x = -600; x < W + 400; x += 90) {
        c.fillStyle = 'rgba(255, 160, 200, 0.05)';
        c.fillRect(x, -200, 34, H + 600);
      }
      c.restore();
      // puantiyeler
      const dots = ['rgba(255, 159, 192, 0.14)', 'rgba(159, 220, 255, 0.12)', 'rgba(255, 243, 176, 0.12)'];
      for (let i = 0; i < 30; i++) {
        c.fillStyle = dots[(rng() * 3) | 0];
        cFill(c, rng() * W, rng() * H, 4 + rng() * 8);
      }
    },
    drawBumper(c, b, f, t) {
      const segN = 10, rot = t * 0.7;
      for (let i = 0; i < segN; i++) {
        c.fillStyle = i % 2 ? '#fff6fa' : '#ff4f6e';
        c.beginPath();
        c.moveTo(b.x, b.y);
        c.arc(b.x, b.y, b.r, rot + i * TAU / segN, rot + (i + 1) * TAU / segN);
        c.closePath(); c.fill();
      }
      c.strokeStyle = 'rgba(255, 255, 255, 0.9)'; c.lineWidth = 2.5;
      cStroke(c, b.x, b.y, b.r);
      c.fillStyle = '#fff';
      cFill(c, b.x, b.y, b.r * 0.24);
      if (f > 0) { c.globalAlpha = f * 0.5; c.fillStyle = '#fff'; cFill(c, b.x, b.y, b.r + 3); c.globalAlpha = 1; }
    },
  },
];
let theme = THEMES[0];

/* ---------------- Masa geometrisi (bölüm başına üretilir) ---------------- */
// Segment: {x1,y1,x2,y2, e:restitüsyon, tag}
const segs = [];
function seg(x1, y1, x2, y2, e = 0.5, tag = null) {
  const s = { x1, y1, x2, y2, e, tag, enabled: true };
  segs.push(s);
  return s;
}

const ARC = { cx: 270, cy: 255, r: 255 };
let gateSeg = null, slingL = null, slingR = null;
const bumpers = [];
const targets = [];
const lanes = [];
const saucer = { x: 432, y: 430, r: 20, cooldown: 0, glow: 0, locks: 0 };
const spinner = { y: 500, angle: 0, vel: 0, score: 0 };
let bankResetTimer = 0;
let levelGravity = GRAVITY;
let decoSeed = 1;

// Rastgele bölüm inşası: tema, bumper dizilimi, hedef bankı yönü,
// şerit sayısı, saucer konumu ve yerçekimi tohuma göre değişir.
function buildLevel(seed) {
  const rng = mulberry32(seed);
  decoSeed = (seed ^ 0x5bd1e995) >>> 0;
  theme = THEMES[Math.floor(rng() * THEMES.length)];
  // HUD renklerini temaya uydur
  const root = document.documentElement.style;
  root.setProperty('--hud', theme.hud);
  root.setProperty('--hud-glow', withAlpha(theme.hud, 0.85));
  root.setProperty('--hud-soft', withAlpha(theme.hud, 0.4));
  ambient.length = 0;

  segs.length = 0;
  bumpers.length = 0;
  targets.length = 0;
  lanes.length = 0;
  bankResetTimer = 0;

  // Üst kubbe yayı
  const N = 26;
  let px = ARC.cx + ARC.r * Math.cos(Math.PI), py = ARC.cy + ARC.r * Math.sin(Math.PI);
  for (let i = 1; i <= N; i++) {
    const a = Math.PI + Math.PI * i / N;
    const x = ARC.cx + ARC.r * Math.cos(a), y = ARC.cy + ARC.r * Math.sin(a);
    seg(px, py, x, y, 0.45, 'arc');
    px = x; py = y;
  }

  // Dış duvarlar
  seg(15, 255, 15, 760, 0.5);                    // sol duvar
  seg(525, 255, 525, 940, 0.5);                  // sağ duvar
  seg(15, 760, 147, 848, 0.42, 'funnel');        // sol huni
  seg(LANE_X, 760, 355, 848, 0.42, 'funnel');    // sağ huni
  seg(LANE_X, 345, LANE_X, 760, 0.5);            // kanal iç duvarı
  seg(LANE_X, 940, 525, 940, 0.2, 'laneFloor');  // kanal tabanı
  gateSeg = seg(LANE_X, 315, 525, 278, 0.35, 'gate');  // tek yön kapısı
  gateSeg.enabled = false;

  // Rollover şeritleri: 2-4 adet
  const laneN = 2 + Math.floor(rng() * 3);
  const laneW = 72;
  const laneLeft = 251 - (laneN * laneW) / 2;
  for (let i = 0; i <= laneN; i++) seg(laneLeft + i * laneW, 52, laneLeft + i * laneW, 140, 0.5, 'post');
  for (let i = 0; i < laneN; i++) lanes.push({ x: laneLeft + laneW / 2 + i * laneW, y: 100, lit: false, flash: 0 });

  // Slingshotlar (sabit çerçeve)
  seg(105, 615, 105, 715, 0.4);
  seg(105, 715, 175, 750, 0.4);
  seg(397, 615, 397, 715, 0.4);
  seg(397, 715, 327, 750, 0.4);
  slingL = seg(105, 615, 175, 750, 0.9, 'slingL');
  slingR = seg(397, 615, 327, 750, 0.9, 'slingR');

  // Drop target bankı: sol veya sağ tarafta, 3-4 hedef
  const bankRight = rng() < 0.5;
  const tN = 3 + (rng() < 0.35 ? 1 : 0);
  const tx = bankRight ? 424 : 78;
  const wx = bankRight ? 442 : 60;
  const capDx = bankRight ? -30 : 30;
  const y0 = 400;
  const wallH = tN * 42 + 14;
  seg(wx, y0, wx, y0 + wallH, 0.5);
  seg(wx, y0, wx + capDx, y0 - 6, 0.5);
  seg(wx, y0 + wallH, wx + capDx, y0 + wallH + 6, 0.5);
  for (let i = 0; i < tN; i++) {
    const t = { x: tx, y1: y0 + 10 + i * 42, y2: y0 + 10 + i * 42 + 32, up: true, flash: 0 };
    t.seg = seg(t.x, t.y1, t.x, t.y2, 0.6, 'target');
    t.seg.target = t;
    targets.push(t);
  }

  // Saucer bankın karşı tarafında
  saucer.x = bankRight ? 88 : 432;
  saucer.y = 400 + rng() * 70;
  saucer.locks = 0;
  saucer.cooldown = 0;
  saucer.glow = 0;

  // Bumperlar: 2-4 adet, aday noktalardan seçilip hafifçe kaydırılır
  const spots = [[170, 250], [332, 250], [251, 355], [251, 175], [150, 390], [352, 390], [251, 265]];
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const bN = 2 + Math.floor(rng() * 3);
  for (const [sx, sy] of spots) {
    if (bumpers.length >= bN) break;
    const x = sx + (rng() * 24 - 12), y = sy + (rng() * 24 - 12);
    const r = 26 + rng() * 6;
    if (bumpers.some(b => Math.hypot(b.x - x, b.y - y) < b.r + r + 28)) continue;
    bumpers.push({ x, y, r, flash: 0, kick: 900 + rng() * 160 });
  }

  // Bölüme özgü yerçekimi
  levelGravity = 1700 + rng() * 250;

  spinner.angle = 0;
  spinner.vel = 0;
  spinner.score = 0;

  buildTableCache();
}

/* ---------------- Bölüm hedefleri ---------------- */
function targetFor(level) {
  return Math.round(10000 * Math.pow(1.5, level - 1) / 500) * 500;
}

/* ---------------- Flipperlar ---------------- */
function makeFlipper(px, py, side) {
  return {
    px, py, side,                       // side: 1 = sol, -1 = sağ
    len: 92, r: 11,
    rest: 0.52,                         // ~30° aşağı
    up: -0.48,                          // ~-27.5° yukarı
    angle: 0.52, prevAngle: 0.52,
    pressed: false,
  };
}
const flipL = makeFlipper(147, 856, 1);
const flipR = makeFlipper(355, 856, -1);

function flipperDir(f, a) {
  return { x: f.side * Math.cos(a), y: Math.sin(a) };
}
function flipperTip(f, a) {
  const d = flipperDir(f, a);
  return { x: f.px + d.x * f.len, y: f.py + d.y * f.len };
}
function updateFlipper(f, dt) {
  f.prevAngle = f.angle;
  const target = f.pressed ? f.up : f.rest;
  const speed = f.pressed ? 22 : 14;    // rad/s
  if (f.angle < target) f.angle = Math.min(target, f.angle + speed * dt);
  else if (f.angle > target) f.angle = Math.max(target, f.angle - speed * dt);
}

/* ---------------- Oyun durumu ---------------- */
const state = {
  mode: 'menu',            // menu | playing | paused | gameover
  score: 0,
  displayScore: 0,
  hiscore: 0,
  balls: 3,                // kalan top hakkı
  mult: 1,
  ballSave: 0,
  multiball: false,
  extraGiven: [],
  shake: 0,
  glow: 0,
  time: 0,
  serveTimer: 0,
  level: 1,                // bölüm sistemi
  levelScore: 0,
  levelTarget: 10000,
  levelPhase: null,        // null | 'celebrate'
  levelTimer: 0,
};

try { state.hiscore = parseInt(localStorage.getItem('neonpinball.hiscore') || '0', 10) || 0; } catch (_) {}

const activeBalls = [];    // {x,y,vx,vy, inLane, trail:[]}
let serveBall = null;      // fırlatma bekleyen top
let plunger = { pull: 0, active: false };
let laneOpen = true;       // kapı durumu

/* ---------------- Parçacıklar & popup ---------------- */
const particles = [];
const ambient = [];
function spawnParticles(x, y, color, n, speed = 260) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(speed * 0.3, speed);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), t: 0, color, size: rand(1.5, 3.5) });
  }
}
const popups = [];
function popup(x, y, text, color = '#ffd166') {
  popups.push({ x, y, text, color, t: 0, life: 1.0 });
}

/* ---------------- Skor ---------------- */
const scoreEl = document.getElementById('score');
const multEl = document.getElementById('mult');
const ballsEl = document.getElementById('balls');
const bannerEl = document.getElementById('banner');

function addScore(base, x, y, label) {
  const pts = base * state.mult * (state.multiball ? 2 : 1);
  state.score += pts;
  state.levelScore += pts;
  if (x !== undefined) popup(x, y, '+' + fmt(pts));
  if (state.mode === 'playing' && !state.levelPhase && state.levelScore >= state.levelTarget) beginLevelUp();
  scoreEl.classList.remove('bump');
  void scoreEl.offsetWidth;
  scoreEl.classList.add('bump');
  for (const th of EXTRA_BALL_AT) {
    if (state.score >= th && !state.extraGiven.includes(th)) {
      state.extraGiven.push(th);
      state.balls++;
      banner('EKSTRA TOP!');
      SFX.extraBall(); buzz(60);
      updateHud();
    }
  }
  if (label) banner(label);
}
function fmt(n) { return n.toLocaleString('tr-TR'); }

let bannerTimer = null;
function banner(text) {
  bannerEl.textContent = text;
  bannerEl.classList.remove('show');
  void bannerEl.offsetWidth;
  bannerEl.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), 1700);
}

const levelEl = document.getElementById('level');
const goalBarEl = document.getElementById('goal-bar');
const goalLabelEl = document.getElementById('goal-label');
let lastGoalPct = -1;

function updateHud() {
  multEl.textContent = 'x' + state.mult * (state.multiball ? 2 : 1);
  ballsEl.textContent = '●'.repeat(Math.max(0, state.balls)) || '—';
  levelEl.textContent = 'B' + state.level;
  goalLabelEl.textContent = 'HEDEF ' + fmt(state.levelTarget);
}

function updateGoalBar() {
  const pct = Math.min(100, Math.round(state.levelScore / state.levelTarget * 100));
  if (pct !== lastGoalPct) {
    lastGoalPct = pct;
    goalBarEl.style.width = pct + '%';
  }
}

/* ---------------- Bölüm geçişi ---------------- */
function beginLevelUp() {
  state.levelPhase = 'celebrate';
  state.levelTimer = 1.8;
  const bonus = 2500 * state.level;
  state.score += bonus;
  activeBalls.length = 0;
  serveBall = null;
  spawnParticles(251, 480, theme.target, 40, 420);
  banner('BÖLÜM ' + state.level + ' TAMAM! +' + fmt(bonus));
  SFX.multiball(); buzz([50, 60, 50, 60, 90]);
}

function advanceLevel() {
  state.level++;
  state.balls = Math.min(5, state.balls + 1);   // bölüm ödülü: +1 top
  state.levelScore = 0;
  state.levelTarget = targetFor(state.level);
  state.levelPhase = null;
  state.mult = 1;
  state.multiball = false;
  buildLevel((Math.random() * 2 ** 31) | 0);
  newServe();
  banner('BÖLÜM ' + state.level + ' • ' + theme.name);
  SFX.extraBall();
  updateHud();
}

/* ---------------- Top yönetimi ---------------- */
function newServe() {
  serveBall = { x: 506, y: 902, vx: 0, vy: 0, trail: [] };
  laneOpen = true;
  gateSeg.enabled = false;
  plunger.pull = 0;
  state.ballSave = BALL_SAVE_TIME;
}

function launchBall(power) {
  if (!serveBall) return;
  const b = serveBall;
  serveBall = null;
  b.vy = -(1150 + 750 * power);
  b.vx = 0;
  activeBalls.push(b);
  SFX.launch(); buzz(30);
}

function spawnMultiballBalls() {
  for (let i = 0; i < 2; i++) {
    activeBalls.push({
      x: saucer.x + rand(-4, 4), y: saucer.y,
      vx: rand(-350, -150) - i * 120, vy: rand(-620, -420),
      trail: [],
    });
  }
}

function drainBall(b) {
  const idx = activeBalls.indexOf(b);
  if (idx >= 0) activeBalls.splice(idx, 1);
  spawnParticles(b.x, clamp(b.y, 0, H - 10), '#ff5f9e', 14, 200);

  if (activeBalls.length > 0) {
    if (activeBalls.length === 1 && state.multiball) {
      state.multiball = false;
      banner('MULTIBALL BİTTİ');
      updateHud();
    }
    return;
  }

  state.multiball = false;

  if (state.ballSave > 0) {
    banner('TOP KURTARILDI!');
    SFX.ballSave();
    newServe();
    return;
  }

  SFX.drain(); buzz([40, 60, 40]);
  state.balls--;
  updateHud();

  if (state.balls <= 0) {
    gameOver();
  } else {
    state.mult = 1;
    saucer.locks = 0;
    updateHud();
    state.serveTimer = 0.9;   // kısa gecikmeyle yeni servis
  }
}

/* ---------------- Oyun akışı ---------------- */
const overlay = document.getElementById('overlay');
const panelMenu = document.getElementById('panel-menu');
const panelOver = document.getElementById('panel-over');
const panelPause = document.getElementById('panel-pause');

function showPanel(p) {
  overlay.classList.remove('hidden');
  [panelMenu, panelOver, panelPause].forEach(x => x.classList.add('hidden'));
  if (p) p.classList.remove('hidden');
  else overlay.classList.add('hidden');
}

function startGame() {
  state.mode = 'playing';
  state.score = 0;
  state.displayScore = 0;
  state.balls = 3;
  state.mult = 1;
  state.multiball = false;
  state.extraGiven = [];
  state.level = 1;
  state.levelScore = 0;
  state.levelTarget = targetFor(1);
  state.levelPhase = null;
  activeBalls.length = 0;
  particles.length = 0;
  popups.length = 0;
  buildLevel((Math.random() * 2 ** 31) | 0);   // her oyun rastgele bölüm
  scoreEl.textContent = '0';
  updateHud();
  newServe();
  showPanel(null);
  banner('BÖLÜM 1 • ' + theme.name);
}

function gameOver() {
  state.mode = 'gameover';
  SFX.gameOver();
  const isRecord = state.score > state.hiscore;
  if (isRecord) {
    state.hiscore = state.score;
    try { localStorage.setItem('neonpinball.hiscore', String(state.hiscore)); } catch (_) {}
  }
  document.getElementById('final-score').textContent = fmt(state.score);
  document.getElementById('new-record').classList.toggle('hidden', !isRecord);
  document.querySelector('#over-hiscore span').textContent = fmt(state.hiscore);
  showPanel(panelOver);
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  showPanel(panelPause);
}
function resumeGame() {
  if (state.mode !== 'paused') return;
  state.mode = 'playing';
  showPanel(null);
  lastTime = performance.now();
}

/* ---------------- Fizik ---------------- */
function collideSegment(b, s, dt) {
  if (!s.enabled) return false;
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  let t = ((b.x - s.x1) * dx + (b.y - s.y1) * dy) / len2;
  t = clamp(t, 0, 1);
  const qx = s.x1 + dx * t, qy = s.y1 + dy * t;
  let nx = b.x - qx, ny = b.y - qy;
  const d2 = nx * nx + ny * ny;
  if (d2 >= BALL_R * BALL_R) return false;
  const d = Math.sqrt(d2) || 0.0001;
  nx /= d; ny /= d;
  b.x += nx * (BALL_R - d);
  b.y += ny * (BALL_R - d);
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + s.e) * vn * nx;
    b.vy -= (1 + s.e) * vn * ny;
    // teğetsel sürtünme
    b.vx *= 0.995; b.vy *= 0.995;
    if (vn < -240 && !s.tag) SFX.wall();
    handleSegmentHit(b, s, vn, qx, qy);
  }
  return true;
}

function handleSegmentHit(b, s, vn, qx, qy) {
  if (s.tag === 'slingL' || s.tag === 'slingR') {
    // slingshot tekmesi
    const nx = s.tag === 'slingL' ? 0.72 : -0.72;
    b.vx += nx * 620;
    b.vy -= 480;
    addScore(75, qx, qy);
    spawnParticles(qx, qy, theme.flipA, 10, 320);
    SFX.sling(); buzz(15);
    state.glow = Math.max(state.glow, 0.5);
    (s.tag === 'slingL' ? slingL : slingR).flash = 0.25;
  } else if (s.tag === 'target' && s.target && s.target.up) {
    const t = s.target;
    t.up = false;
    t.seg.enabled = false;
    t.flash = 0.4;
    addScore(1000, qx, qy);
    spawnParticles(qx, qy, theme.target, 12, 280);
    SFX.target(); buzz(20);
    if (targets.every(x => !x.up)) {
      state.mult = Math.min(8, state.mult + 1);
      addScore(7500);
      banner('BANK TAMAM! x' + state.mult);
      SFX.bank(); buzz([30, 40, 30]);
      bankResetTimer = 1.2;
      updateHud();
    }
  }
}

function collideBumper(b, bp) {
  const dx = b.x - bp.x, dy = b.y - bp.y;
  const rr = bp.r + BALL_R;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return;
  const d = Math.sqrt(d2) || 0.0001;
  const nx = dx / d, ny = dy / d;
  b.x = bp.x + nx * rr;
  b.y = bp.y + ny * rr;
  // dışarı doğru sabit hızlı tekme + mevcut teğet bileşen
  const vn = b.vx * nx + b.vy * ny;
  b.vx -= vn * nx; b.vy -= vn * ny;
  b.vx += nx * bp.kick;
  b.vy += ny * bp.kick;
  bp.flash = 0.3;
  addScore(150, bp.x + nx * bp.r, bp.y + ny * bp.r);
  spawnParticles(b.x, b.y, theme.spark, 8, 300);
  SFX.bumper(); buzz(12);
  state.glow = Math.max(state.glow, 0.6);
  state.shake = Math.max(state.shake, 3);
}

function collideFlipper(b, f, dt) {
  const a = f.angle;
  const dir = flipperDir(f, a);
  const dx = dir.x * f.len, dy = dir.y * f.len;
  const len2 = dx * dx + dy * dy;
  let t = ((b.x - f.px) * dx + (b.y - f.py) * dy) / len2;
  t = clamp(t, 0, 1);
  const qx = f.px + dx * t, qy = f.py + dy * t;
  let nx = b.x - qx, ny = b.y - qy;
  const rr = BALL_R + f.r;
  const d2 = nx * nx + ny * ny;
  if (d2 >= rr * rr) return;
  const d = Math.sqrt(d2) || 0.0001;
  nx /= d; ny /= d;
  b.x += nx * (rr - d);
  b.y += ny * (rr - d);
  // temas noktasının hızı (sayısal): önceki açıyla aynı t paramındaki nokta
  const pd = flipperDir(f, f.prevAngle);
  const pqx = f.px + pd.x * f.len * t, pqy = f.py + pd.y * f.len * t;
  const pvx = (qx - pqx) / dt, pvy = (qy - pqy) / dt;
  const rvx = b.vx - pvx, rvy = b.vy - pvy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    const e = 0.35;
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
  }
}

function ballVsBall(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const rr = BALL_R * 2;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr || d2 === 0) return;
  const d = Math.sqrt(d2);
  const nx = dx / d, ny = dy / d;
  const pen = (rr - d) / 2;
  a.x -= nx * pen; a.y -= ny * pen;
  b.x += nx * pen; b.y += ny * pen;
  const van = a.vx * nx + a.vy * ny;
  const vbn = b.vx * nx + b.vy * ny;
  if (van - vbn > 0) {
    const e = 0.9;
    const ja = ((1 + e) / 2) * (vbn - van);
    a.vx += ja * nx; a.vy += ja * ny;
    b.vx -= ja * nx; b.vy -= ja * ny;
  }
}

function stepBall(b, dt) {
  b.vy += levelGravity * dt;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }
  const prevY = b.y, prevX = b.x;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  for (const s of segs) collideSegment(b, s, dt);
  for (const bp of bumpers) collideBumper(b, bp);
  collideFlipper(b, flipL, dt);
  collideFlipper(b, flipR, dt);

  // --- kanal kapısı mantığı ---
  const inLane = b.x > LANE_X - BALL_R;
  if (laneOpen && !inLane && b.y < 400) {
    laneOpen = false;
    gateSeg.enabled = true;
  }

  // --- spinner: kanal içinde y=500 çizgisini geçiş ---
  if (inLane && ((prevY < spinner.y) !== (b.y < spinner.y))) {
    const sp2 = Math.abs(b.vy);
    spinner.vel = Math.max(spinner.vel, sp2 * 0.05);
    spinner.score += 4 + ((sp2 / 260) | 0);
  }

  // --- rollover şeritleri ---
  for (const l of lanes) {
    const dx = b.x - l.x, dy = b.y - l.y;
    if (dx * dx + dy * dy < 26 * 26 && !l.hot) {
      l.hot = true;
      if (!l.lit) {
        l.lit = true;
        l.flash = 0.5;
        addScore(500, l.x, l.y);
        SFX.lane();
        if (lanes.every(x => x.lit)) {
          addScore(5000);
          banner('ŞERİTLER TAMAM!');
          SFX.lanesAll(); buzz(40);
          setTimeout(() => lanes.forEach(x => x.lit = false), 900);
        }
      }
    } else if (dx * dx + dy * dy > 34 * 34) {
      l.hot = false;
    }
  }

  // --- saucer (çukur) ---
  if (saucer.cooldown <= 0) {
    const dx = b.x - saucer.x, dy = b.y - saucer.y;
    if (dx * dx + dy * dy < saucer.r * saucer.r) {
      captureSaucer(b);
    }
  }

  // --- servis kanalına geri düşme ---
  if (inLane && b.y > 890 && Math.abs(b.vy) < 80 && Math.abs(b.vx) < 80 && !serveBall) {
    const idx = activeBalls.indexOf(b);
    if (idx >= 0) activeBalls.splice(idx, 1);
    newServe();
    return;
  }

  if (b.y > DRAIN_Y) drainBall(b);
}

function captureSaucer(b) {
  const idx = activeBalls.indexOf(b);
  if (idx >= 0) activeBalls.splice(idx, 1);
  saucer.cooldown = 5;
  saucer.glow = 1;
  saucer.locks++;
  SFX.saucer(); buzz(30);
  spawnParticles(saucer.x, saucer.y, theme.saucerHi, 16, 240);

  const held = { x: saucer.x, y: saucer.y };
  if (saucer.locks >= 3) {
    addScore(15000, saucer.x, saucer.y - 30);
    banner('MULTIBALL!');
    saucer.locks = 0;
    setTimeout(() => {
      if (state.mode !== 'playing') return;
      state.multiball = true;
      updateHud();
      SFX.multiball(); buzz([40, 60, 40, 60, 80]);
      ejectSaucer(held);
      spawnMultiballBalls();
    }, 900);
  } else {
    addScore(5000, saucer.x, saucer.y - 30);
    banner('KİLİT ' + saucer.locks + '/3');
    setTimeout(() => {
      if (state.mode !== 'playing') return;
      ejectSaucer(held);
    }, 800);
  }
}

function ejectSaucer(pos) {
  activeBalls.push({ x: pos.x, y: pos.y, vx: rand(-520, -420), vy: rand(-540, -440), trail: [] });
  SFX.eject();
}

/* ---------------- Güncelleme ---------------- */
function update(dt) {
  state.time += dt;

  // Bölüm geçiş kutlaması: toplar temizlendi, sayaç bitince yeni bölüm kur
  if (state.levelPhase === 'celebrate') {
    state.levelTimer -= dt;
    if (state.levelTimer <= 0) advanceLevel();
  }

  if (state.ballSave > 0) state.ballSave -= dt;
  if (saucer.cooldown > 0) saucer.cooldown -= dt;
  if (saucer.glow > 0) saucer.glow -= dt * 1.4;
  if (state.glow > 0) state.glow -= dt * 2;
  if (state.shake > 0) state.shake -= dt * 24;

  if (bankResetTimer > 0) {
    bankResetTimer -= dt;
    if (bankResetTimer <= 0) {
      targets.forEach(t => { t.up = true; t.seg.enabled = true; t.flash = 0.3; });
    }
  }

  if (state.serveTimer > 0) {
    state.serveTimer -= dt;
    if (state.serveTimer <= 0) newServe();
  }

  updateAmbient(dt);

  // spinner
  if (spinner.vel > 0.01) {
    spinner.angle += spinner.vel * dt * 12;
    spinner.vel *= Math.pow(0.35, dt);
    if (spinner.score > 0 && Math.random() < dt * 14) {
      addScore(200, 506, spinner.y);
      spinner.score--;
      SFX.spinner();
    }
  } else {
    spinner.score = 0;
  }

  // plunger şarjı
  if (serveBall && plunger.active) plunger.pull = Math.min(1, plunger.pull + dt * 1.4);

  // fizik alt adımları
  const sub = Math.max(1, Math.round(dt / STEP));
  const sdt = dt / sub;
  for (let i = 0; i < sub; i++) {
    updateFlipper(flipL, sdt);
    updateFlipper(flipR, sdt);
    for (const b of [...activeBalls]) stepBall(b, sdt);
    for (let a = 0; a < activeBalls.length; a++)
      for (let c = a + 1; c < activeBalls.length; c++)
        ballVsBall(activeBalls[a], activeBalls[c]);
  }

  // izler
  for (const b of activeBalls) {
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 10) b.trail.shift();
  }

  // parçacıklar
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    if (p.t >= p.life) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 600 * dt;
    p.vx *= 0.98; p.vy *= 0.98;
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.t += dt;
    if (p.t >= p.life) popups.splice(i, 1);
  }

  // flaşlar
  bumpers.forEach(b => b.flash = Math.max(0, b.flash - dt));
  targets.forEach(t => t.flash = Math.max(0, t.flash - dt));
  lanes.forEach(l => l.flash = Math.max(0, l.flash - dt));
  if (slingL.flash) slingL.flash = Math.max(0, slingL.flash - dt);
  if (slingR.flash) slingR.flash = Math.max(0, slingR.flash - dt);

  // skor animasyonu
  if (state.displayScore !== state.score) {
    const diff = state.score - state.displayScore;
    state.displayScore += Math.ceil(diff * Math.min(1, dt * 12));
    scoreEl.textContent = fmt(state.displayScore);
  }
  updateGoalBar();
}

/* ---------------- Çizim ---------------- */
let tableCache = null;

function buildTableCache() {
  tableCache = document.createElement('canvas');
  tableCache.width = Math.max(1, canvas.width);
  tableCache.height = Math.max(1, canvas.height);
  const c = tableCache.getContext('2d');
  c.scale(viewScale, viewScale);
  const rng = mulberry32(decoSeed);

  // temaya özgü arkaplan
  theme.bg(c, rng);

  // duvarlar (tema duvar stiliyle)
  const ws = theme.wallStyle;
  c.lineCap = ws.dash ? 'butt' : 'round';
  c.setLineDash(ws.dash || []);
  function strokeSeg(s, width) {
    c.strokeStyle = ws.color;
    c.shadowColor = ws.color;
    c.shadowBlur = ws.blur;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(s.x1, s.y1);
    c.lineTo(s.x2, s.y2);
    c.stroke();
  }
  for (const s of segs) {
    if (s.tag === 'gate' || s.tag === 'target' || s.tag === 'slingL' || s.tag === 'slingR') continue;
    strokeSeg(s, s.tag === 'post' ? Math.max(2, ws.width - 1.5) : ws.width);
  }
  c.setLineDash([]);
  c.shadowBlur = 0;
  c.lineCap = 'round';

  // slingshot gövdeleri
  for (const pts of [
    [[105, 615], [105, 715], [175, 750]],
    [[397, 615], [397, 715], [327, 750]],
  ]) {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    pts.slice(1).forEach(p => c.lineTo(p[0], p[1]));
    c.closePath();
    c.fillStyle = withAlpha(theme.accent, 0.2);
    c.fill();
    c.strokeStyle = theme.accent;
    c.shadowColor = theme.accent; c.shadowBlur = 8;
    c.lineWidth = 3;
    c.stroke();
    c.shadowBlur = 0;
  }

  // saucer yuvası
  c.beginPath();
  c.arc(saucer.x, saucer.y, saucer.r + 4, 0, TAU);
  c.strokeStyle = theme.saucer;
  c.shadowColor = theme.saucer; c.shadowBlur = 12;
  c.lineWidth = 3;
  c.stroke();
  c.shadowBlur = 0;
  c.fillStyle = withAlpha(theme.saucer, 0.15);
  c.fill();

  // tema adı filigranı
  c.save();
  c.textAlign = 'center';
  c.fillStyle = withAlpha(theme.hud, 0.12);
  c.font = '900 42px "Segoe UI", Roboto, sans-serif';
  c.fillText(theme.name, 251, 662);
  c.font = '800 20px "Segoe UI", Roboto, sans-serif';
  c.fillStyle = withAlpha(theme.hud, 0.08);
  c.fillText('PINBALL', 251, 692);
  c.restore();

  // fırlatma kanalı okları
  c.save();
  c.fillStyle = withAlpha(theme.hud, 0.25);
  for (let i = 0; i < 3; i++) {
    const y = 700 + i * 55;
    c.beginPath();
    c.moveTo(506, y);
    c.lineTo(496, y + 18);
    c.lineTo(516, y + 18);
    c.closePath();
    c.fill();
  }
  c.restore();
}

function draw() {
  ctx.setTransform(viewScale, 0, 0, viewScale, 0, 0);
  if (state.shake > 0) {
    ctx.translate(rand(-state.shake, state.shake), rand(-state.shake, state.shake));
  }

  if (tableCache) ctx.drawImage(tableCache, 0, 0, W, H);

  // genel parlama (olay vurgusu)
  if (state.glow > 0.02) {
    ctx.fillStyle = withAlpha(theme.spark, state.glow * 0.06);
    ctx.fillRect(0, 0, W, H);
  }

  drawAmbient();
  drawLanes();
  drawBumpers();
  drawTargets();
  drawSaucer();
  drawSpinner();
  drawGate();
  drawSlingFlash();
  drawFlippers();
  drawPlunger();
  for (const b of activeBalls) drawBall(b);
  if (serveBall) drawBall(serveBall);
  drawParticles();
  drawPopups();
  drawBallSave();
}

function drawLanes() {
  for (const l of lanes) {
    const on = l.lit;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 11, 0, TAU);
    ctx.fillStyle = on ? theme.target : withAlpha(theme.target, 0.12);
    if (on || l.flash > 0) {
      ctx.shadowColor = theme.targetGlow;
      ctx.shadowBlur = 16;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = withAlpha(theme.target, 0.5);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawBumpers() {
  for (const b of bumpers) {
    const f = b.flash > 0 ? b.flash / 0.3 : 0;
    ctx.save();
    theme.drawBumper(ctx, b, f, state.time);
    ctx.restore();
  }
}

/* ---------------- Ortam parçacıkları (temaya özgü) ---------------- */
let scanY = -40;
function updateAmbient(dt) {
  const a = theme.ambient;
  if (!a) { ambient.length = 0; return; }
  if (a.type === 'scan') {
    scanY += 130 * dt;
    if (scanY > H + 60) scanY = -60;
    return;
  }
  if (ambient.length < a.max && Math.random() < a.rate * dt) {
    const p = { type: a.type, x: rand(24, W - 24), y: 0, vx: 0, vy: 0, r: rand(1.5, 4), phase: rand(0, TAU), life: 0, maxLife: rand(4, 9) };
    if (a.type === 'bubbles') { p.y = H + 10; p.vy = -rand(25, 70); }
    else if (a.type === 'embers') { p.y = H + 10; p.vy = -rand(50, 130); p.vx = rand(-15, 15); }
    else if (a.type === 'sprinkles') {
      p.y = -10; p.vy = rand(25, 55); p.rot = rand(0, TAU);
      p.color = ['#ff9fc0', '#9fdcff', '#fff3b0', '#c8ffb0'][(Math.random() * 4) | 0];
    } else if (a.type === 'fireflies') { p.y = rand(60, H - 120); p.vx = rand(-20, 20); p.vy = rand(-15, 15); p.maxLife = rand(6, 12); }
    else if (a.type === 'stars') { p.y = rand(30, 420); p.maxLife = rand(3, 7); }
    ambient.push(p);
  }
  for (let i = ambient.length - 1; i >= 0; i--) {
    const p = ambient[i];
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.type === 'bubbles') p.x += Math.sin(p.life * 3 + p.phase) * 20 * dt;
    if (p.type === 'fireflies') {
      p.vx = clamp(p.vx + rand(-40, 40) * dt, -30, 30);
      p.vy = clamp(p.vy + rand(-40, 40) * dt, -30, 30);
    }
    if (p.life > p.maxLife || p.y < -20 || p.y > H + 30) ambient.splice(i, 1);
  }
}

function drawAmbient() {
  const a = theme.ambient;
  if (!a) return;
  if (a.type === 'scan') {
    ctx.fillStyle = 'rgba(120, 255, 150, 0.05)';
    ctx.fillRect(0, scanY - 14, W, 28);
    ctx.fillStyle = 'rgba(160, 255, 180, 0.10)';
    ctx.fillRect(0, scanY - 3, W, 6);
    return;
  }
  for (const p of ambient) {
    const fade = Math.min(1, p.life * 2, p.maxLife - p.life);
    if (p.type === 'bubbles') {
      ctx.globalAlpha = 0.35 * fade;
      ctx.strokeStyle = a.color; ctx.lineWidth = 1.5;
      cStroke(ctx, p.x, p.y, p.r + 1.5);
    } else if (p.type === 'embers') {
      ctx.globalAlpha = (0.35 + 0.4 * Math.sin(p.life * 12 + p.phase)) * fade;
      ctx.fillStyle = a.color;
      cFill(ctx, p.x, p.y, p.r * 0.8);
    } else if (p.type === 'fireflies') {
      ctx.globalAlpha = (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(p.life * 4 + p.phase))) * fade;
      ctx.fillStyle = a.color;
      ctx.shadowColor = a.color; ctx.shadowBlur = 8;
      cFill(ctx, p.x, p.y, 2.2);
      ctx.shadowBlur = 0;
    } else if (p.type === 'stars') {
      ctx.globalAlpha = (0.3 + 0.6 * (0.5 + 0.5 * Math.sin(p.life * 3 + p.phase))) * fade;
      ctx.fillStyle = a.color;
      cFill(ctx, p.x, p.y, 1.6);
    } else if (p.type === 'sprinkles') {
      ctx.save();
      ctx.globalAlpha = Math.min(0.8, 0.8 * fade);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot + p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-4, -1.5, 8, 3);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

function drawTargets() {
  for (const t of targets) {
    const cy = (t.y1 + t.y2) / 2;
    if (t.up) {
      ctx.fillStyle = theme.target;
      ctx.shadowColor = theme.targetGlow;
      ctx.shadowBlur = 12;
      ctx.fillRect(t.x - 4, t.y1, 8, t.y2 - t.y1);
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = withAlpha(theme.target, 0.15);
      ctx.fillRect(t.x - 3, t.y1, 6, t.y2 - t.y1);
      if (t.flash > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${t.flash})`;
        ctx.fillRect(t.x - 6, t.y1 - 3, 12, t.y2 - t.y1 + 6);
      }
    }
  }
}

function drawSaucer() {
  const pulse = 0.5 + 0.5 * Math.sin(state.time * 3);
  ctx.beginPath();
  ctx.arc(saucer.x, saucer.y, saucer.r - 5, 0, TAU);
  ctx.fillStyle = withAlpha(theme.saucer, 0.25 + 0.3 * pulse + saucer.glow * 0.4);
  ctx.shadowColor = theme.saucerHi;
  ctx.shadowBlur = 10 + saucer.glow * 30;
  ctx.fill();
  ctx.shadowBlur = 0;
  // kilit göstergeleri
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(saucer.x - 16 + i * 16, saucer.y + saucer.r + 14, 4, 0, TAU);
    ctx.fillStyle = i < saucer.locks ? theme.saucerHi : withAlpha(theme.saucerHi, 0.2);
    if (i < saucer.locks) { ctx.shadowColor = theme.saucerHi; ctx.shadowBlur = 8; }
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawSpinner() {
  const cx = (LANE_X + 525) / 2, cy = spinner.y;
  const w = 16 * Math.abs(Math.cos(spinner.angle));
  ctx.save();
  ctx.strokeStyle = theme.flipA;
  ctx.shadowColor = theme.flipA;
  ctx.shadowBlur = spinner.vel > 0.5 ? 14 : 6;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - w, cy);
  ctx.lineTo(cx + w, cy);
  ctx.stroke();
  ctx.restore();
}

function drawGate() {
  if (!gateSeg.enabled) return;
  ctx.strokeStyle = withAlpha(theme.accent, 0.85);
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur = 8;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(gateSeg.x1, gateSeg.y1);
  ctx.lineTo(gateSeg.x2, gateSeg.y2);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawSlingFlash() {
  for (const s of [slingL, slingR]) {
    if (!s.flash) continue;
    ctx.strokeStyle = `rgba(255, 255, 255, ${s.flash * 3})`;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowColor = theme.accent;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function drawFlippers() {
  for (const f of [flipL, flipR]) {
    const tip = flipperTip(f, f.angle);
    const grad = ctx.createLinearGradient(f.px, f.py, tip.x, tip.y);
    grad.addColorStop(0, theme.flipA);
    grad.addColorStop(1, theme.flipB);
    ctx.strokeStyle = grad;
    ctx.lineWidth = f.r * 2;
    ctx.lineCap = 'round';
    ctx.shadowColor = theme.flipB;
    ctx.shadowBlur = f.pressed ? 22 : 10;
    ctx.beginPath();
    ctx.moveTo(f.px, f.py);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // pivot
    ctx.beginPath();
    ctx.arc(f.px, f.py, f.r + 3, 0, TAU);
    ctx.fillStyle = '#1a2350';
    ctx.fill();
    ctx.strokeStyle = theme.flipA;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawPlunger() {
  if (!serveBall) return;
  const baseY = 940;
  const y = baseY - 8 + plunger.pull * 0;
  // yay
  ctx.strokeStyle = theme.hud;
  ctx.lineWidth = 3;
  ctx.shadowColor = theme.hud;
  ctx.shadowBlur = 8;
  const top = serveBall.y + BALL_R + 4 + plunger.pull * 10;
  ctx.beginPath();
  const coils = 5;
  for (let i = 0; i <= coils * 8; i++) {
    const t = i / (coils * 8);
    const yy = top + (y - top - 6) * t;
    const xx = 506 + Math.sin(t * coils * TAU) * 9;
    if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  // güç göstergesi
  if (plunger.pull > 0) {
    const barH = 120 * plunger.pull;
    ctx.fillStyle = plunger.pull > 0.8 ? theme.accent : theme.hud;
    ctx.fillRect(530, 900 - barH, 6, barH);
  }
  // ipucu halkası
  const pulse = 0.5 + 0.5 * Math.sin(state.time * 4);
  ctx.beginPath();
  ctx.arc(506, serveBall.y, BALL_R + 8 + pulse * 4, 0, TAU);
  ctx.strokeStyle = withAlpha(theme.hud, 0.5 - pulse * 0.3);
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawBall(b) {
  // iz
  if (b.trail && b.trail.length > 1) {
    for (let i = 0; i < b.trail.length; i++) {
      const t = i / b.trail.length;
      ctx.beginPath();
      ctx.arc(b.trail[i].x, b.trail[i].y, BALL_R * t * 0.8, 0, TAU);
      ctx.fillStyle = withAlpha(theme.trail, t * 0.16);
      ctx.fill();
    }
  }
  const g = ctx.createRadialGradient(b.x - 4, b.y - 5, 2, b.x, b.y, BALL_R);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.4, '#dfe9ff');
  g.addColorStop(1, '#8194c9');
  ctx.beginPath();
  ctx.arc(b.x, b.y, BALL_R, 0, TAU);
  ctx.fillStyle = g;
  ctx.shadowColor = 'rgba(160, 200, 255, 0.9)';
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawParticles() {
  for (const p of particles) {
    const a = 1 - p.t / p.life;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawPopups() {
  ctx.textAlign = 'center';
  ctx.font = '800 20px "Segoe UI", Roboto, sans-serif';
  for (const p of popups) {
    const a = 1 - p.t / p.life;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.fillText(p.text, clamp(p.x, 40, W - 40), p.y - p.t * 50);
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawBallSave() {
  if (state.ballSave <= 0 || state.mode !== 'playing') return;
  const blink = state.ballSave < 3 ? (Math.sin(state.time * 12) > 0) : true;
  if (!blink) return;
  ctx.textAlign = 'center';
  ctx.font = '700 13px "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = withAlpha(theme.hud, 0.7);
  ctx.shadowColor = theme.hud;
  ctx.shadowBlur = 8;
  ctx.fillText('◆ TOP KORUMASI ◆', 251, 935);
  ctx.shadowBlur = 0;
}

/* ---------------- Girdi ---------------- */
const touches = new Map();   // pointerId -> 'L' | 'R' | 'P'

function pointerZone(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width * W;
  const y = (e.clientY - rect.top) / rect.height * H;
  if (serveBall && x > LANE_X - 40 && y > 560) return 'P';
  return x < W / 2 ? 'L' : 'R';
}

function pressZone(z) {
  if (z === 'L') { if (!flipL.pressed) SFX.flipper(); flipL.pressed = true; }
  else if (z === 'R') { if (!flipR.pressed) SFX.flipper(); flipR.pressed = true; }
  else if (z === 'P') { plunger.active = true; }
}
function releaseZone(z) {
  if (z === 'L') flipL.pressed = false;
  else if (z === 'R') flipR.pressed = false;
  else if (z === 'P') {
    plunger.active = false;
    if (serveBall && plunger.pull > 0.05) launchBall(plunger.pull);
    plunger.pull = 0;
  }
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  SFX.ensure();
  if (state.mode !== 'playing') return;
  const z = pointerZone(e);
  touches.set(e.pointerId, z);
  pressZone(z);
});
window.addEventListener('pointerup', e => {
  const z = touches.get(e.pointerId);
  if (z) { touches.delete(e.pointerId); releaseZone(z); }
});
window.addEventListener('pointercancel', e => {
  const z = touches.get(e.pointerId);
  if (z) { touches.delete(e.pointerId); releaseZone(z); }
});

// klavye (masaüstü testi)
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  SFX.ensure();
  if (e.code === 'ArrowLeft' || e.code === 'KeyZ') pressZone('L');
  else if (e.code === 'ArrowRight' || e.code === 'Slash' || e.code === 'KeyM') pressZone('R');
  else if (e.code === 'Space' || e.code === 'ArrowDown') { if (state.mode === 'playing') plunger.active = true; }
  else if (e.code === 'KeyP') { state.mode === 'playing' ? pauseGame() : resumeGame(); }
});
window.addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyZ') releaseZone('L');
  else if (e.code === 'ArrowRight' || e.code === 'Slash' || e.code === 'KeyM') releaseZone('R');
  else if (e.code === 'Space' || e.code === 'ArrowDown') releaseZone('P');
});

/* ---------------- Butonlar ---------------- */
document.getElementById('btn-play').addEventListener('click', () => { SFX.ensure(); startGame(); });
document.getElementById('btn-again').addEventListener('click', () => { SFX.ensure(); startGame(); });
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-restart').addEventListener('click', () => { SFX.ensure(); startGame(); });
document.getElementById('btn-pause').addEventListener('click', () => {
  if (state.mode === 'playing') pauseGame();
});
document.getElementById('btn-mute').addEventListener('click', () => {
  const muted = SFX.toggle();
  document.getElementById('icon-sound-on').classList.toggle('hidden', muted);
  document.getElementById('icon-sound-off').classList.toggle('hidden', !muted);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'playing') pauseGame();
});

/* ---------------- Ana döngü ---------------- */
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (dt > 0.05) dt = 0.05;
  if (state.mode === 'playing') update(dt);
  else state.time += dt;
  draw();
}

/* ---------------- Başlat ---------------- */
document.querySelector('#hiscore span').textContent = fmt(state.hiscore);
buildLevel((Math.random() * 2 ** 31) | 0);   // menü arkaplanı için rastgele masa
resize();
updateHud();
requestAnimationFrame(frame);

// test kancası (otomatik testler için)
window.__neonpinball = { state, addScore };

})();
