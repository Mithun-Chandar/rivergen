import type { DomainNames } from "../naming";

/**
 * Generates the domain hook file for the frontend.
 *
 * Produces: use${E}List, use${E}, useCreate${E}, useUpdate${E}, useDelete${E}
 *
 * LAW:
 *   - onMutate must set up optimistic state + rollback
 *   - onError must roll back optimistic state
 *   - onSuccess must NOT mutate cache (server truth arrives via WS projection)
 *   - Cache keys come from query-keys.ts factory (never hardcoded)
 *
 * STUB — fill in API calls, entity types, and context derivation.
 */
export function renderFrontendHook(n: DomainNames): string {
  const E = n.entityPascal;
  const e = n.entityKey;
  const d = n.domainKey;

  // Parse ${varName} placeholders from room template (same logic as query-keys slice).
  // e.g. "project:${projectId}" → roomVars=["projectId"], roomParams="projectId: string"
  const roomVars = [...n.roomTemplate.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);
  const roomParams = roomVars.map((v) => `${v}: string`).join(", ");
  // Produces: { projectId } or {}
  const roomCtxArg = roomVars.length > 0 ? `{ ${roomVars.join(", ")} }` : `{}`;
  // Produces the typed ctx block for onMutate room comments
  const roomScopeComment = roomVars.length > 0
    ? `// Room scope: ${n.roomTemplate}`
    : `// No room scope — adjust list key if needed`;
  // Signature fragment for hooks that need the list scope
  const scopedParam = roomVars.length > 0 ? `\n  ${roomParams},` : ``;

  const createdEvent =
    n.events.find((ev) => ev.endsWith(".created")) ?? n.events[0];
  const updatedEvent = n.events.find((ev) => ev.endsWith(".updated"));
  const deletedEvent = n.events.find((ev) => ev.endsWith(".deleted"));

  const updateMutation = updatedEvent
    ? `
// ── useUpdate${E} ──────────────────────────────────────────────────────────────
export function useUpdate${E}() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<${E}Input>;
    }) => {
      // TODO: replace with real API call
      const res = await fetch(\`/api/\${d}/\${id}\`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<${E}>;
    },
    onMutate: async ({ id, data }) => {
      ${roomScopeComment}
      const listKey = ${e}Keys.list(${roomCtxArg});
      await queryClient.cancelQueries({ queryKey: listKey });
      const prev = queryClient.getQueryData<${E}[]>(listKey);
      if (Array.isArray(prev)) {
        queryClient.setQueryData<${E}[]>(
          listKey,
          prev.map((item) => (item.id === id ? { ...item, ...data } : item)),
        );
      }
      return { prev, listKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev !== undefined) {
        queryClient.setQueryData(context.listKey, context.prev);
      }
    },
    // onSuccess: intentionally omitted — WS projection handles cache convergence
  });
}
`
    : "";

  const deleteMutation = deletedEvent
    ? `
// ── useDelete${E} ──────────────────────────────────────────────────────────────
export function useDelete${E}() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // TODO: replace with real API call
      const res = await fetch(\`/api/\${d}/\${id}\`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
    },
    onMutate: async (id) => {
      ${roomScopeComment}
      const listKey = ${e}Keys.list(${roomCtxArg});
      await queryClient.cancelQueries({ queryKey: listKey });
      const prev = queryClient.getQueryData<${E}[]>(listKey);
      if (Array.isArray(prev)) {
        queryClient.setQueryData<${E}[]>(
          listKey,
          prev.filter((item) => item.id !== id),
        );
      }
      return { prev, listKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev !== undefined) {
        queryClient.setQueryData(context.listKey, context.prev);
      }
    },
    // onSuccess: intentionally omitted — WS projection handles cache convergence
  });
}
`
    : "";

  // Room join hook — only generated when the spec has a room template with vars
  const roomJoinHook = roomVars.length > 0
    ? `
// ── useJoin${E}Room ────────────────────────────────────────────────────────────
// LAW: the server broadcasts ${d} events to a scoped socket.io room.
// The client MUST join that room or it will never receive those events.
// Call this hook on the page/component that owns the ${d} context.
//
// Pattern:
//   const { socket, connected } = useWebSocket();
//   useEffect(() => {
//     if (connected && socket) socket.emit("join:${d}", ${roomVars[0] ?? "id"});
//   }, [connected, socket, ${roomVars[0] ?? "id"}]);
//
// TODO: replace the useEffect above with the correct room variable from your route.
// The room template for this domain is: ${n.roomTemplate}
`
    : "";

  return `import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { ${e}Keys } from "../lib/query-keys";
${roomJoinHook}

// TODO: import your real ${E} types once defined
// import type { ${E}, ${E}Input } from "your-types-package";
type ${E} = Record<string, unknown> & { id: string };
type ${E}Input = Record<string, unknown>;

// ── use${E}List ────────────────────────────────────────────────────────────────
export function use${E}List(${scopedParam}
  options?: Partial<UseQueryOptions<${E}[]>>,
) {
  return useQuery<${E}[]>({
    queryKey: ${e}Keys.list(${roomCtxArg}),
    queryFn: async () => {
      // TODO: replace with real API call
      const res = await fetch("/api/${d}");
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<${E}[]>;
    },
    ...options,
  });
}

// ── use${E} ────────────────────────────────────────────────────────────────────
export function use${E}(
  id: string,
  options?: Partial<UseQueryOptions<${E}>>,
) {
  return useQuery<${E}>({
    queryKey: ${e}Keys.detail(id),
    queryFn: async () => {
      // TODO: replace with real API call
      const res = await fetch(\`/api/${d}/\${id}\`);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<${E}>;
    },
    enabled: !!id,
    ...options,
  });
}

// ── useCreate${E} ──────────────────────────────────────────────────────────────
export function useCreate${E}() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: ${E}Input) => {
      // LAW: onMutate stamps data.clientTempId before this runs — send data as-is
      // TODO: replace with real API call
      const res = await fetch("/api/${d}", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<${E}>;
    },
    onMutate: async (data) => {
      // LAW: stamp clientTempId onto data — mutationFn sends data as-is, so the
      // server receives the same ID the ghost uses. Never generate it independently
      // in mutationFn — that produces a divergent ID and the ghost never reconciles.
      if (!data.clientTempId) data.clientTempId = \`temp-${e}-\${Date.now()}\`;
      const clientTempId = data.clientTempId;
      ${roomScopeComment}
      const listKey = ${e}Keys.list(${roomCtxArg});
      await queryClient.cancelQueries({ queryKey: listKey });
      const prev = queryClient.getQueryData<${E}[]>(listKey);
      // Array.isArray guard required — a plain object under a cold cache passes
      // a bare if(prev) truthy check and causes [...prev, ghost] to throw TypeError
      const ghost: ${E} = { id: clientTempId, ...data, _isOptimistic: true } as ${E};
      queryClient.setQueryData<${E}[]>(listKey, [...(Array.isArray(prev) ? prev : []), ghost]);
      return { prev, listKey, clientTempId };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev !== undefined) {
        queryClient.setQueryData(context.listKey, context.prev);
      }
    },
    // onSuccess: intentionally omitted — WS projection handles ID reconciliation
  });
}
${updateMutation}${deleteMutation}`;
}
