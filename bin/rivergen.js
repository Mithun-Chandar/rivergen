#!/usr/bin/env node
/**
 * RiverGen CLI shim — compiled JS entry point.
 *
 * Bootstraps tsx so that `rivergen` works after a global or local install
 * without requiring tsx to be separately installed by the user.
 *
 * tsx is a declared dependency of @rivergen/cli. npm may hoist it to the
 * project root's node_modules rather than keeping it inside the package's
 * own node_modules. This shim walks up the directory tree from the package
 * root until it finds tsx, matching npm's resolution algorithm.
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// One level up from bin/ → package root
const pkgRoot = join(__dirname, "..");

/**
 * Walk up the directory tree from startDir looking for
 * node_modules/tsx/dist/cli.mjs — mirrors npm's hoisting resolution.
 */
function findTsx(startDir) {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, "node_modules", "tsx", "dist", "cli.mjs");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null; // filesystem root reached
    dir = parent;
  }
}

const tsx = findTsx(pkgRoot);

if (!tsx) {
  process.stderr.write(
    "[rivergen] Cannot find tsx. It should be installed automatically as a " +
    "dependency of @rivergen/cli. Try:\n" +
    "  npm install @rivergen/cli@latest\n" +
    "If the problem persists, install tsx globally: npm install -g tsx\n"
  );
  process.exit(1);
}

const cli = join(pkgRoot, "cli.ts");

const result = spawnSync(
  process.execPath,
  [tsx, cli, ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);

if (result.error) {
  process.stderr.write("[rivergen] Failed to start: " + result.error.message + "\n");
  process.exit(1);
}

process.exit(result.status ?? 1);
