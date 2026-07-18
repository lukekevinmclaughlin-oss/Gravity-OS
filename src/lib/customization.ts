import { useEffect, useState } from "react";
import type { ShellActions, WindowInfo } from "../shell/types";
import type { WellDefinition } from "./wells";
import { WELL_CAPACITY } from "./wells";
import { WALLPAPERS, wallpaperSource } from "./wallpapers";

export type DockMaterial = "floating" | "glass" | "solid";
export type DockMotion = "gentle" | "fluid" | "expressive";
export type WallpaperFit = "cover" | "contain" | "fill";
export type GridLayoutId = "halves" | "thirds" | "quarters" | "six-pack" | "nine-grid" | "focus-left" | "focus-center" | "columns";

export interface DockPreferences {
  size: number;
  magnification: number;
  magnifyRadius: number;
  spacing: number;
  opacity: number;
  material: DockMaterial;
  motion: DockMotion;
  showLabels: boolean;
  showIndicators: boolean;
  showBadges: boolean;
  showOpenApps: boolean;
}

export interface WallpaperPreferences {
  fit: WallpaperFit;
  position: "center" | "top" | "bottom";
  dim: number;
  blur: number;
  saturation: number;
  tint: string;
  tintStrength: number;
  useCustom: boolean;
  customDarkName?: string;
  customLightName?: string;
  revision: number;
}

export type AccentId =
  | "graviton"
  | "graphite"
  | "teal"
  | "mint"
  | "amber"
  | "coral"
  | "magenta"
  | "violet"
  | "auto";

/** Gravity's own accent set — every hue is original (spec: 8 accents + Auto). */
export const ACCENTS: Record<Exclude<AccentId, "auto">, { label: string; hex: string }> = {
  graviton: { label: "Graviton Blue", hex: "#3a7bfd" },
  graphite: { label: "Graphite", hex: "#8f9099" },
  teal: { label: "Teal", hex: "#2fb8c6" },
  mint: { label: "Mint", hex: "#31c48d" },
  amber: { label: "Amber", hex: "#e0a52e" },
  coral: { label: "Coral", hex: "#f4573f" },
  magenta: { label: "Magenta", hex: "#e5478f" },
  violet: { label: "Violet", hex: "#8a63f0" },
};

export interface DesktopPreferences {
  doubleClickShowsDesktop: boolean;
  accent: AccentId;
  reduceTransparency: boolean;
}

export interface SearchPreferences {
  /** User abbreviations expanded into Singularity commands, e.g. tl → "snap left-half". */
  quickKeys: Record<string, string>;
}

export interface PersonalizationPreferences {
  dock: DockPreferences;
  wallpaper: WallpaperPreferences;
  desktop: DesktopPreferences;
  search: SearchPreferences;
}

export const PERSONALIZATION_STORAGE_KEY = "gravity.personalization.v1";
export const PERSONALIZATION_EVENT = "gravity:personalization-changed";

export const DEFAULT_PERSONALIZATION: PersonalizationPreferences = {
  dock: {
    size: 48,
    magnification: 2,
    magnifyRadius: 60,
    spacing: 0,
    opacity: 0.9,
    material: "floating",
    motion: "fluid",
    showLabels: true,
    showIndicators: true,
    showBadges: true,
    showOpenApps: true,
  },
  wallpaper: {
    fit: "cover",
    position: "center",
    dim: 0,
    blur: 0,
    saturation: 1,
    tint: "#17233a",
    tintStrength: 0,
    useCustom: false,
    revision: 0,
  },
  desktop: {
    doubleClickShowsDesktop: true,
    accent: "graviton",
    reduceTransparency: false,
  },
  search: {
    quickKeys: {},
  },
};

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

