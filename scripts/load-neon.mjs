// Carga gallery/meta.json + gallery/embeddings.ndjson (salida de build-gallery.mjs) a Neon.
// Uso:
//   set DATABASE_URL=postgresql://...   (o export en bash)
//   node load-neon.mjs --schema   -> crea la tabla e índice (una sola vez)
//   node load-neon.mjs            -> inserta/actualiza las fichas
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL. Ejecuta: set DATABASE_URL=postgresql://... (PowerShell: $env:DATABASE_URL="...")');
  process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL });

async function ensureSchema() {
  const sql = fs.readFileSync(path.resolve('schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Esquema listo (tabla rostros + índice vectorial).');
}

async function loadData() {
  const meta = JSON.parse(fs.readFileSync(path.resolve('../gallery/meta.json'), 'utf8'));
  const metaById = Object.fromEntries(meta.map((m) => [m.id, m]));
  const lines = fs.readFileSync(path.resolve('../gallery/embeddings.ndjson'), 'utf8').trim().split('\n');
  console.log(`Cargando ${lines.length} fichas a Neon…`);
  let n = 0;
  for (const line of lines) {
    const { id, embedding } = JSON.parse(line);
    const m = metaById[id];
    if (!m) continue;
    const vec = '[' + embedding.join(',') + ']';
    await pool.query(
      `insert into rostros (id, fuente, nombre, delito, lugar, url_ficha, thumb, dip, embedding)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector)
       on conflict (id) do update set fuente=excluded.fuente, nombre=excluded.nombre, delito=excluded.delito,
         lugar=excluded.lugar, url_ficha=excluded.url_ficha, thumb=excluded.thumb, dip=excluded.dip, embedding=excluded.embedding`,
      [m.id, m.fuente, m.nombre, m.delito, m.lugar, m.url_ficha, m.thumb, m.dip, vec]
    );
    n++;
    if (n % 100 === 0) console.log(`  ${n}/${lines.length}…`);
  }
  console.log(`Listo: ${n} fichas cargadas.`);
}

const args = process.argv.slice(2);
try {
  if (args.includes('--schema')) await ensureSchema();
  else await loadData();
} finally {
  await pool.end();
}
