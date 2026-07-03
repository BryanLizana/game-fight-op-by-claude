'use strict';

// ============================================================
// FIGHT OP — servidor multijugador online
// El servidor es el árbitro: simula toda la pelea a 60 Hz y
// envía el estado a los clientes a 30 Hz. Los clientes solo
// mandan sus teclas y dibujan lo que reciben.
//
// v0.3: 10 personajes de One Piece (elige 3), movimientos
// especiales, proyectiles y estados de pelea estilo stickman
// (lanzamiento por los aires, derribado, levantarse).
// ============================================================

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
// Para medir la latencia HTTP pura (diagnóstico de ping en el cliente)
app.get('/salud', (req, res) => res.json({ ok: true, t: Date.now() }));
const servidor = http.createServer(app);
const io = new Server(servidor);

const PUERTO = process.env.PORT || 3000;

// ------------------------------------------------------------
// Constantes del juego
// ------------------------------------------------------------
const ANCHO = 960;
const SUELO = 540 - 70;
const GRAVEDAD = 5000;   // salto seco y rápido
const VEL_SALTO = 1495;  // salto alto (~224 px de altura)
const COOLDOWN_SALTO = 0.80; // seg. que hay que estar en el suelo antes de poder saltar otra vez (mata el vuelo por machaque)
const COOLDOWN_CAMBIO = 3.0;  // seg. de espera entre relevos de personaje
const T_ENTRADA = 0.45;       // duración del giro de entrada al relevar
const RITMO = 2;         // multiplicador global: movimiento y velocidad de los ataques
const BUFER_INPUT = 0.25; // segundos que un click/tecla queda guardado esperando su frame
const STAMINA_MAX = 100;

// --- Los 10 personajes (cada jugador elige 3) ---
// Velocidad uniforme estilo Mortal Kombat: todos se mueven casi igual;
// la identidad está en vida, daño, tamaño y los DOS especiales:
// cerca (Ctrl) y a distancia (Shift).
const PERSONAJES = {
  luffy:   { nombre: 'Luffy',   color: '#e53935', hp: 110, velocidad: 330, dmgMult: 1.1,  escala: 1.0,  regen: 28, cerca: 'pistolaGoma',  lejos: 'bazookaGoma' },
  zoro:    { nombre: 'Zoro',    color: '#43a047', hp: 115, velocidad: 330, dmgMult: 1.15, escala: 1.02, regen: 25, cerca: 'onigiri',      lejos: 'corteViento' },
  sanji:   { nombre: 'Sanji',   color: '#fdd835', hp: 100, velocidad: 360, dmgMult: 1.0,  escala: 1.0,  regen: 32, cerca: 'diableJambe',  lejos: 'llamaPatada' },
  nami:    { nombre: 'Nami',    color: '#fb8c00', hp: 85,  velocidad: 330, dmgMult: 0.85, escala: 0.95, regen: 34, cerca: 'golpeClima',   lejos: 'thunderbolt' },
  usopp:   { nombre: 'Usopp',   color: '#8d6e63', hp: 80,  velocidad: 330, dmgMult: 0.8,  escala: 0.97, regen: 36, cerca: 'martillo',     lejos: 'plantaEstrella' },
  chopper: { nombre: 'Chopper', color: '#ec407a', hp: 90,  velocidad: 330, dmgMult: 0.9,  escala: 0.85, regen: 32, cerca: 'cuernoPoint',  lejos: 'cura' },
  franky:  { nombre: 'Franky',  color: '#00acc1', hp: 140, velocidad: 300, dmgMult: 1.35, escala: 1.15, regen: 19, cerca: 'strongRight',  lejos: 'radicalBeam' },
  brook:   { nombre: 'Brook',   color: '#b0bec5', hp: 85,  velocidad: 345, dmgMult: 0.95, escala: 1.05, regen: 30, cerca: 'estocada',     lejos: 'notaCortante' },
  robin:   { nombre: 'Robin',   color: '#8e24aa', hp: 95,  velocidad: 330, dmgMult: 1.0,  escala: 1.0,  regen: 28, cerca: 'manoFleur',    lejos: 'milFleurs' },
  ace:     { nombre: 'Ace',     color: '#ff7043', hp: 105, velocidad: 330, dmgMult: 1.15, escala: 1.0,  regen: 25, cerca: 'punoIgneo',    lejos: 'punoFuego' },
};

