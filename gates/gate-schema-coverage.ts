import path from "node:path";
import {
  collectFiles,
  readSourceFile,
  allMatches,
  lineOf,
  loadRegisteredEventTypes,
} from "./utils";
import type { GateResult, GateViolation } from "./types";
import type { GeneratorConfig } from "../config";

const GATE_ID = "gate-schema-coverage";
const GATE_NAME = "Gate: EventFactory Schema Coverage";

/**
 * Every event string emitted via socket.io in broadcast files MUST have a
 * corresponding entry in EventPayloadSchemas in schemas.ts.
 *
 * Background:
 *   EventFactory.publish() validates the payload against the registered Zod
 *   schema. If an event is registered in schemas.ts with a .strict() schema
 *   and the payload has extra fields — or if the event is NOT registered at
 *   all — the publish() call throws or silently drops the event.
 *
 * This gate checks both directions:
 *   - Every broadcast emit has a schema entry (so EventFactory can publish it)
 *   - Every schema entry has a broadcast emit (so it's actually reachable)
 *
 * Scan scopes:
 *   - schemas:    apps/api/src/lib/event-factory/schemas.ts (EventPayloadSchemas)
 *   - emitters:   apps/api/src/**\/*.broadcast.ts (.emit("event.name") calls)
 *
 * ── PATTERN INVENTORY ──────────────────────────────────────────────────────
 * Update this section whenever templates/domain-slice-schemas.ts or
 * templates/backend-broadcast.ts changes.
 *
 *   Schema key extraction: loadRegisteredEventTypes() — parses EventPayloadSchemas object
 *
 *   Broadcast emit patterns recognized:
 *     .emit("event.name")  →  /\.emit\s*\(\s*["']([a-z][a-z0-9._-]+)["']/
 *     (io, "event.name")   →  /\(io,\s*["']([a-z][a-z0-9._-]+)["']/
 *
 * @templateRef templates/domain-slice-schemas.ts
 *   Template output: { "event.name": z.object({…}).strict() }
 *   Gate alignment:  key-to-emit cross-reference ✓
 *
 * @templateRef templates/backend-broadcast.ts
 *   Template output: io.to(room).emit(eventName, payload) — eventName is a variable, not a literal
 *   ⚠ NOTE: the generic broadcast${E}Event helper passes eventName as a variable. This gate
 *     only captures event names from the individual per-event helper calls (e.g.
 *     broadcastXxxCreated → broadcast${E}Event(io, "event.name", …)) which use string literals.
 *     If the template stops generating per-event helpers, update both regex patterns above.
 */
export function runGateSchemaCoverage(projectRoot: string, config: GeneratorConfig): GateResult {
  const violations: GateViolation[] = [];

  // 1. Collect registered event types
  const registeredEvents = new Set(loadRegisteredEventTypes(projectRoot, config));

  // 2. Collect all emitted event strings from broadcast files
  const apiSrc = path.join(projectRoot, config.api.srcRoot);
  const broadcastFiles = collectFiles(
    apiSrc,
    (name) => name.endsWith(".broadcast.ts"),
    projectRoot,
  );

  const emittedEvents = new Map<string, { file: string; line: number }>();

  for (const relPath of broadcastFiles) {
    const src = readSourceFile(relPath, projectRoot);
    if (!src) continue;

    for (const m of allMatches(
      src.content,
      /\.emit\s*\(\s*["']([a-z][a-z0-9._-]+)["']/g,
    )) {
      const eventName = m[1];
      if (!emittedEvents.has(eventName)) {
        emittedEvents.set(eventName, {
          file: relPath,
          line: lineOf(src.content, m.index),
        });
      }
    }

    // broadcast helper call passing event name as string literal arg:
    //   broadcastXxx(io, "event.name", ...) — v2 style routing through central dispatcher
    for (const m of allMatches(
      src.content,
      /\(io,\s*["']([a-z][a-z0-9._-]+)["']/g,
    )) {
      const eventName = m[1];
      if (!emittedEvents.has(eventName)) {
        emittedEvents.set(eventName, {
          file: relPath,
          line: lineOf(src.content, m.index),
        });
      }
    }
  }

  if (registeredEvents.size === 0 && emittedEvents.size === 0) {
    return {
      gateId: GATE_ID,
      gateName: GATE_NAME,
      passed: true,
      violations: [],
      summary: "No events registered or emitted — nothing to check.",
      testedCount: 0,
      passedCount: 0,
    };
  }

  // 3. Check: every emitted event has a schema entry
  let passedCount = 0;
  for (const [eventName, loc] of emittedEvents) {
    if (!registeredEvents.has(eventName)) {
      violations.push({
        file: loc.file,
        line: loc.line,
        message: `"${eventName}": emitted via socket.emit but not registered in EventPayloadSchemas. Add a .strict() Zod schema entry.`,
        severity: "error",
      });
    } else {
      passedCount++;
    }
  }

  // 4. Check: every registered schema has a corresponding emit (orphan schemas are advisory)
  for (const eventName of registeredEvents) {
    if (!emittedEvents.has(eventName)) {
      violations.push({
        file: config.api.schemasFile,
        message: `"${eventName}": registered in EventPayloadSchemas but never emitted in any *.broadcast.ts file. Either add a broadcast helper or remove the schema entry.`,
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
    summary: `${passedCount}/${emittedEvents.size} emitted events have schema entries. ${registeredEvents.size} total schemas registered.`,
    testedCount: emittedEvents.size,
    passedCount,
  };
}
