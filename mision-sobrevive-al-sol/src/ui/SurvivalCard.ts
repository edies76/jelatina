import Phaser from "phaser";
import { FAMILIES, SYSTEMS, type CardInstance, type Effects, type SystemId } from "../data";

export interface SurvivalCardEvents {
  toggle: (card: CardInstance) => void;
  hover: (card: CardInstance) => void;
  leave: (card: CardInstance) => void;
  drop: (card: CardInstance, x: number, y: number) => void;
}

const colorBySystem: Record<SystemId, string> = {
  energy: "#efbd58",
  oxygen: "#65cbd7",
  food: "#6cdaa0",
  shield: "#b69ae8",
};
const shortBySystem: Record<SystemId, string> = {
  energy: "ENERGÍA",
  oxygen: "O₂",
  food: "COMIDA",
  shield: "ESCUDO",
};

export class SurvivalCard {
  readonly container: Phaser.GameObjects.Container;
  readonly instance: CardInstance;
  private readonly scene: Phaser.Scene;
  private readonly width: number;
  private readonly height: number;
  private readonly events: SurvivalCardEvents;
  private readonly plate: Phaser.GameObjects.Graphics;
  private readonly cost: Phaser.GameObjects.Text;
  private readonly zone: Phaser.GameObjects.Zone;
  private selected = false;
  private enabled = true;
  private dragging = false;
  private start = { x: 0, y: 0 };
  private home = { x: 0, y: 0 };