// --- Movimientos especiales (1 por personaje) ---
// tipo: melee | dash | proyectil | rayo | cura | agarre
// lanza: true → manda al rival volando (estado 'volando' → 'derribado')
const ESPECIALES = {
  pistolaGoma:    { nombre: 'Pistola Goma',      tipo: 'melee',     startup: 0.18, activo: 0.12, recuperacion: 0.30, alcance: 200, dmg: 14, stamina: 32, empuje: 350, stun: 0.40 },
  onigiri:        { nombre: 'Onigiri',           tipo: 'dash',      startup: 0.12, activo: 0.22, recuperacion: 0.25, velocidad: 1600, dmg: 16, stamina: 34, empuje: 220, stun: 0.45 },
  diableJambe:    { nombre: 'Diable Jambe',      tipo: 'melee',     startup: 0.12, activo: 0.10, recuperacion: 0.22, alcance: 100, dmg: 13, stamina: 28, empuje: 380, stun: 0.40, lanza: true },
  thunderbolt:    { nombre: 'Thunderbolt Tempo', tipo: 'rayo',      startup: 0.35, activo: 0,    recuperacion: 0.30, dmg: 18, stamina: 40, empuje: 100, stun: 0.60 },
  plantaEstrella: { nombre: 'Planta Estrella',   tipo: 'proyectil', startup: 0.22, activo: 0,    recuperacion: 0.30, proyectil: 'estrella', altura: 48, radio: 8,  velocidad: 810, dmg: 12, stamina: 26, empuje: 220, stun: 0.35 },
  cura:           { nombre: 'Cura',              tipo: 'cura',      startup: 0.50, activo: 0,    recuperacion: 0.40, curacion: 22, stamina: 45, cooldown: 5 },
  strongRight:    { nombre: 'Strong Right',      tipo: 'melee',     startup: 0.28, activo: 0.12, recuperacion: 0.40, alcance: 90, dmg: 24, stamina: 40, empuje: 520, stun: 0.60, lanza: true },
  notaCortante:   { nombre: 'Nota Cortante',     tipo: 'proyectil', startup: 0.18, activo: 0,    recuperacion: 0.25, proyectil: 'nota', altura: 48, radio: 10, velocidad: 930, dmg: 11, stamina: 24, empuje: 180, stun: 0.30 },
  manoFleur:      { nombre: 'Mano Fleur',        tipo: 'agarre',    startup: 0.20, activo: 0,    recuperacion: 0.35, alcance: 170, dmg: 10, stamina: 34, empuje: 0, stun: 0.90 },
  punoFuego:      { nombre: 'Puño de Fuego',     tipo: 'proyectil', startup: 0.30, activo: 0,    recuperacion: 0.35, proyectil: 'fuego', altura: 16, radio: 14, velocidad: 570, dmg: 20, stamina: 38, empuje: 420, stun: 0.50, lanza: true },

  // --- Especiales de cerca nuevos ---
  golpeClima:     { nombre: 'Golpe Clima',       tipo: 'melee',     startup: 0.14, activo: 0.10, recuperacion: 0.24, alcance: 95,  dmg: 12, stamina: 26, empuje: 260, stun: 0.55 },
  martillo:       { nombre: 'Martillo Usopp',    tipo: 'melee',     startup: 0.22, activo: 0.10, recuperacion: 0.30, alcance: 85,  dmg: 16, stamina: 30, empuje: 380, stun: 0.50, lanza: true },
  cuernoPoint:    { nombre: 'Cuerno Point',      tipo: 'dash',      startup: 0.12, activo: 0.20, recuperacion: 0.25, velocidad: 1400, dmg: 14, stamina: 30, empuje: 420, stun: 0.45, lanza: true },
  estocada:       { nombre: 'Estocada',          tipo: 'melee',     startup: 0.10, activo: 0.08, recuperacion: 0.20, alcance: 120, dmg: 12, stamina: 24, empuje: 200, stun: 0.35 },
  punoIgneo:      { nombre: 'Puño Ígneo',        tipo: 'melee',     startup: 0.16, activo: 0.10, recuperacion: 0.28, alcance: 90,  dmg: 17, stamina: 32, empuje: 420, stun: 0.45, lanza: true },

  // --- Especiales a distancia nuevos ---
  bazookaGoma:    { nombre: 'Bazooka Goma',      tipo: 'proyectil', startup: 0.34, activo: 0,    recuperacion: 0.40, proyectil: 'onda',  altura: 45, radio: 18, velocidad: 700,  dmg: 18, stamina: 42, empuje: 500, stun: 0.50, lanza: true },
  corteViento:    { nombre: 'Corte de Viento',   tipo: 'proyectil', startup: 0.20, activo: 0,    recuperacion: 0.30, proyectil: 'tajo',  altura: 45, radio: 12, velocidad: 900,  dmg: 12, stamina: 30, empuje: 220, stun: 0.35 },
  llamaPatada:    { nombre: 'Llama Voladora',    tipo: 'proyectil', startup: 0.18, activo: 0,    recuperacion: 0.25, proyectil: 'llama', altura: 40, radio: 10, velocidad: 820,  dmg: 11, stamina: 28, empuje: 200, stun: 0.30 },
  radicalBeam:    { nombre: 'Radical Beam',      tipo: 'proyectil', startup: 0.30, activo: 0,    recuperacion: 0.35, proyectil: 'laser', altura: 50, radio: 8,  velocidad: 1200, dmg: 16, stamina: 36, empuje: 260, stun: 0.40 },
  milFleurs:      { nombre: 'Mil Fleurs',        tipo: 'rayo',      startup: 0.30, activo: 0,    recuperacion: 0.35, visual: 'brote', dmg: 14, stamina: 36, empuje: 120, stun: 0.70 },
};

// --- Ataques básicos ---
const ATAQUES = {
  punyo:  { startup: 0.08, activo: 0.10, recuperacion: 0.12, alcance: 62, dmg: 8,  stamina: 10, empuje: 140, stun: 0.26, alto: true }, // agachado lo esquiva
  patada: { startup: 0.16, activo: 0.12, recuperacion: 0.20, alcance: 92, dmg: 15, stamina: 20, empuje: 300, stun: 0.40 },
};

