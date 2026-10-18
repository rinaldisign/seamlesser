import * as THREE from 'three';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const S = { src: null, name: '', out: null, res: null, srcUrl: null, method: 'A', p: {} };

/* ---------- Metode (implementasi piksel deterministik, sRGB, alpha premultiplied) ---------- */
const M = {
  A: { n: 'A: Multiarah (direkomendasikan)', d: 'Mencampur arah horizontal dan vertikal secara terpisah, serta menangani sudut dengan bobot bilinear yang tidak bergantung pada urutan. Lebar dapat diatur untuk setiap sumbu.',
    p: [['wx', 'Lebar pencampuran horizontal (%)', 5, 50, 14], ['wy', 'Lebar pencampuran vertikal (%)', 5, 50, 14], ['s', 'Kekuatan (%)', 0, 100, 100], ['c', 'Kekuatan sudut (%)', 0, 100, 100]] },
  B: { n: 'B: Pergeseran + pelembutan tepi', d: 'Menggeser gambar secara melingkar lalu memadukan area tepi dengan konten bagian tengah. Hasil dikembalikan ke posisi semula sehingga tepi luarnya tersambung.',
    p: [['ox', 'Pergeseran horizontal (%)', 0, 100, 50], ['oy', 'Pergeseran vertikal (%)', 0, 100, 50], ['w', 'Lebar pelembutan tepi (%)', 5, 50, 25], ['s', 'Kekuatan (%)', 0, 100, 100]] }
};
const MAXH = 10, MAXPX = 4000; // riwayat maks. 10, sisi terpanjang hasil maks. 4000 px
for (const k in M) S.p[k] = Object.fromEntries(M[k].p.map(a => [a[0], a[4]]));

