import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";
import { setupWebSocket } from "./terminal-server.mjs";
import fs from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const PORT = 7681;
const isWin = process.platform === "win32";

// File logging setup to capture absolute truths about backend execution
const LOG_FILE = join(ROOT, "ghostbox-dev.log");
fs.writeFileSync(LOG_FILE, `=== Start dev log: ${new Date().toISOString()} ===\n`);

function log(msg) {
  const line = `[Dev] ${new Date().toISOString()} - ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(msg);
}

function logError(msg, err) {
  const errStr = err ? (err.stack || err.message || err) : "";
  const line = `[Dev Error] ${new Date().toISOString()} - ${msg}: ${errStr}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.error(msg, err);
}

process.on("uncaughtException", (err) => {
  logError("Uncaught Exception", err);
});
process.on("unhandledRejection", (err) => {
  logError("Unhandled Rejection", err);
});

log("Killing ports 7681 and 3000...");
function killPort(port) {
  try {
    const out = execSync(
      isWin
        ? `netstat -ano | findstr ":${port} "`
        : `lsof -ti:${port} 2>/dev/null`,
      { encoding: "utf8", timeout: 3000, stdio: "pipe" },
    );
    if (!out) return;
    for (const line of out.trim().split("\n").filter(Boolean)) {
      const pid = isWin ? line.trim().split(/\s+/).slice(-1)[0] : line.trim();
      if (pid && pid !== "0") {
        try {
          execSync(isWin ? `taskkill /f /pid ${pid}` : `kill -9 ${pid}`, { stdio: "ignore" });
          log(`Killed PID ${pid} occupying port ${port}`);
        } catch (e) {
          logError(`Failed to kill PID ${pid}`, e);
        }
      }
    }
  } catch (e) {
    // Normal when port is not in use
  }
}

killPort(PORT);
killPort(3000);

log("Initializing WebSocket Server...");
const http = createServer();
const wss = new WebSocketServer({ noServer: true });

try {
  setupWebSocket(wss);
  log("WebSocket logic bound to server.");
} catch (e) {
  logError("Error in setupWebSocket", e);
}

http.on("upgrade", (req, socket, head) => {
  log(`Upgrade requested from URL: ${req.url}`);
  try {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
      log("WebSocket upgraded successfully.");
    });
  } catch (e) {
    logError("Upgrade failed", e);
  }
});

http.on("error", (err) => {
  logError("HTTP server error", err);
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is already in use. Kill the existing process or use a different port.\n`);
  } else {
    console.error(`\n  Terminal server error: ${err.message}\n`);
  }
  process.exit(1);
});

// Bind to 0.0.0.0 to listen on all interfaces (IPv4 and IPv6-fallback)
http.listen(PORT, "0.0.0.0", () => {
  log(`Terminal server listening on 0.0.0.0:${PORT}`);
  console.log(`\n  ✓ Terminal server → ws://localhost:${PORT}`);
  console.log(`  ✓ Open http://localhost:3000 in your browser\n`);
});

log("Spawning Next.js dev server...");
const next = spawn("pnpm", ["--filter", "@ghostbox/web", "dev"], {
  stdio: "pipe", // Capture stdio to write to our log file!
  shell: isWin,
  cwd: ROOT,
  env: process.env,
});

next.stdout.on("data", (data) => {
  fs.appendFileSync(LOG_FILE, `[Next Stdout] ${data.toString()}`);
});

next.stderr.on("data", (data) => {
  fs.appendFileSync(LOG_FILE, `[Next Stderr] ${data.toString()}`);
});

next.on("error", (err) => {
  logError("Failed to start Next.js process", err);
  process.exit(1);
});

next.on("exit", (code) => {
  log(`Next.js process exited with code ${code}`);
});

function shutdown() {
  log("Shutting down dev server...");
  try { next.kill(isWin ? undefined : "SIGTERM"); } catch (e) { }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
