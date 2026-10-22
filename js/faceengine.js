// Motor de cotejo facial para navegador: SCRFD (detección) + ArcFace (embedding), ONNX Runtime Web.
// Todo corre en el equipo de quien abre la página; ninguna imagen sale a un servidor.
const ARC = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
const DET_SIZE = 640, DET_SIZE_CHICO = 1280; // 1280: segundo intento para rostros chicos (CCTV)
const Y_TAPA = 66, GRIS = (120 - 127.5) / 127.5; // parte baja tapada en el espacio alineado 112×112 (desde la nariz hacia abajo)

// Dos paquetes de InsightFace, mismo detector (SCRFD-10G), reconocedor distinto —
// sirven para el contraste independiente que pide E-10.
export const PACKS = {
  buffalo_l: { det: 'models/buffalo_l/det_10g.onnx', rec: 'models/buffalo_l/w600k_r50.onnx', detLabel: 'Detector de rostros (17 MB)', recLabel: 'Reconocedor ArcFace ResNet50 (167 MB)', desc: 'ArcFace ResNet50 / WebFace600K' },
  antelopev2: { det: 'models/antelopev2/scrfd_10g_bnkps.onnx', rec: 'models/antelopev2/glintr100.onnx', detLabel: 'Detector de rostros (17 MB)', recLabel: 'Reconocedor ArcFace ResNet100 (249 MB)', desc: 'ArcFace ResNet100 / Glint360K' },
};
const sessions = {}; // { buffalo_l: {det,rec}, antelopev2: {det,rec} }
const loadPromises = {}; // evita que un segundo clic dispare una segunda descarga del mismo paquete

// Caché de los .onnx en IndexedDB: la primera visita descarga, las siguientes leen del disco del navegador.
const DB_NAME = 'aperitaje-modelos', STORE = 'onnx', DB_VERSION = 1;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
// Se guarda como Blob, no como ArrayBuffer: IndexedDB maneja un Blob grande escribiéndolo
// directo a disco; un ArrayBuffer de ~170 MB se clona en memoria y puede colgar la pestaña.
async function idbGet(key) {
  try {
    const db = await openDB();
    const blob = await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      tx.onsuccess = () => resolve(tx.result || null);
      tx.onerror = () => resolve(null);
    });
    return blob ? await blob.arrayBuffer() : null;
  } catch { return null; } // Safari privado u otros bloqueos: seguimos sin caché, no es fatal
}
async function idbSet(key, blob) {
  try {
    const db = await openDB();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
    });
  } catch { /* si no se puede guardar, simplemente se vuelve a descargar la próxima vez */ }
}

export async function loadModels(pack, onProgress) {
  if (sessions[pack]) return sessions[pack];
  if (loadPromises[pack]) return loadPromises[pack]; // ya hay una carga en curso: esperarla, no repetirla
  const p = PACKS[pack];
  if (!p) throw new Error(`Paquete desconocido: ${pack}`);
  loadPromises[pack] = (async () => {
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
    const fetchBuf = async (url, label, cacheKey) => {
      const cached = await idbGet(cacheKey);
      if (cached) { if (onProgress) onProgress(label + ' (en caché del navegador)', cached.byteLength, cached.byteLength); return new Uint8Array(cached); }
      const res = await fetch(url);
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body.getReader();
      const chunks = []; let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        if (onProgress) onProgress(label, got, total);
      }
      const blob = new Blob(chunks);
      idbSet(cacheKey, blob); // no se espera: guardar no debe retrasar el primer uso
      return new Uint8Array(await blob.arrayBuffer());
    };
    const [detBuf, recBuf] = await Promise.all([
      fetchBuf(p.det, p.detLabel, `${pack}-det-v1`),
      fetchBuf(p.rec, p.recLabel, `${pack}-rec-v1`),
    ]);
    const opts = { executionProviders: ['wasm'] };
    const [det, rec] = await Promise.all([ort.InferenceSession.create(detBuf, opts), ort.InferenceSession.create(recBuf, opts)]);
    sessions[pack] = { det, rec };
    return sessions[pack];
  })();
  return loadPromises[pack];
}

function imageToRGB(img) {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  const rgb = new Uint8ClampedArray(c.width * c.height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) { rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2]; }
  return { data: rgb, width: c.width, height: c.height };
}

