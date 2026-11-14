import { describe, expect, it } from "vitest";
import { GLOBAL_EVENTS, SURVIVAL_CARDS, type CardInstance } from "../src/data";
import {
  chooseAiPlan, createGame, emptyPlan, previewPlan, resolveRound,
  toggleEmergencyShield, togglePlanCard, type RoundPlan,
} from "../src/game-rules";

function plans(count: number): RoundPlan[] {
  return Array.from({ length: count }, () => emptyPlan());
}

function survival(player: ReturnType<typeof createGame>["players"][number], id: string): CardInstance {
  const existing = player.survivalHand.find((item) => item.definition.id === id);
  if (existing) return existing;
  const definition = SURVIVAL_CARDS.find((item) => item.id === id);
  if (!definition) throw new Error("No existe la carta: " + id);
  const card: CardInstance = { uid: "p" + player.index + ":test:" + id, kind: "survival", definition };
  player.survivalHand.push(card);
  return card;
}

describe("reglas de Misión: Sobrevive al Sol", () => {
  it("inicia 2 colonias de práctica y 2–4 colonias online con tres cartas de supervivencia", () => {
    const solo = createGame("solo", 1234);
    expect(solo.players).toHaveLength(2);
    expect(solo.players[0].colony.resources).toEqual({ energy: 50, oxygen: 50, food: 50, shield: 50 });
    expect(solo.players[0].survivalHand).toHaveLength(3);
    expect(solo.players[0].survivalHand.every((card) => card.kind === "survival")).toBe(true);
    expect("attackHand" in solo.players[0]).toBe(false);
    expect(createGame("multiplayer", 45, 2).players).toHaveLength(2);
    expect(createGame("multiplayer", 45, 4).players).toHaveLength(4);
    expect(createGame("multiplayer", 45, 12).players).toHaveLength(4);
  });

  it("limita cada plan a 3 PA y reserva 1 PA para el protocolo", () => {
    const game = createGame("solo", 8);
    const player = game.players[0];
    const solar = survival(player, "solar-panels");
    const reactor = survival(player, "kilopower");
    const plan = emptyPlan();
    expect(togglePlanCard(player, plan, solar)).toBe(true);
    expect(toggleEmergencyShield(player, plan)).toBe(true);
    expect(togglePlanCard(player, plan, reactor)).toBe(false);
    expect(plan.survival).toEqual([solar.uid]);
  });

  it("previsualiza las barras al pasar por una carta y al seleccionarla", () => {
    const game = createGame("solo", 9);
    const player = game.players[0];
    const solar = survival(player, "solar-panels");
    const preview = previewPlan(game, plans(2), 0, solar.uid);
    expect(preview.changes[0]).toEqual({ energy: 30, shield: -15 });
    expect(preview.changes[1]).toEqual({});
    const selected = plans(2);
    selected[0].survival = [solar.uid];
    expect(previewPlan(game, selected).changes[0]).toEqual({ energy: 30, shield: -15 });
  });

  it("aplica primero la carta, reduce el evento y el desgaste con el protocolo", () => {
    const game = createGame("solo", 10);
    game.day = 3;
    game.globalDeck[0] = { uid: "test:flare", definition: GLOBAL_EVENTS.find((event) => event.id === "class-x-flare")! };
    const turnPlans = plans(2);
    turnPlans[0].reserveShield = true;
    const next = resolveRound(game, turnPlans);
    expect(next.players[0].colony.resources.shield).toBe(35);
    expect(next.players[0].colony.resources.energy).toBe(62.5);
    expect(next.lastEvents.some((event) => event.kind === "global" && event.eventId === "class-x-flare")).toBe(true);
  });

  it("exige un sistema elegido para el evento de reabastecimiento en cada colonia", () => {
    const game = createGame("multiplayer", 14, 3);
    game.day = 3;
    game.globalDeck[0] = { uid: "test:resupply", definition: GLOBAL_EVENTS.find((event) => event.id === "resupply")! };
    const turnPlans = plans(3);
    expect(() => resolveRound(game, turnPlans)).toThrow("Elige una barra");
    turnPlans.forEach((plan, index) => {
      plan.globalTarget = (["food", "shield", "energy"] as const)[index];
      plan.globalTargetChosen = true;
    });
    const next = resolveRound(game, turnPlans);
    expect(next.players[0].colony.resources.food).toBe(65);
    expect(next.players[1].colony.resources.shield).toBe(70);
  });

  it("termina la partida de cuatro jugadores cuando queda una sola colonia", () => {
    const game = createGame("multiplayer", 77, 4);
    const turnPlans = plans(4);
    for (let index = 0; index < 3; index += 1) {
      const player = game.players[index];
      player.colony.resources.energy = 80;
      const solar = survival(player, "solar-panels");
      turnPlans[index].survival = [solar.uid];
    }
    const next = resolveRound(game, turnPlans);
    expect(next.status).toBe("over");
    expect(next.players.map((player) => player.colony.eliminated)).toEqual([true, true, true, false]);
    expect(next.outcome?.winner).toBe(3);
    expect(next.outcome?.reason).toBe("last-standing");
  });

  it("sigue jugando online después del día 15 hasta que haya una superviviente", () => {
    const game = createGame("multiplayer", 81, 2);
    game.day = 15;
    const next = resolveRound(game, plans(2));
    expect(next.status).toBe("playing");
    expect(next.day).toBe(16);
    expect(next.outcome).toBeNull();
  });

  it("el desgaste también elimina una colonia que alcanza 0%", () => {
    const game = createGame("solo", 82);
    game.players[0].colony.resources.oxygen = 5;
    const next = resolveRound(game, plans(2));
    expect(next.status).toBe("over");
    expect(next.players[0].colony.eliminated).toBe(true);
    expect(next.outcome?.reason).toBe("collapse");
  });

  it("la IA practica sin cartas de ataque y respeta los 3 PA", () => {
    const game = createGame("solo", 13);
    const plan = chooseAiPlan(game, 1);
    const player = game.players[1];
    const cost = plan.survival.reduce((sum, uid) => sum + (player.survivalHand.find((card) => card.uid === uid)?.definition.cost || 0), 0);
    expect(cost).toBeLessThanOrEqual(3);
    if (plan.reserveShield) expect(cost).toBeLessThanOrEqual(2);
    expect(plan.survival.every((uid) => player.survivalHand.some((card) => card.uid === uid && card.definition.family !== undefined))).toBe(true);
  });

  it("consume y descarta las cartas elegidas al resolver la ronda", () => {
    const game = createGame("solo", 95);
    const chosen = survival(game.players[0], "solar-panels");
    const plan = plans(2);
    plan[0].survival = [chosen.uid];
    const next = resolveRound(game, plan);
    expect(next.players[0].survivalHand.some((card) => card.uid === chosen.uid)).toBe(false);
    expect(next.players[0].survivalDiscard.some((card) => card.uid === chosen.uid)).toBe(true);
    expect(SURVIVAL_CARDS.some((card) => card.id === chosen.definition.id)).toBe(true);
  });
});
