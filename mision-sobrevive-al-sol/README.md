# Misión: Sobrevive al Sol

Prototipo de juego de cartas 2D construido con Phaser 3 y TypeScript. La interfaz de partida está compuesta por objetos y controles del motor; los archivos de imagen son recursos independientes (escenario, personaje, atlas de cartas, iconos y efectos).

## Ejecutar

```bash
npm install
npm run dev
```

Abrir `http://127.0.0.1:5173/game.html` para iniciar la escena jugable. La página raíz queda disponible para la vista de catálogo independiente. Para validar el prototipo:

```bash
npm test
npm run build
```

## Controles

- Tocar o hacer clic en una carta para añadirla o quitarla del plan.
- Arrastrar una carta al recuadro de acción también la añade.
- Pasar el cursor sobre una carta muestra sus efectos previstos en las barras.
- `1`–`5` elige cartas, `Enter` resuelve el plan y `Espacio` pausa/reanuda el reloj.
- Usa «Guardar 1 PA» para reducir a la mitad el efecto de los ataques que recibas.
- En los días de reabastecimiento, elige una barra tocando su medidor.

## Reglas incluidas

- Cuatro sistemas al 50%, 3 PA, mano de 3 cartas de supervivencia y 2 de ataque.
- Desgaste diario desde el día 2, planificación de 15 segundos y resolución de 5 segundos.
- Las cartas de ataque se resuelven primero; después las de supervivencia y los eventos globales de los días 3, 6, 9, 12 y 15.
- Una barra en 0% o 100% al final de la resolución colapsa la colonia.
- El modo inicial del prototipo es supervivencia contra IA. El combate local para dos jugadores queda como siguiente iteración.

## Lectura del documento de diseño

El ejemplo del día 6 del PDF calcula la energía final como 70%, aunque los valores listados dan 65% (40 − 5 + 15 + 40 − 25). La simulación usa los modificadores individuales de las cartas, por lo que sigue la aritmética explícita y deja la base en 65%.

En «Cultivo hidropónico LED», el documento enumera +10% O₂/agua y −15% O₂/agua por riego. La interfaz muestra el efecto neto de −5% y el detalle conserva ambas operaciones.

Las imágenes conceptuales de pantalla se guardan como referencia en `assets/concept-*.png`; el juego no las carga ni las usa como pantalla. El fondo, el astronauta, los atlas, los iconos y los efectos se cargan como recursos separados.
