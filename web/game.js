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

let dprCap = 2;   // otomatik kalite ölçekleyici düşürebilir
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2, dprCap);
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
  try { muted = localStorage.getItem('neonpinball.muted') === '1'; } catch (_) {}
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
    toggle() {
      muted = !muted;
      try { localStorage.setItem('neonpinball.muted', muted ? '1' : '0'); } catch (_) {}
      return muted;
    },
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
    nudge()     { thump(0.05, 0.22, 850); },
    tilt()      { tone(180, 55, 0.55, 'sawtooth', 0.32); thump(0.3, 0.2, 200); },
    combo()     { [880, 1100, 1320].forEach((f, i) => tone(f, f, 0.09, 'triangle', 0.22, i * 0.05)); },
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

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}

// film greni dokusu (bir kez üretilir, ucuz desen olarak serilir)
let noiseCv = null;
function ensureNoise() {
  if (noiseCv) return;
  noiseCv = document.createElement('canvas');
  noiseCv.width = noiseCv.height = 128;
  const nc = noiseCv.getContext('2d');
  const img = nc.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  nc.putImageData(img, 0, 0);
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
    mechLabel: 'RAYLI BUMPERLAR',
    mech: { bumperMotion: 'slideX' },
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
    bumperGlow: null,
    paintBumper(c, r) {
      c.strokeStyle = '#d8ecff';
      c.lineWidth = 2.5;
      c.setLineDash([6, 4]);
      cStroke(c, 0, 0, r);
      c.setLineDash([]);
      cStroke(c, 0, 0, r * 0.55);
      c.lineWidth = 1.5;
      ln(c, -r * 0.82, 0, r * 0.82, 0);
      ln(c, 0, -r * 0.82, 0, r * 0.82);
    },
  },

  { // 2 — eski tüplü ekran: fosfor yeşili, tarama çizgileri
    name: 'RETRO CRT',
    hud: '#4fff7f',
    mechLabel: 'PİKSEL TUĞLALAR',
    mech: { bricks: true },
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
    bumperGlow: '#33ff66',
    paintBumper(c, r) {
      c.fillStyle = '#0a2f14';
      cFill(c, 0, 0, r);
      c.strokeStyle = '#33ff66'; c.lineWidth = 3;
      cStroke(c, 0, 0, r);
      cStroke(c, 0, 0, r * 0.58);
      c.fillStyle = '#33ff66';
      cFill(c, 0, 0, r * 0.22);
      c.strokeStyle = 'rgba(0, 0, 0, 0.4)'; c.lineWidth = 2;
      for (let y = -r + 4; y < r; y += 6) {
        const hw = Math.sqrt(Math.max(0, r * r - y * y)) - 2;
        if (hw > 2) ln(c, -hw, y, hw, y);
      }
    },
  },

  { // 3 — günbatımı: degrade gök, şeritli güneş, dağ silüetleri
    name: 'GÜNBATIMI',
    hud: '#ffbf80',
    mechLabel: 'ÇÖL RÜZGARI',
    mech: { wind: true },
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
    bumperGlow: '#ff8f4a',
    paintBumper(c, r) {
      const g = c.createRadialGradient(0, -r * 0.3, 2, 0, 0, r);
      g.addColorStop(0, '#ffe9a8');
      g.addColorStop(0.6, '#ffb04a'); g.addColorStop(1, '#ff5f3f');
      c.fillStyle = g;
      cFill(c, 0, 0, r);
      c.strokeStyle = 'rgba(45, 12, 45, 0.75)'; c.lineWidth = 2.5;
      for (let i = 1; i <= 3; i++) {
        const dy = r * 0.22 * i + 1;
        const hw = Math.sqrt(Math.max(0, r * r - dy * dy)) - 1;
        if (hw > 2) ln(c, -hw, dy, hw, dy);
      }
    },
  },

  { // 4 — derin okyanus: ışık hüzmeleri, kabarcıklar, denizanası bumperlar
    name: 'DERİN OKYANUS',
    hud: '#7fe8dc',
    mechLabel: 'SU ALTI FİZİĞİ',
    mech: { water: { drag: 0.55 }, gravityScale: 0.55, bumperMotion: 'floatY' },
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
    bumperGlow: '#7fe8dc',
    bumperUnder(c, b, t) {
      c.strokeStyle = 'rgba(150, 230, 220, 0.6)'; c.lineWidth = 2.5; c.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        const px = b.x + i * b.r * 0.45;
        c.beginPath();
        c.moveTo(px, b.y + b.r * 0.25);
        c.quadraticCurveTo(px + Math.sin(t * 2.2 + i) * 7, b.y + b.r * 0.9,
                           px + Math.sin(t * 2.2 + i + 1.2) * 9, b.y + b.r * 1.55);
        c.stroke();
      }
    },
    paintBumper(c, r) {
      const g = c.createRadialGradient(0, -3, 2, 0, 0, r);
      g.addColorStop(0, '#d8fff6');
      g.addColorStop(0.7, '#4fd0c4'); g.addColorStop(1, 'rgba(36, 120, 140, 0.92)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, r, Math.PI, 0);
      c.quadraticCurveTo(r * 0.55, r * 0.55, 0, r * 0.42);
      c.quadraticCurveTo(-r * 0.55, r * 0.55, -r, 0);
      c.fill();
      c.fillStyle = 'rgba(255, 255, 255, 0.35)';
      c.beginPath(); c.ellipse(-r * 0.3, -r * 0.45, r * 0.28, r * 0.16, -0.5, 0, TAU); c.fill();
    },
  },

  { // 5 — volkan: çatlaklı zemin, yükselen korlar, lav küresi bumperlar
    name: 'VOLKAN',
    hud: '#ff9f6b',
    mechLabel: 'PÜSKÜRME',
    mech: { geyser: true, gravityScale: 1.12 },
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
    bumperGlow: '#ff7a3c',
    glowPulse: true,
    paintBumper(c, r) {
      const g = c.createRadialGradient(0, 0, 2, 0, 0, r);
      g.addColorStop(0, '#ffe9a8');
      g.addColorStop(0.45, '#ff7a3c'); g.addColorStop(1, '#3a120a');
      c.fillStyle = g;
      cFill(c, 0, 0, r);
      c.strokeStyle = 'rgba(28, 8, 4, 0.8)'; c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, r * 0.72, 0.4, 1.5); c.stroke();
      c.beginPath(); c.arc(0, 0, r * 0.55, 2.6, 3.8); c.stroke();
      c.beginPath(); c.arc(0, 0, r * 0.85, 4.2, 5.1); c.stroke();
    },
  },

  { // 6 — galaksi: yıldız alanı, bulutsular, halkalı gezegen bumperlar
    name: 'GALAKSİ',
    hud: '#c7b8ff',
    mechLabel: 'YERÇEKİMİ KUYULARI',
    mech: { wells: { G: 5200000, maxA: 420 }, gravityScale: 0.55 },
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
    bumperGlow: '#b8a6ff',
    paintBumper(c, r, b) {
      const hue = ((b.baseX * 3 + b.baseY * 7) | 0) % 360;
      const g = c.createRadialGradient(-r * 0.35, -r * 0.35, 2, 0, 0, r);
      g.addColorStop(0, `hsl(${hue}, 70%, 76%)`);
      g.addColorStop(1, `hsl(${hue}, 62%, 28%)`);
      c.fillStyle = g;
      cFill(c, 0, 0, r);
      c.save();
      c.rotate(-0.5);
      c.strokeStyle = `hsla(${(hue + 45) % 360}, 80%, 80%, 0.9)`; c.lineWidth = 3;
      c.beginPath(); c.ellipse(0, 0, r * 1.45, r * 0.42, 0, 0, TAU); c.stroke();
      c.restore();
    },
  },

  { // 7 — orman: yaprak silüetleri, ateşböcekleri, mantar bumperlar
    name: 'ORMAN',
    hud: '#b8e08a',
    mechLabel: 'BÜYÜYEN MANTARLAR',
    mech: { growth: true },
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
    bumperGlow: '#b8e08a',
    paintBumper(c, r) {
      // sap
      c.fillStyle = '#efe0c2';
      c.fillRect(-r * 0.28, 0, r * 0.56, r * 0.8);
      c.fillStyle = 'rgba(120, 90, 50, 0.25)';
      c.fillRect(r * 0.06, 0, r * 0.2, r * 0.8);
      // şapka
      const g = c.createRadialGradient(0, -r * 0.35, 2, 0, 0, r);
      g.addColorStop(0, '#ff6b5e');
      g.addColorStop(1, '#a81f1c');
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, r, Math.PI, 0);
      c.quadraticCurveTo(0, r * 0.32, -r, 0);
      c.fill();
      // benekler
      c.fillStyle = 'rgba(255, 246, 232, 0.95)';
      cFill(c, -r * 0.42, -r * 0.32, r * 0.14);
      cFill(c, r * 0.3, -r * 0.5, r * 0.12);
      cFill(c, r * 0.05, -r * 0.12, r * 0.10);
    },
  },

  { // 8 — şeker gecesi: puantiyeler, düşen şeker taneleri, naneli şeker bumperlar
    name: 'ŞEKER',
    hud: '#ff9fc0',
    mechLabel: 'ŞURUP HAVUZLARI',
    mech: { pools: true },
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
    bumperGlow: '#ff9fc0',
    bumperSpin: 0.7,
    paintBumper(c, r) {
      const segN = 10;
      for (let i = 0; i < segN; i++) {
        c.fillStyle = i % 2 ? '#fff6fa' : '#ff4f6e';
        c.beginPath();
        c.moveTo(0, 0);
        c.arc(0, 0, r, i * TAU / segN, (i + 1) * TAU / segN);
        c.closePath(); c.fill();
      }
      c.strokeStyle = 'rgba(255, 255, 255, 0.9)'; c.lineWidth = 2.5;
      cStroke(c, 0, 0, r);
      c.fillStyle = '#fff';
      cFill(c, 0, 0, r * 0.24);
    },
  },

  { // 9 — solucan deliği: eşleşmiş portallar arasında ışınlanma
    name: 'PORTAL',
    hud: '#c9a8ff',
    mechLabel: 'PORTALLAR',
    mech: { portals: true },
    wallStyle: { color: '#8a5fe0', width: 4, blur: 8, dash: null },
    accent: '#5fd8ff', target: '#ffe3ff', targetGlow: '#c9a8ff',
    saucer: '#7a3fd8', saucerHi: '#d8b8ff',
    flipA: '#e8d8ff', flipB: '#7a3fd8',
    trail: '#c9a8ff', spark: '#5fd8ff',
    ambient: { type: 'stars', color: '#ffffff', max: 16, rate: 7 },
    bg(c, rng) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#140a2e'); g.addColorStop(0.6, '#0c0620'); g.addColorStop(1, '#050310');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      for (const [x, y, r, col] of [[160, 300, 200, 'rgba(122, 63, 216, 0.16)'], [370, 620, 220, 'rgba(95, 216, 255, 0.12)']]) {
        const n = c.createRadialGradient(x, y, 0, x, y, r);
        n.addColorStop(0, col); n.addColorStop(1, 'transparent');
        c.fillStyle = n; cFill(c, x, y, r);
      }
      // warp çizgileri
      c.strokeStyle = 'rgba(200, 168, 255, 0.08)';
      c.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        const a = rng() * TAU, len = 120 + rng() * 300;
        const cx = 270, cy = 460;
        ln(c, cx + Math.cos(a) * 40, cy + Math.sin(a) * 40, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      }
    },
    bumperGlow: '#c9a8ff',
    bumperSpin: 1.3,
    paintBumper(c, r) {
      c.fillStyle = '#160a30';
      cFill(c, 0, 0, r);
      for (let i = 0; i < 3; i++) {
        c.strokeStyle = withAlpha(i % 2 ? '#5fd8ff' : '#c9a8ff', 0.85 - i * 0.2);
        c.lineWidth = 2.5;
        c.beginPath(); c.ellipse(0, 0, r * (0.95 - i * 0.24), r * 0.36 * (0.95 - i * 0.24), i * 0.9, 0, TAU); c.stroke();
      }
      c.fillStyle = '#fff';
      cFill(c, 0, 0, r * 0.16);
    },
  },

  { // 10 — mıknatıs atölyesi: yakala & fırlat
    name: 'MIKNATIS',
    hud: '#ffb347',
    mechLabel: 'MIKNATIS',
    mech: { magnet: { holdTime: 1.0 } },
    wallStyle: { color: '#8a94a8', width: 5, blur: 4, dash: null },
    accent: '#ffb347', target: '#ffe3a8', targetGlow: '#ffb347',
    saucer: '#5a6478', saucerHi: '#c8d0e0',
    flipA: '#ffe3a8', flipB: '#8a94a8',
    trail: '#c8d0e0', spark: '#ffb347',
    ambient: { type: 'embers', color: '#ffb347', max: 10, rate: 4 },
    bg(c, rng) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#242a34'); g.addColorStop(1, '#12151c');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(160, 176, 200, 0.08)'; c.lineWidth = 1;
      for (let y = 0; y < H; y += 90) ln(c, 0, y, W, y);
      for (let x = 0; x < W; x += 90) ln(c, x, 0, x, H);
      c.fillStyle = 'rgba(160, 176, 200, 0.15)';
      for (let gy = 45; gy < H; gy += 90) for (let gx = 45; gx < W; gx += 90) cFill(c, gx, gy, 2);
      c.save(); c.rotate(-0.15);
      for (let x = -600; x < W + 400; x += 46) { c.fillStyle = 'rgba(255, 179, 71, 0.05)'; c.fillRect(x, -100, 20, H + 400); }
      c.restore();
    },
    bumperGlow: '#ffb347',
    paintBumper(c, r) {
      c.fillStyle = '#2a2f3a';
      cFill(c, 0, 0, r);
      c.lineWidth = r * 0.36;
      c.strokeStyle = '#c43b3b';
      c.beginPath(); c.arc(0, 2, r * 0.62, Math.PI * 0.1, Math.PI * 0.9); c.stroke();
      c.strokeStyle = '#3b5fc4';
      c.beginPath(); c.arc(0, 2, r * 0.62, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
      c.fillStyle = '#dfe4ea';
      c.fillRect(-r * 0.78, -r * 0.1, r * 0.22, r * 0.3);
      c.fillRect(r * 0.56, -r * 0.1, r * 0.22, r * 0.3);
    },
  },

  { // 11 — buzul: sürtünmesiz kayma yamaları
    name: 'BUZUL',
    hud: '#bfe9ff',
    mechLabel: 'BUZLU PİST',
    mech: { ice: { baseDrag: 0.4 } },
    wallStyle: { color: '#eaffff', width: 4, blur: 6, dash: null },
    accent: '#7fd4ff', target: '#eafcff', targetGlow: '#bfe9ff',
    saucer: '#4f8fd8', saucerHi: '#cfeeff',
    flipA: '#eafcff', flipB: '#4f8fd8',
    trail: '#cfeeff', spark: '#eafcff',
    ambient: { type: 'stars', color: '#eafcff', max: 12, rate: 5 },
    bg(c, rng) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0e2438'); g.addColorStop(0.5, '#123049'); g.addColorStop(1, '#0a1a28');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      // aurora bantları
      for (let i = 0; i < 3; i++) {
        const y = 90 + i * 46;
        const a = c.createLinearGradient(0, y - 30, W, y + 30);
        a.addColorStop(0, 'transparent');
        a.addColorStop(0.5, i % 2 ? 'rgba(159, 255, 210, 0.10)' : 'rgba(191, 233, 255, 0.10)');
        a.addColorStop(1, 'transparent');
        c.fillStyle = a; c.fillRect(0, y - 30, W, 60);
      }
      // buz çatlakları
      c.strokeStyle = 'rgba(234, 252, 255, 0.10)'; c.lineWidth = 1.4;
      for (let i = 0; i < 8; i++) {
        let x = rng() * W, y = 500 + rng() * 400;
        c.beginPath(); c.moveTo(x, y);
        for (let s = 0; s < 4; s++) { x += rng() * 60 - 30; y += rng() * 40 - 10; c.lineTo(x, y); }
        c.stroke();
      }
    },
    bumperGlow: '#bfe9ff',
    paintBumper(c, r) {
      const g = c.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#bfe9ff'); g.addColorStop(1, '#4f8fd8');
      c.fillStyle = g;
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 - Math.PI / 2, x = Math.cos(a) * r, y = Math.sin(a) * r;
        i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.5; c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.6)';
      ln(c, 0, -r * 0.5, 0, r * 0.5);
    },
  },

  { // 12 — lazer ızgara: tempolu tuzak kapısı
    name: 'LAZER',
    hud: '#ff3d6b',
    mechLabel: 'LAZER KAPI',
    mech: { laserGate: { period: 2.2, onRatio: 0.42 } },
    wallStyle: { color: '#ff2a55', width: 4, blur: 10, dash: null },
    accent: '#00e5ff', target: '#ffe3ec', targetGlow: '#ff3d6b',
    saucer: '#1a1030', saucerHi: '#ff3d6b',
    flipA: '#00e5ff', flipB: '#ff2a55',
    trail: '#ff3d6b', spark: '#00e5ff',
    ambient: { type: 'embers', color: '#ff3d6b', max: 10, rate: 3 },
    bg(c) {
      c.fillStyle = '#050208'; c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(0, 229, 255, 0.10)'; c.lineWidth = 1;
      const vpx = 270, vpy = 40;
      for (let x = -200; x <= W + 200; x += 60) ln(c, x, H, vpx + (x - vpx) * 0.08, vpy);
      for (let i = 0; i < 11; i++) ln(c, 0, vpy + (H - vpy) * Math.pow(0.78, i), W, vpy + (H - vpy) * Math.pow(0.78, i));
      const glow = c.createRadialGradient(vpx, vpy + 80, 10, vpx, vpy + 80, 260);
      glow.addColorStop(0, 'rgba(255, 61, 107, 0.14)'); glow.addColorStop(1, 'transparent');
      c.fillStyle = glow; cFill(c, vpx, vpy + 80, 260);
    },
    bumperGlow: '#00e5ff',
    paintBumper(c, r) {
      function hex(rr) {
        c.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = i * TAU / 6, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
          i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.closePath();
      }
      c.fillStyle = '#140a1e'; hex(r); c.fill();
      c.strokeStyle = '#ff3d6b'; c.lineWidth = 2.5; hex(r * 0.9); c.stroke();
      c.strokeStyle = '#00e5ff'; c.lineWidth = 1.6; hex(r * 0.55); c.stroke();
      c.fillStyle = '#00e5ff'; cFill(c, 0, 0, r * 0.14);
    },
  },

  { // 13 — fabrika: sürekli itiş yapan konveyör bandı
    name: 'FABRİKA',
    hud: '#e8c34a',
    mechLabel: 'KONVEYÖR BANT',
    mech: { conveyor: { force: 210 } },
    wallStyle: { color: '#6a6f7a', width: 5, blur: 3, dash: null },
    accent: '#e8b53a', target: '#fff3c4', targetGlow: '#e8b53a',
    saucer: '#4a4f5a', saucerHi: '#c4c9d4',
    flipA: '#fff3c4', flipB: '#6a6f7a',
    trail: '#c4c9d4', spark: '#e8b53a',
    ambient: { type: 'embers', color: '#c4c9d4', max: 8, rate: 3 },
    bg(c) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#242620'); g.addColorStop(1, '#121310');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(0,0,0,0.15)';
      for (let x = 0; x < W; x += 34) c.fillRect(x, 0, 17, H);
      for (const [x, y] of [[130, 140], [370, 220], [200, 700]]) {
        const spot = c.createRadialGradient(x, y, 4, x, y, 160);
        spot.addColorStop(0, 'rgba(232, 179, 58, 0.10)'); spot.addColorStop(1, 'transparent');
        c.fillStyle = spot; cFill(c, x, y, 160);
      }
      c.save(); c.translate(0, H - 46); c.rotate(-0.05);
      for (let x = -60; x < W + 60; x += 40) { c.fillStyle = (x / 40) % 2 ? '#e8b53a' : '#161616'; c.fillRect(x, 0, 40, 20); }
      c.restore();
    },
    bumperGlow: '#e8b53a',
    paintBumper(c, r) {
      c.fillStyle = '#3a3f4a';
      const teeth = 10;
      c.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const a = i * Math.PI / teeth, rr = i % 2 ? r : r * 0.8;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.closePath(); c.fill();
      c.strokeStyle = '#e8b53a'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#1a1c20'; cFill(c, 0, 0, r * 0.34);
    },
  },

  { // 14 — kronos: bumper vuruşunda zaman yavaşlar
    name: 'KRONOS',
    hud: '#ffcf7a',
    mechLabel: 'ZAMAN YAVAŞLATMA',
    mech: { bulletTime: { duration: 1.5 } },
    wallStyle: { color: '#c9a24a', width: 4, blur: 5, dash: null },
    accent: '#8a5a2a', target: '#ffe9c4', targetGlow: '#ffcf7a',
    saucer: '#5a3a1a', saucerHi: '#ffcf7a',
    flipA: '#ffe9c4', flipB: '#8a5a2a',
    trail: '#ffcf7a', spark: '#ffe9c4',
    ambient: { type: 'fireflies', color: '#ffcf7a', max: 8, rate: 3 },
    bg(c, rng) {
      const g = c.createRadialGradient(270, 400, 60, 270, 460, 560);
      g.addColorStop(0, '#3a2a14'); g.addColorStop(1, '#140d08');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(201, 162, 74, 0.14)'; c.lineWidth = 6;
      for (const [x, y, r] of [[150, 260, 130], [380, 600, 170], [90, 700, 90]]) {
        cStroke(c, x, y, r);
        c.lineWidth = 3;
        for (let i = 0; i < 10; i++) {
          const a = i * TAU / 10;
          ln(c, x + Math.cos(a) * r, y + Math.sin(a) * r, x + Math.cos(a) * (r + 10), y + Math.sin(a) * (r + 10));
        }
        c.lineWidth = 6;
      }
    },
    bumperGlow: '#ffcf7a',
    paintBumper(c, r) {
      c.fillStyle = '#241708';
      cFill(c, 0, 0, r);
      c.strokeStyle = '#ffcf7a'; c.lineWidth = 2.5;
      cStroke(c, 0, 0, r * 0.92);
      c.lineWidth = 1.5;
      for (let i = 0; i < 12; i++) {
        const a = i * TAU / 12;
        ln(c, Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7, Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
      }
      c.strokeStyle = '#fff'; c.lineWidth = 2;
      ln(c, 0, 0, Math.cos(-1.0) * r * 0.5, Math.sin(-1.0) * r * 0.5);
      ln(c, 0, 0, Math.cos(0.6) * r * 0.32, Math.sin(0.6) * r * 0.32);
    },
  },

  { // 15 — değirmen: dönen kanat engel
    name: 'DEĞİRMEN',
    hud: '#d4e896',
    mechLabel: 'RÜZGAR DEĞİRMENİ',
    mech: { pinwheel: { speed: 2.6 } },
    wallStyle: { color: '#a8c46a', width: 5, blur: 4, dash: null },
    accent: '#c9a24a', target: '#eaffb0', targetGlow: '#d4e896',
    saucer: '#6a8a3a', saucerHi: '#d4e896',
    flipA: '#eaffb0', flipB: '#c9a24a',
    trail: '#d4e896', spark: '#eaffb0',
    ambient: { type: 'fireflies', color: '#eaffc4', max: 10, rate: 4 },
    bg(c) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#8fb8c4'); g.addColorStop(0.35, '#c4d896'); g.addColorStop(1, '#7a9a4a');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(90, 120, 50, 0.5)';
      c.beginPath();
      c.moveTo(0, 620); c.quadraticCurveTo(140, 560, 270, 610); c.quadraticCurveTo(400, 660, 540, 600);
      c.lineTo(540, H); c.lineTo(0, H); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 2;
      for (let i = 0; i < 5; i++) { const y = 120 + i * 60; ln(c, 40, y, 200, y - 10); }
    },
    bumperGlow: '#c9a24a',
    paintBumper(c, r) {
      const g = c.createLinearGradient(-r, 0, r, 0);
      g.addColorStop(0, '#a87f3f'); g.addColorStop(0.5, '#c9a24a'); g.addColorStop(1, '#8a6a2a');
      c.fillStyle = g; cFill(c, 0, 0, r);
      c.strokeStyle = 'rgba(60,40,10,0.6)'; c.lineWidth = 2.5;
      cStroke(c, 0, -r * 0.45, r * 0.98);
      cStroke(c, 0, r * 0.45, r * 0.98);
      c.strokeStyle = '#3a2a10'; c.lineWidth = 1.2;
      for (let i = -2; i <= 2; i++) ln(c, -r * 0.85, i * r * 0.3, r * 0.85, i * r * 0.3);
    },
  },

  { // 16 — fırtına: bumperler arasında zincirleme şimşek
    name: 'FIRTINA',
    hud: '#bfe0ff',
    mechLabel: 'ZİNCİR ŞİMŞEK',
    mech: { chainLightning: { radius: 160 } },
    wallStyle: { color: '#7a8fd8', width: 4, blur: 9, dash: null },
    accent: '#e0d8ff', target: '#dff0ff', targetGlow: '#bfe0ff',
    saucer: '#3a2a6a', saucerHi: '#bfe0ff',
    flipA: '#e0d8ff', flipB: '#4a3a8a',
    trail: '#bfe0ff', spark: '#e0d8ff',
    glowPulse: true,
    ambient: { type: 'stars', color: '#bfe0ff', max: 14, rate: 6 },
    bg(c, rng) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0c0f22'); g.addColorStop(0.6, '#131a30'); g.addColorStop(1, '#080a16');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(30, 40, 70, 0.4)';
      for (let i = 0; i < 6; i++) {
        const x = rng() * W, y = rng() * 300, w = 90 + rng() * 120;
        c.beginPath(); c.ellipse(x, y, w, w * 0.4, 0, 0, TAU); c.fill();
      }
      c.strokeStyle = 'rgba(191, 224, 255, 0.10)'; c.lineWidth = 2;
      let x = 220, y = 40;
      c.beginPath(); c.moveTo(x, y);
      for (let s = 0; s < 6; s++) { x += rng() * 50 - 25; y += 60; c.lineTo(x, y); }
      c.stroke();
    },
    bumperGlow: '#bfe0ff',
    paintBumper(c, r) {
      const g = c.createRadialGradient(0, 0, 2, 0, 0, r);
      g.addColorStop(0, '#e0d8ff'); g.addColorStop(0.6, '#7a6fc4'); g.addColorStop(1, '#2a2050');
      c.fillStyle = g; cFill(c, 0, 0, r);
      c.strokeStyle = '#bfe0ff'; c.lineWidth = 1.6;
      for (let i = 0; i < 5; i++) {
        const a = i * TAU / 5;
        c.beginPath();
        c.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
        c.lineTo(Math.cos(a + 0.3) * r * 0.7, Math.sin(a + 0.3) * r * 0.7);
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        c.stroke();
      }
    },
  },

  { // 17 — bataklık: yavaşça batıp fırlatan çukurlar
    name: 'BATAKLIK',
    hud: '#c4e08a',
    mechLabel: 'BATAKLIK',
    mech: { quicksand: { sinkTime: 2.0 } },
    wallStyle: { color: '#5a7a3a', width: 5, blur: 3, dash: null },
    accent: '#8a6a3a', target: '#eaffc4', targetGlow: '#c4e08a',
    saucer: '#3a4a2a', saucerHi: '#c4e08a',
    flipA: '#eaffc4', flipB: '#5a7a3a',
    trail: '#8a9a6a', spark: '#c4e08a',
    ambient: { type: 'fireflies', color: '#c4ff8a', max: 10, rate: 4 },
    bg(c, rng) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1a2410'); g.addColorStop(0.6, '#141c0c'); g.addColorStop(1, '#0a0e06');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(160, 180, 140, 0.06)';
      for (let i = 0; i < 4; i++) c.fillRect(0, 100 + i * 180, W, 40);
      c.strokeStyle = 'rgba(60, 80, 30, 0.5)'; c.lineWidth = 3;
      for (let i = 0; i < 7; i++) {
        const x = rng() * W;
        c.beginPath(); c.moveTo(x, 0);
        c.quadraticCurveTo(x + 20, 140, x - 10, 300);
        c.stroke();
      }
    },
    bumperGlow: '#c4e08a',
    paintBumper(c, r) {
      c.fillStyle = '#3f6a2a';
      c.beginPath();
      c.arc(0, 0, r, 0.35, TAU - 0.35);
      c.closePath(); c.fill();
      c.strokeStyle = '#1f3a12'; c.lineWidth = 2; c.stroke();
      c.strokeStyle = 'rgba(200, 255, 160, 0.5)'; c.lineWidth = 1.4;
      ln(c, -r * 0.5, -r * 0.2, r * 0.5, r * 0.1);
      ln(c, -r * 0.3, r * 0.3, r * 0.3, r * 0.4);
      c.fillStyle = 'rgba(255,255,255,0.25)';
      cFill(c, -r * 0.3, -r * 0.3, r * 0.16);
    },
  },

  { // 18 — hortum: merkezden dışa iten rüzgar alanı
    name: 'HORTUM',
    hud: '#e8dcc4',
    mechLabel: 'YELPAZE',
    mech: { fan: { force: 1600000, range: 150 } },
    wallStyle: { color: '#b0a284', width: 5, blur: 4, dash: null },
    accent: '#8a7a5a', target: '#f4ecd8', targetGlow: '#e8dcc4',
    saucer: '#5a4f3a', saucerHi: '#e8dcc4',
    flipA: '#f4ecd8', flipB: '#8a7a5a',
    trail: '#c4b89a', spark: '#e8dcc4',
    ambient: { type: 'embers', color: '#c4b89a', max: 14, rate: 6 },
    bg(c, rng) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#3a3428'); g.addColorStop(1, '#1c1810');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(228, 214, 180, 0.08)';
      for (let i = 0; i < 5; i++) {
        c.lineWidth = 1 + i * 0.4;
        c.beginPath();
        for (let a = 0; a < TAU * 2.2; a += 0.15) {
          const rr = a * 16;
          const x = 270 + Math.cos(a + i) * rr * 0.5, y = 460 + Math.sin(a + i) * rr * 0.32;
          a === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.stroke();
      }
    },
    bumperGlow: '#e8dcc4',
    bumperSpin: -2.0,
    paintBumper(c, r) {
      c.fillStyle = '#2a2620';
      cFill(c, 0, 0, r);
      c.fillStyle = '#e8dcc4';
      for (let k = 0; k < 3; k++) {
        c.save(); c.rotate(k * TAU / 3);
        c.beginPath(); c.ellipse(r * 0.42, 0, r * 0.42, r * 0.18, 0, 0, TAU); c.fill();
        c.restore();
      }
      c.fillStyle = '#8a7a5a'; cFill(c, 0, 0, r * 0.22);
    },
  },

  { // 19 — istasyon: periyodik sıfır yerçekimi nabzı
    name: 'İSTASYON',
    hud: '#dfe8ff',
    mechLabel: 'SIFIR YERÇEKİMİ',
    mech: { zeroG: { period: 5, duration: 1.3 } },
    wallStyle: { color: '#8fa8d8', width: 4, blur: 6, dash: null },
    accent: '#6a8fc4', target: '#eaf2ff', targetGlow: '#dfe8ff',
    saucer: '#2a3a5a', saucerHi: '#dfe8ff',
    flipA: '#eaf2ff', flipB: '#6a8fc4',
    trail: '#dfe8ff', spark: '#eaf2ff',
    ambient: { type: 'stars', color: '#ffffff', max: 18, rate: 8 },
    bg(c, rng) {
      c.fillStyle = '#050810'; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 60; i++) {
        c.fillStyle = `rgba(255,255,255,${0.2 + rng() * 0.5})`;
        cFill(c, rng() * W, rng() * H, rng() < 0.85 ? 0.8 : 1.6);
      }
      c.strokeStyle = 'rgba(143, 168, 216, 0.14)'; c.lineWidth = 1.4;
      for (let y = 60; y < H; y += 130) ln(c, 0, y, W, y);
      for (let x = 30; x < W; x += 130) ln(c, x, 0, x, H);
      c.strokeStyle = 'rgba(143, 168, 216, 0.25)'; c.lineWidth = 2;
      for (let i = 0; i < 4; i++) { const y = 60 + i * 130; c.strokeRect(20, y, 500, 4); }
    },
    bumperGlow: '#dfe8ff',
    paintBumper(c, r) {
      c.fillStyle = '#2a3a5a';
      c.beginPath(); c.roundRect ? c.roundRect(-r * 0.7, -r, r * 1.4, r * 2, r * 0.5) : c.rect(-r * 0.7, -r, r * 1.4, r * 2);
      c.fill();
      c.strokeStyle = '#dfe8ff'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#6a8fc4';
      c.fillRect(-r * 1.15, -r * 0.25, r * 0.42, r * 0.5);
      c.fillRect(r * 0.73, -r * 0.25, r * 0.42, r * 0.5);
      c.strokeStyle = '#dfe8ff'; c.lineWidth = 1.5;
      ln(c, 0, -r, 0, -r * 1.35);
    },
  },

  { // 20 — roket rampası: sabit yönlü fırlatma yastıkları
    name: 'ROKET',
    hud: '#ffb37a',
    mechLabel: 'FIRLATMA YASTIKLARI',
    mech: { launchPads: { count: 3 } },
    wallStyle: { color: '#ff8f4a', width: 5, blur: 8, dash: null },
    accent: '#ff5f3f', target: '#ffe3c4', targetGlow: '#ffb37a',
    saucer: '#3a1a0a', saucerHi: '#ffb37a',
    flipA: '#ffe3c4', flipB: '#ff5f3f',
    trail: '#ffb37a', spark: '#ffe3c4',
    ambient: { type: 'embers', color: '#ff9f4a', max: 16, rate: 8 },
    bg(c, rng) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0c0a14'); g.addColorStop(0.7, '#1a0f0c'); g.addColorStop(1, '#100806');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      for (const x of [110, 270, 430]) {
        const beam = c.createLinearGradient(x, H, x, H - 500);
        beam.addColorStop(0, 'rgba(255, 159, 74, 0.20)'); beam.addColorStop(1, 'transparent');
        c.fillStyle = beam;
        c.beginPath();
        c.moveTo(x - 30, H); c.lineTo(x - 6, H - 500); c.lineTo(x + 6, H - 500); c.lineTo(x + 30, H);
        c.closePath(); c.fill();
      }
      c.fillStyle = '#1a0f0c';
      for (let i = 0; i < 3; i++) c.fillRect(60 + i * 180, H - 60, 6, -220 - i * 30);
      c.save(); c.translate(0, 60); c.rotate(0.02);
      for (let x = -40; x < W + 40; x += 40) { c.fillStyle = (x / 40) % 2 ? '#ff5f3f' : '#0c0a14'; c.fillRect(x, 0, 40, 14); }
      c.restore();
    },
    bumperGlow: '#ff9f4a',
    paintBumper(c, r) {
      const g = c.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, '#ffe3c4'); g.addColorStop(0.5, '#ff8f4a'); g.addColorStop(1, '#ff3f1f');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(0, -r); c.lineTo(r * 0.85, r * 0.7); c.lineTo(-r * 0.85, r * 0.7);
      c.closePath(); c.fill();
      c.strokeStyle = '#dfe4ea'; c.lineWidth = 2.5;
      ln(c, -r * 0.9, -r * 0.25, r * 0.9, -r * 0.25);
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.beginPath(); c.moveTo(-r * 0.15, -r * 0.7); c.lineTo(r * 0.1, -r * 0.1); c.lineTo(-r * 0.35, -r * 0.1); c.closePath(); c.fill();
    },
  },
];
let theme = THEMES[0];
const recentThemes = [];   // tekrar-önleyici tema geçmişi (buildLevel doldurur)
let forcedThemeIdx = null; // test kancası: belirli bir temayı zorla seçtirir

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

