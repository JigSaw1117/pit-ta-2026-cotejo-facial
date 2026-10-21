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
  embedding vector(512)        -- ArcFace ResNet50 (buffalo_l), mismo modelo que corre en el navegador
);

create index if not exists rostros_embedding_idx
  on rostros using hnsw (embedding vector_cosine_ops);
