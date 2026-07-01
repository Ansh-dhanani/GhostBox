#!/bin/bash
set -e
exec > /var/log/ghostbox-setup.log 2>&1
echo "=== GhostBox setup started at $(date) ==="

# ── 1. SWAP (1GB RAM is tight — 2GB swap as safety net) ─────────────────────
echo ">>> Setting up swap..."
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# ── 2. SYSTEM PACKAGES ───────────────────────────────────────────────────────
echo ">>> Installing packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y \
  xfce4 xfce4-goodies tightvncserver novnc websockify \
  nginx tmux curl jq libfuse2 dbus-x11 xfonts-base firefox \
  nodejs golang-go git build-essential pkg-config \
  neofetch lynx btop mc chocolate-doom freedoom

# Install latest Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Install pnpm
corepack enable
corepack prepare pnpm@latest --activate

# ── 3. VNC SERVER SETUP ──────────────────────────────────────────────────────
echo ">>> Configuring VNC..."
mkdir -p /home/ubuntu/.vnc
echo "${vnc_password}" | vncpasswd -f > /home/ubuntu/.vnc/passwd
chmod 600 /home/ubuntu/.vnc/passwd
chown -R ubuntu:ubuntu /home/ubuntu/.vnc

cat > /home/ubuntu/.vnc/xstartup << 'XSTARTUP'
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
exec startxfce4
XSTARTUP
chmod +x /home/ubuntu/.vnc/xstartup
chown ubuntu:ubuntu /home/ubuntu/.vnc/xstartup

# ── 4. GHOSTBOX APPLICATION ─────────────────────────────────────────────────
echo ">>> Deploying GhostBox application..."
mkdir -p /opt/ghostbox/scripts /opt/ghostbox/web

# Create minimal package.json for the server
cat > /opt/ghostbox/package.json << 'PKGJSON'
{
  "name": "ghostbox",
  "private": true,
  "dependencies": {
    "ws": "^8.18.0",
    "node-pty": "^1.1.0"
  }
}
PKGJSON

# Install dependencies
cd /opt/ghostbox
npm install --omit=dev 2>&1 || npm install ws 2>&1

# Download or create server.mjs (WebSocket terminal server)
cat > /opt/ghostbox/scripts/server.mjs << 'SERVEOF'
import { createServer } from "node:http";
import { setupWebSocket } from "./terminal-server.mjs";
import { WebSocketServer } from "ws";

const PORT = parseInt(process.env.TERM_PORT || "7681", 10);
const server = createServer();
const wss = new WebSocketServer({ server });
setupWebSocket(wss);
server.listen(PORT, "127.0.0.1", () => {
  console.log(`GhostBox terminal server listening on port ${PORT}`);
});
SERVEOF

# Create the core terminal server script
cat > /opt/ghostbox/scripts/terminal-server.mjs << 'TERMSRVEOF'
import { spawn, exec } from "node:child_process";
import { WebSocketServer } from "ws";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const LOG_FILE = "/var/log/ghostbox-terminal.log";
const BIN_DIR = join(ROOT, ".bin");

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
  log(`[Warning] node-pty failed to load: ${e.message}`);
}

const isWin = process.platform === "win32";
const shell = isWin ? "powershell.exe" : process.env.SHELL || "bash";

// Append standard paths
if (!isWin) {
  const home = process.env.HOME || "";
  const additionalPaths = [
    BIN_DIR,
    join(home, "go", "bin"),
    "/usr/local/go/bin",
    "/usr/local/bin"
  ].filter(p => fs.existsSync(p));

  if (additionalPaths.length > 0) {
    const sep = ":";
    process.env.PATH = `${process.env.PATH}${sep}${additionalPaths.join(sep)}`;
    log(`Appended PATH directories: ${additionalPaths.join(", ")}`);
  }
}

