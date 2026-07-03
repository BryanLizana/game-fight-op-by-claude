# Prompt para generar hojas de sprites con IA de imágenes

Adjuntar la imagen de referencia del personaje (recorte de `personajes-L1.png`
o una base como `zoro-base.PNG`) y pegar esto debajo, **editando solo el
primer párrafo** con la descripción del personaje:

---

```
Usa el personaje de la imagen adjunta como referencia exacta: [NOMBRE] estilo
stickman chibi de One Piece — [DESCRIPCIÓN: pelo, ropa, arma/accesorio.
Ejemplo Zoro: cabeza grande blanca sin rostro, pelo verde corto, bata/kimono
verde con faja roja oscura, extremidades delgadas negras, tres katanas (una
en la boca y una en cada mano)].

Genera UNA SOLA IMAGEN con una HOJA DE SPRITES para un videojuego de pelea
2D: una cuadrícula EXACTA de 3 columnas x 4 filas (12 celdas del mismo
tamaño), con el MISMO personaje repetido una vez por celda, siempre en
VISTA LATERAL ESTRICTA mirando hacia la DERECHA, cuerpo completo, con los
pies apoyados a la misma altura en la parte baja de cada celda.

Contenido de cada celda, en este orden (izquierda a derecha, arriba a abajo).
NOTA: la cuadrícula ahora es de 3 columnas x 4 FILAS (12 celdas):

Fila 1:
1) GUARDIA: de pie en pose de combate, rodillas semiflexionadas.
2) CORRER: corriendo agazapado, torso muy inclinado hacia adelante, zancada
   larga.
3) ATAQUE RÁPIDO: golpe con el brazo/arma delantero extendido completamente
   al frente.

Fila 2:
4) PATADA: patada frontal alta con la pierna delantera extendida.
5) BLOQUEO: encogido, brazos (o arma) cruzados frente a la cara.
6) AGACHADO: en cuclillas profundas estilo Mortal Kombat, rodillas muy
   flexionadas, cabeza baja, guardia arriba.

Fila 3:
7) ESPECIAL DE CERCA: [pose del especial cuerpo a cuerpo, ver tabla]
8) ESPECIAL A DISTANCIA: [pose del especial de proyectil, ver tabla]
9) GOLPEADO: recibiendo un impacto, torso arqueado hacia atrás, brazos
   sueltos.

Fila 4:
10) DERRIBADO: tirado en el suelo boca arriba a lo largo de la celda.
11) SALTO: en el aire con las piernas recogidas.
12) VICTORIA: pose de ganador (brazo en alto o pose característica).

Requisitos obligatorios:
- Fondo 100% transparente (PNG). Si no es posible, fondo liso verde puro
  #00FF00 en TODA la imagen, sin líneas divisorias entre celdas.
- Ilustración 2D plana estilo cartoon: contornos limpios y gruesos, colores
  planos, sin degradados complejos.
- SIN sombras en el piso, SIN efectos de energía, SIN estelas, SIN texto,
  SIN números, SIN marcos ni bordes de celda (los efectos los agrega el
  motor del juego).
- El personaje debe tener el MISMO tamaño, proporciones, colores y
  vestimenta en las 12 celdas.
- TODAS las poses en perfil mirando a la derecha, como en un juego de pelea
  2D (estilo Street Fighter).
- Imagen cuadrada de 1024x1024.
```

---

## Especiales por personaje (celdas 7 y 8)

| Personaje | CERCA (celda 7) | A DISTANCIA (celda 8) |
|-----------|-----------------|----------------------|
| Luffy | puño estirado lejísimos, brazo elástico de goma | ambas palmas empujando al frente, brazos estirados (Bazooka) |
| Zoro | embestida cuerpo casi horizontal, katanas al frente | gran corte horizontal con ambas katanas cruzando el aire |
| Sanji | patada altísima (pose de pierna en llamas, sin llamas) | patada al aire como lanzando algo al frente |
| Nami | golpe fuerte con el bastón hacia adelante | levantando el bastón hacia el cielo con ambas manos |
| Usopp | martillazo con un martillo gigante | apuntando con su tirachinas hacia adelante |
| Chopper | embestida con la cabeza baja y las astas al frente | arrodillado concentrándose con las pezuñas juntas |
| Franky | puñetazo gigante con el brazo robótico extendido | ambos antebrazos juntos al frente como disparando un rayo |
| Brook | estocada de esgrima con su espada fina al frente | rasgueando su guitarra con una mano extendida |
| Robin | brazos cruzados en X frente al pecho | brazos extendidos con las palmas hacia el rival |
| Ace | puñetazo directo con el puño adelante | lanzando con el puño extendido (pose de tirar, sin fuego) |

## Después de generar

1. Guardar como `info/<personaje>-sheet.png`
2. `node scripts/cortar-sheet.js <personaje>`
3. Mapear las poses en `public/cliente.js` (ver README, sección Sprites)

Si una pose sale de frente en vez de perfil, reintentar agregando:
*"silueta de perfil puro, sin rotación 3/4, como sprite de juego de pelea"*.
