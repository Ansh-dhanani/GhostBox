import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { setupWebSocket } from "./terminal-server.mjs";

const PORT = parseInt(process.env.TERM_PORT || "7681", 10);

const http = createServer();
const wss = new WebSocketServer({ noServer: true });
setupWebSocket(wss);

http.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

http.listen(PORT, () => {
  console.log(`Ghostbox terminal server → ws://0.0.0.0:${PORT}`);
});
