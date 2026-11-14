import Phaser from "phaser";
import { FAMILIES, type CardInstance, type Effects, type SystemId } from "../data";

export interface SurvivalCardEvents {
  toggle: (card: CardInstance) => void;
  hover: (card: CardInstance) => void;
  leave: (card: CardInstance) => void;
  drop: (card: CardInstance, x: number, y: number) => void;
}

const names: Record<SystemId, string> = {
  energy: "ENERGÍA",
  oxygen: "O₂ / AGUA",
  food: "COMIDA",
  shield: "ESCUDO",
};
const familyInk: Record<string, number> = {
  energy: 0xba674f,
  support: 0x39709a,
  biodome: 0x347b68,
  armor: 0x755c91,
};
const familyShort: Record<string, string> = {
  energy: "ENERGÍA",
  support: "SOPORTE",
  biodome: "CULTIVO",
  armor: "BLINDAJE",
};

export class SurvivalCard {
  readonly container: Phaser.GameObjects.Container;
  readonly instance: CardInstance;
  private readonly scene: Phaser.Scene;
  private readonly width: number;
  private readonly height: number;
  private readonly events: SurvivalCardEvents;
  private readonly plate: Phaser.GameObjects.Graphics;
  private readonly zone: Phaser.GameObjects.Zone;
  private readonly cost: Phaser.GameObjects.Text;
  private selected = false;
  private enabled = true;
  private dragging = false;
  private homeAngle = 0;
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

    const family = FAMILIES[instance.definition.family];
    const ink = familyInk[instance.definition.family] || 0x39709a;
    const icon = scene.add.circle(-width / 2 + 19, -height / 2 + 17, Math.max(5, Math.min(8, width * 0.035)), ink, 0.95);
    const familyText = scene.add.text(-width / 2 + 34, -height / 2 + 17, familyShort[instance.definition.family] || family.name, {
      fontFamily: '"Trebuchet MS", Arial, sans-serif',
      fontSize: Math.max(7, Math.min(9, width * 0.034)) + "px",
      fontStyle: "bold",
      color: Phaser.Display.Color.IntegerToColor(ink).rgba,
    }).setOrigin(0, 0.5);
    this.cost = scene.add.text(width / 2 - 12, -height / 2 + 17, instance.definition.cost + " PA", {
      fontFamily: '"Trebuchet MS", Arial, sans-serif',
      fontSize: Math.max(9, Math.min(12, width * 0.045)) + "px",
      fontStyle: "bold",
      color: "#172338",
    }).setOrigin(1, 0.5);
    const title = scene.add.text(0, -height / 2 + height * 0.43, instance.definition.shortName, {
      fontFamily: '"Trebuchet MS", Arial, sans-serif',
      fontSize: Math.max(10, Math.min(17, width * 0.064)) + "px",
      fontStyle: "bold",
      color: "#172338",
      align: "center",
      wordWrap: { width: width - 24, useAdvancedWrap: true },
      maxLines: 2,
    }).setOrigin(0.5);
    const effects = scene.add.text(0, height / 2 - 20, this.formatEffects(instance.definition.effects), {
      fontFamily: '"Trebuchet MS", Arial, sans-serif',
      fontSize: Math.max(8, Math.min(12, width * 0.043)) + "px",
      fontStyle: "bold",
      color: "#43536a",
      align: "center",
      wordWrap: { width: width - 18, useAdvancedWrap: true },
      maxLines: 2,
    }).setOrigin(0.5, 1);
    this.zone = scene.add.zone(0, 0, width, height).setInteractive({ useHandCursor: true });
    scene.input.setDraggable(this.zone, true);
    this.container.add([this.plate, icon, familyText, this.cost, title, effects, this.zone]);
    this.redraw();

