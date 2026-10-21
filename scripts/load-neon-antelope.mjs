// Carga gallery/embeddings-antelope.ndjson (salida de add-antelope-embeddings.mjs) a la
// columna embedding_antelope de Neon. No toca nada más de la fila.
// Uso: set DATABASE_URL=... && node load-neon-antelope.mjs
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('Falta DATABASE_URL.'); process.exit(1); }
const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  const lines = fs.readFileSync(path.resolve('../gallery/embeddings-antelope.ndjson'), 'utf8').trim().split('\n');
  console.log(`Cargando ${lines.length} embeddings antelopev2 a Neon…`);
  let n = 0;
  for (const line of lines) {
    const { id, embedding } = JSON.parse(line);
    const vec = '[' + embedding.join(',') + ']';
    await pool.query(`update rostros set embedding_antelope = $2::vector where id = $1`, [id, vec]);
    n++;
    if (n % 100 === 0) console.log(`  ${n}/${lines.length}…`);
  }
  console.log(`Listo: ${n} filas actualizadas.`);
  await pool.end();
}
main();
