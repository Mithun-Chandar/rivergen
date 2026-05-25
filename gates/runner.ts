import { runGate1 } from "./gate1-mutation-event.js";
import { runGate2 } from "./gate2-event-listener-ws.js";
import { runGate3 } from "./gate3-ws-dispatcher-projection.js";
import { runGate4 } from "./gate4-projection-entity-cache.js";
import { runGateBroadcastRoomScoping } from "./gate-broadcast-room-scoping.js";
import { runGateSchemaCoverage } from "./gate-schema-coverage.js";
import { runGateSchemaStrict } from "./gate-schema-strict.js";
import { runGateProviderIsolation } from "./gate-provider-isolation.js";
import { runGateOnSuccessBan } from "./gate-onsuccess-ban.js";
import { runGateOptimisticCoverage } from "./gate-optimistic-coverage.js";
import { runGateAuditCoverage } from "./gate-audit-coverage.js";
import { runGateWitnessCoverage } from "./gate-witness-coverage.js";
import type { GateResult, RunnerReport } from "./types.js";
import { loadConfig } from "../config.js";

// ─── Runner ────────────────────────────────────────────────────────────────────

/**
 * Runs all twelve gates against the project at `projectRoot`.
 * Returns a RunnerReport with results from every gate.
 *
 * Exit: allPassed is true only when every gate has no error-severity violations.
 * Warning-only gates are counted as passing.
 *
 * Gate inventory:
 *   Gate #1  — Mutation → EventFactory.publish (no socket.emit / eventBus bypass)
 *   Gate #2  — Event → Listener → Broadcaster → socket.emit
 *   Gate #3  — WS socket.on → Dispatcher → Projection call
 *   Gate #4  — Projection → entity-cache helpers
 *   Gate #5  — Broadcast room scoping (PRIVATE → scoped rooms)
 *   Gate #6  — EventFactory schema coverage (every emitted event has a schema)
 *   Gate #7  — Schema .strict() enforcement (every z.object() uses .strict())
 *   Gate #8  — Provider isolation (no entity-cache in WebSocketProvider)
 *   Gate #9  — No cache writes in onSuccess (WS projection owns convergence)
 *   Gate #10 — Optimistic coverage (every useMutation has onMutate + onError)
 *   Gate #11 — Audit coverage (every event in Phase 4/5/6)
 *   Gate #12 — Witness coverage (every broadcast event has a witness file entry)
 */
export async function runAllGates(projectRoot: string): Promise<RunnerReport> {
  const config = loadConfig(projectRoot);

  const results: GateResult[] = [
    runGate1(projectRoot, config),
    runGate2(projectRoot, config),
    runGate3(projectRoot, config),
    runGate4(projectRoot, config),
    runGateBroadcastRoomScoping(projectRoot, config),
    runGateSchemaCoverage(projectRoot, config),
    runGateSchemaStrict(projectRoot, config),
    runGateProviderIsolation(projectRoot, config),
    runGateOnSuccessBan(projectRoot, config),
    runGateOptimisticCoverage(projectRoot, config),
    runGateAuditCoverage(projectRoot, config),
    await runGateWitnessCoverage(projectRoot, config),
  ];

  const allPassed = results.every((r) => r.skipped || r.passed);

  return {
    projectRoot,
    timestamp: new Date().toISOString(),
    allPassed,
    results,
  } satisfies RunnerReport;
}

// ─── Report renderer ───────────────────────────────────────────────────────────

const PASS = "✓";
const FAIL = "✗";
const WARN = "⚠";
const SKIP = "○";
const SEP = "─".repeat(72);

export function renderReport(report: RunnerReport): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("  RiverGen — Gate Verification Report");
  lines.push(`  Project: ${report.projectRoot}`);
  lines.push(`  Run at:  ${report.timestamp}`);
  lines.push("");

  for (const result of report.results) {
    const icon = result.skipped ? SKIP : result.passed ? PASS : FAIL;
    lines.push(SEP);
    lines.push(`  ${icon}  ${result.gateName}`);
    lines.push(`     ${result.summary}`);

    // Informational notes (e.g. Gate #12 Layer 3 stub status)
    if (result.notes && result.notes.length > 0) {
      lines.push("");
      for (const note of result.notes) {
        lines.push(`     ${WARN}  ${note}`);
      }
    }

    if (result.violations.length > 0) {
      lines.push("");

      const errors = result.violations.filter((v) => v.severity === "error");
      const warnings = result.violations.filter(
        (v) => v.severity === "warning",
      );

      for (const v of errors) {
        const loc = v.line ? `:${v.line}` : "";
        lines.push(`     ${FAIL}  [ERROR] ${v.file}${loc}`);
        lines.push(`            ${v.message}`);
      }

      for (const v of warnings) {
        const loc = v.line ? `:${v.line}` : "";
        lines.push(`     ${WARN}  [WARN]  ${v.file}${loc}`);
        lines.push(`            ${v.message}`);
      }
    }
    lines.push("");
  }

  lines.push(SEP);

  const skippedGates = report.results.filter((r) => r.skipped).length;
  const activeResults = report.results.filter((r) => !r.skipped);
  const errorCount = activeResults.reduce(
    (n, r) => n + r.violations.filter((v) => v.severity === "error").length,
    0,
  );
  const warnCount = activeResults.reduce(
    (n, r) => n + r.violations.filter((v) => v.severity === "warning").length,
    0,
  );
  const passedGates = activeResults.filter((r) => r.passed).length;
  const totalActive = activeResults.length;

  if (report.allPassed) {
    lines.push(
      `  ${PASS}  ALL GATES PASSED (${passedGates}/${totalActive}${skippedGates > 0 ? `, ${skippedGates} skipped` : ""})`,
    );
    if (warnCount > 0) {
      lines.push(
        `  ${WARN}  ${warnCount} advisory warning(s) — review recommended.`,
      );
    }
  } else {
    const failedGates = activeResults.filter((r) => !r.passed).length;
    const skipNote = skippedGates > 0 ? `, ${skippedGates} skipped` : "";
    lines.push(
      `  ${FAIL}  ${failedGates}/${totalActive} GATE(S) FAILED — ${errorCount} error(s), ${warnCount} warning(s)${skipNote}`,
    );
    lines.push("");
    lines.push("  Gates must pass before the scaffold is considered lawful.");
    lines.push(
      "  Add the missing pipeline stages then re-run: rivergen verify",
    );
  }

  lines.push(SEP);
  lines.push("");

  return lines.join("\n");
}
