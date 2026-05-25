import type { DomainNames } from "../naming.js";

/**
 * Generates the mutations file for a domain.
 *
 * LAW: Every mutation MUST call eventFactory.publish() — no bypass paths.
 * Business logic lives here. EventFactory owns event emission.
 *
 * STUB — fill in DB calls and payload construction where marked TODO.
 */
export function renderBackendMutations(
  n: DomainNames,
  dbImport?: string,
): string {
  const E = n.entityPascal;
  const e = n.entityKey;
  const d = n.domainKey;

  // Derive event names for each standard operation
  const createdEvent =
    n.events.find((ev) => ev.endsWith(".created")) ?? n.events[0];
  const updatedEvent = n.events.find((ev) => ev.endsWith(".updated"));
  const deletedEvent = n.events.find((ev) => ev.endsWith(".deleted"));

  const updateBlock = updatedEvent
    ? `
// ── update${E} ─────────────────────────────────────────────────────────────────
export async function update${E}(
  id: string,
  data: Record<string, unknown>,
  req: Request,
): Promise<Record<string, unknown>> {
  const userId = requireUserId(req);
  // TODO: validate data with zod
  // TODO: look up entity, check ownership/permissions
  // TODO: persist changes to DB
  const ${e} = { id, ...data /* TODO: fetch from DB */ };

  // LAW: event emission goes through EventFactory only
  await eventFactory.publish({
    type: "${updatedEvent}",
    resourceId: id,
    actor: { id: userId, type: "user" },
    context: { realmId: "TODO" /* projectId or workspaceId */ },
    correlationId: randomUUID(),
    eventVersion: "1.0",
    payload: {
      ${e}Id: id,
      // TODO: include all required fields (must match schemas.ts entry)
      clientTempId: (data.clientTempId as string) ?? null,
    },
  });

  return ${e};
}
`
    : "";

  const deleteBlock = deletedEvent
    ? `
// ── delete${E} ─────────────────────────────────────────────────────────────────
export async function delete${E}(
  id: string,
  req: Request,
): Promise<void> {
  const userId = requireUserId(req);
  // TODO: look up entity, check ownership/permissions
  // TODO: soft-delete or hard-delete from DB

  // LAW: event emission goes through EventFactory only
  await eventFactory.publish({
    type: "${deletedEvent}",
    resourceId: id,
    actor: { id: userId, type: "user" },
    context: { realmId: "TODO" /* projectId or workspaceId */ },
    correlationId: randomUUID(),
    eventVersion: "1.0",
    payload: {
      ${e}Id: id,
      // TODO: include all required fields (must match schemas.ts entry)
    },
  });
}
`
    : "";

  const dbImportLine = dbImport
    ? `import ${dbImport};`
    : `// TODO: import your DB client here (e.g. import { prisma } from "../lib/db")`;

  return `import type { Request } from "express";
import { randomUUID } from "node:crypto";
${dbImportLine}
import { EventFactory } from "../lib/event-factory/event-factory.service";

const eventFactory = new EventFactory();

function requireUserId(req: Request): string {
  const userId = req.session?.userId as string | undefined;
  if (!userId)
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  return userId;
}

// ── create${E} ─────────────────────────────────────────────────────────────────
export async function create${E}(
  data: Record<string, unknown>,
  req: Request,
): Promise<Record<string, unknown>> {
  const userId = requireUserId(req);
  // TODO: validate data with zod
  // TODO: persist to DB
  const ${e} = { id: "TODO", ...data };

  // LAW: event emission goes through EventFactory only
  await eventFactory.publish({
    type: "${createdEvent}",
    resourceId: ${e}.id,
    actor: { id: userId, type: "user" },
    context: { realmId: "TODO" /* projectId or workspaceId */ },
    correlationId: randomUUID(),
    eventVersion: "1.0",
    payload: {
      ${e}Id: ${e}.id,
      // TODO: include all required fields (must match schemas.ts entry)
      clientTempId: (data.clientTempId as string) ?? null,
    },
  });

  return ${e};
}
${updateBlock}${deleteBlock}`;
}
