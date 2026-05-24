#!/usr/bin/env node
/**
 * Layer 3 subprocess worker — projection proof runner.
 *
 * Invoked by layer3-runner.ts via child_process.exec:
 *   node --import tsx/esm layer3-worker.ts <projectRoot> <relPath1> [relPath2] ...
 *
 * Outputs a single JSON object (Layer3BatchResult) to stdout.
 * Any import failure or thrown exception is captured and reported as violations.
 *
 * Running in a subprocess gives us:
 *   - A clean module graph with no ESM cycles from the gate runner's context
 *   - Process isolation: a crashing witness file doesn't kill the verifier
 *   - Node.js-compatible import context independent of the parent process
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

// ─── Types (inlined — no gate imports to avoid any possible cycle) ────────────

interface GateViolation {
  file: string;
  line?: number;
  message: string;
  severity: "error" | "warning";
}

interface Layer3FileResult {
  witnessFile: string;
  importFailed: boolean;
  skipped: boolean;
  skipReason?: string;
  violations: GateViolation[];
  passedAssertions: number;
  totalAssertions: number;
}

interface Layer3BatchResult {
  violations: GateViolation[];
  activeFiles: number;
  skippedFiles: number;
  importFailedFiles: number;
  totalAssertions: number;
  passedAssertions: number;
}

// ─── QueryClient resolution ────────────────────────────────────────────────────
//
// Always use MinimalQueryClient — never the real @tanstack/query-core QueryClient.
//
// The real QueryClient.setQueriesData({ type: "active" }, ...) only iterates
// queries that have live React observers. In this subprocess there are none,
// so any projection that calls setQueriesData({ type: "active" }) would be a
// no-op, silently leaving caches stale and causing deletion assertions to fail.
//
// MinimalQueryClient treats every stored entry as active, which is the correct
// behaviour for a headless field-continuity proof runner.

type QueryClientCtor = new () => unknown;

function resolveQueryClientCtor(): QueryClientCtor {
  return MinimalQueryClient;
}

class MinimalQueryClient {
  private _cache = new Map<string, unknown>();

  getQueryData<T>(key: unknown[]): T | undefined {
    return this._cache.get(JSON.stringify(key)) as T | undefined;
  }

  setQueryData(key: unknown[], data: unknown): void {
    this._cache.set(JSON.stringify(key), data);
  }

  async prefetchQuery(opts: {
    queryKey: unknown[];
    queryFn: () => unknown;
  }): Promise<void> {
    const data = await opts.queryFn();
    this.setQueryData(opts.queryKey, data);
  }

  async invalidateQueries(): Promise<void> {}

  // Implements the predicate/queryKey/type filter pattern used by entity-cache.
  setQueriesData(
    filters: {
      predicate?: (q: { queryKey: unknown[] }) => boolean;
      queryKey?: unknown[];
      type?: string;
    },
    updater: (data: unknown) => unknown,
  ): void {
    for (const [keyStr, data] of this._cache.entries()) {
      const queryKey: unknown[] = JSON.parse(keyStr) as unknown[];
      let matches = true;
      if (filters.predicate) {
        try { matches = filters.predicate({ queryKey }); } catch { matches = false; }
      } else if (filters.queryKey) {
        const prefix = filters.queryKey;
        matches = prefix.every((v, i) => queryKey[i] === v);
      }
      // { type: "active" } → all entries in our in-memory cache are treated as active
      if (matches) {
        this._cache.set(keyStr, updater(data));
      }
    }
  }

  getQueriesData<T>(
    filters: {
      predicate?: (q: { queryKey: unknown[] }) => boolean;
      queryKey?: unknown[];
    } = {},
  ): [unknown[], T | undefined][] {
    const results: [unknown[], T | undefined][] = [];
    for (const [keyStr, data] of this._cache.entries()) {
      const queryKey: unknown[] = JSON.parse(keyStr) as unknown[];
      let matches = true;
      if (filters.predicate) {
        try { matches = filters.predicate({ queryKey }); } catch { matches = false; }
      } else if (filters.queryKey) {
        const prefix = filters.queryKey;
        matches = prefix.every((v, i) => queryKey[i] === v);
      }
      if (matches) results.push([queryKey, data as T | undefined]);
    }
    return results;
  }
}

// ─── Witness export discovery ─────────────────────────────────────────────────

interface WitnessLike {
  domain: string;
  lifecycle: (qc: unknown) => Promise<unknown[]>;
  signals: Record<string, (qc: unknown) => Promise<unknown[]>>;
}

function findWitnessExport(
  mod: Record<string, unknown>,
): WitnessLike | null {
  for (const val of Object.values(mod)) {
    if (
      val !== null &&
      typeof val === "object" &&
      typeof (val as Record<string, unknown>).domain === "string" &&
      typeof (val as Record<string, unknown>).lifecycle === "function" &&
      typeof (val as Record<string, unknown>).signals === "object"
    ) {
      return val as WitnessLike;
    }
  }
  return null;
}

// ─── Per-file runner ──────────────────────────────────────────────────────────

async function processFile(
  relPath: string,
  projectRoot: string,
): Promise<Layer3FileResult> {
  const absPath = path.resolve(projectRoot, relPath);
  const fileUrl = pathToFileURL(absPath).href;

  let mod: Record<string, unknown>;
  try {
    mod = await import(fileUrl);
  } catch (err) {
    return {
      witnessFile: relPath,
      importFailed: true,
      skipped: false,
      violations: [
        {
          file: relPath,
          message: `Layer 3: cannot import witness file — ${String(err).split("\n")[0]}. Ensure projection imports are Node.js-compatible (no window/document/React hooks at the module level).`,
          severity: "warning",
        },
      ],
      passedAssertions: 0,
      totalAssertions: 0,
    };
  }

  const witness = findWitnessExport(mod);
  if (!witness) {
    return {
      witnessFile: relPath,
      importFailed: false,
      skipped: true,
      skipReason: "No DomainWitness export found",
      violations: [],
      passedAssertions: 0,
      totalAssertions: 0,
    };
  }

  const Ctor = resolveQueryClientCtor();

  type Assertion = { name: string; ok: boolean; detail?: string };
  const allAssertions: Assertion[] = [];

  try {
    const results = (await witness.lifecycle(new Ctor())) as Assertion[];
    allAssertions.push(...results);
  } catch (err) {
    allAssertions.push({
      name: "lifecycle() threw an exception",
      ok: false,
      detail: String(err),
    });
  }

  for (const [eventName, signalFn] of Object.entries(witness.signals)) {
    try {
      const results = (await signalFn(new Ctor())) as Assertion[];
      allAssertions.push(...results);
    } catch (err) {
      allAssertions.push({
        name: `signals["${eventName}"]() threw an exception`,
        ok: false,
        detail: String(err),
      });
    }
  }

  if (allAssertions.length === 0) {
    return {
      witnessFile: relPath,
      importFailed: false,
      skipped: true,
      skipReason:
        "lifecycle() and signals{} return empty arrays — fill in assertions",
      violations: [],
      passedAssertions: 0,
      totalAssertions: 0,
    };
  }

  const failed = allAssertions.filter((a) => !a.ok);
  const violations: GateViolation[] = failed.map((a) => ({
    file: relPath,
    message: `Layer 3: assertion "${a.name}" failed.${a.detail ? ` ${a.detail}` : ""}`,
    severity: "error" as const,
  }));

  return {
    witnessFile: relPath,
    importFailed: false,
    skipped: false,
    violations,
    passedAssertions: allAssertions.filter((a) => a.ok).length,
    totalAssertions: allAssertions.length,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const [, , projectRoot, ...relPaths] = process.argv;

if (!projectRoot || relPaths.length === 0) {
  process.stdout.write(
    JSON.stringify({
      violations: [],
      activeFiles: 0,
      skippedFiles: 0,
      importFailedFiles: 0,
      totalAssertions: 0,
      passedAssertions: 0,
    } satisfies Layer3BatchResult),
  );
  process.exit(0);
}

const fileResults = await Promise.all(
  relPaths.map((f) => processFile(f, projectRoot)),
);

const batch: Layer3BatchResult = {
  violations: fileResults.flatMap((r) => r.violations),
  activeFiles: fileResults.filter((r) => !r.importFailed && !r.skipped).length,
  skippedFiles: fileResults.filter((r) => r.skipped).length,
  importFailedFiles: fileResults.filter((r) => r.importFailed).length,
  totalAssertions: fileResults.reduce((n, r) => n + r.totalAssertions, 0),
  passedAssertions: fileResults.reduce((n, r) => n + r.passedAssertions, 0),
};

process.stdout.write(JSON.stringify(batch));
