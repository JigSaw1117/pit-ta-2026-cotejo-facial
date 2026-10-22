"""Calibración del cotejo con la propia base de fichas (gallery/), en local, una sola vez.

Genera en gallery/calib/ dos archivos sin ningún embedding (ver .gitignore):
  puntos.json    los 5 puntos faciales de cada miniatura (para que el navegador alinee sin volver a detectar).
  genuinas.json  similitudes de pares de la MISMA persona (fichas de Interpol con 2 o más fotos):
                 una foto llevada a calidad de video (DIP 25–55 px, desenfoque, JPEG fuerte, gamma),
                 detectada de nuevo, contra la otra intacta. Dan la tasa de aciertos (TMR, ISO/IEC 19795-1)
                 con la que la página calcula la razón de verosimilitud.
Mismos modelos y mismo alineado de 5 puntos que js/faceengine.js; detector a 640 px y, si no encuentra
rostro, de nuevo a 1280 px (igual que la página).

Uso: python calibrar_galeria.py [carpeta_models]     (por defecto ../models, con buffalo_l/ y antelopev2/)
Requiere: onnxruntime, opencv-python, numpy.
"""
import sys, os, re, json
import numpy as np, cv2, onnxruntime as ort

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MOD = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "models")
ARC = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]], np.float32)
Y_TAPA, GRIS = 66, 120                      # igual que js/faceengine.js: parte baja tapada en el espacio alineado
PROV = ["CUDAExecutionProvider", "CPUExecutionProvider"] if "CUDAExecutionProvider" in ort.get_available_providers() else ["CPUExecutionProvider"]
if PROV[0].startswith("CUDA") and hasattr(ort, "preload_dlls"):
    ort.preload_dlls()
ses = lambda p: ort.InferenceSession(os.path.join(MOD, p), providers=PROV)
DET = {640: ses("buffalo_l/det_10g.onnx"), 1280: ses("buffalo_l/det_10g.onnx")}
REC = {"buffalo_l": ses("buffalo_l/w600k_r50.onnx"), "antelopev2": ses("antelopev2/glintr100.onnx")}


def _detectar(bgr, size, umbral):
    det = DET[size]
    h, w = bgr.shape[:2]; esc = size / max(h, w)
    lienzo = np.zeros((size, size, 3), np.uint8); lienzo[:round(h * esc), :round(w * esc)] = cv2.resize(bgr, (round(w * esc), round(h * esc)))
    out = det.run(None, {det.get_inputs()[0].name: cv2.dnn.blobFromImage(lienzo, 1 / 128, (size, size), (127.5,) * 3, swapRB=True)})
    best = None
    for i, st in enumerate((8, 16, 32)):
        sc, bb, kp = out[i][:, 0], out[i + 3] * st, out[i + 6] * st
        n = size // st; cy, cx = np.mgrid[:n, :n]
        cen = np.repeat(np.stack([cx, cy], -1).reshape(-1, 2).astype(np.float32) * st, 2, axis=0)
        for j in np.where(sc >= umbral)[0]:
            area = (bb[j, 0] + bb[j, 2]) * (bb[j, 1] + bb[j, 3])
            if best is None or area > best[0]:
                best = (area, float(sc[j]), (kp[j].reshape(5, 2) + cen[j]) / esc)
    return None if best is None else {"score": best[1], "kps": best[2]}


def detectar(bgr, umbral=0.3):
    """El rostro más grande, en cascada como la página: 640 px; si no hay rostro, con un margen negro del 25 %
    (fichas recortadas al ras del rostro, donde SCRFD no tiene contexto); si aún no, 1280 px (rostros chicos)."""
    d = _detectar(bgr, 640, umbral)
    if d is None:
        m = round(0.25 * max(bgr.shape[:2]))
        d = _detectar(cv2.copyMakeBorder(bgr, m, m, m, m, cv2.BORDER_CONSTANT, value=0), 640, umbral)
        if d is not None:
            d["kps"] = d["kps"] - m
    return d or _detectar(bgr, 1280, umbral)


def similitud(src, dst):
    """Similaridad de mínimos cuadrados (rotación + escala + traslación), la misma de similarity() en js/faceengine.js."""
    ms, md = src.mean(0), dst.mean(0); s, d = src - ms, dst - md
    den = (s ** 2).sum(); zr = (s * d).sum() / den; zi = (s[:, 0] * d[:, 1] - s[:, 1] * d[:, 0]).sum() / den
    t = md - np.array([zr * ms[0] - zi * ms[1], zi * ms[0] + zr * ms[1]])
    return np.array([[zr, -zi, t[0]], [zi, zr, t[1]]], np.float32)


