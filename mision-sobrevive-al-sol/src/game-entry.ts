import Phaser from "phaser";
import "./game-style.css";
import { GameScene } from "./scenes/GameScene";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-container",
  backgroundColor: "#07112b",
  scene: [GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1440,
    height: 900,
  },
  input: {
    activePointers: 2,
    smoothFactor: 0,
  },
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: true,
    transparent: false,
  },
  fps: { target: 60, smoothStep: true },
});

game.canvas?.setAttribute("aria-label", "Tablero de juego: cuatro recursos, cartas y puntos de acción");
