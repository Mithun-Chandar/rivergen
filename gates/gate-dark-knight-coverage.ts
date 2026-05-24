import { readSourceFile, allMatches, discoverBroadcastEvents } from "./utils";
import type { GateResult, GateViolation } from "./types";

const GATE_ID = "gate-dark-knight-coverage";
const GATE_NAME = "Gate: Event Audit Coverage";

const PHASE4_PATH = "tools/dark-knight/phase4-payload-continuity-audit.ts";
const PHASE5_PATH = "tools/dark-knight/phase5-test-payloads.ts";
const PHASE6_PATH = "tools/dark-knight/phase6-retained-slice-audit.ts";

/**
 * Every event discovered by the generator must also be covered
 * by the three manual Dark Knight artifacts:
 *
 *   Phase 4  —  REQUIRED_FIELDS entry (payload continuity)
 *   Phase 5  —  test payload (trace coverage replay)
 *   Phase 6  —  slice assertion reference (retained slice audit)
 *
 * Without coverage in all three, a domain can pass gen:verify 10/10
 * while Dark Knight silently ignores the event, causing regression.
 *
 * Discovery: re-uses the same broadcast-file emit scan that gates
 * #2 and schema-coverage use, producing the canonical event list.
 */
export function runGateDarkKnightCoverage(projectRoot: string): GateResult {
  const violations: GateViolation[] = [];

  // Skip if no dark-knight audit artifacts are present.
  // Expected for projects not yet using @rivergen/audit.
  const anyAuditFilePresent =
    readSourceFile(PHASE4_PATH, projectRoot) !== null ||
    readSourceFile(PHASE5_PATH, projectRoot) !== null ||
    readSourceFile(PHASE6_PATH, projectRoot) !== null;

  if (!anyAuditFilePresent) {
    return {
      gateId: GATE_ID,
      gateName: GATE_NAME,
      passed: true,
      skipped: true,
      violations: [],
      summary: "No audit artifacts present — gate skipped.",
      testedCount: 0,
      passedCount: 0,
    };
  }

  // ── 1. Discover all events from broadcast files ───────────────────────
  const allEvents = discoverBroadcastEvents(projectRoot);

  if (allEvents.length === 0) {
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

  // ── 2. Scan Phase 4 REQUIRED_FIELDS keys ──────────────────────────────
  const phase4Events = extractPhase4Events(projectRoot);

  // ── 3. Scan Phase 5 test payload type strings ─────────────────────────
  const phase5Events = extractPhase5Events(projectRoot);

  // ── 4. Scan Phase 6 for event name references ─────────────────────────
  const phase6Events = extractPhase6Events(projectRoot);

  // ── 5. Cross-reference ────────────────────────────────────────────────
  for (const event of allEvents) {
    if (!phase4Events.has(event)) {
      violations.push({
        file: PHASE4_PATH,
        message: `Event "${event}" has no REQUIRED_FIELDS entry in Phase 4. Add the projection-required fields.`,
        severity: "error",
      });
    }
    if (!phase5Events.has(event)) {
      violations.push({
        file: PHASE5_PATH,
        message: `Event "${event}" has no test payload in Phase 5. Add a publish() entry to the domain's payload array.`,
        severity: "error",
      });
    }
    if (!phase6Events.has(event)) {
      violations.push({
        file: PHASE6_PATH,
        message: `Event "${event}" is not referenced in Phase 6 retained slice audit. Add a lifecycle or signal assertion.`,
        severity: "error",
      });
    }
  }

  const passedCount = allEvents.length * 3 - violations.length;

  return {
    gateId: GATE_ID,
    gateName: GATE_NAME,
    passed: violations.filter((v) => v.severity === "error").length === 0,
    violations,
    summary: `${allEvents.length} event(s) checked across Phase 4/5/6. ${violations.length} missing coverage entries.`,
    testedCount: allEvents.length * 3,
    passedCount,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractPhase4Events(projectRoot: string): Set<string> {
  const src = readSourceFile(PHASE4_PATH, projectRoot);
  if (!src) return new Set();

  // Match keys in REQUIRED_FIELDS: "event.name": [...]
  const keys = new Set<string>();
  for (const m of allMatches(
    src.content,
    /"([a-z][a-z0-9._-]+\.[a-z][a-z0-9._-]*)"\s*:\s*\[/g,
  )) {
    keys.add(m[1]);
  }
  return keys;
}

function extractPhase5Events(projectRoot: string): Set<string> {
  const src = readSourceFile(PHASE5_PATH, projectRoot);
  if (!src) return new Set();

  // Match publish("event.name", ...) calls
  const types = new Set<string>();
  for (const m of allMatches(
    src.content,
    /publish\s*\(\s*"([a-z][a-z0-9._-]+)"/g,
  )) {
    types.add(m[1]);
  }
  return types;
}

function extractPhase6Events(projectRoot: string): Set<string> {
  const src = readSourceFile(PHASE6_PATH, projectRoot);
  if (!src) return new Set();

  // Match all "event.name" string literals that are plausible event identifiers
  const events = new Set<string>();
  for (const m of allMatches(
    src.content,
    /"([a-z][a-z0-9-]*\.[a-z][a-z0-9._-]*)"/g,
  )) {
    events.add(m[1]);
  }
  return events;
}
