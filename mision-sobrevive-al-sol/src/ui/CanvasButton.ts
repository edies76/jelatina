import Phaser from "phaser";

export interface ButtonPalette {
  fill?: number;
  hover?: number;
  stroke?: number;
  text?: string;
  shadow?: number;
}

export class CanvasButton {
  readonly container: Phaser.GameObjects.Container;
  readonly label: Phaser.GameObjects.Text;
  readonly hitArea: Phaser.GameObjects.Zone;
  private readonly scene: Phaser.Scene;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly width: number;
  private readonly height: number;
  private readonly palette: Required<ButtonPalette>;
  private hovered = false;
  private pressed = false;
  private enabled = true;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    action: () => void,
    palette: ButtonPalette = {},
    fontSize = 17,
  ) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.palette = {
      fill: palette.fill ?? 0xf5b331,
      hover: palette.hover ?? 0xffcc51,
      stroke: palette.stroke ?? 0xfff0bf,
      text: palette.text ?? "#172349",
      shadow: palette.shadow ?? 0x071127,
    };
    this.container = scene.add.container(x, y);
    this.graphics = scene.add.graphics();
    this.label = scene.add.text(0, 0, text, {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: `${fontSize}px`,
      fontStyle: "bold",
      color: this.palette.text,
      align: "center",
      lineSpacing: -2,
      stroke: "#fff8e8",
      strokeThickness: 0,
      shadow: { color: "#071127", fill: false, blur: 0, offsetX: 0, offsetY: 1 },
    }).setOrigin(0.5);
    this.hitArea = scene.add.zone(0, 0, width, height).setInteractive({ useHandCursor: true });
    this.container.add([this.graphics, this.label, this.hitArea]);
    this.container.setSize(width, height);
    this.hitArea.on("pointerover", () => this.onHover());
    this.hitArea.on("pointerout", () => this.onOut());
    this.hitArea.on("pointerdown", () => this.onDown());
    this.hitArea.on("pointerup", () => {
      if (!this.enabled) return;
      this.onUp();
      action();
    });
    this.redraw();
  }

  setText(text: string): void {
    this.label.setText(text);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.hitArea.input) this.hitArea.input.enabled = enabled;
    this.container.setAlpha(enabled ? 1 : 0.48);
    this.redraw();
  }

  setActive(active: boolean): void {
    this.hovered = active;
    this.redraw();
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.container);
    this.container.destroy(true);
  }

  private onHover(): void {
    if (!this.enabled) return;
    this.hovered = true;
    this.redraw();
    this.scene.tweens.add({ targets: this.container, scaleX: 1.035, scaleY: 1.035, duration: 120, ease: "Back.Out" });
  }

  private onOut(): void {
    this.hovered = false;
    this.pressed = false;
    this.redraw();
    this.scene.tweens.add({ targets: this.container, scaleX: 1, scaleY: 1, duration: 130, ease: "Sine.Out" });
  }

  private onDown(): void {
    if (!this.enabled) return;
    this.pressed = true;
    this.redraw();
    this.scene.tweens.add({ targets: this.container, scaleX: 0.965, scaleY: 0.965, duration: 65, ease: "Quad.Out" });
  }

  private onUp(): void {
    this.pressed = false;
    this.redraw();
    this.scene.tweens.add({ targets: this.container, scaleX: this.hovered ? 1.035 : 1, scaleY: this.hovered ? 1.035 : 1, duration: 100, ease: "Back.Out" });
  }

  private redraw(): void {
    const { fill, hover, stroke, shadow } = this.palette;
    const x = -this.width / 2;
    const y = -this.height / 2 + (this.pressed ? 2 : 0);
    const color = this.hovered ? hover : fill;
    this.graphics.clear();
    this.graphics.fillStyle(shadow, 0.2).fillRoundedRect(x + 1, y + 4, this.width, this.height, 13);
    this.graphics.fillStyle(Phaser.Display.Color.GetColor(17, 35, 71), 1).fillRoundedRect(x - 2, y - 2, this.width + 4, this.height + 5, 17);
    this.graphics.fillStyle(color, 1).fillRoundedRect(x, y, this.width, this.height, 15);
    this.graphics.lineStyle(this.hovered ? 2 : 1, stroke, 0.85).strokeRoundedRect(x + 1, y + 1, this.width - 2, this.height - 2, 13);
    this.graphics.fillStyle(0xffffff, this.hovered ? 0.08 : 0.04).fillRoundedRect(x + 8, y + 5, this.width - 16, Math.max(7, this.height * 0.2), 7);
  }
}
