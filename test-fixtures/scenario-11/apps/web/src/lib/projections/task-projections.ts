// BUG: This file imports React — causes Gate #12 Layer 3 subprocess to crash
// when this file is statically imported by the witness file.
import React from "react";
import { applyEntityCreate } from "../cache/entity-cache";

export function applyTaskProjection(
  payload: Record<string, unknown>,
  queryClient: unknown,
): void {
  applyEntityCreate(queryClient, ["tasks", payload.projectId], payload);
}

// Gate #4 passes because applyEntityCreate is called — but Gate #12 Layer 3
// fails at runtime because the subprocess cannot import React.
export const TaskCard = () => React.createElement("div", null, "Task");