    this.zone.on("pointerover", () => { if (this.enabled) this.events.hover(instance); });
    this.zone.on("pointerout", () => this.events.leave(instance));
    this.zone.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.start = { x: pointer.x, y: pointer.y };
      this.scene.tweens.add({ targets: this.container, scale: 0.985, duration: 65 });
    });
    this.zone.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (this.dragging || !this.enabled) return;
      if (Phaser.Math.Distance.Between(pointer.x, pointer.y, this.start.x, this.start.y) < 12) this.events.toggle(instance);
      this.scene.tweens.add({ targets: this.container, scale: this.selected ? 1.025 : 1, duration: 100, ease: "Sine.Out" });
    });
    this.zone.on("dragstart", (pointer: Phaser.Input.Pointer) => {
      if (!this.enabled) return;
      this.dragging = true;
      this.start = { x: pointer.x, y: pointer.y };
      this.container.setDepth(20).setScale(1.03);
    });
    this.zone.on("drag", (pointer: Phaser.Input.Pointer) => {
      if (this.dragging) this.container.setPosition(pointer.x, pointer.y);
    });
    this.zone.on("dragend", (pointer: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      if (Phaser.Math.Distance.Between(pointer.x, pointer.y, this.start.x, this.start.y) > 16) this.events.drop(instance, pointer.x, pointer.y);
      this.dragging = false;
      this.container.setDepth(1);
      this.scene.tweens.add({ targets: this.container, x: this.home.x, y: this.home.y + (this.selected ? -4 : 0), angle: this.homeAngle, scale: this.selected ? 1.025 : 1, duration: 145, ease: "Sine.Out" });
    });
  }

  setFan(angle: number, verticalOffset: number): void {
    this.homeAngle = angle;
    this.home.y += verticalOffset;
    this.container.setPosition(this.home.x, this.home.y).setAngle(angle);
  }

  setSelected(value: boolean, animate = true): void {
    this.selected = value;
    this.redraw();
    const y = this.home.y + (value ? -4 : 0);
    this.scene.tweens.killTweensOf(this.container);
    if (animate) this.scene.tweens.add({ targets: this.container, y, scale: value ? 1.025 : 1, duration: 130, ease: "Sine.Out" });
    else this.container.setPosition(this.home.x, y).setScale(value ? 1.025 : 1);
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (this.zone.input) this.zone.input.enabled = value;
    this.container.setAlpha(value ? 1 : 0.58);
  }

  animatePlay(index: number): void {
    this.scene.tweens.add({
      targets: this.container,
      x: this.scene.scale.width / 2 + (index % 2 ? 10 : -10),
      y: this.scene.scale.height * 0.45,
      alpha: 0,
      scale: 0.88,
      duration: 440,
      delay: index * 70,
      ease: "Cubic.In",
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
      return (amount > 0 ? "+" : "−") + Math.abs(amount) + " " + names[system];
    }).join("   ·   ");
  }

  private redraw(): void {
    const x = -this.width / 2;
    const y = -this.height / 2;
    const accent = familyInk[this.instance.definition.family] || 0x39709a;
    this.plate.clear();
    this.plate.fillStyle(0x172338, 0.08).fillRoundedRect(x + 1, y + 2, this.width, this.height, 8);
    this.plate.fillStyle(this.selected ? 0xf2e2db : 0xf8f6f0, 1).fillRoundedRect(x, y, this.width, this.height, 8);
    this.plate.lineStyle(this.selected ? 3 : 1.5, this.selected ? 0xba674f : 0x768397, this.selected ? 1 : 0.72)
      .strokeRoundedRect(x + 0.5, y + 0.5, this.width - 1, this.height - 1, 8);
    this.plate.lineStyle(2, accent, this.selected ? 0.95 : 0.62)
      .lineBetween(x + 10, y + 32, x + this.width - 10, y + 32);
    this.plate.lineStyle(1, 0x768397, 0.35)
      .lineBetween(x + 11, y + this.height - 36, x + this.width - 11, y + this.height - 36);
    this.cost.setText(this.selected
      ? (this.width < 150 ? "✓ " : "✓ EN PLAN · ") + this.instance.definition.cost + " PA"
      : this.instance.definition.cost + " PA");
    this.cost.setColor(this.selected ? "#9f5746" : "#172338");
  }
}
