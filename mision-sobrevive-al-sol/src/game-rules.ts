import {
  ACTION_POINTS,
  GLOBAL_EVENTS,
  HAND_LIMIT,
  MAX_DAY,
  STARTING_RESOURCE,
  SURVIVAL_CARDS,
  SYSTEMS,
  type CardInstance,
  type Effects,
  type EventInstance,
  type ResourceBars,
  type SurvivalCardDefinition,
  type SystemId,
} from "./data";

export type GameMode = "solo" | "multiplayer";
export type EndReason = "collapse" | "survived" | "last-standing" | "draw";

export interface ColonyState {
  resources: ResourceBars;
  eliminated: boolean;
  concealedThroughDay: number;
}

export interface PlayerState {
  index: number;
  name: string;
  isAI: boolean;
  colony: ColonyState;
  survivalDeck: CardInstance[];
  survivalHand: CardInstance[];
  survivalDiscard: CardInstance[];
}

export interface RoundPlan {
  survival: string[];
  reserveShield: boolean;
  globalTarget: SystemId;
  globalTargetChosen: boolean;
}

export interface RoundEvent {
  kind: "survival" | "global" | "upkeep" | "collapse";
  text: string;
  playerIndex?: number;
  eventId?: string;
  cardId?: string;
  effect?: Effects;
}

export interface GameOutcome {
  winner: number | null;
  reason: EndReason;
  title: string;
  detail: string;
}

export interface GameState {
  mode: GameMode;
  day: number;
  status: "playing" | "over";
  players: PlayerState[];
  globalDeck: EventInstance[];
  randomState: number;
  lastEvents: RoundEvent[];
  history: RoundEvent[];
  outcome: GameOutcome | null;
}

export const emptyPlan = (): RoundPlan => ({
  survival: [],
  reserveShield: false,
  globalTarget: "energy",
  globalTargetChosen: false,
});

export function createRandom(seed: number): (() => number) & { getState: () => number } {
  let state = seed >>> 0;
  const random = (() => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }) as (() => number) & { getState: () => number };
  random.getState = () => state;
  return random;
}

function shuffle<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function makeSurvivalDeck(playerIndex: number, random: () => number): CardInstance[] {
  const cards = SURVIVAL_CARDS.flatMap((definition) => [0, 1].map((copy) => ({
    uid: `p${playerIndex}:survival:${definition.id}:${copy}`,
    kind: "survival" as const,
    definition,
  })));
  return shuffle(cards, random);
}

function makeGlobalDeck(random: () => number): EventInstance[] {
  return shuffle(GLOBAL_EVENTS.flatMap((definition) => [0, 1].map((copy) => ({
    uid: `event:${definition.id}:${copy}`,
    definition,
  }))), random);
}

function makePlayer(index: number, mode: GameMode, random: () => number): PlayerState {
  const player: PlayerState = {
    index,
    name: index === 0 ? "Tu colonia" : mode === "solo" ? "Colonia IA" : `Jugador ${index + 1}`,
    isAI: mode === "solo" && index === 1,
    colony: { resources: { ...STARTING_RESOURCE }, eliminated: false, concealedThroughDay: 0 },
    survivalDeck: makeSurvivalDeck(index, random),
    survivalHand: [],
    survivalDiscard: [],
  };
  fillHand(player, random);
  return player;
}

function drawSurvival(player: PlayerState, random: () => number): void {
  if (player.survivalDeck.length === 0 && player.survivalDiscard.length > 0) {
    player.survivalDeck.push(...shuffle(player.survivalDiscard.splice(0), random));
  }
  const card = player.survivalDeck.pop();
  if (card) player.survivalHand.push(card);
}

function fillHand(player: PlayerState, random: () => number): void {
  while (player.survivalHand.length < HAND_LIMIT.survival) drawSurvival(player, random);
}

export function createGame(mode: GameMode = "solo", seed = Date.now(), requestedPlayers = 4): GameState {
  const random = createRandom(seed);
  const playerCount = mode === "solo" ? 2 : Math.max(2, Math.min(4, Math.floor(requestedPlayers)));
  const players = Array.from({ length: playerCount }, (_, index) => makePlayer(index, mode, random));
  return {
    mode,
    day: 1,
    status: "playing",
    players,
    globalDeck: makeGlobalDeck(random),
    randomState: random.getState(),
    lastEvents: [],
    history: [],
    outcome: null,
  };
}

export function getCard(player: PlayerState, uid: string): CardInstance | undefined {
  return player.survivalHand.find((card) => card.uid === uid);
}

