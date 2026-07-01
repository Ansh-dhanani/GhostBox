import { spawn, exec } from "node:child_process";
import { WebSocketServer } from "ws";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const LOG_FILE = join(ROOT, "ghostbox-dev.log");
const BIN_DIR = join(ROOT, ".bin");

// Ensure .bin directory exists
if (!fs.existsSync(BIN_DIR)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}

function log(msg) {
  const line = `[PTS] ${new Date().toISOString()} - ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

let pty = null;
try {
  pty = (await import("node-pty")).default;
  log("node-pty loaded successfully.");
} catch (e) {
  log(`[Warning] node-pty failed to load. Falling back to native child_process.spawn: ${e.message}`);
  console.warn(
    "\x1b[33m[Warning] node-pty failed to load. Falling back to native child_process.spawn.\n" +
    "Interactive apps (like doom or midnight commander) might not render correctly without node-pty built on this machine.\x1b[0m"
  );
}

const isWin = process.platform === "win32";
const shell = isWin ? "powershell.exe" : process.env.SHELL || "bash";

// Append portable and standard shims folders to path dynamically
if (isWin) {
  const userProfile = process.env.USERPROFILE || "";
  const progData = process.env.ProgramData || "C:\\ProgramData";
  const localApp = process.env.LOCALAPPDATA || "";

  const additionalPaths = [
    BIN_DIR,
    join(userProfile, "scoop", "shims"),
    join(progData, "chocolatey", "bin"),
    join(localApp, "Microsoft", "WindowsApps")
  ].filter(p => fs.existsSync(p));

  if (additionalPaths.length > 0) {
    const sep = ";";
    process.env.PATH = `${process.env.PATH}${sep}${additionalPaths.join(sep)}`;
    log(`Appended PATH directories: ${additionalPaths.join(", ")}`);
  }
} else {
  const home = process.env.HOME || "";
  const additionalPaths = [
    BIN_DIR,
    join(home, "go", "bin"),
    "/usr/local/go/bin"
  ].filter(p => fs.existsSync(p));

  if (additionalPaths.length > 0) {
    const sep = ":";
    process.env.PATH = `${process.env.PATH}${sep}${additionalPaths.join(sep)}`;
    log(`Appended PATH directories: ${additionalPaths.join(", ")}`);
  }
}

function getBinPath(bin) {
  if (!isWin) return bin;
  return new Promise((resolve) => {
    // Check if it exists in local portable .bin folder first
    const localExe = join(BIN_DIR, `${bin}.exe`);
    const localCmd = join(BIN_DIR, `${bin}.cmd`);
    if (fs.existsSync(localExe)) return resolve(localExe);
    if (fs.existsSync(localCmd)) return resolve(localCmd);

    exec(`where ${bin}`, (err, stdout) => {
      if (!err && stdout.trim()) {
        const lines = stdout.split("\r\n").map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) return resolve(lines[0]);
      }

      if (bin === "scoop") {
        const userProfile = process.env.USERPROFILE || "";
        const pathCmd = join(userProfile, "scoop", "shims", "scoop.cmd");
        const pathPs1 = join(userProfile, "scoop", "shims", "scoop.ps1");
        if (fs.existsSync(pathCmd)) return resolve(pathCmd);
        if (fs.existsSync(pathPs1)) return resolve(pathPs1);
      }

      if (bin === "choco") {
        const progData = process.env.ProgramData || "C:\\ProgramData";
        const pathExe = join(progData, "chocolatey", "bin", "choco.exe");
        if (fs.existsSync(pathExe)) return resolve(pathExe);
      }

      if (bin === "winget") {
        const localApp = process.env.LOCALAPPDATA || "";
        const pathExe = join(localApp, "Microsoft", "WindowsApps", "winget.exe");
        if (fs.existsSync(pathExe)) return resolve(pathExe);
      }

      resolve(bin);
    });
  });
}

async function which(bin) {
  if (isWin) {
    // Check in local BIN_DIR directly for aliases
    const hasLocal = fs.existsSync(join(BIN_DIR, `${bin}.exe`)) ||
      fs.existsSync(join(BIN_DIR, `${bin}.cmd`)) ||
      fs.existsSync(join(BIN_DIR, `${bin}.ps1`));
    if (hasLocal) return true;

    const resolved = await getBinPath(bin);
    if (resolved !== bin) return true;

    return new Promise((resolve) => {
      exec(`where ${bin}`, (err) => resolve(!err));
    });
  }

  return new Promise((resolve) => {
    exec(`command -v ${bin}`, (err) => resolve(!err));
  });
}

function run(cmd, onData) {
  return new Promise((resolve, reject) => {
    const [prog, args] = isWin
      ? ["cmd", ["/c", cmd]]
      : ["sh", ["-c", cmd]];
    const proc = spawn(prog, args, { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (d) => onData(d.toString()));
    proc.stderr.on("data", (d) => onData(d.toString()));
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Exit code ${code}`)),
    );
    proc.on("error", reject);
  });
}

