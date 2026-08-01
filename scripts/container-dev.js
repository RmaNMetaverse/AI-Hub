import crypto from "node:crypto";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";

const lockfile = fs.readFileSync("package-lock.json");
const expectedHash = crypto.createHash("sha256").update(lockfile).digest("hex");
const markerPath = "node_modules/.ai-hub-lock-hash";
const installedHash = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8").trim() : "";

if (installedHash !== expectedHash) {
  console.log("Refreshing container dependencies after a package change...");
  const install = spawnSync("npm", ["ci"], { stdio: "inherit" });
  if (install.status !== 0) process.exit(install.status ?? 1);
  fs.writeFileSync(markerPath, expectedHash);
}

const development = spawn("npm", ["run", "dev"], { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => development.kill(signal));
}

development.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
