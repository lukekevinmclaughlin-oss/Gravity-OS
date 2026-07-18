/** Shared shape of the shell world — identical for the development mock and
 * the Windows (Tauri/Win32) runtime, so every surface is backend-agnostic. */

export interface AppInfo {
  id: string;
  name: string;
  /** Launch target on Windows (path to .lnk/.exe); absent in the mock. */
  exe?: string;
  pinned: boolean;
  hue: number;
}

export interface WindowInfo {
  id: string;
  appId: string;
  title: string;
  minimized: boolean;
  maximized: boolean;
  focused: boolean;
  orbitId: string;
  /** Gravity desktop shape currently storing this hidden native window. */
  parkedWellId?: string;
}

export interface SystemStatus {
  batteryPercent: number | null;
  charging: boolean;
  online: boolean;
  network: string | null;
  /** 0..1 */
  volume: number;
  /** 0..1, null = unsupported on this device */
  brightness: number | null;
  focus: boolean;
  bluetooth: boolean;
  trashFull: boolean;
}

export interface OrbitSpace {
  id: string;
  name: string;
}

export interface PulseNote {
  id: string;
  appName: string;
  hue: number;
  title: string;
  body: string;
}

export type AppearanceMode = "system" | "light" | "dark";
export type ResolvedAppearance = "light" | "dark";

export interface AppearanceState {
  mode: AppearanceMode;
  resolved: ResolvedAppearance;
  wallpaperId: string;
}

export interface SceneFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  monitorIndex: number;
}

export interface SceneWindow {
  appId: string;
  title: string;
  frame: SceneFrame;
}

export interface WindowScene {
  id: string;
  name: string;
  createdAt: number;
  windows: SceneWindow[];
  autoRestore: boolean;
  displayFingerprint: string;
}

export interface WindowRule {
  id: string;
  appId: string;
  appName: string;
  action: WindowAction;
  enabled: boolean;
}

export interface WindowingState {
  gap: number;
  cycling: boolean;
  scenes: WindowScene[];
  rules: WindowRule[];
  ignoredAppIds: string[];
  launchAtLogin: boolean;
  sceneAutoRestore: boolean;
  shortcuts: Record<string, string>;
}

export type ShellMode =
  | "windows"
  | "entering-gravity"
  | "gravity"
  | "leaving-gravity"
  | "faulted";

export interface ShellTransitionResult {
  mode: ShellMode;
  active: boolean;
}

export interface ShellState {
  apps: AppInfo[];
  windows: WindowInfo[];
  status: SystemStatus;
  orbits: OrbitSpace[];
  activeOrbit: string;
  notifications: PulseNote[];
  appearance: AppearanceState;
  windowing: WindowingState;
  shellMode: ShellMode;
}

export interface LaunchResult {
  appId: string;
  accepted: boolean;
}

export type ToggleKey = "wifi" | "bluetooth" | "focus";

/** Session power verbs surfaced by the Gravity menu. */
export type PowerKind = "sleep" | "restart" | "shutdown" | "lock";
/** Clipboard verbs synthesized into the focused app (spec §3). */
export type EditKind = "cut" | "copy" | "paste" | "select-all" | "undo" | "redo";

/** Native window operations provided by Gravity's geometry engine. */
export type WindowAction =
  | "left-half" | "right-half" | "top-half" | "bottom-half"
  | "top-left" | "top-right" | "bottom-left" | "bottom-right"
  | "first-third" | "center-third" | "last-third"
  | "first-two-thirds" | "last-two-thirds"
  | "sixth-top-left" | "sixth-top-center" | "sixth-top-right"
  | "sixth-bottom-left" | "sixth-bottom-center" | "sixth-bottom-right"
  | "maximize" | "almost-maximize" | "center"
  | "grow" | "shrink" | "restore" | "undo"
  | "next-display" | "previous-display" | "gather-all"
  | "arrange-display" | "cascade" | "tile-app" | "pair-previous"
  | "focus-left" | "focus-right" | "focus-up" | "focus-down";

