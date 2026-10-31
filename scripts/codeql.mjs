import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(projectRoot, ".github", "codeql", "codeql-config.yml");
const outputDirectory = path.join(projectRoot, ".codeql");
const codeqlExecutable = process.env.CODEQL_CLI || "codeql";
const languages = ["javascript-typescript", "actions"];

function runCodeQL(args) {
  const result = spawnSync(codeqlExecutable, args, {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(
      `Unable to run the CodeQL CLI (${codeqlExecutable}). Install the CodeQL CLI and add it to PATH, or set CODEQL_CLI to its executable path.\n${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    throw new Error(`CodeQL exited with status ${result.status ?? "unknown"}.`);
  }
}

await mkdir(outputDirectory, { recursive: true });
const databaseRoot = await mkdtemp(path.join(outputDirectory, ".database-"));

try {
  runCodeQL(["version"]);

  for (const language of languages) {
    const databasePath = path.join(databaseRoot, language);
    const sarifPath = path.join(outputDirectory, `${language}.sarif`);
    const createArgs = [
      "database",
      "create",
      databasePath,
      `--language=${language}`,
      `--source-root=${projectRoot}`,
      `--codescanning-config=${configPath}`,
    ];

    if (language === "javascript-typescript") {
      createArgs.push("--build-mode=none");
    }

    await unlink(sarifPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });

    runCodeQL(createArgs);
    runCodeQL([
      "database",
      "analyze",
      databasePath,
      "--format=sarif-latest",
      `--output=${sarifPath}`,
    ]);
    console.log(`CodeQL results written to ${path.relative(projectRoot, sarifPath)}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(databaseRoot, { recursive: true, force: true });
}
