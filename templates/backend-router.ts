import type { DomainNames } from "../naming";

/**
 * Generates the Express router stub for a domain.
 *
 * STUB — fill in business logic where marked TODO.
 * Routes follow REST conventions. Each handler calls the corresponding
 * mutation function which owns EventFactory.publish().
 */
export function renderBackendRouter(n: DomainNames): string {
  const E = n.entityPascal;
  const e = n.entityKey;
  const d = n.domainKey;

  return `import { Router, type Request, type Response } from "express";
import {
  create${E},
  update${E},
  delete${E},
} from "./${d}.mutations";

// TODO: import your auth/permission middleware
// import { requirePermission } from "../lib/auth/permissions";

export const ${e}Router = Router();

// ── GET /:id ──────────────────────────────────────────────────────────────────
${e}Router.get("/:id", async (req: Request, res: Response) => {
  // TODO: requirePermission(req, "${d}:read")
  // TODO: look up entity by req.params.id and return it
  res.status(501).json({ error: "Not implemented" });
});

// ── GET / (list) ──────────────────────────────────────────────────────────────
${e}Router.get("/", async (req: Request, res: Response) => {
  // TODO: requirePermission(req, "${d}:read")
  // TODO: list entities with filtering/pagination from req.query
  res.status(501).json({ error: "Not implemented" });
});

// ── POST / (create) ───────────────────────────────────────────────────────────
${e}Router.post("/", async (req: Request, res: Response) => {
  // TODO: requirePermission(req, "${d}:create")
  const result = await create${E}(req.body, req);
  res.status(201).json(result);
});

// ── PATCH /:id (update) ───────────────────────────────────────────────────────
${e}Router.patch("/:id", async (req: Request, res: Response) => {
  // TODO: requirePermission(req, "${d}:update")
  const result = await update${E}(req.params.id, req.body, req);
  res.json(result);
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
${e}Router.delete("/:id", async (req: Request, res: Response) => {
  // TODO: requirePermission(req, "${d}:delete")
  await delete${E}(req.params.id, req);
  res.status(204).end();
});
`;
}
