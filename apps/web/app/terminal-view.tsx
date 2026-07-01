"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import "@xterm/xterm/css/xterm.css";
import "@xterm/addon-image/lib/addon-image.css";
import { MacOSDock, type DockApp } from "@/components/ui/dock";

interface ResizeMsg { type: "resize"; cols: number; rows: number; }
interface InputMsg { type: "input"; data: string; }

function sendJSON(ws: WebSocket, msg: ResizeMsg | InputMsg) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(msg)); } catch { }
  }
}

export default function TerminalView({ wsUrl, dockApps, onNotReady }: { wsUrl: string; dockApps: DockApp[]; onNotReady: () => void }) {
  const elRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const cmdMap = useRef<Map<string, string>>(new Map());
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    cmdMap.current = new Map(dockApps.map((a) => [a.id, a.command]));
  }, [dockApps]);

  useEffect(() => {
    let alive = true;
    let raf1: number;
    let ro: ResizeObserver | null = null;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout>;
    let initTimer: ReturnType<typeof setTimeout>;
    let retryCount = 0;
    const MAX_RETRIES = 20;

    function mount() {
      if (!alive) return;
      const el = elRef.current;
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) {
        raf1 = requestAnimationFrame(mount);
        return;
      }

      const t = new Terminal({
        cols: 80, rows: 24,
        scrollback: 10000,
        cursorBlink: true,
        cursorStyle: "block",
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
        fontWeight: "400",
        lineHeight: 1.2,
        theme: {
          background: "#080810",
          foreground: "#e2e8f0",
          cursor: "#7c6aff",
          cursorAccent: "#080810",
          selectionBackground: "rgba(124, 106, 255, 0.25)",
          black: "#1a1a2e", red: "#f87171",
          green: "#34d399", yellow: "#fbbf24",
          blue: "#60a5fa", magenta: "#c084fc",
          cyan: "#22d3ee", white: "#e2e8f0",
          brightBlack: "#4a4a6a", brightRed: "#fca5a5",
          brightGreen: "#6ee7b7", brightYellow: "#fde68a",
          brightBlue: "#93c5fd", brightMagenta: "#d8b4fe",
          brightCyan: "#67e8f9", brightWhite: "#f1f5f9",
        },
      });

      const f = new FitAddon();
      t.loadAddon(f);

      const img = new ImageAddon();
      t.loadAddon(img);

      try { t.open(el); }
      catch {
        if (!alive) return;
        t.dispose();
        raf1 = requestAnimationFrame(mount);
        return;
      }

      termRef.current = t;
      fitRef.current = f;

      // Single fit + connect after layout settles
      initTimer = setTimeout(() => {
        if (!alive) return;
        try { f.fit(); } catch { }
        connectWS();
      }, 50);

      ro = new ResizeObserver(() => {
        if (!alive) return;
        try { f.fit(); } catch { }
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          sendJSON(wsRef.current, { type: "resize", cols: t.cols, rows: t.rows });
        }
      });
      ro.observe(el);

      t.onData((data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          sendJSON(wsRef.current, { type: "input", data });
        }
      });

      t.onResize(({ cols, rows }) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          sendJSON(wsRef.current, { type: "resize", cols, rows });
        }
      });

      function connectWS() {
        if (!alive) return;
        console.log("TerminalView: connecting to", wsUrl);
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (!alive) { ws!.close(); return; }
          console.log("TerminalView: WS open");
          retryCount = 0;
          t.focus();
          wsRef.current = ws;
          sendJSON(ws!, { type: "resize", cols: t.cols, rows: t.rows });
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            // Only render output; ignore setup-phase messages (env, tool-status, ready)
            if (msg.type === "output") {
              try { t.write(msg.data); } catch { }
            }
          } catch { }
        };

        ws.onclose = (ev) => {
          console.log("TerminalView: WS closed", ev.code, ev.reason);
          wsRef.current = null;
          if (!alive) return;
          if (retryCount >= MAX_RETRIES) {
            try { t.write("\r\n\x1b[31mConnection lost. Refresh the page to reconnect.\x1b[0m\r\n"); } catch { }
            return;
          }
          const delay = Math.min(500 * Math.pow(1.5, retryCount), 10000);
          retryCount++;
          try { t.write(`\r\n\x1b[33mDisconnected. Reconnecting in ${Math.round(delay / 1000)}s\u2026\x1b[0m\r\n`); } catch { }
          retryTimer = setTimeout(connectWS, delay);
        };

        ws.onerror = () => { };
      }
    }

    mount();

    return () => {
      alive = false;
      cancelAnimationFrame(raf1);
      clearTimeout(initTimer);
      clearTimeout(retryTimer);
      ro?.disconnect();
      wsRef.current = null;
      if (ws) try { ws.close(); } catch { }
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [wsUrl]);

  function handleAppClick(id: string) {
    const cmd = cmdMap.current.get(id);
    const ws = wsRef.current;
    if (!cmd || !ws || ws.readyState !== WebSocket.OPEN) return;
    sendJSON(ws, { type: "input", data: cmd });
  }

  return (
    <>
      <div ref={elRef} className="terminalRoot" />
      <div className="dockWrapper">
        <MacOSDock apps={dockApps} onAppClick={handleAppClick} />
      </div>
    </>
  );
}
