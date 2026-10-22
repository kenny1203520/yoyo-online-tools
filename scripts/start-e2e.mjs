import { cp, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const standalone = join(process.cwd(), ".next", "standalone");
await mkdir(join(standalone, ".next"), { recursive: true });
await cp(join(process.cwd(), ".next", "static"), join(standalone, ".next", "static"), { recursive: true, force: true });
await cp(join(process.cwd(), "public"), join(standalone, "public"), { recursive: true, force: true });

const server = spawn(process.execPath, [join(standalone, "server.js")], {
  cwd: standalone,
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: "3100" },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
