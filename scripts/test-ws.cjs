const { WebSocket } = require("ws");

const TIMEOUT = 5000;
const started = Date.now();

try {
  const ws = new WebSocket("ws://127.0.0.1:7681");
  ws.on("open", () => {
    console.log("CLIENT: connected!");
    ws.send(JSON.stringify({ type: "resize", cols: 80, rows: 24 }));
  });
  ws.on("message", (d) => {
    console.log("CLIENT: msg:", String(d));
  });
  ws.on("error", (e) => {
    console.log("CLIENT: error:", e.message);
  });
  ws.on("close", () => {
    console.log("CLIENT: closed");
    process.exit(0);
  });
  setTimeout(() => {
    console.log("CLIENT: timeout after 5s");
    process.exit(1);
  }, TIMEOUT);
} catch (e) {
  console.log("CLIENT: exception:", e.message);
  process.exit(1);
}
