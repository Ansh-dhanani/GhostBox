"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface ToolDef {
  id: string;
  name: string;
  desc: string;
  installed: boolean;
}

const STATUS_ICON: Record<string, string> = {
  idle: "○",
  queued: "◷",
  installing: "⋯",
  done: "✓",
  fail: "✗",
};

interface EnvInfo {
  os: string;
  arch: string;
  pms?: string[];
}

export default function SetupView({ wsUrl, onReady }: { wsUrl: string; onReady: (os: string) => void }) {
  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [installStates, setInstallStates] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [queue, setQueue] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [connFailed, setConnFailed] = useState(false);
  const [tryCount, setTryCount] = useState(0);
  const [selectedPm, setSelectedPm] = useState<string>("winget");
  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef(0);
  const doneRef = useRef(false);
  // Pre-detect OS client-side so Skip works correctly before server env message arrives
  const osRef = useRef(
    typeof navigator !== "undefined" && /win/i.test(navigator.platform) ? "win32" : "linux"
  );

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout>;

    function connect() {
      if (doneRef.current) return;
      if (ws) { try { ws.close(); } catch { } }

      setTryCount(prev => prev + 1);
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("Setup WS connection opened successfully.");
        retryRef.current = 0;
        setConnected(true);
        setConnFailed(false);
      };

      ws.onmessage = (e) => {
        if (doneRef.current) return;
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "env") {
            osRef.current = msg.os;
            setEnv({ os: msg.os, arch: msg.arch, pms: msg.pms });
            if (msg.pms && msg.pms.length > 0) {
              // Select the first detected PM by default
              setSelectedPm(msg.pms[0]);
            }
          }
          if (msg.type === "tool-status") { setTools(msg.tools); }
          if (msg.type === "install-queue") setQueue(msg.tools);
          if (msg.type === "install-begin") {
            setInstallStates((s) => ({ ...s, [msg.tool]: "installing" }));
          }
          if (msg.type === "install-output") {
            setLogs((prev) => {
              const cur = prev[msg.tool] || [];
              const lines = (msg.data as string).split("\n").filter((l: string) => l.trim());
              if (lines.length === 0) return prev;
              return { ...prev, [msg.tool]: [...cur, ...lines] };
            });
          }
          if (msg.type === "install-done") {
            setInstallStates((s) => ({ ...s, [msg.tool]: msg.success ? "done" : "fail" }));
          }
          if (msg.type === "ready") {
            doneRef.current = true;
            try { ws?.close(); } catch { }
            onReady(osRef.current);
          }
        } catch { }
      };

      ws.onerror = (e) => {
        console.error("Setup WS encountered an error:", e);
      };

      ws.onclose = (event) => {
        console.log(`Setup WS closed. Code: ${event.code}, Clean: ${event.wasClean}, Reason: ${event.reason}`);
        if (doneRef.current) return;
        setConnected(false);

        if (retryRef.current < 50) {
          retryRef.current++;
          const delay = Math.min(1000 + retryRef.current * 200, 4000);
          console.log(`Scheduling setup WS reconnect in ${delay}ms...`);
          timer = setTimeout(connect, delay);
        } else {
          setConnFailed(true);
        }
      };
    }

    connect();

    return () => {
      doneRef.current = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(msg)); } catch { }
    }
  }, []);

  const installOne = useCallback((id: string) => {
    send({ type: "install", tool: id, pm: selectedPm });
  }, [send, selectedPm]);

  const installAll = useCallback(() => {
    send({ type: "install-all", pm: selectedPm });
  }, [send, selectedPm]);

  const missing = tools.filter((t) => !t.installed);
  const allInstalled = missing.length === 0;
  const installing = Object.values(installStates).includes("installing");
  const isWindows = env?.os === "win32";
  const detectedPms = env?.pms || [];
  const hasNoPm = isWindows && detectedPms.length === 0;

  return (
    <div className="setupPage">
      <div className="setupCard">
        <header className="setupHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1>Ghostbox <span className="dim">Setup</span></h1>
          {env && (
            <span className="envBadge">
              {isWindows ? "Windows" : env.os === "darwin" ? "macOS" : "Linux"}
              {" · "}{env.arch}
            </span>
          )}
        </header>

        {connected && tools.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Package Manager Selection for Windows */}
            {isWindows && (
              <div style={{
                background: "rgba(124, 106, 255, 0.05)",
                border: "1px solid rgba(124, 106, 255, 0.2)",
                borderRadius: "8px",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px"
              }}>
                <label style={{ fontSize: "12px", color: "var(--muted)", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Selected Package Manager
                </label>

                {hasNoPm ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ color: "#f87171", fontSize: "13px", lineHeight: "1.5" }}>
                      ⚠️ <strong>No Package Manager Detected.</strong> We couldn't find winget, scoop, or choco on your Windows system PATH.
                    </div>
                    <div style={{ background: "#0b0b14", border: "1px solid #1a1a2e", padding: "12px", borderRadius: "6px" }}>
                      <p style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "8px", lineHeight: "1.4" }}>
                        It's recommended to install <strong>Scoop</strong> (very fast, doesn't require administrator access). Run this command in a new PowerShell window:
                      </p>
                      <code style={{ display: "block", color: "#a78bfa", fontSize: "11px", wordBreak: "break-all", background: "#161622", padding: "8px", borderRadius: "4px", border: "1px solid #28283d", fontFamily: "monospace" }}>
                        iwr -useb get.scoop.sh | iex
                      </code>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {detectedPms.map((pmName) => {
                      const isActive = selectedPm === pmName;
                      return (
                        <button
                          key={pmName}
                          onClick={() => setSelectedPm(pmName)}
                          disabled={installing}
                          style={{
                            padding: "8px 16px",
                            borderRadius: "6px",
                            border: isActive ? "1px solid #7c6aff" : "1px solid #2f2f3c",
                            background: isActive ? "#7c6aff" : "transparent",
                            color: isActive ? "#fff" : "#94a3b8",
                            fontSize: "13px",
                            fontFamily: "monospace",
                            fontWeight: 600,
                            cursor: installing ? "not-allowed" : "pointer",
                            transition: "all 0.2s ease"
                          }}
                        >
                          {pmName === "portable" ? "Portable (Zero-Install)" : pmName}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="toolGrid">
              {tools.map((t) => {
                const st = t.installed ? "done" : installStates[t.id] || "idle";
                return (
                  <div key={t.id} className={`toolCard ${st}`}>
                    <div className="toolCardTop">
                      <span className={`toolIcon ${st}`}>{STATUS_ICON[st]}</span>
                      <div className="toolInfo">
                        <span className="toolName">{t.name}</span>
                        <span className="toolDesc">{t.desc}</span>
                      </div>
                      {!t.installed && st === "idle" && (
                        <button className="toolInstallBtn" onClick={() => installOne(t.id)} disabled={installing || hasNoPm}>
                          Install
                        </button>
                      )}
                      {st === "installing" && <span className="toolStatus installing">Installing…</span>}
                      {st === "done" && <span className="toolStatus done">{t.installed ? "Installed" : "Skipped"}</span>}
                      {st === "fail" && <span className="toolStatus fail">Failed</span>}
                    </div>
                    {logs[t.id] && logs[t.id].length > 0 && (
                      <div className="toolLog">
                        {logs[t.id].map((line, i) => (
                          <div key={i} className="logLine">{line}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(!connected || connFailed) && (
          <div style={{
            background: "#161622",
            border: "1px solid #2f2f3c",
            borderRadius: "8px",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "12px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--accent)" }}>
              <span className="spinner" />
              <span style={{ fontWeight: 500 }}>Connecting to terminal server (Attempt {tryCount})</span>
            </div>

            <div style={{ fontSize: "13px", color: "var(--muted)", display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid #252535", paddingTop: "12px" }}>
              <div>
                <strong>Target WS URL:</strong> <span style={{ fontFamily: "monospace", color: "#e2e8f0" }}>{wsUrl}</span>
              </div>
              <div style={{ lineHeight: "1.5", color: "#94a3b8" }}>
                ⚠️ <strong>Connection is failing.</strong> This happens because the Next.js UI is running but the terminal backend on port 7681 is not.
              </div>
              <div style={{ lineHeight: "1.5", background: "#0b0b14", padding: "10px", borderRadius: "4px", color: "#fca5a5" }}>
                <strong>Fix:</strong> Make sure you run <code style={{ color: "#fff", background: "#333", padding: "2px 4px", borderRadius: "3px" }}>pnpm dev</code> inside the <strong>root project folder</strong> (<code style={{ color: "#fff" }}>c:\Users\Ansh\Desktop\web\Ghostbox</code>), and <strong>NOT</strong> inside <code style={{ color: "#fff" }}>apps/web</code>.
              </div>
            </div>
          </div>
        )}

        {connected && !allInstalled && !installing && (
          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            <button className="installAllBtn" onClick={installAll} disabled={missing.length === 0 || hasNoPm} style={{ flex: 1, padding: "14px", borderRadius: "8px" }}>
              Install All ({missing.length})
            </button>
            <button
              onClick={() => {
                doneRef.current = true;
                wsRef.current?.close();
                onReady(osRef.current);
              }}
              style={{
                flexShrink: 0,
                padding: "14px 20px",
                borderRadius: "8px",
                border: "1px solid #2f2f3c",
                background: "transparent",
                color: "#94a3b8",
                cursor: "pointer",
                fontWeight: 600,
                transition: "all 0.2s ease"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#fff";
                e.currentTarget.style.borderColor = "#4e4e5e";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#94a3b8";
                e.currentTarget.style.borderColor = "#2f2f3c";
              }}
            >
              Skip Setup
            </button>
          </div>
        )}

        {connected && installing && (
          <div className="installingBar">
            <span className="spinner" />
            Installing… {queue.length > 0 && `${queue.length} remaining`}
          </div>
        )}

        {connected && allInstalled && !installing && (
          <div className="allDone">
            <span className="doneIcon">✓</span> All tools are ready
          </div>
        )}

        <div ref={logEndRef} />
      </div>
    </div>
  );
}