// Margen negro alrededor: las fichas recortadas al ras del rostro no le dejan contexto a SCRFD.
function conMargen(img, m) {
  const W = img.width + 2 * m, H = img.height + 2 * m, data = new Uint8ClampedArray(W * H * 3);
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 3, (y + 1) * img.width * 3), ((y + m) * W + m) * 3);
  return { data, width: W, height: H };
}

function resizePad(img, size) {
  const scale = Math.min(size / img.width, size / img.height);
  const nw = Math.max(1, Math.round(img.width * scale)), nh = Math.max(1, Math.round(img.height * scale));
  const src = document.createElement('canvas'); src.width = img.width; src.height = img.height;
  const sg = src.getContext('2d');
  const id = sg.createImageData(img.width, img.height);
  for (let i = 0, j = 0; j < img.data.length; i += 4, j += 3) { id.data[i] = img.data[j]; id.data[i + 1] = img.data[j + 1]; id.data[i + 2] = img.data[j + 2]; id.data[i + 3] = 255; }
  sg.putImageData(id, 0, 0);
  const dst = document.createElement('canvas'); dst.width = size; dst.height = size;
  const dg = dst.getContext('2d'); dg.imageSmoothingQuality = 'high'; dg.fillRect(0, 0, size, size);
  dg.drawImage(src, 0, 0, img.width, img.height, 0, 0, nw, nh);
  return { data: dg.getImageData(0, 0, size, size).data, scale };
}

function iou(a, b) {
  const x1 = Math.max(a.box[0], b.box[0]), y1 = Math.max(a.box[1], b.box[1]);
  const x2 = Math.min(a.box[2], b.box[2]), y2 = Math.min(a.box[3], b.box[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) + (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - inter;
  return inter / ua;
}
function nms(dets, thr) { dets.sort((a, b) => b.score - a.score); const keep = []; for (const d of dets) if (keep.every((k) => iou(k, d) < thr)) keep.push(d); return keep; }

async function detect(session, img, scoreThr, DET_SIZE = 640) {
  const { data: rgba, scale } = resizePad(img, DET_SIZE);
  const plane = DET_SIZE * DET_SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = (rgba[i * 4] - 127.5) / 128;
    input[plane + i] = (rgba[i * 4 + 1] - 127.5) / 128;
    input[2 * plane + i] = (rgba[i * 4 + 2] - 127.5) / 128;
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, DET_SIZE, DET_SIZE]) });
  const o = session.outputNames.map((n) => out[n].data);
  const dets = [];
  [8, 16, 32].forEach((s, i) => {
    const sc = o[i], bb = o[i + 3], kp = o[i + 6];
    const n = DET_SIZE / s;
    let idx = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let a = 0; a < 2; a++, idx++) {
      if (sc[idx] < scoreThr) continue;
      const cx = x * s, cy = y * s;
      const box = [cx - bb[idx * 4] * s, cy - bb[idx * 4 + 1] * s, cx + bb[idx * 4 + 2] * s, cy + bb[idx * 4 + 3] * s].map((v) => v / scale);
      const kps = [];
      for (let k = 0; k < 5; k++) kps.push([(cx + kp[idx * 10 + k * 2] * s) / scale, (cy + kp[idx * 10 + k * 2 + 1] * s) / scale]);
      dets.push({ score: sc[idx], box, kps });
    }
  });
  return nms(dets, 0.4);
}

function similarity(src, dst) {
  const n = src.length; const ms = [0, 0], md = [0, 0];
  for (let i = 0; i < n; i++) { ms[0] += src[i][0] / n; ms[1] += src[i][1] / n; md[0] += dst[i][0] / n; md[1] += dst[i][1] / n; }
  let re = 0, im = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - ms[0], sy = src[i][1] - ms[1], dx = dst[i][0] - md[0], dy = dst[i][1] - md[1];
    re += sx * dx + sy * dy; im += sx * dy - sy * dx; den += sx * sx + sy * sy;
  }
  return { zr: re / den, zi: im / den, ms, md };
}

