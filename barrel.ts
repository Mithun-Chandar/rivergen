import fs from "node:fs";
import path from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Names of files in a slice dir that are NOT domain slices. */
const RESERVED_FILENAMES = new Set([
  "_index.ts",
  "_base.ts",
  "_types.ts",
  "index.ts", // Vite proxy barrel written by gen:init — never a domain slice
]);

// ─── Barrel regeneration ─────────────────────────────────────────────────────

/**
 * Scans a slice directory for domain slice files and returns the sorted list
 * of domain keys (filename without .ts extension, excluding reserved files).
 *
 * e.g. for ["_index.ts", "_types.ts", "notification.ts", "task.ts"]
 *   → ["notification", "task"]
 */
export function scanDomainKeys(sliceDir: string): string[] {
  if (!fs.existsSync(sliceDir)) return [];

  return fs
    .readdirSync(sliceDir)
    .filter((name) => name.endsWith(".ts") && !RESERVED_FILENAMES.has(name))
    .map((name) => name.slice(0, -3)) // strip .ts
    .sort();
}

/**
 * Regenerates a barrel _index.ts by:
 *   1. Scanning the slice directory for domain slice files
 *   2. Calling renderFn(domainKeys) to produce the new barrel content
 *   3. Writing the result to barrelPath (overwrite always — barrel is generated)
 *
 * This is called by gen:domain AFTER all slice files have been written.
 * It is also called by gen:init with an empty domainKeys list.
 */
export function regenerateBarrel(
  sliceDir: string,
  barrelPath: string,
  renderFn: (domainKeys: string[]) => string,
): void {
  const domainKeys = scanDomainKeys(sliceDir);
  const content = renderFn(domainKeys);
  fs.mkdirSync(path.dirname(barrelPath), { recursive: true });
  fs.writeFileSync(barrelPath, content, "utf-8");
}

// ─── Collision detection ─────────────────────────────────────────────────────

/**
 * Scans all existing dispatcher slice files in dispatchersDir for event name
 * strings that collide with the provided events list.
 *
 * Returns a list of collision descriptors (one per collision).
 * Returns empty array if no collisions found.
 *
 * Heuristic: looks for quoted event names in the file content.
 * This catches `"invoice.created":` and `"invoice.created",` patterns.
 */
export function detectCollisions(
  events: string[],
  dispatchersDir: string,
  incomingDomainKey: string,
): CollisionResult[] {
  if (!fs.existsSync(dispatchersDir)) return [];

  const collisions: CollisionResult[] = [];

  const sliceFiles = fs
    .readdirSync(dispatchersDir)
    .filter(
      (name) =>
        name.endsWith(".ts") &&
        !RESERVED_FILENAMES.has(name) &&
        name !== `${incomingDomainKey}.ts`,
    );

  for (const file of sliceFiles) {
    const existingDomain = file.slice(0, -3);
    const content = fs.readFileSync(path.join(dispatchersDir, file), "utf-8");

    for (const event of events) {
      // Match: "event.name": or "event.name",
      const pattern = new RegExp(`"${escapeRegex(event)}"\\s*[:,]`);
      if (pattern.test(content)) {
        collisions.push({ event, existingDomain, file });
      }
    }
  }

  return collisions;
}

export interface CollisionResult {
  event: string;
  existingDomain: string;
  file: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
