import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["--import", "tsx", "src/server/main.ts"], { stdio: "inherit" }),
  spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev:web"], { stdio: "inherit" }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 100).unref();
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping && code) stop(code);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
