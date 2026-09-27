import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const tailwindCli = fileURLToPath(new URL("../node_modules/tailwindcss/lib/cli.js", import.meta.url));
const children = new Set();
let shuttingDown = false;

function start(command, args) {
  const child = spawn(command, args, { stdio: "inherit" });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    shuttingDown = true;
    for (const sibling of children) sibling.kill("SIGTERM");
    process.exitCode = signal ? 1 : (code ?? 1);
  });
  return child;
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start(process.execPath, ["--watch", "server.js"]);
start(process.execPath, [tailwindCli, "-i", "./public/css/input.css", "-o", "./public/css/app.css", "--watch=always", "--poll"]);
