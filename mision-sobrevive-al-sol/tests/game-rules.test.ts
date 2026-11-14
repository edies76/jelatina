import { describe, expect, it } from "vitest";
import { ATTACK_CARDS, GLOBAL_EVENTS, SURVIVAL_CARDS, type CardInstance } from "../src/data";
import { chooseAiPlan, createGame, emptyPlan, previewPlan, resolveRound, toggleEmergencyShield, togglePlanCard, type RoundPlan } from "../src/game-rules";

function card(uid: string, kind: "survival" | "attack", definitionIndex: number): CardInstance {
  return {
    uid,
    kind,
    definition: kind === "survival" ? SURVIVAL_CARDS[definitionIndex] : ATTACK_CARDS[definitionIndex],
  };
}

function plans(): [RoundPlan, RoundPlan] {
  return [emptyPlan(), emptyPlan()];
}

describe("reglas de Misión: Sobrevive al Sol", () => {
  it("prepara las cuatro barras al 50%, 3 cartas de supervivencia y 2 ataques", () => {
    const game = createGame("solo", 1234);
    for (const player of game.players) {
      expect(player.colony.resources).toEqual({ energy: 50, oxygen: 50, food: 50, shield: 50 });
      expect(player.survivalHand).toHaveLength(3);
      expect(player.attackHand).toHaveLength(2);
      expect(player.survivalHand.length + player.survivalDeck.length + player.survivalDiscard.length).toBe(32);
      expect(player.attackHand.length + player.attackDeck.length + player.attackDiscard.length).toBe(16);
    }
    expect(game.globalDeck).toHaveLength(12);
  });

  it("limita el plan a 3 PA y reserva como máximo 2 PA con el protocolo", () => {
    const game = createGame("solo", 8);
    const player = game.players[0];
    const solar = card("test:solar", "survival", 0);
    const reactor = card("test:reactor", "survival", 1);
    player.survivalHand[0] = solar;
    player.survivalHand[1] = reactor;
    const plan = emptyPlan();
    expect(togglePlanCard(player, plan, solar)).toBe(true);
    expect(toggleEmergencyShield(player, plan)).toBe(true);
    expect(togglePlanCard(player, plan, reactor)).toBe(false);
  });

  it("previsualiza el cambio de una carta antes de jugarla", () => {
    const game = createGame("solo", 9);
    const player = game.players[0];
    const solar = card("test:solar", "survival", 0);
    player.survivalHand[0] = solar;
    const preview = previewPlan(game, plans(), 0, solar.uid);
    expect(preview.changes[0]).toEqual({ energy: 30, shield: -15 });
    expect(preview.changes[1]).toEqual({});
  });

  it("previsualiza con precisión los medios porcentajes del escudo de emergencia", () => {
    const game = createGame("duel", 16);
    const attack = card("test:solar-overload", "attack", 0);
    game.players[1].attackHand[0] = attack;
    const turnPlans = plans();
    turnPlans[0].reserveShield = true;
    turnPlans[1].attacks = [attack.uid];
    const preview = previewPlan(game, turnPlans);
    expect(preview.changes[0]).toEqual({ energy: 15, shield: -7.5 });
  });

  it("resuelve ataques primero y reduce a la mitad el daño entrante con el escudo", () => {
    const game = createGame("duel", 10);
    const attack = card("test:solar-overload", "attack", 0);
    game.players[1].attackHand[0] = attack;
    const turnPlans = plans();
    turnPlans[0].reserveShield = true;
    turnPlans[1].attacks = [attack.uid];

    const next = resolveRound(game, turnPlans);
    expect(next.players[0].colony.resources.energy).toBe(60); // +15 del ataque y -5 del desgaste del día 2
    expect(next.players[0].colony.resources.shield).toBe(42.5);
    expect(next.players[1].colony.resources.energy).toBe(35); // -10 de coste y -5 de desgaste
  });

  it("colapsa inmediatamente si una barra alcanza 100% al final de la resolución", () => {
    const game = createGame("solo", 11);
    game.players[0].colony.resources.energy = 80;
    const solar = card("test:solar", "survival", 0);
    game.players[0].survivalHand[0] = solar;
    const turnPlans = plans();
    turnPlans[0].survival = [solar.uid];
    const next = resolveRound(game, turnPlans);
    expect(next.status).toBe("over");
    expect(next.players[0].colony.eliminated).toBe(true);
    expect(next.outcome?.reason).toBe("collapse");
  });

  it("activa el evento del día 3 después de las cartas y el desgaste del día 4", () => {
    const game = createGame("duel", 12);
    game.day = 3;
    game.globalDeck[0] = { uid: "event:lunar-night:test", definition: GLOBAL_EVENTS[0] };
    const next = resolveRound(game, plans());
    expect(next.players[0].colony.resources.energy).toBe(20);
    expect(next.players[0].colony.resources.food).toBe(35);
    expect(next.lastEvents.some((event) => event.kind === "global" && event.eventId === "lunar-night")).toBe(true);
  });

  it("exige que cada colonia elija una barra para la cápsula de reabastecimiento", () => {
    const game = createGame("duel", 14);
    game.day = 3;
    game.globalDeck[0] = { uid: "event:resupply:test", definition: GLOBAL_EVENTS[4] };
    const turnPlans = plans();
    expect(() => resolveRound(game, turnPlans)).toThrow("Elige una barra");
    turnPlans[0].globalTarget = "food";
    turnPlans[0].globalTargetChosen = true;
    turnPlans[1].globalTarget = "shield";
    turnPlans[1].globalTargetChosen = true;
    const next = resolveRound(game, turnPlans);
    expect(next.players[0].colony.resources.food).toBe(65);
    expect(next.players[1].colony.resources.shield).toBe(70);
  });

  it("rechaza cartas duplicadas o del mazo equivocado en el plan", () => {
    const game = createGame("solo", 15);
    const solar = card("test:solar", "survival", 0);
    game.players[0].survivalHand[0] = solar;
    const invalid = plans();
    invalid[0].survival = [solar.uid, solar.uid];
    expect(() => resolveRound(game, invalid)).toThrow("no se puede jugar dos veces");
    invalid[0].survival = [];
    invalid[0].attacks = [solar.uid];
    expect(() => resolveRound(game, invalid)).toThrow("no es una carta de ataque válida");
  });

  it("la IA construye un plan que respeta su límite de PA", () => {
    const game = createGame("solo", 13);
    const aiPlan = chooseAiPlan(game, 1);
    const player = game.players[1];
    const cost = [...aiPlan.survival, ...aiPlan.attacks].reduce((sum, uid) => {
      const selected = [...player.survivalHand, ...player.attackHand].find((entry) => entry.uid === uid);
      return sum + (selected?.definition.cost ?? 0);
    }, 0);
    expect(cost).toBeLessThanOrEqual(3);
    if (aiPlan.reserveShield) expect(cost).toBeLessThanOrEqual(2);
  });
});
