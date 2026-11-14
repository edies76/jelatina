import {
  ACTION_POINTS,
  ATTACK_CARDS,
  GLOBAL_EVENTS,
  HAND_LIMIT,
  MAX_DAY,
  STARTING_RESOURCE,
  SYSTEMS,
  SURVIVAL_CARDS,
  type AttackCardDefinition,
  type CardInstance,
  type Effects,
  type EventInstance,
  type ResourceBars,
  type SurvivalCardDefinition,
  type SystemId,
} from "./data";

export type GameMode = "solo" | "duel";
export type EndReason = "collapse" | "survived" | "equilibrium" | "draw";

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
  attackDeck: CardInstance[];
  attackHand: CardInstance[];
  attackDiscard: CardInstance[];
}

export interface RoundPlan {
  survival: string[];
  attacks: string[];
  reserveShield: boolean;
  globalTarget: SystemId;
  globalTargetChosen: boolean;
}

export interface RoundEvent {
  kind: "attack" | "survival" | "global" | "upkeep" | "special" | "collapse";
  text: string;
  playerIndex?: number;
  targetIndex?: number;
  cardId?: string;
  eventId?: string;
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
  players: [PlayerState, PlayerState];
  globalDeck: EventInstance[];
  randomState: number;
  lastEvents: RoundEvent[];
  history: RoundEvent[];
  outcome: GameOutcome | null;
}

