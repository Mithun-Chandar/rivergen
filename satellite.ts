import fs from "node:fs";
import path from "node:path";
import type { DomainNames } from "./naming";
import type { GeneratorConfig } from "./config";

// ─── Satellite file auto-registration ──────────────────────────────────────────
//
// These files need new entries for every domain but are NOT overwritten by
// barrel regeneration. We append/insert entries idempotently.

/**
 * Register domain events in packages/shared/src/event-entity-map.ts.
 *
 * Inserts entries like:
 *   "doc.created": { entity: "doc", operation: "create" },
 *   "doc.updated": { entity: "doc", operation: "update" },
 *   "doc.deleted": { entity: "doc", operation: "delete" },
 */
export function registerEventEntityMap(
  projectRoot: string,
  n: DomainNames,
): void {
  const filePath = path.join(
    projectRoot,
    "packages/shared/src/event-entity-map.ts",
  );
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, "utf-8");

  // Check if already registered
  if (content.includes(`"${n.events[0]}"`)) return;

  // Build entries
  const entries = n.events.map((event) => {
    const action = event.split(".").slice(1).join("-");
    let operation: string;
    if (action === "created") operation = "create";
    else if (action === "deleted") operation = "delete";
    else operation = "update";
    return `  "${event}": { entity: "${n.entityKey}", operation: "${operation}" },`;
  });

  // Insert before the closing `};`
  const closingIndex = content.lastIndexOf("};");
  if (closingIndex === -1) return;

  const insertion = entries.join("\n") + "\n";
  content =
    content.slice(0, closingIndex) + insertion + content.slice(closingIndex);

  fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * Register domain events in apps/web/src/providers/ws-event-cache-audit.ts.
 *
 * Inserts an entry like:
 *   doc: {
 *     events: ["doc.created", "doc.deleted", "doc.updated"],
 *   },
 */
export function registerWsEventCacheAudit(
  projectRoot: string,
  n: DomainNames,
): void {
  const filePath = path.join(
    projectRoot,
    "apps/web/src/providers/ws-event-cache-audit.ts",
  );
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, "utf-8");

  // Check if already registered
  if (content.includes(`"${n.domainKey}":`)) return;

  // Build sorted event list
  const sortedEvents = [...n.events].sort();
  const eventStrings = sortedEvents.map((e) => `      "${e}",`).join("\n");

  const entry = `  "${n.domainKey}": {\n    events: [\n${eventStrings}\n    ],\n  },\n`;

  // Insert before the closing `};`
  const closingIndex = content.lastIndexOf("};");
  if (closingIndex === -1) return;

  content =
    content.slice(0, closingIndex) + entry + content.slice(closingIndex);

  fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * Register domain listener in the phase5-trace-coverage-audit.ts file.
 * The file is located at `auditDir/phase5-trace-coverage-audit.ts`.
 * If the file does not exist the function returns silently.
 *
 * Adds:
 *   1. An import line: import { registerDocListeners } from "../../apps/api/...";
 *   2. A registration call: registerDocListeners(io);
 */
export function registerPhase5Listener(
  projectRoot: string,
  n: DomainNames,
  auditDir: string,
): void {
  const filePath = path.join(
    projectRoot,
    `${auditDir}/phase5-trace-coverage-audit.ts`,
  );
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, "utf-8");

  const fnName = `register${n.entityPascal}Listeners`;

  // Check if already registered
  if (content.includes(fnName)) return;

  // 1. Add import — insert before the `import { registerOracleListeners }` line
  //    (Oracle is always last since it's the catch-all AI domain)
  const oracleImport = `import { registerOracleListeners }`;
  const importLine = `import { ${fnName} } from "../../apps/api/src/lib/event-bus-listeners/${n.domainKey}.listener";\n`;

  const oracleIdx = content.indexOf(oracleImport);
  if (oracleIdx !== -1) {
    content =
      content.slice(0, oracleIdx) + importLine + content.slice(oracleIdx);
  }

  // 2. Add registration call — insert before `registerOracleListeners(io);`
  const oracleCall = `  registerOracleListeners(io);`;
  const callLine = `  ${fnName}(io);\n`;

  const oracleCallIdx = content.indexOf(oracleCall);
  if (oracleCallIdx !== -1) {
    content =
      content.slice(0, oracleCallIdx) + callLine + content.slice(oracleCallIdx);
  }

  fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * Run all satellite registrations for a domain.
 * Only returns files that actually exist in the project and were updated.
 * Files absent from the project are silently skipped and not reported.
 */
export function registerSatelliteFiles(
  projectRoot: string,
  n: DomainNames,
  config?: GeneratorConfig,
): string[] {
  const auditDir = config?.auditDir ?? "witness";
  const phase5Path = `${auditDir}/phase5-trace-coverage-audit.ts`;

  const satellites: Array<{
    file: string;
    register: (projectRoot: string, n: DomainNames) => void;
  }> = [
    { file: "packages/shared/src/event-entity-map.ts", register: registerEventEntityMap },
    { file: "apps/web/src/providers/ws-event-cache-audit.ts", register: registerWsEventCacheAudit },
    { file: phase5Path, register: (p, d) => registerPhase5Listener(p, d, auditDir) },
  ];

  const registered: string[] = [];

  for (const { file, register } of satellites) {
    if (!fs.existsSync(path.join(projectRoot, file))) continue;
    try {
      register(projectRoot, n);
      registered.push(file);
    } catch {
      /* non-fatal */
    }
  }

  return registered;
}