/* ---------------- Temaya özgü mekanik durumu ---------------- */
const mech = {
  bricks: [], brickRespawn: 0, pools: [], geyser: null, wind: null, streaks: [],
  portals: null, magnet: null, icePatches: [], laser: null, conveyorZone: null,
  pinwheelObj: null, bolts: [], quicksandPits: [], fanObj: null, pads: [],
};
let slowMoTimer = 0;   // Zaman Yavaşlatma (bullet-time) mekaniği için

// Bumperlerden ve saucer'dan uzak, masanın açık orta bölgesinde güvenli bir nokta üretir.
function placePoint(rng, opts = {}) {
  const r = opts.r || 70;
  let x = 100 + rng() * 300, y = 380 + rng() * 220, tries = 0;
  while (tries++ < 30 && (
    bumpers.some(b => Math.hypot(b.x - x, b.y - y) < b.r + r * 0.55) ||
    Math.hypot(saucer.x - x, saucer.y - y) < r * 0.55 + 50
  )) { x = 100 + rng() * 300; y = 380 + rng() * 220; }
  return { x, y };
}

// Birbiriyle ve masa öğeleriyle çakışmayan elips bölgeler üretir (buz/bataklık gibi).
function placeZones(rng, count, rxRange, ryRange) {
  const list = [];
  let tries = 0;
  while (list.length < count && tries++ < 60) {
    const x = 100 + rng() * 300, y = 380 + rng() * 220;
    const rx = rxRange[0] + rng() * (rxRange[1] - rxRange[0]);
    const ry = ryRange[0] + rng() * (ryRange[1] - ryRange[0]);
    if (bumpers.some(b => Math.hypot(b.x - x, b.y - y) < b.r + rx)) continue;
    if (Math.hypot(saucer.x - x, saucer.y - y) < rx + 50) continue;
    if (list.some(q => Math.hypot(q.x - x, q.y - y) < q.rx + rx + 16)) continue;
    list.push({ x, y, rx, ry });
  }
  return list;
}

