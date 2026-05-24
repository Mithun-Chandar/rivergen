import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { buildPlan, renderPlan, type GeneratorPlan } from "./plan";
import { checkDependencies, installMissing } from "./dep-enforcer";
import { buildApplyRecord, writeApplyRecord } from "./apply-record";
import { loadConfig } from "./config";
import { regenerateBarrel, scanDomainKeys } from "./barrel";
import { renderBarrelSchemas } from "./templates/init-barrel-schemas";
import { renderBarrelDispatchers } from "./templates/init-barrel-dispatchers";
import { renderBarrelWsBindings } from "./templates/init-barrel-ws-bindings";
import { renderBarrelEntityProjections } from "./templates/init-barrel-entity-projections";
import { renderBarrelQueryKeys } from "./templates/init-barrel-query-keys";
import { registerSatelliteFiles } from "./satellite";

// ─── Execute options ────────────────────────────────────────────────────────────

export interface ExecuteOptions {
  /**
   * Overwrite existing files rather than aborting.
   * Without this flag, execute() will refuse to run if any target file exists.
   */
  force?: boolean;
  /**
   * Automatically install missing required packages via `pnpm add`
   * in the appropriate workspace before writing files.
   */
  install?: boolean;
}

// ─── Execute result ─────────────────────────────────────────────────────────────

export interface ExecuteResult {
  ok: boolean;
  filesWritten: string[];
  applyRecordPath: string | null;
  errors: string[];
}

// ─── Main executor ──────────────────────────────────────────────────────────────

/**
 * Writes all planned files to disk.
 *
 * Flow:
 *   1. Re-build + validate the plan (catches any race conditions)
 *   2. Optionally install missing deps
 *   3. Create parent directories
 *   4. Write each file (abort on first existing file unless --force)
 *   5. Print upsert previews to stdout
 *   6. Write apply record for reversibility
 */
export function execute(
  specFile: string,
  projectRoot: string,
  options: ExecuteOptions = {},
): ExecuteResult {
  const result: ExecuteResult = {
    ok: false,
    filesWritten: [],
    applyRecordPath: null,
    errors: [],
  };

  // 1. Build plan
  const plan = buildPlan(specFile, projectRoot);
  const config = loadConfig(projectRoot);

  // 2. Optionally install missing dependencies first
  if (options.install && !plan.deps.ok) {
    console.log("\n  Installing missing packages...\n");
    try {
      installMissing(projectRoot, plan.deps.missing);
    } catch (err) {
      result.errors.push(
        `Dependency install failed: ${(err as Error).message}`,
      );
      return result;
    }
    // Re-check after install
    const recheck = checkDependencies(projectRoot, config);
    if (!recheck.ok) {
      result.errors.push(
        "Dependencies still missing after install attempt:\n" +
          recheck.missing
            .map((m) => `  • [${m.workspace}] ${m.packageName}`)
            .join("\n"),
      );
      return result;
    }
  }

  // 3. Validate plan (must be ok after optional dep install)
  if (!plan.ok) {
    const blockingErrors = plan.errors.filter((e) => {
      // Dep errors are handled above by --install; skip them here
      if (e.startsWith("Missing required packages")) return false;
      // --force overrides the "files already exist" error (handled at step 4)
      if (options.force && /^\d+ file\(s\) already exist/.test(e)) return false;
      return true;
    });
    if (blockingErrors.length > 0) {
      result.errors.push(...blockingErrors);
      return result;
    }
  }

  // 4. Check for existing files (abort unless --force)
  if (!options.force) {
    const blockers = plan.filesToCreate.filter((f) => f.exists);
    if (blockers.length > 0) {
      result.errors.push(
        `Refusing to overwrite existing files. Use --force to proceed:\n` +
          blockers.map((f) => `  • ${f.filePath}`).join("\n"),
      );
      return result;
    }
  }

  // 5. Write files
  for (const planned of plan.filesToCreate) {
    const absPath = path.join(projectRoot, planned.filePath);
    try {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, planned.content, "utf-8");
      result.filesWritten.push(planned.filePath);
      console.log(`  ✓  ${planned.filePath}`);
    } catch (err) {
      result.errors.push(
        `Failed to write ${planned.filePath}: ${(err as Error).message}`,
      );
      return result;
    }
  }

  // 6. Regenerate barrels (atomic rewrite — includes the new domain key)
  console.log("\n  Regenerating barrels...\n");
  try {
    const absSchemaDir = path.join(projectRoot, config.api.schemasDir);
    const absDispatchersDir = path.join(projectRoot, config.web.dispatchersDir);
    const absWsBindingsDir = path.join(projectRoot, config.web.wsBindingsDir);
    const absQueryKeysDir = path.join(projectRoot, config.web.queryKeysDir);
    const absEntityProjectionsDir = path.join(
      projectRoot,
      config.packages.entityProjectionsDir,
    );

    regenerateBarrel(
      absSchemaDir,
      path.join(projectRoot, config.api.schemasBarrelFile),
      renderBarrelSchemas,
    );
    console.log(`  ✓  ${config.api.schemasBarrelFile}`);

    regenerateBarrel(
      absDispatchersDir,
      path.join(projectRoot, config.web.dispatchersBarrelFile),
      renderBarrelDispatchers,
    );
    console.log(`  ✓  ${config.web.dispatchersBarrelFile}`);

    regenerateBarrel(
      absWsBindingsDir,
      path.join(projectRoot, config.web.wsBindingsBarrelFile),
      renderBarrelWsBindings,
    );
    console.log(`  ✓  ${config.web.wsBindingsBarrelFile}`);

    regenerateBarrel(
      absQueryKeysDir,
      path.join(projectRoot, config.web.queryKeysBarrelFile),
      renderBarrelQueryKeys,
    );
    console.log(`  ✓  ${config.web.queryKeysBarrelFile}`);

    regenerateBarrel(
      absEntityProjectionsDir,
      path.join(projectRoot, config.packages.entityProjectionsBarrelFile),
      renderBarrelEntityProjections,
    );
    console.log(`  ✓  ${config.packages.entityProjectionsBarrelFile}\n`);
  } catch (err) {
    result.errors.push(`Barrel regeneration failed: ${(err as Error).message}`);
    return result;
  }

  // 7. Register satellite files (event-entity-map, ws-event-cache-audit, phase5)
  // Only shown when files actually exist in the project and were updated.
  try {
    const satelliteFiles = registerSatelliteFiles(projectRoot, plan.names);
    if (satelliteFiles.length > 0) {
      console.log("  Updating satellite files...\n");
      for (const sf of satelliteFiles) {
        console.log(`  ✓  ${sf}`);
      }
      console.log("");
    }
  } catch (err) {
    console.warn(
      `  ⚠  Satellite registration warning: ${(err as Error).message}`,
    );
  }

  // 8. Write apply record
  try {
    const record = buildApplyRecord(plan.names, specFile, result.filesWritten);
    result.applyRecordPath = writeApplyRecord(
      projectRoot,
      config.applyRecordsDir,
      record,
    );
    console.log(`  ✓  Apply record: ${result.applyRecordPath}\n`);
  } catch (err) {
    // Non-fatal: log warning but don't abort
    console.warn(
      `  ⚠  Could not write apply record: ${(err as Error).message}`,
    );
  }

  result.ok = result.errors.length === 0;
  return result;
}
