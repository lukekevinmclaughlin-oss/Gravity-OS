import { hueOf } from "../lib/rng";
import { DEFAULT_SHORTCUTS } from "../lib/shortcuts";
import type {
  AppInfo,
  PulseNote,
  ShellActions,
  ShellProviderI,
  ShellState,
  ToggleKey,
  WindowInfo,
} from "./types";

/** Simulated Windows 11 machine for developing and testing the shell.
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
  maximized: false,
  focused,
  orbitId,
});

export class MockShell implements ShellProviderI {
  private listeners = new Set<() => void>();
  private showDesktopStack: string[] | null = null;
  /** Last thumbnail layout the overlay published (inspectable in tests). */
  lastThumbnailPlacements: ReadonlyArray<{ windowId: string; left: number; top: number; width: number; height: number }> = [];
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
      nowPlaying: {
        title: "Event Horizon",
        artist: "Deep Field Radio",
        playing: true,
        sourceApp: "music",
      },
    },
    orbits: [
      { id: "o1", name: "Orbit 1" },
      { id: "o2", name: "Orbit 2" },
      { id: "o3", name: "Orbit 3" },
    ],
    activeOrbit: "o1",
    notifications: [],
    appearance: { mode: "system", resolved: "dark", wallpaperId: "deep-field" },
    windowing: { gap: 10, cycling: true, scenes: [], rules: [], ignoredAppIds: [], launchAtLogin: false, sceneAutoRestore: true, shortcuts: { ...DEFAULT_SHORTCUTS } },
    shellMode: "gravity",
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
    focusWindow: async (id) => {
      if (!this.state.windows.some((window) => window.id === id)) {
        throw new Error("That preview window is no longer available.");
      }
      this.emit({
        windows: this.state.windows.map((w) => ({
          ...w,
          focused: w.id === id,
          minimized: w.id === id ? false : w.minimized,
          parkedWellId: w.id === id ? undefined : w.parkedWellId,
        })),
        activeOrbit:
          this.state.windows.find((w) => w.id === id)?.orbitId ?? this.state.activeOrbit,
      });
    },
    minimizeWindow: async (id) => {
      if (!this.state.windows.some((window) => window.id === id)) {
        throw new Error("That preview window is no longer available.");
      }
      this.emit({
        windows: this.state.windows.map((w) =>
          w.id === id ? { ...w, minimized: true, focused: false } : w
        ),
      });
    },
    closeWindow: async (id) => {
      if (!this.state.windows.some((window) => window.id === id)) {
        throw new Error("That preview window is no longer available.");
      }
      this.emit({ windows: this.state.windows.filter((w) => w.id !== id) });
    },
    activeWindowControl: async (kind) => {
      const target = this.state.windows.find((window) => window.focused && !window.minimized)
        ?? this.state.windows.find((window) => !window.minimized);
      if (!target) throw new Error("There is no active application window to control.");
      if (kind === "close") return this.actions.closeWindow(target.id);
      if (kind === "minimize") return this.actions.minimizeWindow(target.id);
      return this.actions.toggleMaximizeWindow(target.id);
    },
    windowAction: async (action) => {
      this.notify("Window Studio", "Layout applied", action);
    },
    windowActionFor: async (windowId, action) => {
      if (!this.state.windows.some((window) => window.id === windowId)) {
        throw new Error("That preview window is no longer available.");
      }
      await this.actions.focusWindow(windowId);
      this.emit({
        windows: this.state.windows.map((window) =>
          window.id === windowId ? { ...window, maximized: false } : window
        ),
      });
      this.notify("Window Studio", "Layout applied", action);
    },
    applyGridRegion: async (windowId, x, y, width, height) => {
      if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
        throw new Error("Grid regions must stay inside the visible display.");
      }
      await this.actions.focusWindow(windowId);
      this.notify("Window Studio", "Grid region applied", `${Math.round(width * 6)} by ${Math.round(height * 4)} cells`);
    },
    applyGridRegionOnMonitor: async (windowId, _monitor, x, y, width, height) =>
      this.actions.applyGridRegion(windowId, x, y, width, height),
    warpWindow: async (windowId, operation) => {
      await this.actions.focusWindow(windowId);
      this.notify("Warp Mode", "Window adjusted", operation);
    },
    parkWindow: async (windowId, wellId) => {
      if (!this.state.windows.some((window) => window.id === windowId)) {
        throw new Error("That preview window is no longer available.");
      }
      this.emit({
        windows: this.state.windows.map((window) =>
          window.id === windowId ? { ...window, parkedWellId: wellId, focused: false } : window
        ),
      });
    },
    releaseWindow: async (windowId) => {
      const target = this.state.windows.find((window) => window.id === windowId);
      if (!target?.parkedWellId) throw new Error("That window is not stored in a desktop shape.");
      this.emit({
        windows: this.state.windows.map((window) =>
          window.id === windowId
            ? { ...window, parkedWellId: undefined, focused: true }
            : { ...window, focused: false }
        ),
      });
    },
    releaseAllParkedWindows: async () => {
      this.emit({
        windows: this.state.windows.map((window) => ({ ...window, parkedWellId: undefined })),
      });
    },
    beginDockWindowDrag: async () => {},
    storeAppInWell: async (appId, wellId) => {
      const existing = this.state.windows.find((window) => window.appId === appId && !window.parkedWellId);
      if (existing) return this.actions.parkWindow(existing.id, wellId);
      await this.actions.launchApp(appId);
      setTimeout(() => {
        const target = [...this.state.windows].reverse().find((item) => item.appId === appId);
        if (target) void this.actions.parkWindow(target.id, wellId);
      }, 700);
    },
    beginDockAppDrag: async () => {},
    registerDesktopWells: async () => {},
    setWellSurfaceExpanded: async () => {},
    registerDesktopTrashTarget: async () => {},
    isDesktopTrashTarget: async (clientX, clientY) =>
      Boolean(document.elementFromPoint(clientX, clientY)?.closest(".orbit__trash")),
    desktopPointerLocation: async (clientX, clientY) => ({
      monitor: Number(new URLSearchParams(window.location.search).get("monitor") ?? 0),
      x: Math.max(0, Math.min(1, clientX / Math.max(1, window.innerWidth))),
      y: Math.max(0, Math.min(1, clientY / Math.max(1, window.innerHeight))),
    }),
    launchApp: async (appId) => {
      const targetApp = this.state.apps.find((item) => item.id === appId);
      if (!targetApp) throw new Error("That application is no longer installed.");
      const appName = targetApp.name;
      // Launch latency: the icon gets time to bounce.
      setTimeout(() => {
        this.emit({
          windows: [
            ...this.state.windows.map((w) => ({ ...w, focused: false })),
            win(appId, appName, this.state.activeOrbit, true),
          ],
        });
      }, 650);
      return { appId, accepted: true };
    },
    launchAppWithFiles: async (appId, paths) => {
      const targetApp = this.state.apps.find((item) => item.id === appId);
      if (!targetApp) throw new Error("That application is no longer installed.");
      if (!paths.length) throw new Error("Drop at least one file onto an application.");
      const fileName = paths[0].split(/[\\/]/).pop() ?? paths[0];
      this.emit({
        windows: [
          ...this.state.windows.map((window) => ({ ...window, focused: false })),
          win(appId, `${targetApp.name} — ${fileName}`, this.state.activeOrbit, true),
        ],
      });
      return { appId, accepted: true };
    },
    setAppPinned: async (appId, pinned) => {
      if (!this.state.apps.some((item) => item.id === appId)) {
        throw new Error("That application is no longer installed.");
      }
      this.emit({
        apps: this.state.apps.map((item) =>
          item.id === appId ? { ...item, pinned } : item
        ),
      });
    },
    toggleMaximizeWindow: async (id) => {
      if (!this.state.windows.some((window) => window.id === id)) {
        throw new Error("That preview window is no longer available.");
      }
      this.emit({
        windows: this.state.windows.map((window) =>
          window.id === id
            ? { ...window, maximized: !window.maximized, minimized: false, focused: true }
            : { ...window, focused: false }
        ),
      });
    },
    reorderPinnedApps: async (appIds) => {
      const known = new Set(this.state.apps.filter((item) => item.pinned).map((item) => item.id));
      if (appIds.length !== known.size || appIds.some((id) => !known.has(id))) {
        throw new Error("The dock order no longer matches the pinned applications.");
      }
      const order = new Map(appIds.map((id, index) => [id, index]));
      this.emit({
        apps: [...this.state.apps].sort((a, b) => {
          const ai = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const bi = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return ai - bi;
        }),
      });
    },
    setAppearance: async (mode) => {
      const resolved = mode === "system" ? "dark" : mode;
      this.emit({ appearance: { ...this.state.appearance, mode, resolved } });
    },
    setWallpaper: async (wallpaperId) => {
      if (!["deep-field", "event-horizon", "orbital-bloom", "glacial-lensing", "live-field"].includes(wallpaperId)) {
        throw new Error("That wallpaper is not available.");
      }
      this.emit({ appearance: { ...this.state.appearance, wallpaperId } });
    },
    setWindowPreferences: async (gap, cycling) => {
      this.emit({ windowing: { ...this.state.windowing, gap, cycling } });
    },
    setShortcut: async (actionId, binding) => {
      if (!(actionId in DEFAULT_SHORTCUTS)) throw new Error("That shortcut action is not supported.");
      const shortcuts = { ...this.state.windowing.shortcuts };
      if (binding) {
        if (["alt+space", "f3", "ctrl+alt+g"].includes(binding)) throw new Error("That shortcut is reserved for a critical Gravity control.");
        const duplicate = Object.entries(shortcuts).find(([id, value]) => id !== actionId && value === binding);
        if (duplicate) throw new Error(`That shortcut is already assigned to ${duplicate[0]}.`);
        shortcuts[actionId] = binding;
      } else {
        delete shortcuts[actionId];
      }
      this.emit({ windowing: { ...this.state.windowing, shortcuts } });
    },
    resetShortcuts: async () => {
      this.emit({ windowing: { ...this.state.windowing, shortcuts: { ...DEFAULT_SHORTCUTS } } });
    },
    captureScene: async (name) => {
      const cleanName = name.trim();
      if (!cleanName || [...cleanName].length > 64) {
        throw new Error("Scene names must contain 1 to 64 characters.");
      }
      const scene = {
        id: `scene-${Date.now()}`,
        name: cleanName,
        createdAt: Math.floor(Date.now() / 1000),
        autoRestore: false,
        displayFingerprint: "mock-1920x1080",
        windows: this.state.windows.map((window) => ({
          appId: window.appId,
          title: window.title,
          frame: { x: 0.1, y: 0.1, width: 0.8, height: 0.8, monitorIndex: 0 },
        })),
      };
      this.emit({ windowing: { ...this.state.windowing, scenes: [...this.state.windowing.scenes, scene] } });
      return scene;
    },
    restoreScene: async (sceneId) => {
      const scene = this.state.windowing.scenes.find((item) => item.id === sceneId);
      if (!scene) throw new Error("That Scene no longer exists.");
      this.notify("Window Studio", "Scene restored", scene.name);
    },
    deleteScene: async (sceneId) => {
      if (!this.state.windowing.scenes.some((scene) => scene.id === sceneId)) {
        throw new Error("That Scene no longer exists.");
      }
      this.emit({ windowing: { ...this.state.windowing, scenes: this.state.windowing.scenes.filter((scene) => scene.id !== sceneId) } });
    },
    setSceneAutoRestore: async (sceneId, enabled) => {
      if (!this.state.windowing.scenes.some((scene) => scene.id === sceneId)) throw new Error("That Scene no longer exists.");
      this.emit({ windowing: { ...this.state.windowing, scenes: this.state.windowing.scenes.map((scene) => scene.id === sceneId ? { ...scene, autoRestore: enabled } : scene) } });
    },
    setAppIgnored: async (appId, ignored) => {
      if (!this.state.apps.some((item) => item.id === appId)) throw new Error("That application is no longer installed.");
      const ignoredAppIds = this.state.windowing.ignoredAppIds.filter((id) => id !== appId);
      if (ignored) ignoredAppIds.push(appId);
      this.emit({ windowing: { ...this.state.windowing, ignoredAppIds } });
    },
    setLaunchAtLogin: async (enabled) => {
      this.emit({ windowing: { ...this.state.windowing, launchAtLogin: enabled } });
    },
    upsertWindowRule: async (appId, action, enabled) => {
      const app = this.state.apps.find((item) => item.id === appId);
      if (!app) throw new Error("That application is no longer installed.");
      const rule = { id: `rule-${appId}`, appId, appName: app?.name ?? appId, action, enabled };
      this.emit({ windowing: { ...this.state.windowing, rules: [...this.state.windowing.rules.filter((item) => item.id !== rule.id), rule] } });
    },
    deleteWindowRule: async (ruleId) => {
      if (!this.state.windowing.rules.some((rule) => rule.id === ruleId)) {
        throw new Error("That Rule no longer exists.");
      }
      this.emit({ windowing: { ...this.state.windowing, rules: this.state.windowing.rules.filter((rule) => rule.id !== ruleId) } });
    },
    setVolume: async (v) => this.patchStatus({ volume: Math.min(1, Math.max(0, v)) }),
    setBrightness: async (v) => this.patchStatus({ brightness: Math.min(1, Math.max(0, v)) }),
    toggleSetting: async (key: ToggleKey) => {
      if (key === "wifi") {
        const online = !this.state.status.online;
        this.patchStatus({ online, network: online ? "Deep Field 5G" : null });
      } else if (key === "bluetooth") {
        this.patchStatus({ bluetooth: !this.state.status.bluetooth });
      } else {
        this.patchStatus({ focus: !this.state.status.focus });
      }
    },
    dismissNotification: async (id) => {
      if (!this.state.notifications.some((notification) => notification.id === id)) {
        throw new Error("That notification is no longer available.");
      }
      this.emit({ notifications: this.state.notifications.filter((n) => n.id !== id) });
    },
    switchOrbit: async (id) => {
      if (!this.state.orbits.some((orbit) => orbit.id === id)) {
        throw new Error("That Orbit does not exist.");
      }
      const target = this.state.windows.find(
        (window) => window.orbitId === id && !window.minimized
      );
      this.emit({
        activeOrbit: id,
        windows: this.state.windows.map((window) => ({
          ...window,
          focused: target ? window.id === target.id : false,
        })),
      });
    },
    moveWindowToOrbit: async (windowId, orbitId) => {
      if (!this.state.orbits.some((orbit) => orbit.id === orbitId)) {
        throw new Error("That Orbit does not exist.");
      }
      if (!this.state.windows.some((window) => window.id === windowId)) {
        throw new Error("That preview window is no longer available.");
      }
      this.emit({
        windows: this.state.windows.map((window) =>
          window.id === windowId ? { ...window, orbitId } : window
        ),
      });
    },
    emptyTrash: async () => this.patchStatus({ trashFull: false }),
    openTrash: async () => this.notify("Gravity", "Trash", "Would open the Recycle Bin on Windows."),
    setConstellationThumbnails: async (placements) => {
      this.lastThumbnailPlacements = placements;
    },
    mediaControl: async (kind) => {
      const nowPlaying = this.state.status.nowPlaying;
      if (!nowPlaying) throw new Error("No application is playing media right now");
      if (kind === "play-pause") {
        this.patchStatus({ nowPlaying: { ...nowPlaying, playing: !nowPlaying.playing } });
      } else {
        const direction = kind === "next" ? 1 : -1;
        const stations = ["Event Horizon", "Aurora Drift", "Parallax", "Deep Field"];
        const index = (stations.indexOf(nowPlaying.title) + direction + stations.length) % stations.length;
        this.patchStatus({ nowPlaying: { ...nowPlaying, title: stations[index], playing: true } });
      }
    },
    toggleShowDesktop: async () => {
      const stack = this.showDesktopStack;
      const restorable = stack?.filter((id) =>
        this.state.windows.some((window) => window.id === id && window.minimized)
      ) ?? [];
      if (restorable.length > 0) {
        this.showDesktopStack = null;
        this.emit({
          windows: this.state.windows.map((window) =>
            restorable.includes(window.id) ? { ...window, minimized: false } : window
          ),
        });
        return false;
      }
      const targets = this.state.windows
        .filter((window) => !window.minimized && !window.parkedWellId)
        .map((window) => window.id);
      this.showDesktopStack = targets;
      this.emit({
        windows: this.state.windows.map((window) =>
          targets.includes(window.id) ? { ...window, minimized: true, focused: false } : window
        ),
      });
      return true;
    },
    powerAction: async (kind) => this.notify("Gravity", "Power", `“${kind}” is simulated on the mock machine.`),
    editAction: async (kind) => this.notify("Gravity", "Edit command sent", kind),
    openSetting: async (uri) => this.notify("Gravity", "Settings", `Would open ${uri} on Windows.`),
    setShellActive: async (active) => {
      const mode = active ? "gravity" as const : "windows" as const;
      this.emit({ shellMode: mode });
      this.notify("Gravity", "Shell", active ? "Gravity resumed." : "Switched to Windows 11 (simulated)." );
      return { mode, active };
    },
    quitShell: async () => this.notify("Gravity", "Shell", "Quit is simulated on the mock machine."),
  };
}
