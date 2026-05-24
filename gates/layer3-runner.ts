/**
 * Layer 3 — Projection proof runner (subprocess bridge).
 *
 * Spawns layer3-worker.ts in a child process to dynamically import witness
 * files and call lifecycle() / signals{}. The subprocess isolation prevents
 * ESM module cycle errors that occur when importing web-app modules from the
 * gate runner's module graph. It also contains React-heavy import failures
 * so they don't crash the main verifier process.
 *
 * The worker outputs a single JSON object (Layer3BatchResult) to stdout.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GateViolation } from "./types";

const workerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "layer3-worker.ts",
);

/**
 * Resolves the tsx CLI binary from the project's node_modules.
 * tsx handles CJS/ESM interop for TypeScript files in non-ESM packages
 * (like Next.js apps that lack "type": "module") more cleanly than
 * node --import tsx/esm, which can trigger ERR_REQUIRE_CYCLE_MODULE.
 */
function resolveTsxBin(projectRoot: string): string {
  // Try project root → workspace root → global tsx
  // The generator lives at <sodium-root>/tools/generator-v2/gates/,
  // so 3 levels up from this file always reaches the sodium-v2 workspace root.
  const generatorWorkspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );

  const candidates = [
    // Generator's own workspace root (most reliable — tsx is always here)
    path.join(generatorWorkspaceRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    // Target project root (if target project has its own tsx)
    path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    // One level above target project root (monorepo root)
    path.join(projectRoot, "..", "node_modules", "tsx", "dist", "cli.mjs"),
  ];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(resolved)) return resolved;
  }

  // Fallback: tsx on PATH (npx tsx resolves it)
  return "tsx";
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Layer3BatchResult {
  violations: GateViolation[];
  activeFiles: number;
  skippedFiles: number;
  importFailedFiles: number;
  totalAssertions: number;
  passedAssertions: number;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runLayer3(
  projectRoot: string,
  witnessFiles: string[],
): Promise<Layer3BatchResult> {
  if (witnessFiles.length === 0) {
    return {
      violations: [],
      activeFiles: 0,
      skippedFiles: 0,
      importFailedFiles: 0,
      totalAssertions: 0,
      passedAssertions: 0,
    };
  }

  const tsxBin = resolveTsxBin(projectRoot);

  // Build arg list: workerPath projectRoot witnessFile1 witnessFile2 ...
  // Shell-quote each arg to handle spaces and Windows backslashes.
  const shellArgs = [
    `"${workerPath}"`,
    `"${projectRoot}"`,
    ...witnessFiles.map((f) => `"${f}"`),
  ].join(" ");

  // Use tsx CLI (not node --import tsx/esm): tsx handles CJS/ESM interop
  // for TypeScript files in CJS packages (Next.js apps) without triggering
  // ERR_REQUIRE_CYCLE_MODULE in Node v22.
  const cmd = tsxBin.endsWith(".mjs")
    ? `node "${tsxBin}" ${shellArgs}`
    : `"${tsxBin}" ${shellArgs}`;

  // Extend NODE_PATH to include the generator workspace's node_modules.
  // This allows witness lifecycle() functions to import transitive deps
  // (e.g. @rivergen/shared, @tanstack/react-query) that live in the generator
  // workspace but may not be installed in the target project's node_modules.
  const generatorWorkspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  const generatorNodeModules = path.join(generatorWorkspaceRoot, "node_modules");
  const nodePath = process.env["NODE_PATH"]
    ? `${generatorNodeModules}${path.delimiter}${process.env["NODE_PATH"]}`
    : generatorNodeModules;

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 30_000,
      // Suppress any stderr noise from the worker (e.g. tsx warnings)
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_PATH: nodePath },
    });

    const result = JSON.parse(output.trim()) as Layer3BatchResult;
    return result;
  } catch (err: unknown) {
    // Worker process failed entirely (non-zero exit, parse error, timeout).
    // Report as a single warning rather than crashing the gate.
    const detail =
      err instanceof Error ? err.message.split("\n")[0] : String(err);

    return {
      violations: [
        {
          file: "tools/generator-v2/gates/layer3-worker.ts",
          message: `Layer 3 runner failed to execute: ${detail}`,
          severity: "warning",
        },
      ],
      activeFiles: 0,
      skippedFiles: witnessFiles.length,
      importFailedFiles: 0,
      totalAssertions: 0,
      passedAssertions: 0,
    };
  }
}
