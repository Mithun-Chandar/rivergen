import path from "node:path";
import { collectFiles, readSourceFile, allMatches, lineOf } from "./utils";
import type { GateResult, GateViolation } from "./types";
import type { GeneratorConfig } from "../config";

const GATE_ID = "gate1";
const GATE_NAME = "Gate #1: Mutation → EventFactory.publish";

/**
 * Every mutation file under apps/api/src/ must:
 *   1. Import `eventFactory` (the singleton) or `EventFactory`
 *   2. Call `.publish(` at least once
 *
 * A mutation file with neither is either a stub that hasn't been wired yet,
 * or it's emitting events via a forbidden path.
 *
 * Scan scope: apps/api/src/**\/*.mutations.ts
 *
 * ── PATTERN INVENTORY ──────────────────────────────────────────────────────
 * Update this section whenever templates/backend-mutations.ts changes.
 *
 *   PASS conditions (all must be present):
 *     EventFactory import  →  /import\s+.*(eventFactory|EventFactory)/
 *     .publish(            →  /\.publish\s*\(/
 *
 *   FAIL conditions (any triggers error):
 *     io.to(…).emit(       →  /io\.to\s*\(.*\)\.emit\s*\(/
 *     socket.emit(         →  /socket\.emit\s*\(/
 *     eventBus.publish(    →  /\beventBus\.publish\s*\(/
 *
 * @templateRef templates/backend-mutations.ts
 *   Template output: EventFactory.publish("event.name", {...})
 *   Gate alignment:  checks EventFactory import + .publish() call ✓
 */
export function runGate1(projectRoot: string, config: GeneratorConfig): GateResult {
  const violations: GateViolation[] = [];

  const apiSrc = path.join(projectRoot, config.api.srcRoot);
  const mutationFiles = collectFiles(
    apiSrc,
    (name) => name.endsWith(".mutations.ts"),
    projectRoot,
  );

  if (mutationFiles.length === 0) {
    return {
      gateId: GATE_ID,
      gateName: GATE_NAME,
      passed: true,
      violations: [],
      summary: "No mutation files found — nothing to check.",
      testedCount: 0,
      passedCount: 0,
    };
  }

  let passedCount = 0;

  for (const relPath of mutationFiles) {
    const src = readSourceFile(relPath, projectRoot);
    if (!src) {
      violations.push({
        file: relPath,
        message: "Could not read file.",
        severity: "error",
      });
      continue;
    }

    const hasEventFactoryImport =
      /import\s+.*eventFactory/.test(src.content) ||
      /import\s+.*EventFactory/.test(src.content);

    const hasPublishCall = /\.publish\s*\(/.test(src.content);

    if (!hasEventFactoryImport) {
      violations.push({
        file: relPath,
        message:
          "Missing eventFactory import. Every mutation must import and use eventFactory.publish().",
        severity: "error",
      });
    }

    if (!hasPublishCall) {
      violations.push({
        file: relPath,
        message:
          "No .publish() call found. Every mutation must emit an event via eventFactory.publish().",
        severity: "error",
      });
    }

    // Detect forbidden direct socket emission
    const directEmitMatches = allMatches(
      src.content,
      /io\.to\s*\(.*\)\.emit\s*\(/g,
    );
    for (const m of directEmitMatches) {
      violations.push({
        file: relPath,
        line: lineOf(src.content, m.index),
        message:
          "Direct socket.emit() in mutation file is forbidden. Use eventFactory.publish() — the EventBus listener handles socket emission.",
        severity: "error",
      });
    }

    // Check for socket.emit() and eventBus.publish() bypass on non-comment lines
    const lines = src.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//")) continue; // skip comment lines

      if (/socket\.emit\s*\(/.test(lines[i])) {
        violations.push({
          file: relPath,
          line: i + 1,
          message:
            "Direct socket.emit() in mutation file is forbidden. Use eventFactory.publish().",
          severity: "error",
        });
      }

      // Detect direct eventBus.publish() bypass — must go through EventFactory
      if (/\beventBus\.publish\s*\(/.test(lines[i])) {
        violations.push({
          file: relPath,
          line: i + 1,
          message:
            "Direct eventBus.publish() in mutation file is forbidden. EventFactory.publish() is the only legal event emission path. EventFactory validates the payload schema and then delegates to EventBus internally.",
          severity: "error",
        });
      }
    }

    if (hasEventFactoryImport && hasPublishCall) {
      passedCount++;
    }
  }

  const passed = violations.filter((v) => v.severity === "error").length === 0;

  return {
    gateId: GATE_ID,
    gateName: GATE_NAME,
    passed,
    violations,
    summary: `${passedCount}/${mutationFiles.length} mutation files wired to eventFactory.publish().`,
    testedCount: mutationFiles.length,
    passedCount,
  };
}
