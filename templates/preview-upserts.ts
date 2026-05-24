import type { DomainNames } from "../naming";

/**
 * Generates developer-readable upsert preview snippets.
 *
 * Phase 1 = CREATE mode only for new domain files. Shared pipeline files
 * require manual insertion (or Phase 2 inject mode). This function produces
 * the six code blocks that must be added to those shared files.
 *
 * Output is printed to stdout at the end of a successful rivergen plan or rivergen gen run.
 */
export function renderUpsertPreviews(n: DomainNames): string {
  const E = n.entityPascal;
  const e = n.entityKey;
  const d = n.domainKey;

  const eventConstantBlock = n.events
    .map((ev, i) => `  ${n.eventConstants[i]} = "${ev}",`)
    .join("\n");

  const schemaBlock = n.events
    .map((ev, i) => {
      return `  [RealtimeEvent.${n.eventConstants[i]}]: z.object({
    ${e}Id: z.string(),
    // TODO: add all required fields for ${ev}
    clientTempId: z.string().nullable().optional(),
  }).strict(),`;
    })
    .join("\n\n");

  const providerBlock = n.events
    .map((ev, i) => {
      return `      socket.on("${ev}", (payload) => {
        applyRealtimeEventToCache("${ev}", payload, queryClient);
      });`;
    })
    .join("\n\n");

  const dispatcherBlock = n.events
    .map((ev, i) => {
      return `      case "${ev}":
        apply${E}Projection(eventName, payload, queryClient);
        break;`;
    })
    .join("\n\n");

  const queryKeysBlock = `  ${e}: {
    all: ["${e}"] as const,
    lists: () => [...${e}Keys.all, "list"] as const,
    list: (ctx: Record<string, unknown>) => [...${e}Keys.lists(), ctx] as const,
    details: () => [...${e}Keys.all, "detail"] as const,
    detail: (id: string) => [...${e}Keys.details(), id] as const,
  },`;

  const entityRegistryBlock = `  {
    type: "${e}",
    queryKey: (ctx) => ${e}Keys.list(ctx),
    detailQueryKey: (id) => ${e}Keys.detail(id),
    // TODO: add identity and context extractors for this entity
  },`;

  const SEP = "─".repeat(72);

  return `
╔${"═".repeat(74)}╗
║  UPSERT PREVIEWS — Manual insertions required for shared pipeline files  ║
╚${"═".repeat(74)}╝

Add these snippets to the six shared files listed below.
Phase 2 "inject mode" will automate this. For now: copy-paste.

${SEP}
📄  ${n.typesEventsFile}
    Add to the RealtimeEvent enum:
${SEP}

${eventConstantBlock}

${SEP}
📄  ${n.schemasFile}
    Add to the schemas map (EventFactory validates these at publish time):
${SEP}

${schemaBlock}

${SEP}
📄  ${n.providerFile}
    Add inside useEffect (after existing socket.on calls):
${SEP}

${providerBlock}

${SEP}
📄  ${n.dispatcherFile}
    Add inside the switch(eventName) block:
${SEP}

${dispatcherBlock}

${SEP}
📄  ${n.queryKeysFile}
    Add the ${E} key factory:
${SEP}

${queryKeysBlock}

${SEP}
📄  ${n.entityRegistryFile}
    Register the entity in the projection registry:
${SEP}

${entityRegistryBlock}

${"═".repeat(76)}
  After adding all snippets above, run:
    pnpm run gate:11 && pnpm run gate:12 && pnpm run gate:13
${"═".repeat(76)}
`;
}
