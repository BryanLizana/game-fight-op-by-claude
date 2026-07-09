'use strict';

// ============================================================
// FIGHT OP — cliente online (v0.3: One Piece + estilo stickfight)
// El servidor simula la pelea; aquí solo se mandan las teclas
// y se dibuja el estado recibido con interpolación y efectos.
// ============================================================

const canvas = document.getElementById('juego');
const ctx = canvas.getContext('2d');
const ANCHO = canvas.width;
const ALTO = canvas.height;
const SUELO = ALTO - 70;

// Tiempos de los ataques básicos (solo para animar; el daño lo decide el servidor)
const ATAQUES = {
  punyo:  { startup: 0.08, activo: 0.10, recuperacion: 0.12 },
  patada: { startup: 0.16, activo: 0.12, recuperacion: 0.20 },
};

// Tamaño visual de los personajes (solo dibujo; las hitboxes viven en el servidor)
const TAM = 1.45;

// WebSocket directo (sin fase de HTTP polling: menos latencia a través de ngrok)
const socket = io({ transports: ['websocket'] });

// Medidor de ping (para diagnosticar si el lag es de red)
let ping = 0;
setInterval(() => {
  const t0 = performance.now();
  socket.emit('latido', () => { ping = Math.round(performance.now() - t0); });
}, 2000);

// ------------------------------------------------------------
// Diagnóstico de latencia: separa el ping en sus componentes y
// lo reporta en la consola del navegador cada 3 s durante la pelea.
//  - ws:      ida y vuelta por el WebSocket (lo que sufre el juego)
//  - http:    ida y vuelta HTTP puro al mismo servidor (misma ruta de red)
//  - est/s:   instantáneas del servidor recibidas por segundo (ideal ~60)
//  - hueco:   mayor pausa entre instantáneas (jitter; ideal <50 ms)
//  - fps:     cuadros dibujados por segundo (ideal ~60)
// Si ws ≈ http y ambos altos → la demora es del túnel/red, no del juego.
// ------------------------------------------------------------
const diag = { gaps: [], estados: 0, ultimoEstado: 0, frames: 0 };

setInterval(async () => {
  if (!estadoSrv || estadoSrv.pantalla === 'espera') return;
  let httpMs = -1;
  try {
    const t0 = performance.now();
    await fetch('/salud?t=' + Date.now(), { cache: 'no-store' });
    httpMs = Math.round(performance.now() - t0);
  } catch (e) { /* sin http, igual reportamos el resto */ }

  const rate = (diag.estados / 3).toFixed(0);
  const maxGap = Math.round(diag.gaps.length ? Math.max(...diag.gaps) : 0);
  const fps = Math.round(diag.frames / 3);

  let causa;
  if (ping > 150 && httpMs > 0 && Math.abs(ping - httpMs) < 60) {
    causa = '🌐 RED/TÚNEL: la demora está en el camino hacia ngrok (no es del juego). Prueba cloudflared o jugar en LAN.';
  } else if (ping > 150 && httpMs > 0 && ping > httpMs + 80) {
    causa = '🔌 WEBSOCKET saturado: el socket encola datos (¿subida lenta o extensión interceptando?).';
  } else if (maxGap > 120) {
    causa = '📶 JITTER: las instantáneas llegan a ráfagas; red inestable (WiFi débil o datos móviles).';
  } else if (fps < 45) {
    causa = '🖥️ GPU/CPU del navegador: el dibujo va lento, no la red.';
  } else {
    causa = '✅ todo dentro de lo normal';
  }
  console.log(
    `[PING] ws=${ping}ms · http=${httpMs}ms · estados/s=${rate} · hueco máx=${maxGap}ms · fps=${fps}\n→ ${causa}`
  );
  diag.gaps = [];
  diag.estados = 0;
  diag.frames = 0;
}, 3000);

// ------------------------------------------------------------
// Lobby: nombre y elección de lado
// ------------------------------------------------------------
const lobby = document.getElementById('lobby');
const inputNombre = document.getElementById('nombre');
const btnIzq = document.getElementById('ladoIzq');
const btnDer = document.getElementById('ladoDer');
const estadoLobby = document.getElementById('estadoLobby');
const seccionSel = document.getElementById('seleccion');
const gridPersonajes = document.getElementById('gridPersonajes');
const equipoElegido = document.getElementById('equipoElegido');
const btnAzar = document.getElementById('btnAzar');
const btnListo = document.getElementById('btnListo');

let miLado = null;
let estadoSrv = null;
let aviso = '';

// ---- Selección de personajes ----
const PERSONAJES_INFO = [
  { id: 'luffy', nombre: 'Luffy', color: '#e53935' },
  { id: 'zoro', nombre: 'Zoro', color: '#43a047' },
  { id: 'sanji', nombre: 'Sanji', color: '#fdd835' },
  { id: 'nami', nombre: 'Nami', color: '#fb8c00' },
  { id: 'usopp', nombre: 'Usopp', color: '#8d6e63' },
  { id: 'chopper', nombre: 'Chopper', color: '#ec407a' },
  { id: 'franky', nombre: 'Franky', color: '#00acc1' },
  { id: 'brook', nombre: 'Brook', color: '#b0bec5' },
  { id: 'robin', nombre: 'Robin', color: '#8e24aa' },
  { id: 'ace', nombre: 'Ace', color: '#ff7043' },
];

let miEquipo = [];
let equipoEnviado = false;

PERSONAJES_INFO.forEach((p) => {
  const b = document.createElement('button');
  b.className = 'btn-pj';
  b.dataset.id = p.id;
  b.innerHTML = `<span class="punto" style="background:${p.color}"></span>${p.nombre}`;
  b.addEventListener('click', () => {
    if (equipoEnviado) return;
    const i = miEquipo.indexOf(p.id);
    if (i >= 0) miEquipo.splice(i, 1);
    else if (miEquipo.length < 3) miEquipo.push(p.id);
    pintarSeleccion();
  });
  gridPersonajes.appendChild(b);
});

