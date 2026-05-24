/**
 * Static parsing helpers for Witness gate checks (Layers 1–3).
 *
 * All functions work on raw file content strings — no dynamic import, no AST.
 * The patterns are intentionally conservative: a "not found" result produces
 * no violation rather than a false positive.
 */

import { allMatches } from "./utils";

// ─── Regex escape ─────────────────────────────────────────────────────────────

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Witness file parsing ─────────────────────────────────────────────────────

/**
 * Extracts the domain key from a witness file.
 * Matches: domain: "my-domain"
 */
export function parseWitnessDomain(content: string): string | null {
  const m = /domain\s*:\s*["']([a-z][a-z0-9-]*)["']/.exec(content);
  return m ? m[1] : null;
}

/**
 * Extracts the requiredFields map from a witness file.
 *
 * Relies on the fact that requiredFields values are flat arrays `[...]`
 * while testPayloads values are nested objects `{...}`. The regex
 * `"event": [...]` therefore only matches requiredFields entries.
 *
 * Returns: Map<eventName, fieldName[]>
 * Empty arrays are treated as "not yet filled" — included in the map but
 * not treated as violations (Layer 1 only flags non-empty entries).
 */
export function parseWitnessRequiredFields(
  content: string,
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  // Scope to the requiredFields block only (before testPayloads)
  const rfStart = content.indexOf("requiredFields");
  const tpStart = content.indexOf("testPayloads", rfStart);
  const section =
    rfStart !== -1 && tpStart !== -1
      ? content.slice(rfStart, tpStart)
      : rfStart !== -1
        ? content.slice(rfStart)
        : content;

  // "event.name": ["field1", "field2"]
  for (const m of allMatches(
    section,
    /"([a-z][a-z0-9._-]+)"\s*:\s*\[([^\]]*)\]/g,
  )) {
    const eventName = m[1];
    const arrayContent = m[2];
    const fields = arrayContent
      .split(",")
      .map((s) =>
        s
          .trim()
          .replace(/^["'`]|["'`]$/g, "")
          .trim(),
      )
      .filter(
        (s) => s.length > 0 && !s.startsWith("//") && /^[a-zA-Z_]/.test(s),
      );
    map.set(eventName, fields);
  }

  return map;
}

// ─── Zod schema parsing ───────────────────────────────────────────────────────

/**
 * Extracts the top-level field names declared in a z.object({...}) for a
 * specific event in a schema slice file.
 *
 * Handles both single-line and multi-line z.object() declarations.
 * Returns null if the event is not found in the file.
 *
 * Strategy:
 *   1. Locate `"event.name":` in the file
 *   2. Scan forward to find `object({`
 *   3. Balance-scan `{...}` to extract the body
 *   4. Extract all `identifier:` keys from the body
 */
export function extractSchemaFields(
  content: string,
  eventName: string,
): string[] | null {
  const escaped = escapeRegex(eventName);

  // Find the event entry
  const eventRegex = new RegExp(`"${escaped}"\\s*:`);
  const eventMatch = eventRegex.exec(content);
  if (!eventMatch) return null;

  const searchFrom = eventMatch.index;

  // Find z.object( after the event name (bound: next 500 chars to avoid false jumps)
  const searchBound = Math.min(searchFrom + 500, content.length);
  const objKeyword = content.indexOf("object(", searchFrom);
  if (objKeyword === -1 || objKeyword > searchBound) return null;

  // Find the opening { of z.object({
  const braceOpen = content.indexOf("{", objKeyword);
  if (braceOpen === -1 || braceOpen > searchBound + 50) return null;

  // Balance-scan to find the matching closing }
  let depth = 0;
  let braceClose = -1;
  for (let i = braceOpen; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) {
        braceClose = i;
        break;
      }
    }
  }
  if (braceClose === -1) return null;

  const body = content.slice(braceOpen + 1, braceClose);

  // Strip nested {...} blocks so we only see top-level field keys.
  // Without this, a field like `metadata: z.object({ key: z.string() })`
  // would also yield `key` as a false top-level match.
  // Also handles single-line objects: z.object({ noteId: z.string(), title: z.string() })
  let flatBody = "";
  let nestDepth = 0;
  for (const ch of body) {
    if (ch === "{") nestDepth++;
    else if (ch === "}") nestDepth--;
    else if (nestDepth === 0) flatBody += ch;
  }

  // Match all `identifier:` patterns in the flat (nested-stripped) body.
  const fields: string[] = [];
  for (const m of allMatches(flatBody, /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)) {
    fields.push(m[1]);
  }

  return [...new Set(fields)];
}

// ─── Broadcast pass-through detection ────────────────────────────────────────

export type BroadcastStyle = "pass-through" | "selective" | "unknown";

/**
 * Detects whether a broadcast file uses pass-through or selective emit.
 *
 * Pass-through: io.to(...).emit(eventName, payload) — entire payload object forwarded
 * Selective:    io.to(...).emit("event", { field: payload.field, ... })
 *
 * The generator always produces pass-through broadcasts. Selective is only
 * possible via manual edits. When selective, Layer 2 will inspect the fields.
 */
export function detectBroadcastStyle(content: string): BroadcastStyle {
  // All emit calls in this file
  const emitMatches = [
    ...allMatches(content, /\.emit\s*\(([^)]+)\)/g),
  ];

  if (emitMatches.length === 0) return "unknown";

  for (const m of emitMatches) {
    const args = m[1].trim();
    // Selective: second argument starts with { (object literal)
    // Pattern: emit(something, {  or  emit("event", {
    if (/,\s*\{/.test(args)) return "selective";
  }

  return "pass-through";
}

/**
 * For a selective broadcast file, extracts the field names included in each
 * emit call's payload object literal.
 *
 * Returns: Map<eventName, fieldName[]>
 * Only covers events that have a dedicated selective emit call.
 */
export function extractSelectiveBroadcastFields(
  content: string,
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  // Find: .emit("event.name", { field: payload.field, ... })
  for (const m of allMatches(
    content,
    /\.emit\s*\(\s*["']([a-z][a-z0-9._-]+)["']\s*,\s*\{([^}]*)\}/g,
  )) {
    const eventName = m[1];
    const bodyContent = m[2];

    // Extract field names from the object literal: "fieldName: ..."
    const fields: string[] = [];
    for (const fm of allMatches(
      bodyContent,
      /([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,
    )) {
      fields.push(fm[1]);
    }
    map.set(eventName, fields);
  }

  return map;
}
