// Minimal valid WebSocketProvider — no domain events bound
export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  return children as JSX.Element;
}
