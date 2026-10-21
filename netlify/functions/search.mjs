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

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const { embedding, limit } = await req.json();
    if (!Array.isArray(embedding) || embedding.length !== 512) {
      return Response.json({ error: 'Se espera "embedding": un arreglo de 512 números.' }, { status: 400 });
    }
    const vec = '[' + embedding.join(',') + ']';
    const k = Math.min(Math.max(Number(limit) || 5, 1), 20);
    const { rows } = await getPool().query(
      `select id, fuente, nombre, delito, lugar, url_ficha, thumb, dip,
              1 - (embedding <=> $1::vector) as similitud
         from rostros
        order by embedding <=> $1::vector
        limit $2`,
      [vec, k]
    );
    return Response.json({ matches: rows });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};
