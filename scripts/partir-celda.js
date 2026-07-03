// Parte un recorte con dos poses pegadas en a.png y b.png por el valle
// de menor densidad de alfa cerca del centro. Uso: node partir-celda.js <ruta.png>
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ruta = process.argv[2];
const png = PNG.sync.read(fs.readFileSync(ruta));
const { width: W, height: H, data } = png;

const cols = new Array(W).fill(0);
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (data[(y * W + x) * 4 + 3] > 40) cols[x]++;

// valle de menor densidad entre el 30% y el 70% del ancho
let corte = Math.floor(W / 2), min = 1e9;
for (let x = Math.floor(W * 0.3); x < Math.floor(W * 0.7); x++) {
  if (cols[x] < min) { min = cols[x]; corte = x; }
}
console.log('corte en x=' + corte + ' (densidad ' + min + ')');

function recorte(x0, x1, sufijo) {
  // recorte fino
  let tx0 = x1, tx1 = x0, ty0 = H, ty1 = 0;
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) {
    if (data[(y * W + x) * 4 + 3] > 40) {
      if (x < tx0) tx0 = x; if (x > tx1) tx1 = x;
      if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
    }
  }
  const cw = tx1 - tx0 + 1, ch = ty1 - ty0 + 1;
  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const si = ((ty0 + y) * W + tx0 + x) * 4, di = (y * cw + x) * 4;
    out.data[di] = data[si]; out.data[di + 1] = data[si + 1];
    out.data[di + 2] = data[si + 2]; out.data[di + 3] = data[si + 3];
  }
  const destino = ruta.replace(/\.png$/i, sufijo + '.png');
  fs.writeFileSync(destino, PNG.sync.write(out));
  console.log('  ', path.basename(destino), cw + 'x' + ch);
}

recorte(0, corte, 'a');
recorte(corte, W, 'b');

