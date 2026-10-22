// Agrega un promedio nacional de estatura/peso como REFERENCIA, solo cuando la ficha no trae
// su propia medición. Nunca se guarda en estatura_m/peso_kg (el dato real), sino en columnas
// aparte (estatura_ref_m, peso_ref_kg), para que no se puedan confundir con una medición real.
//
// Fuente: NCD-RisC, "A century of trends in adult human height" (eLife, 2016) y el estudio
// complementario de IMC/peso del mismo consorcio — promedio de hombre adulto por país, cifras
// aproximadas tomadas de la publicación. Si se necesita precisión, revisar la fuente directa
// en https://www.ncdrisc.org/ antes de citarlas en el informe.
//
// Uso: set DATABASE_URL=... && node add-reference-averages.mjs
import { Pool } from '@neondatabase/serverless';

// { código país ISO-3166 alpha-2 usado en el CSV : [estatura_m, peso_kg] de hombre adulto promedio }
const PROMEDIOS = {
  BO: [1.60, 64], // Bolivia
  VE: [1.69, 77], // Venezuela
  PE: [1.65, 67], // Perú
  CL: [1.69, 77], // Chile
  ES: [1.74, 82], // España
  GR: [1.75, 85], // Grecia
  UY: [1.73, 78], // Uruguay
  US: [1.76, 89], // Estados Unidos
};

function primerPais(nacionalidad) {
  return (nacionalidad || '').split(';')[0]?.trim().toUpperCase();
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('Falta DATABASE_URL.'); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const { rows } = await pool.query(
    `select id, nacionalidad from rostros where fuente='INTERPOL' and (estatura_m is null or peso_kg is null)`
  );
  console.log(`${rows.length} fichas de Interpol sin estatura y/o peso propio.`);

  let actualizadas = 0, sinPais = 0;
  for (const r of rows) {
    const pais = primerPais(r.nacionalidad);
    const prom = PROMEDIOS[pais];
    if (!prom) { sinPais++; continue; }
    await pool.query('update rostros set estatura_ref_m=$2, peso_ref_kg=$3 where id=$1', [r.id, prom[0], prom[1]]);
    actualizadas++;
  }
  console.log(`Referencia agregada: ${actualizadas}. Sin país reconocido: ${sinPais}.`);
  console.log('Nota: estatura_ref_m / peso_ref_kg son promedios nacionales, no mediciones de la persona.');
  await pool.end();
}

main();