function safeSend(ws, msg) {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  } catch (e) {
    log(`safeSend error: ${e.message}`);
  }
}

const PM_INSTALLERS = {
  winget: {
    neofetch: "winget install -e --id dylanaraps.neofetch --accept-source-agreements --accept-package-agreements",
    mc: "winget install -e --id gokcehan.lf --accept-source-agreements --accept-package-agreements",
    lynx: "winget install -e --id Lynx.Lynx --accept-source-agreements --accept-package-agreements",
    "chocolate-doom": "winget install -e --id ChocolateDoom.ChocolateDoom --accept-source-agreements --accept-package-agreements"
  },
  scoop: {
    neofetch: "scoop install neofetch",
    mc: "scoop install lf",
    lynx: "scoop install lynx",
    // chocolate-doom lives in the 'games' bucket
    "chocolate-doom": "scoop bucket add games 2>nul & scoop install games/chocolate-doom"
  },
  choco: {
    neofetch: "choco install neofetch -y",
    mc: "choco install lf -y",
    lynx: "choco install lynx -y",
    "chocolate-doom": "choco install chocolate-doom -y"
  }
};

async function downloadFile(url, destPath, onData) {
  onData(`Downloading from direct link to local storage...\n`);
  const { get: httpsGet } = await import("node:https");
  const { get: httpGet } = await import("node:http");

  const doGet = (u, redirects = 0) => new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error("Too many redirects"));
    const client = u.startsWith("https") ? httpsGet : httpGet;
    const req = client(u, { headers: { "User-Agent": "Mozilla/5.0 Ghostbox/1.0" } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        const loc = res.headers.location;
        doGet(loc.startsWith("/") ? new URL(u).origin + loc : loc, redirects + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume(); return reject(new Error(`HTTP Status ${res.statusCode}`));
      }
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        fs.writeFileSync(destPath, buf);
        onData(`Download complete (${Math.round(buf.length / 1024)} KB).\n`);
        resolve();
      });
      res.on("error", reject);
    });
    req.on("error", reject);
  });

  try {
    await doGet(url);
  } catch (e) {
    onData(`Download failed: ${e.message}\n`);
    throw e;
  }
}

// Recursively find an executable by name within a directory tree.
function findExe(dir, name) {
  if (!fs.existsSync(dir)) return null;
  const lname = name.toLowerCase();
  for (const item of fs.readdirSync(dir)) {
    const p = join(dir, item);
    try {
      if (item.toLowerCase() === lname) return p;
      if (fs.statSync(p).isDirectory()) {
        const found = findExe(p, name);
        if (found) return found;
      }
    } catch (e) { /* skip locked */ }
  }
  return null;
}

