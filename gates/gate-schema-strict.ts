import path from "node:path";
import { collectFiles, readSourceFile, lineOf, allMatches } from "./utils";
import type { GateResult, GateViolation } from "./types";

const GATE_ID = "gate-schema-strict";
const GATE_NAME = "Gate: Schema .strict() Enforcement";

/**
 * Every Zod schema entry in schemas/<domain>.ts MUST use `.strict()`.
 *
 * Without `.strict()`, EventFactory silently accepts payloads with extra
 * fields. This means a new field added to publish() but forgotten in the
 * schema will not be caught at runtime — the event will appear to work but
 * the payload arriving at the frontend will be missing that field.
 *
 * Scan scope: apps/api/src/lib/event-factory/schemas/*.ts
 *
 * Rule: every `z.object({...})` in a schema file must be followed by `.strict()`.
 * A `.object(` without a subsequent `.strict()` on the same chained expression
 * is a violation.
 *
 * ── PATTERN INVENTORY ──────────────────────────────────────────────────────
 * Update this section whenever templates/domain-slice-schemas.ts changes.
 *
 *   Violation trigger: z.object( without .strict() in a 25-line forward window
 *     z.object(  →  /z\.object\s*\(/
 *     .strict()  →  /.strict\s*\(\s*\)/  (scanned up to 10 lines after z.object)
 *
 * @templateRef templates/domain-slice-schemas.ts
 *   Template output: z.object({ fieldId: stringId }).strict() ✓
 *   Gate alignment:  template always appends .strict() — any manual additions must too ✓
 */
export function runGateSchemaStrict(projectRoot: string): GateResult {
  const violations: GateViolation[] = [];

  const schemasDir = path.join(
    projectRoot,
    "apps/api/src/lib/event-factory/schemas",
  );
  const schemaFiles = collectFiles(
    schemasDir,
    (name) => name.endsWith(".ts") && name !== "_index.ts",
    projectRoot,
  );

  if (schemaFiles.length === 0) {
    return {
      gateId: GATE_ID,
      gateName: GATE_NAME,
      passed: true,
      violations: [],
      summary: "No schema files found — nothing to check.",
      testedCount: 0,
      passedCount: 0,
    };
  }

  let testedCount = 0;
  let passedCount = 0;

  for (const relPath of schemaFiles) {
    const src = readSourceFile(relPath, projectRoot);
    if (!src) {
      violations.push({
        file: relPath,
        message: "Could not read file.",
        severity: "error",
      });
      continue;
    }

    // Find every z.object({ ... }) expression.
    // We look for z.object( then check if the chain ends with .strict()
    // by scanning the logical "value" side of each schema map entry.
    // Strategy: find all lines containing z.object( and check the full
    // chained expression (may span multiple lines) ends with .strict()
    const lines = src.lines;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/z\.object\s*\(/.test(line)) continue;

      testedCount++;

      // Gather the full chained expression: collect from here until we find
      // the closing parenthesis balance (accounting for nested parens).
      // Heuristic: scan forward up to 25 lines for .strict() — allows schemas
      // with many fields written one-field-per-line without gate failure.
      const window = lines.slice(i, Math.min(i + 25, lines.length)).join(" ");

      // After z.object({...}) the chain must include .strict()
      if (!/.strict\s*\(\s*\)/.test(window)) {
        violations.push({
          file: relPath,
          line: i + 1,
          message:
            "z.object() schema entry is missing .strict(). Every EventFactory schema must use .strict() to prevent silent extra-field acceptance at publish time.",
          severity: "error",
        });
      } else {
        passedCount++;
      }
    }
  }

  const passed = violations.filter((v) => v.severity === "error").length === 0;

  return {
    gateId: GATE_ID,
    gateName: GATE_NAME,
    passed,
    violations,
    summary:
      testedCount === 0
        ? "No z.object() entries found in schema files."
        : `${passedCount}/${testedCount} schema entries use .strict().`,
    testedCount,
    passedCount,
  };
}
