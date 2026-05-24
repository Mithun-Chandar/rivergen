import { readSourceFile, lineOf, allMatches } from "./utils";
import type { GateResult, GateViolation } from "./types";
import type { GeneratorConfig } from "../config";

const GATE_ID = "gate-provider-isolation";
const GATE_NAME = "Gate: WebSocketProvider Entity-Cache Isolation";

/**
 * WebSocketProvider.tsx MUST NOT import from entity-cache.ts.
 *
 * The law (Gate #14 equivalent):
 *   Provider → applyRealtimeEventToCache() (dispatcher/state-cache)
 *     → domain projection → entity-cache helpers → React Query cache
 *
 * If the provider imports entity-cache directly and calls applyEntityCreate/
 * Update/Delete, it bypasses the dispatcher — projections are skipped and
 * cache authority drifts from the declared manifest.
 *
 * Scan scope: apps/web/src/providers/WebSocketProvider.tsx (single file)
 *
 * Violations:
 *   - Any import of "entity-cache" in WebSocketProvider.tsx is an error
 *   - Any call to applyEntity* in WebSocketProvider.tsx is an error
 *
 * ── PATTERN INVENTORY ──────────────────────────────────────────────────────
 * Update this section whenever templates/init-websocket-provider.ts changes.
 *
 *   FAIL conditions (any triggers error):
 *     entity-cache import  →  /import\s+[^;]+from\s+["'][^"']*entity-cache[^"']*["']/
 *     applyEntity*() call  →  /applyEntity(?:Create|Update|Delete|Upsert)\s*\(/
 *     queryClient.setQueryData( outside ui:* signal handling
 *
 * @templateRef templates/init-websocket-provider.ts
 *   Template output: provider calls applyRealtimeEventToCache() — never imports entity-cache ✓
 *   Gate alignment:  import ban and direct-call ban enforced ✓
 */
export function runGateProviderIsolation(projectRoot: string, config: GeneratorConfig): GateResult {
  const violations: GateViolation[] = [];

  const relPath = config.web.providerFile;
  const src = readSourceFile(relPath, projectRoot);
  if (!src) {
    // File doesn't exist yet (before gen:init) — not a violation
    return {
      gateId: GATE_ID,
      gateName: GATE_NAME,
      passed: true,
      violations: [],
      summary: "WebSocketProvider.tsx not found — skipped.",
      testedCount: 0,
      passedCount: 0,
    };
  }

  let testedCount = 0;
  let passedCount = 0;
  testedCount++;

  // Check for entity-cache imports
  const entityCacheImportMatches = allMatches(
    src.content,
    /import\s+[^;]+from\s+["'][^"']*entity-cache[^"']*["']/g,
  );
  for (const m of entityCacheImportMatches) {
    violations.push({
      file: relPath,
      line: lineOf(src.content, m.index),
      message:
        "WebSocketProvider.tsx must not import from entity-cache. Route all events through applyRealtimeEventToCache() (state-cache dispatcher). Entity-cache imports belong only in projection files.",
      severity: "error",
    });
  }

  // Check for direct applyEntity* calls
  const applyEntityMatches = allMatches(
    src.content,
    /applyEntity(?:Create|Update|Delete|Upsert)\s*\(/g,
  );
  for (const m of applyEntityMatches) {
    violations.push({
      file: relPath,
      line: lineOf(src.content, m.index),
      message:
        "WebSocketProvider.tsx must not call applyEntity*() directly. All domain events must route through applyRealtimeEventToCache() → dispatcher → projection → entity-cache.",
      severity: "error",
    });
  }

  // Check for raw queryClient.setQueryData in provider (outside of ui:* signal handling)
  const lines = src.lines;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//")) continue;
    if (/queryClient\.setQueryData\s*\(/.test(line)) {
      violations.push({
        file: relPath,
        line: i + 1,
        message:
          "WebSocketProvider.tsx must not call queryClient.setQueryData() directly. Cache mutations belong in projection files, not the provider.",
        severity: "error",
      });
    }
  }

  if (violations.length === 0) passedCount++;

  const passed = violations.filter((v) => v.severity === "error").length === 0;

  return {
    gateId: GATE_ID,
    gateName: GATE_NAME,
    passed,
    violations,
    summary: passed
      ? "WebSocketProvider.tsx does not import entity-cache or call applyEntity*()."
      : `${violations.filter((v) => v.severity === "error").length} isolation violation(s) in WebSocketProvider.tsx.`,
    testedCount,
    passedCount,
  };
}
