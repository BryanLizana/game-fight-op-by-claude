'use strict';

// ============================================================
// FIGHT OP — boceto de juego de pelea con stickmen
// 2 jugadores en el mismo teclado. 3 personajes por jugador.
// Gana quien deje K.O. a los 3 personajes del rival.
// ============================================================

const canvas = document.getElementById('juego');
const ctx = canvas.getContext('2d');
const ANCHO = canvas.width;
const ALTO = canvas.height;
const SUELO = ALTO - 70;

const GRAVEDAD = 2400;      // px/s²
const VEL_SALTO = 820;      // px/s
const STAMINA_MAX = 100;

// --- Personajes: cada jugador pelea con los 3, en este orden ---
const PERSONAJES = [
  { nombre: 'Veloz',  hp: 85,  velocidad: 300, dmgMult: 0.85, escala: 0.92, regen: 30 },
  { nombre: 'Zen',    hp: 105, velocidad: 235, dmgMult: 1.0,  escala: 1.0,  regen: 22 },
  { nombre: 'Tanque', hp: 135, velocidad: 170, dmgMult: 1.3,  escala: 1.15, regen: 16 },
];

// Colores por jugador (uno por personaje del roster)
const PALETAS = [
  ['#42a5f5', '#7e57c2', '#26c6da'],   // Jugador 1: fríos
  ['#ef5350', '#ffa726', '#ec407a'],   // Jugador 2: cálidos
];

// --- Ataques estilo Tekken: arranque, frames activos y recuperación ---
const ATAQUES = {
  punyo:  { startup: 0.10, activo: 0.10, recuperacion: 0.16, alcance: 62, dmg: 8,  stamina: 12, empuje: 140, stun: 0.28 },
  patada: { startup: 0.20, activo: 0.12, recuperacion: 0.28, alcance: 92, dmg: 15, stamina: 22, empuje: 300, stun: 0.42 },
};

const CONTROLES = [
  { izq: 'a', der: 'd', salto: 'w', bloqueo: 's', punyo: 'f', patada: 'g' },
  { izq: 'arrowleft', der: 'arrowright', salto: 'arrowup', bloqueo: 'arrowdown', punyo: 'k', patada: 'l' },
];

// ============================================================
// Entrada de teclado
// ============================================================
const teclas = {};          // teclas mantenidas
const pulsadas = new Set(); // teclas recién presionadas (un solo frame)

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (!e.repeat) pulsadas.add(k);
  teclas[k] = true;

  if (k === 'enter' && juego.pantalla === 'inicio') nuevoCombate();
  if (k === 'r' && juego.pantalla === 'fin') nuevoCombate();
});

addEventListener('keyup', (e) => { teclas[e.key.toLowerCase()] = false; });

// ============================================================
// Luchador
// ============================================================
class Luchador {
  constructor(jugador, def, x, dir) {
    this.jugador = jugador;       // 0 o 1
    this.def = def;
    this.x = x;
    this.y = 0;                   // altura sobre el suelo (0 = pisando)
    this.vx = 0;                  // empuje horizontal (knockback)
    this.vy = 0;
    this.dir = dir;               // 1 mira a la derecha, -1 a la izquierda
    this.hp = def.hp;
    this.stamina = STAMINA_MAX;
    this.estado = 'idle';         // idle | camina | bloqueo | ataque | golpeado | ko
    this.ataque = null;
    this.tAtaque = 0;
    this.golpeDado = false;
    this.tEstado = 0;
    this.invuln = 1.0;            // invulnerable al entrar (parpadea)
    this.retirado = false;
    this.tAnim = Math.random() * 10;
  }

  get enSuelo() { return this.y <= 0.001; }

  actualizar(dt, rival) {
    this.tAnim += dt;
    if (this.invuln > 0) this.invuln -= dt;

    // Física vertical
    if (this.y > 0 || this.vy !== 0) {
      this.y += this.vy * dt;
      this.vy -= GRAVEDAD * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; }
    }

    // Empuje horizontal con freno
    this.x += this.vx * dt;
    this.vx *= Math.max(0, 1 - 6 * dt);
    if (Math.abs(this.vx) < 5) this.vx = 0;

    if (this.estado === 'ko') { this.tEstado += dt; return; }

