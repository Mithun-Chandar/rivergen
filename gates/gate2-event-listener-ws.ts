import path from "node:path";
import {
  collectFiles,
  readSourceFile,
  allMatches,
  lineOf,
  resolveWorkspaceEvent,
  loadRegisteredEventTypes,
  loadRealtimeEventMap,
} from "./utils";
import type { GateResult, GateViolation } from "./types";

const GATE_ID = "gate2";
const GATE_NAME = "Gate #2: Event → Listener → Broadcaster → socket.emit";

/**
 * For every event type registered in EventPayloadSchemas, verifies:
 *   1. At least one listener subscribes to it via eventBus.subscribe(WorkspaceEvent.X)
 *   2. That event string is emitted via io.to(...).emit("event-string") in a broadcast file
 *
 * Scan scopes:
 *   - events:     apps/api/src/lib/event-factory/schemas.ts (EventPayloadSchemas keys)
 *   - listeners:  apps/api/src/lib/event-bus-listeners/**\/*.listener.ts
 *   - broadcasters: apps/api/src/**\/*.broadcast.ts
 *
 * ── PATTERN INVENTORY ──────────────────────────────────────────────────────
 * Update this section whenever templates/backend-listener.ts or
 * templates/backend-broadcast.ts changes.
 *
 *   Listener subscription patterns recognized (any one suffices):
 *     eventBus.subscribe(WorkspaceEvent.CONSTANT, …) — v1 legacy
 *     eventBus.subscribe(RealtimeEvent.PascalCase, …) — v2 current ✓
 *     eventBus.subscribe("dot.notation.event", …)    — string literal
 *
 *   Broadcast emit patterns recognized (any one suffices):
 *     .emit("event.name")        →  /\.emit\s*\(\s*["']([a-z][a-z0-9._-]+)["']/
 *     broadcastXxx(io, "event")  →  /\(io,\s*["']([a-z][a-z0-9._-]+)["']/
 *
 * @templateRef templates/backend-listener.ts
 *   ⚠ MISMATCH: template generates eventBus.on(RealtimeEvent.Constant, …)
 *     but the correct runtime API is eventBus.subscribe(…).
 *     Generated stubs must be fixed manually before Gate #2 can pass.
 *     TODO: update backend-listener.ts to emit .subscribe() and remove this warning.
 *
 * @templateRef templates/backend-broadcast.ts
 *   Template output: broadcast${E}Event(io, "event.name", …) → io.to(room).emit(…)
 *   Gate alignment:  .emit("event.name") and (io, "event.name") string literals ✓
 */
