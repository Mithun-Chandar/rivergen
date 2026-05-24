import fs from "node:fs";
import path from "node:path";
import type { DomainNames } from "./naming";

// ─── Apply record shape ────────────────────────────────────────────────────────

export interface ApplyRecord {
  /** ISO timestamp of the generation run. */
  timestamp: string;
  /** Domain key this record belongs to. */
  domainKey: string;
  /** Every file created (new) in this run. */
  filesCreated: string[];
  /**
   * Every shared file that needs upsert entries added.
   * Phase 1: these are not written automatically — they are previewed.
   * Phase 2 inject mode will write them and track them here.
   */
  upsertTargets: string[];
  /** Generator version that produced this record. */
  generatorVersion: string;
  /** The spec file path that was used. */
  specFile: string;
}

export const GENERATOR_VERSION = "2.0.0-phase1";

// ─── Writer ────────────────────────────────────────────────────────────────────

/**
 * Writes an apply record JSON file to the configured applyRecordsDir.
 * File name: <domainKey>-<timestamp-epoch>.apply.json
 * The directory is created if it does not exist.
 */
export function writeApplyRecord(
  projectRoot: string,
  applyRecordsDir: string,
  record: ApplyRecord,
): string {
  const dir = path.join(projectRoot, applyRecordsDir);
  fs.mkdirSync(dir, { recursive: true });

  const epoch = new Date(record.timestamp).getTime();
  const filename = `${record.domainKey}-${epoch}.apply.json`;
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + "\n", "utf-8");
  return path.relative(projectRoot, filePath);
}

/**
 * Builds an ApplyRecord from an execution result.
 */
export function buildApplyRecord(
  names: DomainNames,
  specFile: string,
  filesCreated: string[],
): ApplyRecord {
  return {
    timestamp: new Date().toISOString(),
    domainKey: names.domainKey,
    filesCreated,
    upsertTargets: [
      names.schemasFile,
      names.queryKeysFile,
      names.providerFile,
      names.dispatcherFile,
      names.typesEventsFile,
      names.entityRegistryFile,
    ],
    generatorVersion: GENERATOR_VERSION,
    specFile,
  };
}