function resetMech(rng) {
  mech.bricks.length = 0;
  mech.pools.length = 0;
  mech.streaks.length = 0;
  mech.geyser = null;
  mech.wind = null;
  mech.brickRespawn = 0;
  mech.portals = null;
  mech.magnet = null;
  mech.icePatches.length = 0;
  mech.laser = null;
  mech.conveyorZone = null;
  mech.pinwheelObj = null;
  mech.bolts.length = 0;
  mech.quicksandPits.length = 0;
  mech.fanObj = null;
  mech.pads.length = 0;
  slowMoTimer = 0;
  const m = theme.mech || {};

  if (m.bricks) spawnBricks();

  if (m.pools) {
    const n = 2 + (rng() < 0.5 ? 1 : 0);
    let tries = 0;
    while (mech.pools.length < n && tries++ < 40) {
      const p = { x: 140 + rng() * 230, y: 340 + rng() * 260, rx: 40 + rng() * 22, ry: 24 + rng() * 10 };
      if (bumpers.some(b => Math.hypot(b.x - p.x, b.y - p.y) < b.r + p.rx)) continue;
      if (Math.hypot(saucer.x - p.x, saucer.y - p.y) < p.rx + 45) continue;
      if (mech.pools.some(q => Math.hypot(q.x - p.x, q.y - p.y) < q.rx + p.rx + 20)) continue;
      mech.pools.push(p);
    }
  }

  if (m.geyser) mech.geyser = { x: 251, y: 585, r: 66, phase: 'idle', timer: 4 + rng() * 3 };
  if (m.wind) mech.wind = { v: 0, target: (rng() * 2 - 1) * 240, timer: 2 + rng() * 2 };

  if (m.portals) {
    const p1 = placePoint(rng, { r: 80 });
    let p2 = placePoint(rng, { r: 80 }), tries = 0;
    while (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 220 && tries++ < 20) p2 = placePoint(rng, { r: 80 });
    mech.portals = {
      a: { x: p1.x, y: p1.y, r: 24, cooldown: 0, exitAngle: -Math.PI / 2, color: '#b26bff' },
      b: { x: p2.x, y: p2.y, r: 24, cooldown: 0, exitAngle: -Math.PI / 2, color: '#5fd8ff' },
    };
  }

  if (m.magnet) {
    const pt = placePoint(rng, { r: 100 });
    mech.magnet = { x: pt.x, y: pt.y, r: 28, holdTime: m.magnet.holdTime || 1.0, catching: false, holdTimer: 0 };
  }

  if (m.ice) mech.icePatches = placeZones(rng, 2, [40, 58], [24, 34]);

  if (m.laserGate) {
    mech.laser = { x1: 108, y1: 0, x2: 392, y2: 0, y: 420 + rng() * 140, t: rng() * 3, period: m.laserGate.period || 2.2, onRatio: m.laserGate.onRatio || 0.45, on: false };
    mech.laser.y1 = mech.laser.y; mech.laser.y2 = mech.laser.y;
  }

  if (m.conveyor) {
    const pt = placePoint(rng, { r: 110 });
    mech.conveyorZone = { x: pt.x - 82, y: pt.y - 34, w: 164, h: 68, dir: rng() < 0.5 ? -1 : 1 };
  }

  if (m.pinwheel) {
    const pt = placePoint(rng, { r: 100 });
    mech.pinwheelObj = { x: pt.x, y: pt.y, angle: rng() * TAU, speed: (m.pinwheel.speed || 2.2) * (rng() < 0.5 ? -1 : 1), len: 68, thickness: 11 };
  }

  if (m.quicksand) mech.quicksandPits = placeZones(rng, 2, [44, 60], [26, 36]);

  if (m.fan) {
    const pt = placePoint(rng, { r: 130 });
    mech.fanObj = { x: pt.x, y: pt.y, r: m.fan.range || 150, angle: 0 };
  }

  if (m.launchPads) {
    const n = m.launchPads.count || 3;
    let tries = 0;
    while (mech.pads.length < n && tries++ < 60) {
      const pt = placePoint(rng, { r: 60 });
      if (mech.pads.some(p => Math.hypot(p.x - pt.x, p.y - pt.y) < 90)) continue;
      const angle = -Math.PI * (0.25 + rng() * 0.5);   // yukarı yönlü geniş yelpaze
      mech.pads.push({ x: pt.x, y: pt.y, r: 22, angle, cooldown: 0, flash: 0 });
    }
  }
}

