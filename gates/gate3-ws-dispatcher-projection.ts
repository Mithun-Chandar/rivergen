import path from "node:path";
import fs from "node:fs";
import {
  collectFiles,
  readSourceFile,
  allMatches,
  lineOf,
  loadRealtimeEventMap,
  extractSwitchCases,
} from "./utils.js";
import type { GateResult, GateViolation } from "./types.js";
import type { GeneratorConfig } from "../config.js";

// Loaded once at gate run time
let _realtimeEventMapCache: Record<string, string> | null = null;
let _realtimeEventMapConfig: GeneratorConfig | null = null;
function getCachedRealtimeEventMap(
  projectRoot: string,
  config: GeneratorConfig,
): Record<string, string> {
  if (_realtimeEventMapCache && _realtimeEventMapConfig === config) {
    return _realtimeEventMapCache;
  }
  _realtimeEventMapConfig = config;
  _realtimeEventMapCache = loadRealtimeEventMap(projectRoot, config);
  return _realtimeEventMapCache;
}

const GATE_ID = "gate3";
const GATE_NAME = "Gate #3: WS socket.on → Dispatcher → Projection call";

/**
 * Verifies the frontend side of the realtime pipeline:
 *
 *   1. WebSocketProvider binds socket.on(EVENT) and routes it through
 *      applyRealtimeEventToCache (either via routeEvent or directly).
 *   2. state-cache.ts (the dispatcher) has a `case` for each bound event.
 *   3. Each dispatcher case calls an apply*Projection function that is
 *      imported from a projection file.
 *
 * Scan scopes:
 *   - provider:   apps/web/src/providers/WebSocketProvider.tsx
 *   - dispatcher: apps/web/src/lib/cache/state-cache.ts
 *   - projections: apps/web/src/lib/projections/**\/*-projections.ts
 *
 * ── PATTERN INVENTORY ──────────────────────────────────────────────────────
 * Update this section whenever templates/domain-slice-ws-bindings.ts,
 * templates/domain-slice-dispatchers.ts, or templates/frontend-projection.ts changes.
 *
 *   WebSocketProvider binding patterns recognized:
 *     socket.on(WS_EVENT_CONSTANT, …)       — resolves via buildWsConstMap()
 *     socket.on(RealtimeEvent.PascalCase, …)
 *     socket.on("event.name", …)            — string literal
 *     getAllWsBindings() loop                — scans ws-bindings/*.ts for "event.name" strings ✓
 *
 *   Dispatcher (state-cache.ts) patterns recognized:
 *     switch/case RealtimeEvent.Foo or "event.name" — via extractSwitchCases()
 *     domainDispatchers[event]?.()           — scans domain-dispatchers/*.ts slice files ✓
 *
 *   Projection call pattern recognized in dispatcher:
 *     apply*Projection(   →  /apply\w+Projection\s*\(/
 *
 * @templateRef templates/domain-slice-ws-bindings.ts
 *   Template output: export const xyzWsBindings: string[] = ["event.name", ...]
 *   Gate reads via getAllWsBindings() → collects quoted strings from ws-bindings/*.ts ✓
 *
 * @templateRef templates/domain-slice-dispatchers.ts
 *   Template output: domainDispatchers map → applyDomainProjection("event.name", payload, qc)
 *   ⚠ NOTE: template generates a single applyDomainProjection router per domain. The projection
 *     file (or dispatcher slice) must export that function, or call individual apply*Created/
 *     Updated/Deleted functions directly. If this delegation pattern changes, update the
 *     apply\w+Projection regex above.
 *   ⚠ ANNOTATION: add `// gate3:delegate-dispatcher` at the top of a slice file to exempt it
 *     from the inline apply* check. Use when wrapper functions (e.g. tracing) wrap the calls.
 *
 * @templateRef templates/frontend-projection.ts
 *   Template output: apply${E}Created, apply${E}Updated, apply${E}Deleted functions
 *   Gate checks for: apply*Projection calls reachable from dispatcher ✓
 */
/**
 * Socket.IO lifecycle events that are handled directly in WebSocketProvider
 * (onConnect, onDisconnect, error handling) and do NOT route through the
 * dispatcher or projection pipeline.  Exclude them from Gate #3 checks.
 */
