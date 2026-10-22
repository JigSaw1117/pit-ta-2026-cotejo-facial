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

## Mejoras (rama `mejoras-cotejo-condicionado`)

Cambios para que el modo **Comparar** sirva con un dubitado de CCTV encapuchado. Todo sigue corriendo en el navegador.

| Mejora | Qué hace | Dónde |
|---|---|---|
| Parte baja tapada | Tapa boca y mentón (filas ≥ 66 del rostro alineado 112×112, gris 120) en la evidencia, en las referencias y en las fichas, para comparar en las mismas condiciones que la capucha | `js/faceengine.js` (`analyze(..., { tapar })`), paso 5 de la página |
| Plantilla de varios fotogramas | Si subes varias evidencias, toma el rostro más grande de cada una y promedia los vectores ponderando por DIP × score | `plantilla()` |
| Detección en cascada | 640 px; si no hay rostro, con un margen negro del 25 % (fichas recortadas al ras); si aún no, 1280 px (rostros chicos) | `detectarCascada()` |
| Calibración con la propia base | Compara la evidencia contra las 789 fichas de `gallery/` (personas distintas): puesto, cuántas la superan, TMR con pares genuinos y **RV prudente** = TMR / FMR superior al 95 % (regla de tres o Wilson), con la escala verbal ENFSI 2015. Reemplaza los umbrales fijos 0,2 / 0,3 / 0,4 / 0,55 cuando está activada | `cargarCalibracion()`, `calibrar()`, `scripts/calibrar_galeria.py` |

**Uso:** en Comparar, sube los fotogramas del sujeto (varios a la vez), las referencias, marca «Parte baja del rostro tapada» si el dubitado lleva capucha y deja activada «Calibrar con la base de fichas». La primera vez la página calcula los vectores de las 789 fichas (unos minutos por modelo) y los guarda en IndexedDB; después es inmediato.

**Archivos de calibración** (`gallery/calib/`, se generan una vez con `python scripts/calibrar_galeria.py models`):
- `puntos.json`: los 5 puntos faciales de cada miniatura (789 de 791 con rostro).
- `genuinas.json`: 592 similitudes de 74 pares de la misma persona (fichas de Interpol con 2 o más fotos), con una foto degradada a calidad de video (DIP 25–55 px, desenfoque, JPEG 25–60, gamma).
Ninguno guarda embeddings, igual que el resto del repositorio.

**Prueba con los 8 fotogramas del caso** (referencia F-11 frontal):
- Antes: cada fotograma contra cada referencia (24 parejas por modelo), coseno −0,01 a 0,30; todo «Sin apoyo» o «No concluyente» salvo una pareja en «Apoyo limitado» con ResNet100.
- Después, ResNet100 (antelopev2), plantilla de 8 fotogramas, parte baja tapada: puesto **1 de 790**, ninguna ficha la supera, RV prudente **203** («apoyo moderadamente fuerte»). Con ResNet50: puesto 4 de 790, RV 74 («apoyo moderado»).

**Límites:** las genuinas son fotos de ficha degradadas, no video real; la RV depende de solo 789 fichas (la menor FMR medible es 3/789); la búsqueda en la base pública (Neon) sigue usando los vectores del servidor, sin tapar. Estatura: la app no la mide; la proporción simple con la chapa de 101 cm dio 200,6 cm frente a 170 cm reales (+18 %), por eso conviene usar la altura de la cámara (2,36 m) con la razón cruzada Z/Zc = |t−b|·|i−v| / (|i−b|·|t−v|).
