import Phaser from "phaser";
import {
  ACTION_POINTS,
  PLAN_SECONDS,
  RESOLVE_SECONDS,
  SYSTEMS,
  type CardInstance,
  type Effects,
  type SystemId,
} from "../data";
import {
  chooseAiPlan,
  createGame,
  emptyPlan,
  getEventForDay,
  isCardSelected,
  planCost,
  previewPlan,
  resolveRound,
  toggleEmergencyShield,
  togglePlanCard,
  wearForDay,
  type GameState,
  type RoundPlan,
} from "../game-rules";
import { RoomClient } from "../network/RoomClient";
import type { ClientRoomMessage, ServerRoomMessage } from "../network/protocol";
import { SurvivalCard } from "../ui/SurvivalCard";

type Phase = "intro" | "connecting" | "waiting" | "planning" | "resolving" | "over";
type Star = { object: Phaser.GameObjects.Arc; speed: number; baseY: number; offset: number };
type ResourceUi = { graphics: Phaser.GameObjects.Graphics; value: Phaser.GameObjects.Text; preview: Phaser.GameObjects.Text; x: number; y: number; width: number; playerIndex: number; system: SystemId };

const C = {
  bg: 0xeeeae1, panel: 0xf8f6f0, panel2: 0xe7e2d7, line: 0x607085,
  text: 0x172338, muted: 0x596779, gold: 0xba674f, green: 0x347b68,
  red: 0xb95756, cyan: 0x39709a, violet: 0x755c91, white: 0xffffff,
};
const FONT = '"Trebuchet MS", Arial, sans-serif';
const SYSTEMS_COLOR: Record<SystemId, number> = { energy: C.gold, oxygen: C.cyan, food: C.green, shield: C.violet };
const SYSTEMS_SHORT: Record<SystemId, string> = { energy: "ENERGÍA", oxygen: "O₂ / AGUA", food: "COMIDA", shield: "ESCUDO" };
const marginSafe = (width: number): number => width < 620 ? width - 28 : width - 48;

export class GameScene extends Phaser.Scene {
  private state: GameState = createGame("solo");
  private plans: RoundPlan[] = [emptyPlan(), emptyPlan()];
  private phase: Phase = "intro";
  private roomClient?: RoomClient;
  private roomCode = "";
  private roomPlayerIndex: number | null = null;
  private roomCount = 0;
  private online = false;
  private locked = false;
  private readyText = "";
  private deadline = 0;
  private timer = PLAN_SECONDS;
  private banner = "";
  private bannerUntil = 0;
  private currentEventTarget: SystemId | null = null;
  private pendingState: GameState | null = null;
  private resolutionStarted = 0;
  private resolutionDuration = 1250;
  private resolutionProgress = 0;
  private hoverUid?: string;
  private doodles!: Phaser.GameObjects.Graphics;
  private stars: Star[] = [];
  private ui!: Phaser.GameObjects.Container;
  private cards: SurvivalCard[] = [];
  private resourceUi: ResourceUi[] = [];
  private buttons: Array<{ container: Phaser.GameObjects.Container; setEnabled: (enabled: boolean) => void; setText: (text: string) => void; setActive: (active: boolean) => void }> = [];
  private paLabel?: Phaser.GameObjects.Text;
  private statusLabel?: Phaser.GameObjects.Text;
  private timerLabel?: Phaser.GameObjects.Text;
  private timerGraphics?: Phaser.GameObjects.Graphics;
  private planButton?: ReturnType<GameScene["makeButton"]>;
  private shieldButton?: ReturnType<GameScene["makeButton"]>;
  private roomSheet?: HTMLElement;
  private roomForm?: HTMLFormElement;
  private roomInput?: HTMLInputElement;
  private roomError?: HTMLElement;
  private mobile = false;

  constructor() { super("GameScene"); }

  preload(): void {
  }

