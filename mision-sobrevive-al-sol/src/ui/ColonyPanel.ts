import Phaser from "phaser";
import { SYSTEMS, type Effects, type ResourceBars, type SystemId } from "../data";
import { ResourceMeter } from "./ResourceMeter";

export class ColonyPanel {
  readonly container: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private readonly width: number;
  private readonly height: number;
  private readonly meters = new Map<SystemId, ResourceMeter>();
  private readonly plate: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly portrait: Phaser.GameObjects.Image;
  private readonly status: Phaser.GameObjects.Text;
  private readonly clickable: boolean;
  private readonly selectResource?: (system: SystemId) => void;
  private readonly accent: number;
  private eliminated = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    name: string,
    portraitTexture: string,
    portraitFrame: string,
    iconTexture: string,
    accent: number,
    clickable: boolean,
    selectResource?: (system: SystemId) => void,
  ) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.clickable = clickable;
    this.selectResource = selectResource;
    this.accent = accent;
    this.container = scene.add.container(x, y);
    this.plate = scene.add.graphics();
    this.drawPlate();
    this.portrait = scene.add.image(-width / 2 + 31, -height / 2 + 30, portraitTexture, portraitFrame)
      .setDisplaySize(47, 47);
    scene.tweens.add({ targets: this.portrait, y: this.portrait.y - 2, angle: portraitTexture === "sun-mascot" ? 2 : -1, duration: portraitTexture === "sun-mascot" ? 1380 : 1700, ease: "Sine.InOut", yoyo: true, repeat: -1 });
    this.title = scene.add.text(-width / 2 + 62, -height / 2 + 19, name.toUpperCase(), {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: width < 600 ? "15px" : "17px",
      fontStyle: "bold",
      color: "#fff9e9",
      letterSpacing: 0.4,
    }).setOrigin(0, 0.5);
    this.status = scene.add.text(width / 2 - 18, -height / 2 + 20, "OPERATIVA", {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: "9px",
      fontStyle: "bold",
      color: "#6ef3a7",
      align: "right",
    }).setOrigin(1, 0.5);
    this.container.add([this.plate, this.portrait, this.title, this.status]);

    const innerX = -width / 2 + 12;
    const gapX = 10;
    const barWidth = (width - 24 - gapX) / 2;
    const barHeight = Math.min(49, (height - 62) / 2 - 5);
    const startY = -height / 2 + 64 + barHeight / 2;
    SYSTEMS.forEach((system, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const bx = innerX + col * (barWidth + gapX) + barWidth / 2;
      const by = startY + row * (barHeight + 7);
      const meter = new ResourceMeter(
        scene,
        bx,
        by,
        barWidth,
        barHeight,
        system.id,
        iconTexture,
        clickable ? selectResource : undefined,
      );
      this.meters.set(system.id, meter);
      this.container.add(meter.container);
    });
  }

  update(resources: ResourceBars, preview: Effects = {}, concealed = false, target?: SystemId, isEliminated = false): void {
    this.eliminated = isEliminated;
    for (const system of SYSTEMS) {
      this.meters.get(system.id)?.setData(resources[system.id], preview[system.id] ?? 0, concealed, target === system.id);
    }
    this.status.setText(isEliminated ? "COLAPSADA" : "OPERATIVA");
    this.status.setColor(isEliminated ? "#ff6975" : "#6ef3a7");
    this.container.setAlpha(isEliminated ? 0.72 : 1);
    this.drawPlate();
  }

  setResourceTargetEnabled(enabled: boolean): void {
    for (const meter of this.meters.values()) meter.setSelectionEnabled(enabled);
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.container);
    this.scene.tweens.killTweensOf(this.portrait);
    for (const meter of this.meters.values()) meter.destroy();
    this.meters.clear();
    this.container.destroy(true);
  }

  private drawPlate(): void {
    const x = -this.width / 2;
    const y = -this.height / 2;
    this.plate.clear();
    this.plate.fillStyle(0x030a1c, 0.5).fillRoundedRect(x + 3, y + 7, this.width, this.height, 20);
    this.plate.fillStyle(this.eliminated ? 0x35142c : 0x0b1735, 0.9).fillRoundedRect(x, y, this.width, this.height, 17);
    this.plate.lineStyle(2, this.eliminated ? 0xff6571 : this.accent, 0.78).strokeRoundedRect(x + 1, y + 1, this.width - 2, this.height - 2, 16);
    this.plate.fillStyle(this.eliminated ? 0xff6571 : this.accent, 0.09).fillRoundedRect(x + 8, y + 8, this.width - 16, 45, 11);
    this.plate.lineStyle(1, 0xffffff, 0.12).lineBetween(x + 17, y + 58, x + this.width - 17, y + 58);
  }
}
