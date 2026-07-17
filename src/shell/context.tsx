import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
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
  const provider = useMemo(() => {
    if (!isTauri()) return new MockShell();
    const surface = new URLSearchParams(window.location.search).get("surface");
    // Wallpaper polls slowly; settings mutations refresh it immediately.
    return new TauriShell(surface === "deepfield" ? 5000 : 1000);
  }, []);
  const state = useSyncExternalStore(
    (cb) => provider.subscribe(cb),
    () => provider.snapshot()
  );

  useEffect(() => {
    const root = document.documentElement;
    if (state.appearance.resolved === "light") root.dataset.theme = "daybreak";
    else delete root.dataset.theme;
    root.style.colorScheme = state.appearance.resolved;
    try {
      localStorage.setItem("gravity.appearance", JSON.stringify(state.appearance));
    } catch {
      // Rust remains authoritative if storage is disabled.
    }
  }, [state.appearance]);

  const value = useMemo(() => ({ state, actions: provider.actions }), [state, provider]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell outside <ShellRoot>");
  return ctx;
}