export const emptyPlan = (): RoundPlan => ({
  survival: [],
  attacks: [],
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

function makeCardDeck(
  playerIndex: number,
  kind: "survival" | "attack",
  random: () => number,
): CardInstance[] {
  const definitions = kind === "survival" ? SURVIVAL_CARDS : ATTACK_CARDS;
  const cards = definitions.flatMap((definition) => [0, 1].map((copy) => ({
    uid: `p${playerIndex}:${kind}:${definition.id}:${copy}`,
    kind,
    definition,
  } as CardInstance)));
  return shuffle(cards, random);
}

function makeGlobalDeck(random: () => number): EventInstance[] {
  const events = GLOBAL_EVENTS.flatMap((definition) => [0, 1].map((copy) => ({
    uid: `event:${definition.id}:${copy}`,
    definition,
  })));
  return shuffle(events, random);
}

function makePlayer(index: number, mode: GameMode, random: () => number): PlayerState {
  const player: PlayerState = {
    index,
    name: index === 0 ? "Tu colonia" : mode === "solo" ? "Colonia IA" : "Jugador 2",
    isAI: index === 1 && mode === "solo",
    colony: { resources: { ...STARTING_RESOURCE }, eliminated: false, concealedThroughDay: 0 },
    survivalDeck: makeCardDeck(index, "survival", random),
    survivalHand: [],
    survivalDiscard: [],
    attackDeck: makeCardDeck(index, "attack", random),
    attackHand: [],
    attackDiscard: [],
  };
  fillHand(player, random);
  return player;
}

function drawOne(player: PlayerState, kind: "survival" | "attack", random: () => number): void {
  const deck = kind === "survival" ? player.survivalDeck : player.attackDeck;
  const hand = kind === "survival" ? player.survivalHand : player.attackHand;
  const discard = kind === "survival" ? player.survivalDiscard : player.attackDiscard;
  if (deck.length === 0 && discard.length > 0) deck.push(...shuffle(discard.splice(0), random));
  const card = deck.pop();
  if (card) hand.push(card);
}

function fillHand(player: PlayerState, random: () => number): void {
  while (player.survivalHand.length < HAND_LIMIT.survival) drawOne(player, "survival", random);
  while (player.attackHand.length < HAND_LIMIT.attack) drawOne(player, "attack", random);
}

export function createGame(mode: GameMode = "solo", seed = Date.now()): GameState {
  const random = createRandom(seed);
  const game: GameState = {
    mode,
    day: 1,
    status: "playing",
    players: [makePlayer(0, mode, random), makePlayer(1, mode, random)],
    globalDeck: makeGlobalDeck(random),
    randomState: random.getState(),
    lastEvents: [],
    history: [],
    outcome: null,
  };
  return game;
}

export function getCard(player: PlayerState, uid: string): CardInstance | undefined {
  return [...player.survivalHand, ...player.attackHand].find((card) => card.uid === uid);
}

export function getCardCost(player: PlayerState, uid: string): number {
  return getCard(player, uid)?.definition.cost ?? 0;
}

export function planCost(player: PlayerState, plan: RoundPlan): number {
  return [...plan.survival, ...plan.attacks].reduce((total, uid) => total + getCardCost(player, uid), 0);
}

export function isCardSelected(plan: RoundPlan, uid: string): boolean {
  return plan.survival.includes(uid) || plan.attacks.includes(uid);
}

export function togglePlanCard(player: PlayerState, plan: RoundPlan, card: CardInstance): boolean {
  const target = card.kind === "survival" ? plan.survival : plan.attacks;
  const existingIndex = target.indexOf(card.uid);
  if (existingIndex >= 0) {
    target.splice(existingIndex, 1);
    return true;
  }
  const limit = plan.reserveShield ? ACTION_POINTS - 1 : ACTION_POINTS;
  if (planCost(player, plan) + card.definition.cost > limit) return false;
  target.push(card.uid);
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
  if (day % 3 !== 0) return null;
  return game.globalDeck[Math.floor(day / 3) - 1] ?? null;
}

function roundStat(value: number): number {
  return Math.round(value * 10) / 10;
}

export function applyEffects(resources: ResourceBars, effects: Effects, multiplier = 1): void {
  for (const [system, amount] of Object.entries(effects) as [SystemId, number][]) {
    resources[system] = roundStat(resources[system] + amount * multiplier);
  }
}

function allCards(player: PlayerState): CardInstance[] {
  return [...player.survivalHand, ...player.attackHand];
}

function validatePlan(player: PlayerState, plan: RoundPlan, mustChooseGlobalTarget: boolean): void {
  const selectedIds = [...plan.survival, ...plan.attacks];
  if (new Set(selectedIds).size !== selectedIds.length) throw new Error("Una carta no se puede jugar dos veces en el mismo turno.");
  for (const uid of plan.survival) {
    if (getCard(player, uid)?.kind !== "survival") throw new Error(`La carta ${uid} no es una carta de supervivencia válida.`);
  }
  for (const uid of plan.attacks) {
    if (getCard(player, uid)?.kind !== "attack") throw new Error(`La carta ${uid} no es una carta de ataque válida.`);
  }
  if (planCost(player, plan) > ACTION_POINTS) throw new Error("El plan supera los 3 puntos de acción.");
  if (plan.reserveShield && planCost(player, plan) > ACTION_POINTS - 1) {
    throw new Error("El protocolo de emergencia requiere reservar 1 PA.");
  }
  if (mustChooseGlobalTarget && !plan.globalTargetChosen) throw new Error("Elige una barra para reabastecer antes de resolver el día.");
}

export interface ResourcePreview {
  changes: [Effects, Effects];
  cost: number;
}

export function previewPlan(
  game: GameState,
  plans: [RoundPlan, RoundPlan],
  previewPlayer?: number,
  previewUid?: string,
): ResourcePreview {
  const previewPlans: [RoundPlan, RoundPlan] = [
    { ...plans[0], survival: [...plans[0].survival], attacks: [...plans[0].attacks] },
    { ...plans[1], survival: [...plans[1].survival], attacks: [...plans[1].attacks] },
  ];
  if (previewPlayer !== undefined && previewUid) {
    const card = getCard(game.players[previewPlayer], previewUid);
    if (card && !isCardSelected(previewPlans[previewPlayer], previewUid)) {
      const list = card.kind === "survival" ? previewPlans[previewPlayer].survival : previewPlans[previewPlayer].attacks;
      list.push(previewUid);
    }
  }
  const changes: [Effects, Effects] = [{}, {}];
  for (const attackerIndex of [0, 1] as const) {
    const attacker = game.players[attackerIndex];
    const targetIndex = (1 - attackerIndex) as 0 | 1;
    const targetProtected = previewPlans[targetIndex].reserveShield;
    for (const uid of previewPlans[attackerIndex].attacks) {
      const card = getCard(attacker, uid)?.definition as AttackCardDefinition | undefined;
      if (!card) continue;
      addEffects(changes[attackerIndex], card.selfCost);
      if (card.special !== "conceal") addEffects(changes[targetIndex], card.effects, targetProtected ? 0.5 : 1);
    }
  }
  for (const playerIndex of [0, 1] as const) {
    const player = game.players[playerIndex];
    for (const uid of previewPlans[playerIndex].survival) {
      const card = getCard(player, uid)?.definition as SurvivalCardDefinition | undefined;
      if (card) addEffects(changes[playerIndex], card.effects);
    }
  }
  return { changes, cost: planCost(game.players[previewPlayer ?? 0], previewPlans[previewPlayer ?? 0]) };
}

function addEffects(target: Effects, source: Effects, multiplier = 1): void {
  for (const [system, amount] of Object.entries(source) as [SystemId, number][]) {
    target[system] = roundStat((target[system] ?? 0) + amount * multiplier);
  }
}

function getPlannedCards(player: PlayerState, plan: RoundPlan, kind: "survival" | "attack"): CardInstance[] {
  const ids = kind === "survival" ? plan.survival : plan.attacks;
  return ids.map((uid) => getCard(player, uid)).filter((card): card is CardInstance => Boolean(card));
}

function applyEventToPlayer(
  player: PlayerState,
  plan: RoundPlan,
  event: EventInstance,
  events: RoundEvent[],
): void {
  if (event.definition.choice) {
    const target = plan.globalTarget;
    player.colony.resources[target] = roundStat(player.colony.resources[target] + event.definition.choice);
    events.push({
      kind: "global",
      text: `${player.name}: +${event.definition.choice}% ${target.toUpperCase()} por reabastecimiento.`,
      playerIndex: player.index,
      eventId: event.definition.id,
      effect: { [target]: event.definition.choice },
    });
    return;
  }
  applyEffects(player.colony.resources, event.definition.effects ?? {});
  events.push({
    kind: "global",
    text: `${player.name}: ${event.definition.shortName}.`,
    playerIndex: player.index,
    eventId: event.definition.id,
    effect: event.definition.effects,
  });
}

function findEventChoice(resources: ResourceBars): SystemId {
  return (["energy", "oxygen", "food", "shield"] as SystemId[])
    .reduce((lowest, system) => resources[system] < resources[lowest] ? system : lowest, "energy");
}

function statFailure(resources: ResourceBars): SystemId | null {
  for (const system of ["energy", "oxygen", "food", "shield"] as SystemId[]) {
    if (resources[system] <= 0 || resources[system] >= 100) return system;
  }
  return null;
}

export function equilibriumDistance(resources: ResourceBars): number {
  return Object.values(resources).reduce((total, value) => total + Math.abs(value - 50), 0);
}

function decideOutcome(game: GameState, failed: [SystemId | null, SystemId | null]): GameOutcome | null {
  const [firstFailed, secondFailed] = failed;
  if (game.mode === "solo") {
    if (firstFailed) {
      const systemName = SYSTEMS.find((system) => system.id === firstFailed)?.name.toLowerCase() ?? firstFailed;
      return {
        winner: 1,
        reason: "collapse",
        title: "COLONIA PERDIDA",
        detail: `${game.players[0].name} colapsó por ${systemName}.`,
      };
    }
    if (game.day >= MAX_DAY) {
      return { winner: 0, reason: "survived", title: "¡MISIÓN CUMPLIDA!", detail: "Tu colonia sobrevivió los 15 días espaciales." };
    }
    return null;
  }

  if (Boolean(firstFailed) !== Boolean(secondFailed)) {
    const winner = firstFailed ? 1 : 0;
    const loser = firstFailed ? 0 : 1;
    const failedSystem = firstFailed ?? secondFailed!;
    const systemName = SYSTEMS.find((system) => system.id === failedSystem)?.name.toLowerCase() ?? failedSystem;
    return {
      winner,
      reason: "collapse",
      title: `${game.players[winner].name.toUpperCase()} SOBREVIVE`,
      detail: `${game.players[loser].name} colapsó por ${systemName}.`,
    };
  }

  if (firstFailed && secondFailed && game.day < MAX_DAY) {
    return { winner: null, reason: "draw", title: "COLAPSO DOBLE", detail: "Las dos colonias alcanzaron un límite crítico." };
  }

  if (game.day >= MAX_DAY) {
    const distanceA = equilibriumDistance(game.players[0].colony.resources);
    const distanceB = equilibriumDistance(game.players[1].colony.resources);
    if (Math.abs(distanceA - distanceB) < 0.01) {
      return { winner: null, reason: "draw", title: "EQUILIBRIO PERFECTO", detail: "Las dos colonias terminaron a la misma distancia del 50%." };
    }
    const winner = distanceA < distanceB ? 0 : 1;
    return {
      winner,
      reason: firstFailed || secondFailed ? "collapse" : "equilibrium",
      title: `${game.players[winner].name.toUpperCase()} GANA`,
      detail: `${game.players[winner].name} terminó más cerca del equilibrio del 50%.`,
    };
  }
  return null;
}

function movePlayedCards(player: PlayerState, plan: RoundPlan): void {
  const selectedSurvival = new Set(plan.survival);
  const selectedAttack = new Set(plan.attacks);
  const playedSurvival = player.survivalHand.filter((card) => selectedSurvival.has(card.uid));
  const playedAttack = player.attackHand.filter((card) => selectedAttack.has(card.uid));
  player.survivalHand = player.survivalHand.filter((card) => !selectedSurvival.has(card.uid));
  player.attackHand = player.attackHand.filter((card) => !selectedAttack.has(card.uid));
  player.survivalDiscard.push(...playedSurvival);
  player.attackDiscard.push(...playedAttack);
}

function pushEvents(game: GameState, events: RoundEvent[]): void {
  game.lastEvents = events;
  game.history = [...game.history, ...events].slice(-80);
}

export function resolveRound(current: GameState, plans: [RoundPlan, RoundPlan]): GameState {
  if (current.status !== "playing") throw new Error("La partida ya terminó.");
  const game = structuredClone(current) as GameState;
  const globalEvent = getEventForDay(game);
  for (const index of [0, 1] as const) validatePlan(game.players[index], plans[index], Boolean(globalEvent?.definition.choice));
  const finalPlans: [RoundPlan, RoundPlan] = structuredClone(plans) as [RoundPlan, RoundPlan];
  const roundEvents: RoundEvent[] = [];

  // Las dos colonias revelan sus ataques antes de resolver las cartas de supervivencia.
  for (const attackerIndex of [0, 1] as const) {
    const attacker = game.players[attackerIndex];
    if (attacker.colony.eliminated) continue;
    const targetIndex = (1 - attackerIndex) as 0 | 1;
    const target = game.players[targetIndex];
    for (const cardInstance of getPlannedCards(attacker, finalPlans[attackerIndex], "attack")) {
      const card = cardInstance.definition as AttackCardDefinition;
      applyEffects(attacker.colony.resources, card.selfCost);
      if (card.special === "conceal") {
        target.colony.concealedThroughDay = Math.max(target.colony.concealedThroughDay, game.day + 1);
        roundEvents.push({ kind: "special", text: `${target.name}: telemetría oculta durante el próximo día.`, playerIndex: attackerIndex, targetIndex, cardId: card.id });
      } else {
        const scale = finalPlans[targetIndex].reserveShield ? 0.5 : 1;
        applyEffects(target.colony.resources, card.effects, scale);
        roundEvents.push({ kind: "attack", text: `${attacker.name} lanza ${card.shortName}${scale === 0.5 ? "; el protocolo reduce el impacto a la mitad" : ""}.`, playerIndex: attackerIndex, targetIndex, cardId: card.id, effect: card.effects });
      }
    }
  }

  for (const playerIndex of [0, 1] as const) {
    const player = game.players[playerIndex];
    if (player.colony.eliminated) continue;
    for (const cardInstance of getPlannedCards(player, finalPlans[playerIndex], "survival")) {
      const card = cardInstance.definition as SurvivalCardDefinition;
      applyEffects(player.colony.resources, card.effects);
      roundEvents.push({ kind: "survival", text: `${player.name} activa ${card.shortName}.`, playerIndex, cardId: card.id, effect: card.effects });
    }
  }

  if (globalEvent) {
    for (const playerIndex of [0, 1] as const) {
      applyEventToPlayer(game.players[playerIndex], finalPlans[playerIndex], globalEvent, roundEvents);
    }
  }

  for (const playerIndex of [0, 1] as const) {
    movePlayedCards(game.players[playerIndex], finalPlans[playerIndex]);
    const failedSystem = statFailure(game.players[playerIndex].colony.resources);
    if (failedSystem) {
      game.players[playerIndex].colony.eliminated = true;
      roundEvents.push({ kind: "collapse", text: `${game.players[playerIndex].name} colapsa: ${failedSystem.toUpperCase()} alcanzó un límite.`, playerIndex, effect: { [failedSystem]: game.players[playerIndex].colony.resources[failedSystem] } });
    }
  }

  const outcome = decideOutcome(game, [
    statFailure(game.players[0].colony.resources),
    statFailure(game.players[1].colony.resources),
  ]);
  if (outcome) {
    game.status = "over";
    game.outcome = outcome;
    pushEvents(game, roundEvents);
    return game;
  }

  game.day += 1;
  const random = createRandom(game.randomState);
  for (const player of game.players) {
    if (player.colony.eliminated) continue;
    if (game.day >= 2) {
      applyEffects(player.colony.resources, { energy: -5, oxygen: -5, food: -5 });
      roundEvents.push({ kind: "upkeep", text: `${player.name}: desgaste diario −5% energía, oxígeno/agua y comida.`, playerIndex: player.index, effect: { energy: -5, oxygen: -5, food: -5 } });
    }
    fillHand(player, random);
  }
  game.randomState = random.getState();
  pushEvents(game, roundEvents);
  return game;
}

function applyUpcomingEventForecast(resources: ResourceBars, plan: RoundPlan, event: EventInstance | null): void {
  if (!event) return;
  if (event.definition.choice) {
    const preferred = findEventChoice(resources);
    const chosen = plan.globalTarget || preferred;
    resources[chosen] = roundStat(resources[chosen] + event.definition.choice);
  } else {
    applyEffects(resources, event.definition.effects ?? {});
  }
}

function safeScore(resources: ResourceBars): number {
  let score = 0;
  for (const value of Object.values(resources)) {
    if (value <= 0 || value >= 100) score -= 1200;
    score -= Math.abs(value - 50) * 1.15;
    if (value < 20 || value > 80) score -= 22;
  }
  return score;
}

function threatScore(resources: ResourceBars): number {
  return Object.values(resources).reduce((score, value) => {
    const lowThreat = Math.max(0, 28 - value);
    const highThreat = Math.max(0, value - 72);
    return score + lowThreat * lowThreat + highThreat * highThreat;
  }, 0);
}

function projectPlan(game: GameState, playerIndex: number, plan: RoundPlan): [ResourceBars, ResourceBars] {
  const ownIndex = playerIndex as 0 | 1;
  const enemyIndex = (1 - playerIndex) as 0 | 1;
  const projected: [ResourceBars, ResourceBars] = [
    { ...game.players[0].colony.resources },
    { ...game.players[1].colony.resources },
  ];
  const own = game.players[ownIndex];
  const enemyPlan = emptyPlan();
  for (const cardInstance of getPlannedCards(own, plan, "attack")) {
    const card = cardInstance.definition as AttackCardDefinition;
    applyEffects(projected[ownIndex], card.selfCost);
    applyEffects(projected[enemyIndex], card.effects, enemyPlan.reserveShield ? 0.5 : 1);
  }
  for (const cardInstance of getPlannedCards(own, plan, "survival")) {
    applyEffects(projected[ownIndex], cardInstance.definition.effects);
  }
  const event = getEventForDay(game);
  applyUpcomingEventForecast(projected[0], playerIndex === 0 ? plan : enemyPlan, event);
  applyUpcomingEventForecast(projected[1], playerIndex === 1 ? plan : enemyPlan, event);
  return projected;
}

export function chooseAiPlan(game: GameState, playerIndex = 1): RoundPlan {
  const player = game.players[playerIndex];
  if (!player || player.colony.eliminated) return emptyPlan();
  const cards = allCards(player);
  const beforeEnemyThreat = threatScore(game.players[1 - playerIndex].colony.resources);
  let bestPlan = emptyPlan();
  let bestScore = Number.NEGATIVE_INFINITY;

  const evaluate = (picked: CardInstance[], cost: number): void => {
    const candidate: RoundPlan = {
      survival: picked.filter((card) => card.kind === "survival").map((card) => card.uid),
      attacks: picked.filter((card) => card.kind === "attack").map((card) => card.uid),
      reserveShield: cost < ACTION_POINTS,
      globalTarget: findEventChoice(player.colony.resources),
      globalTargetChosen: true,
    };
    const projected = projectPlan(game, playerIndex, candidate);
    const ownScore = safeScore(projected[playerIndex]);
    const enemyThreat = threatScore(projected[1 - playerIndex]);
    const ownDead = statFailure(projected[playerIndex]) ? 700 : 0;
    const enemyCollapse = statFailure(projected[1 - playerIndex]) ? 180 : 0;
    const cardUse = picked.length ? 1.5 : 0;
    const score = ownScore + (enemyThreat - beforeEnemyThreat) * 0.25 + enemyCollapse + cardUse - ownDead;
    if (score > bestScore) {
      bestScore = score;
      bestPlan = candidate;
    }
  };

  const walk = (position: number, picked: CardInstance[], cost: number): void => {
    if (position >= cards.length) {
      evaluate(picked, cost);
      return;
    }
    walk(position + 1, picked, cost);
    const nextCost = cost + cards[position].definition.cost;
    if (nextCost <= ACTION_POINTS) walk(position + 1, [...picked, cards[position]], nextCost);
  };
  walk(0, [], 0);
  return bestPlan;
}
