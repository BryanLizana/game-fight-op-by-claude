# ⚔ Fight OP — Juego de pelea One Piece (online)

Juego de pelea 1 vs 1 estilo Mortal Kombat con personajes chibi de One Piece.
Cada jugador elige **3 personajes** y gana quien deje K.O. a los 3 del rival.
**Multijugador online**: cada jugador entra desde su propio navegador.

## Cómo jugarlo online

```
npm install                                  # solo la primera vez
npm start                                    # servidor en http://localhost:3000
cloudflared tunnel --url http://localhost:3000   # URL pública (recomendado)
ngrok http 3000                              # alternativa (más ping)
```

Comparte la URL pública con tu rival. Cada uno escribe su nombre, elige un
lado (🔵 / 🔴) y **sus 3 personajes** (o 🎲 Al azar). Con ambos listos, la
pelea arranca sola. Se permite el duelo espejo (Zoro vs Zoro): el del lado
derecho se ve teñido de otro color.

> **Sobre el ping**: cloudflared suele dar ~30% menos latencia que ngrok
> (Cloudflare tiene punto de presencia en Lima). En consola del navegador
> (F12) sale cada 3 s una línea `[PING]` que separa la latencia en
> componentes y diagnostica la causa. Ambas URLs gratuitas cambian en cada
> reinicio del túnel. En la misma WiFi: `http://<IP-local>:3000` (ping ~2 ms).

También hay un modo local de 2 en un teclado en `/local.html`, y una galería
de personajes en `/preview.html` (`?estado=camina|bloqueo|agachado|...`).

## Controles

| Acción | Control |
|--------|---------|
| Mover | A / D o ← / → (retroceder es más lento) |
| Saltar | W, ↑ o Espacio (un salto por toque; no hay doble salto) |
| Cubrirse | F (mantener) |
| Agacharse | S o ↓ (mantener) — esquiva puños y proyectiles altos |
| Puño | Click izquierdo |
| Patada | Click derecho |
| Especial de cerca | Ctrl |
| Especial a distancia | Shift |
| Relevo de personaje | 1 / 2 / 3 (mete a ese compañero del equipo) |
| Revancha / Cambiar equipo | R / E (en la pantalla de victoria) |

- **Combos por cancelación**: pasada la fase activa de un golpe, el siguiente
  lo corta (puño→puño→patada→especial), limitado solo por la estamina.
- **Búfer de inputs** de 0.25 s: puedes machacar los clicks y cada golpe sale
  en su primer frame legal, sin inputs perdidos.
- **Movimiento libre**: puedes correr/saltar mientras golpeas (en tierra y aire).
- **Sin doble salto / vuelo**: no puedes saltar en el aire, y al aterrizar hay que
  quedarse un mínimo en el suelo antes de volver a saltar (`COOLDOWN_SALTO` de
  `server.js`, hoy 0.8 s). Machacar espacio ya no encadena saltos.
- El ritmo global (velocidad de movimiento y de golpes) se ajusta con la
  constante `RITMO` de `server.js` (hoy: x2).

## Mecánicas

- **Vida**: al llegar a 0 el personaje cae K.O. y entra el siguiente del equipo.
  La barra tiene "desangrado" estilo MK (el daño reciente se drena gradualmente).
  El daño de cada golpe sale como número rojo flotante (`-N`) para ver/ajustar valores.
- **Relevo en vivo (tag)**: con **1 / 2 / 3** metes a ese compañero en plena pelea;
  el que sale **conserva su vida** y vuelve igual de dañado. Ambos giran al entrar/salir.
  Solo desde un estado neutral en tierra y con un cooldown de 3 s (no sirve para
  escapar de un combo). En el HUD, cada ficha muestra su mini-vida, ✕ si está K.O.
  y el número de tecla; el aro blanco marca al activo.
- **Estamina**: los ataques la gastan, se regenera sola. Los DOS medidores de
  especial del HUD brillan dorados cuando hay estamina para usarlos (la Cura
  de Chopper además espera 5 s entre usos — sin spam de curas).
- **Bloqueo**: reduce el daño 85% pero desgasta la estamina; a 0 se rompe la guardia.
- **Agachado**: esquiva puños y proyectiles altos (los rastreros como el Puño
  de Fuego sí pegan — hay que saltarlos).
- **Ataques a distancia**: el proyectil sale **desde tu posición real** — si
  disparas saltando, la bola viaja por lo alto (pasa por encima de un rival en
  el suelo). Todas las bolas crepitan con rayos eléctricos (efecto de trueno).
- **Lanzamientos estilo stickfight**: los golpes marcados lanzan por los aires
  (volando → derribado intocable → levantarse vulnerable).
- **Los 10 personajes** (cerca = Ctrl · lejos = Shift):

