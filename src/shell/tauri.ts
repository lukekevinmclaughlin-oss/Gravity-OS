import type { LaunchResult, ShellActions, ShellProviderI, ShellState } from "./types";
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
  windowing: { gap: 10, cycling: true, scenes: [], rules: [] },
};

export class TauriShell implements ShellProviderI {
  private listeners = new Set<() => void>();
  private state: ShellState = EMPTY;
  private readonly ready: Promise<Invoke>;
  private lastJson = "";

  constructor(pollMs = 1000) {
    // Commands issued during WebView startup queue behind this promise.
    this.ready = import("@tauri-apps/api/core").then((core) => core.invoke as Invoke);
    void this.start(pollMs);
  }

  private async start(pollMs: number) {
    await this.refresh();
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

  private dispatch(cmd: string, args?: Record<string, unknown>) {
    void this.call<void>(cmd, args).catch((err) => console.error(cmd, err));
  }

  actions: ShellActions = {
    focusWindow: (id) => this.dispatch("focus_window", { id }),
    minimizeWindow: (id) => this.dispatch("minimize_window", { id }),
    closeWindow: (id) => this.dispatch("close_window", { id }),
    windowAction: (action) => this.call<void>("window_action", { action }),
    windowActionFor: (windowId, action) =>
      this.call<void>("window_action_for", { windowId, action }),
    launchApp: (appId) => {
      const { command, args } = ipc.launchApp(appId);
      return this.call<LaunchResult>(command, args);
    },
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
    upsertWindowRule: async (appId, action, enabled) => {
      await this.call<void>("upsert_window_rule", { appId, action, enabled });
      await this.refresh();
    },
    deleteWindowRule: async (ruleId) => {
      await this.call<void>("delete_window_rule", { ruleId });
      await this.refresh();
    },
    setVolume: (v) => this.dispatch("set_volume", { value: v }),
    setBrightness: (v) => this.call<void>("set_brightness", { value: v }),
    toggleSetting: (key) => this.call<void>("toggle_setting", { key }).then(() => this.refresh()),
    dismissNotification: (id) => this.dispatch("dismiss_notification", { id }),
    switchOrbit: (id) => {
      void this.call<void>("switch_orbit", { id }).then(() => this.refresh());
    },
    moveWindowToOrbit: (windowId, orbitId) =>
      this.call<void>("move_window_to_orbit", { windowId, orbitId }).then(() => this.refresh()),
    emptyTrash: () => this.dispatch("empty_trash"),
    powerAction: (kind) => this.dispatch("power_action", { kind }),
    editAction: (kind) => this.dispatch("edit_action", { kind }),
    openSetting: (uri) => this.dispatch("open_uri", { uri }),
    setShellActive: (active) => this.dispatch("set_shell_active", { active }),
    quitShell: () => this.dispatch("quit_shell"),
  };
}