export function getCardCost(player: PlayerState, uid: string): number {
  return getCard(player, uid)?.definition.cost ?? 0;
}

export function planCost(player: PlayerState, plan: RoundPlan): number {
  return plan.survival.reduce((total, uid) => total + getCardCost(player, uid), 0);
}

export function isCardSelected(plan: RoundPlan, uid: string): boolean {
  return plan.survival.includes(uid);
}

export function togglePlanCard(player: PlayerState, plan: RoundPlan, card: CardInstance): boolean {
  const existingIndex = plan.survival.indexOf(card.uid);
  if (existingIndex >= 0) {
    plan.survival.splice(existingIndex, 1);
    return true;
  }
  const limit = plan.reserveShield ? ACTION_POINTS - 1 : ACTION_POINTS;
  if (planCost(player, plan) + card.definition.cost > limit) return false;
  plan.survival.push(card.uid);
  return true;
}

export function toggleEmergencyShield(player: PlayerState, plan: RoundPlan): boolean {
  if (plan.reserveShield) {
    plan.reserveShield = false;
    return true;
  }
  if (planCost(player, plan) > ACTION_POINTS - 1) return false;
  plan.reserveShield = true;
  return true;
}

export function getEventForDay(game: GameState, day = game.day): EventInstance | null {
  if (day % 3 !== 0 || game.globalDeck.length === 0) return null;
  const eventIndex = (Math.floor(day / 3) - 1) % game.globalDeck.length;
  return game.globalDeck[eventIndex] ?? null;
}

function roundStat(value: number): number {
  return Math.round(value * 10) / 10;
}

export function applyEffects(resources: ResourceBars, effects: Effects, multiplier = 1): void {
  for (const [system, amount] of Object.entries(effects) as [SystemId, number][]) {
    resources[system] = roundStat(resources[system] + amount * multiplier);
  }
}

function addEffects(target: Effects, source: Effects, multiplier = 1): void {
  for (const [system, amount] of Object.entries(source) as [SystemId, number][]) {
    target[system] = roundStat((target[system] ?? 0) + amount * multiplier);
  }
}

export function validatePlan(player: PlayerState, plan: RoundPlan, mustChooseGlobalTarget: boolean): void {
  if (new Set(plan.survival).size !== plan.survival.length) throw new Error("Una carta no se puede jugar dos veces en el mismo turno.");
  for (const uid of plan.survival) {
    if (!getCard(player, uid)) throw new Error(`La carta ${uid} no está en la mano de supervivencia.`);
  }
  if (planCost(player, plan) > ACTION_POINTS) throw new Error("El plan supera los 3 puntos de acción.");
  if (plan.reserveShield && planCost(player, plan) > ACTION_POINTS - 1) {
    throw new Error("El protocolo de emergencia requiere reservar 1 PA.");
  }
  if (mustChooseGlobalTarget && !plan.globalTargetChosen) throw new Error("Elige una barra para reabastecer antes de resolver el día.");
}

export interface ResourcePreview {
  changes: Effects[];
  cost: number;
}

export function previewPlan(
  game: GameState,
  plans: RoundPlan[],
  previewPlayer?: number,
  previewUid?: string,
): ResourcePreview {
  const previewPlans = game.players.map((_, index) => ({
    ...(plans[index] ?? emptyPlan()),
    survival: [...(plans[index]?.survival ?? [])],
  }));
  if (previewPlayer !== undefined && previewUid) {
    const card = getCard(game.players[previewPlayer], previewUid);
    if (card && !previewPlans[previewPlayer].survival.includes(previewUid)) previewPlans[previewPlayer].survival.push(previewUid);
  }
  const changes = game.players.map((): Effects => ({}));
  for (let playerIndex = 0; playerIndex < game.players.length; playerIndex += 1) {
    const player = game.players[playerIndex];
    for (const uid of previewPlans[playerIndex].survival) {
      const card = getCard(player, uid);
      if (card) addEffects(changes[playerIndex], card.definition.effects);
    }
  }
  return { changes, cost: previewPlayer === undefined ? 0 : planCost(game.players[previewPlayer], previewPlans[previewPlayer]) };
}

function getSelectedCards(player: PlayerState, plan: RoundPlan): CardInstance[] {
  return plan.survival.map((uid) => getCard(player, uid)).filter((card): card is CardInstance => Boolean(card));
}

function findEventChoice(resources: ResourceBars): SystemId {
  return (["energy", "oxygen", "food", "shield"] as SystemId[]).reduce(
    (lowest, system) => resources[system] < resources[lowest] ? system : lowest,
    "energy",
  );
}