// ------------------------------------------------------------
// Partida (una sola sala: 2 jugadores, el resto mira)
// ------------------------------------------------------------
const partida = {
  pantalla: 'espera',          // espera | pelea | fin
  lados: [null, null],         // { id, nombre, equipo, mantener, pulsos }
  jugadores: null,             // [{ roster, indice, luchador }]
  proyectiles: [],
  eventos: [],                 // efectos visuales para el cliente (se vacían al transmitir)
  ganador: null,
  anuncio: { texto: '', t: 0 },
};

function anunciar(texto, dur = 1.5) {
  partida.anuncio = { texto, t: dur };
}

function evento(tipo, x, y, color, valor) {
  partida.eventos.push({ tipo, x: Math.round(x), y: Math.round(y), color, valor });
}

// ------------------------------------------------------------
// Golpes: un solo punto de entrada para todo el daño
// ------------------------------------------------------------
function aplicarGolpe(rival, g) {
  if (['ko', 'volando', 'derribado'].includes(rival.estado) || rival.invuln > 0) return false;

  let danoNum = 0; // daño real infligido, para el número flotante del cliente

  if (rival.estado === 'bloqueo') {
    danoNum = g.dmg * 0.15;
    rival.stamina -= g.dmg * 1.5;
    rival.hp -= g.dmg * 0.15;
    rival.vx = g.dir * g.empuje * 0.4;
    evento('bloqueo', rival.x, 55, rival.color);
    if (rival.stamina <= 0) {
      rival.stamina = 0;
      rival.estado = 'golpeado';
      rival.tEstado = 0.7;
      anunciar('¡Guardia rota!');
    }
  } else {
    danoNum = g.dmg;
    rival.hp -= g.dmg;
    rival.vx = g.dir * g.empuje;
    if (g.lanza && rival.hp > 0) {
      rival.estado = 'volando';
      rival.tEstado = 0;
      rival.vy = 550; // recalibrado a la gravedad alta
      rival.y = Math.max(rival.y, 0.02);
      evento('lanzamiento', rival.x, 55, g.color);
    } else {
      rival.estado = 'golpeado';
      rival.tEstado = g.stun;
      evento('golpe', rival.x, 55, g.color);
    }
  }

  if (rival.hp <= 0) {
    rival.hp = 0;
    rival.estado = 'ko';
    rival.tEstado = 0;
    rival.vx = g.dir * Math.max(320, g.empuje * 1.5);
    rival.vy = 480;
    rival.y = Math.max(rival.y, 0.02);
    anunciar('¡K.O.!');
    evento('ko', rival.x, 55, g.color);
  }

  // Número de daño flotante (rojo) sobre el que recibe el golpe
  if (danoNum > 0) evento('dano', rival.x, 100 + rival.y, '#ff3b3b', Math.round(danoNum));
  return true;
}

// ------------------------------------------------------------
// Luchador
// ------------------------------------------------------------
class Luchador {
  constructor(lado, def, x, dir, hp = def.hp, stamina = STAMINA_MAX) {
    this.lado = lado;
    this.def = def;
    this.x = x;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.dir = dir;
    this.hp = hp;
    this.stamina = stamina;
    // idle | camina | bloqueo | ataque | especial | golpeado | volando | derribado | levantarse | ko
    this.estado = 'idle';
    this.ataque = null;
    this.tAtaque = 0;
    this.golpeDado = false;
    this.tEstado = 0;
    this.invuln = 1.0;
    this.retirado = false;
    this.retrocede = false;
    this.tEnSuelo = 999; // segundos acumulados en el suelo (para el cooldown de salto)
    this.entra = 0;      // temporizador del giro de entrada al relevar
    this.cds = {};       // cooldowns por especial (hoy solo la Cura los usa)
  }

  get enSuelo() { return this.y <= 0.001; }
  get color() { return this.def.color; }

  actualizar(dt, rival, entrada) {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.entra > 0) this.entra = Math.max(0, this.entra - dt);
    for (const k in this.cds) this.cds[k] = Math.max(0, this.cds[k] - dt);

