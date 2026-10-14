'use strict';
(() => {
// ---------- constants ----------
const T = 32, W = 80, H = 17, VW = 960, VH = H * T;
const EMPTY = 0, GROUND = 1, BRICK = 2, QBLOCK = 3, COIN = 4, SPIKE = 5, ENEMY = 6,
      START = 7, GOAL = 8, USED = 9, SPRING = 10, HPLAT = 11, VPLAT = 12;
const PALETTE = [
  { t: GROUND, name: 'Ground', key: '1', group: 'Blocks', desc: 'Solid floor and walls. You can stand on it and bump into it.' },
  { t: BRICK, name: 'Brick', key: '2', group: 'Blocks', desc: 'Solid, but it shatters when you hit it from below.' },
  { t: QBLOCK, name: '? Block', key: '3', group: 'Blocks', desc: 'Hit it from below to pop out a coin.' },
  { t: COIN, name: 'Coin', key: '4', group: 'Blocks', desc: 'Grab it for points. Players try to collect them all.' },
  { t: SPIKE, name: 'Spikes', key: '5', group: 'Danger', desc: 'Touch them and you restart. Put them on the floor.' },
  { t: ENEMY, name: 'Enemy', key: '6', group: 'Danger', desc: 'Patrols back and forth. Stomp it from above, avoid it from the side.' },
  { t: SPRING, name: 'Spring', key: '7', group: 'Movement', desc: 'Land on it for a huge bounce. Reach high platforms.' },
  { t: HPLAT, name: 'Slider', key: '8', group: 'Movement', desc: 'A platform that slides left and right. Ride it across gaps.' },
  { t: VPLAT, name: 'Lift', key: '9', group: 'Movement', desc: 'A platform that moves up and down.' },
  { t: START, name: 'Start', key: 'S', group: 'Markers', desc: 'Where the player spawns. There is only one.' },
  { t: GOAL, name: 'Goal flag', key: 'G', group: 'Markers', desc: 'Reach the pole to win. There is only one, and you need it to play.' },
  { t: EMPTY, name: 'Eraser', key: 'E', group: 'Markers', desc: 'Click to clear a tile. Right-click erases with any tile selected.' },
];
const STORE = 'lbl-level', CLEARED = 'lbl-cleared', STEPS = 'lbl-steps-hidden';

const $ = id => document.getElementById(id);
const cv = $('c');
let ctx = cv.getContext('2d');
const overlay = $('overlay'), toastEl = $('toast'), hint = $('hint'), slider = $('scroll');
const btnPlay = $('btnPlay'), btnShare = $('btnShare'), btnMute = $('btnMute');

// ---------- level encode / decode (lives in the URL) ----------
// v2 (what links use now): "." + base64url of packed runs. One byte per run = tile<<4 | length (1..14);
//   a low nibble of 15 means "15 + a varint that follows". Roughly 40% shorter than v1.
// v1 (legacy): base64 of text runs "<tile><length>." in base36. Old links still decode, and v1 is
//   still used internally as a stable level id so saved scores and "cleared" flags keep matching.
const bytesToB64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64ToBytes = s => {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};
function encodeV1(l) {
  let out = '', i = 0;
  while (i < l.length) {
    const t = l[i]; let n = 1;
    while (i + n < l.length && l[i + n] === t) n++;
    out += t.toString(36) + n.toString(36) + '.';
    i += n;
  }
  return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeV1(s) {
  try {
    const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const l = new Uint8Array(W * H); let i = 0;
    for (const run of raw.split('.')) {
      if (!run) continue;
      let t = parseInt(run[0], 36); const n = parseInt(run.slice(1), 36);
      if (!(t >= 0 && t <= VPLAT) || t === USED || !(n > 0)) t = 0;
      for (let k = 0; k < n && i < l.length; k++) l[i++] = t;
    }
    return i === l.length ? l : null;
  } catch (e) { return null; }
}
function encodeV2(l) {
  const b = []; let i = 0;
  while (i < l.length) {
    const t = l[i]; let n = 1;
    while (i + n < l.length && l[i + n] === t) n++;
    i += n;
    if (t > 15) throw new Error('tile out of range');
    if (n < 15) b.push((t << 4) | n);
    else {
      b.push((t << 4) | 15);
      let r = n - 15;
      while (r >= 128) { b.push((r & 127) | 128); r >>= 7; }
      b.push(r);
    }
  }
  return '.' + bytesToB64(b);
}
function decodeV2(s) {
  try {
    const b = b64ToBytes(s), l = new Uint8Array(W * H);
    let p = 0, i = 0;
    while (p < b.length) {
      let t = b[p] >> 4, n = b[p] & 15; p++;
      if (n === 0) return null;
      if (n === 15) {
        let r = 0, shift = 0, c;
        do {
          if (p >= b.length || shift > 21) return null;
          c = b[p++]; r |= (c & 127) << shift; shift += 7;
        } while (c & 128);
        n = 15 + r;
      }
      if (t > VPLAT || t === USED) t = 0;
      if (i + n > l.length) return null;
      l.fill(t, i, i + n); i += n;
    }
    return i === l.length ? l : null;
  } catch (e) { return null; }
}
const sameLevel = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
function decode(s) {
  if (!s) return null;
  return s[0] === '.' ? decodeV2(s.slice(1)) : decodeV1(s);
}
// every link is checked by decoding it back; if that ever disagrees we fall back to the old format
function encode(l) {
  try {
    const s = encodeV2(l);
    if (sameLevel(decode(s), l)) return s;
  } catch (e) {}
  return encodeV1(l);
}

// ---------- sample levels ----------
function starter() {
  const l = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) { l[15 * W + x] = GROUND; l[16 * W + x] = GROUND; }
  l[14 * W + 2] = START; l[14 * W + 76] = GOAL;
  return l;
}
function demo() {
  const l = starter();
  const set = (x, y, t) => { l[y * W + x] = t; };
  const row = (x0, x1, y, t) => { for (let x = x0; x <= x1; x++) set(x, y, t); };
  const hole = (x0, x1) => { for (let x = x0; x <= x1; x++) { set(x, 15, EMPTY); set(x, 16, EMPTY); } };
  hole(18, 20); hole(40, 43); hole(58, 62);
  row(10, 14, 11, BRICK); set(12, 11, QBLOCK); row(10, 14, 8, COIN);
  row(17, 21, 12, COIN); set(19, 11, COIN);
  set(26, 14, ENEMY); set(33, 14, ENEMY);
  set(36, 14, SPIKE); set(37, 14, SPIKE);
  set(41, 12, HPLAT); row(41, 43, 10, COIN);
  set(46, 14, SPRING); row(48, 52, 7, GROUND); row(48, 52, 6, COIN);
  set(50, 14, ENEMY); set(55, 14, ENEMY);
  set(59, 12, VPLAT);
  for (let s = 0; s < 5; s++) for (let h = 0; h <= s; h++) set(66 + s, 14 - h, GROUND);
  row(68, 71, 9, COIN);
  return l;
}

// ---------- state ----------
let level = null, cleared = null, startInPlay = false;
{
  const h = location.hash.slice(1);
  if (h) level = decode(h);
  try {
    if (!level) { const s = localStorage.getItem(STORE); if (s) level = decode(s); }
    cleared = localStorage.getItem(CLEARED);
  } catch (e) {}
  if (!level) level = demo();
  if (/[?&]play\b/.test(location.search)) { startInPlay = true; cleared = encodeV1(level); }
}
let mode = 'edit', sel = GROUND, camX = 0, hover = null, painting = null, lastPaint = null, dirty = false;
let world, player, enemies = [], plats = [], bumps = [], springs = {}, particles = [];
let coins = 0, totalCoins = 0, frames = 0, deaths = 0, state = 'run', deadT = 0, shake = 0, goal = null, tick = 0;
let jumpPressed = false, muted = false;
const keys = {};

const isCleared = () => cleared === encodeV1(level);
const hasType = t => level.indexOf(t) !== -1;
function save() {
  const enc = encode(level);
  try { localStorage.setItem(STORE, enc); } catch (e) {}
  history.replaceState(null, '', location.pathname + '#' + enc);
  dirty = false;
  updateShare();
}
function updateShare() {
  const ok = isCleared();
  btnShare.textContent = ok ? 'Share' : 'Share (beat it first)';
  btnShare.classList.toggle('locked', !ok);
}

// ---------- audio (all synthesized, no files) ----------
let AC = null, master = null;
function ac() {
  if (!AC) {
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.gain.value = muted ? 0 : 1; master.connect(AC.destination);
    } catch (e) { return null; }
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function note(f, d, type, v, when, slide) {
  const a = ac(); if (!a) return;
  const t = when == null ? a.currentTime : when;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.02);
}
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const sfx = {
  jump: () => note(260, .16, 'square', .05, null, 640),
  coin: () => { note(988, .07, 'square', .05); note(1319, .2, 'square', .05, AC && AC.currentTime + .07); },
  stomp: () => note(240, .16, 'square', .08, null, 50),
  die: () => note(500, .6, 'sawtooth', .07, null, 50),
  bump: () => note(140, .09, 'triangle', .12),
  brk: () => note(200, .22, 'sawtooth', .07, null, 40),
  spring: () => note(180, .3, 'square', .06, null, 1000),
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => note(f, .22, 'square', .06, AC && AC.currentTime + i * .1)),
};
// chiptune loop: melody (square) + bass (triangle), 32 eighth-notes
const MEL = [72,null,76,null,79,76,72,null, 74,null,77,null,81,77,74,null,
             71,null,74,null,79,74,71,null, 72,76,79,84,79,76,72,null];
const BASS = [48, 53, 55, 48];
const SPS = 60 / 150 / 2;
let musicOn = false, mTimer = null, mNext = 0, mStep = 0;
function schedule() {
  while (mNext < AC.currentTime + 0.2) {
    const m = MEL[mStep];
    if (m != null) note(mtof(m), SPS * 0.9, 'square', 0.028, mNext);
    if (mStep % 2 === 0) {
      const root = BASS[Math.floor(mStep / 8)];
      note(mtof(mStep % 4 === 0 ? root : root + 12), SPS * 1.7, 'triangle', 0.07, mNext);
    }
    mNext += SPS; mStep = (mStep + 1) % 32;
  }
}
function startMusic() {
  const a = ac(); if (!a || musicOn) return;
  musicOn = true; mStep = 0; mNext = a.currentTime + 0.05;
  mTimer = setInterval(schedule, 40);
}
function stopMusic() { musicOn = false; clearInterval(mTimer); }
function setMuted(m) {
  muted = m; btnMute.textContent = m ? 'Sound: off' : 'Sound: on';
  if (master) master.gain.value = m ? 0 : 1;
}

// ---------- UI helpers ----------
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}
function showOverlay(html) { overlay.innerHTML = '<div class="card">' + html + '</div>'; overlay.hidden = false; }
function hideOverlay() { overlay.hidden = true; }
// phones and tablets: on-screen buttons while playing (add ?touch to the URL to try them on a desktop)
const isTouch = matchMedia('(pointer: coarse)').matches || /[?&]touch\b/.test(location.search);
if (isTouch) document.body.classList.add('touch-device');
function syncTouch() {
  document.body.classList.toggle('playing', mode === 'play');
  $('touch').hidden = !(isTouch && mode === 'play');
  $('btnFs').hidden = mode !== 'play';
}
function setHint() {
  hint.textContent = mode === 'edit'
    ? (isTouch ? 'Tap or drag to paint · scroll the level with the slider · tap Play to try it'
               : 'Click or drag to paint · right-click erases · scroll the level with A/D, the mouse wheel or the slider · Tab to play')
    : (isTouch ? 'Use the buttons on the screen · Full screen gives you the most room'
               : 'F full screen · Tab or Esc goes back to the editor · M toggles sound');
}