const TOOLS = isWin ? [
  {
    id: "neofetch",
    name: "Neofetch",
    desc: "System information display utility",
    check: () => which("neofetch") && fs.existsSync(join(BIN_DIR, "winfetch.ps1")),
    install: async (s, pm) => {
      if (pm === "portable") {
        const ps1 = join(BIN_DIR, "winfetch.ps1");
        if (fs.existsSync(ps1)) {
          s("Already downloaded — syncing wrapper...\n");
        } else {
          await downloadFile("https://raw.githubusercontent.com/lptstr/winfetch/master/winfetch.ps1", ps1, s);
        }
        fs.writeFileSync(join(BIN_DIR, "neofetch.cmd"), `@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0winfetch.ps1" %*\r\n`);
        s("Done!\n");
      } else {
        const cmd = PM_INSTALLERS[pm]?.neofetch;
        if (!cmd) throw new Error(`Selected package manager ${pm} has no configured installation script.`);
        await run(cmd, s);
      }
    },
  },
  {
    id: "mc",
    name: "Midnight Commander (lf)",
    desc: "Terminal-based interactive file manager",
    check: async () => (await which("mc")) || (await which("lf")),
    install: async (s, pm) => {
      if (pm === "portable") {
        const lfExe = join(BIN_DIR, "lf.exe");
        if (fs.existsSync(lfExe)) {
          s("Already downloaded — syncing wrapper...\n");
        } else {
          const lfZip = join(BIN_DIR, "lf.zip");
          await downloadFile("https://github.com/gokcehan/lf/releases/download/r32/lf-windows-amd64.zip", lfZip, s);
          s("Extracting files...\n");
          const lfTmp = join(BIN_DIR, "_lf_tmp");
          await run(`powershell -Command "Expand-Archive -Path '${lfZip}' -DestinationPath '${lfTmp}' -Force"`, s);
          try { fs.unlinkSync(lfZip); } catch (e) { }
          // findExe handles any nested zip structure
          const foundLf = findExe(lfTmp, "lf.exe");
          if (!foundLf) throw new Error("lf.exe not found in downloaded archive.");
          fs.copyFileSync(foundLf, lfExe);
          try { fs.rmSync(lfTmp, { recursive: true, force: true }); } catch (e) { }
        }
        fs.writeFileSync(join(BIN_DIR, "mc.cmd"), `@echo off\r\n"%~dp0lf.exe" %*\r\n`);
        s("Done!\n");
      } else {
        const cmd = PM_INSTALLERS[pm]?.mc;
        if (!cmd) throw new Error(`Selected package manager ${pm} has no configured installation script.`);
        await run(cmd, s);
        // Write an mc→lf shim so the Dock 'mc' command always works
        fs.writeFileSync(join(BIN_DIR, "mc.cmd"), `@echo off\r\nlf %*\r\n`);
      }
    },
  },
  {
    id: "lynx",
    name: "Lynx",
    desc: "Terminal text-based web browser",
    check: async () => {
      // Check if our wrapper cmd exists AND the exe it points to actually works
      const cmdPath = join(BIN_DIR, "lynx.cmd");
      if (!fs.existsSync(cmdPath)) return false;
      return !!(await which("lynx"));
    },
    install: async (s, pm) => {
      if (pm === "portable") {
        const lynxDir = join(BIN_DIR, "lynx-dir");
        const candidates = [
          join(lynxDir, "App", "Lynx", "lynx.exe"),
          join(lynxDir, "App", "lynx", "lynx.exe"),
          join(lynxDir, "lynx.exe")
        ];
        // Also check if scoop already installed lynx
        const scoopLynx = join(process.env.USERPROFILE || "", "scoop", "apps", "lynx", "current", "lynx.exe");
        if (fs.existsSync(scoopLynx)) {
          s("Found scoop-installed Lynx — using it...\n");
          fs.writeFileSync(join(BIN_DIR, "lynx.cmd"), `@echo off\r\n"${scoopLynx}" %*\r\n`);
          s("Done!\n");
          return;
        }
        let lynxExe = candidates.find(p => fs.existsSync(p));
        if (lynxExe) {
          s("Already downloaded — syncing wrapper...\n");
        } else {
          // Download PortableApps NSIS-packed Lynx installer (self-extracting, no UAC)
          const lynxSetup = join(BIN_DIR, "lynx-setup.exe");
          await downloadFile(
            "https://downloads.sourceforge.net/project/portableapps/Lynx%20Portable/LynxPortable_2.9.2.paf.exe",
            lynxSetup, s
          );
          s("Installing portable Lynx...\n");
          if (!fs.existsSync(lynxDir)) fs.mkdirSync(lynxDir, { recursive: true });
          // Spawn NSIS installer directly (avoids cmd.exe double-quote escaping)
          await new Promise((res, rej) => {
            const p = spawn(lynxSetup, ["/S", `/D=${lynxDir}`], { stdio: "ignore" });
            p.on("close", c => c === 0 ? res() : rej(new Error(`NSIS exit ${c}`)));
            p.on("error", rej);
          });
          try { fs.unlinkSync(lynxSetup); } catch (e) { }
          lynxExe = candidates.find(p => fs.existsSync(p));
          if (!lynxExe) throw new Error(`Could not locate lynx.exe after extraction. Checked: ${candidates.join(", ")}`);
        }
        fs.writeFileSync(join(BIN_DIR, "lynx.cmd"), `@echo off\r\n"${lynxExe}" %*\r\n`);
        s("Done!\n");
      } else {
        const cmd = PM_INSTALLERS[pm]?.lynx;
        if (!cmd) throw new Error(`Selected package manager ${pm} has no configured installation script.`);
        await run(cmd, s);
        // After PM install, also write a lynx.cmd that points to scoop's binary
        const scoopLynx = join(process.env.USERPROFILE || "", "scoop", "apps", "lynx", "current", "lynx.exe");
        if (fs.existsSync(scoopLynx)) {
          fs.writeFileSync(join(BIN_DIR, "lynx.cmd"), `@echo off\r\n"${scoopLynx}" %*\r\n`);
        }
      }
    },
  },
  {
    id: "chocolate-doom",
    name: "Chocolate Doom",
    desc: "Classic Doom engine + download Doom1 WAD",
    check: async () => {
      const hasDoom = await which("chocolate-doom");
      if (!hasDoom) return false;
      const localWad = join(BIN_DIR, "chocolate-doom", "doom1.wad");
      const userWad = join(process.env.USERPROFILE || "", "doom1.wad");
      // Also check common scoop install path
      const scoopWad = join(process.env.USERPROFILE || "", "scoop", "apps", "chocolate-doom", "current", "doom1.wad");
      return fs.existsSync(localWad) || fs.existsSync(userWad) || fs.existsSync(scoopWad);
    },
    install: async (s, pm) => {
      if (pm === "portable") {
        const doomDir = join(BIN_DIR, "chocolate-doom");
        const doomExe = join(doomDir, "chocolate-doom.exe");
        if (fs.existsSync(doomExe)) {
          s("Engine already downloaded — checking WAD...\n");
        } else {
          const doomZip = join(BIN_DIR, "doom.zip");
          await downloadFile("https://github.com/chocolate-doom/chocolate-doom/releases/download/chocolate-doom-3.0.0/chocolate-doom-3.0.0-win32.zip", doomZip, s);
          s("Extracting files...\n");
          const doomTmp = join(BIN_DIR, "_doom_tmp");
          await run(`powershell -Command "Expand-Archive -Path '${doomZip}' -DestinationPath '${doomTmp}' -Force"`, s);
          try { fs.unlinkSync(doomZip); } catch (e) { }
          // findExe handles any nested folder structure in the zip
          const foundDoom = findExe(doomTmp, "chocolate-doom.exe");
          if (!foundDoom) {
            let tree = "";
            try {
              const walk = d => fs.readdirSync(d).map(i => fs.statSync(join(d, i)).isDirectory() ? walk(join(d, i)) : i).flat();
              tree = walk(doomTmp).join(", ");
            } catch (e) { }
            throw new Error(`chocolate-doom.exe not found. Contents: ${tree}`);
          }
          const foundDoomParent = dirname(foundDoom);
          if (!fs.existsSync(doomDir)) fs.mkdirSync(doomDir, { recursive: true });
          for (const f of fs.readdirSync(foundDoomParent)) {
            try { fs.renameSync(join(foundDoomParent, f), join(doomDir, f)); } catch (e) { }
          }
          try { fs.rmSync(doomTmp, { recursive: true, force: true }); } catch (e) { }
        }
        const wadPath = join(doomDir, "doom1.wad");
        if (fs.existsSync(wadPath)) {
          s("WAD already present — syncing wrapper...\n");
        } else {
          s("Downloading Shareware WAD (4MB)...\n");
          await downloadFile("https://distro.ibiblio.org/slitaz/sources/packages/d/doom1.wad", wadPath, s);
        }
        fs.writeFileSync(join(BIN_DIR, "chocolate-doom.cmd"), `@echo off\r\n"%~dp0chocolate-doom\\chocolate-doom.exe" -iwad "%~dp0chocolate-doom\\doom1.wad" %*\r\n`);
        s("Done!\n");
      } else {
        const cmd = PM_INSTALLERS[pm]?.["chocolate-doom"];
        if (!cmd) throw new Error(`Selected package manager ${pm} has no configured installation script.`);
        s(`Installing Chocolate Doom via ${pm}...\n`);
        await run(cmd, s);
        s("Downloading DOOM Shareware WAD file (4MB)...\n");
        const wadPath = join(process.env.USERPROFILE || "", "doom1.wad");
        await downloadFile("https://distro.ibiblio.org/slitaz/sources/packages/d/doom1.wad", wadPath, s);
      }
    },
  }
] : [
  {
    id: "build-essential",
    name: "Build Tools",
    desc: "C/C++ compiler toolchain (needed for native npm modules)",
    check: () => which("gcc"),
    install: (s) => run("sudo env DEBIAN_FRONTEND=noninteractive apt-get update -y && sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential", s),
  },
  {
    id: "go",
    name: "Go",
    desc: "Go programming language (needed for term.everything)",
    check: () => which("go"),
    install: (s) => run("sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y golang-go", s),
  },
  {
    id: "git",
    name: "Git",
    desc: "Version control system",
    check: () => which("git"),
    install: (s) => run("sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y git", s),
  },
  {
    id: "neofetch",
    name: "Neofetch",
    desc: "System information display",
    check: () => which("neofetch"),
    install: (s) => run("sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y neofetch", s),
  },
  {
    id: "lynx",
    name: "Lynx",
    desc: "Terminal web browser",
    check: () => which("lynx"),
    install: (s) => run("sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y lynx", s),
  },
  {
    id: "btop",
    name: "Btop",
    desc: "Resource monitor (modern htop alternative)",
    check: () => which("btop"),
    install: (s) => run("sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y btop", s),
  },
  {
    id: "mc",
    name: "Midnight Commander",
    desc: "Terminal file manager (useful for browsing files)",
    check: () => which("mc"),
    install: (s) => run("sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y mc", s),
  },
  {
    id: "firefox",
    name: "Firefox",
    desc: "Web browser (runs via term.everything in the terminal)",
    check: () => which("firefox"),
    install: (s) => run("sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y firefox", s),
  },
  {
    id: "chocolate-doom",
    name: "Chocolate Doom",
    desc: "Classic Doom engine (plays Doom in the terminal via term.everything)",
    check: () => which("chocolate-doom"),
    install: (s) => run("sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y chocolate-doom", s),
  },
  {
    id: "freedoom",
    name: "FreeDoom",
    desc: "Free Doom game data (needed to play Doom)",
    check: () => which("freedoom1"),
    install: (s) => run("sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y freedoom", s),
  },
  {
    id: "termeverything",
    name: "term.everything",
    desc: "Desktop-in-terminal compositor — run any GUI app in the terminal",
    check: async () => (await which("term.everything")) || (await which("termeverything")),
    install: async (s) => {
      s("Installing term.everything via Go (⌛ this can take 2-3 minutes)...\n");
      await run("go install github.com/mmulet/term.everything@latest", s);
      const goBin = `${process.env.HOME || "/root"}/go/bin`;
      const installed = ["term.everything", "termeverything"].some(name => {
        const p = `${goBin}/${name}`;
        if (fs.existsSync(p)) {
          try { fs.renameSync(p, "/usr/local/bin/termeverything"); } catch (e) {}
          return true;
        }
        return false;
      });
      // also check current PATH
      if (!installed) {
        for (const name of ["term.everything", "termeverything"]) {
          try {
            const { stdout } = await new Promise((res, rej) => {
              exec(`command -v ${name}`, (err, stdout) => err ? rej(err) : res({ stdout: stdout.trim() }));
            });
            if (stdout) { s(`Found ${name} at ${stdout}\n`); break; }
          } catch (e) {}
        }
      }
    },
    needs: ["go"],
  },
];

