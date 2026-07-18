import { isTauri } from "../shell/tauri";

/** Cross-window control for the multi-window Windows shell. On macOS dev
 *  (no Tauri) these are no-ops and the composed Stage handles overlays. */

export type OverlaySurface = "singularity" | "core" | "constellation" | "window-studio" | "app-library" | "about";

let lastOverlay: OverlaySurface | null = null;

export async function openOverlay(surface: OverlaySurface): Promise<void> {
  if (!isTauri()) return;
  const [{ emit }, { Window }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/window"),
  ]);
  const monitor = new URLSearchParams(window.location.search).get("monitor") ?? "0";
  const overlay = await Window.getByLabel(`overlay-${monitor}`);
  if (overlay && (await overlay.isVisible()) && lastOverlay === surface) {
    lastOverlay = null;
    await emit("gravity://overlay", { surface: null });
    await overlay.hide();
    return;
  }
  lastOverlay = surface;
  await emit("gravity://overlay", { surface });
  await overlay?.show();
  await overlay?.setFocus();
}

export async function hideOverlaySelf(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

/** The Horizon strip window is only as tall as the bar. Interactive menus
 * receive an explicitly measured hit region; we never expand a transparent
 * WebView over the whole monitor. */
export const HORIZON_CLOSED_H = 34;
export const ORBIT_CLOSED_H = 170;
const ORBIT_OPEN_H = 360;

export async function growHorizonWindow(open: boolean, requestedHeight = 420): Promise<void> {
  if (!isTauri()) return;
  if (new URLSearchParams(window.location.search).get("surface") !== "horizon") return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_shell_surface_expanded", {
    expanded: open,
    requestedHeight,
  });
}

let orbitExpanded = false;

/** Give Orbit's native right-click menu room without permanently leaving a
 * transparent click-blocking band over applications. The strip grows upward
 * and returns to exactly its previous bottom edge when dismissed. */
export async function growOrbitWindow(open: boolean): Promise<void> {
  if (!isTauri() || orbitExpanded === open) return;
  if (new URLSearchParams(window.location.search).get("surface") !== "orbit") return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_shell_surface_expanded", {
    expanded: open,
    requestedHeight: open ? ORBIT_OPEN_H : ORBIT_CLOSED_H,
  });
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
