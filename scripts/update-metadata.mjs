// Agrega campos del CSV (sexo, estatura, peso, etc.) a gallery/meta.json y a Neon,
// SIN rehacer la detección facial ni los embeddings (eso ya está hecho).
// Uso: set DATABASE_URL=... && node update-metadata.mjs
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { Pool } from '@neondatabase/serverless';

const BASE = 'D:/Aperitaje/BASE DE DATOS DE PNP E INTERPOL';
const PNP_DIR = path.join(BASE, 'PNP_DATA-20261021T003443Z-1-001/PNP_DATA');
const INTERPOL_DIR = path.join(BASE, 'INTERPOL_BD_FILTRADO-20261021T003446Z-1-001/INTERPOL_BD_FILTRADO');
const OUT_META = path.resolve('../gallery/meta.json');

const readCsv = (file) => parse(fs.readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true, bom: true });
const sexoTexto = (s) => ({ M: 'Masculino', F: 'Femenino', '1': 'Masculino', '2': 'Femenino' }[String(s || '').trim().toUpperCase()] || s || '');
const num = (s) => { const n = parseFloat(String(s || '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

function extraByIdPNP() {
  const rows = readCsv(path.join(PNP_DIR, 'candidatos_hombres.csv'));
  const map = new Map();
  for (const r of rows) {
    map.set(`pnp-${r.idRequisitoriado || r.id}`, {
      sexo: sexoTexto(r.sexo_texto || r.sexo), departamento: r.departamento || '', provincia: r.provincia || '',
      monto_recompensa: num(r.montoRecompensa),
      archivo: path.basename((r.archivo_foto || r.foto_plana || '').replace(/\\/g, '/')),
    });
  }
  return map;
}
function extraByIdInterpol() {
  const rows = readCsv(path.join(INTERPOL_DIR, 'interpol_VE_PE_BO_CL.csv'));
  const map = new Map();
  for (const r of rows) {
    const archivos = (r.archivos_foto || '').split(';').map((s) => s.trim()).filter(Boolean);
    const planos = (r.archivos_foto_planos || '').split(';').map((s) => s.trim()).filter(Boolean);
    archivos.forEach((rel, i) => {
      map.set(`interpol-${(r.entity_id || '').replace(/[^\w]/g, '_')}-${i}`, {
        sexo: sexoTexto(r.sexo), fecha_nacimiento: r.fecha_nacimiento || '', nacionalidad: r.nacionalidades || '',
        estatura_m: num(r.estatura_m), peso_kg: num(r.peso_kg), color_ojos: r.color_ojos || '',
        color_cabello: r.color_cabello || '', senas_particulares: r.senas_particulares || '',
        delito: r.delitos || '', // corrige el truncado a 300 caracteres de una versión anterior del script
        archivo: path.basename(rel.replace(/\\/g, '/')),
        archivoAlt: planos[i] ? path.basename(planos[i].replace(/\\/g, '/')) : '',
      });
    });
  }
  return map;
}

async function main() {
  const extra = new Map([...extraByIdPNP(), ...extraByIdInterpol()]);
  const meta = JSON.parse(fs.readFileSync(OUT_META, 'utf8'));
  let matched = 0;
  const merged = meta.map((m) => {
    const e = extra.get(m.id);
    if (e) matched++;
    return { ...m, ...(e || {}) };
  });
  fs.writeFileSync(OUT_META, JSON.stringify(merged, null, 1));
  console.log(`meta.json actualizado: ${matched}/${meta.length} fichas con datos adicionales.`);

  if (!process.env.DATABASE_URL) { console.log('DATABASE_URL no definida: solo se actualizó meta.json, no Neon.'); return; }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let updated = 0;
  for (const m of merged) {
    const e = extra.get(m.id);
    if (!e) continue;
    await pool.query(
      `update rostros set sexo=$2, fecha_nacimiento=$3, nacionalidad=$4, estatura_m=$5, peso_kg=$6,
         color_ojos=$7, color_cabello=$8, senas_particulares=$9, departamento=$10, provincia=$11, monto_recompensa=$12,
         delito=coalesce(nullif($13,''), delito)
       where id=$1`,
      [m.id, e.sexo || null, e.fecha_nacimiento || null, e.nacionalidad || null, e.estatura_m ?? null, e.peso_kg ?? null,
        e.color_ojos || null, e.color_cabello || null, e.senas_particulares || null, e.departamento || null, e.provincia || null, e.monto_recompensa ?? null,
        e.delito || '']
    );
    updated++;
    if (updated % 100 === 0) console.log(`  ${updated}…`);
  }
  await pool.end();
  console.log(`Neon actualizado: ${updated} filas.`);
}

main();
