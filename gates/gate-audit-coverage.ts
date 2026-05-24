import { readSourceFile, allMatches, discoverBroadcastEvents } from "./utils";
import type { GateResult, GateViolation } from "./types";
import type { GeneratorConfig } from "../config";

const GATE_ID = "gate-audit-coverage";
const GATE_NAME = "Gate: Event Audit Coverage";

/**
 * Every event discovered by the generator must also be covered
 * by the three manual audit artifacts in `config.auditDir`:
 *
 *   phase4-payload-continuity-audit.ts  —  REQUIRED_FIELDS entry (payload continuity)
 *   phase5-test-payloads.ts             —  test payload (trace coverage replay)
 *   phase6-retained-slice-audit.ts      —  slice assertion reference (retained slice audit)
 *
 * Without coverage in all three, a domain can pass gen:verify 10/10
 * while the audit gate silently ignores the event, causing regression.
 *
 * This gate is skipped entirely when none of the three files exist at
 * `config.auditDir` — which is the default for projects that have not
 * yet set up the payload audit files.
 *
 * Discovery: re-uses the same broadcast-file emit scan that gates
 * #2 and schema-coverage use, producing the canonical event list.
 */
export function runGateAuditCoverage(projectRoot: string, config: GeneratorConfig): GateResult {
  const violations: GateViolation[] = [];

  const auditDir = config.auditDir ?? "witness";
  const PHASE4_PATH = `${auditDir}/phase4-payload-continuity-audit.ts`;
  const PHASE5_PATH = `${auditDir}/phase5-test-payloads.ts`;
  const PHASE6_PATH = `${auditDir}/phase6-retained-slice-audit.ts`;

  // Skip if no audit artifacts are present.
  // Expected for projects not yet using the payload audit files.
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
  const allEvents = discoverBroadcastEvents(projectRoot, config);

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
  const phase4Events = extractPhase4Events(projectRoot, PHASE4_PATH);

  // ── 3. Scan Phase 5 test payload type strings ─────────────────────────
  const phase5Events = extractPhase5Events(projectRoot, PHASE5_PATH);

  // ── 4. Scan Phase 6 for event name references ─────────────────────────
  const phase6Events = extractPhase6Events(projectRoot, PHASE6_PATH);

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

function extractPhase4Events(projectRoot: string, filePath: string): Set<string> {
  const src = readSourceFile(filePath, projectRoot);
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

function extractPhase5Events(projectRoot: string, filePath: string): Set<string> {
  const src = readSourceFile(filePath, projectRoot);
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

function extractPhase6Events(projectRoot: string, filePath: string): Set<string> {
  const src = readSourceFile(filePath, projectRoot);
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