// palette icons are drawn with the game's own art, so the toolbar matches the level
function makeIcon(t, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size * 2; c.style.width = c.style.height = size + 'px';
  const saved = ctx; ctx = c.getContext('2d');
  ctx.scale(size * 2 / 32, size * 2 / 32);
  ctx.textAlign = 'center';
  if (t === PLAYER_ICON) drawPlayerAt(4, 4, 1, 1, false, 0);
  else if (t === ENEMY) drawEnemy(3, 6, 26, 26, 1, 0, false);
  else if (t === HPLAT || t === VPLAT) {
    ctx.save(); ctx.scale(0.5, 0.5); drawPlat(0, 24); ctx.restore();
    ctx.fillStyle = '#1d1b4b'; ctx.beginPath();
    if (t === HPLAT) { ctx.moveTo(2, 7); ctx.lineTo(9, 3); ctx.lineTo(9, 11); ctx.moveTo(30, 7); ctx.lineTo(23, 3); ctx.lineTo(23, 11); }
    else { ctx.moveTo(16, 1); ctx.lineTo(11, 8); ctx.lineTo(21, 8); ctx.moveTo(16, 21); ctx.lineTo(11, 14); ctx.lineTo(21, 14); }
    ctx.fill();
  } else if (t === GOAL) {
    ctx.fillStyle = '#e8e8f0'; ctx.fillRect(9, 5, 3, 25);
    ctx.strokeStyle = '#1d1b4b'; ctx.lineWidth = 1.5; ctx.strokeRect(9, 5, 3, 25);
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(10.5, 4, 3.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#2ecc71'; ctx.beginPath(); ctx.moveTo(12, 7); ctx.lineTo(28, 13); ctx.lineTo(12, 20); ctx.closePath(); ctx.fill();
    ctx.stroke();
  }
  else if (t === EMPTY) {
    ctx.save(); ctx.translate(16, 16); ctx.rotate(-0.6);
    ctx.fillStyle = '#ff8fa3'; ctx.fillRect(-11, -6, 14, 12);
    ctx.fillStyle = '#fffaf0'; ctx.fillRect(3, -6, 9, 12);
    ctx.strokeStyle = '#1d1b4b'; ctx.lineWidth = 2; ctx.strokeRect(-11, -6, 23, 12);
    ctx.restore();
  } else drawTile(t, 0, 0, false, 0, 0, 0);
  ctx = saved;
  return c;
}
const PLAYER_ICON = START;
const palButtons = [];
{
  const box = $('palette');
  const groups = [];
  PALETTE.forEach(p => {
    let g = groups.find(x => x.name === p.group);
    if (!g) { g = { name: p.group, items: [] }; groups.push(g); }
    g.items.push(p);
  });
  groups.forEach(g => {
    const sec = document.createElement('div'); sec.className = 'group';
    sec.innerHTML = '<h3></h3><div class="grid"></div>';
    sec.querySelector('h3').textContent = g.name;
    g.items.forEach(p => {
      const b = document.createElement('button'); b.className = 'tile'; b.type = 'button';
      b.title = p.name + ' (' + p.key + ') — ' + p.desc;
      b.appendChild(makeIcon(p.t, 34));
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name;
      const ky = document.createElement('span'); ky.className = 'ky'; ky.textContent = p.key;
      b.append(nm, ky);
      b.onclick = () => selectTile(p.t);
      sec.querySelector('.grid').appendChild(b); palButtons[PALETTE.indexOf(p)] = b;
    });
    box.appendChild(sec);
  });
}
function selectTile(t) {
  sel = t;
  PALETTE.forEach((p, i) => palButtons[i].classList.toggle('sel', p.t === t));
  const p = PALETTE.find(q => q.t === t), info = $('info');
  info.textContent = '';
  const body = document.createElement('div');
  const h = document.createElement('h4'); h.textContent = p.name;
  const d = document.createElement('p'); d.textContent = p.desc;
  const k = document.createElement('small'); k.textContent = isTouch ? '' : 'Shortcut: ' + p.key;
  body.append(h, d, k);
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'x'; x.innerHTML = '&times;'; x.setAttribute('aria-label', 'Hide this description');
  x.onclick = () => closeBox('info');
  info.append(makeIcon(t, 56), body, x);
}

// explanation boxes can be closed (big × on touch screens) and brought back with the Help button
const HIDDEN = 'lbl-hidden';
const boxIds = { steps: 'steps', rotate: 'rotate', help: 'helpBox', info: 'info' };
let closedBoxes = {};
try {
  closedBoxes = JSON.parse(localStorage.getItem(HIDDEN) || '{}') || {};
  if (localStorage.getItem(STEPS)) closedBoxes.steps = 1;
} catch (e) { closedBoxes = {}; }
function applyClosed() {
  for (const k in boxIds) $(boxIds[k]).classList.toggle('closed', !!closedBoxes[k]);
}
function closeBox(k) {
  closedBoxes[k] = 1;
  try { localStorage.setItem(HIDDEN, JSON.stringify(closedBoxes)); } catch (e) {}
  applyClosed();
}
document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => closeBox(b.dataset.close); });
$('btnHelp').onclick = () => {
  closedBoxes = {};
  try { localStorage.removeItem(HIDDEN); localStorage.removeItem(STEPS); } catch (e) {}
  applyClosed(); toast('Tips are back');
};
applyClosed();
$('keysList').hidden = isTouch; $('touchList').hidden = !isTouch;

