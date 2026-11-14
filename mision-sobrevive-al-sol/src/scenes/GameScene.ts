import Phaser from "phaser";
import {
  ACTION_POINTS,
  EFFECTS_ATLAS,
  ICONS_ATLAS,
  MAX_DAY,
  PLAN_SECONDS,
  RESOLVE_SECONDS,
  SYSTEMS,
  SURVIVAL_ATLAS,
  ATTACKS_ATLAS,
  type CardInstance,
  type AttackCardDefinition,
  type Effects,
  type SystemId,
} from "../data";
import {
  chooseAiPlan,
  createGame,
  emptyPlan,
  getEventForDay,
  getCard,
  isCardSelected,
  planCost,
  previewPlan,
  resolveRound,
  toggleEmergencyShield,
  togglePlanCard,
  type GameState,
  type RoundPlan,
} from "../game-rules";
import { CardView } from "../ui/CardView";
import { CanvasButton } from "../ui/CanvasButton";
import { ColonyPanel } from "../ui/ColonyPanel";

type LayeredParticle = {
  object: Phaser.GameObjects.Arc;
  x: number;
  y: number;
  radius: number;
  speed: number;
  alpha: number;
  phase: number;
  amplitude: number;
};

const COLORS = {
  ink: 0x07132e,
  navy: 0x0c1b3b,
  panel: 0x0d1d3f,
  cream: 0xfff4dc,
  gold: 0xffc149,
  cyan: 0x45dff3,
  mint: 0x75efb1,
  coral: 0xff6c76,
  violet: 0xad8bff,
  white: 0xfffbef,
};

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private plans: [RoundPlan, RoundPlan] = [emptyPlan(), emptyPlan()];
  private phase: "planning" | "resolving" | "over" = "planning";
  private timerSeconds = PLAN_SECONDS;
  private paused = false;
  private resolveElapsed = 0;
  private pendingState: GameState | null = null;
  private pendingApplied = false;
  private hoveredUid: string | undefined;
  private feedback = "Elige cartas (3 PA), revisa las barras y resuelve el turno.";
  private feedbackColor = COLORS.cream;
  private screenWidth = 1280;
  private screenHeight = 720;
  private narrowLayout = false;
  private background!: Phaser.GameObjects.Image;
  private backgroundShade!: Phaser.GameObjects.Rectangle;
  private foreground!: Phaser.GameObjects.Graphics;
  private stars: LayeredParticle[] = [];
  private uiRoot!: Phaser.GameObjects.Container;
  private colonyPanels: ColonyPanel[] = [];
  private cardViews: CardView[] = [];
  private cardViewsByUid = new Map<string, CardView>();
  private handPage = 0;
  private handPageButtons: CanvasButton[] = [];
  private actionButton?: CanvasButton;
  private emergencyButton?: CanvasButton;
  private pauseButton?: CanvasButton;
  private dayLabel?: Phaser.GameObjects.Text;
  private phaseLabel?: Phaser.GameObjects.Text;
  private timerLabel?: Phaser.GameObjects.Text;
  private timerBar?: Phaser.GameObjects.Graphics;
  private progressDots?: Phaser.GameObjects.Graphics;
  private messageLabel?: Phaser.GameObjects.Text;
  private messagePlate?: Phaser.GameObjects.Graphics;
  private eventArt?: Phaser.GameObjects.Image;
  private eventTitle?: Phaser.GameObjects.Text;
  private eventDetail?: Phaser.GameObjects.Text;
  private eventDayLabel?: Phaser.GameObjects.Text;
  private actionPointsLabel?: Phaser.GameObjects.Text;
  private actionPointsGraphics?: Phaser.GameObjects.Graphics;
  private dropZoneGraphics?: Phaser.GameObjects.Graphics;
  private dropZone?: Phaser.GameObjects.Zone;
  private dropBounds = new Phaser.Geom.Rectangle(0, 0, 0, 0);
  private currentEventTarget?: SystemId;
  private ambientFx: Phaser.GameObjects.Image[] = [];

  constructor() {
    super("GameScene");
  }

  preload(): void {
    this.load.image("world-background", new URL("../../assets/lunar-outpost-background.png", import.meta.url).href);
    this.load.image("crew-captain", new URL("../../assets/crew-captain.png", import.meta.url).href);
    this.load.image("sun-mascot", new URL("../../assets/sun-mascot.png", import.meta.url).href);
    this.load.image("survival-atlas", new URL("../../assets/survival-cards-atlas.png", import.meta.url).href);
    this.load.image("battle-atlas", new URL("../../assets/attack-events-atlas.png", import.meta.url).href);
    this.load.image("system-icon-atlas", new URL("../../assets/system-family-icons-atlas.png", import.meta.url).href);
    this.load.image("effects-atlas", new URL("../../assets/effects-atlas.png", import.meta.url).href);
  }

  create(): void {
    this.state = createGame("solo");
    this.input.dragDistanceThreshold = 8;
    this.screenWidth = this.scale.width;
    this.screenHeight = this.scale.height;
    this.createAtlasFrames("survival-atlas", "survival-art", SURVIVAL_ATLAS.cols, SURVIVAL_ATLAS.rows);
    this.createAtlasFrames("battle-atlas", "battle-art", ATTACKS_ATLAS.cols, ATTACKS_ATLAS.rows);
    this.createAtlasFrames("system-icon-atlas", "system-icon", ICONS_ATLAS.cols, ICONS_ATLAS.rows);
    this.createAtlasFrames("effects-atlas", "effects-art", EFFECTS_ATLAS.cols, EFFECTS_ATLAS.rows);
    this.createWorld();
    this.buildInterface();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.input.keyboard?.on("keydown-SPACE", () => this.togglePause());
    this.input.keyboard?.on("keydown-ENTER", () => this.submitPlan());
    this.input.keyboard?.on("keydown-R", () => this.restart());
    this.input.keyboard?.on("keydown-ONE", () => this.toggleCardByIndex(0));
    this.input.keyboard?.on("keydown-TWO", () => this.toggleCardByIndex(1));
    this.input.keyboard?.on("keydown-THREE", () => this.toggleCardByIndex(2));
    this.input.keyboard?.on("keydown-FOUR", () => this.toggleCardByIndex(3));
    this.input.keyboard?.on("keydown-FIVE", () => this.toggleCardByIndex(4));
    const loading = document.getElementById("loading-screen");
    if (loading) {
      loading.classList.add("is-ready");
      window.setTimeout(() => loading.remove(), 260);
    }
    this.animateCardsIn();
  }

  update(time: number, delta: number): void {
    this.updateAmbience(time, delta);
    if (this.phase === "planning" && !this.paused) {
      this.timerSeconds = Math.max(0, this.timerSeconds - delta / 1000);
      this.updateTimerDisplay();
      if (this.timerSeconds <= 0) this.submitPlan();
    } else if (this.phase === "resolving") {
      this.resolveElapsed += delta / 1000;
      if (!this.pendingApplied && this.resolveElapsed >= 1.25) this.applyPendingResolution();
      if (this.resolveElapsed >= RESOLVE_SECONDS) this.finishResolution();
      this.updateTimerDisplay();
    }
  }

  private createAtlasFrames(textureKey: string, prefix: string, columns: number, rows: number): void {
    const texture = this.textures.get(textureKey);
    const source = texture.getSourceImage() as HTMLImageElement;
    const frames = texture.frames as Record<string, Phaser.Textures.Frame>;
    const frameWidth = source.width / columns;
    const frameHeight = source.height / rows;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const key = `${prefix}-${index}`;
        if (!frames[key]) {
          texture.add(key, 0, Math.floor(column * frameWidth), Math.floor(row * frameHeight), Math.ceil(frameWidth), Math.ceil(frameHeight));
        }
      }
    }
  }

  private createWorld(): void {
    this.background = this.add.image(this.screenWidth / 2, this.screenHeight / 2, "world-background")
      .setDepth(-40)
      .setDisplaySize(this.screenWidth * 1.06, this.screenHeight * 1.06)
      .setAlpha(0.62);
    this.backgroundShade = this.add.rectangle(this.screenWidth / 2, this.screenHeight / 2, this.screenWidth, this.screenHeight, 0x06102a, 0.42)
      .setDepth(-39);
    this.foreground = this.add.graphics().setDepth(-5);
    this.makeStarLayers();
    this.drawForeground();
    const sparkles = ["effects-art-1", "effects-art-11"];
    sparkles.forEach((frame, index) => {
      const x = this.screenWidth * (0.22 + index * 0.19);
      const y = this.screenHeight * (0.47 + (index % 2) * 0.06);
      const fx = this.add.image(x, y, "effects-atlas", frame)
        .setDisplaySize(20 + (index % 2) * 7, 20 + (index % 2) * 7)
        .setAlpha(0.16)
        .setDepth(-4);
      this.ambientFx.push(fx);
      this.tweens.add({ targets: fx, y: y - 5, alpha: 0.28, duration: 2800 + index * 280, ease: "Sine.InOut", yoyo: true, repeat: -1 });
    });
  }

  private makeStarLayers(): void {
    this.stars.forEach((star) => star.object.destroy());
    this.stars = [];
    const count = this.screenWidth < 1100 ? 36 : 54;
    for (let index = 0; index < count; index += 1) {
      const near = index % 7 === 0;
      const radius = near ? Phaser.Math.FloatBetween(1.5, 2.5) : Phaser.Math.FloatBetween(0.6, 1.4);
      const x = Phaser.Math.Between(0, this.screenWidth);
      const y = Phaser.Math.Between(0, this.screenHeight);
      const color = near ? (index % 2 ? 0x61dfff : 0xffdc86) : 0xeaf2ff;
      const alpha = near ? 0.7 : Phaser.Math.FloatBetween(0.24, 0.65);
      const object = this.add.circle(x, y, radius, color, alpha).setDepth(near ? -12 : -20);
      this.stars.push({ object, x, y, radius, speed: near ? Phaser.Math.FloatBetween(5, 13) : Phaser.Math.FloatBetween(1, 4), alpha, phase: Phaser.Math.FloatBetween(0, Math.PI * 2), amplitude: near ? 3 : 1.1 });
    }
  }

  private drawForeground(): void {
    this.foreground.clear();
    const width = this.screenWidth;
    const height = this.screenHeight;
    const base = height - Math.max(25, height * 0.055);
    this.foreground.fillStyle(0x1a2d5c, 0.58);
    this.foreground.fillPoints([
      new Phaser.Geom.Point(0, base + 15),
      new Phaser.Geom.Point(width * 0.08, base - 6),
      new Phaser.Geom.Point(width * 0.17, base + 5),
      new Phaser.Geom.Point(width * 0.29, base - 16),
      new Phaser.Geom.Point(width * 0.42, base + 7),
      new Phaser.Geom.Point(width * 0.56, base - 9),
      new Phaser.Geom.Point(width * 0.69, base + 6),
      new Phaser.Geom.Point(width * 0.81, base - 20),
      new Phaser.Geom.Point(width * 0.92, base + 2),
      new Phaser.Geom.Point(width, base - 8),
      new Phaser.Geom.Point(width, height),
      new Phaser.Geom.Point(0, height),
    ], true);
    this.foreground.fillStyle(0x111f49, 0.68);
    this.foreground.fillPoints([
      new Phaser.Geom.Point(0, height - 18),
      new Phaser.Geom.Point(width * 0.11, height - 35),
      new Phaser.Geom.Point(width * 0.22, height - 20),
      new Phaser.Geom.Point(width * 0.32, height - 44),
      new Phaser.Geom.Point(width * 0.45, height - 21),
      new Phaser.Geom.Point(width * 0.58, height - 32),
      new Phaser.Geom.Point(width * 0.72, height - 16),
      new Phaser.Geom.Point(width * 0.84, height - 39),
      new Phaser.Geom.Point(width, height - 21),
      new Phaser.Geom.Point(width, height),
      new Phaser.Geom.Point(0, height),
    ], true);
  }

  private updateAmbience(time: number, delta: number): void {
    if (!this.background || !this.foreground) return;
    const dt = Math.min(delta, 60) / 1000;
    this.background.setPosition(this.screenWidth / 2 + Math.sin(time / 8400) * 7, this.screenHeight / 2 + Math.sin(time / 6100) * 4);
    this.foreground.x = Math.sin(time / 5200) * 5;
    for (const star of this.stars) {
      star.x += star.speed * dt;
      if (star.x > this.screenWidth + 4) star.x = -4;
      star.object.setPosition(star.x, star.y + Math.sin(time / 920 + star.phase) * star.amplitude);
      star.object.setAlpha(star.alpha * (0.72 + Math.sin(time / 550 + star.phase) * 0.28));
    }
  }

  private onResize(gameSize: Phaser.Structs.Size): void {
    this.screenWidth = gameSize.width;
    this.screenHeight = gameSize.height;
    this.background?.setPosition(this.screenWidth / 2, this.screenHeight / 2).setDisplaySize(this.screenWidth * 1.06, this.screenHeight * 1.06);
    this.backgroundShade?.setPosition(this.screenWidth / 2, this.screenHeight / 2).setSize(this.screenWidth, this.screenHeight);
    this.foreground?.setPosition(0, 0);
    this.makeStarLayers();
    this.drawForeground();
    this.buildInterface();
  }

  private buildInterface(): void {
    this.destroyInterface();
    this.uiRoot = this.add.container(0, 0).setDepth(10);
    this.colonyPanels = [];
    this.cardViews = [];
    this.cardViewsByUid.clear();
    this.ambientFx.forEach((fx) => fx.setPosition(fx.x, fx.y));
    const width = this.screenWidth;
    const height = this.screenHeight;
    const narrow = width < 900 || height < 560;
    this.narrowLayout = narrow;
    const compact = height < 790;
    const headerY = narrow ? 18 : 28;
    const timelineY = narrow ? 43 : 71;
    const panelWidth = Math.min(width * (narrow ? 0.43 : 0.445), 650);
    const panelHeight = narrow ? Math.min(118, height * 0.3) : Math.min(compact ? 215 : 240, height * 0.29);
    const panelY = narrow ? 78 : compact ? 135 : 148;
    const leftX = Math.max(18, 22 + panelWidth / 2);
    const rightX = width - leftX;
    this.buildHeader(width, headerY, narrow);
    this.buildTimeline(width, timelineY, narrow);
    this.buildColonies(leftX, rightX, panelY, panelWidth, panelHeight);
    const eventY = panelY + panelHeight + (narrow ? 30 : compact ? 41 : 46);
    this.buildEventSpotlight(eventY, width, compact, narrow);
    this.buildHand(width, height, compact, narrow);
    this.refreshBoard();
    this.updateHeader();
    this.updateActionPanel();
    this.updateEventSpotlight();
    if (this.phase === "over") this.buildOutcomeOverlay();
  }

  private destroyInterface(): void {
    this.colonyPanels.forEach((panel) => panel.destroy());
    this.cardViews.forEach((view) => view.destroy());
    this.handPageButtons.forEach((button) => button.destroy());
    this.handPageButtons = [];
    this.actionButton?.destroy();
    this.emergencyButton?.destroy();
    this.pauseButton?.destroy();
    this.actionButton = undefined;
    this.emergencyButton = undefined;
    this.pauseButton = undefined;
    if (this.uiRoot?.active) this.uiRoot.destroy(true);
  }

  private buildHeader(width: number, y: number, narrow: boolean): void {
    const titleIcon = this.add.image(narrow ? 18 : 33, y, "system-icon-atlas", "system-icon-4").setDisplaySize(narrow ? 24 : 39, narrow ? 24 : 39);
    const title = this.add.text(narrow ? 36 : 60, y - (narrow ? 5 : 8), "MISIÓN", {
      fontFamily: 'Impact, "Arial Black", "Trebuchet MS", sans-serif',
      fontSize: narrow ? "15px" : "23px",
      color: "#fff2ca",
      stroke: "#17264c",
      strokeThickness: 4,
    }).setOrigin(0, 0.5);
    const subtitle = this.add.text(narrow ? 37 : 61, y + (narrow ? 8 : 12), "SOBREVIVE AL SOL", {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: narrow ? "7px" : "11px",
      fontStyle: "bold",
      color: "#70dff1",
      letterSpacing: 1.1,
    }).setOrigin(0, 0.5);
    this.phaseLabel = this.add.text(width * 0.32, y, this.phase === "planning" ? "PLANIFICACIÓN" : "RESOLUCIÓN", {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: "11px",
      fontStyle: "bold",
      color: "#d6e2ff",
      letterSpacing: 1,
    }).setOrigin(0, 0.5).setVisible(!narrow);
    this.dayLabel = this.add.text(width * (narrow ? 0.47 : 0.5), y - 5, `DÍA ${this.state.day} / ${MAX_DAY}`, {
      fontFamily: 'Impact, "Arial Black", sans-serif',
      fontSize: narrow ? "15px" : "20px",
      color: "#fff1bf",
      stroke: "#17264c",
      strokeThickness: 3,
      align: "center",
    }).setOrigin(0.5);
    this.progressDots = this.add.graphics();
    this.timerBar = this.add.graphics();
    this.timerLabel = this.add.text(width - (narrow ? 113 : 196), y, `${Math.ceil(this.timerSeconds)} s`, {
      fontFamily: 'Impact, "Arial Black", sans-serif',
      fontSize: narrow ? "15px" : "21px",
      color: "#ffe28a",
      align: "right",
    }).setOrigin(1, 0.5);
    this.pauseButton = new CanvasButton(this, width - (narrow ? 28 : 55), y, narrow ? 54 : 76, narrow ? 30 : 38, this.paused ? "SEGUIR" : "PAUSAR", () => this.togglePause(), {
      fill: 0x172d5c,
      hover: 0x24447c,
      stroke: 0x8fdcf0,
      text: "#eaf7ff",
    }, narrow ? 8 : 10);
    this.uiRoot.add([titleIcon, title, subtitle, this.phaseLabel, this.dayLabel, this.progressDots, this.timerBar, this.timerLabel, this.pauseButton.container]);
  }

  private buildTimeline(width: number, y: number, narrow: boolean): void {
    const x0 = narrow ? 16 : 26;
    const chipWidth = (width - x0 * 2) / 5;
    const track = this.add.graphics();
    track.fillStyle(0x0b1a3a, 0.32).fillRoundedRect(x0, y, width - x0 * 2, 31, 9);
    track.lineStyle(1, 0x6a80b7, 0.2).strokeRoundedRect(x0, y, width - x0 * 2, 31, 9);
    this.uiRoot.add(track);
    for (let index = 0; index < 5; index += 1) {
      const day = (index + 1) * 3;
      const event = this.state.globalDeck[index];
      const x = x0 + index * chipWidth;
      const isCurrent = day === this.state.day;
      const panel = this.add.graphics();
      const accent = isCurrent ? COLORS.coral : COLORS.gold;
      panel.fillStyle(accent, isCurrent ? 1 : 0.6).fillCircle(x + 15, y + 15.5, isCurrent ? 4 : 3);
      if (index < 4) panel.lineStyle(1, 0x6a80b7, 0.2).lineBetween(x + chipWidth - 1, y + 8, x + chipWidth - 1, y + 23);
      const dayText = this.add.text(x + 25, y + 15.5, `D${day}`, {
        fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
        fontSize: narrow ? "8px" : "10px",
        fontStyle: "bold",
        color: isCurrent ? "#ff8c92" : "#e9ce84",
        align: "center",
      }).setOrigin(0.5);
      const compactEvents: Record<string, string> = {
        "lunar-night": "LUNA",
        "class-x-flare": "CLASE X",
        "martian-dust": "POLVO",
        "calm-solar-wind": "CALMA",
        resupply: "CARGA",
        "galactic-radiation": "RAYOS",
      };
      const eventName = narrow ? compactEvents[event.definition.id] ?? event.definition.shortName : event.definition.shortName;
      const eventText = this.add.text(x + (narrow ? 42 : 45), y + 15.5, eventName, {
        fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
        fontSize: narrow ? "7px" : width < 1150 ? "9px" : "10px",
        color: isCurrent ? "#fff3e5" : "#b8c7e2",
        maxLines: 1,
      }).setOrigin(0, 0.5);
      this.uiRoot.add([panel, dayText, eventText]);
    }
  }

  private buildColonies(leftX: number, rightX: number, y: number, panelWidth: number, panelHeight: number): void {
    const select = (system: SystemId) => this.selectGlobalTarget(system);
    const panelA = new ColonyPanel(this, leftX, y + panelHeight / 2, panelWidth, panelHeight, "TU COLONIA", "crew-captain", "__BASE", "system-icon-atlas", COLORS.cyan, true, select);
    const panelB = new ColonyPanel(this, rightX, y + panelHeight / 2, panelWidth, panelHeight, "COLONIA IA", "sun-mascot", "__BASE", "system-icon-atlas", COLORS.coral, false);
    this.colonyPanels = [panelA, panelB];
    const centerX = this.screenWidth / 2;
    const versusPlate = this.add.graphics();
    versusPlate.fillStyle(0x0b1a38, 0.88).fillCircle(centerX, y + panelHeight / 2, 22);
    versusPlate.lineStyle(1, 0x9caccb, 0.4).strokeCircle(centerX, y + panelHeight / 2, 22);
    const versus = this.add.text(centerX, y + panelHeight / 2, "VS", {
      fontFamily: 'Impact, "Arial Black", sans-serif',
      fontSize: "11px",
      color: "#d7e1f0",
    }).setOrigin(0.5);
    this.uiRoot.add([panelA.container, panelB.container, versusPlate, versus]);
    this.addResourceNames(leftX, rightX, y + panelHeight / 2, panelWidth, panelHeight);
  }

  private addResourceNames(leftX: number, rightX: number, panelY: number, panelWidth: number, panelHeight: number): void {
    const gapX = 10;
    const barWidth = (panelWidth - 24 - gapX) / 2;
    const barHeight = Math.min(49, (panelHeight - 62) / 2 - 5);
    const innerX = -panelWidth / 2 + 12;
    const startY = -panelHeight / 2 + 64 + barHeight / 2;
    for (const [panelIndex, panelX] of [leftX, rightX].entries()) {
      SYSTEMS.forEach((system, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = panelX + innerX + col * (barWidth + gapX) + 40;
        const y = panelY + startY + row * (barHeight + 7) - barHeight / 2 + 3;
        const compact = barWidth < 155;
        const name = this.add.text(x, y, system.label, {
          fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
          fontSize: compact ? "9px" : "12px",
          fontStyle: "bold",
          color: "#f1f5ff",
          stroke: "#07132e",
          strokeThickness: 2,
          letterSpacing: 0.6,
        }).setDepth(30);
        this.uiRoot.add(name);
      });
    }
  }

  private buildEventSpotlight(y: number, width: number, compact: boolean, narrow: boolean): void {
    const panelWidth = Math.min(narrow ? 520 : 520, narrow ? width - 28 : width * 0.56);
    const panelHeight = narrow ? 60 : compact ? 72 : 88;
    const eventRoot = this.add.container(width / 2, y);
    const panel = this.add.graphics();
    panel.fillStyle(0x081733, 0.55).fillRoundedRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight, 12);
    panel.lineStyle(1, 0x7a8fb8, 0.32).strokeRoundedRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight, 12);
    const event = this.getSpotlightEvent();
    this.eventArt = this.add.image(-panelWidth / 2 + (narrow ? 27 : 48), 0, "battle-atlas", `battle-art-${event.definition.art}`).setDisplaySize(narrow ? 32 : compact ? 46 : 54, narrow ? 32 : compact ? 46 : 54);
    const textX = -panelWidth / 2 + (narrow ? 51 : 88);
    this.eventDayLabel = this.add.text(textX, narrow ? -21 : -panelHeight / 2 + 16, `PRÓXIMO EVENTO · DÍA ${this.getSpotlightDay()}`, {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: narrow ? "7px" : "9px",
      fontStyle: "bold",
      color: "#ffdf8a",
      letterSpacing: 0.7,
    }).setOrigin(0, 0.5);
    this.eventTitle = this.add.text(textX, narrow ? -6 : -panelHeight / 2 + 36, event.definition.name.toUpperCase(), {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: narrow ? "9px" : compact ? "11px" : "13px",
      fontStyle: "bold",
      color: "#f8fbff",
      wordWrap: { width: panelWidth - (narrow ? 65 : 125) },
      maxLines: 1,
    }).setOrigin(0, 0.5);
    this.eventDetail = this.add.text(textX, narrow ? 8 : panelHeight / 2 - 13, event.definition.science, {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: narrow ? "7px" : compact ? "9px" : "10px",
      color: "#c9d9fa",
      wordWrap: { width: panelWidth - (narrow ? 65 : 125) },
      maxLines: narrow ? 1 : 2,
      lineSpacing: -1,
    }).setOrigin(0, 0.5);
    this.messagePlate = this.add.graphics();
    this.messageLabel = this.add.text(0, narrow ? 23 : panelHeight / 2 + 14, this.feedback, {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: narrow ? "7px" : compact ? "10px" : "11px",
      fontStyle: "bold",
      color: "#fff2d1",
      align: "center",
      wordWrap: { width: narrow ? panelWidth - 65 : width - 120 },
      maxLines: narrow ? 1 : 2,
    }).setOrigin(0.5, 0.5);
    eventRoot.add([panel, this.eventArt, this.eventDayLabel, this.eventTitle, this.eventDetail, this.messagePlate, this.messageLabel]);
    this.uiRoot.add(eventRoot);
  }

  private buildHand(width: number, height: number, compact: boolean, narrow: boolean): void {
    if (narrow) {
      this.buildNarrowHand(width, height);
      return;
    }
    const cardHeight = Math.min(compact ? 198 : 232, height * 0.265);
    const cardY = height - cardHeight / 2 - 28;
    const actionWidth = Math.min(168, width * 0.14);
    const cardGap = 10;
    const cardWidth = Math.min(224, (width - 60 - actionWidth - 12 - cardGap * 4) / 5);
    const cardsTotal = cardWidth * 5 + cardGap * 4;
    const groupWidth = cardsTotal + 12 + actionWidth;
    const startX = (width - groupWidth) / 2 + cardWidth / 2;
    const player = this.state.players[0];
    const hand = [...player.survivalHand, ...player.attackHand];
    hand.forEach((card, index) => {
      const x = startX + index * (cardWidth + cardGap);
      const view = new CardView(this, card, x, cardY, cardWidth, cardHeight, "survival-atlas", "battle-atlas", {
        onToggle: (selectedCard) => this.toggleCard(selectedCard),
        onHover: (hoveredCard) => this.onCardHover(hoveredCard),
        onLeave: (leftCard) => this.onCardLeave(leftCard),
        onDrop: (droppedCard, dropX, dropY) => this.onCardDrop(droppedCard, dropX, dropY),
      }, 20 + index);
      this.cardViews.push(view);
      this.cardViewsByUid.set(card.uid, view);
      this.uiRoot.add(view.container);
      if (isCardSelected(this.plans[0], card.uid)) view.setSelected(true, false);
    });

    const actionX = startX - cardWidth / 2 + cardsTotal + 12 + actionWidth / 2;
    const actionTop = cardY - cardHeight / 2;
    const actionBottom = actionTop + cardHeight;
    const panel = this.add.graphics();
    panel.fillStyle(0x07132c, 0.82).fillRoundedRect(actionX - actionWidth / 2, actionTop, actionWidth, cardHeight, 18);
    panel.lineStyle(2, 0x607ab9, 0.68).strokeRoundedRect(actionX - actionWidth / 2, actionTop, actionWidth, cardHeight, 18);
    this.uiRoot.add(panel);

    this.actionPointsGraphics = this.add.graphics();
    this.actionPointsLabel = this.add.text(actionX, actionTop + 20, "3 PA DISPONIBLES", {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: compact ? "10px" : "11px",
      fontStyle: "bold",
      color: "#fff0c4",
      align: "center",
    }).setOrigin(0.5);
    this.uiRoot.add([this.actionPointsGraphics, this.actionPointsLabel]);

    this.emergencyButton = new CanvasButton(this, actionX, actionTop + cardHeight * 0.39, actionWidth - 16, compact ? 43 : 48, "GUARDAR 1 PA\nESCUDO ½", () => this.toggleShield(), {
      fill: 0x293565,
      hover: 0x3b4c8e,
      stroke: 0xffd15d,
      text: "#fff3cc",
    }, compact ? 9 : 10);
    this.uiRoot.add(this.emergencyButton.container);

    const dropY = actionTop + cardHeight * (compact ? 0.58 : 0.59);
    this.dropZoneBounds(actionX, dropY, actionWidth - 18, compact ? 26 : 32);
    const dropHint = this.add.text(actionX, dropY, "ARRASTRA AQUÍ", {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: compact ? "8px" : "9px",
      fontStyle: "bold",
      color: "#c9f8da",
      align: "center",
    }).setOrigin(0.5);
    this.uiRoot.add(dropHint);
    this.actionButton = new CanvasButton(this, actionX, actionBottom - (compact ? 30 : 36), actionWidth - 16, compact ? 47 : 52, "RESOLVER\nTURNO", () => this.submitPlan(), {
      fill: 0x72e597,
      hover: 0x91ffb2,
      stroke: 0xe1ffe7,
      text: "#12324a",
    }, compact ? 12 : 13);
    this.uiRoot.add(this.actionButton.container);

    const hint = this.add.text(width / 2, height - 8, "VERDE ↑ SUBE  ·  ROJO ↓ BAJA  ·  HAZ CLIC O ARRASTRA PARA ELEGIR", {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif',
      fontSize: "9px",
      fontStyle: "bold",
      color: "#d1dbfa",
      letterSpacing: 0.5,
    }).setOrigin(0.5, 1).setAlpha(0.82);
    this.uiRoot.add(hint);
  }

  private buildNarrowHand(width: number, height: number): void {
    const cardHeight = Math.min(158, Math.max(132, height * 0.4));
    const cardY = height - cardHeight / 2 - 4;
    const actionWidth = Math.min(142, width * 0.23);
    const cardGap = 8;
    const cardWidth = Math.min(226, (width - 28 - actionWidth - 12 - cardGap) / 2);
    const cardsTotal = cardWidth * 2 + cardGap;
    const groupWidth = cardsTotal + 12 + actionWidth;
    const startX = (width - groupWidth) / 2 + cardWidth / 2;
    const hand = [...this.state.players[0].survivalHand, ...this.state.players[0].attackHand];
    const pages = Math.max(1, Math.ceil(hand.length / 2));
    this.handPage = Phaser.Math.Clamp(this.handPage, 0, pages - 1);
    const visibleCards = hand.slice(this.handPage * 2, this.handPage * 2 + 2);

    visibleCards.forEach((card, index) => {
      const view = new CardView(this, card, startX + index * (cardWidth + cardGap), cardY, cardWidth, cardHeight, "survival-atlas", "battle-atlas", {
        onToggle: (selectedCard) => this.toggleCard(selectedCard),
        onHover: (hoveredCard) => this.onCardHover(hoveredCard),
        onLeave: (leftCard) => this.onCardLeave(leftCard),
        onDrop: (droppedCard, dropX, dropY) => this.onCardDrop(droppedCard, dropX, dropY),
      }, 20 + index);
      this.cardViews.push(view);
      this.cardViewsByUid.set(card.uid, view);
      this.uiRoot.add(view.container);
      if (isCardSelected(this.plans[0], card.uid)) view.setSelected(true, false);
    });

    const actionX = startX - cardWidth / 2 + cardsTotal + 12 + actionWidth / 2;
    const actionTop = cardY - cardHeight / 2;
    const actionBottom = actionTop + cardHeight;
    const panel = this.add.graphics();
    panel.fillStyle(0x07132c, 0.8).fillRoundedRect(actionX - actionWidth / 2, actionTop, actionWidth, cardHeight, 12);
    panel.lineStyle(1, 0x607ab9, 0.55).strokeRoundedRect(actionX - actionWidth / 2, actionTop, actionWidth, cardHeight, 12);
    this.uiRoot.add(panel);

    const changePage = (step: number) => {
      const page = Phaser.Math.Clamp(this.handPage + step, 0, pages - 1);
      if (page === this.handPage) return;
      this.handPage = page;
      this.buildInterface();
      this.animateCardsIn();
    };
    const pagePrevious = new CanvasButton(this, actionX - 45, actionTop + 15, 24, 22, "‹", () => changePage(-1), {
      fill: 0x1a2c4a, hover: 0x31476c, stroke: 0x8092b3, text: "#f0f3f8",
    }, 15);
    const pageNext = new CanvasButton(this, actionX + 45, actionTop + 15, 24, 22, "›", () => changePage(1), {
      fill: 0x1a2c4a, hover: 0x31476c, stroke: 0x8092b3, text: "#f0f3f8",
    }, 15);
    pagePrevious.setEnabled(this.handPage > 0);
    pageNext.setEnabled(this.handPage < pages - 1);
    const pageLabel = this.add.text(actionX, actionTop + 15, `MANO ${this.handPage + 1}/${pages}`, {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif', fontSize: "8px", fontStyle: "bold", color: "#dbe3f0", align: "center",
    }).setOrigin(0.5);
    this.handPageButtons.push(pagePrevious, pageNext);
    this.uiRoot.add([pagePrevious.container, pageNext.container, pageLabel]);

    this.actionPointsGraphics = this.add.graphics();
    this.actionPointsLabel = this.add.text(actionX, actionTop + 43, "3 PA", {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif', fontSize: "10px", fontStyle: "bold", color: "#fff0c4", align: "center",
    }).setOrigin(0.5);
    this.uiRoot.add([this.actionPointsGraphics, this.actionPointsLabel]);

    this.emergencyButton = new CanvasButton(this, actionX, actionTop + 81, actionWidth - 12, 30, "GUARDAR PA", () => this.toggleShield(), {
      fill: 0x293565, hover: 0x3b4c8e, stroke: 0xd8c17a, text: "#fff3cc",
    }, 8);
    this.uiRoot.add(this.emergencyButton.container);
    const resolveY = actionBottom - 23;
    const resolveWidth = actionWidth - 12;
    const resolveHeight = 42;
    this.dropBounds.setTo(actionX - resolveWidth / 2, resolveY - resolveHeight / 2, resolveWidth, resolveHeight);
    this.actionButton = new CanvasButton(this, actionX, resolveY, resolveWidth, resolveHeight, "RESOLVER TURNO", () => this.submitPlan(), {
      fill: 0x75d998, hover: 0x92eab0, stroke: 0xc8f3d2, text: "#173448",
    }, 9);
    this.uiRoot.add(this.actionButton.container);

    const hint = this.add.text(width / 2, height - 2, "PASA LAS PÁGINAS PARA VER LAS CINCO CARTAS", {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif', fontSize: "8px", fontStyle: "bold", color: "#d1dbfa",
    }).setOrigin(0.5, 1).setAlpha(0.78);
    this.uiRoot.add(hint);
    this.updateActionPanel();
  }

  private dropZoneBounds(x: number, y: number, width: number, height: number): void {
    this.dropBounds.setTo(x - width / 2, y - height / 2, width, height);
    this.dropZoneGraphics = this.add.graphics();
    this.dropZoneGraphics.lineStyle(2, 0x74e9a6, 0.7).strokeRoundedRect(this.dropBounds.x, this.dropBounds.y, width, height, 12);
    this.dropZoneGraphics.fillStyle(0x2cd47d, 0.08).fillRoundedRect(this.dropBounds.x, this.dropBounds.y, width, height, 12);
    this.dropZone = this.add.zone(x, y, width, height).setSize(width, height).setInteractive({ dropZone: true });
    this.dropZone.on("pointerover", () => this.dropZoneGraphics?.setAlpha(1));
    this.dropZone.on("pointerout", () => this.dropZoneGraphics?.setAlpha(0.68));
    this.uiRoot.add([this.dropZoneGraphics, this.dropZone]);
  }

  private updateHeader(): void {
    if (!this.dayLabel || !this.progressDots) return;
    const width = this.screenWidth;
    this.phaseLabel?.setText(this.phase === "planning" ? (this.paused ? "PAUSA" : "PLANIFICACIÓN") : this.phase === "resolving" ? "RESOLUCIÓN" : "MISIÓN TERMINADA");
    this.dayLabel.setText(this.phase === "resolving" ? `DÍA ${Math.min(this.state.day, MAX_DAY)} / ${MAX_DAY}` : `DÍA ${this.state.day} / ${MAX_DAY}`);
    this.progressDots.clear();
    const start = width * 0.5 - 79;
    for (let day = 1; day <= MAX_DAY; day += 1) {
      const x = start + (day - 1) * 11.3;
      const active = day <= this.state.day;
      const current = day === this.state.day;
      const color = current ? COLORS.gold : active ? COLORS.cyan : 0x38507f;
      this.progressDots.fillStyle(color, active ? 0.95 : 0.7).fillRoundedRect(x, this.narrowLayout ? 34 : 47, current ? 9 : 7, current ? 5 : 4, 2);
    }
    this.updateTimerDisplay();
  }

  private updateTimerDisplay(): void {
    if (!this.timerLabel || !this.timerBar) return;
    const width = this.screenWidth;
    const isResolving = this.phase === "resolving";
    const left = isResolving ? Math.max(0, RESOLVE_SECONDS - this.resolveElapsed) : this.timerSeconds;
    const max = isResolving ? RESOLVE_SECONDS : PLAN_SECONDS;
    const text = this.phase === "over" ? "FIN" : this.paused && this.phase === "planning" ? "PAUSA" : `${Math.ceil(left)} s`;
    this.timerLabel.setText(text);
    this.timerLabel.setColor(left <= 5 && !this.paused ? "#ff737b" : "#ffe28a");
    this.timerBar.clear();
    const barWidth = this.narrowLayout ? 46 : 132;
    const x = width - (this.narrowLayout ? 106 : 190);
    const y = this.narrowLayout ? 34 : 45;
    this.timerBar.fillStyle(0x09142d, 0.9).fillRoundedRect(x, y, barWidth, 5, 3);
    this.timerBar.fillStyle(left <= 5 && !this.paused ? COLORS.coral : COLORS.gold, 1).fillRoundedRect(x, y, barWidth * Phaser.Math.Clamp(left / max, 0, 1), 5, 3);
  }

  private updateActionPanel(): void {
    if (!this.actionPointsLabel || !this.actionPointsGraphics || !this.actionButton || !this.emergencyButton) return;
    const player = this.state.players[0];
    const cost = planCost(player, this.plans[0]);
    const remaining = ACTION_POINTS - cost;
    const count = this.plans[0].survival.length + this.plans[0].attacks.length;
    const currentEvent = getEventForDay(this.state);
    const targetMissing = this.phase === "planning" && Boolean(currentEvent?.definition.choice) && !this.plans[0].globalTargetChosen;
    this.actionPointsLabel.setText(`${remaining} PA RESTANTES`);
    this.actionPointsGraphics.clear();
    const cx = this.actionPointsLabel.x;
    const cy = this.actionPointsLabel.y + 20;
    for (let index = 0; index < ACTION_POINTS; index += 1) {
      const color = index < cost ? COLORS.gold : 0x33466e;
      this.actionPointsGraphics.fillStyle(color, 1).fillCircle(cx - 20 + index * 20, cy, 6);
      this.actionPointsGraphics.lineStyle(1, 0xfff1c7, 0.6).strokeCircle(cx - 20 + index * 20, cy, 6);
    }
    const shield = this.plans[0].reserveShield;
    this.emergencyButton.setActive(shield);
    this.emergencyButton.setText(shield ? "ESCUDO ACTIVO\nDAÑO A LA MITAD" : "GUARDAR 1 PA\nESCUDO A LA MITAD");
    this.emergencyButton.setEnabled(this.phase === "planning" && (shield || remaining >= 1));
    this.actionButton.setText(this.phase === "resolving" ? "RESOLVIENDO…" : this.phase === "over" ? "MISIÓN TERMINADA" : targetMissing ? "ELIGE UNA BARRA" : `RESOLVER PLAN${count ? ` · ${count}` : ""}`);
    this.actionButton.setEnabled(this.phase === "planning" && !targetMissing);
    if (this.dropZoneGraphics) {
      this.dropZoneGraphics.clear();
      const zone = this.dropBounds;
      this.dropZoneGraphics.fillStyle(0x2cd47d, count ? 0.13 : 0.06).fillRoundedRect(zone.x, zone.y, zone.width, zone.height, 12);
      this.dropZoneGraphics.lineStyle(2, count ? 0x82f6b1 : 0x5c82ad, count ? 0.95 : 0.68).strokeRoundedRect(zone.x, zone.y, zone.width, zone.height, 12);
    }
  }

  private refreshBoard(): void {
    if (this.colonyPanels.length !== 2) return;
    const plans = this.phase === "planning" ? this.plans : [emptyPlan(), emptyPlan()] as [RoundPlan, RoundPlan];
    const preview = this.phase === "planning" ? previewPlan(this.state, plans, 0, this.hoveredUid).changes : [{}, {}] as [Effects, Effects];
    const currentEvent = getEventForDay(this.state);
    const canChoose = this.phase === "planning" && Boolean(currentEvent?.definition.choice);
    const concealed = this.state.day <= this.state.players[1].colony.concealedThroughDay;
    this.colonyPanels[0].setResourceTargetEnabled(canChoose);
    this.colonyPanels[0].update(this.state.players[0].colony.resources, preview[0], false, canChoose && this.plans[0].globalTargetChosen ? this.plans[0].globalTarget : undefined, this.state.players[0].colony.eliminated);
    this.colonyPanels[1].update(this.state.players[1].colony.resources, preview[1], concealed, undefined, this.state.players[1].colony.eliminated);
    this.updateActionPanel();
  }

  private updateEventSpotlight(): void {
    if (!this.eventArt || !this.eventTitle || !this.eventDetail || !this.eventDayLabel) return;
    const event = this.getSpotlightEvent();
    const day = this.getSpotlightDay();
    this.eventArt.setFrame(`battle-art-${event.definition.art}`);
    this.eventTitle.setText(event.definition.name.toUpperCase());
    const currentChoice = getEventForDay(this.state)?.definition.choice;
    this.eventDetail.setText(event.definition.choice
      ? currentChoice && !this.plans[0].globalTargetChosen
        ? `Toca una barra para elegir dónde sumar +${event.definition.choice}%.`
        : `Cada colonia elige una barra para sumar +${event.definition.choice}%.`
      : event.definition.science);
    if (currentChoice && this.plans[0].globalTargetChosen) {
      const chosenName = SYSTEMS.find((system) => system.id === this.plans[0].globalTarget)?.name.toLowerCase();
      this.eventDetail.setText(`Tu colonia repone ${chosenName}: +${currentChoice}%. La rival también elige su barra.`);
    }
    this.eventDayLabel.setText(`${day === this.state.day ? "EVENTO DE HOY" : "PRÓXIMO FENÓMENO"} · DÍA ${day}`);
    if (this.messageLabel) this.messageLabel.setText(this.feedback).setColor(Phaser.Display.Color.IntegerToColor(this.feedbackColor).rgba);
  }

  private toggleCard(card: CardInstance): void {
    if (this.phase !== "planning") return;
    const changed = togglePlanCard(this.state.players[0], this.plans[0], card);
    if (!changed) {
      this.setFeedback("Máximo 3 PA. Desmarca una carta o reserva solo 1 PA.", COLORS.coral);
      this.scenePulse(this.cardViewsByUid.get(card.uid)?.container);
      return;
    }
    const selected = isCardSelected(this.plans[0], card.uid);
    this.cardViewsByUid.get(card.uid)?.setSelected(selected);
    this.setFeedback(selected ? `${card.definition.shortName} quedó en el plan.` : `${card.definition.shortName} salió del plan.`, COLORS.gold);
    this.refreshBoard();
  }

  private toggleShield(): void {
    if (this.phase !== "planning") return;
    const enabled = toggleEmergencyShield(this.state.players[0], this.plans[0]);
    if (!enabled) {
      this.setFeedback("Reserva 1 PA para activar el protocolo de emergencia.", COLORS.coral);
      return;
    }
    this.setFeedback(this.plans[0].reserveShield ? "Protocolo activo: el daño entrante se reduce a la mitad." : "Protocolo de emergencia desactivado.", COLORS.mint);
    this.refreshBoard();
  }

  private selectGlobalTarget(system: SystemId): void {
    const event = getEventForDay(this.state);
    if (this.phase !== "planning" || !event?.definition.choice) return;
    this.plans[0].globalTarget = system;
    this.plans[0].globalTargetChosen = true;
    this.currentEventTarget = system;
    this.setFeedback(`La cápsula repondrá ${system.toUpperCase()} en tu colonia.`, COLORS.gold);
    this.refreshBoard();
  }

  private onCardHover(card: CardInstance): void {
    if (this.phase !== "planning") return;
    this.hoveredUid = card.uid;
    this.feedback = this.cardHint(card);
    this.feedbackColor = card.kind === "attack" ? COLORS.coral : COLORS.cyan;
    this.updateEventSpotlight();
    this.refreshBoard();
  }

  private onCardLeave(card: CardInstance): void {
    if (this.hoveredUid !== card.uid) return;
    this.hoveredUid = undefined;
    this.feedback = "Elige cartas (3 PA), revisa las barras y resuelve el turno.";
    this.feedbackColor = COLORS.cream;
    this.updateEventSpotlight();
    this.refreshBoard();
  }

  private onCardDrop(card: CardInstance, x: number, y: number): void {
    if (this.phase !== "planning") return;
    if (this.dropBounds.contains(x, y)) this.toggleCard(card);
  }

  private cardHint(card: CardInstance): string {
    const effects = Object.entries(card.definition.effects)
      .filter(([, value]) => Boolean(value))
      .map(([system, value]) => `${Number(value) > 0 ? "+" : "−"}${Math.abs(Number(value))}% ${system.toUpperCase()}`);
    const science = card.definition.science;
    if (card.kind === "attack") {
      const attack = card.definition as AttackCardDefinition;
      const selfCost = Object.entries(attack.selfCost).map(([system, value]) => `${Number(value) > 0 ? "+" : "−"}${Math.abs(Number(value))}% ${system.toUpperCase()}`).join(" · ");
      return `${science}  ·  COSTO PROPIO: ${selfCost || "—"}`;
    }
    return `${science}  ·  ${effects.join(" · ")}`;
  }

  private toggleCardByIndex(index: number): void {
    const card = this.cardViews[index]?.card;
    if (card) this.toggleCard(card);
  }

  private submitPlan(): void {
    if (this.phase !== "planning") return;
    try {
      const aiPlan = chooseAiPlan(this.state, 1);
      this.pendingState = resolveRound(this.state, [structuredClone(this.plans[0]), aiPlan]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo resolver el plan.";
      this.setFeedback(message, COLORS.coral);
      return;
    }
    this.phase = "resolving";
    this.paused = true;
    this.resolveElapsed = 0;
    this.pendingApplied = false;
    this.feedback = "ATAQUES → SUPERVIVENCIA → EVENTO NASA";
    this.feedbackColor = COLORS.gold;
    this.updateHeader();
    this.updateActionPanel();
    this.animateCardsToBases();
    this.refreshBoard();
  }

  private animateCardsToBases(): void {
    const selected = this.cardViews.filter((view) => isCardSelected(this.plans[0], view.card.uid));
    selected.forEach((view, index) => {
      const destination = view.card.kind === "attack" ? this.screenWidth * 0.77 : this.screenWidth * 0.23;
      const y = this.screenHeight * 0.36;
      this.tweens.add({
        targets: view.container,
        x: destination + Phaser.Math.Between(-24, 24),
        y: y + Phaser.Math.Between(-18, 18),
        scaleX: 0.38,
        scaleY: 0.38,
        angle: Phaser.Math.Between(-10, 10),
        alpha: 0,
        delay: index * 70,
        duration: 670,
        ease: "Cubic.In",
        onComplete: () => this.spawnImpact(destination, y, view.card.kind === "attack" ? 0 : 1),
      });
    });
    if (!selected.length) this.setFeedback("El turno se resuelve sin cartas jugadas.", COLORS.cream);
  }

  private spawnImpact(x: number, y: number, kind: number): void {
    const index = kind === 0 ? 0 : 9;
    const burst = this.add.image(x, y, "effects-atlas", `effects-art-${index}`).setDisplaySize(14, 14).setDepth(45).setAlpha(0.95);
    this.tweens.add({ targets: burst, scale: 5.5, alpha: 0, angle: kind ? 12 : -8, duration: 520, ease: "Cubic.Out", onComplete: () => burst.destroy() });
    for (let spark = 0; spark < 5; spark += 1) {
      const dot = this.add.circle(x, y, Phaser.Math.Between(2, 4), kind ? COLORS.mint : COLORS.gold, 0.95).setDepth(46);
      this.tweens.add({ targets: dot, x: x + Phaser.Math.Between(-70, 70), y: y + Phaser.Math.Between(-55, 55), alpha: 0, scale: 0.3, duration: Phaser.Math.Between(340, 620), ease: "Cubic.Out", onComplete: () => dot.destroy() });
    }
  }

  private applyPendingResolution(): void {
    if (!this.pendingState) return;
    this.state = this.pendingState;
    this.pendingState = null;
    this.pendingApplied = true;
    const actionSummary = this.state.lastEvents.filter((event) => event.kind === "attack" || event.kind === "survival" || event.kind === "global" || event.kind === "collapse").map((event) => event.text);
    this.feedback = actionSummary.slice(0, 2).join("   ·   ") || "Los sistemas se mantienen estables.";
    this.feedbackColor = this.state.lastEvents.some((event) => event.kind === "collapse") ? COLORS.coral : COLORS.mint;
    this.rebuildHandAndActionPanel();
    this.updateHeader();
    this.updateEventSpotlight();
    this.refreshBoard();
    this.animateResourcePanelPulse();
  }

  private finishResolution(): void {
    if (!this.pendingApplied) this.applyPendingResolution();
    this.resolveElapsed = 0;
    this.pendingApplied = false;
    if (this.state.status === "over") {
      this.phase = "over";
      this.paused = true;
      this.buildInterface();
      return;
    }
    this.phase = "planning";
    this.plans = [emptyPlan(), emptyPlan()];
    this.hoveredUid = undefined;
    this.currentEventTarget = undefined;
    this.timerSeconds = PLAN_SECONDS;
    this.paused = false;
    this.feedback = this.state.lastEvents.filter((event) => event.kind === "upkeep").map((event) => event.text).join("   ·   ") || "Nuevo día espacial. Planifica con 3 PA.";
    this.feedbackColor = COLORS.gold;
    this.buildInterface();
    this.animateCardsIn();
  }

  private rebuildHandAndActionPanel(): void {
    this.buildInterface();
  }

  private animateResourcePanelPulse(): void {
    this.colonyPanels.forEach((panel, index) => {
      this.tweens.add({ targets: panel.container, scaleX: 1.018, scaleY: 1.018, duration: 150, yoyo: true, repeat: 1, delay: index * 90, ease: "Sine.InOut" });
    });
  }

  private animateCardsIn(): void {
    this.cardViews.forEach((view, index) => {
      view.container.setAlpha(0).setScale(0.82).setY(view.home.y + 34);
      this.time.delayedCall(index * 65, () => {
        if (!view.container.active) return;
        this.tweens.add({ targets: view.container, alpha: 1, scaleX: 1, scaleY: 1, y: view.home.y, duration: 310, ease: "Back.Out" });
      });
    });
  }

  private buildOutcomeOverlay(): void {
    if (!this.state.outcome) return;
    const shade = this.add.rectangle(this.screenWidth / 2, this.screenHeight / 2, this.screenWidth, this.screenHeight, 0x03091a, 0.78).setDepth(160);
    const box = this.add.graphics().setDepth(161);
    const width = Math.min(560, this.screenWidth - 36);
    const height = 260;
    box.fillStyle(0x0d1b3a, 0.98).fillRoundedRect(this.screenWidth / 2 - width / 2, this.screenHeight / 2 - height / 2, width, height, 24);
    box.lineStyle(4, this.state.outcome.winner === 0 ? COLORS.gold : COLORS.coral, 1).strokeRoundedRect(this.screenWidth / 2 - width / 2, this.screenHeight / 2 - height / 2, width, height, 24);
    const result = this.add.text(this.screenWidth / 2, this.screenHeight / 2 - 54, this.state.outcome.title, {
      fontFamily: 'Impact, "Arial Black", sans-serif', fontSize: "32px", color: this.state.outcome.winner === 0 ? "#ffdf81" : "#ff8287", align: "center", stroke: "#07132e", strokeThickness: 4,
    }).setOrigin(0.5).setDepth(162);
    const detail = this.add.text(this.screenWidth / 2, this.screenHeight / 2 + 2, this.state.outcome.detail, {
      fontFamily: '"Trebuchet MS", "Arial Rounded MT Bold", sans-serif', fontSize: "16px", fontStyle: "bold", color: "#e7efff", align: "center", wordWrap: { width: width - 60 },
    }).setOrigin(0.5).setDepth(162);
    const restart = new CanvasButton(this, this.screenWidth / 2, this.screenHeight / 2 + 82, 220, 52, "OTRA MISIÓN", () => this.restart(), {
      fill: 0x7ce7a0, hover: 0xa1ffbd, stroke: 0xecfff0, text: "#12324a",
    }, 15);
    restart.container.setDepth(163);
    this.uiRoot.add([shade, box, result, detail, restart.container]);
  }

  private togglePause(): void {
    if (this.phase !== "planning") return;
    this.paused = !this.paused;
    this.pauseButton?.setText(this.paused ? "SEGUIR" : "PAUSAR");
    this.setFeedback(this.paused ? "TIEMPO EN PAUSA · elige cartas con calma." : "PLANIFICACIÓN ACTIVA · el reloj vuelve a correr.", this.paused ? COLORS.gold : COLORS.cyan);
    this.updateHeader();
  }

  private restart(): void {
    this.phase = "planning";
    this.state = createGame("solo", Date.now());
    this.plans = [emptyPlan(), emptyPlan()];
    this.timerSeconds = PLAN_SECONDS;
    this.paused = false;
    this.resolveElapsed = 0;
    this.pendingState = null;
    this.pendingApplied = false;
    this.hoveredUid = undefined;
    this.feedback = "Elige cartas (3 PA), revisa las barras y resuelve el turno.";
    this.feedbackColor = COLORS.cream;
    this.buildInterface();
    this.animateCardsIn();
  }

  private getSpotlightDay(): number {
    return this.state.day % 3 === 0 ? this.state.day : this.state.day + (3 - this.state.day % 3);
  }

  private getSpotlightEvent() {
    return getEventForDay(this.state, this.getSpotlightDay()) ?? this.state.globalDeck[0];
  }

  private setFeedback(message: string, color: number): void {
    this.feedback = message;
    this.feedbackColor = color;
    this.updateEventSpotlight();
  }

  private scenePulse(target?: Phaser.GameObjects.Container): void {
    if (!target) return;
    this.tweens.add({ targets: target, x: target.x + 5, duration: 48, yoyo: true, repeat: 3, ease: "Sine.InOut" });
  }
}
