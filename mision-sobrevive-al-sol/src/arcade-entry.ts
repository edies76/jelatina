import Phaser from "phaser";
import "./arcade-style.css";
import lunarOutpostUrl from "../assets/lunar-outpost-background.png";
import astronautUrl from "../assets/astronaut-run.png";
import solarBoltUrl from "../assets/solar-bolt.png";
import shieldCapsuleUrl from "../assets/shield-capsule.png";

const WIDTH = 1280;
const HEIGHT = 720;
const SURVIVAL_SECONDS = 45;
const PLAYER_GROUND_Y = 555;
const SUN_X = 1162;
const SUN_Y = 176;
const MAX_SHIELDS = 3;

interface Controls {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  a: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
  jump: Phaser.Input.Keyboard.Key;
  dash: Phaser.Input.Keyboard.Key;
  enter: Phaser.Input.Keyboard.Key;
}

interface SolarWarning {
  targetX: number;
  age: number;
  duration: number;
  graphics: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

interface SolarBolt {
  image: Phaser.GameObjects.Image;
  startX: number;
  startY: number;
  targetX: number;
  age: number;
  duration: number;
  hit: boolean;
}

interface ShieldPickup {
  image: Phaser.GameObjects.Image;
  age: number;
}

class MissionScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Image;
  private controls!: Controls;
  private menuContainer!: Phaser.GameObjects.Container;
  private hudContainer!: Phaser.GameObjects.Container;
  private timerText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private progressGraphics!: Phaser.GameObjects.Graphics;
  private shieldIcons: Phaser.GameObjects.Image[] = [];
  private statusPanel!: Phaser.GameObjects.Rectangle;
  private statusText!: Phaser.GameObjects.Text;
  private warnings: SolarWarning[] = [];
  private bolts: SolarBolt[] = [];
  private pickups: ShieldPickup[] = [];
  private started = false;
  private finished = false;
  private elapsed = 0;
  private spawnClock = 1.4;
  private pickupClock = 8;
  private shields = MAX_SHIELDS;
  private capsules = 0;
  private score = 0;
  private invulnerableFor = 0;
  private dashFor = 0;
  private dashCooldown = 0;
  private verticalSpeed = 0;
  private grounded = true;
  private facing = 1;

  constructor() {
    super("mission");
  }

  preload(): void {
    this.load.image("lunar-outpost", lunarOutpostUrl);
    this.load.image("astronaut", astronautUrl);
    this.load.image("solar-bolt", solarBoltUrl);
    this.load.image("shield-capsule", shieldCapsuleUrl);
  }

  create(): void {
    this.resetState();

    this.add.image(WIDTH / 2, HEIGHT / 2, "lunar-outpost")
      .setDisplaySize(WIDTH, HEIGHT)
      .setDepth(-10);
    this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x06132e, 0.12)
      .setOrigin(0)
      .setDepth(-9);

    this.cameras.main.setBounds(0, 0, WIDTH, HEIGHT);
    this.cameras.main.postFX?.addVignette(0.5, 0.5, 0.82, 0.28);

    this.player = this.add.image(930, PLAYER_GROUND_Y + 14, "astronaut")
      .setDisplaySize(210, 194)
      .setDepth(20);
    this.player.preFX?.addGlow(0xffc346, 0.34, 0.04, false, 0.12, 14);

    this.controls = {
      left: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      a: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      d: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      jump: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      dash: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      enter: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
    };