function checkAllTools() {
  return Promise.all(TOOLS.map(async (t) => ({ id: t.id, installed: await t.check() })));
}

async function installTool(toolDef, ws, pm) {
  if (!toolDef.install) return;
  log(`Installing tool: ${toolDef.id} using package manager: ${pm || "default"}`);
  safeSend(ws, { type: "install-begin", tool: toolDef.id });
  try {
    await toolDef.install((data) => {
      safeSend(ws, { type: "install-output", tool: toolDef.id, data });
    }, pm);
    const stillGood = await toolDef.check();
    log(`Tool install status of ${toolDef.id}: ${stillGood ? "success" : "failed"}`);
    safeSend(ws, { type: "install-done", tool: toolDef.id, success: stillGood });
  } catch (e) {
    log(`Tool install error for ${toolDef.id}: ${e.message}`);
    safeSend(ws, { type: "install-done", tool: toolDef.id, success: false, error: e.message });
  }
}

function setupWebSocket(wss) {
  wss.on("connection", (ws, req) => {
    log(`New client WebSocket connection. Source: ${req ? req.socket.remoteAddress : "unknown"}`);
    let state = "setup";
    let term = null;
    let closed = false;

    const send = (msg) => safeSend(ws, msg);

    function done() {
      if (closed) return;
      closed = true;
      log("Closing client session.");
      try { if (term) term.kill(); } catch (e) { }
      try { ws.close(); } catch (e) { }
    }

    // Determine package managers available, always append "portable" as the lightweight option
    const checkPMs = async () => {
      const pms = ["portable"];
      if (isWin) {
        if (await which("winget")) pms.push("winget");
        if (await which("scoop")) pms.push("scoop");
        if (await which("choco")) pms.push("choco");
      } else {
        if (await which("apt")) pms.push("apt");
        if (await which("brew")) pms.push("brew");
      }
      return pms;
    };

    checkPMs().then((pms) => {
      if (closed) return;
      send({ type: "env", os: process.platform, arch: process.arch, pms });
    });

    checkAllTools().then((results) => {
      if (closed) return;
      const tools = TOOLS.map((t) => ({
        id: t.id,
        name: t.name,
        desc: t.desc,
        installed: results.find((r) => r.id === t.id).installed,
      }));
      log(`Tool checks complete. Count: ${tools.length}. Ready to emit.`);
      send({ type: "tool-status", tools });
      if (tools.every((t) => t.installed)) {
        log("All tools ready. Autostarting terminal PTY.");
        startTerminal();
      }
    });

    function startTerminal() {
      if (closed) return;
      state = "terminal";
      log(`Starting shell: ${shell} (PTY: ${!!pty})`);

      try {
        if (pty) {
          term = pty.spawn(shell, [], {
            name: "xterm-256color",
            cols: 80,
            rows: 24,
            cwd: process.cwd(),
            env: { ...process.env, TERM: "xterm-256color" },
          });
        } else {
          term = spawn(shell, [], {
            cwd: process.cwd(),
            env: { ...process.env, TERM: "xterm-256color" },
            shell: true,
          });
        }
      } catch (e) {
        log(`Failed to spawn terminal process: ${e.message}`);
        send({ type: "output", data: `\r\nFailed to start execution process: ${e.message}\r\n` });
        return;
      }

      send({ type: "ready" });

      if (pty) {
        term.onData((data) => {
          if (!closed) send({ type: "output", data });
        });
        term.onExit((res) => {
          log(`PTY exit code: ${res ? res.exitCode : "unknown"}`);
          done();
        });
      } else {
        term.stdout.on("data", (data) => {
          if (!closed) send({ type: "output", data: data.toString() });
        });
        term.stderr.on("data", (data) => {
          if (!closed) send({ type: "output", data: data.toString() });
        });
        term.on("exit", (code) => {
          log(`Native process exit code: ${code}`);
          done();
        });
      }
    }

    function handleSetup(msg) {
      log(`Setup message received: ${msg.type}`);
      const pm = msg.pm || "portable";
      if (msg.type === "install") {
        const def = TOOLS.find((t) => t.id === msg.tool);
        if (def) installTool(def, ws, pm);
      }
      if (msg.type === "install-all") {
        (async () => {
          for (const def of TOOLS) {
            if (closed) return;
            const installed = await def.check();
            if (!installed) await installTool(def, ws, pm);
          }
          if (closed) return;
          const results = await checkAllTools();
          send({
            type: "tool-status",
            tools: TOOLS.map((t) => ({
              id: t.id,
              name: t.name,
              desc: t.desc,
              installed: results.find((r) => r.id === t.id).installed,
            })),
          });
          if (results.every((r) => r.installed)) startTerminal();
        })();
      }
      if (msg.type === "retry-check") {
        checkAllTools().then((results) => {
          if (closed) return;
          send({
            type: "tool-status",
            tools: TOOLS.map((t) => ({
              ...t,
              installed: results.find((r) => r.id === t.id).installed,
            })),
          });
          if (results.every((r) => r.installed)) startTerminal();
        });
      }
    }

    ws.on("message", (msg) => {
      if (closed) return;
      try {
        const p = JSON.parse(String(msg));
        if (state === "setup") {
          handleSetup(p);
          if (p.type === "resize") {
            log("Starting terminal (tools are optional).");
            startTerminal();
            if (pty && term) {
              term.resize(p.cols, p.rows);
            }
          }
        } else if (state === "terminal") {
          if (p.type === "input") {
            if (pty) {
              term.write(p.data);
            } else {
              term.stdin.write(p.data);
            }
          }
          if (p.type === "resize" && pty) {
            term.resize(p.cols, p.rows);
          }
        }
      } catch (e) {
        log(`WebSocket message parse error: ${e.message}`);
      }
    });

    ws.on("close", () => {
      log("WebSocket closed by client.");
      done();
    });
    ws.on("error", (e) => {
      log(`WebSocket error: ${e.message}`);
      done();
    });
  });
}

export { setupWebSocket, isWin, shell, BIN_DIR };