// full screen: the real Fullscreen API where the browser has it, otherwise the page fills the viewport
const btnFs = $('btnFs');
const nativeFsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
function setFs(on) {
  if (on === document.body.classList.contains('fs')) return;
  document.body.classList.toggle('fs', on);
  btnFs.textContent = on ? 'Exit full screen' : 'Full screen';
  const root = document.documentElement;
  const quiet = p => { if (p && p.catch) p.catch(() => {}); };
  try {
    if (on) {
      const req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (req) quiet(req.call(root));
      if (screen.orientation && screen.orientation.lock) quiet(screen.orientation.lock('landscape'));
    } else {
      if (nativeFsElement()) {
        const ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (ex) quiet(ex.call(document));
      }
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    }
  } catch (e) {}
}
// the browser's own Esc / swipe-down exit should leave our full-screen layout too
['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => {
  if (!nativeFsElement() && document.body.classList.contains('fs')) setFs(false);
}));
btnFs.onclick = () => setFs(!document.body.classList.contains('fs'));

// ---------- mode switching ----------
function enterPlay() {
  if (!hasType(GOAL)) { toast('Place a goal flag first'); return; }
  mode = 'play'; deaths = 0; hideOverlay(); painting = null;
  startPlay(); startMusic(); setHint(); refreshPlayPane();
  btnPlay.innerHTML = 'Edit <kbd>Tab</kbd>'; slider.style.visibility = 'hidden';
  $('paneBuild').hidden = true; $('panePlay').hidden = false; $('steps').style.display = 'none';
  syncTouch();
}
function enterEdit() {
  setFs(false);
  mode = 'edit'; stopMusic(); hideOverlay(); setHint();
  history.replaceState(null, '', location.pathname + '#' + encode(level));
  btnPlay.innerHTML = 'Play <kbd>Tab</kbd>'; slider.style.visibility = 'visible';
  slider.value = camX = Math.max(0, Math.min(camX, W * T - VW));
  $('paneBuild').hidden = false; $('panePlay').hidden = true; $('steps').style.display = '';
  for (const k in keys) keys[k] = false;
  syncTouch();
}