export function runGate2(projectRoot: string): GateResult {
  const violations: GateViolation[] = [];

  // 1. Collect registered event types
  const registeredEvents = loadRegisteredEventTypes(projectRoot);

  if (registeredEvents.length === 0) {
    return {
      gateId: GATE_ID,
      gateName: GATE_NAME,
      passed: true,
      violations: [],
      summary:
        "No events registered in EventPayloadSchemas — nothing to check.",
      testedCount: 0,
      passedCount: 0,
    };
  }

  // 2. Collect subscribed event strings from all listener files
  const listenersDir = path.join(
    projectRoot,
    "apps/api/src/lib/event-bus-listeners",
  );
  const listenerFiles = collectFiles(
    listenersDir,
    (name) => name.endsWith(".listener.ts"),
    projectRoot,
  );

  const subscribedEvents = new Set<string>();
  const listenerFilesByEvent = new Map<string, string>(); // event → file

  // Load RealtimeEvent map for PascalCase resolution
  const realtimeEventMap = loadRealtimeEventMap(projectRoot);

  for (const relPath of listenerFiles) {
    const src = readSourceFile(relPath, projectRoot);
    if (!src) continue;

    // eventBus.subscribe(WorkspaceEvent.CONSTANT, ...)
    for (const m of allMatches(
      src.content,
      /eventBus\.subscribe\s*\(\s*WorkspaceEvent\.([A-Z_]+)/g,
    )) {
      const resolved = resolveWorkspaceEvent(m[1]);
      subscribedEvents.add(resolved);
      listenerFilesByEvent.set(resolved, relPath);
    }

    // eventBus.subscribe(RealtimeEvent.PascalCase, ...) — v2 style
    for (const m of allMatches(
      src.content,
      /eventBus\.subscribe\s*\(\s*RealtimeEvent\.(\w+)/g,
    )) {
      const resolved = realtimeEventMap[m[1]];
      if (resolved) {
        subscribedEvents.add(resolved);
        listenerFilesByEvent.set(resolved, relPath);
      }
    }

    // Also handle string literals: eventBus.subscribe("event.name", ...)
    for (const m of allMatches(
      src.content,
      /eventBus\.subscribe\s*\(\s*"([a-z][a-z0-9._-]+)"/g,
    )) {
      subscribedEvents.add(m[1]);
      listenerFilesByEvent.set(m[1], relPath);
    }
  }

  // 3. Collect event strings emitted in broadcast files
  const apiSrc = path.join(projectRoot, "apps/api/src");
  const broadcastFiles = collectFiles(
    apiSrc,
    (name) => name.endsWith(".broadcast.ts"),
    projectRoot,
  );

  const emittedEvents = new Set<string>();
  const broadcastFilesByEvent = new Map<string, string>(); // event → file

  for (const relPath of broadcastFiles) {
    const src = readSourceFile(relPath, projectRoot);
    if (!src) continue;

    // .emit("event.name", ...) or .emit('event.name', ...)
    for (const m of allMatches(
      src.content,
      /\.emit\s*\(\s*["']([a-z][a-z0-9._-]+)["']/g,
    )) {
      emittedEvents.add(m[1]);
      broadcastFilesByEvent.set(m[1], relPath);
    }

    // broadcast helper call passing a string literal as event name:
    //   broadcastXxx(io, "event.name", ...) or similar (io, "event.name"
    for (const m of allMatches(
      src.content,
      /\(io,\s*["']([a-z][a-z0-9._-]+)["']/g,
    )) {
      emittedEvents.add(m[1]);
      broadcastFilesByEvent.set(m[1], relPath);
    }
  }

  // 4. Cross-reference
  let passedCount = 0;

  for (const event of registeredEvents) {
    const hasListener = subscribedEvents.has(event);
    const hasEmit = emittedEvents.has(event);

    if (!hasListener && !hasEmit) {
      violations.push({
        file: "apps/api/src/lib/event-factory/schemas.ts",
        message: `"${event}": registered in EventPayloadSchemas but has no listener (eventBus.subscribe) and no broadcast emit. The full pipeline is broken.`,
        severity: "error",
      });
    } else if (!hasListener) {
      violations.push({
        file: "apps/api/src/lib/event-bus-listeners/",
        message: `"${event}": no listener found. Add eventBus.subscribe(WorkspaceEvent.${event
          .toUpperCase()
          .replace(/\./g, "_")}) in a *.listener.ts file.`,
        severity: "error",
      });
    } else if (!hasEmit) {
      violations.push({
        file: listenerFilesByEvent.get(event) ?? "unknown",
        message: `"${event}": listener exists but no broadcaster calls .emit("${event}"). Add a broadcast helper.`,
        severity: "error",
      });
    } else {
      passedCount++;
    }
  }

  // 5. Warn about emitted events with no schema (schema gate catches errors, but warn here too)
  for (const emitted of emittedEvents) {
    if (!registeredEvents.includes(emitted)) {
      violations.push({
        file: broadcastFilesByEvent.get(emitted) ?? "unknown",
        message: `"${emitted}": emitted via socket.emit but not registered in EventPayloadSchemas. Add a schema entry.`,
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
    summary: `${passedCount}/${registeredEvents.length} events have complete listener→broadcast chain.`,
    testedCount: registeredEvents.length,
    passedCount,
  };
}