    if (this.estado === 'golpeado') {
      this.tEstado -= dt;
      if (this.tEstado <= 0) this.estado = 'idle';
      return;
    }

    if (this.estado === 'ataque') {
      this.tAtaque += dt;
      const a = ATAQUES[this.ataque];
      const fase = faseAtaque(this);
      if (fase.fase === 'activo' && !this.golpeDado && this.alcanzaA(rival, a)) {
        this.golpear(rival, a);
      }
      if (this.tAtaque >= a.startup + a.activo + a.recuperacion) {
        this.estado = 'idle';
        this.ataque = null;
      }
      return;
    }

    const c = CONTROLES[this.jugador];

    // Bloqueo: mantener la tecla, gasta estamina al recibir golpes
    if (teclas[c.bloqueo] && this.enSuelo && this.stamina > 0) {
      this.estado = 'bloqueo';
      return;
    }

    // Ataques (solo si hay estamina suficiente)
    if (pulsadas.has(c.punyo)) this.iniciarAtaque('punyo');
    else if (pulsadas.has(c.patada)) this.iniciarAtaque('patada');
    if (this.estado === 'ataque') return;

    // Movimiento
    let mov = 0;
    if (teclas[c.izq]) mov -= 1;
    if (teclas[c.der]) mov += 1;
    this.x += mov * this.def.velocidad * dt;
    this.estado = mov !== 0 ? 'camina' : 'idle';

    if (pulsadas.has(c.salto) && this.enSuelo) {
      this.vy = VEL_SALTO;
      this.y = 0.01;
    }

    // Regenerar estamina cuando no ataca ni bloquea
    this.stamina = Math.min(STAMINA_MAX, this.stamina + this.def.regen * dt);
  }

  iniciarAtaque(nombre) {
    const a = ATAQUES[nombre];
    if (this.stamina < a.stamina) return;
    this.stamina -= a.stamina;
    this.estado = 'ataque';
    this.ataque = nombre;
    this.tAtaque = 0;
    this.golpeDado = false;
  }

  alcanzaA(rival, a) {
    if (rival.estado === 'ko' || rival.invuln > 0) return false;
    const dist = (rival.x - this.x) * this.dir; // positivo = está enfrente
    return dist > -10 && dist < a.alcance * this.def.escala + 18 && Math.abs(rival.y - this.y) < 70;
  }

  golpear(rival, a) {
    this.golpeDado = true;

    if (rival.estado === 'bloqueo') {
      // Golpe bloqueado: poco daño, pero desgasta la guardia
      rival.stamina -= a.dmg * 1.5;
      rival.hp -= a.dmg * this.def.dmgMult * 0.15;
      rival.vx = this.dir * a.empuje * 0.4;
      if (rival.stamina <= 0) {
        rival.stamina = 0;
        rival.estado = 'golpeado';
        rival.tEstado = 0.7;
        anunciar('¡Guardia rota!');
      }
    } else {
      rival.hp -= a.dmg * this.def.dmgMult;
      rival.vx = this.dir * a.empuje;
      rival.estado = 'golpeado';
      rival.tEstado = a.stun;
    }

    if (rival.hp <= 0) {
      rival.hp = 0;
      rival.estado = 'ko';
      rival.tEstado = 0;
      rival.vx = this.dir * a.empuje * 1.5;
      anunciar('¡K.O.!');
    }
  }
}

function faseAtaque(f) {
  const a = ATAQUES[f.ataque];
  const t = f.tAtaque;
  if (t < a.startup) return { fase: 'prep', p: t / a.startup };
  if (t < a.startup + a.activo) return { fase: 'activo', p: (t - a.startup) / a.activo };
  return { fase: 'rec', p: Math.min(1, (t - a.startup - a.activo) / a.recuperacion) };
}

// ============================================================
// Estado global del juego
// ============================================================
const juego = {
  pantalla: 'inicio',   // inicio | pelea | fin
  jugadores: null,      // [{ roster, indice, luchador }]
  ganador: null,
  anuncio: { texto: '', t: 0 },
};

function nuevoCombate() {
  juego.jugadores = [0, 1].map((i) => ({
    roster: PERSONAJES.map((p, k) => ({ ...p, color: PALETAS[i][k] })),
    indice: 0,
    luchador: null,
  }));
  juego.jugadores[0].luchador = new Luchador(0, juego.jugadores[0].roster[0], 260, 1);
  juego.jugadores[1].luchador = new Luchador(1, juego.jugadores[1].roster[0], ANCHO - 260, -1);
  juego.ganador = null;
  juego.pantalla = 'pelea';
  anunciar('¡PELEA!');
}