export interface ShellActions {
  focusWindow(id: string): Promise<void>;
  minimizeWindow(id: string): Promise<void>;
  toggleMaximizeWindow(id: string): Promise<void>;
  closeWindow(id: string): Promise<void>;
  /** Control the last real foreground application even after Horizon receives focus. */
  activeWindowControl(kind: "close" | "minimize" | "zoom"): Promise<void>;
  windowAction(action: WindowAction): Promise<void>;
  windowActionFor(windowId: string, action: WindowAction): Promise<void>;
  applyGridRegion(windowId: string, x: number, y: number, width: number, height: number): Promise<void>;
  applyGridRegionOnMonitor(windowId: string, monitor: number, x: number, y: number, width: number, height: number): Promise<void>;
  warpWindow(windowId: string, operation: WarpOperation): Promise<void>;
  parkWindow(windowId: string, wellId: string): Promise<void>;
  releaseWindow(windowId: string): Promise<void>;
  releaseAllParkedWindows(): Promise<void>;
  /** Track a minimized-window drag beyond Orbit's native WebView boundary. */
  beginDockWindowDrag(windowId: string): Promise<void>;
  /** Store an existing app window, or launch the app and store its first window. */
  storeAppInWell(appId: string, wellId: string): Promise<void>;
  /** Track a Dock/Library app drag and store it when released over a Well. */
  beginDockAppDrag(appId: string): Promise<void>;
  registerDesktopWells(targets: DesktopWellTarget[]): Promise<void>;
  /** Expand the native Wells hit region while a quick menu or settings panel is open. */
  setWellSurfaceExpanded(expanded: boolean): Promise<void>;
  /** Publish Orbit's exact rendered Trash hit box in local CSS pixels. */
  registerDesktopTrashTarget(target: DesktopTrashTarget | null): Promise<void>;
  /** Hit-test the current pointer against every native Orbit Trash target. */
  isDesktopTrashTarget(clientX: number, clientY: number): Promise<boolean>;
  /** Resolve the pointer to a physical monitor and normalized display point. */
  desktopPointerLocation(clientX: number, clientY: number): Promise<DesktopPointerLocation>;
  /** Resolve only after Windows has accepted the launch request. */
  launchApp(appId: string): Promise<LaunchResult>;
  /** Open one or more dropped files with a Dock application. */
  launchAppWithFiles(appId: string, paths: string[]): Promise<LaunchResult>;
  setAppPinned(appId: string, pinned: boolean): Promise<void>;
  reorderPinnedApps(appIds: string[]): Promise<void>;
  setAppearance(mode: AppearanceMode): Promise<void>;
  setWallpaper(wallpaperId: string): Promise<void>;
  setWindowPreferences(gap: number, cycling: boolean): Promise<void>;
  setShortcut(actionId: string, binding: string | null): Promise<void>;
  resetShortcuts(): Promise<void>;
  captureScene(name: string): Promise<WindowScene>;
  restoreScene(sceneId: string): Promise<void>;
  deleteScene(sceneId: string): Promise<void>;
  setSceneAutoRestore(sceneId: string, enabled: boolean): Promise<void>;
  setAppIgnored(appId: string, ignored: boolean): Promise<void>;
  setLaunchAtLogin(enabled: boolean): Promise<void>;
  upsertWindowRule(appId: string, action: WindowAction, enabled: boolean): Promise<void>;
  deleteWindowRule(ruleId: string): Promise<void>;
  setVolume(v: number): Promise<void>;
  setBrightness(v: number): Promise<void>;
  toggleSetting(key: ToggleKey): Promise<void>;
  dismissNotification(id: string): Promise<void>;
  switchOrbit(id: string): Promise<void>;
  moveWindowToOrbit(windowId: string, orbitId: string): Promise<void>;
  emptyTrash(): Promise<void>;
  /** Real session actions; the development shell presents a visible simulation. */
  powerAction(kind: PowerKind): Promise<void>;
  /** Synthesize an edit chord into the currently focused foreign window. */
  editAction(kind: EditKind, targetWindowId?: string): Promise<void>;
  /** Open an ms-settings: deep link (validated in the Rust core). */
  openSetting(uri: string): Promise<void>;
  /** Gravity ⇄ Windows 11: false hides all surfaces and restores the
   *  taskbar (resume via the tray icon); true re-engages. */
  setShellActive(active: boolean): Promise<ShellTransitionResult>;
  /** Quit Gravity entirely, restoring the Windows desktop first. */
  quitShell(): Promise<void>;
}

export interface DesktopWellTarget {
  id: string;
  monitor: number;
  x: number;
  y: number;
  radius: number;
  capacity: number;
  occupied: number;
}

export interface DesktopTrashTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  dockX: number;
  dockY: number;
  dockWidth: number;
  dockHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface DesktopPointerLocation {
  monitor: number;
  x: number;
  y: number;
}

export type WarpOperation =
  | "move-left" | "move-right" | "move-up" | "move-down"
  | "shrink-width" | "grow-width" | "shrink-height" | "grow-height";

export interface ShellProviderI {
  subscribe(listener: () => void): () => void;
  snapshot(): ShellState;
  actions: ShellActions;
}

export function isAppRunning(state: ShellState, appId: string): boolean {
  return state.windows.some((w) => w.appId === appId);
}

export function windowsOf(state: ShellState, appId: string): WindowInfo[] {
  return state.windows.filter((w) => w.appId === appId);
}