function alignCrop(img, kps, tapar = false) {
  const { zr, zi, ms, md } = similarity(kps, ARC);
  const mag2 = zr * zr + zi * zi; const S = 112;
  const out = new Float32Array(3 * S * S);
  const { data, width: W, height: H } = img;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = x - md[0], py = y - md[1];
    const sx = (px * zr + py * zi) / mag2 + ms[0];
    const sy = (py * zr - px * zi) / mag2 + ms[1];
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    for (let c = 0; c < 3; c++) {
      const g = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : data[(yy * W + xx) * 3 + c]);
      const v = g(x0, y0) * (1 - fx) * (1 - fy) + g(x0 + 1, y0) * fx * (1 - fy) + g(x0, y0 + 1) * (1 - fx) * fy + g(x0 + 1, y0 + 1) * fx * fy;
      out[c * S * S + y * S + x] = tapar && y >= Y_TAPA ? GRIS : (v - 127.5) / 127.5;
    }
  }
  return out;
}

async function embed(session, img, kps, tapar = false) {
  const input = alignCrop(img, kps, tapar);
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, 112, 112]) });
  const e = Float32Array.from(out[session.outputNames[0]].data);
  let norm = 0; for (const v of e) norm += v * v; norm = Math.sqrt(norm);
  return Array.from(e, (v) => v / norm);
}

export const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
export const dip = (kps) => Math.hypot(kps[1][0] - kps[0][0], kps[1][1] - kps[0][1]);
export function bandaDIP(px) {
  if (px < 20) return 'inservible (<20 px)';
  if (px < 40) return 'solo descarte (20–40 px)';
  if (px < 60) return 'morfológico con reservas (40–60 px)';
  if (px < 90) return 'morfológico sólido (60–90 px)';
  return 'apto biometría automática (>90 px)';
}

// Detección en cascada: 640 px; si no hay rostro, con margen (recortes al ras); si aún no, 1280 px (rostros chicos).
async function detectarCascada(det, img, scoreThr) {
  let faces = await detect(det, img, scoreThr, DET_SIZE);
  if (faces.length) return { faces, intento: '640 px' };
  const m = Math.round(0.25 * Math.max(img.width, img.height));
  faces = (await detect(det, conMargen(img, m), scoreThr, DET_SIZE)).map((f) => ({ ...f, box: f.box.map((v) => v - m), kps: f.kps.map(([x, y]) => [x - m, y - m]) }));
  if (faces.length) return { faces, intento: '640 px con margen' };
  return { faces: await detect(det, img, scoreThr, DET_SIZE_CHICO), intento: '1280 px' };
}

// opts.tapar: tapa la parte baja del rostro alineado, para comparar en las mismas condiciones que un dubitado con capucha.
export async function analyze(imgEl, pack = 'buffalo_l', scoreThr = 0.3, opts = {}) {
  const { det, rec } = await loadModels(pack);
  const img = imageToRGB(imgEl);
  const { faces, intento } = await detectarCascada(det, img, scoreThr);
  const out = [];
  for (const f of faces) {
    out.push({ box: f.box.map((v) => Math.round(v * 10) / 10), score: Math.round(f.score * 1000) / 1000, kps: f.kps, dip: Math.round(dip(f.kps) * 10) / 10, dipBanda: bandaDIP(dip(f.kps)), embedding: await embed(rec, img, f.kps, !!opts.tapar) });
  }
  out.sort((a, b) => (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]));
  return { width: img.width, height: img.height, faces: out, deteccion: intento, tapado: !!opts.tapar };
}

// Plantilla de varios fotogramas: promedio de los vectores ponderado por DIP × score, renormalizado.
export function plantilla(faces) {
  const v = new Float64Array(faces[0].embedding.length);
  for (const f of faces) { const w = f.dip * f.score; f.embedding.forEach((x, i) => { v[i] += w * x; }); }
  const n = Math.hypot(...v);
  return Array.from(v, (x) => x / n);
}

