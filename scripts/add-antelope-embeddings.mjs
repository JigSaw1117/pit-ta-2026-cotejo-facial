// Recorre las mismas 809 fotos y calcula el embedding con antelopev2 (ArcFace ResNet100,
// Glint360K), para contrastarlo con el de buffalo_l ya cargado. Mismo detector (SCRFD-10G),
// solo cambia el reconocedor. No rehace miniaturas: ya están hechas.
// Uso: node add-antelope-embeddings.mjs
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { analyze } from '../../herramienta/lib/faceengine.js';

const BASE = 'D:/Aperitaje/BASE DE DATOS DE PNP E INTERPOL';
const PNP_DIR = path.join(BASE, 'PNP_DATA-20261021T003443Z-1-001/PNP_DATA');
const INTERPOL_DIR = path.join(BASE, 'INTERPOL_BD_FILTRADO-20261021T003446Z-1-001/INTERPOL_BD_FILTRADO');
const OUT_EMB = path.resolve('../gallery/embeddings-antelope.ndjson'); // no se sube a git
const PACK = 'antelopev2';

const readCsv = (file) => parse(fs.readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });

function pnpPaths() {
  const rows = readCsv(path.join(PNP_DIR, 'candidatos_hombres.csv'));
  return rows.map((r) => ({ id: `pnp-${r.idRequisitoriado || r.id}`, photoPath: path.join(PNP_DIR, (r.archivo_foto || '').replace(/\\/g, '/')) }));
}
function interpolPaths() {
  const rows = readCsv(path.join(INTERPOL_DIR, 'interpol_VE_PE_BO_CL.csv'));
  const out = [];
  for (const r of rows) {
    const archivos = (r.archivos_foto || '').split(';').map((s) => s.trim()).filter(Boolean);
    archivos.forEach((rel, i) => out.push({ id: `interpol-${(r.entity_id || '').replace(/[^\w]/g, '_')}-${i}`, photoPath: path.join(INTERPOL_DIR, 'fotos', rel.replace(/\\/g, '/')) }));
  }
  return out;
}

async function main() {
  const records = [...pnpPaths(), ...interpolPaths()];
  console.log(`Calculando embeddings antelopev2 para ${records.length} fichas…`);
  const stream = fs.createWriteStream(OUT_EMB);
  let ok = 0, sinRostro = 0, errores = 0;
  for (const [i, rec] of records.entries()) {
    try {
      if (!fs.existsSync(rec.photoPath)) { errores++; continue; }
      const buf = fs.readFileSync(rec.photoPath);
      const result = await analyze(buf, PACK);
      const face = result.faces[0];
      if (!face) { sinRostro++; continue; }
      stream.write(JSON.stringify({ id: rec.id, embedding: Array.from(face.embedding) }) + '\n');
      ok++;
    } catch (e) { errores++; console.warn(`[${rec.id}] ${e.message}`); }
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${records.length}…`);
  }
  stream.end();
  console.log(`\nListo. OK: ${ok} · sin rostro: ${sinRostro} · errores: ${errores}`);
  console.log(`Salida: ${OUT_EMB}`);
}

main();
