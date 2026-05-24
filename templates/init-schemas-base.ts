/**
 * Template: init-schemas-base
 *
 * Produces: apps/api/src/lib/event-factory/schemas/_base.ts
 *
 * Written once by rivergen init. Contains the Zod schemas for the event envelope
 * (EventEnvelopeSchema, EventActorSchema, EventContextSchema, EventOriginSchema)
 * plus their inferred TypeScript types.
 *
 * Domain payload schemas live in schemas/<domain>.ts slices.
 * The barrel schemas/_index.ts re-exports everything from here plus the domain slices.
 */
export function renderSchemasBase(): string {
  return `import { z } from "zod";

// ---------------------------------------------------------------------------
// Actor / Context / Origin / Envelope — structural schemas for every event
// These never change per domain.
// ---------------------------------------------------------------------------

export const EventActorSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["user", "system", "service"]),
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
  })
  .strict();

export const EventContextSchema = z
  .object({
    realmId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    channelId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
  })
  .strict();

export const EventOriginSchema = z
  .object({
    service: z.string().min(1),
    instanceId: z.string().min(1),
  })
  .strict();

export const EventEnvelopeSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string().min(1),
    envelopeVersion: z.string().min(1),
    eventVersion: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
    resourceId: z.string().min(1),
    actor: EventActorSchema,
    context: EventContextSchema,
    payload: z.unknown(),
    correlationId: z.string().min(1),
    origin: EventOriginSchema,
  })
  .strict();

export type EventActor = z.infer<typeof EventActorSchema>;
export type EventContext = z.infer<typeof EventContextSchema>;
export type EventOrigin = z.infer<typeof EventOriginSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
`;
}
