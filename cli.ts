#!/usr/bin/env tsx
/**
 * RiverGen — CLI entry point
 *
 * Usage:
 *   rivergen init                              # Write infrastructure framework files (once)
 *   rivergen plan  <specFile>                  # Dry-run: show plan without writing
 *   rivergen gen   <specFile> [options]        # Write domain files + regenerate barrels
 *   rivergen verify                            # Run all 12 gates against the project
 *
 * Options:
 *   --force     Overwrite existing files
 *   --install   Auto-install missing required packages via pnpm
 *   --root      Project root (default: cwd)
 *
 * Examples:
 *   rivergen init
 *   rivergen plan  specs/task.json
 *   rivergen gen   specs/invoice.json --install
 *   rivergen verify
 */

import path from "node:path";
import { buildPlan, renderPlan } from "./plan";
import { execute } from "./execute";
import { runAllGates, renderReport } from "./gates/runner";
import { renderInitPlan, executeInit } from "./init";

// ─── Parse args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name: string): boolean {
  return args.includes(name);
}

function option(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

/** Positional args (non-flag, non-option-value entries) */
function positionals(): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      // skip option value if this flag takes a value
      if (a === "--root") {
        i++; // skip next arg (the value)
      }
      continue;
    }
    result.push(a);
  }
  return result;
}

const pos = positionals();
const command = pos[0]; // "gen" | "plan"
const specFile = pos[1];

const projectRoot = option("--root") ?? process.cwd();
const force = flag("--force");
const install = flag("--install");

// ─── Validate ──────────────────────────────────────────────────────────────────

if (!command || !["init", "gen", "plan", "verify"].includes(command)) {
  console.error(`
  RiverGen

  Commands:
    init                            Write infrastructure framework files (run once)
    plan    <specFile>              Dry-run: print plan without writing
    gen     <specFile> [options]    Write domain files + regenerate barrels
    verify                          Run all law gates against the project

  Options:
    --force      Overwrite existing files
    --install    Auto-install missing required packages
    --root       Project root directory (default: cwd)

  Examples:
    rivergen init
    rivergen plan  specs/task.json
    rivergen gen   specs/invoice.json --install
    rivergen verify
`);
  process.exit(1);
}

if (command !== "verify" && command !== "init" && !specFile) {
  console.error(`  Error: specFile argument is required for '${command}'.\n`);
  process.exit(1);
}

// ─── Run ───────────────────────────────────────────────────────────────────────

if (command === "verify") {
  console.log("\n  RiverGen \u2014 Running gate verification...\n");
  const report = await runAllGates(projectRoot);
  process.stdout.write(renderReport(report));
  process.exit(report.allPassed ? 0 : 1);
}

if (command === "init") {
  process.stdout.write(renderInitPlan(projectRoot));

  if (flag("--plan")) {
    // Dry-run: just show what would be created
    process.exit(0);
  }

  console.log("  Writing infrastructure framework...\n");
  const result = executeInit(projectRoot, { force });

  if (!result.ok) {
    console.error("\n  Initialisation failed:");
    for (const e of result.errors) {
      console.error(`  ✗  ${e}`);
    }
    process.exit(1);
  }

  console.log(`\n  ✓  Done. ${result.filesWritten.length} files written.\n`);
  console.log("  Next steps:");
  console.log("    1. Review the generated files and add them to your repo.");
  console.log("    2. Scaffold your first domain:");
  console.log("         rivergen gen specs/<domain>.json");
  console.log("    3. Run verification:");
  console.log("         rivergen verify");
  console.log();
  process.exit(0);
}

if (command === "plan") {
  const plan = buildPlan(specFile, projectRoot);
  process.stdout.write(renderPlan(plan));
  // Always exit 0 for plan — it's informational. Spec parse failures are the
  // only unrecoverable errors (those set plan.ok = false with no files at all).
  process.exit(
    plan.errors.some(
      (e) => e.startsWith("Spec file") || e.startsWith("Failed to parse"),
    )
      ? 1
      : 0,
  );
}

if (command === "gen") {
  console.log(`\n  RiverGen — Executing domain: ${specFile}\n`);

  // Print plan first so the user sees what's about to happen
  const plan = buildPlan(specFile, projectRoot);
  process.stdout.write(renderPlan(plan));

  const result = execute(specFile, projectRoot, { force, install });

  if (!result.ok) {
    console.error("\n  Generation failed:");
    for (const e of result.errors) {
      console.error(`  ✗  ${e}`);
    }
    process.exit(1);
  }

  console.log(`\n  ✓  Done. ${result.filesWritten.length} files written.\n`);
  if (result.applyRecordPath) {
    console.log(`  Apply record: ${result.applyRecordPath}`);
  }
  console.log(`\n  Next steps:`);
  console.log(`    1. Fill TODOs in this order:`);
  console.log(`         a. mutations.ts         → DB call + input validation`);
  console.log(`         b. schemas/<domain>.ts  → event payload fields`);
  console.log(`         c. <domain>.listener.ts → wire subscribe → broadcast`);
  console.log(`         d. use-<domain>.ts      → query key context in onMutate`);
  console.log(`         e. <domain>-projections.ts → list key context in applyEntity*()`);
  console.log(`         f. <domain>.witness.ts  → field continuity contract`);
  console.log(`    2. The 5 barrel _index.ts files were regenerated automatically.`);
  console.log(`    3. Verify all 12 gates pass:`);
  console.log(`         rivergen verify`);
  console.log();
  process.exit(0);
}
