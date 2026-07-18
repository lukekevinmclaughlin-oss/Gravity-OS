import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { MockShell } from "./mock";
import { TauriShell, isTauri } from "./tauri";
import type { ShellActions, ShellState } from "./types";
import { ACCENTS, resolveAutoAccent, usePersonalization } from "../lib/customization";

interface ShellContextValue {
  state: ShellState;
  actions: ShellActions;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellRoot({ children }: { children: ReactNode }) {
  const provider = useMemo(() => {
    if (!isTauri()) return new MockShell();
    const surface = new URLSearchParams(window.location.search).get("surface");
    // The WinEvent fabric pushes gravity://state-changed on every window
    // change (NS-3.1); the interval is only a reconciliation sweep now, and
    // the wallpaper reconciles even more lazily.
    return new TauriShell(surface === "deepfield" ? 60000 : 15000);
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

  // User accent + Reduce Transparency (NS-13.1 / NS-13.4). Every derived
  // token follows --accent, so one root override recolors the whole surface.
  const [personalization] = usePersonalization();
  useEffect(() => {
    const root = document.documentElement;
    if (personalization.desktop.reduceTransparency) root.dataset.reduceTransparency = "true";
    else delete root.dataset.reduceTransparency;
    const accent = personalization.desktop.accent;
    if (accent !== "auto") {
      root.style.setProperty("--accent", ACCENTS[accent].hex);
      return;
    }
    let cancelled = false;
    void resolveAutoAccent(
      state.appearance.wallpaperId,
      state.appearance.resolved,
      personalization.wallpaper,
    ).then((hex) => {
      if (cancelled) return;
      if (hex) root.style.setProperty("--accent", hex);
      else root.style.removeProperty("--accent");
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    personalization.desktop.accent,
    personalization.desktop.reduceTransparency,
    personalization.wallpaper,
    state.appearance,
  ]);

  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let pointerX = window.innerWidth / 2;
    let pointerY = 0;
    const paint = () => {
      frame = 0;
      root.style.setProperty("--glass-x", `${(pointerX / Math.max(1, window.innerWidth)) * 100}%`);
      root.style.setProperty("--glass-y", `${(pointerY / Math.max(1, window.innerHeight)) * 100}%`);
    };
    const track = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    window.addEventListener("pointermove", track, { passive: true });
    return () => {
      window.removeEventListener("pointermove", track);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const value = useMemo(() => ({ state, actions: provider.actions }), [state, provider]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell outside <ShellRoot>");
  return ctx;
}