const ss = t => t * t * (3 - 2 * t);
const tick = () => new Promise(r => setTimeout(r));
// Mengembalikan buffer BARU; sumber tidak pernah diubah.
async function run(src, m, p, prog) {
  const { w, h, d } = src, o = new Uint8ClampedArray(d.length), s = p.s / 100, acc = [0, 0, 0, 0];
  const band = (n, pc) => Math.max(1, Math.min(n >> 1, Math.round(n * pc / 100)));
  // bobot 1 di tepi -> 0 di kedalaman b (smoothstep), dikali kekuatan
  const mk = (i, n, b) => { const t = Math.min(i, n - 1 - i) / b; return t >= 1 ? 0 : (1 - ss(t)) * s; };
  // campur dalam ruang premultiplied agar piksel transparan tidak menghitam
  const add = (wt, x, y) => { if (wt <= 0) return; const k = (y * w + x) * 4, a = d[k + 3] * wt; acc[0] += d[k] * a; acc[1] += d[k + 1] * a; acc[2] += d[k + 2] * a; acc[3] += a; };
  const bx = band(w, p.w ?? p.wx), by = band(h, p.w ?? p.wy ?? 0), ox = Math.round(w * (p.ox ?? 50) / 100), oy = Math.round(h * (p.oy ?? 50) / 100), hw = w >> 1, hh = h >> 1, c = (p.c ?? 100) / 100;
  const rows = Math.max(1, Math.floor(2e5 / w));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      if (m === 'B') {
        const a = 1 - (1 - mk(x, w, bx)) * (1 - mk(y, h, by));
        add(1 - a, x, y); add(a, (x + ox) % w, (y + oy) % h);
      } else {
        const wx = mk(x, w, band(w, p.wx)), wy = mk(y, h, band(h, p.wy)), wc = wx * wy * c;
        add((1 - wx) * (1 - wy) + wx * wy * (1 - c), x, y); add(wx * (1 - wy), (x + hw) % w, y);
        add((1 - wx) * wy, x, (y + hh) % h); add(wc, (x + hw) % w, (y + hh) % h);
      }
      const k = (y * w + x) * 4, al = acc[3];
      if (al > 0) { o[k] = acc[0] / al; o[k + 1] = acc[1] / al; o[k + 2] = acc[2] / al; } else { o[k] = d[k]; o[k + 1] = d[k + 1]; o[k + 2] = d[k + 2]; }
      o[k + 3] = al;
    }
    if (y % rows === 0) { prog((y + 1) / h); await tick(); }
  }
  return { w, h, d: o };
}
function edgeC(c) { // diagnostik tepi dari kanvas (hanya membaca strip tepi, hemat memori)
  const x = c.getContext('2d', { willReadFrequently: true }), w = c.width, h = c.height;
  const L = x.getImageData(0, 0, 1, h).data, Rr = x.getImageData(w - 1, 0, 1, h).data, Tp = x.getImageData(0, 0, w, 1).data, Bt = x.getImageData(0, h - 1, w, 1).data;
  let a = 0, b = 0;
  for (let y = 0; y < h; y++) for (let k = 0; k < 3; k++) a += Math.abs(L[y * 4 + k] - Rr[y * 4 + k]);
  for (let i = 0; i < w; i++) for (let k = 0; k < 3; k++) b += Math.abs(Tp[i * 4 + k] - Bt[i * 4 + k]);
  return [a / (h * 765), b / (w * 765)];
}
/* ---------- Randomisasi tile: baris digeser horizontal, kolom digeser vertikal ---------- */
// Teksturnya periodik, jadi tiap sel (baris r, kolom q) mengambil isi tekstur yang digeser (wraparound).
// Hasil = n kali ukuran asli; bila sisi terpanjang melebihi MAXPX, seluruhnya diperkecil seragam.
const plan = (n, w, h, lim = MAXPX) => {
  const k = Math.min(1, lim / (n * Math.max(w, h))), w2 = Math.max(1, Math.floor(w * k)), h2 = Math.max(1, Math.floor(h * k));
  return { k, w2, h2, W: n * w2, H: n * h2 }; // ukuran tile diskalakan dulu (kualitas tinggi), lalu disusun 1:1
};
const rng = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
// Tiap piksel mengambil sampel dari sel miliknya (geser baris/kolom) dan dari sel tetangga di sisi batas terdekat.
// Bobot tetangga = 0.5 tepat di batas, turun halus (smoothstep) ke 0 pada jarak B; bobot 2D (bilinear) tidak bergantung urutan.
// Tetangga dihitung wraparound (baris/kolom terakhir <-> pertama), jadi tepi gambar hasil ikut menyambung.
async function compose(src, n, o, lim, prog) {
  const { w2, h2, W, H } = plan(n, src.width, src.height, lim);
  const sc = document.createElement('canvas'); sc.width = w2; sc.height = h2;
  const sx = sc.getContext('2d', { willReadFrequently: true }); sx.imageSmoothingQuality = 'high'; sx.drawImage(src, 0, 0, w2, h2);
  const d = sx.getImageData(0, 0, w2, h2).data, out = new Uint8ClampedArray(W * H * 4);
  const rnd = rng(o.sd), shift = (m, a, i, z) => m === 1 ? Math.round(i * a / 100 * z) % z : m === 2 ? Math.round(rnd() * a / 100 * z) % z : 0;
  const hs = Array.from({ length: n }, (_, i) => shift(o.hm, o.ha, i, w2)), vs = Array.from({ length: n }, (_, i) => shift(o.vm, o.va, i, h2));
  const axis = (len, cell) => {
    const B = o.bw / 100 * cell / 2, idx = new Int32Array(len), oth = new Int32Array(len), wt = new Float32Array(len), loc = new Int32Array(len);
    for (let i = 0; i < len; i++) {
      const c = (i / cell) | 0, l = i - c * cell, dl = l + .5, dr = cell - l - .5; idx[i] = c; loc[i] = l; oth[i] = c;
      if (B > 0 && dl < B) { oth[i] = (c + n - 1) % n; wt[i] = .5 * (1 - ss(dl / B)); }
      else if (B > 0 && dr < B) { oth[i] = (c + 1) % n; wt[i] = .5 * (1 - ss(dr / B)); }
    }
    return { idx, oth, wt, loc };
  };
  const ax = axis(W, w2), ay = axis(H, h2), acc = [0, 0, 0, 0]; // akumulasi premultiplied agar alpha aman
  const smp = (rr, cc, lx, ly, wt) => { const u = (lx - hs[rr] + w2) % w2, v = (ly - vs[cc] + h2) % h2, k = (v * w2 + u) * 4, a = d[k + 3] * wt; acc[0] += d[k] * a; acc[1] += d[k + 1] * a; acc[2] += d[k + 2] * a; acc[3] += a; };
  const rows = Math.max(1, Math.floor(3e5 / W));
  for (let Y = 0; Y < H; Y++) {
    const r = ay.idx[Y], ro = ay.oth[Y], wy = ay.wt[Y], ly = ay.loc[Y];
    for (let X = 0; X < W; X++) {
      const q = ax.idx[X], qo = ax.oth[X], wx = ax.wt[X], lx = ax.loc[X];
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      smp(r, q, lx, ly, (1 - wy) * (1 - wx));
      if (wx > 0) smp(r, qo, lx, ly, (1 - wy) * wx);
      if (wy > 0) { smp(ro, q, lx, ly, wy * (1 - wx)); if (wx > 0) smp(ro, qo, lx, ly, wy * wx); }
      const al = acc[3], k = (Y * W + X) * 4;
      if (al > 0) { out[k] = acc[0] / al; out[k + 1] = acc[1] / al; out[k + 2] = acc[2] / al; out[k + 3] = al; }
    }
    if (prog && Y % rows === 0) { prog((Y + 1) / H); await tick(); }
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
  return c;
}
// Selisih rata-rata tepi kiri-kanan dan atas-bawah (0..1). Hanya diagnostik, bukan nilai mutu.
function edge({ w, h, d }) {
  let a = 0, b = 0;
  for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) a += Math.abs(d[y * w * 4 + c] - d[(y * w + w - 1) * 4 + c]);
  for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) b += Math.abs(d[x * 4 + c] - d[((h - 1) * w + x) * 4 + c]);
  return [a / (h * 765), b / (w * 765)];
}

