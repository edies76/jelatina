import Phaser from "phaser";
import { SYSTEMS, type Effects, type ResourceBars, type SystemId } from "../data";

export class ResourceMeter {
  readonly container: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private readonly width: number;
  private readonly height: number;
  private readonly system: (typeof SYSTEMS)[number];
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private readonly valueLabel: Phaser.GameObjects.Text;
  private readonly deltaLabel: Phaser.GameObjects.Text;
  private readonly zone: Phaser.GameObjects.Zone;
  private readonly select?: (system: SystemId) => void;
  private readonly valueState = { value: 50 };
  private previewDelta = 0;
  private hidden = false;
  private selectedTarget = false;
  private selectionEnabled: boolean;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    systemId: SystemId,
    iconTexture: string,
    select?: (system: SystemId) => void,
  ) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.system = SYSTEMS.find((item) => item.id === systemId)!;
    this.select = select;
    this.selectionEnabled = Boolean(select);
    this.container = scene.add.container(x, y);
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(0);
    const compact = width < 155;
    const iconSize = compact ? 18 : 26;
    this.icon = scene.add.image(-width / 2 + (compact ? 14 : 19), 1, iconTexture, `system-icon-${this.system.icon}`).setDisplaySize(iconSize, iconSize);
    this.label = scene.add.text(-width / 2 + 40, -height / 2 + 3, this.system.label, {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: "12px",
      fontStyle: "bold",
      color: "#f1f5ff",
      letterSpacing: 0.6,
      stroke: "#07132e",
      strokeThickness: 1.5,
    }).setOrigin(0, 0);
    this.valueLabel = scene.add.text(width / 2 - 5, -height / 2 + 1, "50%", {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: compact ? "10px" : "13px",
      fontStyle: "bold",
      color: "#fff8e8",
      align: "right",
      stroke: "#07132e",
      strokeThickness: 1.5,
    }).setOrigin(1, 0);
    this.deltaLabel = scene.add.text(width / 2 - 5, height / 2 - 1, "", {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: "11px",
      fontStyle: "bold",
      align: "right",
      color: "#fff8e8",
      stroke: "#07132e",
      strokeThickness: 1.5,
    }).setOrigin(1, 1);
    this.zone = scene.add.zone(0, 0, width, height).setInteractive({ useHandCursor: Boolean(select) });
    this.icon.setDepth(2);
    this.label.setDepth(3);
    this.valueLabel.setDepth(3);
    this.deltaLabel.setDepth(3);
    this.zone.setDepth(4);
    this.label.setVisible(false);
    this.container.add([this.graphics, this.icon, this.valueLabel, this.deltaLabel, this.zone]);
    this.zone.on("pointerup", () => { if (this.selectionEnabled) this.select?.(systemId); });
    this.zone.on("pointerover", () => { if (this.selectionEnabled) this.selectedTarget = true; this.draw(); });
    this.zone.on("pointerout", () => { this.selectedTarget = false; this.draw(); });
    this.draw();
  }

  setData(value: number, previewDelta = 0, hidden = false, selectedTarget = false): void {
    const next = Phaser.Math.Clamp(value, -100, 200);
    if (Math.abs(next - this.valueState.value) > 0.05) {
      this.scene.tweens.killTweensOf(this.valueState);
      this.scene.tweens.add({
        targets: this.valueState,
        value: next,
        duration: 520,
        ease: "Cubic.Out",
        onUpdate: () => this.draw(),
      });
    }
    this.previewDelta = previewDelta;
    this.hidden = hidden;
    this.selectedTarget = selectedTarget;
    this.label.setVisible(false);
    this.valueLabel.setVisible(true).setAlpha(1);
    this.deltaLabel.setVisible(true).setAlpha(1);
    this.draw();
  }

  setSelectionEnabled(enabled: boolean): void {
    this.selectionEnabled = Boolean(enabled && this.select);
    if (this.zone.input) this.zone.input.enabled = this.selectionEnabled;
    if (!this.selectionEnabled) this.selectedTarget = false;
    this.draw();
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.valueState);
    this.label.destroy();
    this.valueLabel.destroy();
    this.deltaLabel.destroy();
    this.container.destroy(true);
  }

  private draw(): void {
    const value = this.valueState.value;
    const displayValue = this.hidden ? "•••" : value >= 100 ? "100+%" : value <= 0 ? "0%" : `${formatPercent(value)}%`;
    this.valueLabel.setText(displayValue);
    const shownDelta = this.hidden ? 0 : this.previewDelta;
    this.deltaLabel.setText(shownDelta ? `${shownDelta > 0 ? "▲ +" : "▼ "}${formatPercent(Math.abs(shownDelta))}%` : this.selectedTarget ? "ELEGIR" : "");
    this.deltaLabel.setColor(shownDelta > 0 ? "#6ef3a7" : shownDelta < 0 ? "#ff7778" : "#ffe9a1");
    this.graphics.clear();
    this.graphics.fillStyle(this.selectedTarget ? 0xffffff : 0x111d42, this.selectedTarget ? 0.14 : 0.82)
      .fillRoundedRect(-this.width / 2, -this.height / 2, this.width, this.height, 10);
    this.graphics.lineStyle(this.selectedTarget ? 2 : 1, this.selectedTarget ? 0xffde7a : 0x6279b7, this.selectedTarget ? 0.85 : 0.45)
      .strokeRoundedRect(-this.width / 2, -this.height / 2, this.width, this.height, 10);
    const compact = this.width < 155;
    const barX = -this.width / 2 + (compact ? 31 : 42);
    const barY = 3;
    const barWidth = this.width - (compact ? 38 : 51);
    const barHeight = compact ? 8 : 11;
    this.graphics.fillStyle(0x050c20, 0.95).fillRoundedRect(barX, barY, barWidth, barHeight, 6);
    const currentWidth = barWidth * Phaser.Math.Clamp(value / 100, 0, 1);
    this.graphics.fillStyle(value < 20 || value > 80 ? 0xff8a57 : this.system.color, 1)
      .fillRoundedRect(barX, barY, Math.max(2, currentWidth), barHeight, 6);
    if (shownDelta !== 0) {
      const targetWidth = barWidth * Phaser.Math.Clamp((value + shownDelta) / 100, 0, 1);
      const left = Math.min(currentWidth, targetWidth);
      const ghostWidth = Math.abs(targetWidth - currentWidth);
      this.graphics.fillStyle(shownDelta > 0 ? 0x58ef9d : 0xff6f79, 0.82)
        .fillRoundedRect(barX + left, barY, Math.max(ghostWidth, 3), barHeight, 5);
    }
    this.graphics.lineStyle(1, 0xffffff, 0.25).strokeRoundedRect(barX, barY, barWidth, barHeight, 6);
    this.graphics.lineStyle(1, 0xffffff, 0.13);
    for (let tick = 1; tick < 4; tick += 1) {
      const x = barX + (barWidth * tick) / 4;
      this.graphics.lineBetween(x, barY + 2, x, barY + barHeight - 2);
    }
    if (value >= 90 || value <= 10) {
      this.graphics.fillStyle(0xff5c64, 0.12).fillRoundedRect(-this.width / 2, -this.height / 2, this.width, this.height, 10);
    }
  }
}

export function previewValue(resources: ResourceBars, changes: Effects, system: SystemId): number {
  return resources[system] + (changes[system] ?? 0);
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
}