// ---------- gameplay ----------
function startPlay() {
  world = level.slice(); enemies = []; plats = []; bumps = []; springs = {}; particles = [];
  coins = 0; totalCoins = 0; frames = 0; state = 'run'; jumpPressed = false; goal = null;
  let sx = 2, sy = H - 3;
  for (let i = 0; i < world.length; i++) {
    const t = world[i], x = i % W, y = (i / W) | 0;
    if (t === START) { sx = x; sy = y; world[i] = 0; }
    else if (t === GOAL) goal = { x, y };
    else if (t === ENEMY) { enemies.push({ x: x * T + 3, y: y * T + T - 26, w: 26, h: 26, vx: -0.9, vy: 0, onGround: false, dead: 0, killed: false }); world[i] = 0; }
    else if (t === HPLAT || t === VPLAT) { plats.push({ x: x * T, y: y * T, ox: x * T, oy: y * T, w: 64, h: 12, v: t === VPLAT, ph: 0 }); world[i] = 0; }
    else if (t === COIN || t === QBLOCK) totalCoins++;
  }
  player = { x: sx * T + 4, y: (sy + 1) * T - 28, w: 24, h: 28, vx: 0, vy: 0, onGround: false, face: 1, coyote: 0, buf: 0, sq: 1, riding: null };
  camX = Math.max(0, Math.min(W * T - VW, player.x - VW / 2));
}
const solidAt = (tx, ty) => {
  if (tx < 0 || tx >= W) return true;
  if (ty < 0 || ty >= H) return false;
  const t = world[ty * W + tx];
  return t === GROUND || t === BRICK || t === QBLOCK || t === USED;
};
function moveBody(b) {
  const r = { x: false, landed: false, bump: null };
  b.x += b.vx;
  let x0 = Math.floor(b.x / T), x1 = Math.floor((b.x + b.w - 0.01) / T);
  let y0 = Math.floor(b.y / T), y1 = Math.floor((b.y + b.h - 0.01) / T);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) {
    if (b.vx > 0) b.x = tx * T - b.w; else if (b.vx < 0) b.x = (tx + 1) * T;
    r.x = true;
  }
  b.y += b.vy; b.onGround = false;
  x0 = Math.floor(b.x / T); x1 = Math.floor((b.x + b.w - 0.01) / T);
  y0 = Math.floor(b.y / T); y1 = Math.floor((b.y + b.h - 0.01) / T);
  let bd = 1e9, hit = false;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) {
    hit = true;
    if (b.vy > 0) { b.y = ty * T - b.h; b.onGround = true; r.landed = true; }
    else if (b.vy < 0) {
      b.y = (ty + 1) * T;
      const d = Math.abs(tx * T + T / 2 - (b.x + b.w / 2));
      if (d < bd) { bd = d; r.bump = [tx, ty]; }
    }
  }
  if (hit) b.vy = 0;
  return r;
}
function burst(x, y, n, colors, sp, grav) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, s = (0.3 + Math.random()) * sp;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - sp * 0.4, life: 30 + Math.random() * 20, max: 50, c: colors[i % colors.length], s: 2 + Math.random() * 4, g: grav == null ? 0.3 : grav });
  }
}
function bumpBlock(tx, ty) {
  const i = ty * W + tx, t = world[i];
  bumps.push({ tx, ty, t: 0 });
  if (t === QBLOCK) {
    world[i] = USED; coins++; sfx.coin(); burst(tx * T + 16, ty * T, 8, ['#ffd23f', '#fff3a0'], 3);
    particles.push({ x: tx * T + 16, y: ty * T - 6, vx: 0, vy: -3, life: 28, max: 28, c: '#ffd23f', s: 7, g: 0.2 });
  } else if (t === BRICK) {
    world[i] = EMPTY; sfx.brk(); shake = 4;
    burst(tx * T + 16, ty * T + 16, 14, ['#c8642b', '#7a3412', '#e08a4f'], 5, 0.5);
  } else sfx.bump();
}
function die() {
  if (state !== 'run') return;
  state = 'dead'; deadT = 80; deaths++; player.vy = -9; player.vx = 0; shake = 10;
  burst(player.x + 12, player.y + 14, 20, ['#e53935', '#ffcc80', '#1e63d6'], 5);
  stopMusic(); sfx.die();
}
// ---------- leaderboard: top 5 per level on this device + a record carried inside the share link ----------
const NAME_KEY = 'lbl-name', SCORES = 'lbl-scores-';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanName = s => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 12);
const fmtTime = cs => (cs / 100).toFixed(2) + 's';
function levelId() {
  const s = encodeV1(level); let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
// a record that arrived in the URL only counts while the level is unchanged
let linkRecord = null;
{
  const q = new URLSearchParams(location.search), n = cleanName(q.get('rn')), t = Math.round(+q.get('rt'));
  if (n && t > 0 && t < 6000000) linkRecord = { name: n, time: t, id: encodeV1(level) };
}
function getBoard() {
  try { const b = JSON.parse(localStorage.getItem(SCORES + levelId()) || '[]'); return Array.isArray(b) ? b : []; } catch (e) { return []; }
}
function addScore(entry) {
  const b = getBoard(); b.push(entry);
  b.sort((x, y) => x.t - y.t || y.c - x.c);
  const top = b.slice(0, 5);
  try { localStorage.setItem(SCORES + levelId(), JSON.stringify(top)); } catch (e) {}
  return top.findIndex(e => e === entry);
}
function bestRecord() {
  const own = getBoard()[0];
  const lr = linkRecord && linkRecord.id === encodeV1(level) ? linkRecord : null;
  if (own && (!lr || own.t < lr.time)) return { name: own.n, time: own.t };
  return lr ? { name: lr.name, time: lr.time } : null;
}
function boardHTML(hl) {
  const b = getBoard();
  if (!b.length) return '<p class="empty">No times saved yet. Be the first!</p>';
  return '<ol class="board">' + b.map((e, i) =>
    '<li' + (i === hl ? ' class="me"' : '') + '><span class="rk">' + (i + 1) + '</span><span class="nm">' + esc(e.n) +
    '</span><span class="tm">' + fmtTime(e.t) + '</span><span class="cn">' + e.c + ' coins</span></li>').join('') + '</ol>';
}
function refreshPlayPane() {
  const r = bestRecord();
  $('recordBox').innerHTML = r
    ? '<p class="recline"><b>' + esc(r.name) + '</b> &middot; ' + fmtTime(r.time) + '</p>'
    : '<p class="empty">No record yet. Set the first one!</p>';
  $('boardBox').innerHTML = boardHTML(-1);
}

let lastRun = null;
function win() {
  state = 'won'; shake = 0; stopMusic(); sfx.win();
  cleared = encodeV1(level);
  try { localStorage.setItem(CLEARED, cleared); } catch (e) {}
  updateShare();
  lastRun = { t: Math.round(frames * 100 / 60), c: coins, tc: totalCoins, d: deaths, saved: false, idx: -1, rec: bestRecord() };
  showWin();
}
function showWin() {
  const r = lastRun;
  const beat = !r.rec || r.t < r.rec.time;
  let html = '<h2>Level cleared!</h2><p class="stats">Time <b>' + fmtTime(r.t) + '</b> &middot; Coins ' + r.c + '/' + r.tc + ' &middot; Deaths ' + r.d + '</p>';
  if (!r.rec) html += '<p class="rec good">First record on this level!</p>';
  else if (beat) html += '<p class="rec good">New record! You beat ' + esc(r.rec.name) + ' (' + fmtTime(r.rec.time) + ')</p>';
  else html += '<p class="rec">Record to beat: <b>' + esc(r.rec.name) + '</b> &middot; ' + fmtTime(r.rec.time) + '</p>';
  if (!r.saved) {
    let nm = ''; try { nm = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}
    html += '<form id="oForm" class="nameform"><label for="oName">Your name</label><div class="row">' +
      '<input id="oName" maxlength="12" autocomplete="off" placeholder="Name" value="' + esc(nm) + '">' +
      '<button class="btn go" type="submit">Save time</button></div></form>';
  } else html += boardHTML(r.idx);
  html += '<div class="row"><button id="oReplay" class="btn">Replay</button><button id="oEdit" class="btn">Edit level</button>' +
    '<button id="oShare" class="btn sun">Get share link</button></div>';
  showOverlay(html);
  $('oReplay').onclick = () => { hideOverlay(); deaths = 0; startPlay(); startMusic(); };
  $('oEdit').onclick = enterEdit;
  $('oShare').onclick = share;
  const form = $('oForm');
  if (form) {
    const inp = $('oName'); inp.focus(); inp.select();
    form.onsubmit = e => {
      e.preventDefault();
      const n = cleanName(inp.value) || 'Player';
      try { localStorage.setItem(NAME_KEY, n); } catch (err) {}
      r.idx = addScore({ n, t: r.t, c: r.c, d: r.d }); r.saved = true;
      refreshPlayPane(); showWin();
    };
  }
}

function update() {
  tick++;
  if (mode !== 'play') {
    // edit: keyboard scroll + edge scroll while painting
    let d = 0;
    if (keys.ArrowLeft || keys.KeyA) d -= 12;
    if (keys.ArrowRight || keys.KeyD) d += 12;
    if (painting && hover) { if (hover.mx < 40) d -= 8; else if (hover.mx > VW - 40) d += 8; }
    if (d) {
      camX = Math.max(0, Math.min(W * T - VW, camX + d)); slider.value = camX;
      if (painting && hover) paintLine(Math.floor((hover.mx + camX) / T), hover.ty);
    }
    return;
  }
  const p = player;
  for (const b of bumps) b.t++;
  bumps = bumps.filter(b => b.t < 10);
  for (const k in springs) if (--springs[k] <= 0) delete springs[k];
  particles.forEach(q => { q.x += q.vx; q.y += q.vy; q.vy += q.g; q.life--; });
  particles = particles.filter(q => q.life > 0);
  shake *= 0.85;
  if (state === 'won') return;
  if (state === 'dead') {
    p.vy += 0.5; p.y += p.vy;
    if (--deadT <= 0) { startPlay(); startMusic(); }
    return;
  }
  frames++;

  // moving platforms
  const deltas = new Map();
  for (const pl of plats) {
    pl.ph += 0.022;
    const nx = pl.v ? pl.ox : pl.ox + Math.sin(pl.ph) * 96;
    const ny = pl.v ? pl.oy + Math.sin(pl.ph) * 96 : pl.oy;
    deltas.set(pl, [nx - pl.x, ny - pl.y]); pl.x = nx; pl.y = ny;
  }
  if (p.riding) { const d = deltas.get(p.riding); p.x += d[0]; p.y += d[1]; }
  p.riding = null;

  // input
  const L = keys.ArrowLeft || keys.KeyA, R = keys.ArrowRight || keys.KeyD;
  const jumpHeld = keys.Space || keys.ArrowUp || keys.KeyW;
  const acc = p.onGround ? 0.7 : 0.45, max = 3.6;
  if (L && !R) { p.vx -= acc; p.face = -1; }
  else if (R && !L) { p.vx += acc; p.face = 1; }
  else { p.vx *= p.onGround ? 0.78 : 0.94; if (Math.abs(p.vx) < 0.1) p.vx = 0; }
  p.vx = Math.max(-max, Math.min(max, p.vx));
  p.buf = jumpPressed ? 7 : p.buf - 1; jumpPressed = false;
  p.coyote = p.onGround ? 6 : p.coyote - 1;
  if (p.buf > 0 && p.coyote > 0) {
    p.vy = -10.5; p.coyote = 0; p.buf = 0; p.sq = 1.3; sfx.jump();
    burst(p.x + 12, p.y + p.h, 4, ['#fff'], 1.5, 0.05);
  }
  p.vy += 0.5;
  if (!jumpHeld && p.vy < -3.5) p.vy += 0.9;
  if (p.vy > 12) p.vy = 12;

  const wasGround = p.onGround, prevBottom = p.y + p.h;
  const r = moveBody(p);
  if (r.x) p.vx = 0;
  if (r.bump) bumpBlock(r.bump[0], r.bump[1]);

  // land on moving platforms (one-way, from above)
  if (!p.onGround) for (const pl of plats) {
    const d = deltas.get(pl);
    if (p.x + p.w > pl.x + 2 && p.x < pl.x + pl.w - 2 && p.vy >= 0 &&
        prevBottom <= pl.y + 8 + Math.abs(d[1]) && p.y + p.h >= pl.y) {
      p.y = pl.y - p.h; p.vy = 0; p.onGround = true; p.riding = pl; break;
    }
  }
  if (p.onGround && !wasGround) { p.sq = 0.7; burst(p.x + 12, p.y + p.h, 3, ['#fff'], 1.2, 0.05); }
  p.sq += (1 - p.sq) * 0.2;

  // tiles under/around player
  const x0 = Math.floor(p.x / T), x1 = Math.floor((p.x + p.w - 0.01) / T);
  const y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + p.h - 0.01) / T);
  for (let ty = Math.max(0, y0); ty <= Math.min(H - 1, y1 + 1); ty++) for (let tx = Math.max(0, x0); tx <= Math.min(W - 1, x1); tx++) {
    const i = ty * W + tx, t = world[i], bx = tx * T, by = ty * T;
    if (t === COIN && ty <= y1 && p.x < bx + T && p.x + p.w > bx && p.y < by + T && p.y + p.h > by) {
      world[i] = EMPTY; coins++; sfx.coin(); burst(bx + 16, by + 16, 8, ['#ffd23f', '#fff3a0'], 3);
    } else if (t === SPIKE && p.x + p.w > bx + 5 && p.x < bx + 27 && p.y + p.h > by + 16 && p.y < by + T) {
      die(); return;
    } else if (t === SPRING && p.vy >= 0 && p.x + p.w > bx + 2 && p.x < bx + 30 && p.y + p.h > by + 14 && p.y + p.h < by + T + 8) {
      p.vy = -16.5; p.y = by + 14 - p.h; p.sq = 1.4; springs[i] = 10; sfx.spring();
    }
  }
  if (goal && p.x + p.w > goal.x * T + 8 && p.x < goal.x * T + 24 && p.y + p.h > (goal.y - 3) * T && p.y < (goal.y + 1) * T) { win(); return; }
  if (p.y > H * T + 60) { die(); return; }

  // enemies
  // a stomped enemy is `killed` for good; `dead` only times the squashed sprite before it is removed
  for (const e of enemies) {
    if (e.killed) { e.dead--; continue; }
    e.vy += 0.5; if (e.vy > 10) e.vy = 10;
    const wasG = e.onGround;
    const er = moveBody(e);
    if (er.x) e.vx = -e.vx;
    else if (wasG && e.onGround && !solidAt(Math.floor((e.x + (e.vx > 0 ? e.w + 2 : -2)) / T), Math.floor((e.y + e.h + 4) / T))) e.vx = -e.vx;
    if (e.y > H * T + 100) { e.killed = true; e.dead = 0; continue; }
    if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
      if (p.vy > 0 && p.y + p.h - e.y < 18) {
        e.killed = true; e.dead = 25;
        p.vy = keys.Space || keys.ArrowUp || keys.KeyW ? -11 : -8; sfx.stomp(); shake = 4;
        burst(e.x + 13, e.y + 20, 10, ['#b5472a', '#ffcc80'], 3);
      } else { die(); return; }
    }
  }
  enemies = enemies.filter(e => !(e.killed && e.dead <= 0));

  // camera
  const tx = p.x + p.w / 2 - VW / 2 + p.face * 50;
  camX += (tx - camX) * 0.12;
  camX = Math.max(0, Math.min(W * T - VW, camX));
}