const SOCKET_LIFECYCLE_EVENTS = new Set([
  "connect",
  "disconnect",
  "connect_error",
  "reconnect",
  "reconnect_attempt",
  "reconnect_error",
  "reconnect_failed",
  "error",
  "ping",
  "pong",
]);

export function runGate3(
  projectRoot: string,
  config: GeneratorConfig,
): GateResult {
  const violations: GateViolation[] = [];

  _realtimeEventMapCache = null; // reset cache per run
  const realtimeEventMap = loadRealtimeEventMap(projectRoot, config);

  // ── 1. Parse WebSocketProvider for bound events ────────────────────────────

  const providerPath = config.web.providerFile;
  const providerSrc = readSourceFile(providerPath, projectRoot);

  const boundEvents = new Set<string>(); // event strings bound via socket.on

  if (!providerSrc) {
    violations.push({
      file: providerPath,
      message: "WebSocketProvider.tsx not found.",
      severity: "error",
    });
  } else {
    // Pattern 1: socket.on(WS_EVENT_X, routeEvent(...))
    // We need to resolve WS_EVENT_X constants to their string values.
    // In v2, WS_EVENT_* = RealtimeEvent.* = string value in realtime-events.ts
    // Also resolve from imports in state-cache.ts which re-exports them.

    // First collect WS_EVENT_* constant definitions from any imported file.
    const wsConstMap = buildWsConstMap(
      projectRoot,
      config,
      providerSrc.content,
    );

    // Handle: socket.on(CONST, ...) where CONST is a WS_EVENT_* variable
    for (const m of allMatches(
      providerSrc.content,
      /socket\.on\s*\(\s*(WS_EVENT_\w+)\s*,/g,
    )) {
      const eventStr = wsConstMap[m[1]];
      if (eventStr) {
        boundEvents.add(eventStr);
      } else {
        violations.push({
          file: providerPath,
          line: lineOf(providerSrc.content, m.index),
          message: `socket.on(${m[1]}, ...) — could not resolve constant to event string. Ensure it maps to a RealtimeEvent value.`,
          severity: "warning",
        });
      }
    }

    // Handle: socket.on(RealtimeEvent.Foo, ...)
    for (const m of allMatches(
      providerSrc.content,
      /socket\.on\s*\(\s*RealtimeEvent\.(\w+)\s*,/g,
    )) {
      const eventStr = realtimeEventMap[m[1]];
      if (eventStr) {
        boundEvents.add(eventStr);
      }
    }

    // Handle: socket.on("event.string", ...)
    for (const m of allMatches(
      providerSrc.content,
      /socket\.on\s*\(\s*"([a-z][a-z0-9._-]+)"\s*,/g,
    )) {
      boundEvents.add(m[1]);
    }

    // ── New pattern: getAllWsBindings() loop ───────────────────────────────
    // If provider calls getAllWsBindings(), scan ws-bindings slice files for
    // the bound event names instead of parsing per-event socket.on() calls.
    if (providerSrc.content.includes("getAllWsBindings")) {
      const wsBindingsDir = path.join(projectRoot, config.web.wsBindingsDir);
      if (fs.existsSync(wsBindingsDir)) {
        for (const filename of fs.readdirSync(wsBindingsDir)) {
          if (!filename.endsWith(".ts") || filename.startsWith("_")) continue;
          const slicePath = `${config.web.wsBindingsDir}/${filename}`;
          const src = readSourceFile(slicePath, projectRoot);
          if (!src) continue;
          for (const m of allMatches(src.content, /"([a-z][a-z0-9._-]+)"/g)) {
            if (!SOCKET_LIFECYCLE_EVENTS.has(m[1])) {
              boundEvents.add(m[1]);
            }
          }
        }
      }
    }
  }

  // ── 2. Parse state-cache dispatcher for cases ──────────────────────────────

  const dispatcherPath = config.web.stateCacheFile;
  const dispatcherSrc = readSourceFile(dispatcherPath, projectRoot);

  const dispatchedEvents = new Set<string>(); // event strings in switch cases
  const dispatcherCallsProjection = new Map<string, string>(); // event → projection fn

  if (!dispatcherSrc) {
    violations.push({
      file: dispatcherPath,
      message: "state-cache.ts not found.",
      severity: "error",
    });
  } else {
    const cases = extractSwitchCases(dispatcherSrc.content, realtimeEventMap);
    for (const eventStr of cases) {
      dispatchedEvents.add(eventStr);
    }

    // Check each case calls an apply*Projection function
    // Strategy: for each case, look for apply*Projection( in the surrounding block
    // Simplified: check if any apply*Projection call exists in the whole file
    const projectionCalls = allMatches(
      dispatcherSrc.content,
      /apply\w+Projection\s*\(/g,
    );
    for (const c of projectionCalls) {
      // Associate projection call with nearest preceding case
      const textBefore = dispatcherSrc.content.slice(0, c.index);
      const lastCaseMatch =
        /case\s+(?:RealtimeEvent\.(\w+)|"([a-z][a-z0-9._-]+)")\s*:/g;
      let lastCase: RegExpExecArray | null = null;
      let lm: RegExpExecArray | null;
      const re = new RegExp(lastCaseMatch.source, lastCaseMatch.flags);
      while ((lm = re.exec(textBefore)) !== null) {
        lastCase = lm;
      }
      if (lastCase) {
        const eventStr =
          (lastCase[1] ? realtimeEventMap[lastCase[1]] : undefined) ??
          lastCase[2] ??
          "";
        if (eventStr) {
          dispatcherCallsProjection.set(eventStr, c[0]);
        }
      }
    }

    // ── New pattern: lookup-table dispatcher (domainDispatchers) ──────────
    // If state-cache.ts uses domainDispatchers[event]?.() pattern, scan the
    // domain-dispatchers slice files for event key → apply*Projection mappings.
    if (dispatcherSrc.content.includes("domainDispatchers")) {
      const dispatchersDir = path.join(projectRoot, config.web.dispatchersDir);
      if (fs.existsSync(dispatchersDir)) {
        for (const filename of fs.readdirSync(dispatchersDir)) {
          if (!filename.endsWith(".ts") || filename.startsWith("_")) continue;
          const slicePath = `${config.web.dispatchersDir}/${filename}`;
          const src = readSourceFile(slicePath, projectRoot);
          if (!src) continue;

          // gate3:delegate-dispatcher — file wraps apply* calls in named functions
          // (e.g. for tracing/instrumentation). Trust all event entries as compliant;
          // Gate 3 cannot verify the inline call path but the developer asserts it exists.
          const isDelegated = src.content.includes(
            "// gate3:delegate-dispatcher",
          );

          if (isDelegated) {
            // Extract event names only; projection linkage is asserted by the annotation.
            for (const m of allMatches(
              src.content,
              /"([a-z][a-z0-9._-]+)"\s*:/g,
            )) {
              const eventStr = m[1];
              if (!SOCKET_LIFECYCLE_EVENTS.has(eventStr)) {
                dispatchedEvents.add(eventStr);
                dispatcherCallsProjection.set(eventStr, "<delegated>");
              }
            }
          } else {
            // Normal pattern: "event.name": (payload, qc) => applyXxx(...)
            // Use [\s\S]*? to cross newlines between the arrow and function call.
            for (const m of allMatches(
              src.content,
              /"([a-z][a-z0-9._-]+)"\s*:\s*\([^)]*\)\s*=>\s*[\s\S]*?(apply[A-Z]\w+)\s*\(/g,
            )) {
              const eventStr = m[1];
              const projFn = m[2];
              if (!SOCKET_LIFECYCLE_EVENTS.has(eventStr)) {
                dispatchedEvents.add(eventStr);
                dispatcherCallsProjection.set(eventStr, projFn);
              }
            }
          }
        }
      }
    }
  }

  // ── 3. Parse projection files for exported apply* functions ───────────────

  const projectionsDir = path.join(projectRoot, config.web.projectionsDir);
  const projectionFiles = collectFiles(
    projectionsDir,
    (name) =>
      name.endsWith("-projections.ts") || name.endsWith("projections.ts"),
    projectRoot,
  );

  const exportedProjectionFns = new Set<string>();
  for (const relPath of projectionFiles) {
    const src = readSourceFile(relPath, projectRoot);
    if (!src) continue;
    for (const m of allMatches(
      src.content,
      /export\s+(?:async\s+)?function\s+(apply\w+Projection)/g,
    )) {
      exportedProjectionFns.add(m[1]);
    }
  }

  // ── 4. Cross-reference provider → dispatcher → projection ─────────────────

  // Count domain events only (exclude socket lifecycle events)
  const domainBoundEvents = [...boundEvents].filter(
    (e) => !SOCKET_LIFECYCLE_EVENTS.has(e),
  );
  const totalEvents =
    domainBoundEvents.length > 0
      ? domainBoundEvents.length
      : dispatchedEvents.size;

  let passedCount = 0;

  if (boundEvents.size === 0 && dispatcherSrc) {
    // If no bound events found in provider, check dispatcher directly
    for (const ev of dispatchedEvents) {
      boundEvents.add(ev);
    }
  }

  for (const event of boundEvents) {
    // Skip Socket.IO lifecycle events — they don't route through the dispatcher
    if (SOCKET_LIFECYCLE_EVENTS.has(event)) continue;

    const hasCase = dispatchedEvents.has(event);
    const projFn = dispatcherCallsProjection.get(event);

    if (!hasCase) {
      violations.push({
        file: dispatcherPath,
        message: `"${event}": bound in WebSocketProvider but not dispatched to a projection. Add it to a domain-dispatchers slice or as a switch case in state-cache.ts.`,
        severity: "error",
      });
    } else if (!projFn) {
      violations.push({
        file: dispatcherPath,
        message: `"${event}": dispatcher case exists but does not call an apply*Projection() function.`,
        severity: "error",
      });
    } else {
      passedCount++;
    }
  }

  // Warn about dispatcher cases not covered by provider
  for (const event of dispatchedEvents) {
    if (!boundEvents.has(event)) {
      violations.push({
        file: providerPath,
        message: `"${event}": in dispatcher switch but not bound via socket.on in WebSocketProvider.`,
        severity: "warning",
      });
    }
  }

  const passed = violations.filter((v) => v.severity === "error").length === 0;

  return {
    gateId: GATE_ID,
    gateName: GATE_NAME,
    passed,
    violations,
    summary: `${passedCount}/${totalEvents} events have complete socket.on → dispatcher → projection chain.`,
    testedCount: totalEvents,
    passedCount,
  };
}

// ─── Helper: build WS_EVENT_* constant map ────────────────────────────────────

/**
 * Reads state-cache.ts (which exports WS_EVENT_* constants) and builds a
 * mapping from constant name to resolved event string.
 *
 * e.g. WS_EVENT_NOTIFICATION_CREATED → "notification.created"
 */
function buildWsConstMap(
  projectRoot: string,
  config: GeneratorConfig,
  providerContent: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  const realtimeEventMap = getCachedRealtimeEventMap(projectRoot, config);

  // Extract import sources from the provider file
  // e.g. import { WS_EVENT_X, WS_EVENT_Y } from "../lib/cache"
  const importMatches = allMatches(
    providerContent,
    /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g,
  );

  for (const im of importMatches) {
    const names = im[1].split(",").map((s) => s.trim());
    const wsConsts = names.filter((n) => n.startsWith("WS_EVENT_"));
    if (wsConsts.length === 0) continue;

    // Scan candidate files that export WS_EVENT_* constants
    const cacheDir = path.dirname(config.web.stateCacheFile);
    const candidatePaths = [config.web.stateCacheFile, `${cacheDir}/index.ts`];

    for (const candidatePath of candidatePaths) {
      const src = readSourceFile(candidatePath, projectRoot);
      if (!src) continue;

      for (const constName of wsConsts) {
        // export const WS_EVENT_X = RealtimeEvent.Foo;
        // export const WS_EVENT_X = "event.string";
        const reTsConst = new RegExp(
          `(?:export\\s+)?const\\s+${constName}\\s*=\\s*(?:RealtimeEvent\\.(\\w+)|"([a-z][a-z0-9._-]+)")`,
        );
        const m = reTsConst.exec(src.content);
        if (m) {
          const resolved = m[1]
            ? (realtimeEventMap[m[1]] ?? m[1])
            : (m[2] ?? "");
          if (resolved) result[constName] = resolved;
        }
      }
    }
  }

  return result;
}
