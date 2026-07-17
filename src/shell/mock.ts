import { hueOf } from "../lib/rng";
import type {
  AppInfo,
  PulseNote,
  ShellActions,
  ShellProviderI,
  ShellState,
  ToggleKey,
  WindowInfo,
} from "./types";

/** Simulated Windows 11 machine for developing the shell on macOS.
 *  Behaves like the real backend: apps launch with a delay, notifications
 *  arrive, the battery drains. */

const app = (name: string, pinned = true): AppInfo => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  pinned,
  hue: hueOf(name),
});

const APPS: AppInfo[] = [
  app("Files"),
  app("Edge"),
  app("Mail"),
  app("Photos"),
  app("Music"),
  app("Terminal"),
  app("Code"),
  app("Settings"),
  app("Calculator", false),
  app("Notes", false),
  app("Paint", false),
  app("Clock", false),
];

let nextId = 1;
const win = (appId: string, title: string, orbitId: string, focused = false): WindowInfo => ({
  id: `w${nextId++}`,
  appId,
  title,
  minimized: false,
  focused,
  orbitId,
});

export class MockShell implements ShellProviderI {
  private listeners = new Set<() => void>();
  private state: ShellState = {
    apps: APPS,
    windows: [
      win("edge", "Gravity OS — a new law for the desktop", "o1", true),
      win("code", "orbit.tsx — Gravity-OS", "o1"),
      win("terminal", "zsh — ~/Gravity-OS", "o1"),
      win("mail", "Inbox — 3 unread", "o2"),
      win("photos", "Library — July 2026", "o2"),
    ],
    status: {
      batteryPercent: 87,
      charging: false,
      online: true,
      network: "Deep Field 5G",
      volume: 0.6,
      brightness: 0.8,
      focus: false,
      bluetooth: true,
      trashFull: true,
    },
    orbits: [
      { id: "o1", name: "Orbit 1" },
      { id: "o2", name: "Orbit 2" },
      { id: "o3", name: "Orbit 3" },
    ],
    activeOrbit: "o1",
    notifications: [],
  };

  constructor() {
    // Life on the fake machine.
    setTimeout(() => this.notify("Messages", "Ana", "Are we still on for tonight?"), 7000);
    setTimeout(
      () => this.notify("Updates", "Gravity OS", "Welcome to Deep Field. Everything has mass."),
      18000
    );
    setInterval(() => {
      const b = this.state.status.batteryPercent;
      if (b !== null && b > 5 && !this.state.status.charging) {
        this.patchStatus({ batteryPercent: b - 1 });
      }
    }, 90_000);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ShellState {
    return this.state;
  }

  private emit(next: Partial<ShellState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
  }

  private patchStatus(patch: Partial<ShellState["status"]>) {
    this.emit({ status: { ...this.state.status, ...patch } });
  }

  private notify(appName: string, title: string, body: string) {
    const note: PulseNote = {
      id: `n${nextId++}`,
      appName,
      hue: hueOf(appName),
      title,
      body,
    };
    this.emit({ notifications: [...this.state.notifications, note] });
  }

  actions: ShellActions = {
    focusWindow: (id) => {
      this.emit({
        windows: this.state.windows.map((w) => ({
          ...w,
          focused: w.id === id,
          minimized: w.id === id ? false : w.minimized,
        })),
        activeOrbit:
          this.state.windows.find((w) => w.id === id)?.orbitId ?? this.state.activeOrbit,
      });
    },
    minimizeWindow: (id) => {
      this.emit({
        windows: this.state.windows.map((w) =>
          w.id === id ? { ...w, minimized: true, focused: false } : w
        ),
      });
    },
    closeWindow: (id) => {
      this.emit({ windows: this.state.windows.filter((w) => w.id !== id) });
    },
    launchApp: (appId) => {
      const open = this.state.windows.filter((w) => w.appId === appId);
      if (open.length > 0) {
        this.actions.focusWindow(open[0].id);
        return;
      }
      const appName = this.state.apps.find((a) => a.id === appId)?.name ?? appId;
      // Launch latency: the icon gets time to bounce.
      setTimeout(() => {
        this.emit({
          windows: [
            ...this.state.windows.map((w) => ({ ...w, focused: false })),
            win(appId, appName, this.state.activeOrbit, true),
          ],
        });
      }, 650);
    },
    setVolume: (v) => this.patchStatus({ volume: Math.min(1, Math.max(0, v)) }),
    setBrightness: (v) => this.patchStatus({ brightness: Math.min(1, Math.max(0, v)) }),
    toggleSetting: (key: ToggleKey) => {
      if (key === "wifi") {
        const online = !this.state.status.online;
        this.patchStatus({ online, network: online ? "Deep Field 5G" : null });
      } else if (key === "bluetooth") {
        this.patchStatus({ bluetooth: !this.state.status.bluetooth });
      } else {
        this.patchStatus({ focus: !this.state.status.focus });
      }
    },
    dismissNotification: (id) => {
      this.emit({ notifications: this.state.notifications.filter((n) => n.id !== id) });
    },
    switchOrbit: (id) => this.emit({ activeOrbit: id }),
    emptyTrash: () => this.patchStatus({ trashFull: false }),
  };
}
