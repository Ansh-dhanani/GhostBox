const { WebSocket, WebSocketServer } = require("ws");
const { createServer } = require("http");

const server = createServer();
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
server.listen(7681, () => console.log("TEST: HTTP server listening on 7681"));
wss.on("connection", (ws) => {
  console.log("TEST: WebSocket server got connection");
  ws.send(JSON.stringify({ type: "hello" }));
});

setTimeout(() => {
  console.log("TEST: Client connecting to ws://127.0.0.1:7681");
  const ws = new WebSocket("ws://127.0.0.1:7681");
  ws.on("open", () => {
    console.log("TEST: CLIENT connected!");
    ws.send(JSON.stringify({ type: "ping" }));
  });
  ws.on("message", (data) => {
    console.log("TEST: CLIENT received:", String(data));
  });
  ws.on("error", (err) => {
    console.log("TEST: CLIENT error:", err.message);
  });
  ws.on("close", () => {
    console.log("TEST: CLIENT closed");
  });
}, 500);

setTimeout(() => {
  console.log("TEST: Done");
  wss.close();
  server.close();
  process.exit(0);
}, 3000);
