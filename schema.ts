import { z } from "zod";

// ─── Primitives ────────────────────────────────────────────────────────────────

/**
 * Event names MUST use dot notation: "entity.action"
 * Colon notation ("entity:action") is a v1 legacy form and is REJECTED here.
 */
const eventNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/,
    'Event names must use dot notation: "entity.action" (e.g. "invoice.created"). Colon notation is forbidden.',
  );

const roomSchema = z.object({
  /**
   * Template string for the socket.io room.
   * Use ${workspaceId}, ${projectId}, etc. as placeholders.
   * e.g. "workspace:${workspaceId}" | "project:${projectId}"
   */
  template: z.string().min(1),
  /**
   * Optional: field name on the entity payload that determines room scoping.
   * When set, the broadcaster checks payload[visibilityField] before
   * deciding whether to emit to the scoped room or the workspace-wide room.
   * PRIVATE entities must always set this.
   * e.g. "visibility" — check payload.visibility === "PRIVATE"
   */
  visibilityField: z.string().optional(),
  /**
   * Optional: room template for PRIVATE entities.
   * Required when visibilityField is set — without it the generator emits a TODO.
   * Uses the same ${varName} syntax as room.template.
   * e.g. "user:${assigneeId}" — PRIVATE entities go to the assignee's personal room.
   */
  privateRoomTemplate: z.string().optional(),
});

// ─── Main spec ─────────────────────────────────────────────────────────────────

export const v2DomainSpecSchema = z.object({
  /**
   * Always 2 — rejects any v1 spec accidentally fed to this generator.
   */
  version: z.literal(2),

  domain: z.object({
    /** kebab-case domain key: "invoice", "work-order", "subscription" */
    key: z
      .string()
      .regex(
        /^[a-z][a-z0-9-]*$/,
        "domain.key must be kebab-case: lowercase letters, digits, and hyphens only.",
      ),
    /** Human-readable display name: "Invoice", "Work Order", "Subscription" */
    displayName: z.string().min(1),
  }),

  entity: z.object({
    /**
     * camelCase entity key: "invoice", "workOrder", "subscription"
     * Used for variable names, import paths, and query key factories.
     */
    key: z
      .string()
      .regex(
        /^[a-z][a-zA-Z0-9]*$/,
        "entity.key must be camelCase, starting with a lowercase letter.",
      ),
    /**
     * Lowercase-hyphen event prefix for this entity's events.
     * All events[] entries must start with this prefix.
     * e.g. "invoice" → events must be "invoice.created", "invoice.updated", etc.
     */
    eventPrefix: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, "entity.eventPrefix must be kebab-case."),
  }),

  /**
   * Ordered list of domain events this entity produces.
   * All must use dot notation. Minimum: one event (typically created/updated/deleted).
   */
  events: z.array(eventNameSchema).min(1, "At least one event is required."),

  /** Socket.io room configuration for broadcast scoping. */
  room: roomSchema,
});

export type V2DomainSpec = z.infer<typeof v2DomainSpecSchema>;

// ─── Validation entry point ─────────────────────────────────────────────────────

export function validateSpec(
  raw: unknown,
): { ok: true; spec: V2DomainSpec } | { ok: false; errors: string[] } {
  const result = v2DomainSpecSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, spec: result.data };
  }
  const errors = result.error.issues.map(
    (issue) => `[${issue.path.join(".")}] ${issue.message}`,
  );
  return { ok: false, errors };
}