// ---------- drawing ----------
const solidKind = t => t === GROUND || t === BRICK || t === QBLOCK || t === USED;
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); }
function drawBG(cx) {
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, '#4aa3ff'); g.addColorStop(1, '#cdeeff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = 'rgba(255,255,255,.88)';
  for (let i = 0; i < 16; i++) {
    const x = i * 230 + ((i * 97) % 110) - cx * 0.3, y = 30 + ((i * 53) % 150), s = 0.8 + ((i * 31) % 5) / 10;
    circle(x, y, 18 * s); circle(x + 22 * s, y - 8 * s, 22 * s); circle(x + 48 * s, y, 18 * s); circle(x + 24 * s, y + 6 * s, 16 * s);
  }
  ctx.fillStyle = '#7bd36f';
  ctx.beginPath(); ctx.moveTo(0, VH);
  for (let x = 0; x <= VW; x += 16) ctx.lineTo(x, VH - 100 - Math.sin((x + cx * 0.5) / 110) * 30 - Math.sin((x + cx * 0.5) / 47) * 8);
  ctx.lineTo(VW, VH); ctx.fill();
}
function bumpOff(tx, ty) {
  for (const b of bumps) if (b.tx === tx && b.ty === ty) return -Math.sin(b.t / 10 * Math.PI) * 8;
  return 0;
}
function drawPlat(x, y) {
  ctx.fillStyle = '#5b6786'; ctx.fillRect(x, y + 3, 64, 9);
  ctx.fillStyle = '#9fb0d6'; ctx.fillRect(x, y, 64, 5);
  ctx.fillStyle = '#34405e'; circle(x + 8, y + 8, 2); circle(x + 56, y + 8, 2);
}
function drawEnemy(x, y, w, h, dir, tm, squash) {
  ctx.save(); ctx.translate(x + w / 2, y + h);
  if (squash) { ctx.scale(1.2, 0.35); }
  ctx.fillStyle = '#b5472a';
  ctx.beginPath(); ctx.moveTo(-13, 0); ctx.quadraticCurveTo(-15, -26, 0, -26); ctx.quadraticCurveTo(15, -26, 13, 0); ctx.fill();
  ctx.fillStyle = '#4a2314';
  const f = Math.sin(tm / 5) > 0 ? 3 : 0;
  ctx.fillRect(-12, -4, 9, 4 + f * 0); ctx.fillRect(3, -4, 9, 4);
  ctx.fillStyle = '#fff'; circle(-5, -14, 5); circle(5, -14, 5);
  ctx.fillStyle = '#111'; circle(-5 + dir * 1.5, -14, 2.2); circle(5 + dir * 1.5, -14, 2.2);
  ctx.strokeStyle = '#2a0f06'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-10, -21); ctx.lineTo(-2, -18); ctx.moveTo(10, -21); ctx.lineTo(2, -18); ctx.stroke();
  ctx.restore();
}
function drawPlayerAt(x, y, face, sq, run, tm, alpha) {
  ctx.save(); ctx.globalAlpha = alpha == null ? 1 : alpha;
  ctx.translate(x + 12, y + 28); ctx.scale(face * (1 + (1 - sq) * 0.6), sq);
  const step = run ? Math.sin(tm / 2.5) * 3 : 0;
  ctx.fillStyle = '#5a3b1e'; ctx.fillRect(-10 + step, -4, 9, 4); ctx.fillRect(1 - step, -4, 9, 4);
  ctx.fillStyle = '#1e63d6'; ctx.fillRect(-9, -15, 18, 12);
  ctx.fillStyle = '#e53935'; ctx.fillRect(-11, -24, 22, 11);
  ctx.fillStyle = '#ffcc99'; circle(0, -27, 9);
  ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.arc(0, -29, 9.5, Math.PI, 0); ctx.fill(); ctx.fillRect(1, -31, 12, 4);
  ctx.fillStyle = '#111'; ctx.fillRect(4, -29, 3, 5);
  ctx.restore();
}
function drawGoal(x, y, tm) {
  ctx.fillStyle = '#e8e8f0'; ctx.fillRect(x + 14, y - 3 * T, 5, 4 * T);
  ctx.fillStyle = '#ffd23f'; circle(x + 16.5, y - 3 * T, 6);
  const w = Math.sin(tm / 8) * 3;
  ctx.fillStyle = '#2ecc71';
  ctx.beginPath(); ctx.moveTo(x + 19, y - 3 * T + 6); ctx.lineTo(x + 19 + 24 + w, y - 3 * T + 16); ctx.lineTo(x + 19, y - 3 * T + 28); ctx.fill();
}
function drawTile(t, x, y, above, tm, tx, ty) {
  switch (t) {
    case GROUND:
      ctx.fillStyle = '#9a6a3a'; ctx.fillRect(x, y, T, T);
      ctx.fillStyle = '#7d5229'; ctx.fillRect(x + 6, y + 14, 5, 5); ctx.fillRect(x + 20, y + 22, 6, 4);
      if (!above) { ctx.fillStyle = '#4caf50'; ctx.fillRect(x, y, T, 9); ctx.fillStyle = '#7ddc6f'; ctx.fillRect(x, y, T, 4); }
      break;
    case BRICK:
      ctx.fillStyle = '#c8642b'; ctx.fillRect(x, y, T, T);
      ctx.fillStyle = '#7a3412';
      ctx.fillRect(x, y + 10, T, 2); ctx.fillRect(x, y + 21, T, 2); ctx.fillRect(x + 15, y, 2, 10); ctx.fillRect(x + 7, y + 12, 2, 9); ctx.fillRect(x + 23, y + 12, 2, 9); ctx.fillRect(x + 15, y + 23, 2, 9);
      ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(x, y, T, 2);
      break;
    case QBLOCK:
      ctx.fillStyle = '#a56a00'; ctx.fillRect(x, y, T, T);
      ctx.fillStyle = '#f5b82e'; ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.15 + 0.15 * Math.sin(tm / 10)) + ')'; ctx.fillRect(x + 2, y + 2, T - 4, 8);
      ctx.fillStyle = '#fff'; ctx.font = '700 22px "Fredoka",system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', x + 16, y + 24);
      break;
    case USED:
      ctx.fillStyle = '#5c4630'; ctx.fillRect(x, y, T, T); ctx.fillStyle = '#8a6a4a'; ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
      break;
    case COIN: {
      const w = Math.abs(Math.cos(tm / 14 + tx)) * 8 + 2;
      ctx.fillStyle = '#e0a800'; ctx.beginPath(); ctx.ellipse(x + 16, y + 16, w + 1.5, 11, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.ellipse(x + 16, y + 16, w, 9.5, 0, 0, 6.283); ctx.fill();
      break;
    }
    case SPIKE:
      ctx.fillStyle = '#cfd8dc'; ctx.strokeStyle = '#37474f'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * 16 + 1, y + T); ctx.lineTo(x + i * 16 + 8, y + 12); ctx.lineTo(x + i * 16 + 15, y + T); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      break;
    case SPRING: {
      const c = springs[ty * W + tx] ? 0.5 : 1;
      ctx.strokeStyle = '#9aa5b1'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + 8, y + 31);
      for (let i = 0; i < 4; i++) { ctx.lineTo(x + 24, y + 31 - (i + 0.5) * 4 * c); ctx.lineTo(x + 8, y + 31 - (i + 1) * 4 * c); }
      ctx.stroke();
      ctx.fillStyle = '#e53935'; ctx.fillRect(x + 3, y + 31 - 17 * c, 26, 5);
      break;
    }
    case GOAL: drawGoal(x, y, tm); break;
  }
}
function drawLevel(arr, edit, tm) {
  const c0 = Math.max(0, Math.floor(camX / T)), c1 = Math.min(W - 1, c0 + VW / T + 1);
  ctx.textAlign = 'center';
  for (let ty = 0; ty < H; ty++) for (let tx = c0; tx <= c1; tx++) {
    const t = arr[ty * W + tx]; if (!t) continue;
    const x = tx * T - camX, y = ty * T + (edit ? 0 : bumpOff(tx, ty));
    if (edit && (t === START || t === ENEMY || t === HPLAT || t === VPLAT)) {
      if (t === START) drawPlayerAt(x + 4, y + 4, 1, 1, false, tm);
      else if (t === ENEMY) drawEnemy(x + 3, y + 6, 26, 26, 1, tm, false);
      else {
        ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 2;
        ctx.beginPath();
        if (t === HPLAT) { ctx.moveTo(x - 96, y + 6); ctx.lineTo(x + 160, y + 6); } else { ctx.moveTo(x + 32, y - 96); ctx.lineTo(x + 32, y + 108); }
        ctx.stroke(); ctx.setLineDash([]);
        drawPlat(x, y);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui'; ctx.fillText(t === HPLAT ? '↔' : '↕', x + 32, y + 10);
      }
      continue;
    }
    const above = ty > 0 && solidKind(arr[(ty - 1) * W + tx]);
    drawTile(t, x, y, above, tm, tx, ty);
  }
}
const FONT = '"Fredoka","Arial Rounded MT Bold",system-ui,sans-serif';
function text(s, x, y, align) {
  ctx.textAlign = align || 'left'; ctx.font = '700 22px ' + FONT;
  ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1d1b4b'; ctx.strokeText(s, x, y);
  ctx.fillStyle = '#fff'; ctx.fillText(s, x, y);
}
function pill(label, value, x, y, align) {
  ctx.font = '700 18px ' + FONT; ctx.textAlign = 'left';
  const lw = ctx.measureText(label + ' ').width, vw = ctx.measureText(value).width;
  const w = lw + vw + 24, h = 32;
  const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = 'rgba(255,250,240,.95)'; ctx.strokeStyle = '#1d1b4b'; ctx.lineWidth = 3;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(px, y, w, h, 12); else ctx.rect(px, y, w, h);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ff5d48'; ctx.fillText(label, px + 12, y + 22);
  ctx.fillStyle = '#1d1b4b'; ctx.fillText(value, px + 12 + lw, y + 22);
}
function render() {
  ctx.save();
  if (mode === 'play' && shake > 0.3) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  drawBG(camX);
  if (mode === 'edit') {
    drawLevel(level, true, tick);
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = -(camX % T); x <= VW; x += T) { ctx.moveTo(x, 0); ctx.lineTo(x, VH); }
    for (let y = 0; y <= VH; y += T) { ctx.moveTo(0, y); ctx.lineTo(VW, y); }
    ctx.stroke();
    if (hover && hover.tx >= 0 && hover.tx < W && hover.ty >= 0 && hover.ty < H) {
      const x = hover.tx * T - camX, y = hover.ty * T;
      ctx.globalAlpha = 0.55;
      if (sel === START) drawPlayerAt(x + 4, y + 4, 1, 1, false, tick);
      else if (sel === ENEMY) drawEnemy(x + 3, y + 6, 26, 26, 1, tick, false);
      else if (sel === HPLAT || sel === VPLAT) drawPlat(x, y);
      else if (sel === EMPTY) { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, T, T); }
      else drawTile(sel, x, y, false, tick, hover.tx, hover.ty);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
    }
    if (!hasType(GOAL)) text('Place a goal flag to be able to play', VW / 2, 34, 'center');
  } else {
    drawLevel(world, false, tick);
    for (const pl of plats) drawPlat(pl.x - camX, pl.y);
    for (const e of enemies) if (e.y < H * T + 50) drawEnemy(e.x - camX, e.y, e.w, e.h, e.vx > 0 ? 1 : -1, tick, !!e.killed);
    const p = player;
    if (state === 'dead') ctx.globalAlpha = 0.9;
    drawPlayerAt(p.x - camX, p.y, p.face, p.sq, p.onGround && Math.abs(p.vx) > 0.5, tick);
    ctx.globalAlpha = 1;
    for (const q of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, q.life / 20)); ctx.fillStyle = q.c;
      ctx.fillRect(q.x - camX - q.s / 2, q.y - q.s / 2, q.s, q.s);
    }
    ctx.globalAlpha = 1;
    pill('COINS', coins + '/' + totalCoins, 12, 10, 'left');
    pill('TIME', (frames / 60).toFixed(1) + 's', VW / 2, 10, 'center');
    pill('DEATHS', String(deaths), VW - 12, 10, 'right');
  }
  ctx.restore();
}