function run(cmd, onData) {
  return new Promise((resolve, reject) => {
    const proc = spawn("sh", ["-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
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

const TOOLS = [
  { id: "neofetch", name: "Neofetch", desc: "System information display", check: () => exec("command -v neofetch", () => {}) },
  { id: "lynx", name: "Lynx", desc: "Terminal web browser", check: () => exec("command -v lynx", () => {}) },
  { id: "btop", name: "Btop", desc: "Resource monitor", check: () => exec("command -v btop", () => {}) },
  { id: "mc", name: "Midnight Commander", desc: "Terminal file manager", check: () => exec("command -v mc", () => {}) },
  { id: "chocolate-doom", name: "Chocolate Doom", desc: "Classic Doom engine", check: () => exec("command -v chocolate-doom", () => {}) },
  { id: "termeverything", name: "term.everything", desc: "Desktop-in-terminal compositor", check: () => exec("command -v termeverything", () => {}) || exec("command -v term.everything", () => {}) },
];

// Tool installation stubs
for (const t of TOOLS) {
  t.install = async (s) => { s(`Tool ${t.name} should be pre-installed on this system.\n`); };
}

function checkAllTools() {
  return Promise.all(TOOLS.map(t => new Promise(res => {
    exec(`command -v ${t.id === "termeverything" ? "termeverything" : t.id}`, (err) => {
      res({ id: t.id, installed: !err });
    });
  })));
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
      try { if (term) term.kill(); } catch (e) {}
      try { ws.close(); } catch (e) {}
    }

    send({ type: "env", os: process.platform, arch: process.arch, pms: ["apt"] });

    checkAllTools().then((results) => {
      if (closed) return;
      send({ type: "tool-status", tools: TOOLS.map((t) => ({
        id: t.id, name: t.name, desc: t.desc,
        installed: results.find((r) => r.id === t.id).installed,
      }))});
      if (results.every((r) => r.installed)) startTerminal();
    });

    function startTerminal() {
      if (closed) return;
      state = "terminal";
      log(`Starting shell: ${shell}`);

      try {
        if (pty) {
          term = pty.spawn(shell, [], {
            name: "xterm-256color", cols: 80, rows: 24,
            cwd: process.cwd(), env: { ...process.env, TERM: "xterm-256color" },
          });
        } else {
          term = spawn(shell, [], { cwd: process.cwd(), env: { ...process.env, TERM: "xterm-256color" }, shell: true });
        }
      } catch (e) {
        send({ type: "output", data: `\r\nFailed to start: ${e.message}\r\n` });
        return;
      }

      send({ type: "ready" });

      if (pty) {
        term.onData((data) => { if (!closed) send({ type: "output", data }); });
      } else {
        term.stdout.on("data", (data) => { if (!closed) send({ type: "output", data: data.toString() }); });
        term.stderr.on("data", (data) => { if (!closed) send({ type: "output", data: data.toString() }); });
      }
    }

    function handleSetup(msg) {
      if (msg.type === "install" || msg.type === "install-all") {
        checkAllTools().then((results) => {
          send({ type: "tool-status", tools: TOOLS.map((t) => ({
            id: t.id, name: t.name, desc: t.desc,
            installed: results.find((r) => r.id === t.id).installed,
          }))});
          if (results.every((r) => r.installed)) startTerminal();
        });
      }
      if (msg.type === "retry-check") {
        checkAllTools().then((results) => {
          send({ type: "tool-status", tools: TOOLS.map((t) => ({ ...t, installed: results.find((r) => r.id === t.id).installed })) });
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
          if (p.type === "resize") { startTerminal(); }
        } else if (state === "terminal") {
          if (p.type === "input") {
            if (pty) { term.write(p.data); } else { term.stdin.write(p.data); }
          }
          if (p.type === "resize" && pty) { term.resize(p.cols, p.rows); }
        }
      } catch (e) {}
    });

    ws.on("close", () => done());
    ws.on("error", () => done());
  });
}

export { setupWebSocket, isWin, shell, BIN_DIR };
TERMSRVEOF

# Create a static landing page as fallback
cat > /opt/ghostbox/web/index.html << 'LANDING'
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>GhostBox</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { height:100vh; display:flex; flex-direction:column; background:#0a0a0f; font-family:'SF Mono',monospace; color:#e2e8f0; }
  .status { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1rem; }
  h1 { color:#7c3aed; font-size:1.5rem; letter-spacing:0.15em; }
  p { color:#64748b; font-size:0.85rem; }
  .loader { width:24px; height:24px; border:2px solid #1e1e2e; border-top-color:#7c3aed; border-radius:50%; animation:spin 1s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
</style></head>
<body><div class="status"><h1>GHOSTBOX</h1><p>your machine, anywhere</p><div class="loader"></div><p style="font-size:0.7rem;color:#3b3b5c;">Connecting to terminal server...</p></div>
<script>
  (async function() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + '/ws');
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(rej, 5000); });
    const term = new (await import('https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/lib/xterm.mjs')).Terminal();
    const fit = new (await import('https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.11.0/lib/addon-fit.mjs')).FitAddon();
    term.loadAddon(fit);
    term.open(document.body);
    fit.fit();
    ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type === 'output') term.write(m.data); } catch {} };
    term.onData(d => ws.send(JSON.stringify({type:'input',data:d})));
    new ResizeObserver(() => { try { fit.fit(); ws.send(JSON.stringify({type:'resize',cols:term.cols,rows:term.rows})); } catch {} }).observe(document.body);
  })();
