import fs from "node:fs";
import path from "node:path";
import type { GeneratorConfig } from "../config.js";

// ─── File discovery ────────────────────────────────────────────────────────────

/**
 * Recursively collects all files under `dir` whose names match `predicate`.
 * Returns paths relative to `projectRoot`.
 */
export function collectFiles(
  dir: string,
  predicate: (filename: string) => boolean,
  projectRoot: string,
): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && predicate(entry.name)) {
        results.push(path.relative(projectRoot, full));
      }
    }
  }

  walk(path.isAbsolute(dir) ? dir : path.join(projectRoot, dir));
  return results;
}

/**
 * Reads a file and returns { content, lines } for regex matching.
 * Returns null if the file cannot be read.
 */
export function readSourceFile(
  relPath: string,
  projectRoot: string,
): { content: string; lines: string[] } | null {
  const absPath = path.join(projectRoot, relPath);
  if (!fs.existsSync(absPath)) return null;
  try {
    const content = fs.readFileSync(absPath, "utf-8");
    return { content, lines: content.split("\n") };
  } catch {
    return null;
  }
}

// ─── Pattern matchers ──────────────────────────────────────────────────────────

/**
 * Returns all non-overlapping matches of `pattern` in `content`.
 * pattern must have the global flag.
 */
export function allMatches(
  content: string,
  pattern: RegExp,
): RegExpExecArray[] {
  if (!pattern.global) throw new Error("Pattern must have global flag");
  const results: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(pattern.source, pattern.flags);
  while ((m = re.exec(content)) !== null) {
    results.push(m);
  }
  return results;
}

/**
 * Approximate 1-based line number for a character offset in content.
 */
