import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { MockShell } from "./mock";
import { TauriShell, isTauri } from "./tauri";
import type { ShellActions, ShellState } from "./types";

interface ShellContextValue {
  state: ShellState;
  actions: ShellActions;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellRoot({ children }: { children: ReactNode }) {
  const provider = useMemo(() => (isTauri() ? new TauriShell() : new MockShell()), []);
  const state = useSyncExternalStore(
    (cb) => provider.subscribe(cb),
    () => provider.snapshot()
  );
  const value = useMemo(() => ({ state, actions: provider.actions }), [state, provider]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell outside <ShellRoot>");
  return ctx;
}