  constructor(scene: Phaser.Scene, instance: CardInstance, x: number, y: number, width: number, height: number, events: SurvivalCardEvents) {
    this.scene = scene;
    this.instance = instance;
    this.width = width;
    this.height = height;
    this.home = { x, y };
    this.events = events;
    this.container = scene.add.container(x, y);
    this.plate = scene.add.graphics();

    const art = scene.add.image(0, -height / 2 + 43, "cards", "card-art-" + instance.definition.art)
      .setDisplaySize(width * 0.62, Math.min(45, height * 0.31));
    const family = FAMILIES[instance.definition.family];
    const familyName = scene.add.text(-width / 2 + 11, -height / 2 + 14, family.name, {
      fontFamily: '"Trebuchet MS", Arial, sans-serif', fontSize: Math.max(7, width * 0.052) + "px",
      fontStyle: "bold", color: family.cssColor,
    }).setOrigin(0, 0.5);
    this.cost = scene.add.text(width / 2 - 11, -height / 2 + 14, instance.definition.cost + " PA", {
      fontFamily: '"Trebuchet MS", Arial, sans-serif', fontSize: Math.max(8, width * 0.062) + "px",
      fontStyle: "bold", color: "#f0bd58",
    }).setOrigin(1, 0.5);
    this.redraw();
    const title = scene.add.text(0, -height / 2 + 72, instance.definition.shortName, {
      fontFamily: '"Trebuchet MS", Arial, sans-serif', fontSize: Math.max(9, width * 0.073) + "px",
      fontStyle: "bold", color: "#f3f5f7", align: "center",
      wordWrap: { width: width - 18, useAdvancedWrap: true }, maxLines: 2,
    }).setOrigin(0.5, 0);
    const effects = scene.add.text(0, height / 2 - 24, this.formatEffects(instance.definition.effects), {
      fontFamily: '"Trebuchet MS", Arial, sans-serif', fontSize: Math.max(8, width * 0.059) + "px",
      fontStyle: "bold", color: "#b7c4d6", align: "center",
      wordWrap: { width: width - 12, useAdvancedWrap: true }, maxLines: 2,
    }).setOrigin(0.5, 1);
    this.zone = scene.add.zone(0, 0, width, height).setInteractive({ useHandCursor: true });
    scene.input.setDraggable(this.zone, true);
    this.container.add([this.plate, art, familyName, this.cost, title, effects, this.zone]);
    this.zone.on("pointerover", () => { if (this.enabled) this.events.hover(instance); });
    this.zone.on("pointerout", () => { this.events.leave(instance); });
    this.zone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.start = { x: pointer.x, y: pointer.y };
      this.scene.tweens.add({ targets: this.container, scale: 0.98, duration: 65 });
    });
    this.zone.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (this.dragging || !this.enabled) return;
      if (Phaser.Math.Distance.Between(pointer.x, pointer.y, this.start.x, this.start.y) < 12) this.events.toggle(instance);
      this.scene.tweens.add({ targets: this.container, scale: this.selected ? 1.035 : 1, duration: 100, ease: "Back.Out" });
    });
    this.zone.on("dragstart", (pointer: Phaser.Input.Pointer) => {
      if (!this.enabled) return;
      this.dragging = true;
      this.start = { x: pointer.x, y: pointer.y };
      this.container.setDepth(20).setScale(1.04);
    });
    this.zone.on("drag", (pointer: Phaser.Input.Pointer) => {
      if (this.dragging) this.container.setPosition(pointer.x, pointer.y);
    });
    this.zone.on("dragend", (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      if (Phaser.Math.Distance.Between(pointer.x, pointer.y, this.start.x, this.start.y) > 16) this.events.drop(instance, pointer.x, pointer.y);
      this.dragging = false;
      this.container.setDepth(1);
      this.scene.tweens.add({ targets: this.container, x: this.home.x, y: this.home.y + (this.selected ? -5 : 0), scale: this.selected ? 1.035 : 1, duration: 150, ease: "Back.Out" });
    });
  }

  setSelected(value: boolean, animate = true): void {
    this.selected = value;
    this.redraw();
    const y = this.home.y + (value ? -5 : 0);
    this.scene.tweens.killTweensOf(this.container);
    if (animate) this.scene.tweens.add({ targets: this.container, y, scale: value ? 1.035 : 1, duration: 140, ease: "Sine.Out" });
    else this.container.setPosition(this.home.x, y).setScale(value ? 1.035 : 1);
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (this.zone.input) this.zone.input.enabled = value;
    this.container.setAlpha(value ? 1 : 0.55);
  }

  animatePlay(index: number): void {
    this.scene.tweens.add({
      targets: this.container, x: this.scene.scale.width / 2 + (index % 2 ? 16 : -16),
      y: this.scene.scale.height * 0.38, alpha: 0, scale: 0.76, angle: index % 2 ? 4 : -4,
      duration: 500, delay: index * 75, ease: "Cubic.In",
    });
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.container);
    this.container.destroy(true);
  }

  private formatEffects(effects: Effects): string {
    return Object.entries(effects).filter((entry) => entry[1]).map((entry) => {
      const system = entry[0] as SystemId;
      const amount = entry[1]!;
      return (amount > 0 ? "+" : "−") + Math.abs(amount) + " " + shortBySystem[system];
    }).join("   ");
  }

  private redraw(): void {
    const family = FAMILIES[this.instance.definition.family];
    const x = -this.width / 2, y = -this.height / 2;
    this.plate.clear();
    this.plate.fillStyle(0x050b14, 0.25).fillRoundedRect(x + 1, y + 3, this.width, this.height, 9);
    this.plate.fillStyle(this.selected ? 0x1d3245 : 0x122239, 0.98).fillRoundedRect(x, y, this.width, this.height, 9);
    this.plate.lineStyle(this.selected ? 2 : 1, this.selected ? 0xf0bd58 : 0x3a506b, 0.9)
      .strokeRoundedRect(x + 0.5, y + 0.5, this.width - 1, this.height - 1, 9);
    this.plate.fillStyle(family.color, this.selected ? 0.9 : 0.58)
      .fillRoundedRect(x + 7, y + 28, this.width - 14, 1.5, 1);
    this.plate.fillStyle(0x27374a, 0.6)
      .fillRoundedRect(x + 8, y + this.height - 34, this.width - 16, 1, 1);
    this.cost.setColor(this.selected ? "#ffe2a1" : "#f0bd58");
  }
}
