-- Esquema de Neon para la galería de cotejo (PIT-TA-2026).
-- Ejecutar una vez, en el editor SQL de Neon o con: node load-neon.mjs --schema

create extension if not exists vector;

create table if not exists rostros (
  id text primary key,
  fuente text not null,        -- 'PNP' o 'INTERPOL'
  nombre text,
  delito text,
  lugar text,
  url_ficha text,
  thumb text,                  -- ruta relativa servida por el propio sitio, p.ej. gallery/thumbs/pnp-123.webp
  dip real,                    -- distancia interpupilar medida en la ficha original
  embedding vector(512),       -- ArcFace ResNet50 (buffalo_l), mismo modelo que corre en el navegador
  sexo text,
  fecha_nacimiento text,       -- solo INTERPOL
  nacionalidad text,           -- solo INTERPOL
  estatura_m real,             -- solo INTERPOL, cuando el CSV la trae
  peso_kg real,                -- solo INTERPOL, cuando el CSV lo trae
  color_ojos text,             -- solo INTERPOL
  color_cabello text,          -- solo INTERPOL
  senas_particulares text,     -- solo INTERPOL
  departamento text,           -- solo PNP
  provincia text,              -- solo PNP
  monto_recompensa real        -- solo PNP
);

-- Si la tabla ya existía de antes (sin estas columnas), añadirlas sin perder lo cargado:
alter table rostros add column if not exists sexo text;
alter table rostros add column if not exists fecha_nacimiento text;
alter table rostros add column if not exists nacionalidad text;
alter table rostros add column if not exists estatura_m real;
alter table rostros add column if not exists peso_kg real;
alter table rostros add column if not exists color_ojos text;
alter table rostros add column if not exists color_cabello text;
alter table rostros add column if not exists senas_particulares text;
alter table rostros add column if not exists departamento text;
alter table rostros add column if not exists provincia text;
alter table rostros add column if not exists monto_recompensa real;

create index if not exists rostros_embedding_idx
  on rostros using hnsw (embedding vector_cosine_ops);
