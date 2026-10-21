# Respaldo local — por si Netlify no carga

Esta carpeta es una copia exacta de lo que está publicado en:
**https://pit-ta-2026-cotejo.netlify.app**

Sirve para usarla sin internet (salvo la primera vez, que necesita red para traer la librería ONNX Runtime desde su CDN) o si el sitio de Netlify se cae.

## Cómo usarla

1. Necesitas [Node.js](https://nodejs.org) instalado (cualquier versión reciente).
2. Haz doble clic en **`iniciar-local.bat`**.
3. Espera a que diga `Accepting connections at http://localhost:5173`.
4. Abre esa dirección en el navegador.
5. Para cerrar, cierra la ventana negra que se abrió.

## Qué trae

- `index.html`, `js/faceengine.js` — la página y el motor de cotejo.
- `models/buffalo_l/` — los dos archivos `.onnx` (detector + reconocedor), ~184 MB.

Es la misma versión que la de Netlify; cualquier arreglo que se haga en una hay que copiarlo a la otra.

## Para repartirla al equipo

Comprime toda esta carpeta en un `.zip` y compártela por Drive. Pesa cerca de 190 MB.
