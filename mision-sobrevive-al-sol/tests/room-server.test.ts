import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createRoomServer } from "../server/room-server";
import type { ServerRoomMessage } from "../src/network/protocol";

const sockets: WebSocket[] = [];
let closeServer: (() => Promise<void>) | undefined;

function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket("ws://127.0.0.1:" + port + "/rooms");
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function waitFor<T extends ServerRoomMessage["type"]>(
  socket: WebSocket,
  type: T,
): Promise<Extract<ServerRoomMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timeout esperando " + type));
    }, 4000);
    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as ServerRoomMessage;
      if (message.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message as Extract<ServerRoomMessage, { type: T }>);
    };
    socket.on("message", onMessage);
  });
}

describe("sala online de supervivencia", () => {
  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.close());
    await closeServer?.();
    closeServer = undefined;
  });

  it("crea sala de cuatro, oculta manos ajenas y resuelve una ronda simultánea", async () => {
    const server = createRoomServer(0, "127.0.0.1");
    const port = await server.listen();
    closeServer = () => server.close();

    const host = await connect(port);
    const createdPromise = waitFor(host, "room-created");
    host.send(JSON.stringify({ type: "create-room" }));
    const created = await createdPromise;

    const clients = [host];
    for (let index = 0; index < 3; index += 1) {
      const client = await connect(port);
      const joinedPromise = waitFor(client, "room-joined");
      client.send(JSON.stringify({ type: "join-room", roomCode: created.roomCode }));
      await joinedPromise;
      clients.push(client);
    }

    const starts = clients.map((client) => waitFor(client, "game-start"));
    host.send(JSON.stringify({ type: "start-room" }));
    const states = await Promise.all(starts);
    expect(states.every((entry) => Boolean(entry.state.players))).toBe(true);
    states.forEach((entry) => {
      expect(entry.state.players).toHaveLength(4);
      expect(entry.state.players[0].survivalHand).toHaveLength(3);
      expect(entry.state.players.slice(1).every((player) => player.survivalHand.length === 0)).toBe(true);
    });

    const resolved = clients.map((client) => waitFor(client, "round-resolved"));
    clients.forEach((client) => client.send(JSON.stringify({ type: "submit-plan", plan: {
      survival: [], reserveShield: false, globalTarget: "energy", globalTargetChosen: false,
    } })));
    const results = await Promise.all(resolved);
    expect(results.every((entry) => entry.state.day === 2)).toBe(true);
    expect(results.every((entry) => entry.state.players[0].colony.resources.energy === 45)).toBe(true);
  });
});