    // Física vertical
    if (this.y > 0 || this.vy !== 0) {
      this.y += this.vy * dt;
      this.vy -= GRAVEDAD * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; }
    }

    // Tiempo acumulado en el suelo (se reinicia a 0 en el aire).
    this.tEnSuelo = this.enSuelo ? this.tEnSuelo + dt : 0;

    // No se puede saltar en el aire NI justo al aterrizar: mientras no lleves
    // el cooldown en el suelo se descarta cualquier salto en cola. Así un
    // espacio presionado en el aire o al caer no se encola para autodispararse:
    // hay que estar un mínimo en tierra y volver a presionar. Adiós al vuelo.
    if (this.tEnSuelo < COOLDOWN_SALTO && entrada.bufer.salto > 0) entrada.bufer.salto = 0;

    // Empuje horizontal con freno
    this.x += this.vx * dt;
    this.vx *= Math.max(0, 1 - 6 * dt);
    if (Math.abs(this.vx) < 5) this.vx = 0;

    if (this.estado === 'ko') { this.tEstado += dt; return; }

    // Lanzado por los aires: gira hasta tocar el suelo
    if (this.estado === 'volando') {
      this.tEstado += dt;
      if (this.enSuelo) { this.estado = 'derribado'; this.tEstado = 0; }
      return;
    }

    // En el suelo, indefenso pero intocable (como en el video)
    if (this.estado === 'derribado') {
      this.tEstado += dt;
      if (this.tEstado > 0.55) { this.estado = 'levantarse'; this.tEstado = 0; }
      return;
    }

    // Levantándose apoyado en manos y rodillas: vulnerable
    if (this.estado === 'levantarse') {
      this.tEstado += dt;
      if (this.tEstado > 0.3) this.estado = 'idle';
      return;
    }

    if (this.estado === 'golpeado') {
      this.tEstado -= dt;
      if (this.tEstado <= 0) this.estado = 'idle';
      return;
    }

    if (this.estado === 'ataque') {
      // Movimiento libre durante los golpes: se puede correr/saltar y pegar a la vez
      this.mover(dt, entrada);
      this.intentarSalto(entrada);
      this.actualizarAtaque(dt, rival, entrada);
      return;
    }
    if (this.estado === 'especial') { this.actualizarEspecial(dt, rival); return; }

    // --- Controles ---
    if (entrada.mantener.bloqueo && this.enSuelo && this.stamina > 0) {
      this.estado = 'bloqueo';
      return;
    }

    // Agacharse (estilo Mortal Kombat): esquiva puños y proyectiles altos
    if (entrada.mantener.abajo && this.enSuelo) {
      this.estado = 'agachado';
      this.retrocede = false;
      this.stamina = Math.min(STAMINA_MAX, this.stamina + this.def.regen * dt);
      return;
    }

    if (entrada.bufer.especial > 0 && this.iniciarEspecial('cerca')) entrada.bufer.especial = 0;
    else if (entrada.bufer.especial2 > 0 && this.iniciarEspecial('lejos')) entrada.bufer.especial2 = 0;
    else if (entrada.bufer.punyo > 0 && this.iniciarAtaque('punyo')) entrada.bufer.punyo = 0;
    else if (entrada.bufer.patada > 0 && this.iniciarAtaque('patada')) entrada.bufer.patada = 0;
    if (this.estado === 'ataque' || this.estado === 'especial') return;

    const mov = this.mover(dt, entrada);
    this.estado = mov !== 0 ? 'camina' : 'idle';

    this.intentarSalto(entrada);

    this.stamina = Math.min(STAMINA_MAX, this.stamina + this.def.regen * dt);
  }

  // Solo salta si llevas el cooldown en el suelo (tEnSuelo solo crece en tierra)
  intentarSalto(entrada) {
    if (entrada.bufer.salto > 0 && this.tEnSuelo >= COOLDOWN_SALTO) {
      entrada.bufer.salto = 0;
      this.vy = VEL_SALTO;
      this.y = 0.01;
      this.tEnSuelo = 0;
    }
  }

  // Movimiento con izq/der (retroceder es más lento, como en los juegos de pelea)
  mover(dt, entrada) {
    let mov = 0;
    if (entrada.mantener.izq) mov -= 1;
    if (entrada.mantener.der) mov += 1;
    this.retrocede = mov !== 0 && mov * this.dir < 0;
    this.x += mov * this.def.velocidad * RITMO * (this.retrocede ? 0.6 : 1) * dt;
    return mov;
  }

  // --- Ataques básicos ---
  iniciarAtaque(nombre) {
    const a = ATAQUES[nombre];
    if (this.stamina < a.stamina) return false;
    this.stamina -= a.stamina;
    this.estado = 'ataque';
    this.ataque = nombre;
    this.tAtaque = 0;
    this.golpeDado = false;
    return true;
  }

  actualizarAtaque(dt, rival, entrada) {
    this.tAtaque += dt * RITMO; // los golpes salen y recuperan al doble
    const a = ATAQUES[this.ataque];
    // El puño es golpe alto: un rival agachado lo esquiva
    if (a.alto && rival.estado === 'agachado') { /* pasa de largo */ }
    else if (this.tAtaque >= a.startup && this.tAtaque < a.startup + a.activo && !this.golpeDado && this.alcanzaA(rival, a.alcance)) {
      this.golpeDado = true;
      aplicarGolpe(rival, { dmg: a.dmg * this.def.dmgMult, empuje: a.empuje, stun: a.stun, dir: this.dir, color: this.color });
    }

    // Cancelación estilo Mortal Kombat: pasada la fase activa, el input
    // guardado en el búfer corta la recuperación y sale de inmediato
    if (entrada && this.tAtaque >= a.startup + a.activo) {
      if (entrada.bufer.especial > 0 && this.iniciarEspecial('cerca')) { entrada.bufer.especial = 0; return; }
      if (entrada.bufer.especial2 > 0 && this.iniciarEspecial('lejos')) { entrada.bufer.especial2 = 0; return; }
      if (entrada.bufer.punyo > 0 && this.iniciarAtaque('punyo')) { entrada.bufer.punyo = 0; return; }
      if (entrada.bufer.patada > 0 && this.iniciarAtaque('patada')) { entrada.bufer.patada = 0; return; }
    }

    if (this.tAtaque >= a.startup + a.activo + a.recuperacion) {
      this.estado = 'idle';
      this.ataque = null;
    }
  }

  alcanzaA(rival, alcance) {
    if (['ko', 'volando', 'derribado'].includes(rival.estado) || rival.invuln > 0) return false;
    const dist = (rival.x - this.x) * this.dir;
    return dist > -10 && dist < alcance * this.def.escala + 18 && Math.abs(rival.y - this.y) < 70;
  }

  // --- Movimiento especial del personaje ---
  iniciarEspecial(cual = 'cerca') {
    const nombre = this.def[cual];
    const e = ESPECIALES[nombre];
    if (e.cooldown && this.cds[nombre] > 0) return false;
    if (this.stamina < e.stamina) return false;
    this.stamina -= e.stamina;
    if (e.cooldown) this.cds[nombre] = e.cooldown;
    this.espActual = nombre;
    this.estado = 'especial';
    this.ataque = null;
    this.tAtaque = 0;
    this.golpeDado = false;
    return true;
  }

  actualizarEspecial(dt, rival) {
    const e = ESPECIALES[this.espActual];
    this.tAtaque += dt * RITMO; // los especiales también van al doble
    const total = e.startup + e.activo + e.recuperacion;
    const enActivo = this.tAtaque >= e.startup && this.tAtaque < e.startup + e.activo;
    const disparo = this.tAtaque >= e.startup && !this.golpeDado;

    switch (e.tipo) {
      case 'melee':
        if (enActivo && !this.golpeDado && this.alcanzaA(rival, e.alcance)) {
          this.golpeDado = true;
          aplicarGolpe(rival, { dmg: e.dmg * this.def.dmgMult, empuje: e.empuje, stun: e.stun, lanza: e.lanza, dir: this.dir, color: this.color });
        }
        break;

      case 'dash':
        if (enActivo) {
          this.x += this.dir * e.velocidad * dt;
          this.x = Math.max(45, Math.min(ANCHO - 45, this.x));
          if (!this.golpeDado && Math.abs(rival.x - this.x) < 48 && Math.abs(rival.y - this.y) < 70) {
            this.golpeDado = true;
            aplicarGolpe(rival, { dmg: e.dmg * this.def.dmgMult, empuje: e.empuje, stun: e.stun, dir: this.dir, color: this.color });
          }
        }
        break;

      case 'proyectil':
        if (disparo) {
          this.golpeDado = true;
          partida.proyectiles.push({
            // Sale desde tu posición: si saltas, disparas desde arriba
            tipo: e.proyectil, dueno: this.lado, color: this.color,
            x: this.x + this.dir * 28, y: e.altura + this.y, vx: this.dir * e.velocidad,
            radio: e.radio, vida: 2.5,
            dmg: e.dmg * this.def.dmgMult, empuje: e.empuje, stun: e.stun, lanza: e.lanza,
          });
        }
        break;

      case 'rayo':
        if (disparo) {
          this.golpeDado = true;
          partida.proyectiles.push({
            tipo: 'rayo', dueno: this.lado, color: this.color, visual: e.visual,
            x: rival.x, t: 0.42,
            dmg: e.dmg * this.def.dmgMult, empuje: e.empuje, stun: e.stun,
          });
        }
        break;

      case 'cura':
        if (disparo) {
          this.golpeDado = true;
          this.hp = Math.min(this.def.hp, this.hp + e.curacion);
          evento('cura', this.x, 55, this.color);
        }
        break;

      case 'agarre':
        if (disparo) {
          this.golpeDado = true;
          const dist = (rival.x - this.x) * this.dir;
          if (dist > -10 && dist < e.alcance && rival.y < 60) {
            evento('agarre', rival.x, 40, this.color);
            aplicarGolpe(rival, { dmg: e.dmg * this.def.dmgMult, empuje: 0, stun: e.stun, dir: this.dir, color: this.color });
          }
        }
        break;
    }

    if (this.tAtaque >= total) this.estado = 'idle';
  }
}