/* ---------- calibración con la propia base de fichas (ISO/IEC 19795-1; escala verbal ENFSI 2015) ---------- */
// Los vectores de las 789 fichas se calculan en este navegador la primera vez (unos minutos) y quedan en
// IndexedDB; el repositorio solo trae sus puntos faciales y las similitudes genuinas (gallery/calib/).
const calibs = {};
export async function cargarCalibracion(pack, tapar, onProgress) {
  const clave = `calib-${pack}-${tapar ? 'tapado' : 'sin_tapar'}-v1`;
  if (calibs[clave]) return calibs[clave];
  const [puntos, gen, meta] = await Promise.all(['gallery/calib/puntos.json', 'gallery/calib/genuinas.json', 'gallery/meta.json'].map((u) => fetch(u).then((r) => r.json())));
  let imp = null;
  const cached = await idbGet(clave);
  if (cached && cached.byteLength === puntos.length * 512 * 4) imp = new Float32Array(cached);
  else {
    const { rec } = await loadModels(pack);
    const thumb = new Map(meta.map((m) => [m.id, m.thumb]));
    imp = new Float32Array(puntos.length * 512);
    for (const [i, p] of puntos.entries()) {
      const el = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = thumb.get(p.id); });
      imp.set(await embed(rec, imageToRGB(el), p.kps, tapar), i * 512);
      if (onProgress && i % 10 === 0) onProgress(i, puntos.length);
    }
    idbSet(clave, new Blob([imp.buffer]));
  }
  calibs[clave] = { imp, n: puntos.length, genuinas: gen[pack][tapar ? 'tapado' : 'sin_tapar'], pares: gen.pares };
  return calibs[clave];
}

export const ESCALA_ENFSI = [[1, 'Sin apoyo (RV ≤ 1)'], [2, 'Apoyo nulo o muy débil (RV 1–2)'], [10, 'Apoyo débil (RV 2–10)'], [100, 'Apoyo moderado (RV 10–100)'],
  [1e3, 'Apoyo moderadamente fuerte (RV 100–1.000)'], [1e4, 'Apoyo fuerte (RV 1.000–10.000)'], [1e6, 'Apoyo muy fuerte (RV 10.000–1.000.000)'], [Infinity, 'Apoyo extremadamente fuerte (RV > 1.000.000)']];
// Cota superior al 95 % de la tasa de falsas coincidencias: regla de tres si ninguna ficha supera; si no, Wilson.
function fmrSup(k, n, z = 1.96) {
  if (k === 0) return 3 / n;
  const p = k / n;
  return (p + z * z / (2 * n) + z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n);
}
// Puesto de la referencia entre las fichas, tasa de aciertos (TMR) con los pares genuinos y RV prudente = TMR / FMR superior.
export function calibrar(cos, sonda, cal) {
  let k = 0;
  for (let i = 0; i < cal.n; i++) { let s = 0; for (let j = 0; j < 512; j++) s += sonda[j] * cal.imp[i * 512 + j]; if (s >= cos) k++; }
  const tmr = cal.genuinas.filter((g) => g >= cos).length / cal.genuinas.length, fs = fmrSup(k, cal.n), rv = tmr / fs;
  // equivalencia con los 5 niveles de la página: ≤1 sin apoyo · 1–10 no concluyente · 10–100 limitado · 100–10.000 moderado · >10.000 fuerte
  const nivel = rv <= 1 ? 0 : rv <= 10 ? 1 : rv <= 100 ? 2 : rv <= 1e4 ? 3 : 4;
  return { puesto: k + 1, de: cal.n + 1, superan: k, fmrSup: fs, tmr, rv, nivel, verbal: ESCALA_ENFSI.find(([lim]) => rv <= lim)[1] };
}

const NIVELES = ['Sin apoyo a la identidad', 'No concluyente', 'Apoyo limitado', 'Apoyo moderado', 'Apoyo fuerte'];
export function nivelVerbal(cos, dipMin) {
  const base = cos < 0.2 ? 0 : cos < 0.3 ? 1 : cos < 0.4 ? 2 : cos < 0.55 ? 3 : 4;
  let nivel = base;
  if (dipMin < 20) nivel = 1;
  else if (dipMin < 40 && base >= 2) nivel = base - 1;
  const calidadLimita = dipMin < 40 && (dipMin < 20 || base >= 2);
  return { nivel, calidadLimita, texto: dipMin < 20 ? 'No concluyente — calidad insuficiente (DIP < 20 px)' : NIVELES[nivel] + (calidadLimita ? ' — calidad baja' : '') };
}

export async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
