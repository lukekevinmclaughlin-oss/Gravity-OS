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

/** The wallpaper window never reads shell state — give it an inert provider
 *  so it doesn't cost a 1s IPC poll (and the COM churn behind it). */
class NullShell implements ShellContextValueProvider {
  subscribe() {
    return () => {};
  }
  snapshot() {
    return NULL_STATE;
  }
  actions = new Proxy({}, { get: () => () => {} }) as ShellContextValue["actions"];
}
type ShellContextValueProvider = {
  subscribe(cb: () => void): () => void;
  snapshot(): ShellState;
  actions: ShellContextValue["actions"];
};
const NULL_STATE: ShellState = {
  apps: [],
  windows: [],
  status: {
    batteryPercent: null,
    charging: false,
    online: true,
    network: null,
    volume: 0.5,
    brightness: null,
    focus: false,
    bluetooth: false,
    trashFull: false,
  },
  orbits: [],
  activeOrbit: "o1",
  notifications: [],
};

export function ShellRoot({ children }: { children: ReactNode }) {
  const provider = useMemo(() => {
    if (!isTauri()) return new MockShell();
    const surface = new URLSearchParams(window.location.search).get("surface");
    return surface === "deepfield" ? new NullShell() : new TauriShell();
  }, []);
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