function applyEventToPlayer(player: PlayerState, plan: RoundPlan, event: EventInstance, events: RoundEvent[]): void {
  if (event.definition.choice) {
    const target = plan.globalTarget;
    player.colony.resources[target] = roundStat(player.colony.resources[target] + event.definition.choice);
    events.push({ kind: "global", text: `${player.name} elige ${target.toUpperCase()} para recibir +${event.definition.choice}%.`, playerIndex: player.index, eventId: event.definition.id, effect: { [target]: event.definition.choice } });
    return;
  }
  const effects = event.definition.effects ?? {};
  const mitigated: Effects = {};
  for (const [system, amount] of Object.entries(effects) as [SystemId, number][]) {
    mitigated[system] = amount < 0 && plan.reserveShield ? amount / 2 : amount;
  }
  applyEffects(player.colony.resources, mitigated);
  events.push({
    kind: "global",
    text: `${player.name}: ${event.definition.shortName}${plan.reserveShield ? "; el protocolo reduce el daño del evento" : ""}.`,
    playerIndex: player.index,
    eventId: event.definition.id,
    effect: mitigated,
  });
}

function statFailure(resources: ResourceBars): SystemId | null {
  for (const system of ["energy", "oxygen", "food", "shield"] as SystemId[]) {
    if (resources[system] <= 0 || resources[system] >= 100) return system;
  }
  return null;
}

function systemName(system: SystemId): string {
  return SYSTEMS.find((item) => item.id === system)?.name.toLowerCase() ?? system;
}

export function wearForDay(day: number): number {
  if (day < 2) return 0;
  if (day < 8) return 5;
  if (day < 16) return 7;
  return Math.min(15, 7 + 2 * Math.ceil((day - 15) / 5));
}

function decideOutcome(game: GameState): GameOutcome | null {
  const alive = game.players.filter((player) => !player.colony.eliminated);
  if (game.mode === "multiplayer") {
    if (alive.length === 1) {
      return { winner: alive[0].index, reason: "last-standing", title: "¡ÚLTIMA COLONIA EN PIE!", detail: `${alive[0].name} sobrevivió a todos los días y eventos.` };
    }
    if (alive.length === 0) return { winner: null, reason: "draw", title: "COLAPSO TOTAL", detail: "Todas las colonias llegaron a un límite crítico." };
    return null;
  }
  if (game.players[0].colony.eliminated) {
    const failedSystem = statFailure(game.players[0].colony.resources);
    return { winner: 1, reason: "collapse", title: "COLONIA PERDIDA", detail: `Tu colonia colapsó por ${systemName(failedSystem ?? "energy")}.` };
  }
  if (game.day >= MAX_DAY) return { winner: 0, reason: "survived", title: "¡MISIÓN CUMPLIDA!", detail: "Tu colonia sobrevivió los 15 días espaciales." };
  return null;
}

export function equilibriumDistance(resources: ResourceBars): number {
  return Object.values(resources).reduce((total, value) => total + Math.abs(value - 50), 0);
}

function movePlayedCards(player: PlayerState, plan: RoundPlan): void {
  const selected = new Set(plan.survival);
  const played = player.survivalHand.filter((card) => selected.has(card.uid));
  player.survivalHand = player.survivalHand.filter((card) => !selected.has(card.uid));
  player.survivalDiscard.push(...played);
}

function pushEvents(game: GameState, events: RoundEvent[]): void {
  game.lastEvents = events;
  game.history = [...game.history, ...events].slice(-120);
}

