import path from "node:path";
import fs from "node:fs";
import {
  readSourceFile,
  allMatches,
  collectFiles,
  discoverBroadcastEvents,
} from "./utils.js";
import {
  parseWitnessDomain,
  parseWitnessRequiredFields,
  extractSchemaFields,
  detectBroadcastStyle,
  extractSelectiveBroadcastFields,
} from "./witness-parse.js";
import { runLayer3 } from "./layer3-runner.js";
import type { GateResult, GateViolation } from "./types.js";
import type { GeneratorConfig } from "../config.js";

const GATE_ID = "gate-witness-coverage";
const GATE_NAME = "Gate #12: Witness — Field Continuity Coverage";

/**
 * Gate #12 — Witness field continuity audit.
 *
 * Runs three static layers + one coverage check:
 *
 *   Layer 1 (schema contract) — every requiredField must be declared in the
 *     domain's Zod schema. A field in requiredFields but absent from the schema
 *     is silently stripped by EventFactory at publish time.
 *
 *   Layer 2 (broadcast contract) — for selective broadcasts (manual edits),
 *     every requiredField must be forwarded in the emit payload. Pass-through
 *     broadcasts (the generator default) satisfy Layer 2 automatically.
 *
 *   Layer 4 (coverage completeness) — every broadcast event must appear in
 *     some witness file. This is the progress signal that fails after gen
 *     until witness files are scaffolded for all domains.
 *
 * Layer 3 (projection proof, dynamic) is Phase D — requires importing and
 * running the actual projection functions.
 *
 * Skip: if apps/web/src/witness/ doesn't exist, the gate passes with a notice.
 */
export async function runGateWitnessCoverage(
  projectRoot: string,
  config: GeneratorConfig,
): Promise<GateResult> {
  const violations: GateViolation[] = [];

  const WITNESS_DIR = config.web.witnessDir;
  const SCHEMAS_DIR = config.api.schemasDir;
  const API_SRC = config.api.srcRoot;

  // Skip if no witness directory exists
  const absWitnessDir = path.join(projectRoot, WITNESS_DIR);
  if (!fs.existsSync(absWitnessDir)) {
    return {
      gateId: GATE_ID,
      gateName: GATE_NAME,
      passed: true,
      violations: [],
      summary: `${WITNESS_DIR}/ not present — gate skipped. Run rivergen gen to scaffold witness files.`,
      testedCount: 0,
      passedCount: 0,
    };
  }

  // ── Discover broadcast events (Layer 4 baseline) ───────────────────────────
  const allBroadcastEvents = discoverBroadcastEvents(projectRoot, config);

  if (allBroadcastEvents.length === 0) {
    return {
      gateId: GATE_ID,
      gateName: GATE_NAME,
      passed: true,
      violations: [],
      summary: "No broadcast events found — nothing to check.",
      testedCount: 0,
      passedCount: 0,
    };
  }

  // ── Collect all witness files ──────────────────────────────────────────────
  const witnessFiles = collectFiles(
    WITNESS_DIR,
    (name) => name.endsWith(".witness.ts"),
    projectRoot,
  );

  // ── Layer 1 + Layer 2: per-witness-file static checks ─────────────────────
  const layer1And2Violations = runLayers1And2(
    projectRoot,
    witnessFiles,
    violations,
    SCHEMAS_DIR,
    API_SRC,
  );
  violations.push(...layer1And2Violations);

  // ── Layer 4: coverage completeness ────────────────────────────────────────
  const coveredEvents = buildCoverageSet(projectRoot, witnessFiles);

  let layer4Passed = 0;
  const layer4Violations: GateViolation[] = [];

  for (const event of allBroadcastEvents) {
    if (coveredEvents.has(event)) {
      layer4Passed++;
    } else {
      const domainKey = event.split(".")[0];
      const expectedWitnessFile = `${WITNESS_DIR}/${domainKey}.witness.ts`;
      const fileExists = fs.existsSync(
        path.join(projectRoot, expectedWitnessFile),
      );

      layer4Violations.push({
        file: expectedWitnessFile,
        message: fileExists
          ? `Event "${event}" is not covered — add "${event}" to the witness file's events[], requiredFields, and testPayloads.`
          : `Event "${event}" has no witness file. Run: rivergen gen specs/${domainKey}.json --force`,
        severity: "error",
      });
    }
  }

  violations.push(...layer4Violations);

  // ── Layer 3: projection proof (dynamic) ────────────────────────────────────
  const layer3 = await runLayer3(projectRoot, witnessFiles);
  violations.push(...layer3.violations);

  // ── Summary ────────────────────────────────────────────────────────────────
  const errorViolations = violations.filter((v) => v.severity === "error");
  const l1l2Errors = layer1And2Violations.filter(
    (v) => v.severity === "error",
  ).length;
  const uncoveredDomains = new Set(
    layer4Violations.map((v) =>
      v.file.split("/").pop()?.replace(".witness.ts", ""),
    ),
  );

  const layer3ErrorCount = layer3.violations.filter(
    (v) => v.severity === "error",
  ).length;

  let summary: string;
  const notes: string[] = [];

  if (errorViolations.length === 0) {
    summary = `${allBroadcastEvents.length}/${allBroadcastEvents.length} events covered, schema+broadcast contracts satisfied.`;
    if (layer3.totalAssertions > 0) {
      notes.push(
        `Layer 3: ${layer3.passedAssertions}/${layer3.totalAssertions} projection assertions passed.`,
      );
    } else if (layer3.skippedFiles > 0) {
      notes.push(
        `Layer 3: ${layer3.skippedFiles} witness file(s) are stubs — fill the lifecycle() function to activate the projection proof.`,
      );
      notes.push(
        `  Until then, Layer 3 cannot verify that fields survive the projection.`,
      );
    }
  } else {
    const parts: string[] = [];
    if (l1l2Errors > 0)
      parts.push(`${l1l2Errors} schema/broadcast contract error(s)`);
    if (layer4Violations.length > 0)
      parts.push(
        `${layer4Passed}/${allBroadcastEvents.length} events covered (${uncoveredDomains.size} domain(s) missing)`,
      );
    if (layer3ErrorCount > 0)
      parts.push(`Layer 3: ${layer3ErrorCount} projection assertion(s) failed`);
    summary = parts.join("; ");
  }

  return {
    gateId: GATE_ID,
    gateName: GATE_NAME,
    passed: errorViolations.length === 0,
    violations,
    summary,
    notes: notes.length > 0 ? notes : undefined,
    testedCount: allBroadcastEvents.length,
    passedCount: layer4Passed,
  };
}

