#!/usr/bin/env node
/**
 * RiverGen CLI shim — compiled JS entry point.
 *
 * Bootstraps tsx from the package's own node_modules so that `rivergen`
 * works after a global install (`npm install -g @rivergen/cli`) without
 * requiring tsx to be separately installed globally.
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// One level up from bin/ → package root
const pkgRoot = resolve(__dirname, "..");

// tsx candidates: package-own first, then PATH fallback
const tsxCandidates = [
  join(pkgRoot, "node_modules", "tsx", "dist", "cli.mjs"),
  join(pkgRoot, "node_modules", ".bin", "tsx"),
];

let tsx = "tsx"; // PATH fallback
for (const c of tsxCandidates) {
  if (existsSync(c)) {
    tsx = c;
    break;
  }
}

const cli = join(pkgRoot, "cli.ts");

const result = spawnSync(
  // When tsx is the .mjs entry, run it via the current node binary
  tsx.endsWith(".mjs") ? process.execPath : tsx,
  tsx.endsWith(".mjs") ? [tsx, cli, ...process.argv.slice(2)] : [cli, ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);

process.exit(result.status ?? 0);
