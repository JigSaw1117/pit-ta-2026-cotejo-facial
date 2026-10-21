// Busca el rostro de la evidencia contra las fichas públicas de PNP/Interpol cargadas en Neon.
// El navegador nunca toca la base de datos directamente: calcula el embedding (en su propio
// equipo, con onnxruntime-web) y esta función hace la comparación del lado del servidor.
import { Pool } from '@neondatabase/serverless';

let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está configurada en Netlify');
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

const FICHA_FIELDS = `id, fuente, nombre, delito, lugar, url_ficha, thumb, dip,
              sexo, fecha_nacimiento, nacionalidad, estatura_m, peso_kg, color_ojos, color_cabello,
              senas_particulares, departamento, provincia, monto_recompensa`;

async function searchOne(column, embedding, k) {
  const vec = '[' + embedding.join(',') + ']';
  const { rows } = await getPool().query(
    `select ${FICHA_FIELDS}, 1 - (${column} <=> $1::vector) as similitud
       from rostros
      where ${column} is not null
      order by ${column} <=> $1::vector
      limit $2`,
    [vec, k]
  );
  return rows;
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const { embedding, embeddingAntelope, limit } = await req.json();
    const k = Math.min(Math.max(Number(limit) || 5, 1), 20);
    const bad = (e) => !Array.isArray(e) || e.length !== 512;
    if (embedding === undefined && embeddingAntelope === undefined) {
      return Response.json({ error: 'Se espera "embedding" (buffalo_l) y/o "embeddingAntelope" (antelopev2): arreglos de 512 números.' }, { status: 400 });
    }
    if (embedding !== undefined && bad(embedding)) return Response.json({ error: '"embedding" debe tener 512 números.' }, { status: 400 });
    if (embeddingAntelope !== undefined && bad(embeddingAntelope)) return Response.json({ error: '"embeddingAntelope" debe tener 512 números.' }, { status: 400 });

    const result = {};
    if (embedding !== undefined) result.buffalo_l = await searchOne('embedding', embedding, k);
    if (embeddingAntelope !== undefined) result.antelopev2 = await searchOne('embedding_antelope', embeddingAntelope, k);
    // compatibilidad: si solo se pidió un modelo, también se expone como "matches"
    result.matches = result.buffalo_l || result.antelopev2 || [];
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};