// ── Layer 1 + Layer 2 ─────────────────────────────────────────────────────────

function runLayers1And2(
  projectRoot: string,
  witnessFiles: string[],
  _existingViolations: GateViolation[],
  schemasDir: string,
  apiSrc: string,
): GateViolation[] {
  const violations: GateViolation[] = [];

  for (const witnessRelPath of witnessFiles) {
    const witnessSrc = readSourceFile(witnessRelPath, projectRoot);
    if (!witnessSrc) continue;

    const domain = parseWitnessDomain(witnessSrc.content);
    if (!domain) continue;

    const requiredFields = parseWitnessRequiredFields(witnessSrc.content);
    if (requiredFields.size === 0) continue; // no entries yet — scaffold only

    // ── Layer 1: requiredFields ⊆ Zod schema ─────────────────────────────
    const schemaPath = `${schemasDir}/${domain}.ts`;
    const schemaSrc = readSourceFile(schemaPath, projectRoot);

    if (!schemaSrc) {
      violations.push({
        file: witnessRelPath,
        message: `Cannot run Layer 1: schema file not found at ${schemaPath}. Run rivergen gen to scaffold it.`,
        severity: "warning",
      });
    } else {
      for (const [event, fields] of requiredFields) {
        if (fields.length === 0) continue; // no fields declared yet

        const schemaFields = extractSchemaFields(schemaSrc.content, event);

        if (schemaFields === null) {
          violations.push({
            file: schemaPath,
            message: `Layer 1: no z.object() found for event "${event}" in schema file. Add the schema entry.`,
            severity: "error",
          });
          continue;
        }

        const schemaFieldSet = new Set(schemaFields);
        for (const field of fields) {
          if (!schemaFieldSet.has(field)) {
            violations.push({
              file: schemaPath,
              message: `Layer 1: witness requiredField "${field}" for "${event}" is not declared in the Zod schema. EventFactory will strip it silently at publish time.`,
              severity: "error",
            });
          }
        }
      }
    }

    // ── Layer 2: requiredFields ⊆ broadcast emit payload ─────────────────
    const broadcastPath = `${apiSrc}/${domain}/${domain}.broadcast.ts`;
    const broadcastSrc = readSourceFile(broadcastPath, projectRoot);

    if (!broadcastSrc) {
      violations.push({
        file: witnessRelPath,
        message: `Cannot run Layer 2: broadcast file not found at ${broadcastPath}.`,
        severity: "warning",
      });
      continue;
    }

    const style = detectBroadcastStyle(broadcastSrc.content);

    if (style === "pass-through") {
      // All fields forwarded — Layer 2 satisfied automatically.
      continue;
    }

    if (style === "selective") {
      const broadcastFields = extractSelectiveBroadcastFields(
        broadcastSrc.content,
      );

      for (const [event, fields] of requiredFields) {
        if (fields.length === 0) continue;

        const emitFields = broadcastFields.get(event);

        if (!emitFields) {
          // No selective emit found for this event — could be delegated.
          // Issue a warning rather than an error to avoid false positives.
          violations.push({
            file: broadcastPath,
            message: `Layer 2: broadcast file is selective but no emit call found for "${event}". Verify requiredFields are forwarded.`,
            severity: "warning",
          });
          continue;
        }

        const emitFieldSet = new Set(emitFields);
        for (const field of fields) {
          if (!emitFieldSet.has(field)) {
            violations.push({
              file: broadcastPath,
              message: `Layer 2: witness requiredField "${field}" for "${event}" is not forwarded in the selective broadcast emit. Add it to the payload object.`,
              severity: "error",
            });
          }
        }
      }
    }
    // style === "unknown": no emit calls at all, skip Layer 2 for this file
  }

  return violations;
}

// ── Layer 4 helper ────────────────────────────────────────────────────────────

function buildCoverageSet(
  projectRoot: string,
  witnessFiles: string[],
): Set<string> {
  const covered = new Set<string>();

  for (const relPath of witnessFiles) {
    const src = readSourceFile(relPath, projectRoot);
    if (!src) continue;

    for (const m of allMatches(
      src.content,
      /"([a-z][a-z0-9._-]+\.[a-z][a-z0-9._-]*)"/g,
    )) {
      covered.add(m[1]);
    }
  }

  return covered;
}
