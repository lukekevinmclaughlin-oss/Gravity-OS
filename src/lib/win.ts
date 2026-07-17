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

/** The Horizon strip window is only as tall as the bar; menus need room to
 *  drop below it. Grow the window while a menu is open, shrink after.
 *  (A transparent Tauri region still captures clicks, so the strip must
 *  stay short whenever no menu is open.) */
export const HORIZON_CLOSED_H = 34;
const HORIZON_OPEN_H = 520;

export async function growHorizonWindow(open: boolean): Promise<void> {
  if (!isTauri()) return;
  if (new URLSearchParams(window.location.search).get("surface") !== "horizon") return;
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const size = await win.innerSize();
  const width = size.toLogical(scale).width;
  await win.setSize(new LogicalSize(width, open ? HORIZON_OPEN_H : HORIZON_CLOSED_H));
}