function spawnBricks() {
  const cols = 5, rows = 3, bw = 44, bh = 16, gx = 6, gy = 12;
  const x0 = 251 - (cols * bw + (cols - 1) * gx) / 2, y0 = 396;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      mech.bricks.push({ x: x0 + c * (bw + gx), y: y0 + r * (bh + gy), w: bw, h: bh, alive: true });
}

function updateMech(dt) {
  const m = theme.mech || {};
  const t = state.time;

  if (m.bumperMotion === 'slideX') for (const b of bumpers) b.x = b.baseX + Math.sin(t * 0.5 + b.phase) * 36;
  if (m.bumperMotion === 'floatY') for (const b of bumpers) b.y = b.baseY + Math.sin(t * 0.7 + b.phase) * 22;
  if (m.growth) for (const b of bumpers) b.r = b.baseR * (1 + 0.26 * Math.sin(t * 0.6 + b.phase));

  if (mech.wind) {
    const w = mech.wind;
    w.timer -= dt;
    if (w.timer <= 0) { w.target = rand(-260, 260); w.timer = rand(2.5, 5); }
    w.v += (w.target - w.v) * Math.min(1, dt * 1.2);
    if (Math.abs(w.v) > 60 && mech.streaks.length < 10 && Math.random() < dt * 6) {
      mech.streaks.push({ x: w.v > 0 ? -30 : W + 30, y: rand(90, 820), len: rand(30, 70) });
    }
    for (let i = mech.streaks.length - 1; i >= 0; i--) {
      const s = mech.streaks[i];
      s.x += w.v * 2.4 * dt;
      if (s.x < -90 || s.x > W + 90) mech.streaks.splice(i, 1);
    }
  }

  if (mech.geyser) {
    const g = mech.geyser;
    g.timer -= dt;
    if (g.phase === 'idle' && g.timer <= 0) { g.phase = 'warn'; g.timer = 1.4; }
    else if (g.phase === 'warn' && g.timer <= 0) {
      g.phase = 'blast'; g.timer = 0.75;
      SFX.launch(); buzz(40);
      state.shake = Math.max(state.shake, 4);
      spawnParticles(g.x, g.y, '#ff9f4a', 26, 460);
    } else if (g.phase === 'blast' && g.timer <= 0) { g.phase = 'idle'; g.timer = rand(6, 9); }
  }

  if (mech.brickRespawn > 0) {
    mech.brickRespawn -= dt;
    if (mech.brickRespawn <= 0) mech.bricks.forEach(b => b.alive = true);
  }

  if (mech.portals) {
    mech.portals.a.cooldown = Math.max(0, mech.portals.a.cooldown - dt);
    mech.portals.b.cooldown = Math.max(0, mech.portals.b.cooldown - dt);
  }

  if (mech.magnet && mech.magnet.catching) {
    mech.magnet.holdTimer -= dt;
    const earlyRelease = flipL.pressed || flipR.pressed;
    if (mech.magnet.holdTimer <= 0 || earlyRelease) {
      const held = activeBalls.find(x => x.caught);
      if (held) {
        held.caught = false;
        let ang = -Math.PI / 2;
        if (flipL.pressed && !flipR.pressed) ang = -Math.PI * 0.72;
        else if (flipR.pressed && !flipL.pressed) ang = -Math.PI * 0.28;
        held.vx = Math.cos(ang) * 950;
        held.vy = Math.sin(ang) * 950;
        registerHit(600, mech.magnet.x, mech.magnet.y - 20);
        spawnParticles(mech.magnet.x, mech.magnet.y, theme.hud, 18, 380);
        SFX.eject(); buzz([20, 30, 20]);
      }
      mech.magnet.catching = false;
    }
  }

  if (mech.laser) {
    mech.laser.t += dt;
    mech.laser.on = (mech.laser.t % mech.laser.period) < (mech.laser.period * mech.laser.onRatio);
  }

  if (mech.pinwheelObj) mech.pinwheelObj.angle += mech.pinwheelObj.speed * dt;
  if (mech.fanObj) mech.fanObj.angle += dt * 5;

  for (let i = mech.bolts.length - 1; i >= 0; i--) {
    mech.bolts[i].t += dt;
    if (mech.bolts[i].t > 0.4) mech.bolts.splice(i, 1);
  }

  for (const p of mech.pads) {
    if (p.cooldown > 0) p.cooldown -= dt;
    if (p.flash > 0) p.flash -= dt;
  }
}

function collideBrick(b, br) {
  const cx = clamp(b.x, br.x, br.x + br.w), cy = clamp(b.y, br.y, br.y + br.h);
  let dx = b.x - cx, dy = b.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= BALL_R * BALL_R) return;
  let d = Math.sqrt(d2), nx, ny;
  if (d < 0.001) { nx = 0; ny = -1; b.y = br.y - BALL_R; }
  else { nx = dx / d; ny = dy / d; b.x = cx + nx * BALL_R; b.y = cy + ny * BALL_R; }
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) { b.vx -= 1.55 * vn * nx; b.vy -= 1.55 * vn * ny; }
  br.alive = false;
  addScore(250, br.x + br.w / 2, br.y);
  spawnParticles(br.x + br.w / 2, br.y + br.h / 2, theme.hud, 8, 220);
  SFX.target(); buzz(10);
  if (mech.bricks.every(x => !x.alive)) {
    addScore(5000);
    banner('TUĞLALAR TEMİZ!');
    SFX.bank(); buzz(35);
    mech.brickRespawn = 8;
  }
}

