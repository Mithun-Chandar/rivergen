/**
 * Template: init-entity-projections-types
 *
 * Produces: packages/shared/src/entity-projections/_types.ts
 *
 * Written once by rivergen init. Contains the shared TS types for the entity
 * projection registry (QueryKey, ProjectionFn, EntityProjectionEntry).
 *
 * Domain slices import from "./_types" and the barrel re-exports from here
 * so consumers only need to import from entity-projections/_index.
 */
export function renderEntityProjectionTypes(): string {
  return `// Shared type definitions for the entity-cache projection registry.
// Written by rivergen init. Do not edit — these types are fundamental infrastructure.

export type QueryKey = readonly unknown[];

export type ProjectionFn<TEntity = unknown, TContext = unknown> = (
  entity: TEntity,
  context?: TContext,
) => QueryKey | QueryKey[] | null;

export interface EntityProjectionEntry<TEntity = unknown, TContext = unknown> {
  ownedKeyFactories: string[];
  onCreate: {
    required: ProjectionFn<TEntity, TContext>[];
    invalidate: ProjectionFn<TEntity, TContext>[];
  };
  onUpdate: {
    required: ProjectionFn<TEntity, TContext>[];
    invalidate: ProjectionFn<TEntity, TContext>[];
  };
  onDelete: {
    invalidate: QueryKey[];
  };
}
`;
}
