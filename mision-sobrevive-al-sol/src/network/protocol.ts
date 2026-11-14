import type { GameState, RoundPlan } from "../game-rules";

export type ClientRoomMessage =
  | { type: "create-room" }
  | { type: "join-room"; roomCode: string }
  | { type: "start-room" }
  | { type: "submit-plan"; plan: RoundPlan }
  | { type: "leave-room" };

export type ServerRoomMessage =
  | { type: "room-created"; roomCode: string; playerIndex: number; currentPlayers: number; maxPlayers: number }
  | { type: "room-joined"; roomCode: string; playerIndex: number; currentPlayers: number; maxPlayers: number; message: string }
  | { type: "room-status"; roomCode: string; currentPlayers: number; maxPlayers: number; message: string }
  | { type: "game-start" | "round-start"; roomCode: string; playerIndex: number; state: GameState; remainingMs: number; readyPlayers: number; activePlayers: number }
  | { type: "plan-locked"; message: string }
  | { type: "opponent-ready"; message: string; readyPlayers: number; activePlayers: number }
  | { type: "round-resolved"; state: GameState; remainingMs: number }
  | { type: "game-over"; state: GameState }
  | { type: "opponent-disconnected"; message: string }
  | { type: "room-error"; message: string };
