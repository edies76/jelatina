import type { ClientRoomMessage, ServerRoomMessage } from "./protocol";

export class RoomClient {
  private socket?: WebSocket;
  private connected = false;
  onMessage?: (message: ServerRoomMessage) => void;
  onDisconnect?: () => void;
  onError?: (message: string) => void;

  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    const address = new URL("/rooms", window.location.href);
    address.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    address.port = import.meta.env.VITE_ROOM_PORT || "3001";
    const socket = new WebSocket(address.toString());
    this.socket = socket;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          socket.close();
          reject(new Error("No responde el servidor de salas. Inicia el modo multijugador e inténtalo de nuevo."));
        }
      }, 5000);
      socket.addEventListener("open", () => {
        this.connected = true;
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
      socket.addEventListener("message", (event) => {
        try {
          this.onMessage?.(JSON.parse(String(event.data)) as ServerRoomMessage);
        } catch {
          this.onError?.("El servidor envió una respuesta que no se pudo leer.");
        }
      });
      socket.addEventListener("error", () => {
        window.clearTimeout(timeout);
        const message = "No se pudo conectar con el servidor de salas.";
        this.onError?.(message);
        reject(new Error(message));
      });
      socket.addEventListener("close", () => {
        const wasConnected = this.connected;
        this.connected = false;
        if (wasConnected) this.onDisconnect?.();
      });
    });
  }

  send(message: ClientRoomMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000, "El jugador salió de la sala");
    this.connected = false;
    this.socket = undefined;
  }
}