    this.createHud();
    this.createMenu();
    document.getElementById("loading-screen")?.classList.add("is-ready");
  }

  update(time: number, deltaMs: number): void {
    const delta = Math.min(deltaMs / 1000, 0.05);

    if (!this.started) {
      this.player.y = PLAYER_GROUND_Y + 14 + Math.sin(time * 0.0024) * 4;
      if (
        Phaser.Input.Keyboard.JustDown(this.controls.jump) ||
        Phaser.Input.Keyboard.JustDown(this.controls.enter)
      ) {
        this.beginMission();
      }
      return;
    }

    if (this.finished) {
      if (
        Phaser.Input.Keyboard.JustDown(this.controls.jump) ||
        Phaser.Input.Keyboard.JustDown(this.controls.enter)
      ) {
        this.scene.restart();
      }
      return;
    }

    this.elapsed = Math.min(SURVIVAL_SECONDS, this.elapsed + delta);
    this.invulnerableFor = Math.max(0, this.invulnerableFor - delta);
    this.dashCooldown = Math.max(0, this.dashCooldown - delta);

    this.updatePlayer(delta);
    this.updateWarnings(delta);
    this.updateBolts(delta);
    this.updatePickups(delta);
    this.updateSpawns(delta);
    this.updateHud();

    if (this.elapsed >= SURVIVAL_SECONDS) {
      this.endMission(true);
    }
  }

  private resetState(): void {
    this.started = false;
    this.finished = false;
    this.elapsed = 0;
    this.spawnClock = 1.9;
    this.pickupClock = 7.5;
    this.shields = MAX_SHIELDS;
    this.capsules = 0;
    this.score = 0;
    this.invulnerableFor = 0;
    this.dashFor = 0;
    this.dashCooldown = 0;
    this.verticalSpeed = 0;
    this.grounded = true;
    this.facing = 1;
    this.warnings = [];
    this.bolts = [];
    this.pickups = [];
  }

  private createMenu(): void {
    const panel = this.add.graphics();
    panel.fillStyle(0x07152f, 0.88).fillRoundedRect(58, 66, 590, 556, 28);
    panel.lineStyle(2, 0xd7edff, 0.22).strokeRoundedRect(58, 66, 590, 556, 28);
    panel.fillStyle(0xffbd3d, 1).fillRoundedRect(88, 92, 216, 31, 13);

    const eyebrow = this.add.text(105, 97, "ARCADE DE SUPERVIVENCIA", {
      fontFamily: '"Nunito", sans-serif',
      fontSize: "14px",
      fontStyle: "bold",
      color: "#172449",
      letterSpacing: 1.2,
    });

    const title = this.add.text(88, 144, "MISIÓN:", {
      fontFamily: '"Russo One", "Trebuchet MS", sans-serif',
      fontSize: "27px",
      color: "#ffd86e",
      letterSpacing: 1.6,
    });

    const titleLineOne = this.add.text(84, 172, "SOBREVIVE", {
      fontFamily: '"Russo One", "Trebuchet MS", sans-serif',
      fontSize: "46px",
      color: "#fff4d7",
      stroke: "#101d47",
      strokeThickness: 4,
    });

    const titleLineTwo = this.add.text(86, 218, "AL SOL", {
      fontFamily: '"Russo One", "Trebuchet MS", sans-serif',
      fontSize: "58px",
      color: "#58e1d6",
      stroke: "#101d47",
      strokeThickness: 5,
    });

    const description = this.add.text(
      94,
      292,
      "El Sol te marca. Muévete, salta o usa el impulso antes de que caiga el rayo.",
      {
        fontFamily: '"Nunito", sans-serif',
        fontSize: "22px",
        fontStyle: "700",
        color: "#e5efff",
        lineSpacing: 4,
        wordWrap: { width: 475 },
      },
    );

    const controlsCard = this.add.graphics();
    controlsCard.fillStyle(0x10264c, 0.88).fillRoundedRect(90, 370, 514, 44, 13);
    controlsCard.lineStyle(1, 0x60dcd5, 0.38).strokeRoundedRect(90, 370, 514, 44, 13);

    const controlsText = this.add.text(106, 383, "A / D  MOVER      ESPACIO  SALTAR      MAYÚS  IMPULSO", {
      fontFamily: '"Nunito", sans-serif',
      fontSize: "17px",
      fontStyle: "bold",
      color: "#a7f2e8",
      letterSpacing: 0.2,
    });

    const button = this.add.rectangle(345, 477, 510, 76, 0xffbd3d, 1)
      .setStrokeStyle(3, 0xffe89c, 0.95)
      .setInteractive({ useHandCursor: true });

    const buttonText = this.add.text(345, 477, "INICIAR MISIÓN", {
      fontFamily: '"Russo One", "Trebuchet MS", sans-serif',
      fontSize: "23px",
      color: "#172449",
      letterSpacing: 1,
    }).setOrigin(0.5);

    button.on("pointerover", () => {
      button.setFillStyle(0xffd766, 1).setScale(1.025);
      buttonText.setScale(1.025);
    });
    button.on("pointerout", () => {
      button.setFillStyle(0xffbd3d, 1).setScale(1);
      buttonText.setScale(1);
    });
    button.on("pointerdown", () => this.beginMission());

    const footer = this.add.text(95, 560, "45 SEGUNDOS  ·  3 ESCUDOS  ·  UNA CÁPSULA PUEDE SALVARTE", {
      fontFamily: '"Nunito", sans-serif',
      fontSize: "15px",
      fontStyle: "bold",
      color: "#b7c8ea",
      letterSpacing: 0.6,
    });

    this.menuContainer = this.add.container(0, 0, [
      panel,
      eyebrow,
      title,
      titleLineOne,
      titleLineTwo,
      description,
      controlsCard,
      controlsText,
      button,
      buttonText,
      footer,
    ]).setDepth(60);

    this.tweens.add({
      targets: this.player,
      y: PLAYER_GROUND_Y + 9,
      duration: 720,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1,
    });
  }

  private createHud(): void {
    const frame = this.add.graphics();
    frame.fillStyle(0x06142e, 0.78).fillRoundedRect(28, 20, 370, 76, 18);
    frame.lineStyle(2, 0xc9e4ff, 0.16).strokeRoundedRect(28, 20, 370, 76, 18);

    const title = this.add.text(50, 32, "SOBREVIVE AL SOL", {
      fontFamily: '"Russo One", "Trebuchet MS", sans-serif',
      fontSize: "23px",
      color: "#fff3d6",
      letterSpacing: 0.8,
    });

    const subtitle = this.add.text(51, 63, "PUESTO LUNAR 01  ·  MISIÓN DE 45 S", {
      fontFamily: '"Nunito", sans-serif',
      fontSize: "15px",
      fontStyle: "bold",
      color: "#a9c4e8",
      letterSpacing: 0.6,
    });

    const progressFrame = this.add.graphics();
    progressFrame.fillStyle(0x06142e, 0.78).fillRoundedRect(420, 20, 405, 76, 18);
    progressFrame.lineStyle(2, 0xc9e4ff, 0.16).strokeRoundedRect(420, 20, 405, 76, 18);

    const progressLabel = this.add.text(444, 31, "TIEMPO HASTA EL RESCATE", {
      fontFamily: '"Nunito", sans-serif',
      fontSize: "15px",
      fontStyle: "bold",
      color: "#d3e4ff",
      letterSpacing: 0.8,
    });

    this.progressGraphics = this.add.graphics();
    this.scoreText = this.add.text(800, 30, "0", {
      fontFamily: '"Russo One", "Trebuchet MS", sans-serif',
      fontSize: "22px",
      color: "#ffe071",
      align: "right",
    }).setOrigin(1, 0);

    const statusPanelRight = this.add.graphics();
    statusPanelRight.fillStyle(0x06142e, 0.78).fillRoundedRect(850, 20, 402, 76, 18);
    statusPanelRight.lineStyle(2, 0xc9e4ff, 0.16).strokeRoundedRect(850, 20, 402, 76, 18);

    const timeLabel = this.add.text(872, 30, "RESTAN", {
      fontFamily: '"Nunito", sans-serif',
      fontSize: "15px",
      fontStyle: "bold",
      color: "#a9c4e8",
      letterSpacing: 1,
    });

    this.timerText = this.add.text(868, 45, "45s", {
      fontFamily: '"Russo One", "Trebuchet MS", sans-serif',
      fontSize: "35px",
      color: "#fff0bc",
    });

    const shieldLabel = this.add.text(1018, 30, "ESCUDO", {
      fontFamily: '"Nunito", sans-serif',
      fontSize: "15px",
      fontStyle: "bold",
      color: "#a9c4e8",
      letterSpacing: 0.8,
    });

    this.shieldIcons = [0, 1, 2].map((index) =>
      this.add.image(1040 + index * 54, 66, "shield-capsule")
        .setDisplaySize(38, 38),
    );

    const helpPanel = this.add.graphics();
    helpPanel.fillStyle(0x06142e, 0.74).fillRoundedRect(32, 654, 690, 42, 14);
    helpPanel.lineStyle(1, 0xc9e4ff, 0.15).strokeRoundedRect(32, 654, 690, 42, 14);

    const helpText = this.add.text(54, 666, "← / → MOVER     ESPACIO SALTAR     MAYÚS IMPULSO", {
      fontFamily: '"Nunito", sans-serif',
      fontSize: "16px",
      fontStyle: "bold",
      color: "#d9e8ff",
      letterSpacing: 0.4,
    });

    this.statusPanel = this.add.rectangle(WIDTH / 2, 139, 420, 48, 0x07152e, 0.86)
      .setStrokeStyle(2, 0x7de9de, 0.5);
    this.statusText = this.add.text(WIDTH / 2, 139, "", {
      fontFamily: '"Russo One", "Trebuchet MS", sans-serif',
      fontSize: "18px",
      color: "#9ff4e8",
      letterSpacing: 1,
    }).setOrigin(0.5);

    this.hudContainer = this.add.container(0, 0, [
      frame,
      title,
      subtitle,
      progressFrame,
      progressLabel,
      this.progressGraphics,
      this.scoreText,
      statusPanelRight,
      timeLabel,
      this.timerText,
      shieldLabel,
      ...this.shieldIcons,
      helpPanel,
      helpText,
      this.statusPanel,
      this.statusText,
    ]).setDepth(80).setVisible(false);
  }

  private beginMission(): void {
    if (this.started) return;
    this.started = true;
    this.tweens.killTweensOf(this.player);
    this.menuContainer.destroy(true);
    this.player
      .setPosition(WIDTH / 2, PLAYER_GROUND_Y)
      .setDisplaySize(142, 132)
      .setFlipX(false)
      .setAngle(0)
      .setAlpha(1)
      .setVisible(true);
    this.hudContainer.setVisible(true);
    this.updateHud();
    this.setStatus("¡EL SOL ESTÁ CARGANDO!", "#ffe071");
  }

  private updatePlayer(delta: number): void {
    const leftDown = this.controls.left.isDown || this.controls.a.isDown;
    const rightDown = this.controls.right.isDown || this.controls.d.isDown;
    const direction = Number(rightDown) - Number(leftDown);

    if (direction !== 0) this.facing = direction;

    if (Phaser.Input.Keyboard.JustDown(this.controls.dash) && this.dashCooldown <= 0) {
      this.dashFor = 0.22;
      this.dashCooldown = 1.35;
      this.setStatus("¡IMPULSO!", "#8cebe1");
    }

    if (Phaser.Input.Keyboard.JustDown(this.controls.jump) && this.grounded) {
      this.verticalSpeed = -660;
      this.grounded = false;
    }

    const dashing = this.dashFor > 0;
    const moveSpeed = dashing ? 790 : 360;
    const movement = dashing && direction === 0 ? this.facing : direction;
    this.player.x = Phaser.Math.Clamp(
      this.player.x + movement * moveSpeed * delta,
      58,
      WIDTH - 58,
    );
    this.player.setFlipX(this.facing < 0);

    if (dashing) {
      this.dashFor = Math.max(0, this.dashFor - delta);
    }

    if (!this.grounded) {
      this.verticalSpeed += 1740 * delta;
      this.player.y += this.verticalSpeed * delta;
      if (this.player.y >= PLAYER_GROUND_Y) {
        this.player.y = PLAYER_GROUND_Y;
        this.verticalSpeed = 0;
        this.grounded = true;
      }
    }

    if (this.invulnerableFor > 0) {
      const blink = Math.floor(this.elapsed * 15) % 2 === 0;
      this.player.setAlpha(blink ? 0.44 : 1);
    } else if (this.dashFor > 0) {
      this.player.setAlpha(0.76);
    } else {
      this.player.setAlpha(1);
    }

    this.player.setAngle(this.grounded && direction !== 0 ? Math.sin(this.elapsed * 20) * 2 : 0);
  }

  private updateSpawns(delta: number): void {
    this.spawnClock -= delta;
    if (this.spawnClock <= 0) {
      this.spawnWarning();
      const difficulty = this.elapsed / SURVIVAL_SECONDS;
      this.spawnClock = 3.25 - difficulty * 0.8 + Phaser.Math.FloatBetween(-0.12, 0.15);
    }

    this.pickupClock -= delta;
    if (this.pickupClock <= 0 && this.pickups.length === 0) {
      this.spawnPickup();
      this.pickupClock = 9.5;
    }
  }

  private spawnWarning(): void {
    const offset = Phaser.Math.Between(-100, 100);
    const targetX = Phaser.Math.Clamp(this.player.x + offset, 90, WIDTH - 90);
    const graphics = this.add.graphics().setDepth(12);
    const label = this.add.text(targetX, PLAYER_GROUND_Y - 87, "¡SAL DEL RAYO!", {
      fontFamily: '"Russo One", "Trebuchet MS", sans-serif',
      fontSize: "18px",
      color: "#fff2b7",
      stroke: "#712e1d",
      strokeThickness: 3,
      letterSpacing: 0.6,
    }).setOrigin(0.5).setDepth(13);

    this.warnings.push({
      targetX,
      age: 0,
      duration: 1.05,
      graphics,
      label,
    });
  }

  private updateWarnings(delta: number): void {
    for (let index = this.warnings.length - 1; index >= 0; index -= 1) {
      const warning = this.warnings[index];
      warning.age += delta;
      const progress = Phaser.Math.Clamp(warning.age / warning.duration, 0, 1);
      const pulse = 0.5 + Math.sin(warning.age * 22) * 0.5;

      warning.graphics.clear();
      warning.graphics.lineStyle(6, 0xffde69, 0.24 + pulse * 0.48);
      warning.graphics.lineBetween(SUN_X, SUN_Y, warning.targetX, PLAYER_GROUND_Y + 8);
      warning.graphics.lineStyle(4, 0xffa34f, 0.48 + pulse * 0.45);
      warning.graphics.strokeCircle(warning.targetX, PLAYER_GROUND_Y + 35, 68 + pulse * 12);
      warning.graphics.fillStyle(0xff7a39, 0.13 + pulse * 0.2);
      warning.graphics.fillEllipse(warning.targetX, PLAYER_GROUND_Y + 38, 164, 31);

      warning.label.setPosition(warning.targetX, PLAYER_GROUND_Y - 106);
      warning.label.setAlpha(0.58 + pulse * 0.42);
      warning.label.setScale(0.96 + pulse * 0.06);

      if (progress >= 1) {
        warning.graphics.destroy();
        warning.label.destroy();
        this.warnings.splice(index, 1);
        this.launchBolt(warning.targetX);
      }
    }
  }

  private launchBolt(targetX: number): void {
    const angle = Phaser.Math.Angle.Between(SUN_X, SUN_Y, targetX, PLAYER_GROUND_Y);
    const image = this.add.image(SUN_X, SUN_Y, "solar-bolt")
      .setDisplaySize(100, 72)
      .setAngle(Phaser.Math.RadToDeg(angle) - 135)
      .setDepth(24);
    image.preFX?.addGlow(0xff8a35, 0.56, 0.08, false, 0.12, 18);

    this.bolts.push({
      image,
      startX: SUN_X,
      startY: SUN_Y,
      targetX,
      age: 0,
      duration: Math.max(0.72, 1 - (this.elapsed / SURVIVAL_SECONDS) * 0.16),
      hit: false,
    });
  }

  private updateBolts(delta: number): void {
    for (let index = this.bolts.length - 1; index >= 0; index -= 1) {
      const bolt = this.bolts[index];
      bolt.age += delta;
      const progress = Phaser.Math.Clamp(bolt.age / bolt.duration, 0, 1);
      const x = Phaser.Math.Linear(bolt.startX, bolt.targetX, progress);
      const y = Phaser.Math.Linear(bolt.startY, PLAYER_GROUND_Y, progress);
      bolt.image.setPosition(x, y).setAlpha(0.86 + Math.sin(this.elapsed * 32) * 0.14);

      const nearPlayer =
        Math.abs(this.player.x - x) < 54 &&
        Math.abs(this.player.y - y) < 76;

      if (!bolt.hit && nearPlayer) {
        bolt.hit = true;
        this.takeHit();
      }

      if (progress >= 1) {
        this.createImpact(bolt.targetX);
        const standingNearImpact =
          this.grounded &&
          Math.abs(this.player.x - bolt.targetX) < 82;
        if (!bolt.hit && standingNearImpact) {
          bolt.hit = true;
          this.takeHit();
        }

        bolt.image.destroy();
        this.bolts.splice(index, 1);
      }
    }
  }

  private createImpact(x: number): void {
    const glow = this.add.circle(x, PLAYER_GROUND_Y + 32, 18, 0xffb846, 0.78).setDepth(22);
    const ring = this.add.circle(x, PLAYER_GROUND_Y + 32, 28)
      .setStrokeStyle(4, 0xff7040, 0.9)
      .setDepth(23);

    this.tweens.add({
      targets: glow,
      scale: 3.8,
      alpha: 0,
      duration: 350,
      ease: "Cubic.Out",
      onComplete: () => glow.destroy(),
    });
    this.tweens.add({
      targets: ring,
      scale: 3.1,
      alpha: 0,
      duration: 360,
      ease: "Cubic.Out",
      onComplete: () => ring.destroy(),
    });
  }

  private spawnPickup(): void {
    const x = Phaser.Math.Between(100, WIDTH - 100);
    const image = this.add.image(x, PLAYER_GROUND_Y - 42, "shield-capsule")
      .setDisplaySize(56, 56)
      .setDepth(18);
    image.preFX?.addGlow(0x37e1ed, 0.48, 0.04, false, 0.12, 12);

    this.tweens.add({
      targets: image,
      y: PLAYER_GROUND_Y - 50,
      duration: 640,
      ease: "Sine.InOut",
      yoyo: true,
      repeat: -1,
    });

    this.pickups.push({ image, age: 0 });
    this.setStatus("¡CÁPSULA DE ESCUDO EN LA ARENA!", "#85f5ec");
  }

  private updatePickups(delta: number): void {
    for (let index = this.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = this.pickups[index];
      pickup.age += delta;
      const closeEnough =
        Math.abs(this.player.x - pickup.image.x) < 58 &&
        Math.abs(this.player.y - pickup.image.y) < 82;

      if (closeEnough) {
        this.collectPickup(pickup);
        this.pickups.splice(index, 1);
      } else if (pickup.age > 8) {
        pickup.image.destroy();
        this.pickups.splice(index, 1);
      } else {
        pickup.image.setAngle(Math.sin(this.elapsed * 3) * 5);
      }
    }
  }

  private collectPickup(pickup: ShieldPickup): void {
    this.capsules += 1;
    if (this.shields < MAX_SHIELDS) {
      this.shields += 1;
      this.setStatus("¡ESCUDO RECUPERADO!", "#85f5ec");
    } else {
      this.dashCooldown = 0;
      this.setStatus("¡IMPULSO RECARGADO!", "#85f5ec");
    }
    this.score += 250;
    this.updateHud();
    pickup.image.setScale(1.3);
    this.tweens.add({
      targets: pickup.image,
      alpha: 0,
      scale: 1.7,
      duration: 180,
      onComplete: () => pickup.image.destroy(),
    });
  }

  private takeHit(): void {
    if (this.finished || this.invulnerableFor > 0 || this.dashFor > 0) return;

    this.shields = Math.max(0, this.shields - 1);
    this.invulnerableFor = 1.15;
    this.cameras.main.shake(180, 0.009);
    this.cameras.main.flash(150, 255, 118, 62);
    this.setStatus("¡RAYO SOLAR!  -1 ESCUDO", "#ffad77");
    this.updateHud();

    if (this.shields <= 0) {
      this.endMission(false);
    }
  }

  private updateHud(): void {
    if (!this.hudContainer) return;
    const secondsLeft = Math.max(0, Math.ceil(SURVIVAL_SECONDS - this.elapsed));
    this.timerText.setText(secondsLeft + "s");
    this.timerText.setColor(secondsLeft <= 10 ? "#ffad77" : "#fff0bc");
    this.scoreText.setText(String(this.score + Math.floor(this.elapsed * 10)).padStart(3, "0"));

    this.progressGraphics.clear();
    this.progressGraphics.fillStyle(0x13264b, 0.95).fillRoundedRect(444, 62, 350, 14, 7);
    const progress = Phaser.Math.Clamp(this.elapsed / SURVIVAL_SECONDS, 0, 1);
    const color = progress > 0.72 ? 0x70e3ce : 0xffc24b;
    this.progressGraphics.fillStyle(color, 1)
      .fillRoundedRect(444, 62, Math.max(6, 350 * progress), 14, 7);
    this.progressGraphics.lineStyle(1, 0xffffff, 0.28)
      .strokeRoundedRect(444, 62, 350, 14, 7);

    this.shieldIcons.forEach((icon, index) => {
      const active = index < this.shields;
      icon.setAlpha(active ? 1 : 0.24);
      icon.setTint(active ? 0xffffff : 0x7585a1);
    });
  }

  private setStatus(message: string, color: string): void {
    if (!this.statusText || !this.statusPanel) return;
    this.tweens.killTweensOf([this.statusPanel, this.statusText]);
    this.statusText.setText(message).setColor(color).setAlpha(1).setVisible(true);
    this.statusPanel.setAlpha(1).setVisible(true);
    this.tweens.add({
      targets: [this.statusPanel, this.statusText],
      alpha: 0,
      delay: 700,
      duration: 300,
      onComplete: () => {
        this.statusPanel.setVisible(false);
        this.statusText.setVisible(false);
      },
    });
  }

  private endMission(survived: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.score += Math.floor(this.elapsed * 10);
    this.hudContainer.setVisible(false);

    const shade = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x04102a, 0.72)
      .setOrigin(0)
      .setDepth(120);
    const panel = this.add.graphics().setDepth(121);
    panel.fillStyle(0x091a38, 0.96).fillRoundedRect(334, 186, 612, 374, 28);
    panel.lineStyle(2, survived ? 0x65e7d7 : 0xff9d62, 0.62)
      .strokeRoundedRect(334, 186, 612, 374, 28);

    const title = this.add.text(WIDTH / 2, 247, survived ? "¡SOL SUPERADO!" : "¡FULGURACIÓN!", {
      fontFamily: '"Russo One", "Trebuchet MS", sans-serif',
        fontSize: "43px",
      color: survived ? "#76eddb" : "#ffc07e",
      stroke: "#07152e",
      strokeThickness: 5,
    }).setOrigin(0.5).setDepth(122);

    const detail = this.add.text(
      WIDTH / 2,
      312,
      survived
        ? "La colonia aguanta. La Tierra ya recibió tu señal."
        : "El último rayo alcanzó tu escudo. ¡La próxima sales a tiempo!",
      {
        fontFamily: '"Nunito", sans-serif',
        fontSize: "20px",
        fontStyle: "bold",
        color: "#dce9ff",
        align: "center",
        wordWrap: { width: 500 },
      },
    ).setOrigin(0.5).setDepth(122);

    const result = this.add.text(
      WIDTH / 2,
      375,
      "TIEMPO  " + Math.floor(this.elapsed) + " s     ·     CÁPSULAS  " + this.capsules +
        "     ·     PUNTOS  " + this.score,
      {
        fontFamily: '"Nunito", sans-serif',
        fontSize: "17px",
        fontStyle: "bold",
        color: "#ffe071",
        align: "center",
        letterSpacing: 0.5,
      },
    ).setOrigin(0.5).setDepth(122);

    const retry = this.add.rectangle(WIDTH / 2, 468, 360, 66, 0xffbd3d, 1)
      .setStrokeStyle(3, 0xffe89c, 0.95)
      .setInteractive({ useHandCursor: true })
      .setDepth(122);
    const retryText = this.add.text(WIDTH / 2, 468, "VOLVER A INTENTAR", {
      fontFamily: '"Russo One", "Trebuchet MS", sans-serif',
      fontSize: "21px",
      color: "#172449",
      letterSpacing: 0.8,
    }).setOrigin(0.5).setDepth(123);

    retry.on("pointerover", () => {
      retry.setFillStyle(0xffd766, 1).setScale(1.025);
      retryText.setScale(1.025);
    });
    retry.on("pointerout", () => {
      retry.setFillStyle(0xffbd3d, 1).setScale(1);
      retryText.setScale(1);
    });
    retry.on("pointerdown", () => this.scene.restart());

    this.add.container(0, 0, [shade, panel, title, detail, result, retry, retryText])
      .setDepth(120);
  }
}

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: "game-container",
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: "#07112b",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    powerPreference: "high-performance",
  },
  scene: [MissionScene],
});