// ---------- input ----------
function mouseInfo(e) {
  const r = cv.getBoundingClientRect();
  const mx = (e.clientX - r.left) * VW / r.width, my = (e.clientY - r.top) * VH / r.height;
  return { mx, my, tx: Math.floor((mx + camX) / T), ty: Math.floor(my / T) };
}
function paint(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return;
  const t = painting === 'erase' ? EMPTY : sel;
  if (t === START || t === GOAL) for (let i = 0; i < level.length; i++) if (level[i] === t) level[i] = 0;
  if (level[ty * W + tx] !== t) { level[ty * W + tx] = t; dirty = true; }
}
function paintLine(tx, ty) {
  if (!lastPaint) { paint(tx, ty); lastPaint = [tx, ty]; return; }
  let [x, y] = lastPaint; const n = Math.max(Math.abs(tx - x), Math.abs(ty - y));
  for (let i = 1; i <= n; i++) paint(Math.round(x + (tx - x) * i / n), Math.round(y + (ty - y) * i / n));
  if (!n) paint(tx, ty);
  lastPaint = [tx, ty];
}
cv.addEventListener('pointerdown', e => {
  ac();
  if (mode !== 'edit') return;
  painting = e.button === 2 ? 'erase' : 'paint'; lastPaint = null;
  hover = mouseInfo(e); paintLine(hover.tx, hover.ty);
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  hover = mouseInfo(e);
  if (painting && mode === 'edit') paintLine(hover.tx, hover.ty);
});
const endPaint = () => { painting = null; lastPaint = null; if (dirty) save(); };
cv.addEventListener('pointerup', endPaint);
cv.addEventListener('pointercancel', endPaint);
cv.addEventListener('pointerleave', () => { if (!painting) hover = null; });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => {
  if (mode !== 'edit') return;
  e.preventDefault();
  camX = Math.max(0, Math.min(W * T - VW, camX + (e.deltaX || e.deltaY))); slider.value = camX;
}, { passive: false });
slider.addEventListener('input', () => { camX = +slider.value; });