btnAzar.addEventListener('click', () => {
  if (equipoEnviado) return;
  const ids = PERSONAJES_INFO.map((p) => p.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  miEquipo = ids.slice(0, 3);
  pintarSeleccion();
});

btnListo.addEventListener('click', () => {
  if (equipoEnviado || miEquipo.length !== 3) return;
  socket.emit('equipo', miEquipo, (resp) => {
    if (resp.ok) {
      equipoEnviado = true;
      pintarSeleccion();
      actualizarLobby();
    } else {
      estadoLobby.textContent = resp.error;
    }
  });
});

function pintarSeleccion() {
  gridPersonajes.querySelectorAll('.btn-pj').forEach((b) => {
    b.classList.toggle('sel', miEquipo.includes(b.dataset.id));
    b.disabled = equipoEnviado;
  });
  equipoElegido.innerHTML = miEquipo.map((id, i) => {
    const p = PERSONAJES_INFO.find((x) => x.id === id);
    return `<span class="chip" style="background:${p.color}55;border-color:${p.color}">${i + 1}. ${p.nombre}</span>`;
  }).join('');
  btnListo.disabled = miEquipo.length !== 3 || equipoEnviado;
  btnAzar.disabled = equipoEnviado;
}

function unirse(lado) {
  const nombre = inputNombre.value.trim();
  if (!nombre) {
    estadoLobby.textContent = 'Escribe tu nombre primero';
    inputNombre.focus();
    return;
  }
  socket.emit('unirse', { nombre, lado }, (resp) => {
    if (resp.ok) {
      miLado = resp.lado;
      aviso = '';
      actualizarLobby();
    } else {
      estadoLobby.textContent = resp.error;
    }
  });
}

btnIzq.addEventListener('click', () => unirse(0));
btnDer.addEventListener('click', () => unirse(1));

function actualizarLobby() {
  if (!estadoSrv) return;
  const enPelea = estadoSrv.pantalla !== 'espera';
  lobby.classList.toggle('oculto', enPelea);
  if (enPelea) return;

  const n = estadoSrv.nombres;
  btnIzq.textContent = n[0] ? '🔵 ' + n[0] : '🔵 Lado izquierdo';
  btnDer.textContent = n[1] ? '🔴 ' + n[1] : '🔴 Lado derecho';
  btnIzq.disabled = !!n[0] || miLado !== null;
  btnDer.disabled = !!n[1] || miLado !== null;
  inputNombre.disabled = miLado !== null;

  // Si el servidor limpió los equipos (nueva selección), desbloquear
  if (miLado !== null && equipoEnviado && estadoSrv.listos && !estadoSrv.listos[miLado]) {
    equipoEnviado = false;
    miEquipo = [];
    pintarSeleccion();
  }

  seccionSel.classList.toggle('oculto', miLado === null);

  if (miLado !== null) {
    const rival = 1 - miLado;
    const rivalListo = estadoSrv.listos && estadoSrv.listos[rival];
    if (equipoEnviado) estadoLobby.textContent = n[rival] ? (rivalListo ? 'Empezando…' : 'Esperando a que ' + n[rival] + ' elija su equipo…') : 'Esperando rival…';
    else estadoLobby.textContent = (n[rival] && rivalListo ? n[rival] + ' ya está listo. ' : '') + 'Elige tus 3 personajes';
  } else if (aviso) estadoLobby.textContent = aviso;
  else estadoLobby.textContent = 'Elige tu nombre y tu lado';
}

socket.on('connect', () => {
  aviso = '';
  if (estadoLobby) estadoLobby.textContent = 'Conectado. Elige tu nombre y tu lado';
});

socket.on('disconnect', () => {
  miLado = null;
  estadoSrv = null;
  miEquipo = [];
  equipoEnviado = false;
  pintarSeleccion();
  seccionSel.classList.add('oculto');
  lobby.classList.remove('oculto');
  estadoLobby.textContent = 'Conexión perdida. Reintentando…';
});

socket.on('aviso', (texto) => {
  aviso = texto;
  actualizarLobby();
});

socket.on('estado', (e) => {
  estadoSrv = e;
  if (e.eventos) e.eventos.forEach(procesarEvento);
  // métricas para el diagnóstico de latencia
  const ahora = performance.now();
  if (diag.ultimoEstado) diag.gaps.push(ahora - diag.ultimoEstado);
  diag.ultimoEstado = ahora;
  diag.estados++;
  actualizarLobby();
});

// ------------------------------------------------------------
// Entrada: teclas → acciones abstractas para el servidor
// ------------------------------------------------------------
// Mover: A/D o flechas · Saltar: W/↑/Espacio · Cubrirse: F · Agacharse: S/↓
// Puño: click izq · Patada: click der · Especial cerca: Ctrl · A distancia: Shift
const MAPA_TECLAS = {
  a: 'izq', arrowleft: 'izq',
  d: 'der', arrowright: 'der',
  w: 'salto', arrowup: 'salto', ' ': 'salto',
  f: 'bloqueo',
  s: 'abajo', arrowdown: 'abajo',
  control: 'especial',
  shift: 'especial2',
};

const mantener = { izq: false, der: false, bloqueo: false, abajo: false };

addEventListener('keydown', (e) => {
  if (e.target === inputNombre) return;
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();

  if (miLado !== null && estadoSrv && estadoSrv.pantalla === 'fin') {
    if (k === 'r') { socket.emit('revancha'); return; }
    if (k === 'e') { socket.emit('reelegir'); return; }
  }

  // Relevo en plena pelea: 1 / 2 / 3 = personaje de tu equipo
  if (enPelea() && (k === '1' || k === '2' || k === '3')) {
    socket.emit('cambiar', Number(k) - 1);
    return;
  }

  const accion = MAPA_TECLAS[k];
  if (!accion || miLado === null) return;

  if (accion in mantener) {
    if (!mantener[accion]) {
      mantener[accion] = true;
      socket.emit('mantener', mantener);
    }
  } else if (!e.repeat) {
    socket.emit('pulso', accion);
  }
});

addEventListener('keyup', (e) => {
  const accion = MAPA_TECLAS[e.key.toLowerCase()];
  if (!accion || !(accion in mantener) || miLado === null) return;
  if (mantener[accion]) {
    mantener[accion] = false;
    socket.emit('mantener', mantener);
  }
});

// Al perder el foco (alt-tab, otra pestaña) el navegador ya no manda keyup:
// soltar todas las teclas mantenidas para que el personaje no siga solo
function soltarTeclas() {
  if (miLado === null) return;
  let habia = false;
  for (const k in mantener) { if (mantener[k]) { mantener[k] = false; habia = true; } }
  if (habia) socket.emit('mantener', mantener);
}
addEventListener('blur', soltarTeclas);
document.addEventListener('visibilitychange', () => { if (document.hidden) soltarTeclas(); });

// Mouse: click izquierdo = puño, click derecho = patada
const enPelea = () => miLado !== null && estadoSrv && estadoSrv.pantalla === 'pelea';

addEventListener('mousedown', (e) => {
  if (!enPelea()) return;
  if (e.button === 0) socket.emit('pulso', 'punyo');
  else if (e.button === 2) { e.preventDefault(); socket.emit('pulso', 'patada'); }
});

addEventListener('contextmenu', (e) => {
  if (enPelea()) e.preventDefault(); // que el click derecho no abra el menú en plena pelea
});

// ------------------------------------------------------------
// Controles táctiles en pantalla (móvil)
// Reutilizan los mismos emits que el teclado: 'mantener' y 'pulso'.
// ------------------------------------------------------------
const esTactil = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (esTactil) document.body.classList.add('tactil');

const panelTactil = document.getElementById('tactil');
if (panelTactil) {
  // Botón de acción mantenida (izq / der / abajo / bloqueo)
  const pulsarHold = (btn, activar) => {
    const accion = btn.dataset.hold;
    if (miLado === null || !(accion in mantener)) return;
    if (mantener[accion] === activar) return;
    mantener[accion] = activar;
    btn.classList.toggle('activo', activar);
    socket.emit('mantener', mantener);
  };

  panelTactil.querySelectorAll('[data-hold]').forEach((btn) => {
    const soltar = (e) => { if (e) e.preventDefault(); pulsarHold(btn, false); };
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); pulsarHold(btn, true); }, { passive: false });
    btn.addEventListener('touchend', soltar, { passive: false });
    btn.addEventListener('touchcancel', soltar, { passive: false });
  });

  // Botón de pulso (salto / puño / patada / especial / especial2)
  panelTactil.querySelectorAll('[data-pulso]').forEach((btn) => {
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (miLado === null) return;
      socket.emit('pulso', btn.dataset.pulso);
      btn.classList.add('activo');
      setTimeout(() => btn.classList.remove('activo'), 120);
    }, { passive: false });
  });

  // Relevo (1/2/3) y revancha / reelegir
  panelTactil.querySelectorAll('[data-cambiar]').forEach((btn) => {
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (enPelea()) socket.emit('cambiar', Number(btn.dataset.cambiar));
    }, { passive: false });
  });
  panelTactil.querySelectorAll('[data-accion]').forEach((btn) => {
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (miLado !== null && estadoSrv && estadoSrv.pantalla === 'fin') {
        socket.emit(btn.dataset.accion); // 'revancha' o 'reelegir'
      }
    }, { passive: false });
  });
}

// ------------------------------------------------------------
// Efectos: partículas, destellos y rayos
// ------------------------------------------------------------
const particulas = [];
const destellos = [];
const rayos = [];
const numeros = []; // números de daño flotantes

function chispas(x, y, color, n, fuerza, haciaArriba) {
  for (let i = 0; i < n; i++) {
    particulas.push({
      x, y,
      vx: (Math.random() - 0.5) * fuerza,
      vy: (Math.random() - (haciaArriba ? 0.9 : 0.5)) * fuerza * 0.8,
      vida: 0.35 + Math.random() * 0.35,
      color,
      tam: 2 + Math.random() * 3,
    });
  }
}

function procesarEvento(ev) {
  const sy = SUELO - ev.y;
  switch (ev.tipo) {
    case 'golpe':
      chispas(ev.x, sy, '#ffffff', 6, 260);
      chispas(ev.x, sy, ev.color || '#ffcc80', 6, 220);
      break;
    case 'bloqueo':
      chispas(ev.x, sy, '#90caf9', 6, 160);
      break;
    case 'lanzamiento':
      chispas(ev.x, sy, '#ffffff', 10, 380, true);
      chispas(ev.x, sy, ev.color || '#ffcc80', 8, 300, true);
      destellos.push({ x: ev.x, y: sy, t: 0.2, max: 0.2, color: '#fff' });
      break;
    case 'ko':
      chispas(ev.x, sy, '#ffffff', 14, 420, true);
      chispas(ev.x, sy, '#ff8a80', 14, 380, true);
      destellos.push({ x: ev.x, y: sy, t: 0.35, max: 0.35, color: '#ffebee' });
      break;
    case 'rayo': {
      const segs = [];
      let px = ev.x;
      for (let yy = 0; yy < SUELO; yy += 45) {
        px += (Math.random() - 0.5) * 34;
        segs.push([px, yy]);
      }
      segs.push([ev.x, SUELO]);
      rayos.push({ segs, t: 0.28, max: 0.28 });
      chispas(ev.x, SUELO - 8, '#fff59d', 16, 380, true);
      destellos.push({ x: ev.x, y: SUELO - 40, t: 0.25, max: 0.25, color: '#fffde7' });
      break;
    }
    case 'cura':
      for (let i = 0; i < 12; i++) {
        particulas.push({
          x: ev.x + (Math.random() - 0.5) * 40, y: sy + (Math.random() - 0.5) * 50,
          vx: 0, vy: -60 - Math.random() * 60,
          vida: 0.6 + Math.random() * 0.4, color: '#69f0ae', tam: 3,
        });
      }
      break;
    case 'agarre':
      chispas(ev.x, sy, ev.color || '#ce93d8', 10, 200);
      break;
    case 'dano':
      if (ev.valor > 0) numeros.push({ x: ev.x, y: sy, valor: ev.valor, t: 0.9, max: 0.9 });
      break;
    case 'cambio': // relevo de personaje: estallido de humo/energía
      chispas(ev.x, sy, '#ffffff', 16, 360, true);
      chispas(ev.x, sy, ev.color || '#ffd54f', 12, 300, true);
      destellos.push({ x: ev.x, y: sy, t: 0.3, max: 0.3, color: '#fff' });
      break;
    case 'brote': // Mil Fleurs: estallido de manos/pétalos morados
      chispas(ev.x, SUELO - 30, '#ce93d8', 16, 300, true);
      chispas(ev.x, SUELO - 10, '#8e24aa', 10, 200, true);
      destellos.push({ x: ev.x, y: SUELO - 40, t: 0.22, max: 0.22, color: '#e1bee7' });
      break;
  }
}