export function readPersonalization(): PersonalizationPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(PERSONALIZATION_STORAGE_KEY) ?? "null") as Partial<PersonalizationPreferences> | null;
    const dock = (parsed?.dock ?? {}) as Partial<DockPreferences>;
    const wallpaper = (parsed?.wallpaper ?? {}) as Partial<WallpaperPreferences>;
    const desktop = (parsed?.desktop ?? {}) as Partial<DesktopPreferences>;
    const search = (parsed?.search ?? {}) as Partial<SearchPreferences>;
    const quickKeys: Record<string, string> = {};
    for (const [key, value] of Object.entries(search.quickKeys ?? {}).slice(0, 24)) {
      if (/^[a-z0-9]{1,12}$/i.test(key) && typeof value === "string" && value.trim().length > 0 && value.length <= 64) {
        quickKeys[key.toLocaleLowerCase()] = value.trim();
      }
    }
    return {
      dock: {
        size: clamp(dock.size, 38, 72, DEFAULT_PERSONALIZATION.dock.size),
        magnification: clamp(dock.magnification, 1, 2.35, DEFAULT_PERSONALIZATION.dock.magnification),
        magnifyRadius: clamp(dock.magnifyRadius, 36, 140, DEFAULT_PERSONALIZATION.dock.magnifyRadius),
        spacing: clamp(dock.spacing, 0, 14, DEFAULT_PERSONALIZATION.dock.spacing),
        opacity: clamp(dock.opacity, .45, 1, DEFAULT_PERSONALIZATION.dock.opacity),
        material: (["floating", "glass", "solid"] as const).includes(dock.material as DockMaterial) ? dock.material as DockMaterial : DEFAULT_PERSONALIZATION.dock.material,
        motion: (["gentle", "fluid", "expressive"] as const).includes(dock.motion as DockMotion) ? dock.motion as DockMotion : DEFAULT_PERSONALIZATION.dock.motion,
        showLabels: dock.showLabels !== false,
        showIndicators: dock.showIndicators !== false,
        showBadges: dock.showBadges !== false,
        showOpenApps: dock.showOpenApps !== false,
      },
      wallpaper: {
        fit: (["cover", "contain", "fill"] as const).includes(wallpaper.fit as WallpaperFit) ? wallpaper.fit as WallpaperFit : DEFAULT_PERSONALIZATION.wallpaper.fit,
        position: (["center", "top", "bottom"] as const).includes(wallpaper.position as "center") ? wallpaper.position as "center" | "top" | "bottom" : DEFAULT_PERSONALIZATION.wallpaper.position,
        dim: clamp(wallpaper.dim, 0, .65, 0),
        blur: clamp(wallpaper.blur, 0, 18, 0),
        saturation: clamp(wallpaper.saturation, .4, 1.6, 1),
        tint: /^#[0-9a-f]{6}$/i.test(wallpaper.tint ?? "") ? wallpaper.tint! : DEFAULT_PERSONALIZATION.wallpaper.tint,
        tintStrength: clamp(wallpaper.tintStrength, 0, .55, 0),
        useCustom: wallpaper.useCustom === true,
        customDarkName: typeof wallpaper.customDarkName === "string" ? wallpaper.customDarkName.slice(0, 160) : undefined,
        customLightName: typeof wallpaper.customLightName === "string" ? wallpaper.customLightName.slice(0, 160) : undefined,
        revision: clamp(wallpaper.revision, 0, Number.MAX_SAFE_INTEGER, 0),
      },
      desktop: {
        doubleClickShowsDesktop: desktop.doubleClickShowsDesktop !== false,
        accent: desktop.accent === "auto" || (typeof desktop.accent === "string" && desktop.accent in ACCENTS)
          ? desktop.accent as AccentId
          : DEFAULT_PERSONALIZATION.desktop.accent,
        reduceTransparency: desktop.reduceTransparency === true,
      },
      search: { quickKeys },
    };
  } catch {
    return structuredClone(DEFAULT_PERSONALIZATION);
  }
}

export function writePersonalization(value: PersonalizationPreferences) {
  localStorage.setItem(PERSONALIZATION_STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(PERSONALIZATION_EVENT));
}