</script></body>
</html>
LANDING
echo "GhostBox server deployed at /opt/ghostbox."

# ── 5. term.everything ───────────────────────────────────────────────────────
echo ">>> Installing term.everything..."
# Install via Go (consistent with Ghostbox tooling)
export GOPATH=/home/ubuntu/go
export PATH=$PATH:/usr/local/go/bin:$GOPATH/bin
su - ubuntu -c "export GOPATH=/home/ubuntu/go && export PATH=\$PATH:/usr/local/go/bin:\$GOPATH/bin && go install github.com/mmulet/term.everything@latest" 2>&1 || true

# Create a convenient symlink
if [ -f "/home/ubuntu/go/bin/term.everything" ]; then
  ln -sf /home/ubuntu/go/bin/term.everything /usr/local/bin/termeverything
  echo "term.everything installed via Go."
elif [ -f "/home/ubuntu/go/bin/termeverything" ]; then
  ln -sf /home/ubuntu/go/bin/termeverything /usr/local/bin/termeverything
  echo "term.everything installed via Go."
else
  # AppImage fallback
  echo "Go install failed, trying AppImage..."
  TE_URL=$(curl -s https://api.github.com/repos/mmulet/term.everything/releases/latest \
    | jq -r '.assets[] | select(.name | test("AppImage$|^term.everything")) | .browser_download_url' | head -n1)
  if [ -n "$TE_URL" ]; then
    curl -L "$TE_URL" -o /usr/local/bin/termeverything 2>/dev/null || \
    curl -L "$TE_URL" -o /tmp/te-appimage && chmod +x /tmp/te-appimage && cp /tmp/te-appimage /usr/local/bin/termeverything
    chmod +x /usr/local/bin/termeverything 2>/dev/null || true
    echo "term.everything installed via AppImage."
  else
    echo "WARNING: Could not install term.everything."
  fi
fi

# ── 6. HTTPS CERTS (self-signed) ──────────────────────────────────────────────
echo ">>> Generating self-signed SSL certificate..."
mkdir -p /etc/ghostbox/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ghostbox/ssl/key.pem \
  -out /etc/ghostbox/ssl/cert.pem \
  -subj "/CN=ghostbox.local" 2>/dev/null

# ── 7. AUTH SERVER ───────────────────────────────────────────────────────────
echo ">>> Setting up auth server..."
SESSION_SECRET=$(openssl rand -hex 32)
mkdir -p /etc/ghostbox
cat > /etc/ghostbox/config << CONF
LOGIN_USER="${login_user}"
LOGIN_PASSWORD="${login_password}"
SESSION_SECRET="$SESSION_SECRET"
CONF
chmod 600 /etc/ghostbox/config

