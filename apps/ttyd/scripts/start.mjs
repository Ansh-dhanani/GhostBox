import { execSync } from "node:child_process";
import { platform } from "node:os";

const os = platform();

if (os === "win32") {
  console.log("[ttyd] Windows detected — starting PowerShell terminal on :7681");
  execSync("ttyd -W -i 127.0.0.1 -p 7681 powershell.exe -NoLogo", { stdio: "inherit" });
} else if (os === "linux") {
  console.log("[ttyd] Linux detected — starting tmux session on :7681");
  execSync("ttyd -W -i 127.0.0.1 -p 7681 tmux new -A -s terminal", { stdio: "inherit" });
} else if (os === "darwin") {
  console.log("[ttyd] macOS detected — starting bash on :7681");
  execSync("ttyd -W -i 127.0.0.1 -p 7681 bash -l", { stdio: "inherit" });
} else {
  console.error(`[ttyd] Unsupported platform: ${os}`);
  process.exit(1);
}
