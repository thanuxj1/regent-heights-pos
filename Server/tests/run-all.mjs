// tests/run-all.mjs — reset -> every tNN-*.mjs in order -> teardown, with
// one combined summary at the end. Each file runs as its own `node`
// process (matching how they're meant to be run individually too), so a
// crash in one file can't corrupt another's state or leave the DB pool in
// a bad spot for the rest of the suite.
import { spawn } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
// Spawned with cwd = Server/ (not tests/) — lib.mjs's `dotenv/config` reads
// .env relative to the process's cwd, and .env lives in Server/. Running
// with cwd = tests/ silently found no .env, DATABASE_URL came back
// undefined, and `pg` fell back to a local Postgres that isn't there —
// every file died on ECONNREFUSED before writing a result.
const serverDir = path.dirname(dir);

function run(file) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join("tests", file)], { cwd: serverDir, stdio: "inherit" });
    p.on("close", (code) => resolve(code));
  });
}

async function main() {
  // Stale result files from a previous run must not be misread as this
  // run's — a file that crashes before calling finish() would otherwise
  // silently report yesterday's pass.
  await rm(path.join(dir, ".results"), { recursive: true, force: true });

  console.log("=== reset ===");
  await run("reset.mjs");

  const files = (await readdir(dir))
    .filter((f) => /^t\d+-.*\.mjs$/.test(f))
    .sort();

  if (!files.length) {
    console.log("No t*.mjs files found yet.");
  }

  const exitCodes = {};
  for (const file of files) {
    console.log(`\n=== ${file} ===`);
    exitCodes[file] = await run(file);
  }

  console.log("\n=== teardown ===");
  await run("reset.mjs");

  // Combined summary from whatever each file wrote to .results/
  console.log("\n\n========== SUMMARY ==========");
  let totalPassed = 0, totalFailed = 0;
  const resultsDir = path.join(dir, ".results");
  for (const file of files) {
    const jsonPath = path.join(resultsDir, `${file}.json`);
    try {
      const summary = JSON.parse(await readFile(jsonPath, "utf8"));
      totalPassed += summary.passed;
      totalFailed += summary.failed;
      const mark = summary.failed > 0 ? "FAIL" : "PASS";
      console.log(`${mark}  ${file}: ${summary.passed}/${summary.total}`);
    } catch {
      console.log(`????  ${file}: no result file (exit code ${exitCodes[file]} — likely crashed before finish())`);
      totalFailed += 1;
    }
  }
  console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed across ${files.length} files.`);
  console.log(`(Per-file detail kept in tests/.results/ until the next run.)`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