addEventListener('keydown', e => {
  const c = e.code;
  if (e.target.matches && e.target.matches('input[type=text], input:not([type])')) return; // typing a name / copying the link
  ac();
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Tab'].includes(c)) e.preventDefault();
  keys[c] = true;
  if (c === 'Tab' || c === 'KeyP') { if (!e.repeat) (mode === 'edit' ? enterPlay : enterEdit)(); return; }
  if (c === 'KeyM') { if (!e.repeat) setMuted(!muted); return; }
  if (mode === 'play') {
    if (e.repeat) return;
    if (c === 'Escape') { if (document.body.classList.contains('fs')) setFs(false); else enterEdit(); }
    else if (c === 'KeyF') setFs(!document.body.classList.contains('fs'));
    else if (c === 'KeyR') { hideOverlay(); startPlay(); startMusic(); }
    else if (c === 'Space' || c === 'ArrowUp' || c === 'KeyW') { jumpPressed = true; startMusic(); }
  } else {
    const p = PALETTE.find(q => q.key === e.key.toUpperCase());
    if (p && !e.ctrlKey && !e.metaKey) selectTile(p.t);
  }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// on-screen buttons feed the same `keys` state the keyboard uses
$('touch').querySelectorAll('button').forEach(b => {
  const k = b.dataset.k === 'Jump' ? 'Space' : b.dataset.k;
  const down = e => {
    e.preventDefault(); ac();
    try { b.setPointerCapture(e.pointerId); } catch (err) {}
    b.classList.add('on'); keys[k] = true;
    if (k === 'Space') { jumpPressed = true; startMusic(); }
  };
  const up = () => { b.classList.remove('on'); keys[k] = false; };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
});

// ---------- buttons ----------
document.addEventListener('click', e => { const b = e.target.closest('button'); if (b) b.blur(); });
btnPlay.onclick = () => (mode === 'edit' ? enterPlay : enterEdit)();
btnMute.onclick = () => setMuted(!muted);
$('btnDemo').onclick = () => { if (mode === 'play') enterEdit(); level = demo(); camX = 0; slider.value = 0; save(); toast('Loaded the example level'); };
$('btnClear').onclick = () => {
  if (mode === 'play') enterEdit();
  if (confirm('Start a new empty level? Your current one will be lost unless you copied its link.')) { level = starter(); camX = 0; slider.value = 0; save(); }
};
btnShare.onclick = share;
function share() {
  if (!hasType(GOAL)) { toast('Place a goal flag first'); return; }
  if (!isCleared()) {
    toast('Beat your level first, then you can share it');
    if (mode === 'edit') enterPlay();
    return;
  }
  const url = shareUrl();
  const rec = bestRecord();
  showOverlay('<h2>Share link</h2><p>Anyone who opens this plays your level' +
    (rec ? '.<br>It carries the record to beat: <b>' + esc(rec.name) + '</b> &middot; ' + fmtTime(rec.time) : '') + '</p>' +
    '<input id="oUrl" class="url" readonly value="' + url + '">' +
    '<div class="row"><button id="oCopy" class="btn go">Copy link</button>' +
    '<a id="oOpen" class="btn a" href="' + url + '" target="_blank" rel="noopener">Open</a>' +
    '<button id="oClose" class="btn">Close</button></div>');
  const inp = $('oUrl');
  inp.focus(); inp.select();
  $('oCopy').onclick = () => {
    const ok = () => toast('Link copied! Send it to anyone');
    const manual = () => { inp.focus(); inp.select(); try { document.execCommand('copy') ? ok() : toast('Press Ctrl/Cmd+C to copy'); } catch (e) { toast('Press Ctrl/Cmd+C to copy'); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, manual);
    else manual();
  };
  $('oClose').onclick = () => { if (mode === 'play' && state === 'won') showWin(); else hideOverlay(); };
}
// always the full public address, even when the page is opened from a file or localhost
const PUBLIC_URL = 'https://davfridman.github.io/mario-builder-lite/';
function shareUrl() {
  const live = /^https?:$/.test(location.protocol) && !/^(localhost|127\.|\[::1\])/.test(location.hostname);
  const base = live ? location.href.split(/[?#]/)[0] : PUBLIC_URL;
  const rec = bestRecord();
  const recQ = rec ? '&rn=' + encodeURIComponent(rec.name) + '&rt=' + rec.time : '';
  return base + '?play' + recQ + '#' + encode(level);
}

// ---------- main loop ----------
const STEP = 1000 / 60;
let last = performance.now(), accum = 0;
function frame(now) {
  accum += Math.min(100, now - last); last = now;
  while (accum >= STEP) { update(); accum -= STEP; }
  render();
  requestAnimationFrame(frame);
}
selectTile(GROUND); setHint(); updateShare();
if (startInPlay) { enterPlay(); } else { world = level.slice(); }
requestAnimationFrame(frame);
})();