// ------------------------------------------------------------
// Proyectiles (incluye el rayo de Nami)
// ------------------------------------------------------------
function actualizarProyectiles(dt) {
  if (!partida.jugadores) { partida.proyectiles = []; return; }

  partida.proyectiles = partida.proyectiles.filter((p) => {
    const objetivo = partida.jugadores[1 - p.dueno].luchador;

    if (p.tipo === 'rayo') {
      p.t -= dt;
      if (p.t > 0) return true;
      evento(p.visual === 'brote' ? 'brote' : 'rayo', p.x, 0, p.color);
      if (Math.abs(objetivo.x - p.x) < 48 && objetivo.y < 90) {
        aplicarGolpe(objetivo, { dmg: p.dmg, empuje: p.empuje, stun: p.stun, dir: objetivo.x >= p.x ? 1 : -1, color: p.color });
      }
      return false;
    }

    p.x += p.vx * dt;
    p.vida -= dt;
    if (p.vida <= 0 || p.x < -40 || p.x > ANCHO + 40) return false;

    // Agachado esquiva los proyectiles altos (los rastreros como el Puño de Fuego sí pegan)
    if (objetivo.estado === 'agachado' && p.y > 34) return true;

    if (Math.abs(p.x - objetivo.x) < 26 + p.radio && Math.abs(p.y - (objetivo.y + 45)) < 60) {
      const dio = aplicarGolpe(objetivo, { dmg: p.dmg, empuje: p.empuje, stun: p.stun, lanza: p.lanza, dir: p.vx >= 0 ? 1 : -1, color: p.color });
      if (dio) { evento('golpe', p.x, p.y, p.color); return false; }
    }
    return true;
  });
}

