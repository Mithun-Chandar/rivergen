import path from "node:path";
import { collectFiles, readSourceFile } from "./utils";
import type { GateResult, GateViolation } from "./types";
import type { GeneratorConfig } from "../config";

const GATE_ID = "gate-onsuccess-ban";
const GATE_NAME = "Gate: No Cache Writes in onSuccess";

/**
 * useMutation onSuccess MUST NOT mutate the React Query cache.
 *
 * The law: server truth arrives via the WebSocket projection pipeline.
 * Writing to cache in onSuccess creates a dual-write race — the optimistic
 * state and the WS projection may conflict, producing flickering UI or
 * stale data.
 *
 * Pattern detected as violation:
 *   onSuccess: ... queryClient.setQueryData(
 *   onSuccess: ... queryClient.invalidateQueries(
 *   onSuccess: ... queryClient.removeQueries(
 *   onSuccess: ... queryClient.resetQueries(
 *   onSuccess: ... queryClient.setQueriesData(
 *
 * This is checked by finding `onSuccess` blocks then scanning for
 * queryClient cache operations within the next N lines (until the
 * matching closing brace of the onSuccess arrow/function).
 *
 * Scan scope: apps/web/src/hooks/**\/*.ts, apps/web/src/hooks/**\/*.tsx
 *
 * ── PATTERN INVENTORY ──────────────────────────────────────────────────────
 * Update this section whenever templates/frontend-hook.ts changes.
 *
 *   Violation trigger: \bonSuccess\s*: in hook, then inside that brace-balanced
 *   block any of:
 *     queryClient.setQueryData(     →  /queryClient\.(setQueryData|…)\s*\(/
 *     queryClient.invalidateQueries(
 *     queryClient.removeQueries(
 *     queryClient.resetQueries(
 *     queryClient.setQueriesData(
 *
 *   Block boundary: brace-balanced from onSuccess: opening until matching }
 *
 * @templateRef templates/frontend-hook.ts
 *   Template output: onSuccess intentionally omitted (comment: "// onSuccess: intentionally omitted")
 *   Gate alignment:  no cache writes in generated onSuccess — nothing to fire ✓
 */
export function runGateOnSuccessBan(projectRoot: string, config: GeneratorConfig): GateResult {
  const violations: GateViolation[] = [];

  const hooksDir = path.join(projectRoot, config.web.hooksDir);
  const hookFiles = collectFiles(
    hooksDir,
    (name) => name.endsWith(".ts") || name.endsWith(".tsx"),
    projectRoot,
  );

  if (hookFiles.length === 0) {
    return {
      gateId: GATE_ID,
      gateName: GATE_NAME,
      passed: true,
      violations: [],
      summary: "No hook files found — nothing to check.",
      testedCount: 0,
      passedCount: 0,
    };
  }

  let testedCount = 0;
  let passedCount = 0;

  const CACHE_OPS =
    /queryClient\.(setQueryData|invalidateQueries|removeQueries|resetQueries|setQueriesData)\s*\(/;

  for (const relPath of hookFiles) {
    const src = readSourceFile(relPath, projectRoot);
    if (!src) continue;

    const lines = src.lines;
    let inOnSuccess = false;
    let braceDepth = 0;
    let onSuccessStartLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();

      // Detect start of onSuccess block
      if (!inOnSuccess && /\bonSuccess\s*:/.test(line)) {
        inOnSuccess = true;
        braceDepth = 0;
        onSuccessStartLine = i + 1;
        testedCount++;
      }

      if (inOnSuccess) {
        // Track brace depth to know when onSuccess block ends
        for (const ch of line) {
          if (ch === "{") braceDepth++;
          if (ch === "}") braceDepth--;
        }

        // Check for forbidden cache operations (skip comment lines)
        if (!trimmed.startsWith("//")) {
          const m = CACHE_OPS.exec(line);
          if (m) {
            violations.push({
              file: relPath,
              line: i + 1,
              message: `queryClient.${m[1]}() in onSuccess is forbidden. Cache convergence must arrive via the WebSocket projection pipeline (onMutate → optimistic; WS event → projection → entity-cache). Remove from onSuccess.`,
              severity: "error",
            });
          }
        }

        // Exit onSuccess tracking once depth returns to 0 (after entering)
        if (braceDepth <= 0 && onSuccessStartLine !== i + 1) {
          inOnSuccess = false;
          // If we tracked this onSuccess and found no violation, count as passed
        }
      }
    }

    if (!violations.some((v) => v.file === relPath && v.severity === "error")) {
      passedCount++;
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
        ? `${hookFiles.length} hook file(s) checked — no onSuccess blocks found.`
        : `${passedCount}/${hookFiles.length} hook file(s) free of onSuccess cache writes. ${testedCount} onSuccess block(s) scanned.`,
    testedCount,
    passedCount,
  };
}
