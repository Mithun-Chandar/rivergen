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
      // Optimistic patch
      if (prev) {
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
      // Optimistic removal
      if (prev) {
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

  return `import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { ${e}Keys } from "../lib/query-keys";

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
      // TODO: replace with real API call + include clientTempId
      const res = await fetch("/api/${d}", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<${E}>;
    },
    onMutate: async (data) => {
      const clientTempId = \`temp-${e}-\${Date.now()}-\${Math.random()}\`;
      ${roomScopeComment}
      const listKey = ${e}Keys.list(${roomCtxArg});
      await queryClient.cancelQueries({ queryKey: listKey });
      const prev = queryClient.getQueryData<${E}[]>(listKey);
      // Optimistic insertion with ghost placeholder
      const ghost: ${E} = { id: clientTempId, ...data, _isOptimistic: true } as ${E};
      if (prev) {
        queryClient.setQueryData<${E}[]>(listKey, [...prev, ghost]);
      }
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
