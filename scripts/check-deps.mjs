import { execSync } from "node:child_process";

function check(cmd, name, hint) {
  try {
    execSync(cmd, { stdio: "ignore", timeout: 5000 });
    console.log(`  [OK] ${name}`);
    return true;
  } catch {
    console.log(`  [MISSING] ${name}`);
    if (hint) console.log(`         ${hint}`);
    return false;
  }
}

console.log("\nGhostBox dependency check\n");
console.log(`  Node.js ${process.version}`);
check("pnpm --version", "pnpm", "corepack enable pnpm");
console.log("\nRun  pnpm install && pnpm dev  to start.\n");
