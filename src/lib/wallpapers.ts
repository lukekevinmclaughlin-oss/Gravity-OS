import type { ResolvedAppearance } from "../shell/types";

export interface WallpaperSpec {
  id: string;
  name: string;
  description: string;
  kind: "image" | "live";
  dark?: string;
  light?: string;
  preview: string;
}

export const WALLPAPERS: readonly WallpaperSpec[] = [
  {
    id: "deep-field",
    name: "Deep Field",
    description: "A quiet lensing arc that opens into daylight.",
    kind: "image",
    dark: "/wallpapers/deep-field-dark.png",
    light: "/wallpapers/deep-field-light.png",
    preview: "linear-gradient(145deg, #07101b, #0b3541 48%, #5963a4)",
  },
  {
    id: "event-horizon",
    name: "Event Horizon",
    description: "Graphite gravity fields with a restrained warm edge.",
    kind: "image",
    dark: "/wallpapers/event-horizon-dark.png",
    light: "/wallpapers/event-horizon-light.png",
    preview: "linear-gradient(145deg, #0a0910, #33283f 55%, #d17851)",
  },
  {
    id: "live-field",
    name: "Living Field",
    description: "A battery-aware generative sky with drifting aurora.",
    kind: "live",
    preview: "radial-gradient(circle at 28% 72%, #17605f, transparent 48%), #070b16",
  },
] as const;

export function wallpaperSource(
  wallpaper: WallpaperSpec,
  appearance: ResolvedAppearance
): string | null {
  if (wallpaper.kind !== "image") return null;
  return appearance === "light" ? wallpaper.light ?? wallpaper.dark ?? null : wallpaper.dark ?? null;
}
