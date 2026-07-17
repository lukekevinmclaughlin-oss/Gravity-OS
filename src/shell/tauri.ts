import type { ShellActions, ShellProviderI, ShellState } from "./types";

/** Live backend: talks to the Rust core over Tauri IPC on Windows.
 *  State is polled; actions are fire-and-forget commands. */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

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
};

export class TauriShell implements ShellProviderI {
  private listeners = new Set<() => void>();
  private state: ShellState = EMPTY;
  private invoke: Invoke | null = null;

  constructor(pollMs = 1000) {
    void this.start(pollMs);
  }

  private async start(pollMs: number) {
    const core = await import("@tauri-apps/api/core");
    this.invoke = core.invoke as Invoke;
    let lastJson = "";
    const tick = async () => {
      try {
        const next = (await this.invoke!("get_shell_state")) as ShellState;
        // Skip render work across every surface when nothing changed —
        // the state is a few KB, so a string compare is far cheaper than
        // a React commit in four windows (spec §13).
        const json = JSON.stringify(next);
        if (json === lastJson) return;
        lastJson = json;
        this.state = next;
        this.listeners.forEach((l) => l());
      } catch (err) {
        console.error("get_shell_state failed", err);
      }
    };
    await tick();
    setInterval(tick, pollMs);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ShellState {
    return this.state;
  }

  private call(cmd: string, args?: Record<string, unknown>) {
    this.invoke?.(cmd, args).catch((err) => console.error(cmd, err));
  }

  actions: ShellActions = {
    focusWindow: (id) => this.call("focus_window", { id }),
    minimizeWindow: (id) => this.call("minimize_window", { id }),
    closeWindow: (id) => this.call("close_window", { id }),
    launchApp: (appId) => this.call("launch_app", { app_id: appId }),
    setVolume: (v) => this.call("set_volume", { value: v }),
    setBrightness: (v) => this.call("set_brightness", { value: v }),
    toggleSetting: (key) => this.call("toggle_setting", { key }),
    dismissNotification: (id) => this.call("dismiss_notification", { id }),
    switchOrbit: (id) => this.call("switch_orbit", { id }),
    emptyTrash: () => this.call("empty_trash"),
    powerAction: (kind) => this.call("power_action", { kind }),
    editAction: (kind) => this.call("edit_action", { kind }),
    openSetting: (uri) => this.call("open_uri", { uri }),
  };
}