export function resolveRound(current: GameState, plans: RoundPlan[]): GameState {
  if (current.status !== "playing") throw new Error("La partida ya terminó.");
  if (plans.length !== current.players.length) throw new Error("Cada colonia debe enviar su plan.");
  const game = structuredClone(current) as GameState;
  const globalEvent = getEventForDay(game);
  for (let index = 0; index < game.players.length; index += 1) {
    validatePlan(game.players[index], plans[index], Boolean(globalEvent?.definition.choice));
  }
  const finalPlans = structuredClone(plans);
  const events: RoundEvent[] = [];

  for (let playerIndex = 0; playerIndex < game.players.length; playerIndex += 1) {
    const player = game.players[playerIndex];
    if (player.colony.eliminated) continue;
    for (const card of getSelectedCards(player, finalPlans[playerIndex])) {
      applyEffects(player.colony.resources, card.definition.effects);
      events.push({ kind: "survival", text: `${player.name} activa ${card.definition.shortName}.`, playerIndex, cardId: card.definition.id, effect: card.definition.effects });
    }
  }

  if (globalEvent) {
    for (let playerIndex = 0; playerIndex < game.players.length; playerIndex += 1) {
      if (!game.players[playerIndex].colony.eliminated) applyEventToPlayer(game.players[playerIndex], finalPlans[playerIndex], globalEvent, events);
    }
  }

  for (const player of game.players) {
    if (player.colony.eliminated) continue;
    const failed = statFailure(player.colony.resources);
    movePlayedCards(player, finalPlans[player.index]);
    if (failed) {
      player.colony.eliminated = true;
      events.push({ kind: "collapse", text: `${player.name} colapsa: ${systemName(failed)} alcanzó 0% o 100%.`, playerIndex: player.index, effect: { [failed]: player.colony.resources[failed] } });
    }
  }

  const random = createRandom(game.randomState);
  const wear = wearForDay(game.day + 1);
  for (const player of game.players) {
    if (player.colony.eliminated) continue;
    if (wear > 0) {
      const reduction = finalPlans[player.index].reserveShield ? wear / 2 : wear;
      applyEffects(player.colony.resources, { energy: -reduction, oxygen: -reduction, food: -reduction });
      events.push({ kind: "upkeep", text: `${player.name}: desgaste diario −${reduction}% en energía, O₂/agua y comida.`, playerIndex: player.index, effect: { energy: -reduction, oxygen: -reduction, food: -reduction } });
    }
    const failed = statFailure(player.colony.resources);
    if (failed) {
      player.colony.eliminated = true;
      events.push({ kind: "collapse", text: `${player.name} colapsa por desgaste: ${systemName(failed)} alcanzó ${player.colony.resources[failed]}%.`, playerIndex: player.index, effect: { [failed]: player.colony.resources[failed] } });
    }
  }

  const outcome = decideOutcome(game);
  if (outcome) {
    game.status = "over";
    game.outcome = outcome;
    pushEvents(game, events);
    return game;
  }

  game.day += 1;
  for (const player of game.players) {
    if (!player.colony.eliminated) fillHand(player, random);
  }
  game.randomState = random.getState();
  pushEvents(game, events);
  return game;
}

function applyForecast(resources: ResourceBars, plan: RoundPlan, event: EventInstance | null): void {
  if (!event) return;
  if (event.definition.choice) {
    const target = plan.globalTargetChosen ? plan.globalTarget : findEventChoice(resources);
    resources[target] = roundStat(resources[target] + event.definition.choice);
    return;
  }
  const effects = event.definition.effects ?? {};
  const preview: Effects = {};
  for (const [system, amount] of Object.entries(effects) as [SystemId, number][]) {
    preview[system] = amount < 0 && plan.reserveShield ? amount / 2 : amount;
  }
  applyEffects(resources, preview);
}

function resourceScore(resources: ResourceBars): number {
  let score = 0;
  for (const value of Object.values(resources)) {
    if (value <= 0 || value >= 100) score -= 1200;
    score -= Math.abs(value - 50) * 1.2;
    if (value < 20 || value > 80) score -= 20;
  }
  return score;
}

export function chooseAiPlan(game: GameState, playerIndex = 1): RoundPlan {
  const player = game.players[playerIndex];
  if (!player || player.colony.eliminated) return emptyPlan();
  const cards = [...player.survivalHand];
  const event = getEventForDay(game);
  let best = emptyPlan();
  let bestScore = Number.NEGATIVE_INFINITY;

  const evaluate = (picked: CardInstance[], cost: number): void => {
    const plan: RoundPlan = {
      survival: picked.map((card) => card.uid),
      reserveShield: cost < ACTION_POINTS,
      globalTarget: findEventChoice(player.colony.resources),
      globalTargetChosen: true,
    };
    const projected = { ...player.colony.resources };
    for (const card of picked) applyEffects(projected, card.definition.effects);
    applyForecast(projected, plan, event);
    const score = resourceScore(projected) + (picked.length ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = plan;
    }
  };

  const walk = (index: number, picked: CardInstance[], cost: number): void => {
    if (index >= cards.length) {
      evaluate(picked, cost);
      return;
    }
    walk(index + 1, picked, cost);
    const nextCost = cost + cards[index].definition.cost;
    if (nextCost <= ACTION_POINTS) walk(index + 1, [...picked, cards[index]], nextCost);
  };
  walk(0, [], 0);
  return best;
}
