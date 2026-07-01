import { WebSocketServer } from "ws";
import { createServer } from "http";

const h = createServer();
const w = new WebSocketServer({ noServer: true });
h.on("upgrade", (r, s, hd) => w.handleUpgrade(r, s, hd, (ws) => w.emit("connection", ws, r)));
h.listen(7681, () => console.log("listening on 7681"));
w.on("connection", (ws) => {
  console.log("server got connection");
  ws.send(JSON.stringify({ type: "hello" }));
  ws.on("message", (m) => console.log("msg:", String(m)));
});
setTimeout(() => { console.log("server exiting"); process.exit(); }, 10000);
