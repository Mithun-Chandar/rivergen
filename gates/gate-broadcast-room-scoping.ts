import path from "node:path";
import { collectFiles, readSourceFile, allMatches, lineOf } from "./utils.js";
import type { GateResult, GateViolation } from "./types.js";
import type { GeneratorConfig } from "../config.js";

const GATE_ID = "gate-broadcast-room";
const GATE_NAME =
  "Gate #5: Broadcast Room Scoping (PRIVATE entities → scoped rooms)";

/**
 * PRIVATE entity data MUST NOT be broadcast to workspace-wide rooms.
 *
 * Rule: if a broadcast function emits to a room pattern containing "workspace:"
 * or a bare `realm:` prefix AND there's a payload field suggesting an entity with
 * a visibility concept, flag it unless a visibility guard is present.
 *
 * v2 law:
 *   - User-scoped entities (notifications): io.to(`user:${userId}`)
 *   - Project-scoped entities:              io.to(`project:${projectId}`)
 *   - Public workspace-wide:               io.to(`workspace:${workspaceId}`)
 *
 * This gate flags:
 *   1. Any broadcast that emits to a workspace-wide room from a broadcaster
 *      that also receives a visibility field parameter — requires a guard.
 *   2. Any direct `io.emit(...)` calls (no room scoping at all).
 *
 * Scan scope: apps/api/src/**\/*.broadcast.ts
 *
 * ── PATTERN INVENTORY ──────────────────────────────────────────────────────
 * Update this section whenever templates/backend-broadcast.ts changes.
 *
 *   FAIL conditions (any triggers error):
 *     io.emit(…) with no room  →  /\bio\.emit\s*\(/ — broadcasts to ALL sockets
 *     workspace-room + visibility param (heuristic): io.to(`workspace:${…}`) in a
 *       function that also accepts a visibility/isPrivate param, without a guard branch
 *
 *   PASS heuristics:
 *     Visibility guard present (if/else before workspace: emit)
 *     Room resolved to user-scoped (user:) or entity-scoped (project:) string
 *
 * @templateRef templates/backend-broadcast.ts
 *   Template output: visibility-aware isPrivate guard + io.to(room).emit(eventName, payload)
 *   ⚠ NOTE: room value in the stub is a TODO placeholder — this gate does NOT validate that
 *     the room string resolves to a non-empty value. Fill the room TODO before deploying.
 */
export function runGateBroadcastRoomScoping(
  projectRoot: string,
  config: GeneratorConfig,
): GateResult {
  const violations: GateViolation[] = [];

  const apiSrc = path.join(projectRoot, config.api.srcRoot);
  const broadcastFiles = collectFiles(
    apiSrc,
    (name) => name.endsWith(".broadcast.ts"),
    projectRoot,
  );

  if (broadcastFiles.length === 0) {
    return {
      gateId: GATE_ID,
      gateName: GATE_NAME,
      passed: true,
      violations: [],
      summary: "No broadcast files found — nothing to check.",
      testedCount: 0,
      passedCount: 0,
    };
  }

  let passedCount = 0;

  for (const relPath of broadcastFiles) {
    const src = readSourceFile(relPath, projectRoot);
    if (!src) {
      violations.push({
        file: relPath,
        message: "Could not read file.",
        severity: "error",
      });
      continue;
    }

    let fileViolations = 0;

    // 1. Check for bare io.emit() with no room (broadcasts to ALL connected sockets)
    for (const m of allMatches(src.content, /\bio\.emit\s*\(/g)) {
      violations.push({
        file: relPath,
        line: lineOf(src.content, m.index),
        message:
          "io.emit() with no room is forbidden — broadcasts to ALL connected sockets. Always use io.to(room).emit().",
        severity: "error",
      });
      fileViolations++;
    }

    // 2. Flag workspace-wide emissions from broadcasters that accept a visibilityField-like param
    //    Heuristic: function accepts a param named "visibility" or "isPrivate" or the
    //    data object has a "visibility" property access — and emits to workspace:
    const fnMatches = allMatches(
      src.content,
      /(?:export\s+function|function)\s+\w+\s*\([^)]*\)\s*:\s*void\s*\{[^}]+\}/g,
    );

    for (const fnMatch of fnMatches) {
      const fnBody = fnMatch[0];
      const hasVisibilityParam = /\bvisibility\b|\bisPrivate\b/.test(fnBody);
      const emitsToWorkspace =
        /io\.to\s*\(\s*`workspace:/.test(fnBody) ||
        /io\.to\s*\(\s*`realm:/.test(fnBody);

      if (hasVisibilityParam && emitsToWorkspace) {
        const lineNum = lineOf(src.content, fnMatch.index);
        violations.push({
          file: relPath,
          line: lineNum,
          message:
            "Broadcaster function accepts a visibility parameter but emits to workspace-wide room. Add a visibility guard: if (visibility === 'PRIVATE') io.to(scopedRoom); else io.to(workspaceRoom).",
          severity: "error",
        });
        fileViolations++;
      }
    }

    // 3. Warn: workspace-wide emissions where the payload might contain private data
    //    (advisory warning — requires human review)
    for (const m of allMatches(
      src.content,
      /io\.to\s*\(\s*`workspace:[^`]+`\s*\)\.emit/g,
    )) {
      // Only warn if we haven't already flagged a visibility violation here
      const lineNum = lineOf(src.content, m.index);
      // Check if there's a visibility check in the surrounding 10 lines
      const lineStart = src.content.lastIndexOf("\n", m.index);
      const context = src.content.slice(
        Math.max(0, lineStart - 300),
        m.index + 200,
      );
      const hasVisibilityGuard =
        /visibility\s*===|isPrivate\s*===|if.*visibility|if.*private/i.test(
          context,
        );
      if (!hasVisibilityGuard) {
        violations.push({
          file: relPath,
          line: lineNum,
          message:
            "workspace-wide emit detected. Verify this entity cannot be PRIVATE. If it can, add a visibility guard.",
          severity: "warning",
        });
      }
    }

    if (fileViolations === 0) {
      passedCount++;
    }
  }

  const passed = violations.filter((v) => v.severity === "error").length === 0;

  return {
    gateId: GATE_ID,
    gateName: GATE_NAME,
    passed,
    violations,
    summary: `${passedCount}/${broadcastFiles.length} broadcast files comply with room scoping law.`,
    testedCount: broadcastFiles.length,
    passedCount,
  };
}
