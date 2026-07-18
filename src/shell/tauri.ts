import type { LaunchResult, ShellActions, ShellProviderI, ShellState, ShellTransitionResult } from "./types";
import { ipc } from "./ipc";

/** Live backend for every Windows shell surface. */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

const EMPTY: ShellState = {
  apps: [],
  windows: [],
  status: {
    batteryPercent: null,
    charging: false,
    online: true,
    network: null,
    volume: 0.5,
    brightness: null,
    focus: false,
    bluetooth: false,
    trashFull: false,
  },
  orbits: [{ id: "o1", name: "Orbit 1" }],
  activeOrbit: "o1",
  notifications: [],
  appearance: { mode: "system", resolved: "dark", wallpaperId: "deep-field" },
  windowing: { gap: 10, cycling: true, scenes: [], rules: [], ignoredAppIds: [], launchAtLogin: false, sceneAutoRestore: true },
  shellMode: "gravity",
};

export class TauriShell implements ShellProviderI {
  private listeners = new Set<() => void>();
  private state: ShellState = EMPTY;
  private readonly ready: Promise<Invoke>;
  private lastJson = "";

  constructor(pollMs = 5000) {
    // Commands issued during WebView startup queue behind this promise.
    this.ready = import("@tauri-apps/api/core").then((core) => core.invoke as Invoke);
    void this.start(pollMs);
  }

  private async start(pollMs: number) {
    await this.refresh();
    try {
      const { listen } = await import("@tauri-apps/api/event");
      await listen("gravity://state-changed", () => void this.refresh());
      await listen("gravity://shell-active", () => void this.refresh());
    } catch (err) {
      console.error("event subscription failed", err);
    }
    setInterval(() => void this.refresh(), pollMs);
  }

  private async refresh() {
    try {
      const invoke = await this.ready;
      const next = await invoke<ShellState>("get_shell_state");
      const json = JSON.stringify(next);
      if (json === this.lastJson) return;
      this.lastJson = json;
      this.state = next;
      this.listeners.forEach((listener) => listener());
    } catch (err) {
      console.error("get_shell_state failed", err);
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ShellState {
    return this.state;
  }

  private async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const invoke = await this.ready;
    return invoke<T>(cmd, args);
  }

  private async mutate<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const result = await this.call<T>(cmd, args);
    await this.refresh();
    return result;
  }

  actions: ShellActions = {
    focusWindow: (id) => this.mutate<void>("focus_window", { id }),
    minimizeWindow: (id) => this.mutate<void>("minimize_window", { id }),
    toggleMaximizeWindow: (id) => this.mutate<void>("toggle_maximize_window", { id }),
    closeWindow: (id) => this.mutate<void>("close_window", { id }),
    windowAction: (action) => this.call<void>("window_action", { action }),
    windowActionFor: (windowId, action) =>
      this.call<void>("window_action_for", { windowId, action }),
    applyGridRegion: (windowId, x, y, width, height) =>
      this.call<void>("apply_grid_region", { windowId, x, y, width, height }),
    warpWindow: (windowId, operation) =>
      this.call<void>("warp_window", { windowId, operation }),
    parkWindow: (windowId, wellId) =>
      this.mutate<void>("park_window", { windowId, wellId }),
    releaseWindow: (windowId) => this.mutate<void>("release_window", { windowId }),
    releaseAllParkedWindows: () => this.mutate<void>("release_all_parked_windows"),
    registerDesktopWells: (targets) => this.call<void>("register_desktop_wells", { targets }),
    launchApp: (appId) => {
      const { command, args } = ipc.launchApp(appId);
      return this.call<LaunchResult>(command, args);
    },
    launchAppWithFiles: (appId, paths) =>
      this.call<LaunchResult>("launch_app_with_files", { appId, paths }),
    setAppPinned: async (appId, pinned) => {
      await this.call<void>("set_app_pinned", { appId, pinned });
      await this.refresh();
    },
    reorderPinnedApps: async (appIds) => {
      await this.call<void>("reorder_pinned_apps", { appIds });
      await this.refresh();
    },
    setAppearance: async (mode) => {
      await this.call<void>("set_appearance", { mode });
      await this.refresh();
    },
    setWallpaper: async (wallpaperId) => {
      await this.call<void>("set_wallpaper", { wallpaperId });
      await this.refresh();
    },
    setWindowPreferences: async (gap, cycling) => {
      await this.call<void>("set_window_preferences", { gap, cycling });
      await this.refresh();
    },
    captureScene: async (name) => {
      const scene = await this.call<import("./types").WindowScene>("capture_scene", { name });
      await this.refresh();
      return scene;
    },
    restoreScene: (sceneId) => this.call<void>("restore_scene", { sceneId }),
    deleteScene: async (sceneId) => {
      await this.call<void>("delete_scene", { sceneId });
      await this.refresh();
    },
    setSceneAutoRestore: (sceneId, enabled) => this.mutate<void>("set_scene_auto_restore", { sceneId, enabled }),
    setAppIgnored: (appId, ignored) => this.mutate<void>("set_app_ignored", { appId, ignored }),
    setLaunchAtLogin: (enabled) => this.mutate<void>("set_launch_at_login", { enabled }),
    upsertWindowRule: async (appId, action, enabled) => {
      await this.call<void>("upsert_window_rule", { appId, action, enabled });
      await this.refresh();
    },
    deleteWindowRule: async (ruleId) => {
      await this.call<void>("delete_window_rule", { ruleId });
      await this.refresh();
    },
    setVolume: (v) => this.mutate<void>("set_volume", { value: v }),
    setBrightness: (v) => this.call<void>("set_brightness", { value: v }),
    toggleSetting: (key) => this.call<void>("toggle_setting", { key }).then(() => this.refresh()),
    dismissNotification: (id) => this.mutate<void>("dismiss_notification", { id }),
    switchOrbit: (id) => this.mutate<void>("switch_orbit", { id }),
    moveWindowToOrbit: (windowId, orbitId) =>
      this.call<void>("move_window_to_orbit", { windowId, orbitId }).then(() => this.refresh()),
    emptyTrash: () => this.mutate<void>("empty_trash"),
    powerAction: (kind) => this.call<void>("power_action", { kind }),
    editAction: (kind, targetWindowId) =>
      this.call<void>("edit_action", { kind, targetWindowId }),
    openSetting: (uri) => this.call<void>("open_uri", { uri }),
    setShellActive: (active) =>
      this.mutate<ShellTransitionResult>("set_shell_active", { active }),
    quitShell: () => this.call<void>("quit_shell"),
  };
}
