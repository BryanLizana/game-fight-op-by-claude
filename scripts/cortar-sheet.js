'use strict';

// Corta la hoja de sprites de un personaje generada por IA.
// Uso:  node scripts/cortar-sheet.js <personaje>
// Lee   info/<personaje>-sheet.png
// Deja  public/sprites/<personaje>/<personaje>_f{fila}c{columna}.png
//
// Qué hace: quita el fondo (flood fill desde los bordes + limpieza global
// tomando el color de las esquinas) y separa las poses detectando bandas
// de píxeles opacos (no depende de una grilla exacta).

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const personaje = process.argv[2];
const MAX_COLS = Number(process.argv[3]) || 3; // columnas máximas por fila
if (!personaje) {
  console.error('Uso: node scripts/cortar-sheet.js <personaje> [columnas]   (ej: zoro 3)');
  process.exit(1);
}

const RAIZ = path.join(__dirname, '..');
const entrada = path.join(RAIZ, 'info', `${personaje}-sheet.png`);
if (!fs.existsSync(entrada)) {
  console.error('No existe:', entrada);
  process.exit(1);
}

const png = PNG.sync.read(fs.readFileSync(entrada));
const { width: W, height: H, data } = png;

const idx = (x, y) => (y * W + x) * 4;
const dist2 = (i, c) => {
  const dr = data[i] - c[0], dg = data[i + 1] - c[1], db = data[i + 2] - c[2];
  return dr * dr + dg * dg + db * db;
};

// Color de fondo: promedio de las 4 esquinas
const esquinas = [idx(2, 2), idx(W - 3, 2), idx(2, H - 3), idx(W - 3, H - 3)];
const bg = [0, 1, 2].map((k) => Math.round(esquinas.reduce((a, i) => a + data[i + k], 0) / 4));
console.log('color de fondo:', bg);

// Tolerancias opcionales por CLI: node cortar-sheet.js <pj> [cols] [flood] [global]
const TOL_GLOBAL = Math.pow(Number(process.argv[5]) || 42, 2);  // píxeles casi idénticos al fondo
const TOL_FLOOD = Math.pow(Number(process.argv[4]) || 88, 2);   // gradientes/sombras conectados al borde

for (let i = 0; i < data.length; i += 4) {
  if (data[i + 3] > 0 && dist2(i, bg) < TOL_GLOBAL) data[i + 3] = 0;
}

const cola = [];
for (let x = 0; x < W; x++) cola.push([x, 0], [x, H - 1]);
for (let y = 0; y < H; y++) cola.push([0, y], [W - 1, y]);
while (cola.length) {
  const [x, y] = cola.pop();
  if (x < 0 || y < 0 || x >= W || y >= H) continue;
  const i = idx(x, y);
  if (data[i + 3] === 0) {
    if (data[i] === 255 && data[i + 1] === 254) continue; // ya visitado
    data[i] = 255; data[i + 1] = 254;
    cola.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    continue;
  }
  if (dist2(i, bg) < TOL_FLOOD) {
    data[i + 3] = 0; data[i] = 255; data[i + 1] = 254;
    cola.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

// ---- Segmentación por proyección de alfa ----
const filasAlfa = new Array(H).fill(0);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[idx(x, y) + 3] > 40) filasAlfa[y]++;

function bandas(proj, min, gapMin) {
  const b = [];
  let ini = -1;
  for (let i = 0; i < proj.length; i++) {
    if (proj[i] > min) { if (ini < 0) ini = i; }
    else if (ini >= 0) {
      let fin = i, hueco = 0;
      while (i < proj.length && proj[i] <= min) { hueco++; i++; }
      if (hueco >= gapMin || i >= proj.length) { b.push([ini, fin]); ini = -1; i--; }
      else i--;
    }
  }
  if (ini >= 0) b.push([ini, proj.length]);
  return b;
}

const filas = bandas(filasAlfa, 4, 8);
console.log('filas detectadas:', JSON.stringify(filas));

const outDir = path.join(RAIZ, 'public', 'sprites', personaje);
fs.mkdirSync(outDir, { recursive: true });

let n = 0;
filas.forEach(([y0, y1], fi) => {
  const colsAlfa = new Array(W).fill(0);
  for (let x = 0; x < W; x++) for (let y = y0; y < y1; y++) if (data[idx(x, y) + 3] > 40) colsAlfa[x]++;
  let cols = bandas(colsAlfa, 2, 26);

  // Si las poses quedaron unidas (espadas/armas que cruzan el hueco),
  // partir la banda ancha en 3 por los puntos de menor densidad.
  cols = cols.flatMap(([x0, x1]) => {
    const w = x1 - x0;
    if (w < 500) return [[x0, x1]];
    const cortes = [1 / 3, 2 / 3].map((f) => {
      const centro = Math.round(x0 + w * f);
      let mejor = centro, min = 1e9;
      for (let x = centro - 70; x <= centro + 70; x++) {
        if (x > x0 + 30 && x < x1 - 30 && colsAlfa[x] < min) { min = colsAlfa[x]; mejor = x; }
      }
      return mejor;
    });
    return [[x0, cortes[0]], [cortes[0] + 1, cortes[1]], [cortes[1] + 1, x1]];
  });

  while (cols.length > MAX_COLS) {
    let mejor = 0, mejorGap = 1e9;
    for (let i = 0; i < cols.length - 1; i++) {
      const gap = cols[i + 1][0] - cols[i][1];
      if (gap < mejorGap) { mejorGap = gap; mejor = i; }
    }
    cols[mejor] = [cols[mejor][0], cols[mejor + 1][1]];
    cols.splice(mejor + 1, 1);
  }

  cols.forEach(([x0, x1], ci) => {
    let ty0 = y1, ty1 = y0, tx0 = x1, tx1 = x0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (data[idx(x, y) + 3] > 40) {
        if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
        if (x < tx0) tx0 = x; if (x > tx1) tx1 = x;
      }
    }
    const cw = tx1 - tx0 + 1, ch = ty1 - ty0 + 1;
    if (cw < 20 || ch < 20) return;
    const out = new PNG({ width: cw, height: ch });
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const si = idx(tx0 + x, ty0 + y), di = (y * cw + x) * 4;
      out.data[di] = data[si]; out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2]; out.data[di + 3] = data[si + 3];
    }
    const nombre = `${personaje}_f${fi}c${ci}.png`;
    fs.writeFileSync(path.join(outDir, nombre), PNG.sync.write(out));
    console.log(' ', nombre, cw + 'x' + ch);
    n++;
  });
});

console.log('celdas escritas:', n);
