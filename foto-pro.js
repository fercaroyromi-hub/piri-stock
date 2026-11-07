// Pirí Stock · foto profesional automática
// Recorta el producto, corrige luz y color, y lo pone centrado sobre fondo blanco con una sombra suave.
// El recorte usa un modelo de IA que corre en el mismo celular (se descarga la primera vez).

const LADO = 1200;           // foto final cuadrada 1200 × 1200
const MARGEN = 0.12;         // aire alrededor del producto

let _quitar = null;
async function quitarFondo(blob, avance) {
  try { return await recortar(blob, avance, 'medium'); }           // el de mejor calidad
  catch (e) { console.warn('[fotoPro] medium falló, uso el liviano', e); return recortar(blob, avance, 'small'); }
}
async function recortar(blob, avance, modelo) {
  if (!_quitar) _quitar = (await import('./vendor/bgremoval.js')).removeBackground;
  return _quitar(blob, {
    model: modelo,
    output: { format: 'image/png', quality: 1 },
    progress: (k, hecho, total) => {
      if (!avance) return;
      if (k.startsWith('fetch')) avance('Descargando el recortador (solo la primera vez)…', total ? hecho / total : 0);
      else avance('Recortando el producto…', null);
    }
  });
}

function cargar(src) {
  return new Promise((ok, mal) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => mal(new Error('No pude abrir la foto'));
    im.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  });
}
function lienzo(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function achicar(im, max) {
  const k = Math.min(1, max / Math.max(im.naturalWidth || im.width, im.naturalHeight || im.height));
  const c = lienzo(Math.round((im.naturalWidth || im.width) * k), Math.round((im.naturalHeight || im.height) * k));
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  return c;
}
const aBlob = (c, tipo, q) => new Promise(ok => c.toBlob(ok, tipo, q));

// ---------- corrección de luz y color (solo sobre el producto) ----------
function percentil(hist, total, p) { let a = 0; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= total * p) return i; } return 255; }
function mejorar(c) {
  // Corrección SUAVE: la foto del celular suele estar bien; solo emparejamos luz y sacamos el tinte de la lámpara.
  const x = c.getContext('2d', { willReadFrequently: true }), d = x.getImageData(0, 0, c.width, c.height), a = d.data;
  const L = new Uint32Array(256);
  let n = 0, gr = 0, gg = 0, gb = 0, gn = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] < 200) continue;
    const r = a[i], g = a[i + 1], b = a[i + 2], l = (r * 77 + g * 150 + b * 29) >> 8;
    L[l]++; n++;
    if (Math.max(r, g, b) - Math.min(r, g, b) < 40 && l > 60 && l < 245) { gr += r; gg += g; gb += b; gn++; } // zonas grises/neutras
  }
  if (n < 50) return c;
  // 1) balance de blancos con las zonas neutras (metal, blanco, gris): saca el tinte amarillo/azul de la luz
  let wb = [1, 1, 1];
  // promedio general del producto
  let ar = 0, ag = 0, ab = 0;
  for (let i = 0; i < a.length; i += 16) if (a[i + 3] >= 200) { ar += a[i]; ag += a[i + 1]; ab += a[i + 2]; }
  const am = (ar + ag + ab) / 3, gw = [am / ar, am / ag, am / ab];
  // ¿el producto es "sin color" (plateado, acero, blanco, negro)? → se mide la saturación ya sin el tinte de la luz
  let sat = 0, cnt = 0;
  for (let i = 0; i < a.length; i += 16) {
    if (a[i + 3] < 200) continue;
    const r = a[i] * gw[0], g = a[i + 1] * gw[1], b = a[i + 2] * gw[2];
    sat += Math.max(r, g, b) - Math.min(r, g, b); cnt++;
  }
  if (cnt && sat / cnt < 28) wb = gw.map(v => Math.max(0.75, Math.min(1.35, v)));           // neutro: tinte fuera del todo
  else if (gn > n * 0.05) { const m = (gr + gg + gb) / 3; wb = [gr, gg, gb].map(s => Math.max(0.9, Math.min(1.1, 1 + (m / s - 1) * 0.8))); }
  // 2) luz: si está oscura se aclara; los blancos se llevan a casi blanco sin quemar
  const p1 = percentil(L, n, 0.01), p99 = percentil(L, n, 0.995), med = percentil(L, n, 0.5);
  const lo = Math.min(p1 * 0.5, 40), hi = Math.max(Math.min(p99, 252), lo + 80);
  // sobre fondo blanco el producto tiene que verse luminoso: llevar la luz media a ~58 %
  const rel = Math.max(0.05, Math.min(0.95, (med - lo) / (hi - lo)));
  const expo = rel < 0.56 ? Math.max(0.55, Math.log(0.58) / Math.log(rel)) : 1; // < 1 aclara los medios tonos
  const T = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    let y = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    y = Math.pow(y, expo);
    y = y + 0.05 * Math.sin(Math.PI * (y - 0.5)) * (1 - Math.abs(2 * y - 1)); // contraste muy suave
    T[v] = Math.max(0, Math.min(255, y * 255));
  }
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0) continue;
    const r = Math.min(255, a[i] * wb[0]), g = Math.min(255, a[i + 1] * wb[1]), b = Math.min(255, a[i + 2] * wb[2]);
    const r2 = T[r | 0], g2 = T[g | 0], b2 = T[b | 0], m = (r2 + g2 + b2) / 3, s = 1.05;
    a[i] = m + (r2 - m) * s; a[i + 1] = m + (g2 - m) * s; a[i + 2] = m + (b2 - m) * s;
  }
  x.putImageData(d, 0, 0);
  return enfocar(c, 0.3);
}
// nitidez (máscara de enfoque)
function enfocar(c, k) {
  const w = c.width, h = c.height, x = c.getContext('2d');
  const d = x.getImageData(0, 0, w, h), a = d.data, o = new Uint8ClampedArray(a);
  for (let y = 1; y < h - 1; y++) for (let X = 1; X < w - 1; X++) {
    const i = (y * w + X) * 4; if (a[i + 3] < 128) continue;
    for (let ch = 0; ch < 3; ch++) {
      const j = i + ch;
      const blur = (o[j - 4] + o[j + 4] + o[j - w * 4] + o[j + w * 4] + o[j] * 4) / 8;
      a[j] = o[j] + (o[j] - blur) * k * 2;
    }
  }
  x.putImageData(d, 0, 0);
  return c;
}
// deja solo las partes grandes (el producto) y borra manchas sueltas del fondo
function limpiarManchas(a, w, h) {
  const k = Math.max(1, Math.round(Math.max(w, h) / 320)), W = Math.ceil(w / k), H = Math.ceil(h / k);
  const m = new Uint8Array(W * H);
  for (let y = 0; y < h; y += k) for (let x = 0; x < w; x += k) if (a[(y * w + x) * 4 + 3] > 128) m[(y / k | 0) * W + (x / k | 0)] = 1;
  const lab = new Int32Array(W * H), areas = [0], pila = [];
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || lab[i]) continue;
    n++; let area = 0; pila.push(i); lab[i] = n;
    while (pila.length) {
      const j = pila.pop(); area++;
      const X = j % W, Y = (j / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const xx = X + dx, yy = Y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx; if (m[q] && !lab[q]) { lab[q] = n; pila.push(q); }
      }
    }
    areas.push(area);
  }
  if (n < 2) return;
  const max = Math.max(...areas), sirve = areas.map(v => v >= max * 0.06);
  // dilatar un poco lo que se queda, para no comer bordes finos (bombillas, tapas)
  const ok = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (lab[i] && sirve[lab[i]]) { const X = i % W, Y = (i / W) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = X + dx, yy = Y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) ok[yy * W + xx] = 1; } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!ok[(y / k | 0) * W + (x / k | 0)]) a[(y * w + x) * 4 + 3] = 0;
}
// bordes limpios: saca el "halo" del fondo y deja un contorno suave
function pulirBordes(a, w, h) {
  const A = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) { const v = a[i * 4 + 3]; A[i] = v <= 110 ? 0 : v >= 225 ? 255 : (v - 110) * 255 / 115; }
  // achicar 1 px el contorno (ahí vive el halo oscuro del fondo)
  const E = new Uint8ClampedArray(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; let m = A[i];
    if (m) { m = Math.min(m, A[i - 1], A[i + 1], A[i - w], A[i + w]); }
    E[i] = m;
  }
  // devolver a los píxeles del borde el color del interior cercano (sin restos del fondo)
  const R = 3;
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) {
    const i = y * w + x; if (!E[i] || E[i] === 255 && A[i - 2] === 255 && A[i + 2] === 255 && A[i - 2 * w] === 255 && A[i + 2 * w] === 255) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const j = i + dy * w + dx; if (A[j] === 255) { let ok = true; for (const k of [j - 1, j + 1, j - w, j + w]) if (A[k] !== 255) { ok = false; break; } if (ok) { r += a[j * 4]; g += a[j * 4 + 1]; b += a[j * 4 + 2]; n++; } } }
    if (n) { const p = i * 4, f = 0.65; a[p] = a[p] * (1 - f) + r / n * f; a[p + 1] = a[p + 1] * (1 - f) + g / n * f; a[p + 2] = a[p + 2] * (1 - f) + b / n * f; }
  }
  // suavizado leve del contorno
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    a[i * 4 + 3] = (E[i] * 4 + E[i - 1] + E[i + 1] + E[i - w] + E[i + w]) / 8;
  }
}
// caja del producto: limpia restos sueltos del fondo y busca dónde está el producto
function caja(c) {
  const w = c.width, h = c.height, x = c.getContext('2d', { willReadFrequently: true });
  const d = x.getImageData(0, 0, w, h), a = d.data;
  for (let i = 3; i < a.length; i += 4) if (a[i] < 60) a[i] = 0; // bruma casi transparente → fuera
  limpiarManchas(a, w, h);
  pulirBordes(a, w, h);
  x.putImageData(d, 0, 0);
  const fil = new Uint32Array(h), col = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) if (a[(y * w + X) * 4 + 3] > 128) { fil[y]++; col[X]++; }
  const mf = Math.max(3, w * 0.006), mc = Math.max(3, h * 0.006);
  let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
  while (y0 < h && fil[y0] < mf) y0++; while (y1 > y0 && fil[y1] < mf) y1--;
  while (x0 < w && col[x0] < mc) x0++; while (x1 > x0 && col[x1] < mc) x1--;
  if (y0 >= y1 || x0 >= x1) return null;
  // lo que quedó fuera de la caja se borra (manchitas sueltas)
  for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) if (y < y0 || y > y1 || X < x0 || X > x1) a[(y * w + X) * 4 + 3] = 0;
  x.putImageData(d, 0, 0);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
