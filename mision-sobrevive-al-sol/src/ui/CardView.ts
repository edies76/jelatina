import Phaser from "phaser";
import { FAMILIES, SYSTEMS, type CardInstance, type Effects, type SystemId } from "../data";

export interface CardViewEvents {
  onToggle: (card: CardInstance) => void;
  onHover: (card: CardInstance) => void;
  onLeave: (card: CardInstance) => void;
  onDrop: (card: CardInstance, x: number, y: number) => void;
}

const signed = (value: number): string => `${value > 0 ? "+" : "−"}${Math.abs(value)}`;

export class CardView {
  readonly container: Phaser.GameObjects.Container;
  readonly card: CardInstance;
  readonly width: number;
  readonly height: number;
  readonly home: { x: number; y: number; depth: number };
  private readonly scene: Phaser.Scene;
  private readonly events: CardViewEvents;
  private readonly art: Phaser.GameObjects.Image;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly zone: Phaser.GameObjects.Zone;
  private readonly costText: Phaser.GameObjects.Text;
  private readonly title: Phaser.GameObjects.Text;
  private readonly effectsText: Phaser.GameObjects.Text;
  private readonly scienceText: Phaser.GameObjects.Text;
  private selected = false;
  private hovered = false;
  private dragging = false;
  private wasDragged = false;
  private pressOrigin: { x: number; y: number } | null = null;

