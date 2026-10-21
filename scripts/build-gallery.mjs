// Procesa las fotos públicas de PNP e Interpol UNA SOLA VEZ: detecta el rostro principal de
// cada foto, guarda su embedding (para Neon) y una miniatura (para la web). Corre en local,
// con onnxruntime-node (rápido); nunca en el navegador.
//
// Uso: cd D:\Aperitaje\web\scripts && npm install && node build-gallery.mjs
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import sharp from 'sharp';
// Reutiliza el motor ya probado de la herramienta local (mismo modelo buffalo_l que corre
// en el navegador vía onnxruntime-web, para que los embeddings vivan en el mismo espacio vectorial).
import { analyze } from '../../herramienta/lib/faceengine.js';

const BASE = 'D:/Aperitaje/BASE DE DATOS DE PNP E INTERPOL';
const PNP_DIR = path.join(BASE, 'PNP_DATA-20261021T003443Z-1-001/PNP_DATA');
const INTERPOL_DIR = path.join(BASE, 'INTERPOL_BD_FILTRADO-20261021T003446Z-1-001/INTERPOL_BD_FILTRADO');
const OUT_THUMBS = path.resolve('../gallery/thumbs');
const OUT_META = path.resolve('../gallery/meta.json');
const OUT_EMB = path.resolve('../gallery/embeddings.ndjson'); // no se sube a git; se carga a Neon aparte
const PACK = 'buffalo_l';
const THUMB_SIZE = 160;

fs.mkdirSync(OUT_THUMBS, { recursive: true });

function readCsv(file) {
  return parse(fs.readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

const sexoTexto = (s) => ({ M: 'Masculino', F: 'Femenino', '1': 'Masculino', '2': 'Femenino' }[String(s || '').trim().toUpperCase()] || s || '');
const num = (s) => { const n = parseFloat(String(s || '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

function pnpRecords() {
  const rows = readCsv(path.join(PNP_DIR, 'candidatos_hombres.csv'));
  return rows.map((r) => ({
    id: `pnp-${r.idRequisitoriado || r.id}`,
    fuente: 'PNP',
    nombre: titleCase(r.nombreCompleto || ''),
    delito: r.delito || r.delitos || '',
    lugar: [r.provincia, r.departamento].filter(Boolean).join(', '),
    url_ficha: r.url_ficha || '',
    photoPath: path.join(PNP_DIR, (r.archivo_foto || '').replace(/\\/g, '/')),
    sexo: sexoTexto(r.sexo_texto || r.sexo),
    departamento: r.departamento || '',
    provincia: r.provincia || '',
    monto_recompensa: num(r.montoRecompensa),
  })).filter((r) => r.photoPath);
}

function interpolRecords() {
  const rows = readCsv(path.join(INTERPOL_DIR, 'interpol_VE_PE_BO_CL.csv'));
  const out = [];
  for (const r of rows) {
    const archivos = (r.archivos_foto || '').split(';').map((s) => s.trim()).filter(Boolean);
    archivos.forEach((rel, i) => {
      out.push({
        id: `interpol-${(r.entity_id || '').replace(/[^\w]/g, '_')}-${i}`,
        fuente: 'INTERPOL',
        nombre: titleCase(`${r.nombres || ''} ${r.apellidos || ''}`.trim()),
        delito: r.delitos || '',
        lugar: [r.pais_nacimiento, r.nacionalidades].filter(Boolean).join(' / '),
        url_ficha: r.url_ficha || '',
        photoPath: path.join(INTERPOL_DIR, 'fotos', rel.replace(/\\/g, '/')),
        sexo: sexoTexto(r.sexo),
        fecha_nacimiento: r.fecha_nacimiento || '',
        nacionalidad: r.nacionalidades || '',
        estatura_m: num(r.estatura_m),
        peso_kg: num(r.peso_kg),
        color_ojos: r.color_ojos || '',
        color_cabello: r.color_cabello || '',
        senas_particulares: r.senas_particulares || '',
      });
    });
  }
  return out.filter((r) => r.photoPath);
}

async function processOne(rec) {
  if (!fs.existsSync(rec.photoPath)) return { ...rec, status: 'archivo no encontrado' };
  let buf;
  try { buf = fs.readFileSync(rec.photoPath); } catch (e) { return { ...rec, status: 'error de lectura: ' + e.message }; }
  let result;
  try { result = await analyze(buf, PACK); } catch (e) { return { ...rec, status: 'error de análisis: ' + e.message }; }
  const face = result.faces[0]; // ya viene ordenado por tamaño, el más grande primero
  if (!face) return { ...rec, status: 'sin rostro detectado' };

  const [x1, y1, x2, y2] = face.box;
  const w = x2 - x1, h = y2 - y1, side = Math.max(w, h) * 1.4;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const left = Math.max(0, Math.round(cx - side / 2)), top = Math.max(0, Math.round(cy - side / 2));
  const size = Math.max(1, Math.round(Math.min(side, result.width - left, result.height - top)));
  await sharp(buf)
    .extract({ left, top, width: size, height: size })
    .resize(THUMB_SIZE, THUMB_SIZE)
    .webp({ quality: 80 })
    .toFile(path.join(OUT_THUMBS, `${rec.id}.webp`));

  const { photoPath, ...fields } = rec; // todo lo del CSV (sexo, estatura, delito, etc.), menos la ruta local
  return {
    ...fields, thumb: `gallery/thumbs/${rec.id}.webp`, dip: face.dip,
    status: 'ok', embedding: Array.from(face.embedding),
  };
}

async function main() {
  const records = [...pnpRecords(), ...interpolRecords()];
  console.log(`Procesando ${records.length} fichas (PNP + Interpol)…`);
  const meta = [];
  const embStream = fs.createWriteStream(OUT_EMB);
  let ok = 0, sinRostro = 0, noEncontrado = 0, errores = 0;

  for (const [i, rec] of records.entries()) {
    const r = await processOne(rec);
    if (r.status === 'ok') {
      ok++;
      embStream.write(JSON.stringify({ id: r.id, embedding: r.embedding }) + '\n');
      const { embedding, ...m } = r;
      meta.push(m);
    } else if (r.status === 'sin rostro detectado') sinRostro++;
    else if (r.status === 'archivo no encontrado') noEncontrado++;
    else { errores++; console.warn(`[${rec.id}] ${r.status}`); }
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${records.length}…`);
  }
  embStream.end();
  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 1));

  console.log('\nListo.');
  console.log(`  OK (con rostro):     ${ok}`);
  console.log(`  Sin rostro:          ${sinRostro}`);
  console.log(`  Archivo no hallado:  ${noEncontrado}`);
  console.log(`  Errores:             ${errores}`);
  console.log(`\nMiniaturas: ${OUT_THUMBS}`);
  console.log(`Metadatos:  ${OUT_META}`);
  console.log(`Embeddings: ${OUT_EMB} (cargar a Neon con load-neon.mjs, no se sube a git)`);
}

main();
