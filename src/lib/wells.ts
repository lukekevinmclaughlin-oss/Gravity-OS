import { useEffect, useState } from "react";

export type WellKind = "cube" | "pyramid" | "prism" | "hexagon" | "column" | "orb" | "ring" | "slab" | "carousel" | "torus" | "halo" | "helix" | "diamond" | "star" | "vortex" | "lattice" | "capsule" | "crescent";
export type WellColor = "emerald" | "mint" | "lime" | "ocean" | "cyan" | "ice" | "indigo" | "violet" | "magenta" | "rose" | "coral" | "crimson" | "amber" | "gold" | "copper" | "plasma" | "graphite" | "pearl" | "custom";

export interface WellDefinition {
  id: string;
  name: string;
  kind: WellKind;
  color: WellColor;
  customColor?: string;
  x: number;
  y: number;
  scale: number;
  monitor: number;
  rotation: number;
}

export const WELL_STORAGE_KEY = "gravity.desktop-wells.v1";
export const WELL_GRID_STORAGE_KEY = "gravity.desktop-wells.grid.v1";
export const WELL_KINDS: WellKind[] = ["cube", "pyramid", "prism", "hexagon", "column", "orb", "ring", "slab", "carousel", "torus", "halo", "helix", "diamond", "star", "vortex", "lattice", "capsule", "crescent"];
export const WELL_COLORS: WellColor[] = ["emerald", "mint", "lime", "ocean", "cyan", "ice", "indigo", "violet", "magenta", "rose", "coral", "crimson", "amber", "gold", "copper", "plasma", "graphite", "pearl", "custom"];
export const WELL_CAPACITY: Record<WellKind, number> = {
  cube: 6, pyramid: 4, prism: 3, hexagon: 6, column: 8,
  orb: 8, ring: 10, slab: 2, carousel: 12, torus: 12, halo: 10,
  helix: 8, diamond: 4, star: 10, vortex: 12, lattice: 16,
  capsule: 6, crescent: 8,
};
export const WELL_COLOR_VALUES: Record<Exclude<WellColor, "custom">, string> = {
  emerald: "#42e6a4", mint: "#85ffd2", lime: "#b7ef5b", ocean: "#49b7ff",
  cyan: "#48f0ef", ice: "#a9e8ff", indigo: "#7288ff", violet: "#b783ff",
  magenta: "#ec69ff", rose: "#ff87b7", coral: "#ff8b78", crimson: "#ff626f",
  amber: "#f4b84b", gold: "#f6d365", copper: "#d58a59", plasma: "#7ff2ff",
  graphite: "#9aa0ad", pearl: "#eef6ff",
};

export function colorForWell(well: Pick<WellDefinition, "color" | "customColor">): string {
  return well.color === "custom"
    ? /^#[0-9a-f]{6}$/i.test(well.customColor ?? "") ? well.customColor! : "#42e6a4"
    : WELL_COLOR_VALUES[well.color];
}

export function createDefaultWell(monitor = 0, index = 0): WellDefinition {
  return {
    id: `well-${Date.now()}-${index}`,
    name: `Gravity Well ${index + 1}`,
    kind: WELL_KINDS[index % WELL_KINDS.length],
    color: WELL_COLORS[index % (WELL_COLORS.length - 1)],
    customColor: "#42e6a4",
    x: Math.min(.78, .18 + index * .12),
    y: Math.max(.2, .68 - index * .08),
    scale: 1,
    monitor,
    rotation: 0,
  };
}

export function readDesktopWells(): WellDefinition[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(WELL_STORAGE_KEY) ?? "null") as Partial<WellDefinition>[] | null;
    if (!Array.isArray(parsed) || parsed.length === 0) return [createDefaultWell()];
    return parsed.filter((well) => typeof well.id === "string").map((well, index) => ({
      ...createDefaultWell(Number(well.monitor) || 0, index),
      ...well,
      name: String(well.name || `Gravity Well ${index + 1}`).slice(0, 64),
      kind: WELL_KINDS.includes(well.kind as WellKind) ? well.kind as WellKind : "cube",
      color: WELL_COLORS.includes(well.color as WellColor) ? well.color as WellColor : "emerald",
      customColor: /^#[0-9a-f]{6}$/i.test(well.customColor ?? "") ? well.customColor : "#42e6a4",
    }));
  } catch {
    return [createDefaultWell()];
  }
}

export function writeDesktopWells(wells: WellDefinition[]) {
  localStorage.setItem(WELL_STORAGE_KEY, JSON.stringify(wells));
  window.dispatchEvent(new CustomEvent("gravity:wells-changed"));
}

export function useDesktopWells(): WellDefinition[] {
  const [wells, setWells] = useState(readDesktopWells);
  useEffect(() => {
    const refresh = () => setWells(readDesktopWells());
    const storage = (event: StorageEvent) => {
      if (event.key === WELL_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", storage);
    window.addEventListener("gravity:wells-changed", refresh);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener("gravity:wells-changed", refresh);
    };
  }, []);
  return wells;
}

/** Broadcast a Well command across Gravity's separate native WebView surfaces. */
export async function sendWellCommand(command: "add-well" | "toggle-wells" | "equalize-wells" | "organize-wells", detail?: unknown) {
  window.dispatchEvent(new CustomEvent(`gravity:${command}`, { detail }));
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit("gravity://well-command", { command, detail });
}
