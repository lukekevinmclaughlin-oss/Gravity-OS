import { isTauri } from "../shell/tauri";

/** Cross-window control for the multi-window Windows shell. On macOS dev
 *  (no Tauri) these are no-ops and the composed Stage handles overlays. */

export type OverlaySurface = "singularity" | "core" | "constellation" | "window-studio" | "app-library";

export async function openOverlay(surface: OverlaySurface): Promise<void> {
  if (!isTauri()) return;
  const [{ emit }, { Window }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/window"),
  ]);
  await emit("gravity://overlay", { surface });
  const monitor = new URLSearchParams(window.location.search).get("monitor") ?? "0";
  const overlay = await Window.getByLabel(`overlay-${monitor}`);
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
export const ORBIT_CLOSED_H = 170;
const ORBIT_OPEN_H = 360;

export async function growHorizonWindow(open: boolean): Promise<void> {
  if (!isTauri()) return;
  if (new URLSearchParams(window.location.search).get("surface") !== "horizon") return;
  const { getCurrentWindow, currentMonitor, LogicalSize } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const size = await win.innerSize();
  const width = size.toLogical(scale).width;
  const monitor = open ? await currentMonitor() : null;
  const height = monitor ? monitor.size.height / monitor.scaleFactor : HORIZON_CLOSED_H;
  await win.setSize(new LogicalSize(width, height));
}

let orbitExpanded = false;

/** Give Orbit's native right-click menu room without permanently leaving a
 * transparent click-blocking band over applications. The strip grows upward
 * and returns to exactly its previous bottom edge when dismissed. */
export async function growOrbitWindow(open: boolean): Promise<void> {
  if (!isTauri() || orbitExpanded === open) return;
  if (new URLSearchParams(window.location.search).get("surface") !== "orbit") return;
  const { getCurrentWindow, LogicalPosition, LogicalSize } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const physicalPosition = await win.outerPosition();
  const physicalSize = await win.innerSize();
  const position = physicalPosition.toLogical(scale);
  const size = physicalSize.toLogical(scale);
  const targetHeight = open ? ORBIT_OPEN_H : ORBIT_CLOSED_H;
  const delta = targetHeight - size.height;
  await win.setPosition(new LogicalPosition(position.x, position.y - delta));
  await win.setSize(new LogicalSize(size.width, targetHeight));
  orbitExpanded = open;
}

/** Keep Orbit's native hit-test region close to the visible shelf. AppBar
 * reservation still spans the display, but transparent side margins no
 * longer intercept clicks in foreign applications. */
export async function fitOrbitWindow(appCount: number): Promise<void> {
  if (!isTauri() || orbitExpanded) return;
  if (new URLSearchParams(window.location.search).get("surface") !== "orbit") return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("fit_orbit_window", { appCount });
}

/** Size the standalone Pulse surface to its visible notifications and hide
 * it completely when there is nothing to show, avoiding transparent hit
 * regions over application content. */
export async function fitPulseWindow(noteCount: number): Promise<void> {
  if (!isTauri()) return;
  if (new URLSearchParams(window.location.search).get("surface") !== "pulse") return;
  const { getCurrentWindow, currentMonitor, PhysicalPosition, PhysicalSize } =
    await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  if (noteCount === 0) {
    await win.hide();
    return;
  }
  const monitor = await currentMonitor();
  if (!monitor) return;
  const scale = monitor.scaleFactor;
  const width = Math.round(370 * scale);
  const height = Math.round(Math.min(620, 54 + noteCount * 112) * scale);
  await win.setSize(new PhysicalSize(width, height));
  await win.setPosition(new PhysicalPosition(
    monitor.position.x + monitor.size.width - width - Math.round(8 * scale),
    monitor.position.y
  ));
  await win.show();
}