// Rüzgar değirmeni: merkezden geçen iki dik kanat (4 uç), dönme hızıyla topu teğetsel fırlatır.
function collidePinwheel(b) {
  const p = mech.pinwheelObj;
  if (!p) return;
  for (let k = 0; k < 2; k++) {
    const a = p.angle + k * Math.PI / 2;
    const dx = Math.cos(a) * p.len, dy = Math.sin(a) * p.len;
    const x1 = p.x - dx, y1 = p.y - dy, x2 = p.x + dx, y2 = p.y + dy;
    const ddx = x2 - x1, ddy = y2 - y1;
    const len2 = ddx * ddx + ddy * ddy;
    let t = ((b.x - x1) * ddx + (b.y - y1) * ddy) / len2;
    t = clamp(t, 0, 1);
    const qx = x1 + ddx * t, qy = y1 + ddy * t;
    let nx = b.x - qx, ny = b.y - qy;
    const d2 = nx * nx + ny * ny;
    const rr = BALL_R + p.thickness / 2;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2) || 0.0001;
    nx /= d; ny /= d;
    b.x = qx + nx * rr; b.y = qy + ny * rr;
    const radius = Math.hypot(qx - p.x, qy - p.y);
    const tangSpeed = Math.abs(p.speed) * radius * Math.sign(p.speed);
    const tx = -Math.sin(a), ty = Math.cos(a);
    b.vx += tx * tangSpeed * 1.4;
    b.vy += ty * tangSpeed * 1.4;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= 1.3 * vn * nx; b.vy -= 1.3 * vn * ny; }
    registerHit(120, qx, qy);
    spawnParticles(qx, qy, theme.spark, 6, 260);
    SFX.sling(); buzz(10);
    state.shake = Math.max(state.shake, 3);
    return;
  }
}

// Fırlatma yastıkları: sabit yönde güçlü, deterministik fırlatma (bumperin aksine yön sabit).
function collideLaunchPads(b) {
  for (const p of mech.pads) {
    if (p.cooldown > 0) continue;
    const dx = b.x - p.x, dy = b.y - p.y;
    const rr = p.r + BALL_R;
    if (dx * dx + dy * dy >= rr * rr) continue;
    b.vx = Math.cos(p.angle) * 1400;
    b.vy = Math.sin(p.angle) * 1400;
    p.cooldown = 0.35;
    p.flash = 0.3;
    registerHit(200, p.x, p.y);
    spawnParticles(p.x, p.y, theme.spark, 12, 340);
    SFX.launch(); buzz(20);
    state.shake = Math.max(state.shake, 4);
    return;
  }
}

// Zincir şimşek: vurulan bumperden en yakın vurulmamış bumperlara sıçrayarak bonus zinciri kurar.
function triggerChain(origin) {
  const cfg = theme.mech.chainLightning;
  let current = origin;
  const hit = new Set([origin]);
  let hops = 0;
  while (hops < 4) {
    let next = null, bestD = cfg.radius || 150;
    for (const bp of bumpers) {
      if (hit.has(bp)) continue;
      const d = Math.hypot(bp.x - current.x, bp.y - current.y);
      if (d < bestD) { bestD = d; next = bp; }
    }
    if (!next) break;
    mech.bolts.push({ x1: current.x, y1: current.y, x2: next.x, y2: next.y, t: 0 });
    addScore(100 * (hops + 2), next.x, next.y - 20);
    next.flash = Math.max(next.flash, 0.3);
    spawnParticles(next.x, next.y, '#bfe0ff', 10, 260);
    hit.add(next);
    current = next;
    hops++;
  }
  if (hops > 0) {
    SFX.multiball(); buzz([20, 20, 20]);
    banner('ZİNCİR x' + (hops + 1) + '!');
  }
}

// Rastgele bölüm inşası: tema, bumper dizilimi, hedef bankı yönü,
// şerit sayısı, saucer konumu ve yerçekimi tohuma göre değişir.
function buildLevel(seed) {
  const rng = mulberry32(seed);
  decoSeed = (seed ^ 0x5bd1e995) >>> 0;
  // Son 4 temayı tekrarlamayan seçim — arka arkaya aynı mekaniğin gelmesini engeller
  let themeIdx, pickTries = 0;
  do { themeIdx = forcedThemeIdx !== null ? forcedThemeIdx : Math.floor(rng() * THEMES.length); }
  while (forcedThemeIdx === null && recentThemes.includes(themeIdx) && pickTries++ < 15);
  theme = THEMES[themeIdx];
  recentThemes.push(themeIdx);
  if (recentThemes.length > 4) recentThemes.shift();
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

  // Bumperlar: 2-4 adet, masanın genişçe bir bölgesine serbestçe (reddetme örneklemesiyle)
  // dağıtılır — böylece her bölümde farklı bir dizilim ve farklı bir bölge kullanılır,
  // hep aynı köşede kümelenme olmaz.
  const bm = theme.mech || {};
  let bx0 = 65, bx1 = 450, by0 = 145, by1 = 580;
  if (bm.bricks) by1 = 370;                                  // tuğla bloğunun üstünde kal
  if (bm.bumperMotion === 'slideX') { bx0 = 180; bx1 = 322; by1 = 300; }  // ray sallanması masaya sığsın
  const bN = 2 + Math.floor(rng() * 3);
  let bTries = 0;
  while (bumpers.length < bN && bTries++ < 300) {
    const x = bx0 + rng() * (bx1 - bx0);
    const y = by0 + rng() * (by1 - by0);
    const r = 26 + rng() * 6;
    if (bumpers.some(b => Math.hypot(b.x - x, b.y - y) < b.r + r + 30)) continue;
    if (Math.hypot(x - saucer.x, y - saucer.y) < r + saucer.r + 46) continue;
    if (Math.abs(x - tx) < 66 && y > y0 - 24 && y < y0 + wallH + 24) continue;   // hedef bankından uzak dur
    bumpers.push({ x, y, r, baseX: x, baseY: y, baseR: r, phase: rng() * TAU, flash: 0, kick: 900 + rng() * 160 });
  }

  // Bölüme özgü yerçekimi
  levelGravity = 1700 + rng() * 250;

  spinner.angle = 0;
  spinner.vel = 0;
  spinner.score = 0;

  pickMission(rng, state.level || 1);
  resetMech(rng);
  buildTableCache();
}

/* ---------------- Bölüm hedefleri ---------------- */
function targetFor(level) {
  return Math.round(10000 * Math.pow(1.5, level - 1) / 500) * 500;
}

/* ---------------- Bölüm içi yan görev (oynanışı çeşitlendirir) ----------------
   Her bölümde skor hedefinin yanında, oyuncuyu farklı bir davranışa yönlendiren
   rastgele bir mini görev belirlenir; bölüm teması aynı kalsa bile "bu bölümde
   ne yapmalıyım" sorusunun cevabı sürekli değişir. */
const MISSION_POOL = [
  { key: 'bumper', label: n => n + ' BUMPER VUR', base: 6, perLevel: 1.1 },
  { key: 'target', label: n => n + ' HEDEF DEVİR', base: 3, perLevel: 0.9 },
  { key: 'lane', label: n => n + ' ŞERİT YAK', base: 2, perLevel: 0.5 },
  { key: 'combo', label: n => 'KOMBO x' + n + ' YAP', base: 4, perLevel: 0.7 },
  { key: 'saucer', label: n => "SAUCER'A " + n + ' KEZ SOK', base: 1, perLevel: 0.35 },
  { key: 'spin', label: n => "SPINNER'I " + n + ' KEZ ÇEVİR', base: 4, perLevel: 0.9 },
];
let lastMissionKey = null;

function pickMission(rng, level) {
  let def = MISSION_POOL[Math.floor(rng() * MISSION_POOL.length)];
  if (def.key === lastMissionKey && MISSION_POOL.length > 1) {
    def = MISSION_POOL[(MISSION_POOL.indexOf(def) + 1 + Math.floor(rng() * (MISSION_POOL.length - 1))) % MISSION_POOL.length];
  }
  lastMissionKey = def.key;
  const target = Math.max(1, Math.round(def.base + def.perLevel * (level - 1)));
  state.missionKey = def.key;
  state.missionTarget = target;
  state.missionProgress = 0;
  state.missionDone = false;
  state.missionLabel = def.label(target);
  updateMissionHud();
}

function missionTick(key, amount = 1) {
  if (state.missionDone || state.missionKey !== key) return;
  state.missionProgress = Math.min(state.missionTarget, state.missionProgress + amount);
  updateMissionHud();
  if (state.missionProgress >= state.missionTarget) completeMission();
}

function completeMission() {
  state.missionDone = true;
  const bonus = 1200 * state.level;
  addScore(bonus, 251, 300);
  banner('GÖREV TAMAM! +' + fmt(bonus));
  SFX.extraBall(); buzz([30, 40, 30]);
  updateMissionHud();
}

const missionEl = document.getElementById('mission');
function updateMissionHud() {
  if (!state.missionKey) { missionEl.textContent = ''; return; }
  missionEl.textContent = (state.missionDone ? '✓ ' : '◆ ') + state.missionLabel + ' (' + state.missionProgress + '/' + state.missionTarget + ')';
  missionEl.classList.toggle('done', state.missionDone);
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
  combo: 0,                 // art arda vuruş kombosu
  comboTimer: 0,
  missionKey: null,          // bölüm içi yan görev
  missionTarget: 0,
  missionProgress: 0,
  missionDone: false,
  missionLabel: '',
  tilt: 0,                  // >0 iken flipperlar kilitli (TILT cezası)
  nudgeCooldown: 0,
};

const NUDGE_WINDOW = 8;      // saniye — bu süre içindeki dürtmeler sayılır
const NUDGE_LIMIT = 3;       // limit aşılırsa TILT
const NUDGE_COOLDOWN = 0.35; // art arda dürtme spamını önler
const TILT_DURATION = 3.2;   // flipperların kilitli kaldığı süre
const COMBO_WINDOW = 1.3;    // bu süre içinde yeni vuruş gelmezse kombo sıfırlanır
const nudgeLog = [];

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

/* ---------------- Kombo (art arda vuruş) ---------------- */
const comboEl = document.getElementById('combo');

function registerHit(base, x, y) {
  if (state.tilt > 0) { addScore(base, x, y); return; }
  state.combo++;
  state.comboTimer = COMBO_WINDOW;
  addScore(base, x, y);
  updateComboHud();
  if (!state.missionDone && state.missionKey === 'combo' && state.combo > state.missionProgress) {
    state.missionProgress = Math.min(state.missionTarget, state.combo);
    updateMissionHud();
    if (state.missionProgress >= state.missionTarget) completeMission();
  }
  if (state.combo >= 3 && state.combo % 3 === 0) {
    const bonus = 150 * state.combo;
    addScore(bonus, x, y - 24);
    banner('KOMBO x' + state.combo + '!');
    SFX.combo(); buzz(25);
  }
}

function updateComboHud() {
  if (state.combo >= 2) {
    comboEl.textContent = 'KOMBO x' + state.combo;
    comboEl.classList.remove('hidden');
    comboEl.classList.remove('pop');
    void comboEl.offsetWidth;
    comboEl.classList.add('pop');
  } else {
    comboEl.classList.add('hidden');
  }
}

/* ---------------- Dürtme (nudge) & TILT ---------------- */
function nudgeTable() {
  if (state.mode !== 'playing' || state.tilt > 0 || state.nudgeCooldown > 0) return;
  state.nudgeCooldown = NUDGE_COOLDOWN;
  nudgeLog.push(state.time);
  while (nudgeLog.length && state.time - nudgeLog[0] > NUDGE_WINDOW) nudgeLog.shift();

  const dir = Math.random() < 0.5 ? -1 : 1;
  for (const b of activeBalls) {
    b.vx += dir * rand(140, 230) + rand(-40, 40);
    b.vy -= rand(50, 130);
  }
  state.shake = Math.max(state.shake, 6);
  SFX.nudge(); buzz(20);

  if (nudgeLog.length > NUDGE_LIMIT) triggerTilt();
}