def vector(pack, bgr, kps, tapar):
    a = cv2.warpAffine(bgr, similitud(kps.astype(np.float64), ARC.astype(np.float64)), (112, 112), flags=cv2.INTER_LINEAR, borderValue=0)
    if tapar:
        a[Y_TAPA:, :] = GRIS
    r = REC[pack]; v = r.run(None, {r.get_inputs()[0].name: cv2.dnn.blobFromImage(a, 1 / 127.5, (112, 112), (127.5,) * 3, swapRB=True)})[0][0]
    return v / np.linalg.norm(v)


def degradar(im, dip, rng):
    e = rng.uniform(25, 55) / dip
    p = cv2.resize(im, None, fx=e, fy=e, interpolation=cv2.INTER_AREA)
    p = cv2.GaussianBlur(p, (0, 0), rng.uniform(0.4, 1.4))
    p = cv2.imdecode(cv2.imencode(".jpg", p, [cv2.IMWRITE_JPEG_QUALITY, int(rng.uniform(25, 60))])[1], 1)
    return np.clip(255 * (p / 255.0) ** rng.uniform(0.7, 1.4), 0, 255).astype(np.uint8)


if __name__ == "__main__":
    persona = lambda i: re.sub(r"-\d+$", "", i) if i.startswith("interpol") else i   # interpol-AAAA_NNNN-k: k-ésima foto
    meta = json.load(open(os.path.join(RAIZ, "gallery", "meta.json"), encoding="utf-8"))
    puntos, img = [], {}
    for m in meta:
        im = cv2.imdecode(np.fromfile(os.path.join(RAIZ, m["thumb"]), np.uint8), cv2.IMREAD_COLOR)
        d = detectar(im) if im is not None else None
        if d is None:
            continue
        dip = float(np.linalg.norm(d["kps"][1] - d["kps"][0]))
        puntos.append({"id": m["id"], "persona": persona(m["id"]), "kps": d["kps"].round(2).tolist(), "dip": round(dip, 1)})
        img[m["id"]] = (im, d["kps"], dip)
    os.makedirs(os.path.join(RAIZ, "gallery", "calib"), exist_ok=True)
    json.dump(puntos, open(os.path.join(RAIZ, "gallery", "calib", "puntos.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print("miniaturas con rostro:", len(puntos), "de", len(meta), "· personas:", len({p["persona"] for p in puntos}))

    grupos = {}
    for p in puntos:
        grupos.setdefault(p["persona"], []).append(p["id"])
    pares = [(a, b) for ids in grupos.values() if len(ids) > 1 for a in ids for b in ids if a != b]
    rng = np.random.default_rng(31); G = {pk: {"sin_tapar": [], "tapado": []} for pk in REC}; fta = 0; REP = 8
    for a, b in pares:
        ima, ka, da = img[a]; imb, kb, _ = img[b]
        for _ in range(REP):
            p = degradar(ima, da, rng); d = detectar(p)
            if d is None:
                fta += 1; continue
            for pk in REC:
                for var, tap in (("sin_tapar", False), ("tapado", True)):
                    G[pk][var].append(round(float(vector(pk, p, d["kps"], tap) @ vector(pk, imb, kb, tap)), 4))
    G = {pk: {v: sorted(x) for v, x in d.items()} for pk, d in G.items()}
    json.dump({"protocolo": "pares de la misma persona (Interpol, 2 o más fotos); una foto degradada a calidad de video y detectada de nuevo, contra la otra intacta",
               "pares": len(pares), "repeticiones": REP, "personas": sum(1 for v in grupos.values() if len(v) > 1),
               "fta": round(fta / max(1, len(pares) * REP), 4), "semilla": 31, **G},
              open(os.path.join(RAIZ, "gallery", "calib", "genuinas.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print("pares genuinos:", len(pares), "· muestras:", len(G["buffalo_l"]["tapado"]), "· FTA:", fta)
    for pk in G:
        print(pk, {v: np.percentile(x, [5, 50, 95]).round(3).tolist() for v, x in G[pk].items()})