  constructor(
    scene: Phaser.Scene,
    card: CardInstance,
    x: number,
    y: number,
    width: number,
    height: number,
    survivalAtlas: string,
    events: CardViewEvents,
    depth = 20,
  ) {
    this.scene = scene;
    this.card = card;
    this.width = width;
    this.height = height;
    this.home = { x, y, depth };
    this.events = events;
    this.container = scene.add.container(x, y).setDepth(depth);
    this.graphics = scene.add.graphics();

    const definition = card.definition;
    const family = FAMILIES[definition.family];
    const frame = `survival-art-${definition.art}`;
    const top = -height / 2;
    const tight = height < 175;
    const artHeight = height * (tight ? 0.28 : 0.36);
    this.art = scene.add.image(0, top + height * (tight ? 0.53 : 0.52), survivalAtlas, frame)
      .setDisplaySize(width - 25, artHeight)
      .setOrigin(0.5);

    this.costText = scene.add.text(-width / 2 + 23, top + 18, `${definition.cost}`, {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: "11px",
      fontStyle: "bold",
      color: "#fff5de",
      align: "center",
      lineSpacing: -4,
    }).setOrigin(0.5);
    const typeText = scene.add.text(width / 2 - 9, top + 18, family.name, {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: width < 205 ? "8px" : "9px",
      fontStyle: "bold",
      color: "#fff8e9",
      align: "right",
      letterSpacing: 0.5,
    }).setOrigin(1, 0.5);
    this.title = scene.add.text(0, top + (tight ? 36 : 41), definition.shortName, {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: width < 205 ? "12px" : "13px",
      fontStyle: "bold",
      color: "#18274a",
      align: "center",
      wordWrap: { width: width - 23, useAdvancedWrap: true },
      lineSpacing: -2,
    }).setOrigin(0.5, 0);

    this.effectsText = scene.add.text(0, height / 2 - (tight ? 50 : 56), this.formatEffects(definition.effects), {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: width < 205 ? "10px" : "11px",
      fontStyle: "bold",
      color: "#192849",
      align: "center",
      wordWrap: { width: width - 18 },
      lineSpacing: -1,
    }).setOrigin(0.5, 0);
    this.scienceText = scene.add.text(0, height / 2 - (tight ? 16 : 18), "NASA DATA", {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: width < 205 ? "9px" : "10px",
      fontStyle: "bold",
      color: "#796d58",
      align: "center",
      wordWrap: { width: width - 16, useAdvancedWrap: true },
      maxLines: 2,
      lineSpacing: -1,
    }).setOrigin(0.5, 0);
    this.zone = scene.add.zone(0, 0, width, height).setSize(width, height).setInteractive({ useHandCursor: true });
    scene.input.setDraggable(this.zone, true);
    this.container.add([this.graphics, this.art, this.costText, typeText, this.title, this.effectsText, this.scienceText, this.zone]);
    this.zone.on("pointerover", () => this.onHover());
    this.zone.on("pointerout", () => this.onLeave());
    this.zone.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.onPress(pointer));
    this.zone.on("pointerup", (pointer: Phaser.Input.Pointer) => this.onRelease(pointer));
    this.zone.on("dragstart", (pointer: Phaser.Input.Pointer) => this.onDragStart(pointer));
    this.zone.on("drag", (pointer: Phaser.Input.Pointer) => this.onDrag(pointer));
    this.zone.on("dragend", (pointer: Phaser.Input.Pointer) => this.onDragEnd(pointer));
    this.setSelected(false, false);
  }

  setPosition(x: number, y: number, depth = this.home.depth): void {
    this.home.x = x;
    this.home.y = y;
    this.home.depth = depth;
    if (!this.dragging) this.container.setPosition(x, y).setDepth(depth);
  }

  setSelected(selected: boolean, animate = true): void {
    this.selected = selected;
    this.redraw();
    const targetY = this.home.y + (selected ? -13 : 0);
    const targetScale = this.hovered ? 1.035 : 1;
    if (animate) {
      this.scene.tweens.killTweensOf(this.container);
      this.scene.tweens.add({ targets: this.container, y: targetY, scaleX: targetScale, scaleY: targetScale, duration: 170, ease: "Back.Out" });
    } else {
      this.container.setY(targetY).setScale(targetScale);
    }
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.container);
    this.container.destroy(true);
  }

  private formatEffects(effects: Effects): string {
    const rows = Object.entries(effects)
      .filter(([, amount]) => Boolean(amount))
      .map(([system, amount]) => `${signed(amount!)} ${SYSTEMS.find((item) => item.id === system)?.label}`);
    const parts = rows.slice(0, 4);
    const output = parts.join("\n");
    return output || "Sin cambios";
  }

  private redraw(): void {
    const definition = this.card.definition;
    const family = FAMILIES[definition.family];
    const x = -this.width / 2;
    const y = -this.height / 2;
    const radius = 15;
    this.graphics.clear();
    this.graphics.fillStyle(0x03091a, 0.16).fillRoundedRect(x + 2, y + 4, this.width, this.height, radius);
    this.graphics.fillStyle(this.selected ? 0xffdf82 : family.color, 0.82).fillRoundedRect(x - 1, y - 1, this.width + 2, this.height + 2, radius + 1);
    this.graphics.fillStyle(0xfff7e5, 1).fillRoundedRect(x, y, this.width, this.height, radius);
    this.graphics.lineStyle(this.selected ? 2.5 : 1.5, this.selected ? 0xffd865 : family.color, 0.9).strokeRoundedRect(x + 1, y + 1, this.width - 2, this.height - 2, radius);
    this.graphics.fillStyle(family.color, 0.82).fillRoundedRect(x + 5, y + 5, this.width - 10, 25, 8);
    this.graphics.fillStyle(0x132345, 1).fillCircle(x + 23, y + 18, 13);
    this.graphics.lineStyle(2, 0xfff6dc, 0.95).strokeCircle(x + 23, y + 18, 13);
    const tight = this.height < 175;
    const artTop = y + (tight ? 54 : 69);
    const artPanelHeight = this.height * (tight ? 0.31 : 0.36) + 10;
    this.graphics.fillStyle(this.hovered ? 0xffe8bd : 0xe7edfa, 0.72).fillRoundedRect(x + 10, artTop, this.width - 20, artPanelHeight, 8);
    this.graphics.lineStyle(1, family.color, 0.35).strokeRoundedRect(x + 10, artTop, this.width - 20, artPanelHeight, 8);
    this.graphics.fillStyle(0x192949, 0.05).fillRoundedRect(x + 7, this.height / 2 - 66, this.width - 14, 46, 8);
    this.costText.setText(`${definition.cost}\nPA`);
    this.title.setColor(this.selected ? "#122249" : "#192849");
    this.art.setAlpha(this.hovered ? 1 : 0.96);
  }

  private onHover(): void {
    this.hovered = true;
    this.events.onHover(this.card);
    this.redraw();
    if (!this.dragging) this.scene.tweens.add({ targets: this.container, y: this.home.y + (this.selected ? -13 : -5), scaleX: 1.035, scaleY: 1.035, duration: 100, ease: "Sine.Out" });
  }

  private onLeave(): void {
    this.hovered = false;
    this.events.onLeave(this.card);
    this.redraw();
    if (!this.dragging) this.scene.tweens.add({ targets: this.container, y: this.home.y + (this.selected ? -13 : 0), scaleX: 1, scaleY: 1, duration: 130, ease: "Sine.Out" });
  }

  private onPress(pointer: Phaser.Input.Pointer): void {
    this.wasDragged = false;
    this.pressOrigin = { x: pointer.x, y: pointer.y };
    this.scene.tweens.add({ targets: this.container, scaleX: 0.965, scaleY: 0.965, duration: 65, ease: "Quad.Out" });
  }

  private onRelease(pointer: Phaser.Input.Pointer): void {
    if (this.dragging) return;
    if (this.wasDragged) {
      this.wasDragged = false;
      return;
    }
    const moved = this.pressOrigin ? Phaser.Math.Distance.Between(pointer.x, pointer.y, this.pressOrigin.x, this.pressOrigin.y) : 0;
    if (moved < 10) this.events.onToggle(this.card);
    this.pressOrigin = null;
    this.scene.tweens.add({ targets: this.container, y: this.home.y + (this.selected ? -13 : this.hovered ? -5 : 0), scaleX: this.hovered ? 1.035 : 1, scaleY: this.hovered ? 1.035 : 1, duration: 130, ease: "Back.Out" });
  }

  private onDragStart(pointer: Phaser.Input.Pointer): void {
    this.dragging = true;
    this.wasDragged = true;
    this.pressOrigin = { x: pointer.x, y: pointer.y };
    this.container.setDepth(100).setScale(1.04);
    this.scene.tweens.add({ targets: this.container, angle: -2, duration: 100, ease: "Sine.Out" });
  }

  private onDrag(pointer: Phaser.Input.Pointer): void {
    if (!this.dragging || !this.pressOrigin) return;
    const baseY = this.home.y + (this.selected ? -13 : 0);
    this.container.setPosition(this.home.x + pointer.x - this.pressOrigin.x, baseY + pointer.y - this.pressOrigin.y);
  }

  private onDragEnd(pointer: Phaser.Input.Pointer): void {
    if (!this.dragging) return;
    const dragged = this.pressOrigin ? Phaser.Math.Distance.Between(pointer.x, pointer.y, this.pressOrigin.x, this.pressOrigin.y) > 18 : true;
    if (dragged) this.events.onDrop(this.card, pointer.x, pointer.y);
    this.dragging = false;
    this.pressOrigin = null;
    this.scene.tweens.add({ targets: this.container, x: this.home.x, y: this.home.y + (this.selected ? -13 : 0), angle: 0, scaleX: this.hovered ? 1.035 : 1, scaleY: this.hovered ? 1.035 : 1, duration: 180, ease: "Back.Out" });
    this.container.setDepth(this.home.depth);
  }
}