// ------------------------------------------------------------
// Flujo de la partida
// ------------------------------------------------------------
// Fondos de escenario: pon imágenes en public/fondos/ y se eligen al azar
const FONDOS_DIR = path.join(__dirname, 'public', 'fondos');
function fondoAleatorio() {
  try {
    const archivos = fs.readdirSync(FONDOS_DIR).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f));
    if (!archivos.length) return null;
    return archivos[Math.floor(Math.random() * archivos.length)];
  } catch (e) {
    return null;
  }
}

function equipoAleatorio() {
  const ids = Object.keys(PERSONAJES);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 3);
}

function iniciarCombate() {
  // Respaldo: si algún lado no eligió, recibe un equipo al azar
  partida.lados.forEach((l) => { if (l && !l.equipo) l.equipo = equipoAleatorio(); });
  partida.jugadores = [0, 1].map((i) => ({
    roster: partida.lados[i].equipo.map((id) => ({ ...PERSONAJES[id], id })),
    indice: 0,
    luchador: null,
    // vida/estamina que conserva cada personaje del equipo entre relevos
    vidas: partida.lados[i].equipo.map((id) => ({ hp: PERSONAJES[id].hp, stamina: STAMINA_MAX, ko: false })),
  }));
  partida.jugadores[0].luchador = new Luchador(0, partida.jugadores[0].roster[0], 260, 1);
  partida.jugadores[1].luchador = new Luchador(1, partida.jugadores[1].roster[0], ANCHO - 260, -1);
  // Reinicia cooldowns y descarta inputs guardados en el lobby / pantalla de
  // victoria (fuera de la pelea el búfer no caduca y dispararía un golpe
  // fantasma en el primer frame del combate)
  partida.lados.forEach((l) => {
    if (!l) return;
    l.tCambio = 0;
    for (const k in l.bufer) l.bufer[k] = 0;
  });
  partida.proyectiles = [];
  partida.ganador = null;
  partida.fondo = fondoAleatorio(); // escenario al azar en cada combate
  partida.pantalla = 'pelea';
  anunciar('¡PELEA!');
  console.log(`Combate: ${partida.lados[0].nombre} [${partida.lados[0].equipo}] vs ${partida.lados[1].nombre} [${partida.lados[1].equipo}]`);
}

function terminarPorAbandono() {
  partida.pantalla = 'espera';
  partida.jugadores = null;
  partida.proyectiles = [];
  partida.ganador = null;
}

// Relevo en plena pelea: mete al personaje `slot` del equipo, guardando la
// vida del que sale para que regrese igual de dañado. Solo desde un estado
// neutral en tierra y respetando el cooldown (nada de escapar de un combo).
function cambiarPersonaje(ladoIdx, slot) {
  if (partida.pantalla !== 'pelea' || !partida.jugadores) return;
  const j = partida.jugadores[ladoIdx];
  const lado = partida.lados[ladoIdx];
  if (!j || !lado) return;
  if (!Number.isInteger(slot) || slot < 0 || slot >= j.roster.length) return;
  if (slot === j.indice || j.vidas[slot].ko) return;   // ya activo o eliminado
  const l = j.luchador;
  if (!l.enSuelo || !['idle', 'camina'].includes(l.estado)) return; // solo neutral en tierra
  if (lado.tCambio > 0) return;                          // cooldown

  // Guarda la vida/estamina del que sale
  j.vidas[j.indice].hp = l.hp;
  j.vidas[j.indice].stamina = l.stamina;
  evento('cambio', l.x, 55, l.color);

  // Entra el elegido, con su vida guardada y girando
  const v = j.vidas[slot];
  const nuevo = new Luchador(ladoIdx, j.roster[slot], l.x, l.dir, v.hp, v.stamina);
  nuevo.entra = T_ENTRADA;
  nuevo.invuln = 0.6;
  j.luchador = nuevo;
  j.indice = slot;
  lado.tCambio = COOLDOWN_CAMBIO;
  evento('cambio', nuevo.x, 55, nuevo.color);
  anunciar('¡Relevo! Entra ' + j.roster[slot].nombre, 1.0);
}

