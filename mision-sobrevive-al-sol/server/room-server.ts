import { createServer, type Server } from "node:http";
import { randomInt } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { SYSTEMS, type SystemId } from "../src/data";
import {
  createGame,
  emptyPlan,
  getEventForDay,
  resolveRound,
  validatePlan,
  type GameOutcome,
  type GameState,
  type PlayerState,
  type RoundPlan,
} from "../src/game-rules";
import type { ClientRoomMessage, ServerRoomMessage } from "../src/network/protocol";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const PLAN_MS = 15_000;
const RESOLVE_MS = 5_000;
const ROOM_TTL_MS = 60_000;

interface Room {
  code: string;
  clients: Array<WebSocket | null>;
  game: GameState | null;
  plans: Array<RoundPlan | null>;
  phase: "waiting" | "planning" | "resolving" | "over";
  deadlineAt: number;
  timer?: ReturnType<typeof setTimeout>;
  cleanup?: ReturnType<typeof setTimeout>;
}

interface SocketSeat {
  roomCode: string;
  playerIndex: number;
}

export interface RoomServer {
  httpServer: Server;
  listen: () => Promise<number>;
  close: () => Promise<void>;
  getRoomCount: () => number;
}

function send(socket: WebSocket | null | undefined, message: ServerRoomMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function randomRoomCode(): string {
  let code = "";
  for (let index = 0; index < 5; index += 1) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}

function makeRoomCode(rooms: Map<string, Room>): string {
  let code = randomRoomCode();
  while (rooms.has(code)) code = randomRoomCode();
  return code;
}

function sanitizePlan(value: unknown): RoundPlan {
  if (!value || typeof value !== "object") throw new Error("El plan recibido no es válido.");
  const input = value as Partial<RoundPlan>;
  const system = SYSTEMS.some((entry) => entry.id === input.globalTarget) ? input.globalTarget as SystemId : "energy";
  return {
    survival: Array.isArray(input.survival) ? input.survival.filter((id): id is string => typeof id === "string").slice(0, 5) : [],
    reserveShield: Boolean(input.reserveShield),
    globalTarget: system,
    globalTargetChosen: Boolean(input.globalTargetChosen),
  };
}

function lowestResource(resources: PlayerState["colony"]["resources"]): SystemId {
  return (["energy", "oxygen", "food", "shield"] as SystemId[]).reduce(
    (lowest, system) => resources[system] < resources[lowest] ? system : lowest,
    "energy",
  );
}

function passPlan(game: GameState, playerIndex: number): RoundPlan {
  const plan = emptyPlan();
  if (getEventForDay(game)?.definition.choice) {
    plan.globalTarget = lowestResource(game.players[playerIndex].colony.resources);
    plan.globalTargetChosen = true;
  }
  return plan;
}

function aliveIndices(game: GameState): number[] {
  return game.players.flatMap((player, index) => player.colony.eliminated ? [] : [index]);
}

function outcomeForSurvivors(game: GameState): GameOutcome | null {
  const alive = aliveIndices(game);
  if (alive.length > 1) return null;
  if (alive.length === 0) {
    return { winner: null, reason: "draw", title: "COLAPSO TOTAL", detail: "Todas las colonias llegaron a un límite crítico." };
  }
  const winner = alive[0];
  return { winner, reason: "last-standing", title: "¡ÚLTIMA COLONIA EN PIE!", detail: `${game.players[winner].name} sobrevivió a todos los jugadores.` };
}

function playerView(player: PlayerState, localIndex: number, hidePrivateCards: boolean): PlayerState {
  const view = structuredClone(player);
  view.index = localIndex;
  view.name = localIndex === 0 ? "Tu colonia" : `Colonia ${localIndex + 1}`;
  view.isAI = false;
  if (hidePrivateCards) {
    view.survivalHand = [];
    view.survivalDeck = [];
    view.survivalDiscard = [];
  }
  return view;
}

export function stateForPlayer(game: GameState, playerIndex: number): GameState {
  const copy = structuredClone(game);
  const order = [playerIndex, ...game.players.map((_, index) => index).filter((index) => index !== playerIndex)];
  copy.players = order.map((originalIndex, localIndex) => playerView(game.players[originalIndex], localIndex, localIndex !== 0));
  for (const collection of [copy.lastEvents, copy.history]) {
    for (const event of collection) {
      if (event.playerIndex !== undefined) event.playerIndex = order.indexOf(event.playerIndex);
    }
  }
  copy.randomState = 0;
  if (copy.outcome?.winner !== null && copy.outcome?.winner !== undefined) {
    const localWinner = copy.outcome.winner === playerIndex ? 0 : order.indexOf(copy.outcome.winner);
    copy.outcome.winner = localWinner;
    copy.outcome.title = localWinner === 0 ? "¡VICTORIA!" : "DERROTA";
    copy.outcome.detail = localWinner === 0 ? "Tu colonia es la última en pie." : `La última colonia en pie fue el Rival ${localWinner}.`;
  }
  return copy;
}

function clearRoomTimer(room: Room): void {
  if (room.timer) clearTimeout(room.timer);
  room.timer = undefined;
}

export function createRoomServer(port = Number(process.env.ROOM_PORT ?? 3001), host = process.env.ROOM_HOST ?? "0.0.0.0"): RoomServer {
  const rooms = new Map<string, Room>();
  const seats = new Map<WebSocket, SocketSeat>();
  const httpServer = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "ready", rooms: rooms.size }));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });
  const wss = new WebSocketServer({ server: httpServer, path: "/rooms", maxPayload: 16_384, perMessageDeflate: false });

  function roomStatus(room: Room, message: string): ServerRoomMessage {
    return { type: "room-status", roomCode: room.code, currentPlayers: room.clients.filter(Boolean).length, maxPlayers: MAX_PLAYERS, message };
  }

  function sendToRoom(room: Room, message: ServerRoomMessage): void {
    room.clients.forEach((socket) => send(socket, message));
  }

  function sendState(room: Room, type: "game-start" | "round-start", remainingMs: number): void {
    if (!room.game) return;
    room.clients.forEach((socket, playerIndex) => send(socket, {
      type,
      roomCode: room.code,
      playerIndex,
      state: stateForPlayer(room.game!, playerIndex),
      remainingMs,
      readyPlayers: 0,
      activePlayers: aliveIndices(room.game!).length,
    }));
  }

  function endRoom(room: Room, message?: string): void {
    clearRoomTimer(room);
    if (room.cleanup) clearTimeout(room.cleanup);
    rooms.delete(room.code);
    room.clients.forEach((socket) => {
      if (!socket) return;
      seats.delete(socket);
      if (socket.readyState === WebSocket.OPEN) {
        if (message) send(socket, { type: "room-error", message });
        socket.close(1000, "Sala cerrada");
      }
    });
  }

  function sendGameOver(room: Room): void {
    if (!room.game) return;
    clearRoomTimer(room);
    room.phase = "over";
    room.clients.forEach((socket, index) => send(socket, { type: "game-over", state: stateForPlayer(room.game!, index) }));
    room.cleanup = setTimeout(() => endRoom(room), ROOM_TTL_MS);
  }

  function startPlanning(room: Room): void {
    if (!room.game || room.phase === "over") return;
    const outcome = outcomeForSurvivors(room.game);
    if (outcome) {
      room.game.status = "over";
      room.game.outcome = outcome;
      sendGameOver(room);
      return;
    }
    clearRoomTimer(room);
    room.phase = "planning";
    room.plans = room.game.players.map((player) => player.colony.eliminated ? passPlan(room.game!, player.index) : null);
    room.deadlineAt = Date.now() + PLAN_MS;
    sendState(room, "round-start", PLAN_MS);
    room.timer = setTimeout(() => resolveRoom(room), PLAN_MS);
  }

  function resolveRoom(room: Room): void {
    if (!room.game || room.phase !== "planning") return;
    clearRoomTimer(room);
    room.phase = "resolving";
    const plans = room.game.players.map((player, index) => room.plans[index] ?? passPlan(room.game!, index));
    try {
      room.game = resolveRound(room.game, plans);
    } catch (error) {
      endRoom(room, error instanceof Error ? error.message : "No se pudo resolver la ronda.");
      return;
    }
    room.deadlineAt = Date.now() + RESOLVE_MS;
    room.clients.forEach((socket, index) => send(socket, {
      type: "round-resolved",
      state: stateForPlayer(room.game!, index),
      remainingMs: RESOLVE_MS,
    }));
    room.timer = setTimeout(() => {
      if (room.game?.status === "over") sendGameOver(room);
      else startPlanning(room);
    }, RESOLVE_MS + 250);
  }

  function handleCreate(socket: WebSocket): void {
    if (seats.has(socket)) return;
    const code = makeRoomCode(rooms);
    const room: Room = { code, clients: [socket], game: null, plans: [], phase: "waiting", deadlineAt: 0 };
    rooms.set(code, room);
    seats.set(socket, { roomCode: code, playerIndex: 0 });
    send(socket, { type: "room-created", roomCode: code, playerIndex: 0, currentPlayers: 1, maxPlayers: MAX_PLAYERS });
  }

  function handleJoin(socket: WebSocket, roomCode: string): void {
    if (seats.has(socket)) return;
    const code = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    const room = rooms.get(code);
    if (!room || room.phase !== "waiting" || room.clients.length >= MAX_PLAYERS) {
      send(socket, { type: "room-error", message: "No existe una sala abierta con ese código." });
      return;
    }
    const playerIndex = room.clients.filter(Boolean).length;
    room.clients.push(socket);
    seats.set(socket, { roomCode: code, playerIndex });
    send(socket, { type: "room-joined", roomCode: code, playerIndex, currentPlayers: room.clients.length, maxPlayers: MAX_PLAYERS, message: "Te uniste a la sala." });
    sendToRoom(room, roomStatus(room, `Hay ${room.clients.filter(Boolean).length} de ${MAX_PLAYERS} jugadores. El anfitrión puede iniciar cuando estén al menos dos.`));
  }

  function handleStart(socket: WebSocket): void {
    const seat = seats.get(socket);
    const room = seat ? rooms.get(seat.roomCode) : undefined;
    if (!room || room.phase !== "waiting" || seat?.playerIndex !== 0) {
      send(socket, { type: "room-error", message: "Solo el anfitrión puede iniciar la sala." });
      return;
    }
    const playerCount = room.clients.filter(Boolean).length;
    if (playerCount < MIN_PLAYERS) {
      send(socket, { type: "room-error", message: "Espera a que se una al menos otra colonia." });
      return;
    }
    room.game = createGame("multiplayer", randomInt(1, 0x7fffffff), playerCount);
    room.game.players.forEach((player, index) => {
      player.name = `Jugador ${index + 1}`;
      player.isAI = false;
    });
    room.phase = "planning";
    room.plans = room.game.players.map(() => null);
    room.deadlineAt = Date.now() + PLAN_MS;
    sendState(room, "game-start", PLAN_MS);
    room.timer = setTimeout(() => resolveRoom(room), PLAN_MS);
  }

  function handlePlan(socket: WebSocket, rawPlan: unknown): void {
    const seat = seats.get(socket);
    const room = seat ? rooms.get(seat.roomCode) : undefined;
    if (!room || !room.game || room.phase !== "planning") {
      send(socket, { type: "room-error", message: "No hay una ronda activa para enviar." });
      return;
    }
    const playerIndex = seat!.playerIndex;
    if (room.game.players[playerIndex].colony.eliminated) {
      send(socket, { type: "room-error", message: "Tu colonia ya quedó fuera de la partida." });
      return;
    }
    if (room.plans[playerIndex]) {
      send(socket, { type: "room-error", message: "Ya enviaste tu plan para esta ronda." });
      return;
    }
    try {
      const plan = sanitizePlan(rawPlan);
      validatePlan(room.game.players[playerIndex], plan, Boolean(getEventForDay(room.game)?.definition.choice));
      room.plans[playerIndex] = plan;
    } catch (error) {
      send(socket, { type: "room-error", message: error instanceof Error ? error.message : "Plan no válido." });
      return;
    }
    const activeIndices = aliveIndices(room.game);
    const readyPlayers = activeIndices.filter((index) => Boolean(room.plans[index])).length;
    send(socket, { type: "plan-locked", message: "Plan enviado en secreto. Esperando a las otras colonias." });
    activeIndices.forEach((index) => {
      if (index !== playerIndex) send(room.clients[index], {
        type: "opponent-ready",
        message: `Hay ${readyPlayers} de ${activeIndices.length} planes listos.`,
        readyPlayers,
        activePlayers: activeIndices.length,
      });
    });
    if (readyPlayers === activeIndices.length) resolveRoom(room);
  }

  function leaveSocket(socket: WebSocket): void {
    const seat = seats.get(socket);
    if (!seat) return;
    const room = rooms.get(seat.roomCode);
    seats.delete(socket);
    if (!room) return;
    if (room.phase === "waiting") {
      const survivors = room.clients.filter((client): client is WebSocket => client !== null && client !== socket);
      if (seat.playerIndex === 0 || survivors.length === 0) {
        endRoom(room, "El anfitrión cerró la sala.");
      } else {
        room.clients = survivors;
        survivors.forEach((client, index) => seats.set(client, { roomCode: room.code, playerIndex: index }));
        sendToRoom(room, roomStatus(room, `Hay ${room.clients.length} de ${MAX_PLAYERS} jugadores en la sala.`));
      }
      return;
    }

    if (room.phase === "over" || !room.game) return;
    const player = room.game.players[seat.playerIndex];
    if (player && !player.colony.eliminated) {
      player.colony.eliminated = true;
      sendToRoom(room, { type: "opponent-disconnected", message: `${player.name} se desconectó y quedó fuera.` });
    }
    room.clients[seat.playerIndex] = null as unknown as WebSocket;
    room.plans[seat.playerIndex] = passPlan(room.game, seat.playerIndex);
    const remaining = aliveIndices(room.game);
    if (remaining.length <= 1) {
      room.game.status = "over";
      room.game.outcome = outcomeForSurvivors(room.game);
      sendGameOver(room);
    } else if (room.phase === "planning" && remaining.every((index) => Boolean(room.plans[index]))) {
      resolveRoom(room);
    }
  }

  wss.on("connection", (socket) => {
    socket.on("message", (data: RawData) => {
      let message: ClientRoomMessage;
      try {
        message = JSON.parse(data.toString()) as ClientRoomMessage;
      } catch {
        send(socket, { type: "room-error", message: "El mensaje no tiene un formato válido." });
        return;
      }
      switch (message.type) {
        case "create-room": handleCreate(socket); break;
        case "join-room": handleJoin(socket, message.roomCode); break;
        case "start-room": handleStart(socket); break;
        case "submit-plan": handlePlan(socket, message.plan); break;
        case "leave-room": leaveSocket(socket); break;
      }
    });
    socket.on("close", () => leaveSocket(socket));
    socket.on("error", () => leaveSocket(socket));
  });

  return {
    httpServer,
    getRoomCount: () => rooms.size,
    listen: () => new Promise<number>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, host, () => {
        httpServer.off("error", reject);
        const address = httpServer.address();
        resolve(address && typeof address === "object" ? address.port : port);
      });
    }),
    close: () => new Promise<void>((resolve) => {
      for (const room of rooms.values()) clearRoomTimer(room);
      for (const socket of wss.clients) socket.close(1001, "Servidor apagado");
      wss.close(() => httpServer.close(() => resolve()));
    }),
  };
}