export function usePersonalization(): [PersonalizationPreferences, (next: PersonalizationPreferences | ((current: PersonalizationPreferences) => PersonalizationPreferences)) => void] {
  const [value, setValue] = useState(readPersonalization);
  useEffect(() => {
    const refresh = () => setValue(readPersonalization());
    const storage = (event: StorageEvent) => {
      if (event.key === PERSONALIZATION_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", storage);
    window.addEventListener(PERSONALIZATION_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener(PERSONALIZATION_EVENT, refresh);
    };
  }, []);
  const update = (next: PersonalizationPreferences | ((current: PersonalizationPreferences) => PersonalizationPreferences)) => {
    const resolved = typeof next === "function" ? next(readPersonalization()) : next;
    writePersonalization(resolved);
  };
  return [value, update];
}

const AUTO_ACCENT_CACHE = "gravity.auto-accent.v1";

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = lightness - chroma / 2;
  const [r, g, b] =
    hue < 60 ? [chroma, secondary, 0]
    : hue < 120 ? [secondary, chroma, 0]
    : hue < 180 ? [0, chroma, secondary]
    : hue < 240 ? [0, secondary, chroma]
    : hue < 300 ? [secondary, 0, chroma]
    : [chroma, 0, secondary];
  const channel = (value: number) => Math.round((value + base) * 255).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

async function sampleDominantAccent(source: string): Promise<string | null> {
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, 24, 24);
    const { data } = context.getImageData(0, 0, 24, 24);
    // Vector-average the hue of sufficiently colorful pixels so opposing hues
    // cancel instead of averaging to a muddy midpoint.
    let x = 0;
    let y = 0;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index] / 255;
      const g = data[index + 1] / 255;
      const b = data[index + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      if (saturation < 0.18 || max < 0.14) continue;
      const delta = max - min;
      const rawHue = delta === 0 ? 0
        : max === r ? ((g - b) / delta) % 6
        : max === g ? (b - r) / delta + 2
        : (r - g) / delta + 4;
      const radians = (rawHue * 60 * Math.PI) / 180;
      x += Math.cos(radians) * saturation;
      y += Math.sin(radians) * saturation;
      count += 1;
    }
    if (count === 0) return null;
    const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    // Clamp to a usable UI accent: saturated and mid-light in any theme.
    return hslToHex(hue, 0.68, 0.58);
  } catch {
    return null;
  }
}

/** Resolve the "Auto" accent from the active wallpaper. Cached per wallpaper
 *  identity; the live generative wallpaper keeps the default accent. */
export async function resolveAutoAccent(
  wallpaperId: string,
  resolved: "light" | "dark",
  wallpaper: WallpaperPreferences,
): Promise<string | null> {
  const cacheKey = `${wallpaperId}|${resolved}|${wallpaper.useCustom ? `custom:${wallpaper.revision}` : "curated"}`;
  try {
    const cached = JSON.parse(localStorage.getItem(AUTO_ACCENT_CACHE) ?? "null") as { key: string; hex: string } | null;
    if (cached?.key === cacheKey && /^#[0-9a-f]{6}$/i.test(cached.hex)) return cached.hex;
  } catch {
    // Recompute below.
  }
  let source: string | null = null;
  let revoke: (() => void) | null = null;
  if (wallpaper.useCustom) {
    const blob = await loadCustomWallpaper(resolved).catch(() => null);
    if (blob) {
      const url = URL.createObjectURL(blob);
      source = url;
      revoke = () => URL.revokeObjectURL(url);
    }
  }
  if (!source) {
    const spec = WALLPAPERS.find((entry) => entry.id === wallpaperId);
    source = spec ? wallpaperSource(spec, resolved) : null;
  }
  if (!source) return null;
  const hex = await sampleDominantAccent(source);
  revoke?.();
  if (hex) {
    try {
      localStorage.setItem(AUTO_ACCENT_CACHE, JSON.stringify({ key: cacheKey, hex }));
    } catch {
      // The sample simply recomputes next time.
    }
  }
  return hex;
}

const WALLPAPER_DB = "gravity-personal-wallpapers";
const WALLPAPER_STORE = "images";

function openWallpaperDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WALLPAPER_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(WALLPAPER_STORE)) request.result.createObjectStore(WALLPAPER_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Personal wallpaper storage could not open."));
  });
}

export async function saveCustomWallpaper(theme: "light" | "dark", file: File): Promise<void> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file for your wallpaper.");
  if (file.size > 80 * 1024 * 1024) throw new Error("Wallpaper images must be smaller than 80 MB.");
  const db = await openWallpaperDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(WALLPAPER_STORE, "readwrite");
    transaction.objectStore(WALLPAPER_STORE).put(file, theme);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("The wallpaper could not be saved."));
  });
  db.close();
}

