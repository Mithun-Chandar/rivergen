import path from "node:path";
import { collectFiles, readSourceFile, allMatches, lineOf } from "./utils.js";
import type { GateResult, GateViolation } from "./types.js";
import type { GeneratorConfig } from "../config.js";

const GATE_ID = "gate4";
const GATE_NAME = "Gate #4: Projection → entity-cache helpers";

/**
 * Every projection file must:
 *   1. Import at least one of: applyEntityCreate, applyEntityUpdate, applyEntityDelete
 *   2. Call that helper in at least one exported function
 *
 * This enforces that projections never write to React Query cache directly.
 * All cache mutations must route through the entity-cache registry helpers.
 *
 * EXEMPTION: Files containing the annotation
 *   // gate4:map-projection
 * are map-type projections (e.g. Record<key, count>) that cannot use entity-cache
 * helpers because they don't store entity arrays. These files may use
 * queryClient.setQueryData<T>() directly. They still must NOT use the non-generic
 * queryClient.setQueryData( form without a type parameter.
 *
 * Scan scope: apps/web/src/lib/projections/**\/*-projections.ts
 *
 * ── PATTERN INVENTORY ──────────────────────────────────────────────────────
 * Update this section whenever templates/frontend-projection.ts changes.
 *
 *   PASS conditions for entity-list projections (all must be present):
 *     entity-cache helper import  →  /applyEntityCreate|applyEntityUpdate|applyEntityDelete/
 *     entity-cache helper call    →  /applyEntity(?:Create|Update|Delete)\s*\(/
 *
 *   PASS conditions for map projections (file has // gate4:map-projection):
 *     No non-generic setQueryData  →  /queryClient\.setQueryData\s*\(/ must NOT appear
 *     Generic setQueryData IS allowed  →  queryClient.setQueryData<T>() is fine
 *
 *   FAIL conditions for entity-list projections (any triggers error):
 *     queryClient.setQueryData(   →  /queryClient\.setQueryData(?:<[^>]+>)?\s*\(/
 *
 * @templateRef templates/frontend-projection.ts
 *   Template output: imports applyEntityCreate/Update/Delete + calls them in every projection fn ✓
 *   Gate alignment:  checks both the import and the absence of direct setQueryData ✓
 */
export function runGate4(
  projectRoot: string,
  config: GeneratorConfig,
): GateResult {
  const violations: GateViolation[] = [];

  const projectionsDir = path.join(projectRoot, config.web.projectionsDir);
  const projectionFiles = collectFiles(
    projectionsDir,
    (name) =>
      name.endsWith("-projections.ts") || name.endsWith("projections.ts"),
    projectRoot,
  );

  if (projectionFiles.length === 0) {
    return {
      gateId: GATE_ID,
      gateName: GATE_NAME,
      passed: true,
      violations: [],
      summary: "No projection files found — nothing to check.",
      testedCount: 0,
      passedCount: 0,
    };
  }

  let passedCount = 0;

  for (const relPath of projectionFiles) {
    const src = readSourceFile(relPath, projectRoot);
    if (!src) {
      violations.push({
        file: relPath,
        message: "Could not read file.",
        severity: "error",
      });
      continue;
    }

    const isMapProjection = src.content.includes("// gate4:map-projection");

    if (isMapProjection) {
      // Map-type projections (e.g. Record<key, count>) don't use entity-cache helpers.
      // They may use queryClient.setQueryData<T>() but must NOT use the non-generic
      // queryClient.setQueryData( form (which would indicate a missing type annotation).
      const bareSetDataMatches = allMatches(
        src.content,
        /queryClient\.setQueryData\s*\(/g,
      );
      for (const m of bareSetDataMatches) {
        violations.push({
          file: relPath,
          line: lineOf(src.content, m.index),
          message:
            "Map projection uses non-generic setQueryData(). Use setQueryData<MapType>() with an explicit type parameter.",
          severity: "error",
        });
      }
    } else {
      // Standard entity-list projection: must use entity-cache helpers, no direct setQueryData.

      // 1. Check for entity-cache helper imports
      const hasEntityCacheImport =
        /applyEntityCreate|applyEntityUpdate|applyEntityDelete/.test(
          src.content,
        );

      if (!hasEntityCacheImport) {
        violations.push({
          file: relPath,
          message:
            "No entity-cache helpers imported. Projection files must import applyEntityCreate, applyEntityUpdate, or applyEntityDelete from entity-cache. For map-type projections, add // gate4:map-projection to the top of the file.",
          severity: "error",
        });
      }

      // 2. Check for direct cache mutations (forbidden) — bare form only.
      // Note: queryClient.setQueryData<T>() (with explicit generic) is permitted
      // for synchronous removal operations (Projection Removal Law). Only the
      // non-generic bare form — setQueryData( without <T> — indicates missing
      // type annotation and is treated as forbidden.
      const directSetDataMatches = allMatches(
        src.content,
        /queryClient\.setQueryData\s*\(/g,
      );
      for (const m of directSetDataMatches) {
        violations.push({
          file: relPath,
          line: lineOf(src.content, m.index),
          message:
            "Direct queryClient.setQueryData() in projection file is forbidden. Use applyEntityCreate/Update/Delete from entity-cache.",
          severity: "error",
        });
      }

      // 3. Check exported functions actually call entity-cache helpers
      const exportedFns: string[] = [];
      for (const m of allMatches(
        src.content,
        /export\s+(?:async\s+)?function\s+(\w+)/g,
      )) {
        exportedFns.push(m[1]);
      }

      let fileHasEntityCall = false;
      for (const _m of allMatches(
        src.content,
        /applyEntity(?:Create|Update|Delete)\s*\(/g,
      )) {
        fileHasEntityCall = true;
        break;
      }

      if (exportedFns.length > 0 && !fileHasEntityCall) {
        violations.push({
          file: relPath,
          message: `Exports ${exportedFns.length} function(s) but none call applyEntityCreate/Update/Delete. Wire at least one entity-cache helper call.`,
          severity: "error",
        });
      }
    }

    const fileErrors = violations.filter(
      (v) => v.file === relPath && v.severity === "error",
    );
    if (fileErrors.length === 0) {
      passedCount++;
    }
  }

  const passed = violations.filter((v) => v.severity === "error").length === 0;

  return {
    gateId: GATE_ID,
    gateName: GATE_NAME,
    passed,
    violations,
    summary: `${passedCount}/${projectionFiles.length} projection files use entity-cache helpers correctly.`,
    testedCount: projectionFiles.length,
    passedCount,
  };
}