export function lineOf(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

// ─── WorkspaceEvent proxy resolver ────────────────────────────────────────────

/**
 * Replicates the WorkspaceEvent Proxy logic from event-bus.service.ts.
 *
 * WorkspaceEvent.NOTIFICATION_CREATED → "notification.created"
 * Unless overridden in WORKSPACE_EVENT_OVERRIDES.
 */
const WORKSPACE_EVENT_OVERRIDES: Record<string, string> = {
  ADMIN_OWNERSHIP_TRANSFERRED: "admin.ownership.transferred",
  ADMIN_REALM_SETTINGS_UPDATED: "admin.realm.settings.updated",
  ADMIN_REVOKED: "admin.revoked",
  EVENT_RSVP_CHANGED: "event.rsvp.changed",
  FILE_LINKED_TO_TASK: "file.linked.task",
  FILE_UNLINKED_FROM_TASK: "file.unlinked.task",
  FILE_VERSION_CREATED: "file.version-created",
  KANBAN_CURSOR_MOVED: "kanban.cursor.moved",
  REALM_CREATED: "realm.created",
  REALM_DELETED: "realm.deleted",
  TASK_EDIT_LOCK_CHANGED: "task.edit.lock.changed",
  TASK_GHOST_DRAGGING_CHANGED: "task.ghost.dragging.changed",
  USER_PRESENCE_CHANGED: "user.presence.changed",
  VIEWERS_CHANGED: "viewers.changed",
};

export function resolveWorkspaceEvent(constant: string): string {
  return (
    WORKSPACE_EVENT_OVERRIDES[constant] ??
    constant.toLowerCase().replace(/_/g, ".")
  );
}

// ─── Broadcast event discovery ────────────────────────────────────────────────

/**
 * Discovers all event names emitted by broadcast files under the API src root.
 * Shared by the audit gate and gate-witness-coverage.
 *
 * Two patterns detected:
 *   io.to(...).emit("event.name", ...)   — direct socket emit
 *   broadcastX(io, "event.name", ...)    — broadcast helper call
 */
export function discoverBroadcastEvents(
  projectRoot: string,
  config: GeneratorConfig,
): string[] {
  const apiSrc = path.join(projectRoot, config.api.srcRoot);
  const events = new Set<string>();

  const broadcastFiles = collectFiles(
    apiSrc,
    (name) => name.endsWith(".broadcast.ts"),
    projectRoot,
  );

  for (const relPath of broadcastFiles) {
    const src = readSourceFile(relPath, projectRoot);
    if (!src) continue;
    for (const m of allMatches(
      src.content,
      /\.emit\s*\(\s*["']([a-z][a-z0-9._-]+)["']/g,
    )) {
      events.add(m[1]);
    }
    for (const m of allMatches(
      src.content,
      /\(io,\s*["']([a-z][a-z0-9._-]+)["']/g,
    )) {
      events.add(m[1]);
    }
  }

  return [...events].sort();
}

// ─── String-based scan helpers ─────────────────────────────────────────────────

/**
 * Extracts all string literals double-quoted in the form "event.name" that
 * could plausibly be event identifiers (dot-notation, no spaces).
 */
export function extractQuotedEventStrings(content: string): string[] {
  const matches = allMatches(
    content,
    /"([a-z][a-z0-9._-]*\.[a-z][a-z0-9._-]*)"/g,
  );
  return [...new Set(matches.map((m) => m[1]))];
}

/**
 * Given a file's content, returns all "case X:" string values from a switch
 * statement where X is either a string literal or a RealtimeEvent.Y member.
 *
 * Returns the raw string values (resolved from RealtimeEvent if possible).
 */
export function extractSwitchCases(
  content: string,
  realtimeEventMap: Record<string, string>,
): string[] {
  const results: string[] = [];

  // case "event.name":
  for (const m of allMatches(content, /case\s+"([a-z][a-z0-9._-]+)":/g)) {
    results.push(m[1]);
  }
  // case RealtimeEvent.Foo:
  for (const m of allMatches(content, /case\s+RealtimeEvent\.(\w+):/g)) {
    const val = realtimeEventMap[m[1]];
    if (val) results.push(val);
  }
  return [...new Set(results)];
}

// ─── RealtimeEvent value map extractor ────────────────────────────────────────

/**
 * Reads the realtime-events file and builds a map of
 * { PascalName: "event.string" } from the RealtimeEvent const object.
 */
export function loadRealtimeEventMap(
  projectRoot: string,
  config: GeneratorConfig,
): Record<string, string> {
  const filePath = config.packages.typesEventsFile;
  const src = readSourceFile(filePath, projectRoot);
  if (!src) return {};

  const map: Record<string, string> = {};
  for (const m of allMatches(
    src.content,
    /(\w+)\s*:\s*"([a-z][a-z0-9._-]+)"/g,
  )) {
    map[m[1]] = m[2];
  }
  return map;
}

// ─── EventPayloadSchemas key extractor ────────────────────────────────────────

/**
 * Reads the EventFactory schema files and returns all registered event type strings.
 * Checks both the legacy monolithic schemas.ts and the slice pattern schemas/<domain>.ts.
 */
export function loadRegisteredEventTypes(
  projectRoot: string,
  config: GeneratorConfig,
): string[] {
  const results = new Set<string>();

  // ── Legacy path: monolithic schemas.ts ────────────────────────────────────
  const legacySrc = readSourceFile(config.api.schemasFile, projectRoot);
  if (legacySrc) {
    for (const m of allMatches(
      legacySrc.content,
      /"([a-z][a-z0-9._-]+)"\s*:\s*z\s*\./g,
    )) {
      results.add(m[1]);
    }
  }

  // ── Slice pattern: schemas/<domain>.ts files ───────────────────────────────
  const schemasDir = path.join(projectRoot, config.api.schemasDir);
  if (fs.existsSync(schemasDir)) {
    for (const filename of fs.readdirSync(schemasDir)) {
      if (
        !filename.endsWith(".ts") ||
        filename.startsWith("_") // skip _index.ts, _base.ts, _types.ts
      ) {
        continue;
      }
      const slicePath = `${config.api.schemasDir}/${filename}`;
      const src = readSourceFile(slicePath, projectRoot);
      if (!src) continue;
      for (const m of allMatches(
        src.content,
        /"([a-z][a-z0-9._-]+)"\s*:\s*z\s*\./g,
      )) {
        results.add(m[1]);
      }
    }
  }

  return [...results];
}