export async function loadCustomWallpaper(theme: "light" | "dark"): Promise<Blob | null> {
  const db = await openWallpaperDatabase();
  const result = await new Promise<Blob | null>((resolve, reject) => {
    const request = db.transaction(WALLPAPER_STORE, "readonly").objectStore(WALLPAPER_STORE).get(theme);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error("The wallpaper could not be loaded."));
  });
  db.close();
  return result;
}

export async function removeCustomWallpaper(theme?: "light" | "dark"): Promise<void> {
  const db = await openWallpaperDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(WALLPAPER_STORE, "readwrite");
    if (theme) transaction.objectStore(WALLPAPER_STORE).delete(theme);
    else transaction.objectStore(WALLPAPER_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("The wallpaper could not be removed."));
  });
  db.close();
}

export const GRID_LAYOUTS: ReadonlyArray<{ id: GridLayoutId; name: string; description: string }> = [
  { id: "halves", name: "Two columns", description: "Balanced side-by-side windows" },
  { id: "thirds", name: "Three columns", description: "Equal vertical thirds" },
  { id: "quarters", name: "Four corners", description: "A focused 2 by 2 workspace" },
  { id: "six-pack", name: "Six windows", description: "Three columns across two rows" },
  { id: "nine-grid", name: "Nine windows", description: "Dense 3 by 3 overview" },
  { id: "focus-left", name: "Focus left", description: "Large canvas with a right stack" },
  { id: "focus-center", name: "Focus center", description: "Large center with side rails" },
  { id: "columns", name: "Fluid columns", description: "One column for every open window" },
];

interface Frame { x: number; y: number; width: number; height: number }

function framesForLayout(id: GridLayoutId, count: number): Frame[] {
  const grid = (columns: number, rows: number) => Array.from({ length: columns * rows }, (_, index) => ({
    x: (index % columns) / columns,
    y: Math.floor(index / columns) / rows,
    width: 1 / columns,
    height: 1 / rows,
  }));
  switch (id) {
    case "halves": return grid(2, Math.max(1, Math.ceil(count / 2)));
    case "thirds": return grid(3, Math.max(1, Math.ceil(count / 3)));
    case "quarters": return grid(2, 2);
    case "six-pack": return grid(3, 2);
    case "nine-grid": return grid(3, 3);
    case "focus-left": {
      const sideCount = Math.max(1, count - 1);
      return [
        { x: 0, y: 0, width: .64, height: 1 },
        ...Array.from({ length: sideCount }, (_, index) => ({ x: .64, y: index / sideCount, width: .36, height: 1 / sideCount })),
      ];
    }
    case "focus-center": {
      const sideCount = Math.max(1, count - 1);
      const rows = Math.ceil(sideCount / 2);
      return [
        { x: .2, y: 0, width: .6, height: 1 },
        ...Array.from({ length: sideCount }, (_, index) => {
          const left = index % 2 === 0;
          const row = Math.floor(index / 2);
          return { x: left ? 0 : .8, y: row / rows, width: .2, height: 1 / rows };
        }),
      ];
    }
    case "columns": return grid(Math.max(1, count), 1);
  }
}

export async function snapWindowsToGrid(windows: WindowInfo[], actions: ShellActions, layout: GridLayoutId): Promise<number> {
  const candidates = windows.filter((window) => !window.parkedWellId);
  if (!candidates.length) return 0;
  const frames = framesForLayout(layout, candidates.length);
  await Promise.all(candidates.map(async (window, index) => {
    const frame = frames[index % frames.length];
    await actions.applyGridRegion(window.id, frame.x, frame.y, frame.width, frame.height);
  }));
  return candidates.length;
}

export async function distributeWindowsToWells(windows: WindowInfo[], wells: WellDefinition[], actions: ShellActions): Promise<{ stored: number; remaining: number }> {
  const available = wells.flatMap((well) => {
    const occupied = windows.filter((window) => window.parkedWellId === well.id).length;
    return Array.from({ length: Math.max(0, WELL_CAPACITY[well.kind] - occupied) }, () => well.id);
  });
  const candidates = windows.filter((window) => !window.parkedWellId);
  const assignments = candidates.slice(0, available.length);
  for (let index = 0; index < assignments.length; index += 1) {
    await actions.parkWindow(assignments[index].id, available[index]);
  }
  return { stored: assignments.length, remaining: Math.max(0, candidates.length - assignments.length) };
}