mkdir -p /opt/ghostbox-auth
cat > /opt/ghostbox-auth/server.js << 'AUTHEOF'
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const cfg = fs.readFileSync('/etc/ghostbox/config', 'utf8')
  .split('\n')
  .reduce((acc, line) => {
    const [k, ...v] = line.split('=');
    if (k) acc[k.trim()] = v.join('=').replace(/^"|"$/g, '').trim();
    return acc;
  }, {});
const { LOGIN_USER, LOGIN_PASSWORD, SESSION_SECRET } = cfg;

function makeToken(user) {
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = `${user}:${expires}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}
function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [user, expires, sig] = decoded.split(':');
    if (Date.now() > parseInt(expires)) return false;
    const expected = crypto.createHmac('sha256', SESSION_SECRET)
      .update(`${user}:${expires}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}
function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, pair) => {
    const [k, ...v] = pair.trim().split('=');
    if (k) acc[k.trim()] = v.join('=').trim();
    return acc;
  }, {});
}

const authServer = http.createServer((req, res) => {
  const cookies = parseCookies(req.headers['cookie']);
  if (cookies.ghostbox_session && verifyToken(cookies.ghostbox_session)) {
    res.writeHead(200);
  } else {
    res.writeHead(401);
  }
  res.end();
});
authServer.listen(8081, '127.0.0.1');

const loginServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/do-login') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const user = params.get('username');
      const pass = params.get('password');
      if (user === LOGIN_USER && pass === LOGIN_PASSWORD) {
        const token = makeToken(user);
        res.writeHead(302, {
          'Set-Cookie': `ghostbox_session=${token}; HttpOnly; Path=/; Max-Age=${7*24*3600}`,
          'Location': '/'
        });
      } else {
        res.writeHead(302, { 'Location': '/login?error=1' });
      }
      res.end();
    });
  } else if (req.url === '/logout') {
    res.writeHead(302, {
      'Set-Cookie': 'ghostbox_session=; HttpOnly; Path=/; Max-Age=0',
      'Location': '/login'
    });
    res.end();
  } else {
    res.writeHead(404);
    res.end();
  }
});
loginServer.listen(8082, '127.0.0.1');
console.log('GhostBox auth server running on 8081 (check) and 8082 (login handler)');
AUTHEOF

# ── 8. SYSTEMD SERVICES ──────────────────────────────────────────────────────
echo ">>> Creating systemd services..."

# GhostBox terminal server
cat > /etc/systemd/system/ghostbox.service << 'EOF'
[Unit]
Description=GhostBox Terminal Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/ghostbox
ExecStart=/usr/bin/node /opt/ghostbox/scripts/server.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=TERM_PORT=7681

[Install]
WantedBy=multi-user.target
EOF

# VNC service
cat > /etc/systemd/system/vncserver.service << 'EOF'
[Unit]
Description=VNC Server for GhostBox desktop
After=network.target

[Service]
Type=forking
User=ubuntu
WorkingDirectory=/home/ubuntu
ExecStartPre=-/usr/bin/vncserver -kill :1
ExecStart=/usr/bin/vncserver :1 -geometry 1280x720 -depth 24 -localhost
ExecStop=/usr/bin/vncserver -kill :1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# noVNC service
cat > /etc/systemd/system/novnc.service << 'EOF'
[Unit]
Description=noVNC WebSocket proxy for GhostBox
After=vncserver.service
Requires=vncserver.service

[Service]
Type=simple
User=ubuntu
ExecStart=/usr/share/novnc/utils/novnc_proxy --vnc localhost:5901 --listen localhost:6080
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Auth server
cat > /etc/systemd/system/ghostbox-auth.service << 'EOF'
[Unit]
Description=GhostBox auth server
After=network.target

[Service]
Type=simple
User=ubuntu
ExecStart=/usr/bin/node /opt/ghostbox-auth/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# ── 9. LOGIN PAGE HTML ────────────────────────────────────────────────────────
echo ">>> Creating web pages..."
mkdir -p /var/www/ghostbox

