import path from "node:path";
import { collectFiles, readSourceFile } from "./utils.js";
import type { GateResult, GateViolation } from "./types.js";
import type { GeneratorConfig } from "../config.js";

const GATE_ID = "gate-optimistic-coverage";
const GATE_NAME = "Gate: Optimistic UI Coverage (onMutate + onError)";

/**
 * Every useMutation block in hook files MUST have both:
 *   1. onMutate — sets up optimistic state before the API call
 *   2. onError  — rolls back optimistic state if the API call fails
 *
 * Missing onMutate causes jarring UI latency (no immediate feedback).
 * Missing onError means failed mutations leave stale optimistic state stuck
 * in the cache, corrupting the displayed data until the next WS update.
 *
 * The "Real-Time Trinity" requires:
 *   onMutate (optimistic) + mutationFn (API) + WS projection (server truth)
 *
 * Scan scope: apps/web/src/hooks/**\/*.ts, apps/web/src/hooks/**\/*.tsx
 *
 * ── PATTERN INVENTORY ──────────────────────────────────────────────────────
 * Update this section whenever templates/frontend-hook.ts changes.
 *
 *   Scope filter: only domain hooks (those importing from query-keys) are tested
 *     →  /from\s+["'][^"']*query-keys[^"']*["']/
 *
 *   PASS conditions (all must appear inside each useMutation({…}) block):
 *     onMutate  →  /\bonMutate\b/
 *     onError   →  /\bonError\b/
 *
 *   Block boundary: brace-balanced from useMutation( opening
 *
 * @templateRef templates/frontend-hook.ts
 *   Template output: every useMutation block includes onMutate + onError ✓
 *   Gate alignment:  both callbacks are required in every generated mutation hook ✓
 */
export function runGateOptimisticCoverage(
  projectRoot: string,
  config: GeneratorConfig,
): GateResult {
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

  for (const relPath of hookFiles) {
    const src = readSourceFile(relPath, projectRoot);
    if (!src) continue;

    // Only check domain hooks — those that import from query-keys.
    // Auth, session, and server-action hooks are fire-and-forget mutations
    // that don't manage entity cache and don't need optimistic handling.
    const isDomainHook = /from\s+["'][^"']*query-keys[^"']*["']/.test(
      src.content,
    );
    if (!isDomainHook) continue;

    // Find every useMutation block. Strategy: find `useMutation({` then
    // scan the block (brace-balanced) for onMutate and onError.
    const lines = src.lines;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (!/\buseMutation\s*\(/.test(line)) {
        i++;
        continue;
      }

      // Found a useMutation call — record its start line
      const mutationStartLine = i + 1;
      testedCount++;

      // Collect the full mutation block by brace-balancing
      let braceDepth = 0;
      let started = false;
      let blockLines: string[] = [];
      let j = i;

      while (j < lines.length) {
        const l = lines[j];
        for (const ch of l) {
          if (ch === "{") {
            braceDepth++;
            started = true;
          }
          if (ch === "}") braceDepth--;
        }
        blockLines.push(l);
        if (started && braceDepth <= 0) break;
        j++;
      }

      const block = blockLines.join("\n");

      const hasOnMutate = /\bonMutate\s*:/.test(block);
      const hasOnError = /\bonError\s*:/.test(block);

      if (!hasOnMutate) {
        violations.push({
          file: relPath,
          line: mutationStartLine,
          message:
            "useMutation is missing onMutate. All mutations must set up optimistic state immediately (Real-Time Trinity law). Add onMutate to apply an optimistic update and return rollback context.",
          severity: "error",
        });
      }

      if (!hasOnError) {
        violations.push({
          file: relPath,
          line: mutationStartLine,
          message:
            "useMutation is missing onError. All mutations must roll back optimistic state on failure. Add onError to restore the previous cache snapshot from context.",
          severity: "error",
        });
      }

      if (hasOnMutate && hasOnError) passedCount++;

      // Advance past this mutation block
      i = j + 1;
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
        ? `${hookFiles.length} hook file(s) checked — no useMutation blocks found.`
        : `${passedCount}/${testedCount} useMutation block(s) have both onMutate and onError.`,
    testedCount,
    passedCount,
  };
}