/* ---------- Util UI ---------- */
let tt; const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 4500); };
const kb = n => n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.round(n / 1024) + ' KB';
const toCanvas = o => { const c = document.createElement('canvas'); c.width = o.w; c.height = o.h; c.getContext('2d').putImageData(new ImageData(o.d, o.w, o.h), 0, 0); return c; };
const blobOf = (c, t = 'image/png', q) => new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('Browser ini tidak dapat menyandikan gambar dalam format tersebut.')), t, q));

/* ---------- Impor ---------- */
async function load(f) {
  if (!f) return toast('Belum ada gambar yang dipilih.');
  try {
    const bm = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bm, 0, 0);
    S.src = { w: bm.width, h: bm.height, d: x.getImageData(0, 0, bm.width, bm.height).data };
    S.name = f.name.replace(/\.[^.]+$/, ''); if (S.srcUrl) URL.revokeObjectURL(S.srcUrl);
    S.srcUrl = URL.createObjectURL(f); S.out = S.res = S.base = S.rn = null; // buang hasil lama
    $('#thumb').src = S.srcUrl; $('#thumb').hidden = false; $('#go').disabled = false;
    $('#meta').textContent = `${f.name}:${bm.width}×${bm.height} px, ${kb(f.size)}, ${f.type || 'Format tidak diketahui'}`;
  } catch (e) {
    toast(e instanceof RangeError ? 'Gambar terlalu besar untuk memori browser. Coba gunakan gambar yang lebih kecil.' : 'Gambar tidak dapat dimuat. Gunakan file PNG, JPG, atau WebP yang tidak rusak.');
  }
}
const drop = $('#drop');
$('#pick').onclick = () => $('#file').click();
$('#file').onchange = e => { load(e.target.files[0]); e.target.value = ''; };
['dragenter', 'dragover'].forEach(v => drop.addEventListener(v, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(v => drop.addEventListener(v, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => load(e.dataTransfer.files[0]));

/* ---------- Pilih metode & parameter ---------- */
function renderMethods() {
  $('#methods').innerHTML = Object.keys(M).map(k => `<button role="tab" data-k="${k}" class="${k === S.method ? 'on' : ''}">${M[k].n}</button>`).join('');
  $('#about').textContent = M[S.method].d;
  $('#params').innerHTML = M[S.method].p.map(([k, l, a, b]) => `<label>${l}<input type="range" min="${a}" max="${b}" value="${S.p[S.method][k]}" data-k="${k}"><output>${S.p[S.method][k]}</output></label>`).join('');
}
$('#methods').onclick = e => { const k = e.target.dataset.k; if (k) { S.method = k; renderMethods(); } };
$('#params').oninput = e => { const k = e.target.dataset.k; S.p[S.method][k] = +e.target.value; e.target.nextElementSibling.textContent = e.target.value; };
$('#rst').onclick = () => { S.p[S.method] = Object.fromEntries(M[S.method].p.map(a => [a[0], a[4]])); renderMethods(); };
renderMethods();

/* ---------- Riwayat (IndexedDB, lokal) ---------- */
const db = new Promise((ok, no) => { const r = indexedDB.open('sts', 1); r.onupgradeneeded = () => r.result.createObjectStore('h', { keyPath: 'id' }); r.onsuccess = () => ok(r.result); r.onerror = no; });
const tx = async (m, f) => { const d = await db; return new Promise((ok, no) => { const t = d.transaction('h', m), q = f(t.objectStore('h')); t.oncomplete = () => ok(q && q.result); t.onerror = no; }); };
async function renderHist() {
  const all = ((await tx('readonly', s => s.getAll())) || []).sort((a, b) => b.id - a.id);
  $('#hl').innerHTML = all.length ? all.map(i => `<li data-id="${i.id}"><img src="${i.thumb}" alt=""><span>${i.name}<small>${/^[ABC]$/.test(i.m) ? 'Metode ' + (i.m === 'C' ? 'A' : i.m) : i.m} · ${i.w}×${i.h}</small></span><button class="x" data-del="${i.id}" aria-label="Hapus ${i.name}">Hapus</button></li>`).join('') : '<li style="cursor:default">Belum ada riwayat. Hasil yang dibuat akan muncul di sini.</li>';
}
async function saveHist(label) {
  const c = S.res, t = document.createElement('canvas'), r = 96 / Math.max(c.width, c.height); t.width = Math.max(1, c.width * r | 0); t.height = Math.max(1, c.height * r | 0);
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  try { const blob = await blobOf(c); await tx('readwrite', s => s.put({ id: Date.now(), name: S.name, m: label || S.method, w: c.width, h: c.height, thumb: t.toDataURL('image/jpeg', .7), blob })); const ks = (await tx('readonly', s => s.getAllKeys())) || []; for (const k of ks.slice(0, Math.max(0, ks.length - MAXH))) await tx('readwrite', s => s.delete(k)); renderHist(); } catch { toast('Riwayat tidak dapat disimpan di browser ini.'); }
}
$('#hbtn').onclick = () => { $('#hist').classList.toggle('open'); renderHist(); };
$('#hclr').onclick = async () => { await tx('readwrite', s => s.clear()); renderHist(); toast('Semua riwayat telah dihapus.'); };
$('#hl').onclick = async e => {
  const del = e.target.dataset.del, li = e.target.closest('li[data-id]');
  if (del) { await tx('readwrite', s => s.delete(+del)); return renderHist(); }
  if (!li) return;
  const it = await tx('readonly', s => s.get(+li.dataset.id)); if (!it) return;
  const bm = await createImageBitmap(it.blob), c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bm, 0, 0);
  S.res = c; S.base = S.rn = null; S.name = it.name; S.srcUrl = null;
  $('#hist').classList.remove('open'); location.hash = '#/result';
};

/* ---------- Latar three.js (WebGL2): awan partikel yang menjadi kisi tekstur saat memuat ---------- */
const B = { mode: 'idle', p: 0, tgt: 0 };
const R = new THREE.WebGLRenderer({ canvas: $('#bg'), antialias: true, alpha: true });
const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(55, 1, .1, 50); cam.position.z = 6;
const N = 2600, pos = new Float32Array(N * 3), grid = new Float32Array(N * 3), seed = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  pos.set([(Math.random() - .5) * 14, (Math.random() - .5) * 8, (Math.random() - .5) * 6], i * 3);
  grid.set([(i % 52) / 51 * 10 - 5, Math.floor(i / 52) / 49 * 6.4 - 3.2, 0], i * 3);
  seed.set([Math.random(), Math.random(), Math.random()], i * 3);
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aGrid', new THREE.BufferAttribute(grid, 3)); geo.setAttribute('aS', new THREE.BufferAttribute(seed, 3));
const U = { uT: { value: 0 }, uM: { value: 0 }, uP: { value: 0 }, uPR: { value: 1 }, uMo: { value: new THREE.Vector2(99, 99) } };
scene.add(new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false,
  vertexShader: `attribute vec3 aGrid,aS;uniform float uT,uM,uP,uPR;uniform vec2 uMo;varying float vA,vH;
  void main(){vec3 p=position+vec3(sin(uT*.3+aS.x*6.28),cos(uT*.25+aS.y*6.28),sin(uT*.2+aS.z*6.28))*.45;
  vec3 g=aGrid+vec3(0.,0.,sin(uT*1.2+aGrid.x*.8+aGrid.y*.8)*.08);vec3 q=mix(p,g,smoothstep(0.,1.,uM));
  vec2 d=q.xy-uMo;float l=length(d);q.xy+=normalize(d+1e-4)*exp(-l*1.2)*1.1;q.z+=exp(-l*1.5)*.8;
  vH=step(aGrid.x/10.+.5,uP)*uM;vec4 mv=modelViewMatrix*vec4(q,1.);gl_Position=projectionMatrix*mv;
  gl_PointSize=(3.+4.*aS.x)*uPR*5.5/-mv.z;vA=.55+.35*aS.y;}`,
  fragmentShader: `varying float vA,vH;void main(){float r=length(gl_PointCoord-.5);if(r>.5)discard;
  gl_FragColor=vec4(mix(vec3(.28,.45,.95),vec3(.06,.7,.66),vH),smoothstep(.5,.1,r)*vA);}` })));
