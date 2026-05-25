import { applyEntityCreate } from "../lib/cache/entity-cache";

// BUG: WebSocketProvider must not import entity-cache
export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const handleEvent = (payload: unknown) => {
    applyEntityCreate(
      "task",
      payload as Record<string, unknown>,
      {},
      {} as never,
    );
  };
  return children as JSX.Element;
}
