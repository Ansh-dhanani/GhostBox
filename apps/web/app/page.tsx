"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import SetupView from "./setup-view";
import type { DockApp } from "@/components/ui/dock";

const TerminalView = dynamic(() => import("./terminal-view"), { ssr: false });

function wsUrl() {
  if (typeof window === "undefined") return "ws://localhost:7681";
  const port = window.location.port;
  const hostname = window.location.hostname || "localhost";
  if (port === "3000") return `ws://${hostname}:7681`;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

const LINUX_DOCK: DockApp[] = [
  {
    id: "terminal",
    name: "Terminal",
    icon: "https://cdn.jim-nielsen.com/macos/1024/terminal-2021-06-03.png?rf=1024",
    command: "clear\r",
  },
  {
    id: "files",
    name: "Files",
    icon: "https://cdn.jim-nielsen.com/macos/1024/finder-2021-09-10.png?rf=1024",
    command: "mc\r",
  },
  {
    id: "browser",
    name: "Browser",
    icon: "https://cdn.jim-nielsen.com/macos/1024/firefox-2023-05-12.png?rf=1024",
    command: "termeverything firefox 2>/dev/null; if [ $? -ne 0 ]; then lynx https://google.com; fi\r",
  },
  {
    id: "doom",
    name: "Doom",
    icon: "https://cdn.jim-nielsen.com/macos/1024/game-center-2021-06-07.png?rf=1024",
    command: "termeverything chocolate-doom -iwad /usr/share/games/doom/freedoom1.wad 2>/dev/null; if [ $? -ne 0 ]; then chocolate-doom -iwad /usr/share/games/doom/freedoom1.wad; fi\r",
  },
  {
    id: "neofetch",
    name: "Info",
    icon: "https://cdn.jim-nielsen.com/macos/1024/calculator-2021-04-29.png?rf=1024",
    command: "neofetch\r",
  },
  {
    id: "clear",
    name: "Clear",
    icon: "https://cdn.jim-nielsen.com/macos/1024/mail-2021-05-25.png?rf=1024",
    command: "clear\r",
  },
];

const WINDOWS_DOCK: DockApp[] = [
  {
    id: "terminal",
    name: "Terminal",
    icon: "https://cdn.jim-nielsen.com/macos/1024/terminal-2021-06-03.png?rf=1024",
    command: "clear\r",
  },
  {
    id: "files",
    name: "Files",
    icon: "https://cdn.jim-nielsen.com/macos/1024/finder-2021-09-10.png?rf=1024",
    command: "mc\r",
  },
  {
    id: "browser",
    name: "Browser",
    icon: "https://cdn.jim-nielsen.com/macos/1024/firefox-2023-05-12.png?rf=1024",
    command: "lynx https://google.com\r",
  },
  {
    id: "doom",
    name: "Doom",
    icon: "https://cdn.jim-nielsen.com/macos/1024/game-center-2021-06-07.png?rf=1024",
    command: "chocolate-doom\r",
  },
  {
    id: "neofetch",
    name: "Info",
    icon: "https://cdn.jim-nielsen.com/macos/1024/calculator-2021-04-29.png?rf=1024",
    command: "neofetch\r",
  },
  {
    id: "clear",
    name: "Clear",
    icon: "https://cdn.jim-nielsen.com/macos/1024/mail-2021-05-25.png?rf=1024",
    command: "clear\r",
  },
];

export default function Home() {
  const [ready, setReady] = useState(false);
  const [os, setOs] = useState("linux");
  const [logs, setLogs] = useState<string[]>([]);
  const [showConsole, setShowConsole] = useState(true);

  useEffect(() => {
    const originalLog = console.log;
    const originalError = console.error;

    const addLog = (prefix: string, ...args: any[]) => {
      const line = `[${prefix}] ${args.map(x => typeof x === "object" ? JSON.stringify(x) : String(x)).join(" ")}`;
      setLogs(prev => [...prev.slice(-30), line]);
    };

    console.log = (...args) => {
      originalLog(...args);
      addLog("Log", ...args);
    };

    console.error = (...args) => {
      originalError(...args);
      addLog("Error", ...args);
    };

    const handleError = (e: ErrorEvent) => {
      addLog("Crash", e.message, `at ${e.filename}:${e.lineno}`);
    };

    const handleRejection = (e: PromiseRejectionEvent) => {
      addLog("Unhandled Rejection", e.reason);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    console.log("Diagnostics Console Activated.");
    console.log("Client connecting target:", wsUrl());

    return () => {
      console.log = originalLog;
      console.error = originalError;
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  const currentDock = os === "win32" ? WINDOWS_DOCK : LINUX_DOCK;

  return (
    <main className="fullPage" style={{ position: "relative" }}>
      <div className="terminalWrapper" style={{ flex: 1 }}>
        {ready ? (
          <TerminalView wsUrl={wsUrl()} dockApps={currentDock} onNotReady={() => setReady(false)} />
        ) : (
          <SetupView wsUrl={wsUrl()} onReady={(serverOs) => {
            setOs(serverOs);
            setReady(true);
          }} />
        )}
      </div>

      {showConsole && (
        <div style={{
          position: "fixed",
          bottom: "100px",
          right: "20px",
          width: "480px",
          maxHeight: "300px",
          background: "rgba(10, 10, 20, 0.95)",
          border: "1px solid #7c6aff",
          boxShadow: "0 8px 32px rgba(124, 106, 255, 0.25)",
          borderRadius: "8px",
          display: "flex",
          flexDirection: "column",
          fontFamily: "'JetBrains Mono', Consolas, monospace",
          fontSize: "11px",
          color: "#e2e8f0",
          zIndex: 99999,
          overflow: "hidden"
        }}>
          <div style={{
            background: "#1c1c30",
            padding: "8px 12px",
            fontSize: "12px",
            fontWeight: "bold",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid #2f2f4c"
          }}>
            <span>💻 Client Diagnostic Panel</span>
            <button
              onClick={() => setShowConsole(false)}
              style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer" }}
            >
              [Hide]
            </button>
          </div>
          <div style={{
            padding: "10px",
            overflowY: "auto",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            maxHeight: "250px"
          }}>
            {logs.map((log, i) => {
              let color = "#e2e8f0";
              if (log.includes("[Error]")) color = "#f87171";
              if (log.includes("[Crash]")) color = "#ef4444";
              if (log.includes("[Log]")) color = "#38bdf8";
              return (
                <div key={i} style={{ color, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{log}</div>
              );
            })}
          </div>
        </div>
      )}

      {!showConsole && (
        <button
          onClick={() => setShowConsole(true)}
          style={{
            position: "fixed",
            bottom: "80px",
            right: "20px",
            padding: "6px 12px",
            background: "#7c6aff",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            fontSize: "11px",
            fontFamily: "monospace",
            zIndex: 99999,
            cursor: "pointer"
          }}
        >
          [Diagnostics]
        </button>
      )}
    </main>
  );
}
