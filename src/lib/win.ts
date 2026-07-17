import { isTauri } from "../shell/tauri";

/** Cross-window control for the multi-window Windows shell. On macOS dev
 *  (no Tauri) these are no-ops and the composed Stage handles overlays. */

export type OverlaySurface = "singularity" | "core" | "constellation";

export async function openOverlay(surface: OverlaySurface): Promise<void> {
  if (!isTauri()) return;
  const [{ emit }, { Window }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/window"),
  ]);
  await emit("gravity://overlay", { surface });
  const overlay = await Window.getByLabel("overlay");
  await overlay?.show();
  await overlay?.setFocus();
}

export async function hideOverlaySelf(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}
