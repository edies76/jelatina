import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;
const children = [
  spawn(node, [join(root, "node_modules", "vite", "bin", "vite.js"), "--host", "0.0.0.0"], { cwd: root, stdio: "inherit" }),
  spawn(node, [join(root, "node_modules", "tsx", "dist", "cli.mjs"), join(root, "server", "index.ts")], { cwd: root, stdio: "inherit" }),
];

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("error", (error) => {
    process.stderr.write(`No se pudo iniciar un servicio de desarrollo: ${error.message}\n`);
    stop();
  });
  child.on("exit", (code) => {
    if (!stopping && code !== 0) stop();
  });
}