cat > /var/www/ghostbox/login.html << 'LOGINEOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GhostBox - Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #0a0a0f; font-family: 'SF Mono', 'Fira Code', monospace; color: #e2e8f0;
    }
    .card {
      background: #111118; border: 1px solid #1e1e2e; border-radius: 12px;
      padding: 2.5rem; width: 100%; max-width: 380px;
    }
    .logo { text-align: center; margin-bottom: 2rem; }
    .logo h1 { font-size: 1.5rem; letter-spacing: 0.1em; color: #7c3aed; }
    .logo p { font-size: 0.75rem; color: #64748b; margin-top: 0.25rem; }
    label { display: block; font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; margin-bottom: 0.4rem; }
    input {
      width: 100%; background: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 6px;
      padding: 0.65rem 0.85rem; color: #e2e8f0; font-family: inherit; font-size: 0.9rem;
      margin-bottom: 1.2rem; outline: none; transition: border-color 0.15s;
    }
    input:focus { border-color: #7c3aed; }
    button {
      width: 100%; background: #7c3aed; border: none; border-radius: 6px;
      padding: 0.75rem; color: white; font-family: inherit; font-size: 0.9rem;
      letter-spacing: 0.05em; cursor: pointer; transition: background 0.15s;
    }
    button:hover { background: #6d28d9; }
    .error {
      background: #1a0a0a; border: 1px solid #7f1d1d; border-radius: 6px;
      padding: 0.6rem 0.85rem; font-size: 0.8rem; color: #fca5a5;
      margin-bottom: 1.2rem; display: none;
    }
    .error.show { display: block; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <h1>GHOSTBOX</h1>
      <p>your machine, anywhere</p>
    </div>
    <div class="error" id="err">Invalid credentials. Try again.</div>
    <form method="POST" action="/do-login">
      <label>Username</label>
      <input type="text" name="username" autocomplete="username" autofocus>
      <label>Password</label>
      <input type="password" name="password" autocomplete="current-password">
      <button type="submit">Access →</button>
    </form>
  </div>
  <script>
    if (window.location.search.includes('error=1')) {
      document.getElementById('err').classList.add('show');
    }
  </script>
</body>
</html>
LOGINEOF

# ── 10. NGINX CONFIG ─────────────────────────────────────────────────────────
echo ">>> Configuring Nginx..."

cat > /etc/nginx/sites-available/ghostbox << 'NGINXEOF'
# HTTP — redirect to HTTPS
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name _;

    ssl_certificate     /etc/ghostbox/ssl/cert.pem;
    ssl_certificate_key /etc/ghostbox/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Login page — public
    location = /login {
        root /var/www/ghostbox;
        try_files /login.html =404;
    }

    # Login POST handler
    location = /do-login {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Content-Type $content_type;
    }

    # Logout
    location = /logout {
        proxy_pass http://127.0.0.1:8082;
    }

    # Auth subrequest endpoint (internal)
    location = /_auth {
        internal;
        proxy_pass http://127.0.0.1:8081;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI $request_uri;
    }

    # GhostBox Next.js static app — auth protected
    location / {
        auth_request /_auth;
        error_page 401 = @login_redirect;

        root /opt/ghostbox/web;
        try_files $uri $uri/ $uri.html /index.html =404;
    }

    # WebSocket terminal endpoint — auth protected
    location /ws {
        auth_request /_auth;
        error_page 401 = @login_redirect;

        proxy_pass http://127.0.0.1:7681;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # noVNC desktop — auth protected
    location /desktop/ {
        auth_request /_auth;
        error_page 401 = @login_redirect;

        proxy_pass http://127.0.0.1:6080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    location @login_redirect {
        return 302 /login;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/ghostbox /etc/nginx/sites-enabled/ghostbox
rm -f /etc/nginx/sites-enabled/default

# ── 11. ENABLE AND START EVERYTHING ─────────────────────────────────────────
echo ">>> Enabling services..."
systemctl daemon-reload
systemctl enable ghostbox vncserver novnc ghostbox-auth nginx
systemctl start ghostbox-auth
systemctl start ghostbox
systemctl start vncserver
systemctl start novnc
systemctl restart nginx

PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "unknown")
echo "=== GhostBox setup complete at $(date) ==="
echo "Open https://$PUBLIC_IP in your browser"
echo "Login with: ${login_user} / ${login_password}"
