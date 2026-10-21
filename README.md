# Cotejo facial — PIT-TA-2026

Herramienta de apoyo para la pericia de identificación (expediente PIT-TA-2026). Corre en el navegador con ONNX Runtime Web (SCRFD + ArcFace ResNet50, paquete `buffalo_l` de InsightFace); ninguna imagen se sube a un servidor.

**Demo en vivo:** https://pit-ta-2026-cotejo.netlify.app

## Dos modos

1. **Comparar con una referencia** — subes dos imágenes y las comparas entre sí. Todo ocurre en tu navegador.
2. **Buscar en la base pública** — subes una foto, un fotograma o un video, y el programa la compara contra fichas públicas de requisitoriados de la **PNP** y **Interpol** (listados que ellos mismos publican para identificación pública). La comparación corre en una función serverless (Netlify Functions) contra una base vectorial en **Neon** (Postgres + `pgvector`); el navegador nunca ve la base completa, solo el resultado.

En ambos modos, el resultado se expresa en **escala verbal** (nunca en porcentaje) y nunca se presenta como una identificación: toda coincidencia debe verificarse manualmente.

## Estructura

| Carpeta/archivo | Qué es |
|---|---|
| `index.html` | La página (UI, visor, resultados) |
| `js/faceengine.js` | Detección (SCRFD) + embedding (ArcFace), caché en IndexedDB |
| `models/buffalo_l/` | Los dos `.onnx` que se descargan al navegador (~184 MB, una sola vez) |
| `netlify/functions/search.mjs` | Función serverless: recibe un embedding, consulta Neon, devuelve las fichas más parecidas |
| `scripts/build-gallery.mjs` | Procesa las fotos de PNP/Interpol **en local** (nunca en la nube): detecta el rostro, genera miniatura y embedding |
| `scripts/load-neon.mjs` | Carga lo anterior a Neon |
| `scripts/schema.sql` | Esquema de la tabla `rostros` en Neon |
| `gallery/thumbs/` | Miniaturas de las fichas (se despliegan; las fotos originales y el CSV **no** se suben a este repositorio) |

## Modelos (`models/buffalo_l/*.onnx`)

No están en este repositorio: pesan más de 100 MB y GitHub los rechaza sin Git LFS. Se descargan del propio release de InsightFace y se despliegan a Netlify directo (`netlify deploy`), sin pasar por git:

- `models/buffalo_l/det_10g.onnx` y `w600k_r50.onnx` — del paquete `buffalo_l` en [github.com/deepinsight/insightface/releases](https://github.com/deepinsight/insightface/releases) (ver `model-zoo`). Licencia de los pesos: solo investigación no comercial.

## Poner en marcha la base de búsqueda (una sola vez)

```bash
cd scripts
npm install
node build-gallery.mjs          # procesa las fotos locales -> gallery/meta.json + embeddings.ndjson
set DATABASE_URL=postgresql://...   # tu cadena de conexión de Neon (PowerShell: $env:DATABASE_URL="...")
node load-neon.mjs --schema     # crea la tabla una sola vez
node load-neon.mjs              # carga las fichas
```

En Netlify, configura la misma variable `DATABASE_URL` (Site settings → Environment variables, o `netlify env:set DATABASE_URL "..."`).

## Desarrollo local

```bash
npm install        # instala la dependencia de la función (@neondatabase/serverless)
netlify dev         # sirve la página + las funciones con las variables de entorno de Netlify
```

## Qué no está normado

La regla de calidad (distancia interpupilar) no sigue una norma peruana ni latinoamericana — no existe una para esto. Cada umbral cita su fuente real (ver el panel "Qué mide esta herramienta" en la propia página).
