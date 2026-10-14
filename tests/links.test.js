// Run with: node tests/links.test.js
// Checks that level links round-trip, old links still open, and bad input is rejected.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'game.js'), 'utf8');
const grab = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
const code = 'const W=80,H=17,T=32,EMPTY=0,GROUND=1,BRICK=2,QBLOCK=3,COIN=4,SPIKE=5,ENEMY=6,START=7,GOAL=8,USED=9,SPRING=10,HPLAT=11,VPLAT=12;'
  + grab('const bytesToB64', '// ---------- sample levels')
  + grab('function starter', '// ---------- state')
  + ';({encode,decode,encodeV1,decodeV1,encodeV2,decodeV2,starter,demo,sameLevel})';
const L = eval(code);
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };

// 1. demo + starter round-trip, and sizes
for (const [n, l] of [['starter', L.starter()], ['demo', L.demo()]]) {
  const v1 = L.encodeV1(l), v2 = L.encode(l);
  ok(L.sameLevel(L.decode(v2), l), n + ' roundtrip v2');
  ok(L.sameLevel(L.decode(v1), l), n + ' roundtrip v1');
  ok(v2[0] === '.', n + ' uses v2');
  console.log(n.padEnd(8), 'v1', v1.length, 'v2', v2.length, `(${Math.round(100 - v2.length * 100 / v1.length)}% shorter)`);
}
// 2. old links captured earlier in this project still decode to the same levels
const oldLinks = ['MHY2LjcxLjAyMS44MS4wMy4xNGcu', 'MHY2LjcxLjAyLjgxLjAyMi4xNGcu'];
oldLinks.forEach(s => { const d = L.decode(s); ok(d && d.length === 1360, 'old link ' + s); ok(d && L.encodeV1(d) === s, 'old link canonical ' + s); });
// 3. random levels: various densities, including worst case (every tile different), all runs, all-zero
let rnd = 12345; const rand = () => (rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let k = 0; k < 4000; k++) {
  const l = new Uint8Array(1360);
  const mode = k % 4;
  for (let i = 0; i < l.length; i++) {
    if (mode === 0) l[i] = Math.floor(rand() * 13) === 9 ? 0 : Math.floor(rand() * 13);      // noise (never USED)
    else if (mode === 1) l[i] = rand() < 0.05 ? [1,2,3,4,5,6,7,8,10,11,12][Math.floor(rand()*11)] : 0; // sparse
    else if (mode === 2) l[i] = i > 600 ? 1 : 0;                                              // long runs
    else l[i] = Math.floor(i / (1 + Math.floor(rand() * 300))) % 13 === 9 ? 0 : Math.floor(i / (1 + Math.floor(rand() * 300))) % 13;
  }
  for (let i = 0; i < l.length; i++) if (l[i] === 9) l[i] = 0;
  const s = L.encode(l);
  ok(L.sameLevel(L.decode(s), l), 'random roundtrip mode ' + mode);
  ok(/^[.A-Za-z0-9_-]+$/.test(s), 'url-safe chars');
}
// 4. every run length 1..1360 for several tiles
for (const t of [0, 1, 12]) for (let n = 1; n <= 1360; n++) {
  const l = new Uint8Array(1360).fill(t === 0 ? 1 : 0); l.fill(t, 0, n);
  ok(L.sameLevel(L.decode(L.encodeV2(l)), l), 'run ' + n + ' tile ' + t);
}
// 5. malformed / hostile input must return null, never throw or hang
const bad = ['', '.', '..', '.AAAA', './///', '.-_-_', 'zzzz', '.' + 'A'.repeat(5000), '!!!', '.QQ', '.7'.repeat(10)];
bad.forEach(s => { let r; try { r = L.decode(s); } catch (e) { ok(false, 'threw on ' + s.slice(0, 20)); } ok(r === null || r.length === 1360, 'bad input ' + s.slice(0, 20)); });
console.log(fail ? fail + ' FAILURES' : 'ALL PASSED');
process.exit(fail ? 1 : 0);