// armar la foto final: fondo blanco, producto centrado, sombra suave abajo
function componer(prod, b) {
  const f = lienzo(LADO, LADO), x = f.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, LADO, LADO);
  const util = LADO * (1 - 2 * MARGEN), k = Math.min(util / b.w, util / b.h);
  const w = b.w * k, h = b.h * k, px = (LADO - w) / 2, py = (LADO - h) / 2 + LADO * 0.02;
  // sombra de apoyo
  const sx = LADO / 2, sy = py + h - h * 0.012, rx = w * 0.46, ry = Math.max(8, w * 0.06);
  const g = x.createRadialGradient(sx, sy, 0, sx, sy, rx);
  g.addColorStop(0, 'rgba(0,0,0,0.20)'); g.addColorStop(0.55, 'rgba(0,0,0,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.save(); x.translate(sx, sy); x.scale(1, ry / rx); x.translate(-sx, -sy);
  x.fillStyle = g; x.beginPath(); x.arc(sx, sy, rx, 0, Math.PI * 2); x.fill(); x.restore();
  // sombra de contacto suave
  x.save(); x.shadowColor = 'rgba(0,0,0,0.16)'; x.shadowBlur = LADO * 0.03; x.shadowOffsetY = LADO * 0.012;
  x.drawImage(prod, b.x, b.y, b.w, b.h, px, py, w, h); x.restore();
  return f;
}
// versión sin recorte: solo mejora luz y color, cuadrada
function cuadrada(c) {
  const f = lienzo(LADO, LADO), x = f.getContext('2d'), s = Math.min(c.width, c.height);
  x.fillStyle = '#fff'; x.fillRect(0, 0, LADO, LADO);
  x.drawImage(c, (c.width - s) / 2, (c.height - s) / 2, s, s, 0, 0, LADO, LADO);
  return f;
}

/**
 * Convierte una foto cualquiera en foto de catálogo.
 * Devuelve { pro, simple, recortada } — blobs JPEG (pro = fondo blanco; simple = original mejorada).
 */
export async function fotoProfesional(file, avance) {
  const im = await cargar(file);
  const base = achicar(im, 1024); // la IA trabaja a 1024 px: menos memoria
  avance && avance('Preparando la foto…', null);
  const simple = await aBlob(cuadrada(mejorar(achicar(im, 1600))), 'image/jpeg', 0.9);
  let pro = null, recortada = false;
  try {
    const png = await quitarFondo(await aBlob(base, 'image/png'), avance);
    avance && avance('Corrigiendo luz y color…', null);
    const cut = achicar(await cargar(png), 1600);
    const b = caja(cut);
    if (b && b.w * b.h > cut.width * cut.height * 0.02) {
      pro = await aBlob(componer(mejorar(cut), b), 'image/jpeg', 0.9);
      recortada = true;
    }
  } catch (e) { console.warn('[fotoPro] sin recorte:', e); }
  return { pro: pro || simple, simple, recortada };
}