function anunciar(texto, dur = 1.5) {
  juego.anuncio = { texto, t: dur };
}

function actualizarJuego(dt) {
  if (juego.anuncio.t > 0) juego.anuncio.t -= dt;
  if (juego.pantalla !== 'pelea') return;

  const l1 = juego.jugadores[0].luchador;
  const l2 = juego.jugadores[1].luchador;

  // Mirarse siempre (excepto en medio de un ataque o K.O.)
  for (const [a, b] of [[l1, l2], [l2, l1]]) {
    if (a.estado !== 'ataque' && a.estado !== 'ko') a.dir = b.x >= a.x ? 1 : -1;
  }

  l1.actualizar(dt, l2);
  l2.actualizar(dt, l1);

  // No atravesarse
  const dx = l2.x - l1.x;
  if (Math.abs(dx) < 36 && Math.abs(l1.y - l2.y) < 60 && l1.estado !== 'ko' && l2.estado !== 'ko') {
    const empuje = (36 - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
    l1.x -= empuje;
    l2.x += empuje;
  }
  l1.x = Math.max(45, Math.min(ANCHO - 45, l1.x));
  l2.x = Math.max(45, Math.min(ANCHO - 45, l2.x));

  // Cambio de personaje o victoria tras el K.O.
  juego.jugadores.forEach((j, i) => {
    const l = j.luchador;
    if (l.estado === 'ko' && l.tEstado > 1.5 && !l.retirado) {
      l.retirado = true;
      j.indice++;
      if (j.indice >= j.roster.length) {
        juego.ganador = 1 - i;
        juego.pantalla = 'fin';
      } else {
        j.luchador = new Luchador(i, j.roster[j.indice], i === 0 ? 160 : ANCHO - 160, i === 0 ? 1 : -1);
        anunciar('¡Entra ' + j.roster[j.indice].nombre + '!');
      }
    }
  });
}

// ============================================================
// Dibujo
// ============================================================
function dibujarFondo() {
  const g = ctx.createLinearGradient(0, 0, 0, ALTO);
  g.addColorStop(0, '#141428');
  g.addColorStop(1, '#2b2b4a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ANCHO, ALTO);

  // Luna y focos del escenario
  ctx.fillStyle = 'rgba(255,255,230,0.9)';
  ctx.beginPath(); ctx.arc(ANCHO - 140, 90, 28, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(120,140,255,0.06)';
  for (const fx of [200, 480, 760]) {
    ctx.beginPath();
    ctx.moveTo(fx, 0);
    ctx.lineTo(fx - 90, SUELO);
    ctx.lineTo(fx + 90, SUELO);
    ctx.closePath();
    ctx.fill();
  }

  // Piso
  ctx.fillStyle = '#1c1c32';
  ctx.fillRect(0, SUELO, ANCHO, ALTO - SUELO);
  ctx.strokeStyle = '#50507a';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, SUELO); ctx.lineTo(ANCHO, SUELO); ctx.stroke();
}

function dibujarSombra(f) {
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  const e = Math.max(0.4, 1 - f.y / 250);
  ctx.beginPath();
  ctx.ellipse(f.x, SUELO + 8, 26 * e * f.def.escala, 6 * e, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Dibuja un miembro de dos segmentos (con articulación flexionada)
function miembro(a, b, flexX, flexY) {
  const mx = (a.x + b.x) / 2 + flexX;
  const my = (a.y + b.y) / 2 + flexY;
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(mx, my);
  ctx.lineTo(b.x, b.y);
}

function dibujarLuchador(f) {
  const s = f.def.escala;
  const piesY = SUELO - f.y;

  ctx.save();
  ctx.translate(f.x, piesY);
  ctx.scale(f.dir, 1); // espacio local: +x = hacia el rival

  if (f.estado === 'ko') {
    const t = Math.min(1, f.tEstado / 0.45);
    ctx.rotate(-t * Math.PI * 0.45); // cae hacia atrás
    if (f.tEstado > 1.0) ctx.globalAlpha = Math.max(0, 1 - (f.tEstado - 1.0) * 2);
  }
  if (f.invuln > 0 && Math.floor(f.tAnim * 14) % 2 === 0) ctx.globalAlpha = 0.3;

  // ---- Pose base (guardia de pelea) ----
  const bob = Math.sin(f.tAnim * 4) * 1.5;
  const cadera = { x: 0, y: -46 * s + bob };
  let pieA = { x: 11 * s, y: 0 };   // pierna adelantada
  let pieB = { x: -11 * s, y: 0 };
  let manoA = { x: 17 * s, y: cadera.y - 20 * s };
  let manoB = { x: 11 * s, y: cadera.y - 14 * s };
  let lean = 2 * s;                  // inclinación del torso

  const enAire = f.y > 0.5;

  if (enAire) {
    pieA = { x: 13 * s, y: -16 * s };
    pieB = { x: -6 * s, y: -12 * s };
  } else if (f.estado === 'camina') {
    const c = f.tAnim * 9;
    pieA = { x: (11 + Math.sin(c) * 13) * s, y: -Math.max(0, Math.cos(c)) * 6 * s };
    pieB = { x: (-11 - Math.sin(c) * 13) * s, y: -Math.max(0, -Math.cos(c)) * 6 * s };
  } else if (f.estado === 'bloqueo') {
    cadera.y = -40 * s + bob * 0.5;
    manoA = { x: 12 * s, y: cadera.y - 32 * s };
    manoB = { x: 16 * s, y: cadera.y - 26 * s };
    lean = 4 * s;
  } else if (f.estado === 'golpeado') {
    lean = -10 * s;
    manoA = { x: -4 * s, y: cadera.y - 30 * s };
    manoB = { x: -10 * s, y: cadera.y - 24 * s };
  } else if (f.estado === 'ataque') {
    const a = ATAQUES[f.ataque];
    const fa = faseAtaque(f);
    const ext = fa.fase === 'prep' ? fa.p * 0.25 : fa.fase === 'activo' ? 1 : 1 - fa.p;
    if (f.ataque === 'punyo') {
      lean = 5 * s;
      manoA = { x: (10 + ext * 52) * s, y: cadera.y - 26 * s };
      manoB = { x: 8 * s, y: cadera.y - 16 * s };
    } else { // patada
      lean = -7 * s * ext;
      pieA = { x: (10 + ext * 68) * s, y: -(18 + ext * 20) * s };
      manoA = { x: 8 * s, y: cadera.y - 28 * s };
      manoB = { x: -14 * s, y: cadera.y - 24 * s };
    }
  }

  const cuello = { x: lean, y: cadera.y - 30 * s };
  const cabeza = { x: cuello.x + 3 * s, y: cuello.y - 9 * s, r: 8.5 * s };

  // ---- Trazo del cuerpo ----
  ctx.strokeStyle = f.def.color;
  ctx.lineWidth = 5 * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cadera.x, cadera.y);
  ctx.lineTo(cuello.x, cuello.y);
  miembro(cadera, pieA, 5 * s, 0);     // piernas (rodillas al frente)
  miembro(cadera, pieB, 4 * s, 0);
  miembro(cuello, manoA, -2 * s, 5 * s); // brazos (codos abajo)
  miembro(cuello, manoB, -3 * s, 5 * s);
  ctx.stroke();

  // Cabeza
  ctx.fillStyle = f.def.color;
  ctx.beginPath();
  ctx.arc(cabeza.x, cabeza.y, cabeza.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Etiqueta J1 / J2 sobre la cabeza
  if (f.estado !== 'ko') {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('J' + (f.jugador + 1), f.x, piesY - 108 * s);
  }
}

function dibujarHUD() {
  juego.jugadores.forEach((j, i) => {
    const l = j.luchador;
    const w = 340, h = 18;
    const x = i === 0 ? 24 : ANCHO - 24 - w;
    const y = 20;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x - 8, y - 8, w + 16, 66);

    // Barra de vida
    ctx.fillStyle = '#333';
    ctx.fillRect(x, y, w, h);
    const fv = Math.max(0, l.hp / l.def.hp);
    ctx.fillStyle = fv > 0.5 ? '#66bb6a' : fv > 0.25 ? '#ffa726' : '#ef5350';
    if (i === 0) ctx.fillRect(x, y, w * fv, h);
    else ctx.fillRect(x + w * (1 - fv), y, w * fv, h);

    // Barra de estamina
    ctx.fillStyle = '#333';
    ctx.fillRect(x, y + 24, w, 8);
    const fs = l.stamina / STAMINA_MAX;
    ctx.fillStyle = '#29b6f6';
    if (i === 0) ctx.fillRect(x, y + 24, w * fs, 8);
    else ctx.fillRect(x + w * (1 - fs), y + 24, w * fs, 8);

    // Nombre
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = i === 0 ? 'left' : 'right';
    ctx.fillText('J' + (i + 1) + ' — ' + l.def.nombre, i === 0 ? x : x + w, y + 50);

    // Fichas: personajes que quedan
    for (let k = 0; k < j.roster.length; k++) {
      const cx = i === 0 ? x + w - 12 - (j.roster.length - 1 - k) * 24 : x + 12 + (j.roster.length - 1 - k) * 24;
      const vivo = k >= j.indice;
      ctx.beginPath();
      ctx.arc(cx, y + 46, 8, 0, Math.PI * 2);
      ctx.fillStyle = vivo ? j.roster[k].color : '#444';
      ctx.fill();
      if (k === j.indice && juego.pantalla === 'pelea') {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  });
}

function dibujarAnuncio() {
  const a = juego.anuncio;
  ctx.save();
  ctx.globalAlpha = Math.min(1, a.t * 2);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 52px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(120,140,255,0.9)';
  ctx.shadowBlur = 24;
  ctx.fillText(a.texto, ANCHO / 2, ALTO / 2 - 60);
  ctx.restore();
}

function dibujarInicio() {
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 58px "Segoe UI", sans-serif';
  ctx.shadowColor = 'rgba(120,140,255,0.9)';
  ctx.shadowBlur = 26;
  ctx.fillText('FIGHT OP', ANCHO / 2, 170);
  ctx.shadowBlur = 0;

  ctx.font = '20px "Segoe UI", sans-serif';
  ctx.fillStyle = '#bbb';
  ctx.fillText('Pelea de stickmen · 3 personajes por jugador', ANCHO / 2, 215);
  ctx.fillText('Gana quien deje K.O. a los 3 rivales', ANCHO / 2, 245);

  ctx.font = '16px "Segoe UI", sans-serif';
  ctx.fillStyle = '#8899cc';
  ctx.fillText('El puño es rápido · la patada pega fuerte pero es lenta', ANCHO / 2, 300);
  ctx.fillText('Bloquear reduce el daño pero gasta estamina', ANCHO / 2, 326);

  if (Math.floor(performance.now() / 500) % 2 === 0) {
    ctx.font = 'bold 26px "Segoe UI", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText('Pulsa ENTER para pelear', ANCHO / 2, 410);
  }
}

function dibujarFin() {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, ANCHO, ALTO);
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETAS[juego.ganador][0];
  ctx.font = 'bold 56px "Segoe UI", sans-serif';
  ctx.shadowColor = 'rgba(255,255,255,0.6)';
  ctx.shadowBlur = 20;
  ctx.fillText('¡GANA EL JUGADOR ' + (juego.ganador + 1) + '!', ANCHO / 2, ALTO / 2 - 20);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.font = '22px "Segoe UI", sans-serif';
  ctx.fillText('Pulsa R para la revancha', ANCHO / 2, ALTO / 2 + 40);
}

function dibujar() {
  dibujarFondo();
  if (juego.pantalla === 'inicio') { dibujarInicio(); return; }

  juego.jugadores.forEach((j) => dibujarSombra(j.luchador));
  juego.jugadores.forEach((j) => dibujarLuchador(j.luchador));
  dibujarHUD();
  if (juego.anuncio.t > 0) dibujarAnuncio();
  if (juego.pantalla === 'fin') dibujarFin();
}

// ============================================================
// Bucle principal
// ============================================================
let ultimo = performance.now();

function bucle(ahora) {
  const dt = Math.min(0.033, (ahora - ultimo) / 1000);
  ultimo = ahora;
  actualizarJuego(dt);
  dibujar();
  pulsadas.clear();
  requestAnimationFrame(bucle);
}

requestAnimationFrame(bucle);
