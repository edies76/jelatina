import { createRoomServer } from "./room-server";

const server = createRoomServer();

server.listen().then((port) => {
  process.stdout.write(`Servidor de salas listo en ws://0.0.0.0:${port}/rooms\n`);
}).catch((error: unknown) => {
  process.stderr.write(`No se pudo iniciar el servidor de salas: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

const stop = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