function actualizarEfectos(dt) {
  for (let i = particulas.length - 1; i >= 0; i--) {
    const p = particulas[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 500 * dt;
    p.vida -= dt;
    if (p.vida <= 0) particulas.splice(i, 1);
  }
  for (let i = destellos.length - 1; i >= 0; i--) {
    destellos[i].t -= dt;
    if (destellos[i].t <= 0) destellos.splice(i, 1);
  }
  for (let i = rayos.length - 1; i >= 0; i--) {
    rayos[i].t -= dt;
    if (rayos[i].t <= 0) rayos.splice(i, 1);
  }
  for (let i = numeros.length - 1; i >= 0; i--) {
    numeros[i].y -= 38 * dt; // sube flotando
    numeros[i].t -= dt;
    if (numeros[i].t <= 0) numeros.splice(i, 1);
  }
}

function dibujarEfectos() {
  for (const p of particulas) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.vida * 2.5));
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.tam / 2, p.y - p.tam / 2, p.tam, p.tam);
  }
  ctx.globalAlpha = 1;

  for (const d of destellos) {
    const q = d.t / d.max;
    ctx.save();
    ctx.globalAlpha = q * 0.8;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(d.x, d.y, 26 + (1 - q) * 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const r of rayos) {
    const q = r.t / r.max;
    ctx.save();
    ctx.globalAlpha = q;
    ctx.strokeStyle = '#fff59d';
    ctx.lineWidth = 4 + q * 4;
    ctx.shadowColor = '#ffee58';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    r.segs.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }

  // Números de daño flotantes (rojo, contorno negro para leerse en cualquier fondo)
  for (const nu of numeros) {
    const q = nu.t / nu.max;
    const escala = 1 + (1 - q) * 0.25; // pequeño "pop" al aparecer
    ctx.save();
    ctx.globalAlpha = Math.min(1, q * 1.8);
    ctx.translate(nu.x, nu.y);
    ctx.scale(escala, escala);
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.fillStyle = '#ff3b3b';
    const txt = '-' + nu.valor;
    ctx.strokeText(txt, 0, 0);
    ctx.fillText(txt, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------
// Dibujo del escenario
// ------------------------------------------------------------
// Escenarios: imágenes de public/fondos/ elegidas por el servidor
const fondosCache = {};

function dibujarFondo() {
  const nombre = estadoSrv && estadoSrv.fondo;
  if (nombre) {
    if (!fondosCache[nombre]) {
      fondosCache[nombre] = new Image();
      fondosCache[nombre].src = 'fondos/' + nombre;
    }
    const img = fondosCache[nombre];
    if (img.complete && img.naturalWidth) {
      // escala tipo "cover" centrada
      const esc = Math.max(ANCHO / img.width, ALTO / img.height);
      const w = img.width * esc, h = img.height * esc;
      ctx.drawImage(img, (ANCHO - w) / 2, (ALTO - h) / 2, w, h);
      // oscurecer un poco para que personajes y HUD se lean bien
      ctx.fillStyle = 'rgba(8,8,22,0.38)';
      ctx.fillRect(0, 0, ANCHO, ALTO);
      // piso sólido
      ctx.fillStyle = 'rgba(16,16,38,0.82)';
      ctx.fillRect(0, SUELO, ANCHO, ALTO - SUELO);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, SUELO); ctx.lineTo(ANCHO, SUELO); ctx.stroke();
      return;
    }
  }

  const g = ctx.createLinearGradient(0, 0, 0, ALTO);
  g.addColorStop(0, '#141428');
  g.addColorStop(1, '#2b2b4a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ANCHO, ALTO);

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

  ctx.fillStyle = '#1c1c32';
  ctx.fillRect(0, SUELO, ANCHO, ALTO - SUELO);
  ctx.strokeStyle = '#50507a';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, SUELO); ctx.lineTo(ANCHO, SUELO); ctx.stroke();
}

function dibujarSombra(l, r) {
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  const e = Math.max(0.4, 1 - r.y / 250);
  ctx.beginPath();
  ctx.ellipse(r.x, SUELO + 8, 26 * e * l.escala * TAM, 7 * e, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------
// Proyectiles
// ------------------------------------------------------------
// Rayos eléctricos crepitando alrededor de un proyectil (efecto de trueno).
// Deterministas por tiempo: zigzaguean sin guardar estado, ~18 cambios/s.
function dibujarTruenos(x, y, r, color) {
  const t = performance.now() / 1000;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = '#e1f5fe';
  ctx.shadowBlur = 8;
  const colores = ['#ffffff', '#fff59d', '#80d8ff'];
  for (let i = 0; i < 3; i++) {
    const semilla = Math.floor(t * 18) + i * 7;      // cambia ~18 veces/s
    const ang = (semilla * 2.399) % (Math.PI * 2);   // ángulo pseudoaleatorio
    const largo = r * (1.3 + (semilla % 5) * 0.16);
    const perpx = -Math.sin(ang), perpy = Math.cos(ang);
    ctx.strokeStyle = colores[i];
    ctx.lineWidth = i === 0 ? 2.2 : 1.4;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(ang) * r * 0.5, y + Math.sin(ang) * r * 0.5);
    for (let s = 1; s <= 4; s++) {
      const f = s / 4;
      const jitter = ((semilla * (s + 3)) % 11 - 5) * 3; // quiebre del rayo
      ctx.lineTo(
        x + Math.cos(ang) * (r * 0.5 + largo * f) + perpx * jitter,
        y + Math.sin(ang) * (r * 0.5 + largo * f) + perpy * jitter,
      );
    }
    ctx.stroke();
  }
  // Anillo eléctrico titilante
  if (Math.floor(t * 20) % 2 === 0) {
    ctx.strokeStyle = 'rgba(179,229,252,0.5)';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(x, y, r * 1.1, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function dibujarProyectiles() {
  for (const p of estadoSrv.proyectiles) {
    if (p.tipo === 'rayo') {
      const parpadeo = Math.floor(performance.now() / 80) % 2 === 0;
      ctx.save();
      if (p.visual === 'brote') {
        // Mil Fleurs: pétalos y brotes morados marcando el suelo
        ctx.fillStyle = parpadeo ? 'rgba(206,147,216,0.8)' : 'rgba(142,36,170,0.6)';
        for (const dx of [-18, 0, 18]) {
          ctx.beginPath();
          ctx.ellipse(p.x + dx, SUELO - 4, 6, 12, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Thunderbolt: nube y chispa titilante sobre el objetivo
        ctx.fillStyle = 'rgba(120,120,150,0.8)';
        ctx.beginPath();
        ctx.arc(p.x - 14, 26, 13, 0, Math.PI * 2);
        ctx.arc(p.x + 4, 20, 16, 0, Math.PI * 2);
        ctx.arc(p.x + 20, 28, 12, 0, Math.PI * 2);
        ctx.fill();
        if (parpadeo) {
          ctx.strokeStyle = 'rgba(255,238,88,0.7)';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 8]);
          ctx.beginPath(); ctx.moveTo(p.x, 40); ctx.lineTo(p.x, SUELO); ctx.stroke();
        }
      }
      ctx.restore();
      continue;
    }

    const sy = SUELO - p.y;
    ctx.save();
    if (p.tipo === 'fuego') {
      const g = ctx.createRadialGradient(p.x, sy, 3, p.x, sy, 22);
      g.addColorStop(0, '#fff59d');
      g.addColorStop(0.5, '#ff9800');
      g.addColorStop(1, 'rgba(230,74,25,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, sy, 22, 0, Math.PI * 2); ctx.fill();
      chispas(p.x, sy, '#ffb74d', 1, 110, true);
    } else if (p.tipo === 'estrella') {
      ctx.fillStyle = '#ffee58';
      ctx.shadowColor = '#fff176';
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(p.x, sy, 9, 0, Math.PI * 2); ctx.fill();
    } else if (p.tipo === 'nota') {
      ctx.fillStyle = '#66bb6a';
      ctx.shadowColor = '#a5d6a7';
      ctx.shadowBlur = 12;
      ctx.font = 'bold 28px serif';
      ctx.textAlign = 'center';
      ctx.fillText('♪', p.x, sy + 10);
      ctx.strokeStyle = 'rgba(165,214,167,0.5)';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(p.x - 17, sy, 15, -0.8, 0.8); ctx.stroke();
    } else if (p.tipo === 'onda') {
      // Bazooka Goma: onda de choque roja gigante
      const g = ctx.createRadialGradient(p.x, sy, 4, p.x, sy, 26);
      g.addColorStop(0, '#ffebee');
      g.addColorStop(0.5, '#e53935');
      g.addColorStop(1, 'rgba(183,28,28,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, sy, 26, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,205,210,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x - 10, sy, 20, -1.1, 1.1); ctx.stroke();
    } else if (p.tipo === 'tajo') {
      // Corte de Viento: media luna verde
      ctx.strokeStyle = '#a5d6a7';
      ctx.shadowColor = '#66bb6a';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(p.x - 16, sy, 18, -0.9, 0.9); ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(p.x - 24, sy, 14, -0.7, 0.7); ctx.stroke();
    } else if (p.tipo === 'llama') {
      // Llama Voladora de Sanji
      const g = ctx.createRadialGradient(p.x, sy, 2, p.x, sy, 14);
      g.addColorStop(0, '#fff59d');
      g.addColorStop(0.6, '#ff9800');
      g.addColorStop(1, 'rgba(230,74,25,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, sy, 14, 0, Math.PI * 2); ctx.fill();
    } else if (p.tipo === 'laser') {
      // Radical Beam: haz celeste
      ctx.strokeStyle = '#80deea';
      ctx.shadowColor = '#00acc1';
      ctx.shadowBlur = 14;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(p.x - 34, sy); ctx.lineTo(p.x + 10, sy); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(p.x - 30, sy); ctx.lineTo(p.x + 8, sy); ctx.stroke();
    }
    // Truenos crepitando alrededor de la bola en todo ataque a distancia
    const rTrueno = ({ fuego: 22, onda: 26, llama: 15, estrella: 11, nota: 15, tajo: 18, laser: 16 })[p.tipo] || 14;
    dibujarTruenos(p.x, sy, rTrueno, p.color);
    ctx.restore();
  }
}

// ------------------------------------------------------------
// Stickman: poses, accesorios y estelas
// ------------------------------------------------------------
function miembro(a, b, flexX, flexY) {
  const mx = (a.x + b.x) / 2 + flexX;
  const my = (a.y + b.y) / 2 + flexY;
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(mx, my);
  ctx.lineTo(b.x, b.y);
}

function faseAtaque(l) {
  const a = ATAQUES[l.ataque];
  const t = l.tAtaque;
  if (t < a.startup) return { fase: 'prep', p: t / a.startup };
  if (t < a.startup + a.activo) return { fase: 'activo', p: (t - a.startup) / a.activo };
  return { fase: 'rec', p: Math.min(1, (t - a.startup - a.activo) / a.recuperacion) };
}

function extEspecial(l) {
  const e = l.esp;
  const t = l.tAtaque;
  if (t < e.startup) return { ext: (t / e.startup) * 0.35, activo: false };
  if (t < e.startup + e.activo) return { ext: 1, activo: true };
  const q = Math.min(1, (t - e.startup - e.activo) / Math.max(0.01, e.recuperacion));
  return { ext: Math.max(0, 1 - q * 1.6), activo: e.activo === 0 && q < 0.4 };
}

// Estela curva detrás de un golpe (el "swoosh" del video)
function estela(centro, punta, color) {
  const r = Math.hypot(punta.x - centro.x, punta.y - centro.y);
  if (r < 12) return;
  const a = Math.atan2(punta.y - centro.y, punta.x - centro.x);
  ctx.save();
  ctx.globalAlpha = 0.30;
  ctx.strokeStyle = color;
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(centro.x, centro.y, r, a - 0.9, a + 0.05); ctx.stroke();
  ctx.globalAlpha = 0.14;
  ctx.lineWidth = 13;
  ctx.beginPath(); ctx.arc(centro.x, centro.y, r * 0.88, a - 0.7, a); ctx.stroke();
  ctx.restore();
}

// Líneas de velocidad detrás del cuerpo (dash / volar)
function lineasVelocidad(s, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 5; i++) {
    ctx.globalAlpha = 0.08 + Math.random() * 0.18;
    const y = -(10 + i * 16) * s;
    ctx.beginPath();
    ctx.moveTo(-25 * s, y);
    ctx.lineTo((-95 - Math.random() * 50) * s, y + (Math.random() - 0.5) * 8);
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------
// Sprites dibujados (piloto: Zoro). Si un personaje tiene sprites
// cargados, se dibuja con imágenes; si no, con el stickman procedural.
// ------------------------------------------------------------
const SPRITES = {};

function cargarSprites(personaje, mapa) {
  const st = { listo: false, poses: {}, alturaBase: 1 };
  SPRITES[personaje] = st;
  let pendientes = Object.keys(mapa).length;
  for (const [pose, archivo] of Object.entries(mapa)) {
    const img = new Image();
    img.onload = () => {
      st.poses[pose] = img;
      if (--pendientes === 0) {
        st.alturaBase = st.poses.idle.height;
        st.listo = true;
      }
    };
    img.src = 'sprites/' + personaje + '/' + archivo;
  }
}

cargarSprites('zoro', {
  idle: 'zoro_f0c0.png',
  camina: 'zoro_f0c1.png',
  punyo: 'zoro_f0c2.png',
  patada: 'zoro_f1c0.png',
  bloqueo: 'zoro_f1c1.png',
  especial: 'zoro_f1c2.png',   // Onigiri (cerca)
  especial2: 'zoro_f2c1.png',  // gran corte → Corte de Viento (lejos)
  salto: 'zoro_f2c2.png',      // (sin 'golpeado': su pose parecía patada)
  derribado: 'zoro_f3c0.png',
  ko: 'zoro_f3c1.png',
});

cargarSprites('ace', {
  idle: 'ace_f0c0.png',
  camina: 'ace_f0c1.png',
  punyo: 'ace_f0c3.png',
  patada: 'ace_f2c1.png',      // golpe ascendente
  bloqueo: 'ace_f1c0.png',
  agachado: 'ace_f1c1.png',
  especial: 'ace_f0c2.png',    // Puño Ígneo (gancho con giro)
  especial2: 'ace_f2c0.png',   // Puño de Fuego (pose de lanzar)
  golpeado: 'ace_f2c2.png',    // el sombrero se le cae
  salto: 'ace_f2c3.png',
  // sin derribado/ko en la hoja: el motor acuesta la guardia rotada
});

cargarSprites('nami', {
  idle: 'nami_f0c0.png',
  camina: 'nami_f0c1a.png',    // carrera con bastón atrás
  punyo: 'nami_f0c2.png',      // golpe seco con la punta del bastón
  patada: 'nami_f1c2.png',
  bloqueo: 'nami_f1c0.png',    // bastón en vertical
  agachado: 'nami_f2c1.png',   // estocada agazapada
  especial: 'nami_f3c0.png',   // Golpe Clima (batazo descendente)
  especial2: 'nami_f2c2.png',  // Thunderbolt Tempo (bastón al cielo)
  salto: 'nami_f4c0.png',
  derribado: 'nami_f3c1.png',
  ko: 'nami_f3c1.png',
});

cargarSprites('franky', {
  idle: 'franky_f0c0.png',
  camina: 'franky_f1c1.png',    // carrera con puño
  punyo: 'franky_f0c1.png',
  patada: 'franky_f1c2.png',
  bloqueo: 'franky_f1c0.png',   // escudo de antebrazos
  agachado: 'franky_f3c0.png',
  especial: 'franky_f2c2.png',  // Strong Right (doble puño gigante)
  especial2: 'franky_f3c1.png', // Radical Beam (embestida baja)
  golpeado: 'franky_f4c0.png',
  salto: 'franky_f4c2.png',
  derribado: 'franky_f4c1.png',
  ko: 'franky_f4c1.png',        // misma pose tirado + desvanecido
});

cargarSprites('luffy', {
  idle: 'luffy_f0c0.png',
  camina: 'luffy_f0c1a.png',
  punyo: 'luffy_f0c1b.png',     // puñetazo en carrera
  patada: 'luffy_f1c2b.png',    // golpe ascendente
  bloqueo: 'luffy_f1c0.png',
  agachado: 'luffy_f2c0.png',
  especial: 'luffy_f2c2.png',   // Pistola Goma (brazo estirado)
  especial2: 'luffy_f3c0.png',  // Bazooka Goma (estirón máximo)
  salto: 'luffy_f4c0.png',
  derribado: 'luffy_f4c1.png',
  ko: 'luffy_f3c1.png',         // boca abajo con estrellitas
});

// Vestimenta de cada personaje (colores tomados de la imagen de referencia)
const NEGRO = '#23232b';
const PIEL = '#f5d7b2';

// hombro/caderaAncho definen la complexión (Franky fornido, Brook flaco…)
// piernasLargas: el pantalón cubre toda la pierna; si no, solo el muslo (short)
const ATUENDOS = {
  luffy:   { torso: '#c62828', piernas: '#1e88e5', pelo: '#1a1a1a', hombro: 8, faja: '#fdd835', pecho: PIEL, zapatos: '#a1887f' },
  zoro:    { abrigo: '#2e7d32', torso: '#2e7d32', piernas: '#1b5e20', piernasLargas: true, pelo: '#81c784', faja: '#8d6e63', hombro: 9.5 },
  sanji:   { torso: '#23232b', piernas: '#23232b', piernasLargas: true, mangas: '#23232b', pelo: '#fdd835', corbata: '#fdd835', hombro: 8 },
  nami:    { torso: '#26a69a', piernas: '#1565c0', piernasLargas: true, pelo: '#f57c00', peloLargo: true, hombro: 6, caderaAncho: 7 },
  usopp:   { torso: '#8d6e63', piernas: '#6d4c41', piernasLargas: true, pelo: '#2d2d2d', hombro: 7 },
  chopper: { torso: '#ad1457', piernas: '#ad1457', piernasLargas: true, hombro: 6, caderaAncho: 7 },
  franky:  { torso: '#e53935', piernas: '#01579b', pelo: '#29b6f6', brazosGruesos: '#c62828', hombro: 15, caderaAncho: 6, pecho: PIEL },
  brook:   { torso: '#37474f', piernas: '#37474f', piernasLargas: true, mangas: '#37474f', pelo: 'afro', hombro: 7, caderaAncho: 4 },
  robin:   { torso: '#7b1fa2', falda: '#f06292', pelo: '#1a1a1a', peloLargo: true, hombro: 6.5, caderaAncho: 7 },
  ace:     { torso: PIEL, piernas: '#424242', pelo: '#1a1a1a', hombro: 9.5, collar: '#c62828' }, // torso descubierto
};

// Accesorios distintivos de cada personaje de One Piece
function dibujarProps(l, s, cabeza, cuello, manoA, manoB, especialActivo) {
  ctx.save();
  ctx.lineCap = 'round';
  switch (l.personaje) {
    case 'luffy': { // sombrero de paja
      ctx.fillStyle = '#fbc02d';
      ctx.beginPath();
      ctx.ellipse(cabeza.x, cabeza.y - cabeza.r * 0.45, cabeza.r * 1.7, cabeza.r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cabeza.x, cabeza.y - cabeza.r * 0.5, cabeza.r * 0.85, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = '#c62828';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cabeza.x - cabeza.r * 0.85, cabeza.y - cabeza.r * 0.45);
      ctx.lineTo(cabeza.x + cabeza.r * 0.85, cabeza.y - cabeza.r * 0.45);
      ctx.stroke();
      break;
    }
    case 'zoro': { // katana(s)
      ctx.strokeStyle = '#eceff1';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(manoA.x, manoA.y);
      ctx.lineTo(manoA.x + 34 * s, manoA.y - 8 * s);
      ctx.stroke();
      if (especialActivo) { // Onigiri: tres espadas
        ctx.beginPath();
        ctx.moveTo(manoB.x, manoB.y);
        ctx.lineTo(manoB.x + 32 * s, manoB.y + 4 * s);
        ctx.moveTo(cabeza.x + 4 * s, cabeza.y + 4 * s);
        ctx.lineTo(cabeza.x + 30 * s, cabeza.y + 2 * s);
        ctx.stroke();
      }
      break;
    }
    case 'sanji': { // cigarrillo
      ctx.strokeStyle = '#fafafa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cabeza.x + cabeza.r * 0.7, cabeza.y + cabeza.r * 0.3);
      ctx.lineTo(cabeza.x + cabeza.r * 1.5, cabeza.y + cabeza.r * 0.55);
      ctx.stroke();
      ctx.fillStyle = '#ff7043';
      ctx.fillRect(cabeza.x + cabeza.r * 1.4, cabeza.y + cabeza.r * 0.4, 2.5, 2.5);
      break;
    }
    case 'nami': { // bastón clima
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(manoB.x - 6 * s, manoB.y + 22 * s);
      ctx.lineTo(manoB.x + 10 * s, manoB.y - 30 * s);
      ctx.stroke();
      break;
    }
    case 'usopp': { // nariz larga y gorro
      ctx.strokeStyle = '#a1887f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cabeza.x + cabeza.r * 0.6, cabeza.y);
      ctx.lineTo(cabeza.x + cabeza.r * 1.8, cabeza.y + 2 * s);
      ctx.stroke();
      ctx.fillStyle = '#c9a227';
      ctx.beginPath();
      ctx.arc(cabeza.x, cabeza.y - cabeza.r * 0.4, cabeza.r * 0.8, Math.PI, 0);
      ctx.fill();
      break;
    }
    case 'chopper': { // astas y gorro
      ctx.strokeStyle = '#8d6e63';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cabeza.x - cabeza.r * 0.6, cabeza.y - cabeza.r * 0.6);
      ctx.lineTo(cabeza.x - cabeza.r * 1.3, cabeza.y - cabeza.r * 1.5);
      ctx.moveTo(cabeza.x - cabeza.r * 1.0, cabeza.y - cabeza.r * 1.1);
      ctx.lineTo(cabeza.x - cabeza.r * 1.5, cabeza.y - cabeza.r * 0.9);
      ctx.moveTo(cabeza.x + cabeza.r * 0.6, cabeza.y - cabeza.r * 0.6);
      ctx.lineTo(cabeza.x + cabeza.r * 1.3, cabeza.y - cabeza.r * 1.5);
      ctx.stroke();
      // gorro grande celeste con X blanca
      ctx.fillStyle = '#29b6f6';
      ctx.beginPath();
      ctx.arc(cabeza.x, cabeza.y - cabeza.r * 0.35, cabeza.r * 0.95, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cabeza.x - 3.5 * s, cabeza.y - cabeza.r * 0.95);
      ctx.lineTo(cabeza.x + 3.5 * s, cabeza.y - cabeza.r * 0.45);
      ctx.moveTo(cabeza.x + 3.5 * s, cabeza.y - cabeza.r * 0.95);
      ctx.lineTo(cabeza.x - 3.5 * s, cabeza.y - cabeza.r * 0.45);
      ctx.stroke();
      break;
    }
    case 'franky': { // pelo en punta
      ctx.fillStyle = '#29b6f6';
      ctx.beginPath();
      ctx.moveTo(cabeza.x - cabeza.r * 0.7, cabeza.y - cabeza.r * 0.5);
      ctx.lineTo(cabeza.x, cabeza.y - cabeza.r * 2.1);
      ctx.lineTo(cabeza.x + cabeza.r * 0.7, cabeza.y - cabeza.r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'brook': { // coronita sobre el afro
      ctx.fillStyle = '#ffd54f';
      ctx.fillRect(cabeza.x - 5 * s, cabeza.y - cabeza.r * 2.5, 10 * s, 5 * s);
      break;
    }
    case 'robin': { // gafas de sol sobre el pelo
      ctx.strokeStyle = '#efebe9';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cabeza.x - cabeza.r * 0.55, cabeza.y - cabeza.r * 0.7);
      ctx.lineTo(cabeza.x + cabeza.r * 0.75, cabeza.y - cabeza.r * 0.7);
      ctx.stroke();
      break;
    }
    case 'ace': { // sombrero naranja
      ctx.fillStyle = '#ff9800';
      ctx.beginPath();
      ctx.ellipse(cabeza.x, cabeza.y - cabeza.r * 0.45, cabeza.r * 1.55, cabeza.r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cabeza.x, cabeza.y - cabeza.r * 0.5, cabeza.r * 0.8, Math.PI, 0);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

// Escudo azul pulsante al bloquear (en espacio local del luchador)
function dibujarEscudo(s, tAnim) {
  const pulso = 0.5 + Math.sin(tAnim * 10) * 0.15;
  ctx.save();
  ctx.globalAlpha = pulso;
  ctx.strokeStyle = '#90caf9';
  ctx.lineWidth = 3.5 * s;
  ctx.shadowColor = '#64b5f6';
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(4 * s, -40 * s, 36 * s, -0.8, 0.8);
  ctx.stroke();
  ctx.globalAlpha = pulso * 0.22;
  ctx.fillStyle = '#90caf9';
  ctx.beginPath();
  ctx.arc(4 * s, -40 * s, 36 * s, -0.8, 0.8);
  ctx.fill();
  ctx.restore();
}

// Duelo espejo (Zoro vs Zoro): el luchador del lado derecho se tiñe
// con un filtro de canvas para distinguirlos (CSS no puede recolorear canvas)
function tinteEspejo(l) {
  if (!estadoSrv || !estadoSrv.jugadores) return false;
  const [a, b] = estadoSrv.jugadores;
  return a.luchador.personaje === b.luchador.personaje && b.luchador === l;
}

// Dibujo con sprites (personajes que tienen hoja de poses cargada)
function dibujarLuchadorSprite(l, r, nombre, st) {
  const s = l.escala * TAM;
  const piesY = SUELO - r.y;
  const ALTURA = 104 * s;                 // altura del sprite de guardia en px
  const f = ALTURA / st.alturaBase;
  const enAire = r.y > 0.5;

  let pose = 'idle';
  let rot = 0, alpha = 1, dy = 0, squashY = 1;
  switch (l.estado) {
    case 'agachado':
      if (st.poses.agachado) pose = 'agachado';
      else { pose = 'bloqueo'; squashY = 0.78; } // fallback: bloqueo achatado
      break;
    case 'camina':
      if (l.retro) { // paso atrás: guardia con rebote suave, sin pose de carrera
        pose = 'idle';
        dy = -Math.abs(Math.sin(r.tAnim * 8)) * 3;
        rot = -0.06;
      } else {
        pose = 'camina';
        dy = -Math.abs(Math.sin(r.tAnim * 10)) * 5;
      }
      break;
    case 'bloqueo': pose = 'bloqueo'; break;
    case 'ataque': pose = l.ataque === 'patada' ? 'patada' : 'punyo'; break;
    case 'especial':
      // cada especial con su sprite: cerca → 'especial', lejos → 'especial2'
      pose = (st.poses.especial2 && l.esp && l.espLejos && l.esp.nombre === l.espLejos.nombre)
        ? 'especial2' : 'especial';
      break;
    // Golpeado: usa el sprite real si el personaje lo tiene; si no,
    // guardia inclinada hacia atrás (como al retroceder, más marcada)
    case 'golpeado':
      if (st.poses.golpeado) pose = 'golpeado';
      else { pose = 'idle'; rot = -0.32; dy = 2; }
      break;
    case 'volando': pose = st.poses.golpeado ? 'golpeado' : 'salto'; rot = l.tEstado * 9; break;
    case 'derribado':
      if (st.poses.derribado) pose = 'derribado';
      else { pose = 'idle'; rot = -Math.PI * 0.47; } // sin pose tirado: acostar la guardia
      break;
    case 'levantarse': pose = l.tEstado < 0.15 && st.poses.derribado ? 'derribado' : 'idle'; break;
    case 'ko':
      if (st.poses.ko) pose = 'ko';
      else if (st.poses.derribado) pose = 'derribado';
      else { pose = 'idle'; rot = -Math.PI * 0.47; }
      if (l.tEstado > 1.0) alpha = Math.max(0, 1 - (l.tEstado - 1.0) * 2);
      break;
  }
  if (enAire && (pose === 'idle' || pose === 'camina')) pose = 'salto';
  if (l.entra > 0) rot += (l.entra / 0.45) * Math.PI * 2; // vuelta al relevar
  const img = st.poses[pose] || st.poses.idle;

  ctx.save();
  if (tinteEspejo(l)) ctx.filter = 'hue-rotate(150deg)';
  ctx.translate(r.x, piesY + dy);
  ctx.scale(l.dir, 1);
  if (rot) { ctx.translate(0, -ALTURA * 0.45); ctx.rotate(rot); ctx.translate(0, ALTURA * 0.45); }
  if (l.invuln > 0 && Math.floor(r.tAnim * 14) % 2 === 0) alpha = Math.min(alpha, 0.3);
  ctx.globalAlpha = alpha;

  if (l.estado === 'volando') lineasVelocidad(s, l.color);
  const esEspecial = l.estado === 'especial' && l.esp;
  if (esEspecial && l.esp.tipo === 'dash' && extEspecial(l).activo) lineasVelocidad(s, l.color);

  const w = img.width * f, h = img.height * f * squashY;
  ctx.drawImage(img, -w / 2, -h, w, h);

  if (l.estado === 'bloqueo') dibujarEscudo(s, r.tAnim);
  ctx.restore();

  if (!['ko', 'volando', 'derribado'].includes(l.estado) && nombre) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(nombre, r.x, piesY - ALTURA - 12);
  }
}

function dibujarLuchador(l, r, nombre) {
  const st = SPRITES[l.personaje];
  if (st && st.listo) { dibujarLuchadorSprite(l, r, nombre, st); return; }

  const s = l.escala * TAM;
  const piesY = SUELO - r.y;

  ctx.save();
  if (tinteEspejo(l)) ctx.filter = 'hue-rotate(150deg)';
  ctx.translate(r.x, piesY);
  ctx.scale(l.dir, 1); // espacio local: +x = hacia el rival

  if (l.estado === 'ko') {
    const t = Math.min(1, l.tEstado / 0.45);
    ctx.rotate(-t * Math.PI * 0.45);
    if (l.tEstado > 1.0) ctx.globalAlpha = Math.max(0, 1 - (l.tEstado - 1.0) * 2);
  } else if (l.estado === 'volando') {
    // Girando por los aires
    ctx.translate(0, -45 * s);
    ctx.rotate(l.tEstado * 9);
    ctx.translate(0, 45 * s);
    lineasVelocidad(s, l.color);
  } else if (l.estado === 'derribado') {
    ctx.rotate(-Math.PI * 0.45);
  } else if (l.estado === 'levantarse') {
    const q = Math.min(1, l.tEstado / 0.3);
    ctx.rotate(-Math.PI * 0.45 * (1 - q));
  }
  if (l.entra > 0) { // vuelta al relevar
    ctx.translate(0, -45 * s);
    ctx.rotate((l.entra / 0.45) * Math.PI * 2);
    ctx.translate(0, 45 * s);
  }

  if (l.invuln > 0 && Math.floor(r.tAnim * 14) % 2 === 0) ctx.globalAlpha = 0.3;

  const esEspecial = l.estado === 'especial' && l.esp;
  const fe = esEspecial ? extEspecial(l) : null;

  // Dash de Zoro: líneas de velocidad
  if (esEspecial && l.esp.tipo === 'dash' && fe.activo) lineasVelocidad(s, l.color);

  // ---- Pose base (guardia de pelea) ----
  const bob = Math.sin(r.tAnim * 4) * 1.5;
  const cadera = { x: 0, y: -46 * s + bob };
  let pieA = { x: 11 * s, y: 0 };
  let pieB = { x: -11 * s, y: 0 };
  let manoA = { x: 17 * s, y: cadera.y - 20 * s };
  let manoB = { x: 11 * s, y: cadera.y - 14 * s };
  let lean = 2 * s;

  const enAire = r.y > 0.5 && !['volando', 'ko'].includes(l.estado);

  if (l.estado === 'volando') {
    pieA = { x: 16 * s, y: -12 * s };
    pieB = { x: -14 * s, y: -6 * s };
    manoA = { x: 20 * s, y: cadera.y - 26 * s };
    manoB = { x: -16 * s, y: cadera.y - 20 * s };
  } else if (l.estado === 'derribado') {
    pieA = { x: 14 * s, y: -4 * s };
    pieB = { x: -8 * s, y: 0 };
    manoA = { x: 12 * s, y: cadera.y - 8 * s };
    manoB = { x: -8 * s, y: cadera.y - 6 * s };
  } else if (l.estado === 'levantarse') {
    cadera.y = -(28 + 18 * Math.min(1, l.tEstado / 0.3)) * s;
    manoA = { x: 16 * s, y: -6 * s };
    manoB = { x: 8 * s, y: -4 * s };
    lean = 8 * s;
  } else if (enAire && l.estado !== 'ataque' && !esEspecial) {
    pieA = { x: 13 * s, y: -16 * s };
    pieB = { x: -6 * s, y: -12 * s };
  } else if (l.estado === 'camina' && l.retro) {
    // Paso atrás cauteloso: erguido, guardia arriba, pasos cortos
    const c = r.tAnim * 8;
    lean = -3 * s;
    pieA = { x: (10 + Math.sin(c) * 8) * s, y: -Math.max(0, Math.cos(c)) * 4 * s };
    pieB = { x: (-10 - Math.sin(c) * 8) * s, y: -Math.max(0, -Math.cos(c)) * 4 * s };
  } else if (l.estado === 'camina') {
    // Carrera agazapada estilo stickfight: muy inclinado hacia adelante, zancada larga
    const c = r.tAnim * 11;
    cadera.y = -36 * s + bob;
    lean = 16 * s;
    pieA = { x: (14 + Math.sin(c) * 20) * s, y: -Math.max(0, Math.cos(c)) * 10 * s };
    pieB = { x: (-14 - Math.sin(c) * 20) * s, y: -Math.max(0, -Math.cos(c)) * 10 * s };
    manoA = { x: (20 + Math.sin(c + Math.PI) * 9) * s, y: cadera.y - 16 * s };
    manoB = { x: (10 + Math.sin(c) * 9) * s, y: cadera.y - 10 * s };
  } else if (l.estado === 'bloqueo') {
    // Guardia cerrada: encogido, brazos cruzados frente a la cara
    cadera.y = -34 * s + bob * 0.5;
    lean = 7 * s;
    pieA = { x: 15 * s, y: 0 };
    pieB = { x: -15 * s, y: 0 };
    manoA = { x: 14 * s, y: cadera.y - 30 * s };
    manoB = { x: 15 * s, y: cadera.y - 22 * s };
  } else if (l.estado === 'agachado') {
    // Agachado estilo Mortal Kombat: bien abajo, esquiva golpes altos
    cadera.y = -20 * s + bob * 0.4;
    lean = 6 * s;
    pieA = { x: 17 * s, y: 0 };
    pieB = { x: -17 * s, y: 0 };
    manoA = { x: 14 * s, y: cadera.y - 14 * s };
    manoB = { x: 8 * s, y: cadera.y - 10 * s };
  } else if (l.estado === 'golpeado') {
    lean = -10 * s;
    manoA = { x: -4 * s, y: cadera.y - 30 * s };
    manoB = { x: -10 * s, y: cadera.y - 24 * s };
  } else if (l.estado === 'ataque' && l.ataque) {
    const fa = faseAtaque(l);
    const ext = fa.fase === 'prep' ? fa.p * 0.25 : fa.fase === 'activo' ? 1 : 1 - fa.p;
    if (l.ataque === 'punyo') {
      lean = 5 * s;
      manoA = { x: (10 + ext * 52) * s, y: cadera.y - 26 * s };
      manoB = { x: 8 * s, y: cadera.y - 16 * s };
    } else {
      lean = -7 * s * ext;
      pieA = { x: (10 + ext * 68) * s, y: -(18 + ext * 20) * s };
      manoA = { x: 8 * s, y: cadera.y - 28 * s };
      manoB = { x: -14 * s, y: cadera.y - 24 * s };
    }
  } else if (esEspecial) {
    // Pose según el TIPO del especial en curso (sirve para cerca y lejos)
    const ext = fe.ext;
    const e = l.esp;
    if (l.personaje === 'sanji' && e.tipo === 'melee') {
      // Diable Jambe: patada alta en llamas
      lean = -8 * s * ext;
      pieA = { x: (10 + ext * 74) * s, y: -(22 + ext * 26) * s };
      manoA = { x: 6 * s, y: cadera.y - 28 * s };
      manoB = { x: -14 * s, y: cadera.y - 22 * s };
    } else if (e.tipo === 'melee') {
      // golpe estirado hasta su alcance real (Pistola Goma llega lejísimos)
      lean = 7 * s;
      manoA = { x: 10 * s + ext * Math.min(e.alcance, 220) * 0.95, y: cadera.y - 26 * s };
      manoB = { x: 4 * s, y: cadera.y - 14 * s };
    } else if (e.tipo === 'dash') {
      lean = 13 * s;
      cadera.y = -38 * s;
      manoA = { x: (20 + ext * 16) * s, y: cadera.y - 30 * s };
      manoB = { x: (10 + ext * 10) * s, y: cadera.y - 8 * s };
      pieA = { x: 18 * s, y: 0 };
      pieB = { x: -18 * s, y: 0 };
    } else if (e.tipo === 'proyectil') {
      lean = 6 * s;
      manoA = { x: (12 + ext * 40) * s, y: cadera.y - 26 * s };
      manoB = { x: -6 * s, y: cadera.y - 18 * s };
    } else if (e.tipo === 'rayo') {
      manoB = { x: 4 * s, y: cadera.y - (34 + ext * 14) * s };
      manoA = { x: 14 * s, y: cadera.y - 20 * s };
    } else if (e.tipo === 'cura') {
      cadera.y = -34 * s;
      manoA = { x: 12 * s, y: cadera.y - 18 * s };
      manoB = { x: 10 * s, y: cadera.y - 16 * s };
    } else if (e.tipo === 'agarre') {
      manoA = { x: 8 * s, y: cadera.y - 34 * s };
      manoB = { x: 12 * s, y: cadera.y - 32 * s };
    }
  }

  // Proporción chibi como la imagen: torso corto y cabeza grande
  const cuello = { x: lean, y: cadera.y - 26 * s };
  const cabeza = { x: cuello.x + 3 * s, y: cuello.y - 12 * s, r: 13 * s };

  // ---- Estelas de golpes ----
  if (l.estado === 'ataque' && l.ataque) {
    const fa = faseAtaque(l);
    if (fa.fase === 'activo') {
      if (l.ataque === 'punyo') estela(cuello, manoA, l.color);
      else estela(cadera, pieA, l.color);
    }
  } else if (esEspecial && fe.activo) {
    if (l.personaje === 'sanji' && l.esp.tipo === 'melee') {
      estela(cadera, pieA, '#ff9800');
      // llamas en la pierna
      ctx.save();
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = i === 0 ? '#fff59d' : '#ff9800';
        const q = 0.5 + i * 0.25;
        ctx.beginPath();
        ctx.arc(cadera.x + (pieA.x - cadera.x) * q, cadera.y + (pieA.y - cadera.y) * q, (7 - i) * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (['melee', 'dash'].includes(l.esp.tipo)) {
      estela(cuello, manoA, l.color);
    }
  }

  // ---- Cuerpo estilo One Piece: miembros negros gruesos + vestimenta ----
  const at = ATUENDOS[l.personaje] || {};
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Piernas (piel; el pantalón va encima)
  ctx.strokeStyle = PIEL;
  ctx.lineWidth = 6.5 * s;
  ctx.beginPath();
  miembro(cadera, pieA, 5 * s, 0);
  miembro(cadera, pieB, 4 * s, 0);
  ctx.stroke();

  // Pantalón completo o short (solo muslos)
  if (at.piernas) {
    ctx.strokeStyle = at.piernas;
    ctx.lineWidth = 8 * s;
    ctx.beginPath();
    if (at.piernasLargas) {
      miembro(cadera, pieA, 5 * s, 0);
      miembro(cadera, pieB, 4 * s, 0);
    } else {
      const rodA = { x: (cadera.x + pieA.x) / 2 + 5 * s, y: (cadera.y + pieA.y) / 2 };
      const rodB = { x: (cadera.x + pieB.x) / 2 + 4 * s, y: (cadera.y + pieB.y) / 2 };
      ctx.moveTo(cadera.x, cadera.y); ctx.lineTo(rodA.x, rodA.y);
      ctx.moveTo(cadera.x, cadera.y); ctx.lineTo(rodB.x, rodB.y);
    }
    ctx.stroke();
  }

  // Abrigo largo (Zoro) o falda (Robin), por encima de las piernas
  if (at.falda || at.abrigo) {
    ctx.fillStyle = at.falda || at.abrigo;
    ctx.beginPath();
    ctx.moveTo(cuello.x - 6 * s, cuello.y + (at.falda ? 16 : 2) * s);
    ctx.lineTo(cuello.x + 6 * s, cuello.y + (at.falda ? 16 : 2) * s);
    ctx.lineTo(cadera.x + 13 * s, cadera.y + (at.falda ? 32 : 26) * s);
    ctx.lineTo(cadera.x - 13 * s, cadera.y + (at.falda ? 32 : 26) * s);
    ctx.closePath();
    ctx.fill();
  }

  // Torso con volumen: polígono de hombros a cadera (complexión por personaje)
  const hw = (at.hombro || 7) * s;
  const cw = (at.caderaAncho || 5.5) * s;
  const hombroF = { x: cuello.x + hw * 0.85, y: cuello.y + 2.5 * s }; // hombro delantero
  const hombroT = { x: cuello.x - hw * 0.85, y: cuello.y + 2.5 * s }; // hombro trasero
  ctx.fillStyle = at.torso || NEGRO;
  ctx.strokeStyle = at.torso || NEGRO;
  ctx.lineWidth = 5 * s; // el trazo redondea los bordes del polígono
  ctx.beginPath();
  ctx.moveTo(hombroT.x, hombroT.y - 1.5 * s);
  ctx.lineTo(hombroF.x, hombroF.y - 1.5 * s);
  ctx.lineTo(cadera.x + cw, cadera.y + 2 * s);
  ctx.lineTo(cadera.x - cw, cadera.y + 2 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Pecho descubierto (chaleco/camisa abierta de Luffy y Franky)
  if (at.pecho && at.torso !== at.pecho) {
    ctx.fillStyle = at.pecho;
    ctx.beginPath();
    ctx.moveTo(cuello.x + 1 * s, cuello.y + 1 * s);
    ctx.lineTo(cuello.x + 4.5 * s, cuello.y + 1 * s);
    ctx.lineTo(cadera.x + 1 * s, cadera.y - 2 * s);
    ctx.lineTo(cadera.x - 2 * s, cadera.y - 2 * s);
    ctx.closePath();
    ctx.fill();
  }

  // Cuello
  ctx.strokeStyle = PIEL;
  ctx.lineWidth = 4 * s;
  ctx.beginPath();
  ctx.moveTo(cuello.x, cuello.y);
  ctx.lineTo(cuello.x + 1.5 * s, cuello.y - 6 * s);
  ctx.stroke();

  // Faja / cinturón (Zoro, Luffy)
  if (at.faja) {
    ctx.strokeStyle = at.faja;
    ctx.lineWidth = 6 * s;
    ctx.beginPath();
    ctx.moveTo(cadera.x - cw - 1.5 * s, cadera.y + 1 * s);
    ctx.lineTo(cadera.x + cw + 1.5 * s, cadera.y + 1 * s);
    ctx.stroke();
  }

  // Corbata de Sanji
  if (at.corbata) {
    ctx.strokeStyle = at.corbata;
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(cuello.x + 1 * s, cuello.y + 3 * s);
    ctx.lineTo(cuello.x + 1 * s, cuello.y + 14 * s);
    ctx.stroke();
  }

  // Collar de Ace
  if (at.collar) {
    ctx.fillStyle = at.collar;
    for (const dx of [-4, 0, 4]) {
      ctx.beginPath();
      ctx.arc(cuello.x + dx * s, cuello.y + (4 + Math.abs(dx) * 0.4) * s, 1.8 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Brazos desde los hombros
  ctx.strokeStyle = at.mangas || PIEL;
  ctx.lineWidth = 6 * s;
  ctx.beginPath();
  miembro(hombroF, manoA, -2 * s, 5 * s);
  miembro(hombroT, manoB, -3 * s, 5 * s);
  ctx.stroke();

  // Franky: hombreras y antebrazos gigantes (BF-37)
  if (at.brazosGruesos) {
    const codoA = { x: (hombroF.x + manoA.x) / 2 - 2 * s, y: (hombroF.y + manoA.y) / 2 + 5 * s };
    const codoB = { x: (hombroT.x + manoB.x) / 2 - 3 * s, y: (hombroT.y + manoB.y) / 2 + 5 * s };
    ctx.strokeStyle = at.brazosGruesos;
    ctx.lineWidth = 14 * s;
    ctx.beginPath();
    ctx.moveTo(codoA.x, codoA.y); ctx.lineTo(manoA.x, manoA.y);
    ctx.moveTo(codoB.x, codoB.y); ctx.lineTo(manoB.x, manoB.y);
    ctx.stroke();
    ctx.fillStyle = at.brazosGruesos;
    ctx.beginPath();
    ctx.arc(hombroF.x + 1 * s, hombroF.y - 1 * s, 6 * s, 0, Math.PI * 2);
    ctx.arc(hombroT.x - 1 * s, hombroT.y - 1 * s, 6 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Puños (Franky los tiene de robot)
  const puñoR = (at.brazosGruesos ? 7 : 3.6) * s;
  ctx.fillStyle = at.brazosGruesos || PIEL;
  ctx.beginPath();
  ctx.arc(manoA.x, manoA.y, puñoR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(manoB.x, manoB.y, puñoR, 0, Math.PI * 2);
  ctx.fill();

  // Zapatos
  ctx.fillStyle = at.zapatos || NEGRO;
  for (const pie of [pieA, pieB]) {
    ctx.beginPath();
    ctx.ellipse(pie.x + 2.5 * s, pie.y - 1.6 * s, 5.5 * s, 3 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Afro de Brook (detrás de la cabeza)
  if (at.pelo === 'afro') {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(cabeza.x, cabeza.y - cabeza.r * 0.35, cabeza.r * 1.55, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cabeza blanca con cara vacía (como la imagen)
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = NEGRO;
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.arc(cabeza.x, cabeza.y, cabeza.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Pelo: casquete de color y melena si aplica
  if (at.pelo && at.pelo !== 'afro') {
    ctx.fillStyle = at.pelo;
    ctx.beginPath();
    ctx.arc(cabeza.x, cabeza.y, cabeza.r + 0.5, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    if (l.personaje === 'sanji') { // flequillo sobre un ojo
      ctx.beginPath();
      ctx.ellipse(cabeza.x + cabeza.r * 0.45, cabeza.y - cabeza.r * 0.1, cabeza.r * 0.5, cabeza.r * 0.7, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (at.peloLargo) {
    ctx.strokeStyle = at.pelo;
    ctx.lineWidth = 4.5 * s;
    ctx.beginPath();
    ctx.moveTo(cabeza.x - cabeza.r * 0.8, cabeza.y - cabeza.r * 0.3);
    ctx.quadraticCurveTo(cabeza.x - cabeza.r * 1.7, cuello.y + 4 * s, cabeza.x - cabeza.r * 1.3, cuello.y + 16 * s);
    ctx.stroke();
  }

  // Robin (Mano Fleur): manos moradas brotando frente al rival
  if (esEspecial && l.esp.tipo === 'agarre' && l.personaje === 'robin' && fe.activo) {
    ctx.save();
    ctx.strokeStyle = '#ce93d8';
    ctx.lineWidth = 4 * s;
    for (const dx of [0.6, 0.8, 1.0]) {
      const bx = l.esp.alcance * dx; // px reales: donde de verdad atrapa
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx - 4 * s, -24 * s);
      ctx.moveTo(bx - 4 * s, -24 * s);
      ctx.lineTo(bx - 10 * s, -30 * s);
      ctx.moveTo(bx - 4 * s, -24 * s);
      ctx.lineTo(bx + 2 * s, -31 * s);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Accesorios del personaje
  dibujarProps(l, s, cabeza, cuello, manoA, manoB, esEspecial && fe.activo);

  // Escudo visible al bloquear (pulsa suavemente)
  if (l.estado === 'bloqueo') dibujarEscudo(s, r.tAnim);

  ctx.restore();

  // Etiqueta con el nombre del jugador
  if (!['ko', 'volando', 'derribado'].includes(l.estado) && nombre) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(nombre, r.x, piesY - 112 * s);
  }
}

// ------------------------------------------------------------
// HUD
// ------------------------------------------------------------
// Vida "que se desangra" estilo Mortal Kombat: el daño reciente queda como
// franja clara y se drena de a poco hacia la vida real (por lado)
const hudVida = [
  { mostrado: 0, max: 0 },
  { mostrado: 0, max: 0 },
];
let dtFrame = 1 / 60;

function dibujarHUD() {
  estadoSrv.jugadores.forEach((j, i) => {
    const l = j.luchador;
    const w = 340;
    const x = i === 0 ? 24 : ANCHO - 24 - w;
    const y = 20;

    // barra que se llena desde el borde exterior (espejo según lado)
    const barra = (frac, yy, hh, color) => {
      ctx.fillStyle = color;
      const bw = w * Math.max(0, Math.min(1, frac));
      if (i === 0) ctx.fillRect(x, yy, bw, hh);
      else ctx.fillRect(x + w - bw, yy, bw, hh);
    };

    // desangrado: cae rápido si el hueco es grande, lento al final
    const hv = hudVida[i];
    if (hv.max !== l.hpMax || l.hp > hv.mostrado) { hv.mostrado = l.hp; hv.max = l.hpMax; }
    else if (hv.mostrado > l.hp) {
      hv.mostrado = Math.max(l.hp, hv.mostrado - Math.max((hv.mostrado - l.hp) * 3, 14) * dtFrame);
    }

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - 8, y - 8, w + 16, 100);

    // --- Vida (con fantasma del daño reciente) ---
    ctx.fillStyle = '#262626';
    ctx.fillRect(x, y, w, 20);
    barra(hv.mostrado / l.hpMax, y, 20, '#ffcdd2');
    const fv = Math.max(0, l.hp / l.hpMax);
    barra(fv, y, 20, fv > 0.5 ? '#66bb6a' : fv > 0.25 ? '#ffa726' : '#ef5350');
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, 20);

    // --- Estamina ---
    ctx.fillStyle = '#262626';
    ctx.fillRect(x, y + 26, w, 7);
    barra(l.stamina / 100, y + 26, 7, '#29b6f6');

    // --- Los dos especiales: cerca (Ctrl) y a distancia (Shift) ---
    const medidores = [
      { e: l.espCerca, tecla: 'Ctrl', yy: y + 37 },
      { e: l.espLejos, tecla: 'Shift', yy: y + 48 },
    ];
    for (const m of medidores) {
      const we = Math.round(w * 0.42);
      const xe = i === 0 ? x : x + w - we;
      // Listo cuando alcanza la estamina Y ya pasó el cooldown (la Cura tiene 5 s)
      const fSta = Math.min(1, l.stamina / m.e.costo);
      const fCd = m.e.cdMax > 0 ? 1 - Math.min(1, (m.e.cd || 0) / m.e.cdMax) : 1;
      const fEsp = Math.min(fSta, fCd);
      const listo = fEsp >= 1;
      ctx.fillStyle = '#262626';
      ctx.fillRect(xe, m.yy, we, 8);
      ctx.save();
      if (listo) {
        ctx.shadowColor = '#ffd54f';
        ctx.shadowBlur = 8 + Math.sin(performance.now() / 120) * 4;
      }
      ctx.fillStyle = listo ? '#ffd54f' : '#8d6e63';
      const bwE = we * fEsp;
      ctx.fillRect(i === 0 ? xe : xe + we - bwE, m.yy, bwE, 8);
      ctx.restore();
      ctx.strokeStyle = listo ? '#fff59d' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(xe, m.yy, we, 8);

      ctx.fillStyle = listo ? '#ffe082' : 'rgba(255,255,255,0.45)';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = i === 0 ? 'left' : 'right';
      const etiqueta = listo
        ? '⚡' + m.e.nombre + (i === miLado ? ' (' + m.tecla + ')' : '')
        : m.e.nombre + ' ' + Math.floor(fEsp * 100) + '%';
      ctx.fillText(etiqueta, i === 0 ? xe + we + 6 : xe - 6, m.yy + 7);
    }

    // --- Nombre y fichas del equipo ---
    const quien = (estadoSrv.nombres[i] || '???') + ' — ' + l.nombreDef + (i === miLado ? ' (tú)' : '');
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px monospace';
    ctx.textAlign = i === 0 ? 'left' : 'right';
    ctx.fillText(quien, i === 0 ? x : x + w, y + 76);

    // Fichas del equipo (relevo): color=vivo, gris+✕=K.O., aro=activo, mini-vida y tecla
    const vidas = j.vidas || j.colores.map((c, k) => ({ hp: 1, hpMax: 1, ko: k < j.indice }));
    for (let k = 0; k < j.colores.length; k++) {
      const cx = i === 0 ? x + w - 16 - (j.colores.length - 1 - k) * 30 : x + 16 + (j.colores.length - 1 - k) * 30;
      const cy = y + 66;
      const v = vidas[k];
      const activo = k === j.indice;
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fillStyle = v.ko ? '#3a3a3a' : j.colores[k];
      ctx.fill();
      if (activo && estadoSrv.pantalla === 'pelea') {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
      }
      if (v.ko) { // ✕ de eliminado
        ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx + 5, cy + 5);
        ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx - 5, cy + 5);
        ctx.stroke();
      } else { // mini-vida bajo la ficha
        const bw = 24, bx = cx - bw / 2, by = cy + 12;
        ctx.fillStyle = '#262626'; ctx.fillRect(bx, by, bw, 4);
        const f = Math.max(0, Math.min(1, v.hp / v.hpMax));
        ctx.fillStyle = f > 0.5 ? '#66bb6a' : f > 0.25 ? '#ffa726' : '#ef5350';
        ctx.fillRect(bx, by, bw * f, 4);
      }
      if (i === miLado) { // número de tecla para tu propio equipo
        ctx.fillStyle = activo ? '#fff' : 'rgba(255,255,255,0.7)';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(k + 1), cx, cy - 13);
      }
    }
  });
}

function dibujarAnuncio() {
  const a = estadoSrv.anuncio;
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

function dibujarFin() {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, ANCHO, ALTO);
  ctx.textAlign = 'center';
  const nombre = estadoSrv.nombres[estadoSrv.ganador] || 'Jugador ' + (estadoSrv.ganador + 1);
  ctx.fillStyle = estadoSrv.ganador === 0 ? '#42a5f5' : '#ef5350';
  ctx.font = 'bold 56px "Segoe UI", sans-serif';
  ctx.shadowColor = 'rgba(255,255,255,0.6)';
  ctx.shadowBlur = 20;
  ctx.fillText('¡GANA ' + nombre.toUpperCase() + '!', ANCHO / 2, ALTO / 2 - 20);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.font = '22px "Segoe UI", sans-serif';
  if (miLado !== null) ctx.fillText('R: revancha · E: elegir otros personajes', ANCHO / 2, ALTO / 2 + 40);
  else ctx.fillText('Esperando revancha…', ANCHO / 2, ALTO / 2 + 40);
}

// ------------------------------------------------------------
// Bucle de render (60 fps, interpolando las instantáneas)
// ------------------------------------------------------------
const render = [
  { x: 260, y: 0, tAnim: Math.random() * 10 },
  { x: ANCHO - 260, y: 0, tAnim: Math.random() * 10 },
];

let ultimo = performance.now();

function bucle(ahora) {
  const dt = Math.min(0.05, (ahora - ultimo) / 1000);
  ultimo = ahora;
  dtFrame = dt;
  diag.frames++;

  dibujarFondo();
  actualizarEfectos(dt);

  if (estadoSrv && estadoSrv.jugadores) {
    estadoSrv.jugadores.forEach((j, i) => {
      const l = j.luchador;
      const r = render[i];
      r.tAnim += dt;

      // PREDICCIÓN LOCAL (reduce el lag percibido): TU personaje se mueve
      // al instante con tu teclado; el servidor solo corrige suavemente.
      const esMio = i === miLado && estadoSrv.pantalla === 'pelea';
      const predecible = esMio && ['idle', 'camina', 'ataque'].includes(l.estado);
      if (predecible) {
        let m = 0;
        if (mantener.izq) m -= 1;
        if (mantener.der) m += 1;
        if (m !== 0) {
          const retro = m * l.dir < 0;
          r.x += m * (l.vel || 660) * (retro ? 0.6 : 1) * dt;
          r.x = Math.max(45, Math.min(ANCHO - 45, r.x));
        }
      }

      // corrección: suave para el propio (predicho), dura para el rival
      const k = Math.min(1, dt * (predecible ? 6 : 24));
      r.x += (l.x - r.x) * k;
      r.y += (l.y - r.y) * k;
      if (Math.abs(l.x - r.x) > 200) r.x = l.x; // cambio de personaje: no deslizar
    });

    estadoSrv.jugadores.forEach((j, i) => dibujarSombra(j.luchador, render[i]));
    dibujarProyectiles();
    estadoSrv.jugadores.forEach((j, i) => dibujarLuchador(j.luchador, render[i], estadoSrv.nombres[i]));
    dibujarEfectos();
    dibujarHUD();

    // Ping en la esquina (verde <80ms, amarillo <150, rojo si va mal)
    if (ping > 0 && miLado !== null) {
      ctx.fillStyle = ping < 80 ? '#66bb6a' : ping < 150 ? '#ffa726' : '#ef5350';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(ping + ' ms', ANCHO - 10, ALTO - 10);
    }
    if (estadoSrv.anuncio && estadoSrv.anuncio.t > 0) dibujarAnuncio();
    if (estadoSrv.pantalla === 'fin') dibujarFin();
  } else {
    dibujarEfectos();
  }

  requestAnimationFrame(bucle);
}

requestAnimationFrame(bucle);