| Personaje | Cerca | A distancia |
|-----------|-------|-------------|
| Luffy | Pistola Goma (brazo elástico) | Bazooka Goma (onda que derriba) |
| Zoro | Onigiri (embestida) | Corte de Viento (media luna) |
| Sanji | Diable Jambe (patada que lanza) | Llama Voladora |
| Nami | Golpe Clima (aturde) | Thunderbolt Tempo (rayo con aviso) |
| Usopp | Martillo (derriba) | Planta Estrella |
| Chopper | Cuerno Point (embestida que derriba) | Cura (+22 vida, espera 5 s) |
| Franky | Strong Right (derriba) | Radical Beam (láser) |
| Brook | Estocada (rápida, mucho alcance) | Nota Cortante ♪ |
| Robin | Mano Fleur (agarre, aturde 0.9 s) | Mil Fleurs (brotes con aviso) |
| Ace | Puño Ígneo (derriba) | Puño de Fuego (bola rastrera que derriba) |

## 🏞️ Fondos de escenario

Suelta imágenes (png/jpg/webp/gif) en **`public/fondos/`** y listo: el
servidor elige una al azar en cada combate (cada revancha sortea otra). El
cliente la oscurece y pinta un piso sólido para que todo se lea.

## 🎨 Sprites por IA

**Hechos (5/10):** Luffy, Zoro, Nami, Franky, Ace.
**Faltan (5):** Sanji, Usopp, Chopper, Brook, Robin — usan el stickman
procedural con vestimenta mientras tanto.

Proceso por personaje (~10 min):

1. **Generar la hoja** con una IA de imágenes usando la plantilla de
   `info/PROMPT-SPRITES.md` (12 poses en cuadrícula 3x4, perfil a la DERECHA,
   fondo verde puro o transparente, SIN efectos — incluye la tabla con los
   2 especiales de cada personaje). Adjuntar su imagen base como referencia.
2. **Guardar** como `info/<id>-sheet.png` (ids: sanji, usopp, chopper, brook, robin).
3. **Cortar**: `node scripts/cortar-sheet.js <id> [columnas] [tolerancia]`
   - `columnas`: máximo de poses por fila (por defecto 3; la hoja de Ace usó 4).
   - `tolerancia`: sube a ~135 si quedan restos de sombra verde bajo los pies.
   - Si dos poses salen pegadas en un recorte: `node scripts/partir-celda.js <ruta.png>`.
4. **Mapear** en `public/cliente.js` con `cargarSprites('<id>', {...})` junto a
   los existentes. Poses: `idle, camina, punyo, patada, bloqueo, agachado,
   especial (cerca), especial2 (lejos), golpeado, salto, derribado, ko`.

**Fallbacks automáticos del renderizador** (si a una hoja le falta una pose):
sin `agachado` usa el bloqueo achatado; sin `derribado`/`ko` acuesta la
guardia rotada; sin `golpeado` inclina la guardia hacia atrás. El motor
espeja al mirar a la izquierda (los sprites SIEMPRE miran a la derecha),
normaliza el tamaño por la altura del `idle` y agrega solo los efectos
(estelas, giro al volar, desvanecido en K.O., escudo, llamas). En duelos
espejo tiñe el lado derecho con `hue-rotate`.

## Arquitectura

- `server.js` — **servidor autoritativo**: simula a 60 Hz (física, golpes,
  daño, 2 especiales, proyectiles, agachado, K.O., relevo de equipo con vida
  persistente) y transmite a 60 Hz con paquetes volátiles (si la red se atasca
  descarta estados viejos en vez de encolar lag). Los clientes solo mandan
  inputs: imposible hacer trampa. Constantes de tuneo arriba del archivo
  (`RITMO`, `COOLDOWN_SALTO`, `COOLDOWN_CAMBIO`, `T_ENTRADA`…).
- `public/cliente.js` — cliente: lobby con selección de equipo, envío de
  inputs (teclado + mouse), render con interpolación, **predicción local del
  propio movimiento** (tu personaje responde al instante aunque haya ping),
  sprites + stickman procedural, partículas y efectos, HUD estilo MK,
  diagnóstico `[PING]` en consola.
- `scripts/` — herramientas del pipeline de sprites (cortar hojas, partir celdas).
- WebSocket puro (sin fase de polling HTTP) para menos latencia por túnel.

## Pendientes / ideas siguientes

- Hojas de sprites de Sanji, Usopp, Chopper, Brook y Robin.
- Pantalla "ROUND 1 — FIGHT!" con cuenta regresiva y poses de victoria (las
  hojas ya traen la celda 12 de victoria, guardada en los recortes).
- Sonido (golpes, K.O., música de escenario).
- Si el ping sigue molestando en serio: rollback netcode (la predicción local
  ya cubre el movimiento propio; el rollback cubriría también los golpes).

## Aviso

Proyecto **fan-made sin ánimo de lucro**, con fines educativos y de
aprendizaje. One Piece y sus personajes son © Eiichiro Oda / Shueisha / Toei
Animation. Sin afiliación oficial.
