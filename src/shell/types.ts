/** Shared shape of the shell world — identical for the macOS dev mock and the
 *  Windows (Tauri/Win32) runtime, so every surface is backend-agnostic. */

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
  focused: boolean;
  orbitId: string;
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

export interface ShellState {
  apps: AppInfo[];
  windows: WindowInfo[];
  status: SystemStatus;
  orbits: OrbitSpace[];
  activeOrbit: string;
  notifications: PulseNote[];
}

export type ToggleKey = "wifi" | "bluetooth" | "focus";

export interface ShellActions {
  focusWindow(id: string): void;
  minimizeWindow(id: string): void;
  closeWindow(id: string): void;
  launchApp(appId: string): void;
  setVolume(v: number): void;
  setBrightness(v: number): void;
  toggleSetting(key: ToggleKey): void;
  dismissNotification(id: string): void;
  switchOrbit(id: string): void;
  emptyTrash(): void;
}

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