  create(): void {
    this.createGameLayers();
    this.createRoomSheet();
    this.drawScene();
    if (new URLSearchParams(window.location.search).get("mode") === "practice") this.startPractice();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.input.keyboard?.on("keydown-ENTER", () => {
      if (this.phase === "intro") this.startPractice();
      else if (this.phase === "planning") this.confirmPlan();
      else if (this.phase === "waiting" && this.roomPlayerIndex === 0) this.startRoom();
    });
    this.input.keyboard?.on("keydown-ESC", () => this.closeRoomSheet());
    this.input.keyboard?.on("keydown-R", () => this.restart());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
      this.roomClient?.close();
      this.closeRoomSheet();
    });
    const loading = document.getElementById("loading-screen");
    if (loading) {
      loading.classList.add("is-ready");
      window.setTimeout(() => loading.remove(), 250);
    }
  }

  update(time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    for (const star of this.stars) {
      star.object.x += star.speed * dt;
      if (star.object.x > this.scale.width + 3) star.object.x = -3;
      star.object.y = star.baseY + Math.sin(time / 1100 + star.offset) * 1.5;
    }
    if (this.phase === "planning" && !this.locked) {
      this.timer = this.online ? Math.max(0, (this.deadline - Date.now()) / 1000) : Math.max(0, this.timer - dt);
      this.updateTimer();
      if (this.timer <= 0 && !this.state.players[0].colony.eliminated) this.confirmPlan();
    }
    if (this.phase === "resolving" && this.pendingState && time - this.resolutionStarted >= this.resolutionDuration) {
      this.state = this.pendingState;
      this.pendingState = null;
      this.resolutionProgress = 0;
      this.plans = this.state.players.map(() => emptyPlan());
      this.hoverUid = undefined;
      this.updateResources();
      if (!this.online) {
        if (this.state.status === "over") this.setPhase("over");
        else this.beginPlanning(PLAN_SECONDS);
      } else if (this.state.status === "over") {
        this.setPhase("over");
      } else {
        this.showBanner("RONDA RESUELTA · esperando la siguiente", 2600);
      }
    }
    if (this.banner && time >= this.bannerUntil && this.statusLabel && this.phase === "planning") {
      this.statusLabel.setText(this.online && this.readyText ? this.readyText : "Elige cartas para proteger tu colonia.");
    }
  }

  private createGameLayers(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.cameras.main.setBackgroundColor("#eeeae1");
    this.doodles = this.add.graphics().setDepth(-20);
    this.drawBackgroundSketch();
    this.stars = [];
    const count = w < 700 ? 14 : 24;
    for (let i = 0; i < count; i += 1) {
      const bright = i % 8 === 0;
      const star = this.add.circle(Phaser.Math.Between(0, w), Phaser.Math.Between(0, h), bright ? 1.5 : 0.8, bright ? C.cyan : C.line, bright ? 0.32 : 0.16).setDepth(-18);
      this.stars.push({ object: star, speed: bright ? 7 : 2.3, baseY: star.y, offset: Math.random() * 6 });
    }
  }

  private drawBackgroundSketch(): void {
    if (!this.doodles) return;
    const w = this.scale.width, h = this.scale.height;
    const g = this.doodles;
    g.clear();
    g.lineStyle(1.5, C.cyan, 0.14);
    g.strokeCircle(54, 130, 29);
    g.strokeEllipse(54, 130, 96, 24);
    g.lineStyle(1, C.gold, 0.18);
    g.beginPath();
    g.moveTo(w - 168, 81); g.lineTo(w - 120, 93); g.lineTo(w - 83, 112);
    g.moveTo(w - 127, 85); g.lineTo(w - 135, 103);
    g.strokePath();
    g.lineStyle(1, C.line, 0.12);
    g.strokeCircle(w - 73, h - 82, 18);
    g.strokeCircle(w - 73, h - 82, 24);
  }

  private drawScene(): void {
    if (this.ui?.active) this.ui.destroy(true);
    this.ui = this.add.container(0, 0).setDepth(1);
    this.cards = [];
    this.resourceUi = [];
    this.buttons = [];
    this.planButton = undefined;
    this.shieldButton = undefined;
    this.paLabel = undefined;
    this.statusLabel = undefined;
    this.timerLabel = undefined;
    this.timerGraphics = undefined;
    this.mobile = this.scale.width < 760 || this.scale.height < 620;
    if (this.phase === "intro") this.drawIntro();
    else if (this.phase === "connecting") this.drawConnecting();
    else if (this.phase === "waiting") this.drawLobby();
    else this.drawBoard();
    if (this.phase === "over") this.drawOutcome();
  }

  private drawIntro(): void {
    const w = this.scale.width, h = this.scale.height;
    const small = Math.min(w, h) < 560;
    const boxW = Math.min(620, w - 32), boxH = Math.min(455, h - 28);
    this.panel(w / 2, h / 2, boxW, boxH, 0.94);
    this.text(w / 2, h / 2 - boxH * 0.37, "MISIÓN: SOBREVIVE AL SOL", small ? 20 : 30, C.text, true, 620);
    this.text(w / 2, h / 2 - boxH * 0.23, "Cada ronda protege tu colonia. La última que siga en pie gana.", small ? 11 : 14, C.muted, false, boxW - 48);
    const rules = [
      "Cuida energía, O₂/agua, comida y escudo.",
      "Juega mejoras usando hasta 3 puntos de acción.",
      "Cada 3 rondas hay un evento global; también hay desgaste.",
      "Una barra en 0% o 100% elimina. Tras el día 15, sigue hasta que quede una.",
    ];
    const top = h / 2 - boxH / 2;
    const startY = top + (small ? 96 : 135);
    rules.forEach((line, i) => {
      this.addDot(w / 2 - boxW * 0.34, startY + i * (small ? 23 : 29), i === 3 ? C.gold : C.cyan);
      this.text(w / 2 - boxW * 0.30, startY + i * (small ? 23 : 29), line, small ? 9 : 12, C.text, false, boxW * 0.62, "left");
    });
    const buttonY = top + (small ? 218 : 290);
    this.makeButton(w / 2, buttonY, Math.min(240, boxW - 40), 43, "CREAR SALA · 2–4", () => this.connectRoom("create"), "primary", small);
    this.makeButton(w / 2, buttonY + (small ? 45 : 50), Math.min(240, boxW - 40), 38, "UNIRSE CON CÓDIGO", () => this.openRoomSheet(), "secondary", small);
    this.makeButton(w / 2, buttonY + (small ? 88 : 99), Math.min(240, boxW - 40), 34, "PRÁCTICA VS IA", () => this.startPractice(), "quiet", small);
    this.text(w / 2, top + (small ? 346 : 427), "El reloj solo empieza al iniciar la sala.", small ? 8 : 10, C.muted, false, boxW - 30);
  }

  private drawConnecting(): void {
    const w = this.scale.width, h = this.scale.height;
    this.panel(w / 2, h / 2, Math.min(390, w - 32), 148, 0.96);
    this.text(w / 2, h / 2 - 17, "CONECTANDO", 22, C.text, true);
    this.text(w / 2, h / 2 + 21, this.banner || "Buscando el servidor de salas…", 12, C.muted, false, 330);
    this.makeButton(w / 2, h / 2 + 65, 130, 34, "VOLVER", () => { this.roomClient?.close(); this.roomClient = undefined; this.setPhase("intro"); }, "quiet", false);
  }

  private drawLobby(): void {
    const w = this.scale.width, h = this.scale.height;
    const small = this.mobile;
    const boxW = Math.min(560, w - 30), boxH = Math.min(430, h - 28);
    this.panel(w / 2, h / 2, boxW, boxH, 0.96);
    this.text(w / 2, h / 2 - boxH * 0.38, "SALA DE SUPERVIVENCIA", small ? 19 : 25, C.text, true);
    this.text(w / 2, h / 2 - boxH * 0.24, "Comparte este código para reunir 2–4 colonias.", small ? 10 : 12, C.muted);
    this.text(w / 2, h / 2 - boxH * 0.08, this.roomCode, small ? 34 : 44, C.gold, true, 240);
    this.makeButton(w / 2, h / 2 + boxH * 0.04, 140, 32, "COPIAR CÓDIGO", () => {
      if (navigator.clipboard) navigator.clipboard.writeText(this.roomCode);
      this.showBanner("Código copiado", 1500);
    }, "secondary", small);
    const slotY = h / 2 + boxH * 0.19;
    const slotW = Math.min(105, (boxW - 44) / 4);
    const gap = 8;
    for (let i = 0; i < 4; i += 1) {
      const x = w / 2 - (slotW * 4 + gap * 3) / 2 + slotW / 2 + i * (slotW + gap);
      const occupied = i < this.roomCount;
      this.panel(x, slotY, slotW, 45, occupied ? 0.95 : 0.45, occupied ? C.line : 0x1b2b45);
      this.text(x, slotY, occupied ? (i === 0 ? "HOST" : "LISTO") : "VACÍO", small ? 8 : 9, occupied ? C.green : C.muted, true, slotW - 8);
    }
    const canStart = this.roomPlayerIndex === 0 && this.roomCount >= 2;
    if (this.roomPlayerIndex === 0) {
      this.makeButton(w / 2, h / 2 + boxH * 0.36, Math.min(270, boxW - 32), 46, canStart ? "INICIAR · " + this.roomCount + " JUGADORES" : "ESPERANDO 2 JUGADORES", () => this.startRoom(), canStart ? "primary" : "quiet", small, canStart);
    } else {
      this.text(w / 2, h / 2 + boxH * 0.36, "La partida empieza cuando el anfitrión inicie.", 11, C.muted, false, boxW - 42);
    }
    this.text(w / 2, h / 2 + boxH * 0.47, this.banner || "El contador aún no corre.", small ? 9 : 10, C.muted, false, boxW - 30);
    this.makeButton(w / 2, h / 2 + boxH * 0.54, 100, 28, "SALIR", () => this.leaveRoom(), "quiet", small);
  }

  private drawBoard(): void {
    const w = this.scale.width, h = this.scale.height;
    const compact = this.mobile;
    const margin = compact ? 14 : Math.max(32, w * 0.055);
    this.drawHeader(w, compact);
    this.drawEventBar(w, margin, compact);
    this.drawColonies(w, margin, compact);
    this.drawHand(w, h, margin, compact);
    this.drawActions(w, h, margin, compact);
    this.updateResources();
    this.updatePlanControls();
    this.updateTimer();
  }

  private drawHeader(w: number, compact: boolean): void {
    const y = compact ? 27 : 33;
    this.text(24, y, "MISIÓN", compact ? 14 : 17, C.text, true, 160, "left");
    this.text(24, y + 17, "SOBREVIVE AL SOL", compact ? 8 : 9, C.cyan, true, 170, "left");
    this.text(w / 2, y, "RONDA " + this.pad(this.state.day) + (this.state.mode === "solo" ? " / 15" : ""), compact ? 15 : 19, C.text, true);
    const alive = this.state.players.filter((p) => !p.colony.eliminated).length;
    this.text(w - 205, y, alive + " COLONIAS VIVAS", compact ? 9 : 10, C.muted, true, 136, "right");
    this.timerGraphics = this.add.graphics();
    this.timerLabel = this.add.text(w - 26, y, "", { fontFamily: FONT, fontSize: compact ? "12px" : "14px", fontStyle: "bold", color: "#f3f5f7" }).setOrigin(1, 0.5);
    this.ui.add([this.timerGraphics, this.timerLabel]);
    this.statusLabel = this.add.text(w / 2, y + (compact ? 22 : 24), this.phase === "resolving" ? "CARTAS → EVENTO → DESGASTE" : this.statusLine(), {
      fontFamily: FONT, fontSize: compact ? "8px" : "10px", color: "#9cacc2", align: "center",
    }).setOrigin(0.5);
    this.ui.add(this.statusLabel);
    this.hLine(w / 2, y + (compact ? 39 : 44), marginSafe(w), 0x2a3d5b, 0.7);
  }

  private drawEventBar(w: number, margin: number, compact: boolean): void {
    const y = compact ? 92 : 107;
    const height = compact ? 52 : 58;
    const event = getEventForDay(this.state);
    this.panel(w / 2, y, w - margin * 2, height, 0.96, C.panel);
    if (!event) {
      const nextDay = (Math.floor((this.state.day - 1) / 3) + 1) * 3;
      this.text(margin + 13, y - 7, "PRÓXIMO EVENTO · DÍA " + nextDay, compact ? 8 : 9, C.muted, true, w * 0.4, "left");
      this.text(margin + 13, y + 11, "Sin evento global esta ronda.", compact ? 10 : 12, C.text, true, w * 0.55, "left");
      this.text(w - margin - 13, y + 10, "DESGASTE −" + wearForDay(this.state.day + 1) + "%", compact ? 8 : 9, C.gold, true, 150, "right");
      return;
    }
    const mark = this.add.graphics();
    const mx = margin + (compact ? 29 : 36);
    mark.lineStyle(1.5, C.gold, 0.95).strokeCircle(mx, y, compact ? 13 : 16);
    mark.lineStyle(1.5, C.gold, 0.68);
    mark.lineBetween(mx - 21, y, mx - 17, y);
    mark.lineBetween(mx + 17, y, mx + 21, y);
    mark.lineBetween(mx, y - 21, mx, y - 17);
    mark.lineBetween(mx, y + 17, mx, y + 21);
    this.ui.add(mark);
    this.text(margin + (compact ? 58 : 70), y - 10, "EVENTO GLOBAL · DÍA " + this.state.day, compact ? 8 : 9, C.gold, true, w * 0.55, "left");
    this.text(margin + (compact ? 58 : 70), y + 9, event.definition.shortName, compact ? 11 : 14, C.text, true, w * 0.58, "left");
    const choiceText = event.definition.choice ? "ELIGE UNA BARRA · +" + event.definition.choice + "%" : this.effectsLabel(event.definition.effects || {});
    this.text(w - margin - 14, y + 9, choiceText, compact ? 8 : 10, C.muted, true, w * 0.34, "right");
  }

  private drawColonies(w: number, margin: number, compact: boolean): void {
    const players = this.state.players;
    const columns = w < 620 ? 1 : 2;
    const rows = Math.ceil(players.length / columns);
    const top = compact ? 136 : 167;
    const gapX = 10, gapY = compact ? 6 : 8;
    const cellW = (w - margin * 2 - gapX * (columns - 1)) / columns;
    const areaH = compact ? Math.min(225, this.scale.height * 0.32) : players.length <= 2 ? 112 : 160;
    const cellH = (areaH - gapY * (rows - 1)) / rows;
    players.forEach((player, index) => {
      const col = index % columns, row = Math.floor(index / columns);
      const x = margin + cellW / 2 + col * (cellW + gapX);
      const y = top + cellH / 2 + row * (cellH + gapY);
      const own = index === 0;
      this.panel(x, y, cellW, cellH, player.colony.eliminated ? 0.55 : 0.98, own ? 0xe7e2d7 : C.panel);
      this.text(x - cellW / 2 + 11, y - cellH / 2 + 12, player.colony.eliminated ? "COLONIA ELIMINADA" : own ? "TU COLONIA" : player.name.toUpperCase(), compact ? 8 : 9, player.colony.eliminated ? C.red : own ? C.cyan : C.muted, true, cellW * 0.42, "left");
      const valuesTop = y - cellH / 2 + (cellH < 90 ? 35 : cellH * 0.52);
      const innerLeft = x - cellW / 2 + 12;
      const innerW = cellW - 24;
      const barGap = 7;
      const barW = (innerW - barGap * 3) / 4;
      SYSTEMS.forEach((sys, si) => {
        const bx = innerLeft + barW / 2 + si * (barW + barGap);
        const resource = this.makeResource(bx, valuesTop, barW, index, sys.id);
        this.resourceUi.push(resource);
      });
    });
  }

  private makeResource(x: number, y: number, width: number, playerIndex: number, system: SystemId): ResourceUi {
    const g = this.add.graphics();
    const name = this.add.text(x - width / 2, y - 5, SYSTEMS_SHORT[system], {
      fontFamily: FONT, fontSize: width < 75 ? "8px" : "9px", fontStyle: "bold", color: "#596779",
    }).setOrigin(0, 0.5);
    const value = this.add.text(x + width / 2, y - 5, "50%", {
      fontFamily: FONT, fontSize: width < 75 ? "9px" : "11px", fontStyle: "bold", color: "#172338",
    }).setOrigin(1, 0.5);
    const preview = this.add.text(x + width / 2, y + 11, "", {
      fontFamily: FONT, fontSize: width < 75 ? "8px" : "9px", fontStyle: "bold", color: "#596779",
    }).setOrigin(1, 0.5);
    const container = this.add.container(0, 0, [g, name, value, preview]);
    if (playerIndex === 0 && getEventForDay(this.state)?.definition.choice) {
      const zone = this.add.zone(x, y + 4, width, 32).setInteractive({ useHandCursor: true });
      zone.on("pointerup", () => this.chooseEventTarget(system));
      container.add(zone);
    }
    this.ui.add(container);
    return { graphics: g, value, preview, x, y, width, playerIndex, system };
  }

  private drawHand(w: number, h: number, margin: number, compact: boolean): void {
    const y = h - (compact ? 228 : 240);
    this.text(margin + 2, y - 20, "TU MANO", compact ? 9 : 10, C.text, true, 90, "left");
    this.paLabel = this.add.text(w - margin, y - 20, "", { fontFamily: FONT, fontSize: compact ? "9px" : "10px", fontStyle: "bold", color: "#f0bd58" }).setOrigin(1, 0.5);
    this.ui.add(this.paLabel);
    const hand = this.state.players[0].survivalHand;
    const columns = compact ? Math.min(3, hand.length) : hand.length;
    const cardGap = compact ? 7 : 10;
    const maxCardW = compact ? 220 : 270;
    const cardW = Math.min(maxCardW, (w - margin * 2 - cardGap * (columns - 1)) / columns);
    const cardH = compact ? Math.min(142, h * 0.19) : Math.min(155, h * 0.215);
    const visible = compact ? Math.min(3, hand.length) : hand.length;
    const handPage = (this as unknown as { handPage?: number }).handPage || 0;
    const pages = Math.max(1, Math.ceil(hand.length / visible));
    const page = Math.min(handPage, pages - 1);
    const shown = hand.slice(page * visible, page * visible + visible);
    const rowW = shown.length * cardW + Math.max(0, shown.length - 1) * cardGap;
    const startX = w / 2 - rowW / 2 + cardW / 2;
    shown.forEach((card, index) => {
      const view = new SurvivalCard(this, card, startX + index * (cardW + cardGap), y + cardH / 2 + 8, cardW, cardH, {
        toggle: (selected) => this.toggleCard(selected),
        hover: (selected) => { this.hoverUid = selected.uid; this.updateResources(); },
        leave: (selected) => { if (this.hoverUid === selected.uid) this.hoverUid = undefined; this.updateResources(); },
        drop: (selected, px, py) => {
          if (py > h - (compact ? 70 : 76)) this.toggleCard(selected);
        },
      });
      this.cards.push(view);
      this.ui.add(view.container);
      view.setSelected(isCardSelected(this.plans[0], card.uid), false);
      view.setEnabled(this.phase === "planning" && !this.locked && !this.state.players[0].colony.eliminated);
    });
    if (pages > 1) {
      this.makeButton(margin + 30, y - 19, 24, 22, "‹", () => this.changeHandPage(-1, pages), "quiet", true, page > 0);
      this.text(margin + 58, y - 19, (page + 1) + "/" + pages, 8, C.muted);
      this.makeButton(w - margin - 30, y - 19, 24, 22, "›", () => this.changeHandPage(1, pages), "quiet", true, page < pages - 1);
    }
  }

  private handPage = 0;

  private drawActions(w: number, h: number, margin: number, compact: boolean): void {
    const y = h - (compact ? 43 : 44);
    const shieldW = Math.min(compact ? 150 : 190, (w - margin * 2 - 12) * 0.46);
    const primaryW = Math.min(compact ? 172 : 220, (w - margin * 2 - 12) * 0.54);
    const gap = 10;
    const totalW = shieldW + primaryW + gap;
    const shieldX = w / 2 - totalW / 2 + shieldW / 2;
    const primaryX = shieldX + shieldW / 2 + gap + primaryW / 2;
    this.shieldButton = this.makeButton(shieldX, y, shieldW, compact ? 38 : 42, "MITAD DE IMPACTO Y DESGASTE · 1 PA", () => this.toggleShield(), "secondary", compact);
    this.planButton = this.makeButton(primaryX, y, primaryW, compact ? 40 : 44, this.online ? "CONFIRMAR PLAN" : "JUGAR RONDA", () => this.confirmPlan(), "primary", compact);
    const drop = this.add.zone(primaryX, y, primaryW, 48).setRectangleDropZone(primaryW, 48);
    drop.setDepth(2);
    this.ui.add(drop);
  }

  private drawOutcome(): void {
    const w = this.scale.width, h = this.scale.height;
    const boxW = Math.min(440, w - 30);
    this.panel(w / 2, h / 2, boxW, 206, 0.97, this.state.outcome?.winner === 0 ? 0x263b46 : 0x3d2935);
    const title = this.state.outcome?.title || "CONEXIÓN PERDIDA";
    const detail = this.state.outcome?.detail || this.banner || "La partida se cerró.";
    this.text(w / 2, h / 2 - 48, title, 22, this.state.outcome?.winner === 0 ? C.gold : C.text, true, boxW - 30);
    this.text(w / 2, h / 2 + 2, detail, 12, C.muted, false, boxW - 44);
    this.makeButton(w / 2, h / 2 + 65, 170, 38, "VOLVER AL INICIO", () => this.restart(), "primary", false);
  }

  private updateResources(): void {
    if (!this.resourceUi.length) return;
    const plan = this.plans[0] || emptyPlan();
    const preview = previewPlan(this.state, this.plans, 0, this.hoverUid).changes;
    const event = getEventForDay(this.state);
    for (const entry of this.resourceUi) {
      const player = this.state.players[entry.playerIndex];
      const rawStart = player.colony.resources[entry.system];
      const target = this.pendingState?.players[entry.playerIndex]?.colony.resources[entry.system] ?? rawStart;
      const start = rawStart + (target - rawStart) * this.resolutionProgress;
      let delta = 0;
      if (entry.playerIndex === 0 && this.phase === "planning") {
        delta += preview[0][entry.system] || 0;
        if (event?.definition.choice && (this.currentEventTarget || plan.globalTargetChosen)) {
          const target = this.currentEventTarget || plan.globalTarget;
          if (target === entry.system) delta += event.definition.choice;
        } else if (event?.definition.effects) {
          const effect = event.definition.effects[entry.system] || 0;
          delta += effect < 0 && plan.reserveShield ? effect / 2 : effect;
        }
        const wear = wearForDay(this.state.day + 1);
        const wearDelta = (entry.system === "energy" || entry.system === "oxygen" || entry.system === "food") ? -wear * (plan.reserveShield ? 0.5 : 1) : 0;
        delta += wearDelta;
      }
      const end = this.phase === "resolving" ? start : start + delta;
      const collapse = end <= 0 || end >= 100;
      const clamped = Phaser.Math.Clamp(start, 0, 100);
      const shown = Phaser.Math.Clamp(end, 0, 100);
      const color = SYSTEMS_COLOR[entry.system];
      const g = entry.graphics;
      g.clear();
      const left = entry.x - entry.width / 2;
      g.fillStyle(0xd3d0c7, 0.95).fillRoundedRect(left, entry.y + 3, entry.width, 5, 2.5);
      g.fillStyle(color, 0.95).fillRoundedRect(left, entry.y + 3, entry.width * clamped / 100, 5, 2.5);
      if (delta !== 0) {
        const from = left + entry.width * clamped / 100;
        const to = left + entry.width * shown / 100;
        g.fillStyle(collapse ? C.red : delta > 0 ? C.green : C.red, 0.9).fillRoundedRect(Math.min(from, to), entry.y + 3, Math.max(2, Math.abs(to - from)), 5, 2.5);
      }
      entry.value.setText(Math.round(start) + "%").setColor(player.colony.eliminated ? "#87909a" : collapse ? "#b95756" : "#172338");
      if (entry.playerIndex === 0 && this.phase === "planning" && (delta !== 0 || this.hoverUid)) {
        entry.preview.setText("→ " + Math.round(end) + "%").setColor(collapse ? "#b95756" : delta > 0 ? "#347b68" : "#ba674f");
      } else {
        entry.preview.setText(player.colony.eliminated ? "fuera" : "");
      }
    }
  }

  private updatePlanControls(): void {
    if (!this.paLabel) return;
    const used = planCost(this.state.players[0], this.plans[0]);
    this.paLabel.setText(Math.max(0, ACTION_POINTS - used) + " / " + ACTION_POINTS + " PA");
    this.cards.forEach((card) => card.setSelected(isCardSelected(this.plans[0], card.instance.uid)));
    this.cards.forEach((card) => card.setEnabled(this.phase === "planning" && !this.locked && !this.state.players[0].colony.eliminated));
    this.shieldButton?.setActive(this.plans[0].reserveShield);
    this.shieldButton?.setText(this.plans[0].reserveShield ? "ACTIVO · −50% · EVENTO Y DESGASTE" : "MITAD DE IMPACTO Y DESGASTE · 1 PA");
    this.shieldButton?.setEnabled(this.phase === "planning" && !this.locked);
    const needsTarget = Boolean(getEventForDay(this.state)?.definition.choice) && !this.plans[0].globalTargetChosen;
    this.planButton?.setEnabled(this.phase === "planning" && !this.locked && !this.state.players[0].colony.eliminated && !needsTarget);
    this.planButton?.setText(this.locked ? "ESPERANDO…" : this.online ? "CONFIRMAR PLAN" : "JUGAR RONDA");
  }

  private updateTimer(): void {
    if (!this.timerLabel || !this.timerGraphics) return;
    const w = this.scale.width;
    const left = this.phase === "resolving" ? Math.max(0, this.resolutionDuration / 1000 - (this.time.now - this.resolutionStarted) / 1000) : this.timer;
    this.timerLabel.setText(this.phase === "over" ? "FIN" : this.phase === "waiting" ? "—" : this.phase === "resolving" ? "…" : Math.ceil(left) + "s");
    this.timerGraphics.clear();
    this.timerGraphics.fillStyle(0xd3d0c7, 0.95).fillRoundedRect(w - 102, this.mobile ? 54 : 61, 74, 4, 2);
    const proportion = this.phase === "planning" ? Phaser.Math.Clamp(left / PLAN_SECONDS, 0, 1) : 1;
    this.timerGraphics.fillStyle(left < 5 ? C.red : C.gold, 1).fillRoundedRect(w - 102, this.mobile ? 54 : 61, 74 * proportion, 4, 2);
  }

  private startPractice(): void {
    this.online = false;
    this.roomClient?.close();
    this.roomClient = undefined;
    this.state = createGame("solo", Date.now(), 2);
    this.plans = this.state.players.map(() => emptyPlan());
    this.currentEventTarget = null;
    this.locked = false;
    this.beginPlanning(PLAN_SECONDS);
  }

  private beginPlanning(seconds: number): void {
    this.phase = "planning";
    this.locked = false;
    this.timer = seconds;
    this.deadline = Date.now() + seconds * 1000;
    this.plans = this.state.players.map(() => emptyPlan());
    this.hoverUid = undefined;
    this.readyText = "";
    this.drawScene();
    this.showBanner("Elige cartas para proteger tu colonia.", 1800);
  }

  private confirmPlan(): void {
    if (this.phase !== "planning" || this.locked) return;
    if (this.state.players[0].colony.eliminated) return;
    if (this.online) {
      const sent = this.roomClient?.send({ type: "submit-plan", plan: structuredClone(this.plans[0]) });
      if (!sent) { this.showBanner("No hay conexión con la sala.", 2500); return; }
      this.locked = true;
      this.readyText = "Plan privado enviado. Esperando a las demás colonias.";
      this.showBanner(this.readyText, 3000);
      this.updatePlanControls();
      if (this.statusLabel) this.statusLabel.setText(this.readyText);
      return;
    }
    const otherPlan = chooseAiPlan(this.state, 1);
    this.resolveTo(resolveRound(this.state, [structuredClone(this.plans[0]), otherPlan]));
  }

  private resolveTo(next: GameState): void {
    this.pendingState = next;
    this.phase = "resolving";
    this.resolutionStarted = this.time.now;
    this.resolutionDuration = 1400;
    this.resolutionProgress = 0;
    this.tweens.killTweensOf(this);
    this.tweens.add({
      targets: this, resolutionProgress: 1, duration: this.resolutionDuration, ease: "Cubic.Out",
      onUpdate: () => this.updateResources(),
    });
    this.readyText = "";
    this.cards.forEach((card, index) => {
      if (isCardSelected(this.plans[0], card.instance.uid)) card.animatePlay(index);
    });
    if (this.statusLabel) this.statusLabel.setText("MEJORAS → EVENTO GLOBAL → DESGASTE");
    this.updatePlanControls();
  }

  private toggleCard(card: CardInstance): void {
    if (this.phase !== "planning" || this.locked) return;
    const ok = togglePlanCard(this.state.players[0], this.plans[0], card);
    if (!ok) {
      this.showBanner("Superas los 3 PA disponibles.", 1500);
      this.cameras.main.shake(90, 0.002);
      return;
    }
    this.updatePlanControls();
    this.updateResources();
  }

  private toggleShield(): void {
    if (this.phase !== "planning" || this.locked) return;
    if (!toggleEmergencyShield(this.state.players[0], this.plans[0])) {
      this.showBanner("El escudo consume 1 PA. Quita una mejora para activarlo.", 1500);
      return;
    }
    this.updatePlanControls();
    this.updateResources();
  }

  private chooseEventTarget(system: SystemId): void {
    const event = getEventForDay(this.state);
    if (this.phase !== "planning" || !event?.definition.choice || this.locked) return;
    this.currentEventTarget = system;
    this.plans[0].globalTarget = system;
    this.plans[0].globalTargetChosen = true;
    this.updatePlanControls();
    this.updateResources();
    this.showBanner("Reabastecimiento asignado a " + SYSTEMS_SHORT[system] + ".", 1500);
  }

  private changeHandPage(step: number, pages: number): void {
    this.handPage = Phaser.Math.Clamp(this.handPage + step, 0, pages - 1);
    this.drawScene();
  }

  private makeButton(x: number, y: number, width: number, height: number, label: string, action: () => void, style: "primary" | "secondary" | "quiet" = "secondary", compact = false, enabled = true): { container: Phaser.GameObjects.Container; setEnabled: (enabled: boolean) => void; setText: (text: string) => void; setActive: (active: boolean) => void } {
    const container = this.add.container(x, y);
    const g = this.add.graphics();
    const text = this.add.text(0, 0, label, {
      fontFamily: FONT, fontSize: (compact ? 9 : 11) + "px", fontStyle: "bold",
      color: style === "primary" ? "#fffaf2" : "#172338", align: "center",
      wordWrap: { width: width - 18 }, lineSpacing: -1,
    }).setOrigin(0.5);
    const zone = this.add.zone(0, 0, width, height).setInteractive({ useHandCursor: true });
    let hovered = false, pressed = false, active = false, isEnabled = enabled;
    const redraw = () => {
      g.clear();
      const fill = style === "primary" ? (hovered ? 0xa85443 : C.gold) : style === "secondary" ? (hovered ? 0xded9cf : 0xe7e2d7) : (hovered ? 0xe3dfd7 : C.panel);
      const stroke = style === "primary" ? 0x9f5746 : style === "secondary" ? (active ? C.cyan : C.line) : C.line;
      g.fillStyle(fill, isEnabled ? 1 : 0.38).fillRoundedRect(x - width / 2, y - height / 2 + (pressed ? 1 : 0), width, height, 7);
      g.lineStyle(1, stroke, 0.68).strokeRoundedRect(x - width / 2 + 0.5, y - height / 2 + 0.5, width - 1, height - 1, 7);
      text.setAlpha(isEnabled ? 1 : 0.5);
    };
    zone.on("pointerover", () => { hovered = true; redraw(); this.tweens.add({ targets: container, scale: 1.025, duration: 100 }); });
    zone.on("pointerout", () => { hovered = false; pressed = false; redraw(); this.tweens.add({ targets: container, scale: 1, duration: 110 }); });
    zone.on("pointerdown", () => { if (!isEnabled) return; pressed = true; redraw(); });
    zone.on("pointerup", () => { if (!isEnabled) return; pressed = false; redraw(); action(); });
    container.add([text, zone]);
    container.setSize(width, height);
    redraw();
    this.ui.add(g);
    this.ui.add(container);
    const api = {
      container,
      setEnabled: (value: boolean) => { isEnabled = value; if (zone.input) zone.input.enabled = value; redraw(); },
      setText: (value: string) => { text.setText(value); redraw(); },
      setActive: (value: boolean) => { active = value; redraw(); },
    };
    this.buttons.push(api);
    return api;
  }

  private text(x: number, y: number, value: string, size: number, color: number, bold = false, wrap = 520, align: "left" | "center" | "right" = "center"): Phaser.GameObjects.Text {
    const text = this.add.text(x, y, value, {
      fontFamily: FONT, fontSize: size + "px", fontStyle: bold ? "bold" : "normal",
      color: Phaser.Display.Color.IntegerToColor(color).rgba, align,
      wordWrap: { width: wrap, useAdvancedWrap: true },
      lineSpacing: -1,
    }).setOrigin(align === "left" ? 0 : align === "right" ? 1 : 0.5);
    this.ui.add(text);
    return text;
  }

  private panel(x: number, y: number, width: number, height: number, alpha = 0.8, color = C.panel): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.fillStyle(color, alpha).fillRoundedRect(x - width / 2, y - height / 2, width, height, 11);
    g.lineStyle(1, 0x687b94, 0.22).strokeRoundedRect(x - width / 2, y - height / 2, width, height, 11);
    this.ui.add(g);
    return g;
  }

  private hLine(x: number, y: number, width: number, color: number, alpha: number): void {
    const g = this.add.graphics();
    g.lineStyle(1, color, alpha).lineBetween(x - width / 2, y, x + width / 2, y);
    this.ui.add(g);
  }

  private addDot(x: number, y: number, color: number): void {
    const dot = this.add.circle(x, y, 3, color);
    this.ui.add(dot);
  }

  private effectsLabel(effects: Effects): string {
    return Object.entries(effects).filter((entry) => entry[1]).map((entry) =>
      (entry[1]! > 0 ? "+" : "−") + Math.abs(entry[1]!) + " " + SYSTEMS_SHORT[entry[0] as SystemId],
    ).join("  ·  ");
  }

  private statusLine(): string {
    if (this.phase === "resolving") return "MEJORAS → EVENTO GLOBAL → DESGASTE";
    if (this.online && this.readyText) return this.readyText;
    return this.banner || "Elige cartas para proteger tu colonia.";
  }

  private showBanner(message: string, ms = 1700): void {
    this.banner = message;
    this.bannerUntil = this.time.now + ms;
    if (this.statusLabel) this.statusLabel.setText(message);
  }

  private pad(value: number): string { return value < 10 ? "0" + value : String(value); }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.drawScene();
  }

  private onResize(): void {
    const w = this.scale.width, h = this.scale.height;
    this.drawBackgroundSketch();
    this.stars.forEach((star) => { if (star.object.x > w) star.object.x = w; });
    this.drawScene();
  }

  private connectRoom(action: "create" | "join", code = ""): void {
    this.online = true;
    this.banner = "Conectando con el servidor de salas…";
    this.setPhase("connecting");
    const client = new RoomClient();
    this.roomClient = client;
    client.onMessage = (message) => this.handleRoomMessage(message);
    client.onError = (message) => { this.banner = message; this.showBanner(message, 4000); };
    client.onDisconnect = () => {
      if (this.phase !== "intro" && this.phase !== "over") {
        this.banner = "Se perdió la conexión con la sala.";
        this.state.outcome = { winner: null, reason: "draw", title: "CONEXIÓN PERDIDA", detail: "La sala dejó de responder." };
        this.setPhase("over");
      }
    };
    client.connect().then(() => {
      const message: ClientRoomMessage = action === "create" ? { type: "create-room" } : { type: "join-room", roomCode: code };
      client.send(message);
    }).catch((error: unknown) => {
      this.banner = error instanceof Error ? error.message : "No se pudo conectar.";
      this.online = false;
      this.setPhase("intro");
    });
  }

  private handleRoomMessage(message: ServerRoomMessage): void {
    switch (message.type) {
      case "room-created":
      case "room-joined":
        this.roomCode = message.roomCode;
        this.roomPlayerIndex = message.playerIndex;
        this.roomCount = message.currentPlayers;
        this.banner = "Código " + this.roomCode + " · esperando jugadores.";
        this.setPhase("waiting");
        break;
      case "room-status":
        this.roomCount = message.currentPlayers;
        this.banner = message.message;
        if (this.phase === "waiting") this.drawScene();
        break;
      case "game-start":
      case "round-start":
        this.state = message.state;
        this.roomPlayerIndex = message.playerIndex;
        this.locked = false;
        this.online = true;
        this.currentEventTarget = null;
        this.beginPlanning(message.remainingMs / 1000);
        break;
      case "plan-locked":
        this.locked = true;
        this.readyText = message.message;
        this.updatePlanControls();
        if (this.statusLabel) this.statusLabel.setText(message.message);
        break;
      case "opponent-ready":
        this.readyText = message.message;
        if (this.statusLabel && !this.locked) this.statusLabel.setText(message.message);
        break;
      case "round-resolved":
        this.locked = true;
        this.resolveTo(message.state);
        break;
      case "game-over":
        this.state = message.state;
        this.pendingState = null;
        this.setPhase("over");
        break;
      case "opponent-disconnected":
        this.showBanner(message.message, 3000);
        break;
      case "room-error":
        this.banner = message.message;
        if (this.phase === "waiting") this.drawScene();
        else this.showBanner(message.message, 2500);
        break;
    }
  }

  private startRoom(): void {
    if (this.phase !== "waiting" || this.roomPlayerIndex !== 0 || this.roomCount < 2) return;
    this.roomClient?.send({ type: "start-room" });
  }

  private leaveRoom(): void {
    this.setPhase("intro");
    this.roomClient?.send({ type: "leave-room" });
    this.roomClient?.close();
    this.roomClient = undefined;
    this.online = false;
    this.roomCode = "";
    this.roomPlayerIndex = null;
    this.roomCount = 0;
  }

  private restart(): void {
    this.setPhase("intro");
    this.roomClient?.close();
    this.roomClient = undefined;
    this.online = false;
    this.roomCode = "";
    this.roomPlayerIndex = null;
    this.roomCount = 0;
    this.state = createGame("solo");
    this.plans = this.state.players.map(() => emptyPlan());
  }

  private createRoomSheet(): void {
    this.roomSheet = document.getElementById("room-code-sheet") || undefined;
    this.roomForm = document.getElementById("room-code-form") as HTMLFormElement | null || undefined;
    this.roomInput = document.getElementById("room-code-input") as HTMLInputElement | null || undefined;
    this.roomError = document.getElementById("room-code-error") || undefined;
    this.roomForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const code = (this.roomInput?.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
      if (code.length !== 5) { if (this.roomError) this.roomError.textContent = "El código debe tener 5 caracteres."; return; }
      this.closeRoomSheet();
      this.connectRoom("join", code);
    });
    this.roomSheet?.querySelector("[data-close-room]")?.addEventListener("click", () => this.closeRoomSheet());
  }

  private openRoomSheet(): void {
    if (!this.roomSheet) return;
    if (this.roomError) this.roomError.textContent = "";
    if (this.roomInput) this.roomInput.value = "";
    this.roomSheet.classList.add("is-open");
    window.setTimeout(() => this.roomInput?.focus(), 30);
  }

  private closeRoomSheet(): void { this.roomSheet?.classList.remove("is-open"); }
}