function tick() {
  const dt = 1 / 60;
  if (partida.anuncio.t > 0) partida.anuncio.t -= dt;
  if (partida.pantalla !== 'pelea') return;

  const l1 = partida.jugadores[0].luchador;
  const l2 = partida.jugadores[1].luchador;

  for (const [a, b] of [[l1, l2], [l2, l1]]) {
    if (!['ataque', 'especial', 'ko', 'volando', 'derribado'].includes(a.estado)) {
      a.dir = b.x >= a.x ? 1 : -1;
    }
  }

  [l1, l2].forEach((l, i) => {
    const lado = partida.lados[i];
    const entrada = lado
      ? { mantener: lado.mantener, bufer: lado.bufer }
      : { mantener: {}, bufer: { salto: 0, punyo: 0, patada: 0, especial: 0, especial2: 0 } };
    l.actualizar(dt, i === 0 ? l2 : l1, entrada);
  });

  actualizarProyectiles(dt);

  const dx = l2.x - l1.x;
  const solidos = !['ko', 'volando', 'derribado'].includes(l1.estado) && !['ko', 'volando', 'derribado'].includes(l2.estado);
  if (Math.abs(dx) < 36 && Math.abs(l1.y - l2.y) < 60 && solidos) {
    const empuje = (36 - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
    l1.x -= empuje;
    l2.x += empuje;
  }
  l1.x = Math.max(45, Math.min(ANCHO - 45, l1.x));
  l2.x = Math.max(45, Math.min(ANCHO - 45, l2.x));

  partida.jugadores.forEach((j, i) => {
    const l = j.luchador;
    if (l.estado === 'ko' && l.tEstado > 1.5 && !l.retirado) {
      l.retirado = true;
      j.vidas[j.indice].ko = true;   // este personaje queda eliminado
      j.vidas[j.indice].hp = 0;
      // Siguiente personaje VIVO del equipo (en orden de la lista)
      const sig = j.vidas.findIndex((v) => !v.ko);
      if (sig === -1) {
        partida.ganador = 1 - i;
        partida.pantalla = 'fin';
        console.log(`Gana ${partida.lados[1 - i] ? partida.lados[1 - i].nombre : 'lado ' + (2 - i)}`);
      } else {
        j.indice = sig;
        const v = j.vidas[sig];
        j.luchador = new Luchador(i, j.roster[sig], i === 0 ? 160 : ANCHO - 160, i === 0 ? 1 : -1, v.hp, v.stamina);
        j.luchador.entra = T_ENTRADA; // gira al entrar
        anunciar('¡Entra ' + j.roster[sig].nombre + '!');
      }
    }
  });

  // Los inputs guardados caducan solos (no se limpian por tick)
  partida.lados.forEach((l) => {
    if (!l) return;
    for (const k in l.bufer) l.bufer[k] = Math.max(0, l.bufer[k] - dt);
    l.tCambio = Math.max(0, (l.tCambio || 0) - dt);
  });
}

function instantanea(conEventos) {
  const snap = {
    pantalla: partida.pantalla,
    ganador: partida.ganador,
    fondo: partida.fondo || null,
    anuncio: partida.anuncio.t > 0 ? partida.anuncio : null,
    nombres: partida.lados.map((l) => (l ? l.nombre : null)),
    listos: partida.lados.map((l) => !!(l && l.equipo)),
    eventos: conEventos ? partida.eventos : [],
    proyectiles: partida.proyectiles.map((p) => ({ tipo: p.tipo, x: p.x, y: p.y, t: p.t, color: p.color, visual: p.visual })),
    jugadores: partida.jugadores
      ? partida.jugadores.map((j, i) => {
          const l = j.luchador;
          const eC = ESPECIALES[l.def.cerca];
          const eL = ESPECIALES[l.def.lejos];
          const eA = l.estado === 'especial' ? ESPECIALES[l.espActual] : null;
          return {
            indice: j.indice,
            colores: j.roster.map((r) => r.color),
            // vida de cada personaje del equipo (el activo usa su vida en vivo)
            vidas: j.vidas.map((v, k) => ({
              hp: Math.round(k === j.indice ? l.hp : v.hp),
              hpMax: j.roster[k].hp,
              ko: v.ko,
              nombre: j.roster[k].nombre,
            })),
            cambioListo: partida.lados[i] ? partida.lados[i].tCambio <= 0 : false,
            luchador: {
              x: l.x, y: l.y, dir: l.dir, entra: l.entra,
              estado: l.estado, ataque: l.ataque, tAtaque: l.tAtaque,
              hp: l.hp, hpMax: l.def.hp, stamina: l.stamina,
              color: l.def.color, escala: l.def.escala,
              nombreDef: l.def.nombre, personaje: l.def.id,
              invuln: l.invuln, tEstado: l.tEstado, retro: l.retrocede,
              vel: Math.round(l.def.velocidad * RITMO), // para la predicción local del cliente
              // especial en curso (para animar) y los dos medidores del HUD
              esp: eA ? { nombre: eA.nombre, tipo: eA.tipo, startup: eA.startup, activo: eA.activo, recuperacion: eA.recuperacion, alcance: eA.alcance || 0, lanza: !!eA.lanza } : null,
              espCerca: { nombre: eC.nombre, costo: eC.stamina, cd: l.cds[l.def.cerca] || 0, cdMax: eC.cooldown || 0 },
              espLejos: { nombre: eL.nombre, costo: eL.stamina, cd: l.cds[l.def.lejos] || 0, cdMax: eL.cooldown || 0 },
            },
          };
        })
      : null,
  };
  if (conEventos) partida.eventos = [];
  return snap;
}

// Bucle: simular y transmitir a 60 Hz. "volatile" descarta instantáneas
// viejas si la red se atasca, en vez de encolarlas (menos lag acumulado).
setInterval(() => {
  tick();
  io.volatile.emit('estado', instantanea(true));
}, 1000 / 60);

// ------------------------------------------------------------
// Conexiones
// ------------------------------------------------------------
io.on('connection', (socket) => {
  console.log('Conectado:', socket.id);
  socket.emit('estado', instantanea(false));

  socket.on('unirse', (datos, responder) => {
    if (typeof responder !== 'function') return;
    const lado = datos && Number(datos.lado);
    const nombre = String((datos && datos.nombre) || '').trim().slice(0, 12);

    if (lado !== 0 && lado !== 1) return responder({ ok: false, error: 'Lado inválido' });
    if (!nombre) return responder({ ok: false, error: 'Escribe tu nombre' });
    if (partida.lados[lado]) return responder({ ok: false, error: 'Ese lado ya está ocupado' });
    if (socket.data.lado !== undefined) return responder({ ok: false, error: 'Ya estás en la pelea' });

    partida.lados[lado] = {
      id: socket.id,
      nombre,
      equipo: null,
      mantener: { izq: false, der: false, bloqueo: false, abajo: false },
      bufer: { salto: 0, punyo: 0, patada: 0, especial: 0, especial2: 0 },
      tCambio: 0,
    };
    socket.data.lado = lado;
    console.log(`${nombre} tomó el lado ${lado === 0 ? 'izquierdo' : 'derecho'}`);
    responder({ ok: true, lado });
    io.emit('estado', instantanea(false));
  });

  socket.on('equipo', (ids, responder) => {
    if (typeof responder !== 'function') responder = () => {};
    const lado = partida.lados[socket.data.lado];
    if (!lado) return responder({ ok: false, error: 'Primero elige un lado' });
    if (partida.pantalla !== 'espera') return responder({ ok: false, error: 'La pelea ya empezó' });

    if (!Array.isArray(ids) || ids.length !== 3) return responder({ ok: false, error: 'Elige exactamente 3 personajes' });
    const limpios = ids.map(String);
    // Se permite repetir personajes entre jugadores (Zoro vs Zoro), no dentro del mismo equipo
    if (new Set(limpios).size !== 3 || !limpios.every((id) => PERSONAJES[id])) {
      return responder({ ok: false, error: 'Equipo inválido' });
    }

    lado.equipo = limpios;
    console.log(`${lado.nombre} eligió: ${limpios.join(', ')}`);
    responder({ ok: true });

    if (partida.lados[0] && partida.lados[1] && partida.lados[0].equipo && partida.lados[1].equipo) {
      iniciarCombate();
    }
    io.emit('estado', instantanea(false));
  });

  socket.on('reelegir', () => {
    if (socket.data.lado === undefined) return;
    if (partida.pantalla === 'fin') {
      partida.pantalla = 'espera';
      partida.jugadores = null;
      partida.proyectiles = [];
      partida.ganador = null;
      partida.lados.forEach((l) => { if (l) l.equipo = null; });
      io.emit('aviso', 'Nueva selección de personajes');
      io.emit('estado', instantanea(false));
    }
  });

  socket.on('latido', (responder) => {
    if (typeof responder === 'function') responder(); // eco para medir el ping
  });

  socket.on('mantener', (m) => {
    const lado = partida.lados[socket.data.lado];
    if (!lado || !m) return;
    lado.mantener.izq = !!m.izq;
    lado.mantener.der = !!m.der;
    lado.mantener.bloqueo = !!m.bloqueo;
    lado.mantener.abajo = !!m.abajo;
  });

  socket.on('pulso', (accion) => {
    const lado = partida.lados[socket.data.lado];
    if (!lado) return;
    // Búfer de inputs: el golpe queda guardado y sale en su primer frame legal
    if (['salto', 'punyo', 'patada', 'especial', 'especial2'].includes(accion)) lado.bufer[accion] = BUFER_INPUT;
  });

  socket.on('cambiar', (slot) => {
    if (socket.data.lado === undefined) return;
    cambiarPersonaje(socket.data.lado, Number(slot));
  });

  socket.on('revancha', () => {
    if (socket.data.lado === undefined) return;
    if (partida.pantalla === 'fin' && partida.lados[0] && partida.lados[1]) {
      iniciarCombate(); // revancha con los mismos equipos elegidos
    }
  });

  socket.on('disconnect', () => {
    const lado = socket.data.lado;
    if (lado !== undefined && partida.lados[lado] && partida.lados[lado].id === socket.id) {
      const nombre = partida.lados[lado].nombre;
      partida.lados[lado] = null;
      console.log(`${nombre} se desconectó`);
      if (partida.pantalla !== 'espera') {
        terminarPorAbandono();
        io.emit('aviso', nombre + ' se desconectó. Esperando rival…');
      }
      io.emit('estado', instantanea(false));
    }
  });
});

servidor.listen(PUERTO, () => {
  console.log(`⚔ Fight OP en http://localhost:${PUERTO}`);
  console.log('Para exponerlo online: ngrok http ' + PUERTO);
});