function triggerTilt() {
  state.tilt = TILT_DURATION;
  nudgeLog.length = 0;
  flipL.pressed = false;
  flipR.pressed = false;
  banner('TILT!');
  SFX.tilt(); buzz([80, 40, 80, 40, 120]);
}

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
  setTimeout(() => { if (state.mode === 'playing') banner(theme.mechLabel); }, 1900);
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
  state.tilt = 0;
  state.combo = 0;
  state.comboTimer = 0;
  nudgeLog.length = 0;
  updateComboHud();
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
  spawnParticles(b.x, clamp(b.y, 0, H - 10), theme.accent, 14, 200);

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
  setTimeout(() => { if (state.mode === 'playing') banner(theme.mechLabel); }, 1900);
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
    registerHit(75, qx, qy);
    spawnParticles(qx, qy, theme.flipA, 10, 320);
    SFX.sling(); buzz(15);
    state.glow = Math.max(state.glow, 0.5);
    (s.tag === 'slingL' ? slingL : slingR).flash = 0.25;
  } else if (s.tag === 'target' && s.target && s.target.up) {
    const t = s.target;
    t.up = false;
    t.seg.enabled = false;
    t.flash = 0.4;
    registerHit(1000, qx, qy);
    missionTick('target');
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
  registerHit(150, bp.x + nx * bp.r, bp.y + ny * bp.r);
  spawnParticles(b.x, b.y, theme.spark, 8, 300);
  SFX.bumper(); buzz(12);
  state.glow = Math.max(state.glow, 0.6);
  state.shake = Math.max(state.shake, 3);

  missionTick('bumper');

  const m = theme.mech;
  if (m && m.chainLightning) triggerChain(bp);
  if (m && m.bulletTime) {
    slowMoTimer = m.bulletTime.duration || 1.6;
    banner('ZAMAN YAVAŞLADI!');
  }
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
  const m = theme.mech || {};

  // Mıknatısa yakalanmış top: tamamen sabit, fizik dışı.
  if (b.caught && mech.magnet) {
    b.x = mech.magnet.x; b.y = mech.magnet.y; b.vx = 0; b.vy = 0;
    return;
  }

  let gScale = m.gravityScale || 1;
  if (m.zeroG) {
    const P = m.zeroG.period, D = m.zeroG.duration;
    const cyc = state.time % P;
    if (cyc > P - D) gScale *= -0.22;   // periyodik ters/sıfır yerçekimi nabzı
  }
  b.vy += levelGravity * gScale * dt;

  // --- temaya özgü kuvvetler ---
  if (m.water) {
    const k = Math.exp(-m.water.drag * dt);
    b.vx *= k; b.vy *= k;
  }
  if (m.ice) {
    let inPatch = false;
    for (const p of mech.icePatches) {
      const ex = (b.x - p.x) / p.rx, ey = (b.y - p.y) / p.ry;
      if (ex * ex + ey * ey < 1) { inPatch = true; break; }
    }
    if (!inPatch) { const k = Math.exp(-m.ice.baseDrag * dt); b.vx *= k; b.vy *= k; }
  }
  if (mech.wind && b.x < LANE_X - BALL_R) b.vx += mech.wind.v * dt;
  if (mech.fanObj) {
    const f = mech.fanObj;
    const dx = b.x - f.x, dy = b.y - f.y, d = Math.hypot(dx, dy);
    if (d < f.r && d > 4) {
      const a = Math.min(900, (m.fan.force || 26000000) / (d * d));
      b.vx += dx / d * a * dt; b.vy += dy / d * a * dt;
    }
  }
  if (m.wells) {
    for (const bp of bumpers) {
      const dx = bp.x - b.x, dy = bp.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 > 48400) continue;
      const d = Math.sqrt(d2) || 1;
      if (d < bp.r + BALL_R + 3) continue;
      const a = Math.min(m.wells.maxA, m.wells.G / d2);
      b.vx += dx / d * a * dt;
      b.vy += dy / d * a * dt;
    }
  }
  for (const p of mech.pools) {
    const ex = (b.x - p.x) / p.rx, ey = (b.y - p.y) / p.ry;
    if (ex * ex + ey * ey < 1) {
      const k = Math.exp(-2.2 * dt);
      b.vx *= k; b.vy *= k;
    }
  }
  for (const p of mech.quicksandPits) {
    const ex = (b.x - p.x) / p.rx, ey = (b.y - p.y) / p.ry;
    if (ex * ex + ey * ey < 1) {
      b.sinkT = (b.sinkT || 0) + dt;
      const k = Math.exp(-3.2 * dt);
      b.vx *= k; b.vy *= k;
      b.vx += (p.x - b.x) * 0.8 * dt;
      b.vy += (p.y - b.y) * 0.8 * dt;
      if (b.sinkT > (m.quicksand.sinkTime || 2.2)) {
        b.vy = -1300; b.vx = rand(-150, 150);
        b.sinkT = 0;
        registerHit(350, p.x, p.y - 20);
        banner('BATAKLIKTAN KURTULDU!');
        spawnParticles(p.x, p.y, theme.accent, 20, 340);
        SFX.eject(); buzz(30);
      }
    } else if (b.sinkT) {
      b.sinkT = Math.max(0, b.sinkT - dt * 2);
    }
  }
  if (mech.geyser && mech.geyser.phase === 'blast') {
    const g = mech.geyser;
    const dx = b.x - g.x, dy = b.y - g.y;
    if (dx * dx + dy * dy < g.r * g.r) b.vy -= 5200 * dt;
  }
  if (mech.magnet && !mech.magnet.catching) {
    const mg = mech.magnet;
    const dx = mg.x - b.x, dy = mg.y - b.y, d2 = dx * dx + dy * dy;
    if (d2 < mg.r * mg.r) {
      b.caught = true; mg.catching = true; mg.holdTimer = mg.holdTime;
      b.vx = 0; b.vy = 0; b.x = mg.x; b.y = mg.y;
      spawnParticles(mg.x, mg.y, theme.accent, 14, 200);
      SFX.saucer(); buzz(20);
      return;
    } else if (d2 < (mg.r * 2.4) * (mg.r * 2.4)) {
      const d = Math.sqrt(d2) || 1;
      const a = Math.min(700, 1400000 / d2);
      b.vx += dx / d * a * dt; b.vy += dy / d * a * dt;
    }
  }
  if (mech.conveyorZone) {
    const z = mech.conveyorZone;
    if (b.x > z.x && b.x < z.x + z.w && b.y > z.y && b.y < z.y + z.h) b.vx += z.dir * (m.conveyor.force || 190) * dt;
  }

  const sp = Math.hypot(b.vx, b.vy);
  if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }
  const prevY = b.y, prevX = b.x;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  for (const s of segs) collideSegment(b, s, dt);
  for (const bp of bumpers) collideBumper(b, bp);
  for (const br of mech.bricks) if (br.alive) collideBrick(b, br);
  if (m.pinwheel) collidePinwheel(b);
  if (m.launchPads) collideLaunchPads(b);
  collideFlipper(b, flipL, dt);
  collideFlipper(b, flipR, dt);

  // --- portallar ---
  if (mech.portals) {
    const A = mech.portals.a, Bp = mech.portals.b;
    for (const [src, dst] of [[A, Bp], [Bp, A]]) {
      if (src.cooldown > 0) continue;
      const dx = b.x - src.x, dy = b.y - src.y;
      if (dx * dx + dy * dy < src.r * src.r) {
        const speed = Math.hypot(b.vx, b.vy);
        b.x = dst.x + Math.cos(dst.exitAngle) * (dst.r + BALL_R + 4);
        b.y = dst.y + Math.sin(dst.exitAngle) * (dst.r + BALL_R + 4);
        b.vx = Math.cos(dst.exitAngle) * speed * 1.08;
        b.vy = Math.sin(dst.exitAngle) * speed * 1.08;
        dst.cooldown = 0.45;
        registerHit(300, dst.x, dst.y);
        spawnParticles(dst.x, dst.y, dst.color, 16, 300);
        SFX.saucer(); buzz(15);
        break;
      }
    }
  }

  // --- kanal kapısı mantığı ---
  const inLane = b.x > LANE_X - BALL_R;
  if (laneOpen && !inLane && b.y < 400) {
    laneOpen = false;
    gateSeg.enabled = true;
  }

  // --- lazer kapı: yatay hat geçişi ---
  if (mech.laser) {
    const L = mech.laser;
    if ((prevY < L.y) !== (b.y < L.y)) {
      const cx = (prevX + b.x) / 2;
      if (cx > L.x1 && cx < L.x2) {
        if (L.on) {
          b.vy = -b.vy * 0.6;
          b.vx += rand(-80, 80);
          spawnParticles(cx, L.y, '#ff3355', 14, 300);
          SFX.wall(); buzz(15);
          state.shake = Math.max(state.shake, 3);
        } else {
          registerHit(400, cx, L.y);
          spawnParticles(cx, L.y, theme.hud, 10, 250);
          SFX.spinner();
        }
      }
    }
  }

  // --- spinner: kanal içinde y=500 çizgisini geçiş ---
  if (inLane && ((prevY < spinner.y) !== (b.y < spinner.y))) {
    const sp2 = Math.abs(b.vy);
    spinner.vel = Math.max(spinner.vel, sp2 * 0.05);
    spinner.score += 4 + ((sp2 / 260) | 0);
    missionTick('spin');
  }

  // --- rollover şeritleri ---
  for (const l of lanes) {
    const dx = b.x - l.x, dy = b.y - l.y;
    if (dx * dx + dy * dy < 26 * 26 && !l.hot) {
      l.hot = true;
      if (!l.lit) {
        l.lit = true;
        l.flash = 0.5;
        registerHit(500, l.x, l.y);
        missionTick('lane');
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
  missionTick('saucer');
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
  if (state.tilt > 0) state.tilt = Math.max(0, state.tilt - dt);
  if (state.nudgeCooldown > 0) state.nudgeCooldown -= dt;
  if (state.combo > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) { state.combo = 0; updateComboHud(); }
  }

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
  updateMech(dt);

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

  // film greni dokusu — düz gradyan hissini kırar
  ensureNoise();
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = theme.grain || 0.05;
  c.globalCompositeOperation = 'overlay';
  c.fillStyle = c.createPattern(noiseCv, 'repeat');
  c.fillRect(0, 0, tableCache.width, tableCache.height);
  c.restore();

  // vinyet — kenarlara doğru kararma, derinlik hissi
  const vg = c.createRadialGradient(270, 460, 230, 270, 460, 640);
  vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
  c.fillStyle = vg;
  c.fillRect(0, 0, W, H);

  // duvarlar: pahlı (bevel) malzeme görünümü — gölge, gövde, üst yüz, parlak kenar
  const ws = theme.wallStyle;
  function strokeLine(x1, y1, x2, y2, color, width, blur = 0) {
    c.strokeStyle = color;
    c.lineWidth = width;
    if (blur) { c.shadowColor = color; c.shadowBlur = blur; }
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    if (blur) c.shadowBlur = 0;
  }
  function strokeSeg(s, width) {
    if (ws.dash) {
      c.lineCap = 'butt';
      c.setLineDash(ws.dash);
      strokeLine(s.x1, s.y1, s.x2, s.y2, ws.color, width);
      c.setLineDash([]);
      c.lineCap = 'round';
      return;
    }
    strokeLine(s.x1 + 1.5, s.y1 + 2.5, s.x2 + 1.5, s.y2 + 2.5, 'rgba(0, 0, 0, 0.45)', width + 2.5);
    strokeLine(s.x1, s.y1, s.x2, s.y2, shade(ws.color, -0.4), width + 1);
    strokeLine(s.x1, s.y1, s.x2, s.y2, ws.color, width * 0.66, ws.blur);
    strokeLine(s.x1 - 0.8, s.y1 - 1.4, s.x2 - 0.8, s.y2 - 1.4, 'rgba(255, 255, 255, 0.30)', Math.max(1.2, width * 0.22));
  }
  c.lineCap = 'round';
  for (const s of segs) {
    if (s.tag === 'gate' || s.tag === 'target' || s.tag === 'slingL' || s.tag === 'slingR') continue;
    strokeSeg(s, s.tag === 'post' ? Math.max(2, ws.width - 1.5) : ws.width);
  }

  // dış duvar perçinleri — kabine/masa hissi
  if (!ws.dash) {
    for (const [px, py] of [
      [15, 320], [15, 430], [15, 540], [15, 650],
      [525, 320], [525, 430], [525, 540], [525, 650], [525, 760], [525, 870],
    ]) {
      c.fillStyle = 'rgba(0, 0, 0, 0.5)';
      cFill(c, px, py, 3.4);
      c.fillStyle = shade(ws.color, 0.25);
      cFill(c, px - 0.7, py - 0.7, 1.5);
    }
  }

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

  // saucer yuvası — gerçek bir çukur gibi: içe gölgeli, kenarı ışıklı
  const sr = saucer.r + 4;
  const hole = c.createRadialGradient(saucer.x, saucer.y - 2, 2, saucer.x, saucer.y, sr);
  hole.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
  hole.addColorStop(0.65, 'rgba(0, 0, 0, 0.45)');
  hole.addColorStop(1, withAlpha(theme.saucer, 0.30));
  c.fillStyle = hole;
  cFill(c, saucer.x, saucer.y, sr);
  c.strokeStyle = shade(theme.saucer, -0.25);
  c.lineWidth = 3;
  cStroke(c, saucer.x, saucer.y, sr);
  // alt kenara ışık, üst kenara gölge (çukur yanılsaması)
  c.strokeStyle = withAlpha(theme.saucerHi, 0.65);
  c.lineWidth = 2;
  c.beginPath(); c.arc(saucer.x, saucer.y, sr, 0.25 * Math.PI, 0.75 * Math.PI); c.stroke();
  c.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  c.beginPath(); c.arc(saucer.x, saucer.y, sr - 1.5, 1.2 * Math.PI, 1.8 * Math.PI); c.stroke();

  // tema adı filigranı
  c.save();
  c.textAlign = 'center';
  c.fillStyle = withAlpha(theme.hud, 0.12);
  c.font = '900 42px "Segoe UI", Roboto, sans-serif';
  c.fillText(theme.name, 251, 662);
  c.font = '800 16px "Segoe UI", Roboto, sans-serif';
  c.fillStyle = withAlpha(theme.hud, 0.10);
  c.fillText(theme.mechLabel || 'PINBALL', 251, 690);
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

  rebuildBumperSprites();
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
  drawMech();
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
  drawTilt();
}

function drawMech() {
  const m = theme.mech || {};
  const t = state.time;

  // kızak rayları (hareketli bumperlar)
  if (m.bumperMotion === 'slideX') {
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = withAlpha(theme.hud, 0.3);
    ctx.lineWidth = 2;
    for (const b of bumpers) ln(ctx, b.baseX - 44, b.y, b.baseX + 44, b.y);
    ctx.restore();
  }

  // şurup havuzları
  for (const p of mech.pools) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 107, 158, 0.22)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255, 209, 224, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const rr = 0.55 + 0.12 * Math.sin(t * 2 + p.x);
    ctx.strokeStyle = 'rgba(255, 209, 224, 0.25)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx * rr, p.ry * rr, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.30)';
    ctx.beginPath(); ctx.ellipse(p.x - p.rx * 0.35, p.y - p.ry * 0.35, p.rx * 0.22, p.ry * 0.2, -0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // piksel tuğlalar
  for (const br of mech.bricks) {
    if (!br.alive) continue;
    ctx.fillStyle = 'rgba(51, 255, 102, 0.16)';
    ctx.fillRect(br.x, br.y, br.w, br.h);
    ctx.strokeStyle = '#33ff66';
    ctx.lineWidth = 2;
    ctx.strokeRect(br.x + 1, br.y + 1, br.w - 2, br.h - 2);
    ctx.fillStyle = 'rgba(200, 255, 215, 0.30)';
    ctx.fillRect(br.x + 3, br.y + 3, br.w - 6, 2);
  }

  // gayzer
  if (mech.geyser) {
    const g = mech.geyser;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255, 122, 60, 0.4)';
    ctx.lineWidth = 2;
    cStroke(ctx, g.x, g.y, 20);
    ctx.setLineDash([]);
    if (g.phase === 'warn') {
      const pulse = 0.5 + 0.5 * Math.sin(t * 14);
      ctx.strokeStyle = `rgba(255, 140, 70, ${0.35 + 0.45 * pulse})`;
      ctx.lineWidth = 3.5;
      ctx.shadowColor = '#ff7a3c'; ctx.shadowBlur = 14;
      cStroke(ctx, g.x, g.y, g.r * (0.8 + 0.12 * pulse));
      ctx.shadowBlur = 0;
    } else if (g.phase === 'blast') {
      const col = ctx.createLinearGradient(0, g.y, 0, g.y - 300);
      col.addColorStop(0, 'rgba(255, 190, 100, 0.55)');
      col.addColorStop(1, 'rgba(255, 120, 50, 0)');
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(g.x - 34, g.y + 10);
      ctx.lineTo(g.x - 14, g.y - 300);
      ctx.lineTo(g.x + 14, g.y - 300);
      ctx.lineTo(g.x + 34, g.y + 10);
      ctx.closePath(); ctx.fill();
      if (Math.random() < 0.6) spawnParticles(g.x + rand(-20, 20), g.y - rand(0, 60), '#ffb060', 2, 320);
    }
    ctx.restore();
  }

  // rüzgar çizgileri + göstergesi
  if (mech.wind) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 210, 160, 0.25)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const s of mech.streaks) ln(ctx, s.x, s.y, s.x + s.len * Math.sign(mech.wind.v || 1), s.y);
    const wv = mech.wind.v / 260;
    const ax = 251, ay = 168, len = wv * 44;
    if (Math.abs(len) > 4) {
      ctx.strokeStyle = withAlpha(theme.hud, 0.75);
      ctx.lineWidth = 3;
      ln(ctx, ax - len, ay, ax + len, ay);
      const dir = Math.sign(len);
      ln(ctx, ax + len, ay, ax + len - dir * 8, ay - 5);
      ln(ctx, ax + len, ay, ax + len - dir * 8, ay + 5);
    }
    ctx.restore();
  }

  // buz yamaları
  for (const p of mech.icePatches) {
    ctx.save();
    ctx.fillStyle = 'rgba(190, 236, 255, 0.16)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(230, 250, 255, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + p.x * 0.05;
      ln(ctx, p.x + Math.cos(a) * p.rx * 0.2, p.y + Math.sin(a) * p.ry * 0.2,
             p.x + Math.cos(a) * p.rx * 0.85, p.y + Math.sin(a) * p.ry * 0.85);
    }
    ctx.restore();
  }

  // bataklık çukurları
  for (const p of mech.quicksandPits) {
    ctx.save();
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.rx);
    g.addColorStop(0, 'rgba(60, 50, 20, 0.55)');
    g.addColorStop(1, 'rgba(40, 60, 30, 0.15)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(150, 170, 90, 0.4)';
    ctx.lineWidth = 2; ctx.stroke();
    if (Math.random() < 0.3) spawnParticles(p.x + rand(-p.rx * 0.5, p.rx * 0.5), p.y, '#7a8f4a', 1, 40);
    ctx.restore();
  }

  // portallar
  if (mech.portals) {
    for (const p of [mech.portals.a, mech.portals.b]) {
      ctx.save();
      ctx.translate(p.x, p.y);
      for (let i = 0; i < 3; i++) {
        ctx.rotate(t * (1.4 - i * 0.3) * (i % 2 ? -1 : 1));
        ctx.strokeStyle = withAlpha(p.color, 0.75 - i * 0.18);
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(0, 0, p.r * (1 - i * 0.22), p.r * 0.4 * (1 - i * 0.22), 0, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // mıknatıs
  if (mech.magnet) {
    const mg = mech.magnet;
    ctx.save();
    ctx.translate(mg.x, mg.y);
    const pulse = mg.catching ? 1.3 : 0.9 + 0.1 * Math.sin(t * 3);
    ctx.strokeStyle = withAlpha(theme.accent, 0.5);
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) cStroke(ctx, 0, 0, (mg.r * 0.6 + i * 10) * pulse);
    ctx.fillStyle = '#c43b3b';
    ctx.beginPath(); ctx.arc(0, 0, mg.r, Math.PI * 0.15, Math.PI * 0.85); ctx.fill();
    ctx.fillStyle = '#3b5fc4';
    ctx.beginPath(); ctx.arc(0, 0, mg.r, Math.PI * 1.15, Math.PI * 1.85); ctx.fill();
    ctx.fillStyle = '#1a2350';
    cFill(ctx, 0, 0, mg.r * 0.35);
    ctx.restore();
  }

  // lazer kapı
  if (mech.laser) {
    const L = mech.laser;
    ctx.save();
    if (L.on) {
      ctx.strokeStyle = 'rgba(255, 50, 70, 0.9)';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#ff3246'; ctx.shadowBlur = 16;
    } else {
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = withAlpha(theme.hud, 0.35);
      ctx.lineWidth = 2;
    }
    ln(ctx, L.x1, L.y, L.x2, L.y);
    ctx.restore();
    ctx.fillStyle = theme.accent;
    cFill(ctx, L.x1, L.y, 6);
    cFill(ctx, L.x2, L.y, 6);
  }

  // konveyör bant
  if (mech.conveyorZone) {
    const z = mech.conveyorZone;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.strokeStyle = theme.accent; ctx.lineWidth = 2;
    ctx.strokeRect(z.x, z.y, z.w, z.h);
    ctx.beginPath(); ctx.rect(z.x, z.y, z.w, z.h); ctx.clip();
    const off = ((t * 60 * z.dir) % 26 + 26) % 26;
    ctx.fillStyle = withAlpha(theme.accent, 0.4);
    for (let x = z.x - 26 + off; x < z.x + z.w; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, z.y + z.h / 2 - 10);
      ctx.lineTo(x + 10 * z.dir, z.y + z.h / 2);
      ctx.lineTo(x, z.y + z.h / 2 + 10);
      ctx.fill();
    }
    ctx.restore();
  }

  // rüzgar değirmeni
  if (mech.pinwheelObj) {
    const p = mech.pinwheelObj;
    ctx.save();
    ctx.translate(p.x, p.y);
    for (let k = 0; k < 4; k++) {
      const a = p.angle + k * Math.PI / 2;
      ctx.save();
      ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, p.len, 0);
      g.addColorStop(0, withAlpha(theme.accent, 0.9));
      g.addColorStop(1, withAlpha(theme.accent, 0.25));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(4, -p.thickness / 2);
      ctx.lineTo(p.len, -3);
      ctx.lineTo(p.len, 3);
      ctx.lineTo(4, p.thickness / 2);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = theme.hud;
    cFill(ctx, 0, 0, 10);
    ctx.restore();
  }

  // yelpaze (fan)
  if (mech.fanObj) {
    const f = mech.fanObj;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const rr = ((t * 60 + i * 46) % 138);
      ctx.strokeStyle = withAlpha(theme.hud, Math.max(0, 0.28 - rr / 500));
      ctx.lineWidth = 2;
      cStroke(ctx, f.x, f.y, 20 + rr);
    }
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    ctx.fillStyle = theme.accent;
    for (let k = 0; k < 3; k++) {
      ctx.save();
      ctx.rotate(k * TAU / 3);
      ctx.beginPath();
      ctx.ellipse(16, 0, 16, 6, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = theme.hud;
    cFill(ctx, 0, 0, 8);
    ctx.restore();
  }

  // fırlatma yastıkları
  for (const p of mech.pads) {
    ctx.save();
    ctx.translate(p.x, p.y);
    const f = p.flash > 0 ? p.flash / 0.3 : 0;
    ctx.fillStyle = withAlpha(theme.accent, 0.35 + f * 0.4);
    cFill(ctx, 0, 0, p.r);
    ctx.strokeStyle = f > 0 ? '#fff' : theme.hud;
    ctx.lineWidth = 2.5;
    cStroke(ctx, 0, 0, p.r);
    ctx.rotate(p.angle + Math.PI / 2);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -p.r * 0.55);
    ctx.lineTo(-7, -p.r * 0.1);
    ctx.lineTo(7, -p.r * 0.1);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // sıfır yerçekimi nabzı: periyodik ekran tonu + uyarı
  if (m.zeroG) {
    const P = m.zeroG.period, D = m.zeroG.duration;
    const cyc = t % P;
    if (cyc > P - D) {
      ctx.fillStyle = withAlpha(theme.hud, 0.09);
      ctx.fillRect(0, 0, W, H);
    } else if (cyc > P - D - 0.6) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 18);
      ctx.fillStyle = withAlpha(theme.hud, 0.05 * pulse);
      ctx.fillRect(0, 0, W, H);
    }
  }

  // zincir şimşek bağlantıları
  for (const bolt of mech.bolts) {
    const a = 1 - bolt.t / 0.4;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#bfe0ff';
    ctx.shadowColor = '#7ecbff'; ctx.shadowBlur = 10;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(bolt.x1, bolt.y1);
    const segN = 5;
    for (let i = 1; i < segN; i++) {
      const f = i / segN;
      const jx = (bolt.x1 + (bolt.x2 - bolt.x1) * f) + rand(-10, 10);
      const jy = (bolt.y1 + (bolt.y2 - bolt.y1) * f) + rand(-10, 10);
      ctx.lineTo(jx, jy);
    }
    ctx.lineTo(bolt.x2, bolt.y2);
    ctx.stroke();
    ctx.restore();
  }
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

/* Bumper sprite önbelleği: gövde ve ışıma bir kez çizilir,
   her karede yalnızca drawImage yapılır (shadowBlur yok). */
function rebuildBumperSprites() {
  for (const b of bumpers) {
    const half = b.baseR * 1.6 + 6;
    b.sprHalf = half;
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.max(2, Math.ceil(half * 2 * viewScale));
    const c = cv.getContext('2d');
    c.scale(viewScale, viewScale);
    c.translate(half, half);
    c.lineCap = 'round';
    theme.paintBumper(c, b.baseR, b);
    b.sprite = cv;

    if (theme.bumperGlow) {
      const gr = b.baseR * 2.1;
      const gcv = document.createElement('canvas');
      gcv.width = gcv.height = Math.max(2, Math.ceil(gr * 2 * viewScale));
      const gc = gcv.getContext('2d');
      gc.scale(viewScale, viewScale);
      const g = gc.createRadialGradient(gr, gr, b.baseR * 0.4, gr, gr, gr);
      g.addColorStop(0, withAlpha(theme.bumperGlow, 0.5));
      g.addColorStop(0.5, withAlpha(theme.bumperGlow, 0.18));
      g.addColorStop(1, withAlpha(theme.bumperGlow, 0));
      gc.fillStyle = g;
      gc.fillRect(0, 0, gr * 2, gr * 2);
      b.glowSprite = gcv;
      b.glowHalf = gr;
    } else {
      b.glowSprite = null;
    }
  }
}

function drawBumpers() {
  const t = state.time;
  for (const b of bumpers) {
    const f = b.flash > 0 ? b.flash / 0.3 : 0;
    if (b.glowSprite) {
      let ga = 0.85;
      if (theme.glowPulse) ga = 0.55 + 0.4 * Math.sin(t * 3 + b.phase);
      ctx.globalAlpha = Math.min(1, ga + f * 0.5);
      const gs = b.glowHalf * 2 * (1 + f * 0.3);
      ctx.drawImage(b.glowSprite, b.x - gs / 2, b.y - gs / 2, gs, gs);
      ctx.globalAlpha = 1;
    }
    if (theme.bumperUnder) { ctx.save(); theme.bumperUnder(ctx, b, t); ctx.restore(); }
    ctx.save();
    ctx.translate(b.x, b.y);
    if (theme.bumperSpin) ctx.rotate(t * theme.bumperSpin + b.phase);
    const sc = b.r / b.baseR;
    if (sc !== 1) ctx.scale(sc, sc);
    ctx.drawImage(b.sprite, -b.sprHalf, -b.sprHalf, b.sprHalf * 2, b.sprHalf * 2);
    ctx.restore();
    if (f > 0) {
      ctx.globalAlpha = f * 0.6;
      ctx.fillStyle = '#fff';
      cFill(ctx, b.x, b.y, b.r);
      ctx.globalAlpha = 1;
    }
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
      ctx.globalAlpha = (0.1 + 0.3 * (0.5 + 0.5 * Math.sin(p.life * 4 + p.phase))) * fade;
      ctx.fillStyle = a.color;
      cFill(ctx, p.x, p.y, 5);
      ctx.globalAlpha = (0.3 + 0.6 * (0.5 + 0.5 * Math.sin(p.life * 4 + p.phase))) * fade;
      cFill(ctx, p.x, p.y, 2);
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
      const h = t.y2 - t.y1;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(t.x - 5, t.y1 + 2, 10, h);
      ctx.fillStyle = theme.target;
      ctx.fillRect(t.x - 4, t.y1, 8, h);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillRect(t.x - 1.4, t.y1 + 3, 2.8, h - 6);
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
  // çukur içinde nabız gibi atan halka (blur yok)
  ctx.strokeStyle = withAlpha(theme.saucerHi, 0.25 + 0.4 * pulse + saucer.glow * 0.3);
  ctx.lineWidth = 2.5;
  cStroke(ctx, saucer.x, saucer.y, saucer.r * (0.45 + 0.25 * pulse));
  if (saucer.glow > 0) {
    ctx.globalAlpha = saucer.glow * 0.5;
    ctx.fillStyle = theme.saucerHi;
    cFill(ctx, saucer.x, saucer.y, saucer.r - 4);
    ctx.globalAlpha = 1;
  }
  // kilit göstergeleri
  for (let i = 0; i < 3; i++) {
    const lit = i < saucer.locks;
    ctx.fillStyle = lit ? theme.saucerHi : withAlpha(theme.saucerHi, 0.2);
    cFill(ctx, saucer.x - 16 + i * 16, saucer.y + saucer.r + 14, lit ? 4.5 : 4);
    if (lit) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      cFill(ctx, saucer.x - 16 + i * 16 - 1, saucer.y + saucer.r + 13, 1.4);
    }
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
  ctx.lineCap = 'round';
  for (const f of [flipL, flipR]) {
    const tip = flipperTip(f, f.angle);
    // yere düşen gölge
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = f.r * 2 + 2;
    ctx.beginPath();
    ctx.moveTo(f.px + 2, f.py + 4);
    ctx.lineTo(tip.x + 2, tip.y + 4);
    ctx.stroke();
    // gövde
    const grad = ctx.createLinearGradient(f.px, f.py, tip.x, tip.y);
    grad.addColorStop(0, theme.flipA);
    grad.addColorStop(1, theme.flipB);
    ctx.strokeStyle = grad;
    ctx.lineWidth = f.r * 2;
    if (f.pressed) { ctx.shadowColor = theme.flipB; ctx.shadowBlur = 14; }
    ctx.beginPath();
    ctx.moveTo(f.px, f.py);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // üst yüz parlaklığı
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = f.r * 0.6;
    ctx.beginPath();
    ctx.moveTo(f.px - 1, f.py - f.r * 0.55);
    ctx.lineTo(tip.x - 1, tip.y - f.r * 0.55);
    ctx.stroke();
    // kauçuk uç
    ctx.fillStyle = '#1a2350';
    cFill(ctx, tip.x, tip.y, f.r * 0.72);
    ctx.strokeStyle = shade(theme.flipB, -0.2);
    ctx.lineWidth = 2;
    cStroke(ctx, tip.x, tip.y, f.r * 0.72);
    // pivot
    ctx.fillStyle = '#1a2350';
    cFill(ctx, f.px, f.py, f.r + 3);
    ctx.strokeStyle = theme.flipA;
    ctx.lineWidth = 2;
    cStroke(ctx, f.px, f.py, f.r + 3);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    cFill(ctx, f.px - 2, f.py - 2, 2.2);
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

let ballGrad = null;
function drawBall(b) {
  // iz: 10 ayrı daire yerine 2 çizgi (çok daha ucuz)
  if (b.trail && b.trail.length > 1) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(b.trail[0].x, b.trail[0].y);
    for (let i = 1; i < b.trail.length; i++) ctx.lineTo(b.trail[i].x, b.trail[i].y);
    ctx.strokeStyle = withAlpha(theme.trail, 0.10);
    ctx.lineWidth = BALL_R * 1.5;
    ctx.stroke();
    ctx.strokeStyle = withAlpha(theme.trail, 0.14);
    ctx.lineWidth = BALL_R * 0.55;
    ctx.stroke();
  }
  // temas gölgesi
  ctx.fillStyle = 'rgba(0, 0, 0, 0.30)';
  ctx.beginPath();
  ctx.ellipse(b.x + 4, b.y + 7, BALL_R * 0.95, BALL_R * 0.55, 0, 0, TAU);
  ctx.fill();
  // krom gövde (gradyan bir kez üretilir)
  if (!ballGrad) {
    ballGrad = ctx.createRadialGradient(-4, -5, 2, 0, 0, BALL_R);
    ballGrad.addColorStop(0, '#ffffff');
    ballGrad.addColorStop(0.35, '#e6eeff');
    ballGrad.addColorStop(0.8, '#8b9cc9');
    ballGrad.addColorStop(1, '#5a688f');
  }
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.fillStyle = ballGrad;
  cFill(ctx, 0, 0, BALL_R);
  // zeminden renk yansıması
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = theme.hud;
  ctx.beginPath();
  ctx.ellipse(0, BALL_R * 0.45, BALL_R * 0.62, BALL_R * 0.3, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  // spekülar parlamalar
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  cFill(ctx, -BALL_R * 0.32, -BALL_R * 0.4, 2.8);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  cFill(ctx, BALL_R * 0.25, -BALL_R * 0.05, 1.3);
  ctx.restore();
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
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  for (const p of popups) {
    const a = 1 - p.t / p.life;
    const x = clamp(p.x, 40, W - 40), y = p.y - p.t * 50;
    ctx.globalAlpha = a;
    ctx.strokeText(p.text, x, y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, x, y);
  }
  ctx.globalAlpha = 1;
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

function drawTilt() {
  if (state.tilt <= 0) return;
  if (Math.sin(state.time * 16) < -0.3) return;   // hızlı yanıp sönme
  ctx.textAlign = 'center';
  ctx.font = '900 30px "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = 'rgba(255, 70, 70, 0.9)';
  ctx.shadowColor = 'rgba(255, 40, 40, 0.8)';
  ctx.shadowBlur = 14;
  ctx.fillText('T İ L T', 251, 172);
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
  if (state.tilt > 0 && (z === 'L' || z === 'R')) return;
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
  else if (e.code === 'KeyN') { if (state.mode === 'playing') nudgeTable(); }
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
document.getElementById('btn-nudge').addEventListener('click', () => {
  SFX.ensure();
  if (state.mode === 'playing') nudgeTable();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'playing') pauseGame();
});

/* ---------------- Ana döngü ---------------- */
let lastTime = performance.now();
let perfAvg = 16, perfTimer = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastTime) / 1000;
  lastTime = now;

  // otomatik kalite: kare süresi uzun kalırsa çözünürlüğü kademeli düşür
  perfAvg += (dt * 1000 - perfAvg) * 0.04;
  perfTimer += dt;
  if (perfTimer > 3) {
    perfTimer = 0;
    if (perfAvg > 21 && dprCap > 1) {
      dprCap = Math.max(1, dprCap - 0.5);
      resize();
    }
  }

  if (dt > 0.05) dt = 0.05;
  if (state.mode === 'playing') {
    let simDt = dt;
    if (slowMoTimer > 0) {
      slowMoTimer = Math.max(0, slowMoTimer - dt);
      simDt = dt * 0.3;
    }
    update(simDt);
  } else state.time += dt;
  draw();
}

/* ---------------- Başlat ---------------- */
document.querySelector('#hiscore span').textContent = fmt(state.hiscore);
buildLevel((Math.random() * 2 ** 31) | 0);   // menü arkaplanı için rastgele masa
resize();
updateHud();
if (SFX.muted) {
  document.getElementById('icon-sound-on').classList.add('hidden');
  document.getElementById('icon-sound-off').classList.remove('hidden');
}
requestAnimationFrame(frame);

// test kancası (otomatik testler için)
window.__neonpinball = {
  state, addScore, registerHit, nudgeTable, triggerTilt,
  THEMES, mech, bumpers, saucer,
  buildRandomLevel() { buildLevel((Math.random() * 2 ** 31) | 0); },
  forceTheme(idx) {
    forcedThemeIdx = idx;
    buildLevel((Math.random() * 2 ** 31) | 0);
    forcedThemeIdx = null;
  },
};

})();