const mouse = new THREE.Vector2(99, 99);
addEventListener('pointermove', e => { const a = innerWidth / innerHeight; mouse.set((e.clientX / innerWidth * 2 - 1) * 3.12 * a, -(e.clientY / innerHeight * 2 - 1) * 3.12); });

/* ---------- Halaman hasil: tile preview three.js (tekstur diulang apa adanya) ---------- */
const T = { r: null, sc: new THREE.Scene(), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10), mat: new THREE.MeshBasicMaterial({ transparent: true }), mesh: null, n: 3, z: 1, tz: 1, x: 0, y: 0, H: 1 };
function initTile() {
  if (T.r) return; T.r = new THREE.WebGLRenderer({ canvas: $('#tc'), antialias: true, alpha: true });
  const c = $('#tc'); let d = null;
  c.onpointerdown = e => { d = [e.clientX, e.clientY]; c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing'; };
  c.onpointerup = () => { d = null; c.style.cursor = 'grab'; };
  c.onpointermove = e => { if (!d) return; const k = 2 * T.H / c.clientHeight / T.z; T.x -= (e.clientX - d[0]) * k; T.y += (e.clientY - d[1]) * k; d = [e.clientX, e.clientY]; };
  c.onwheel = e => { e.preventDefault(); T.tz = Math.min(12, Math.max(.3, T.tz * (e.deltaY < 0 ? 1.15 : .87))); };
}
function setMode(n) {
  $$('#modes button').forEach(b => b.classList.toggle('on', +b.dataset.n === n));
  $('#rnd').hidden = n < 3; $('#cmp').hidden = n !== 0; $('#tc').hidden = n === 0; if (n === 0) return;
  T.n = n; T.z = .55; T.tz = 1; T.x = T.y = 0; // masuk perlahan (zoom lembut)
  const asp = S.res.width / S.res.height; T.tex.repeat.set(n, n);
  if (T.mesh) { T.sc.remove(T.mesh); T.mesh.geometry.dispose(); }
  T.mesh = new THREE.Mesh(new THREE.PlaneGeometry(n * asp, n), T.mat); T.sc.add(T.mesh); fit();
}
function fit() {
  const st = $('#stage'), W = st.clientWidth, Hh = st.clientHeight; if (!W || !T.r) return;
  T.r.setPixelRatio(Math.min(devicePixelRatio, 2)); T.r.setSize(W, Hh, false);
  const va = W / Hh, asp = S.res.width / S.res.height; T.H = Math.max(T.n / 2, T.n * asp / 2 / va) * 1.06;
  Object.assign(T.cam, { left: -T.H * va, right: T.H * va, top: T.H, bottom: -T.H });
}
async function showResult() {
  initTile(); if (T.tex) T.tex.dispose();
  T.tex = new THREE.CanvasTexture(S.res); T.tex.colorSpace = THREE.SRGBColorSpace; T.tex.wrapS = T.tex.wrapT = THREE.RepeatWrapping; T.tex.anisotropy = 8; T.mat.map = T.tex; T.mat.needsUpdate = true;
  const [a, b] = edgeC(S.res);
  $('#diag').textContent = `Perbedaan tepi (kiri-kanan ${(a * 100).toFixed(2)}%, atas-bawah ${(b * 100).toFixed(2)}%). Nilai yang lebih kecil berarti warna tepi lebih mirip, tetapi ini bukan skor kualitas dan tidak menjamin gradasi di bagian dalam tepi akan cocok.`;
  $('#dim').textContent = `Ukuran output: ${S.res.width}×${S.res.height} px` + (!S.base || S.res === S.base ? '(sama dengan gambar asli)' : `(pengacakan ${S.rn}×${S.rn}, maksimum ${MAXPX} px)`);
  const rb = await blobOf(S.res); if ($('#ia').dataset.u) URL.revokeObjectURL($('#ia').dataset.u); $('#ia').src = $('#ia').dataset.u = URL.createObjectURL(rb);
  $('#ib').src = S.srcUrl || ''; $('#mcmp').disabled = !S.srcUrl; $('#cr').oninput();
  setMode(S.rn || 3);
}
$('#modes').onclick = e => { const n = e.target.dataset.n; if (n !== undefined && S.res) setMode(+n); };
$('#cr').oninput = () => { $('#ib').style.clipPath = `inset(0 ${100 - $('#cr').value}% 0 0)`; };
$('#fmt').onchange = () => { const j = $('#fmt').value === 'jpeg'; $('#ql').hidden = $('#fnote').hidden = !j; };
$('#q').oninput = () => $('#qo').textContent = $('#q').value;
$('#back').onclick = () => { location.hash = '#/'; };
$('#exp').onclick = async () => {
  try {
    const j = $('#fmt').value === 'jpeg', c = document.createElement('canvas'); c.width = S.res.width; c.height = S.res.height;
    const x = c.getContext('2d'); if (j) { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); } x.drawImage(S.res, 0, 0);
    const b = await blobOf(c, j ? 'image/jpeg' : 'image/png', $('#q').value / 100), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = `${S.name}_seamless.${j ? 'jpg' : 'png'}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $('#dim').textContent = `Ekspor selesai: ${c.width}×${c.height} px, ${kb(b.size)}`;
  } catch (e) { toast('Ekspor gagal:' + e.message); }
};

/* ---------- Editor randomisasi ---------- */
const opts = () => ({ hm: +$('#hm').value, ha: +$('#ha').value, vm: +$('#vm').value, va: +$('#va').value, sd: +$('#sd').value || 0, bw: +$('#bw').value });
async function drawEditor() {
  if (!S.base) return; const n = S.rn || 3, c = await compose(S.base, n, opts(), 1000), pc = $('#rc'), p = plan(n, S.base.width, S.base.height);
  pc.width = c.width; pc.height = c.height; pc.getContext('2d').drawImage(c, 0, 0);
  $('#rsz').textContent = `Ukuran output: ${p.W}×${p.H} px` + (p.k < 1 ? `(diperkecil karena batas maksimum ${MAXPX} px)` : '(kelipatan bulat ukuran gambar asli)');
}
let rraf; const redraw = () => { cancelAnimationFrame(rraf); rraf = requestAnimationFrame(drawEditor); };
function openEditor() { if (!S.base) S.base = S.res; $('#rn').textContent = `${S.rn || 3}×${S.rn || 3}`; redraw(); }
$('#v-random').addEventListener('input', e => { if (e.target.type === 'range') e.target.nextElementSibling.textContent = e.target.value; redraw(); });
$('#shf').onclick = () => { $('#sd').value = Math.floor(Math.random() * 1e6); redraw(); };
$('#rnd').onclick = () => { S.rn = T.n; location.hash = '#/random'; };
$('#rback').onclick = () => { location.hash = '#/result'; };
$('#gen').onclick = async () => {
  const b = $('#gen'), done = () => { b.disabled = false; b.textContent = 'Buat hasil'; }; b.disabled = true;
  try { const n = S.rn || 3; S.res = await compose(S.base, n, opts(), MAXPX, v => { b.textContent = `Membuat hasil… ${Math.round(v * 100)}%`; }); saveHist(`Acak ${n}×${n}`); }
  catch (e) { done(); return toast(e instanceof RangeError ? 'Memori tidak cukup. Kurangi jumlah ubin.' : 'Gagal membuat hasil:' + e.message); }
  done(); location.hash = '#/result';
};

/* ---------- Proses + router ---------- */
$('#go').onclick = async () => {
  if (!S.src) return toast('Pilih gambar terlebih dahulu.');
  location.hash = '#/load'; B.p = B.tgt = 0; let real = 0, done = false; const t0 = performance.now();
  const upd = setInterval(() => { B.tgt = Math.min(real, (performance.now() - t0) / 3400); }, 30); // animasi minimal ±3,4 detik
  try {
    S.out = await run(S.src, S.method, { ...S.p[S.method] }, v => { real = v; });
    real = 1; while (B.p < .995) await new Promise(r => setTimeout(r, 50));
    S.res = toCanvas(S.out); S.out = null; S.base = S.rn = null; await sleep(600); location.hash = '#/result'; saveHist();
  } catch (e) { toast(e instanceof RangeError ? 'Memori browser tidak cukup. Coba gunakan gambar yang lebih kecil.' : 'Pemrosesan gagal:' + e.message); location.hash = '#/'; }
  clearInterval(upd);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
function route() {
  const r = location.hash.slice(2) || 'studio';
  if (((r === 'result' || r === 'random') && !S.res) || (r === 'load' && !S.src)) { location.hash = '#/'; return; }
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + (r === '' ? 'studio' : r)));
  B.mode = r === 'load' ? 'load' : 'idle'; if (r === 'result') showResult(); if (r === 'random') openEditor();
}
addEventListener('hashchange', route); route();

/* ---------- Loop render ---------- */
function resize() { R.setPixelRatio(Math.min(devicePixelRatio, 2)); U.uPR.value = R.getPixelRatio(); R.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); if (S.res) fit(); }
addEventListener('resize', resize); resize();
const clk = new THREE.Clock(), msg = ['Memuat piksel', 'Menggeser dan mencampur tepi', 'Menyambungkan sudut', 'Menyelesaikan proses'];
(function frame() {
  U.uT.value = clk.getElapsedTime(); U.uM.value += ((B.mode === 'load' ? 1 : 0) - U.uM.value) * .025; // transisi partikel >2 dtk
  B.p += (B.tgt - B.p) * .05; U.uP.value = B.p; U.uMo.value.lerp(mouse, .08);
  if (B.mode === 'load') { $('#lb').style.width = B.p * 100 + '%'; $('#lp').textContent = Math.round(B.p * 100) + '%'; $('#lt').textContent = msg[Math.min(3, B.p * 4 | 0)]; }
  R.render(scene, cam);
  if (T.r && location.hash === '#/result' && S.res && !$('#tc').hidden) {
    T.z += (T.tz - T.z) * .03; T.cam.zoom = T.z; T.cam.position.set(T.x, T.y, 5); T.cam.updateProjectionMatrix(); T.r.render(T.sc, T.cam);
  }
  requestAnimationFrame(frame);
})();

/* ---------- PWA: instalasi (sematkan ke taskbar) dan Service Worker ---------- */
let ip; addEventListener('beforeinstallprompt', e => { e.preventDefault(); ip = e; $('#inst').hidden = false; });
$('#inst').onclick = async () => { if (!ip) return; ip.prompt(); await ip.userChoice; ip = null; $('#inst').hidden = true; };
addEventListener('appinstalled', () => { $('#inst').hidden = true; });
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

/* ---------- Panel panduan penggunaan ---------- */
const gd = $('#gd'), gOpen = o => { gd.classList.toggle('open', o); if (o) $('#gx').focus(); else $('#gbtn').focus(); };
$('#gbtn').onclick = () => gOpen(true); $('#gx').onclick = () => gOpen(false);
gd.addEventListener('click', e => { if (e.target === gd) gOpen(false); });
addEventListener('keydown', e => { if (e.key === 'Escape' && gd.classList.contains('open')) gOpen(false); });
