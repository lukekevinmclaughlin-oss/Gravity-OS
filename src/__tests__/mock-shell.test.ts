import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockShell } from "../shell/mock";

describe("MockShell interaction contract", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("launches every installed app into a new focused window", async () => {
    const shell = new MockShell();
    const before = shell.snapshot().windows.length;
    await expect(shell.actions.launchApp("calculator")).resolves.toMatchObject({ accepted: true });
    await vi.advanceTimersByTimeAsync(650);

    const windows = shell.snapshot().windows;
    expect(windows).toHaveLength(before + 1);
    expect(windows[windows.length - 1]).toMatchObject({ appId: "calculator", focused: true, minimized: false });

    await shell.actions.launchApp("calculator");
    await vi.advanceTimersByTimeAsync(650);
    expect(shell.snapshot().windows.filter((window) => window.appId === "calculator")).toHaveLength(2);
  });

  it("moves focus with Orbit changes and preserves a single focused window", async () => {
    const shell = new MockShell();
    await shell.actions.switchOrbit("o2");

    expect(shell.snapshot().activeOrbit).toBe("o2");
    const focused = shell.snapshot().windows.filter((window) => window.focused);
    expect(focused).toHaveLength(1);
    expect(focused[0].orbitId).toBe("o2");
  });

  it("round-trips a real window through minimize, Dock restore, and zoom", async () => {
    const shell = new MockShell();
    const target = shell.snapshot().windows[0];

    await shell.actions.minimizeWindow(target.id);
    expect(shell.snapshot().windows.find((window) => window.id === target.id)).toMatchObject({
      minimized: true,
      focused: false,
    });

    await shell.actions.focusWindow(target.id);
    expect(shell.snapshot().windows.find((window) => window.id === target.id)).toMatchObject({
      minimized: false,
      focused: true,
    });

    await shell.actions.toggleMaximizeWindow(target.id);
    expect(shell.snapshot().windows.find((window) => window.id === target.id)?.maximized).toBe(true);
    await shell.actions.toggleMaximizeWindow(target.id);
    expect(shell.snapshot().windows.find((window) => window.id === target.id)?.maximized).toBe(false);
  });

  it("toggles Show Desktop: hides every unparked window, then restores exactly that set", async () => {
    const shell = new MockShell();
    const parked = shell.snapshot().windows[1];
    await shell.actions.parkWindow(parked.id, "well-1");
    const alreadyMinimized = shell.snapshot().windows[2];
    await shell.actions.minimizeWindow(alreadyMinimized.id);

    await expect(shell.actions.toggleShowDesktop()).resolves.toBe(true);
    const shown = shell.snapshot().windows;
    expect(shown.filter((window) => !window.minimized && !window.parkedWellId)).toHaveLength(0);
    expect(shown.find((window) => window.id === parked.id)?.parkedWellId).toBe("well-1");

    await expect(shell.actions.toggleShowDesktop()).resolves.toBe(false);
    const restored = shell.snapshot().windows;
    // The set the toggle hid comes back; the window the user minimized stays down.
    expect(restored.find((window) => window.id === alreadyMinimized.id)?.minimized).toBe(true);
    expect(restored.filter((window) => !window.minimized).length).toBeGreaterThan(0);
    expect(restored.find((window) => window.id === parked.id)?.parkedWellId).toBe("well-1");
  });

  it("opens the Trash as the tile's primary action", async () => {
    const shell = new MockShell();
    const before = shell.snapshot().notifications.length;
    await shell.actions.openTrash();
    expect(shell.snapshot().notifications.length).toBe(before + 1);
  });

  it("drives the media session through the transport contract", async () => {
    const shell = new MockShell();
    expect(shell.snapshot().status.nowPlaying?.playing).toBe(true);

    await shell.actions.mediaControl("play-pause");
    expect(shell.snapshot().status.nowPlaying?.playing).toBe(false);

    const before = shell.snapshot().status.nowPlaying!.title;
    await shell.actions.mediaControl("next");
    const after = shell.snapshot().status.nowPlaying!;
    expect(after.playing).toBe(true);
    expect(after.title).not.toBe(before);
  });

  it("routes Horizon controls through the active-window contract", async () => {
    const shell = new MockShell();
    const target = shell.snapshot().windows.find((window) => window.focused)!;

    await shell.actions.activeWindowControl("zoom");
    expect(shell.snapshot().windows.find((window) => window.id === target.id)?.maximized).toBe(true);
    await shell.actions.activeWindowControl("minimize");
    expect(shell.snapshot().windows.find((window) => window.id === target.id)?.minimized).toBe(true);

    const next = shell.snapshot().windows.find((window) => !window.minimized)!;
    await shell.actions.activeWindowControl("close");
    expect(shell.snapshot().windows.some((window) => window.id === next.id)).toBe(false);
  });

  it("opens dropped files with the selected Orbit application", async () => {
    const shell = new MockShell();
    const before = shell.snapshot().windows.length;
    await expect(shell.actions.launchAppWithFiles("code", ["C:\\Work\\gravity.ts"])).resolves.toMatchObject({ accepted: true });
    const windows = shell.snapshot().windows;
    expect(windows).toHaveLength(before + 1);
    expect(windows[windows.length - 1]).toMatchObject({ appId: "code", focused: true });
    expect(windows[windows.length - 1].title).toContain("gravity.ts");
  });

  it("round-trips appearance, wallpaper, volume, brightness, and shell mode", async () => {
    const shell = new MockShell();
    await shell.actions.setAppearance("light");
    await shell.actions.setWallpaper("orbital-bloom");
    await shell.actions.setVolume(-2);
    await shell.actions.setBrightness(4);
    const windowsResult = await shell.actions.setShellActive(false);

    expect(shell.snapshot().appearance).toMatchObject({ resolved: "light", wallpaperId: "orbital-bloom" });
    expect(shell.snapshot().status.volume).toBe(0);
    expect(shell.snapshot().status.brightness).toBe(1);
    expect(windowsResult).toEqual({ mode: "windows", active: false });
    expect(shell.snapshot().shellMode).toBe("windows");
  });

  it("captures, restores, and deletes Scenes with visible state changes", async () => {
    const shell = new MockShell();
    const scene = await shell.actions.captureScene("  QA desk  ");
    expect(scene.name).toBe("QA desk");
    expect(scene.windows).toHaveLength(shell.snapshot().windows.length);

    await shell.actions.restoreScene(scene.id);
    const notifications = shell.snapshot().notifications;
    expect(notifications[notifications.length - 1]?.title).toBe("Scene restored");
    await shell.actions.deleteScene(scene.id);
    expect(shell.snapshot().windowing.scenes).toHaveLength(0);
  });

  it("creates, pauses, and deletes deterministic app rules", async () => {
    const shell = new MockShell();
    await shell.actions.upsertWindowRule("calculator", "right-half", true);
    expect(shell.snapshot().windowing.rules[0]).toMatchObject({ appId: "calculator", enabled: true });
    await shell.actions.upsertWindowRule("calculator", "right-half", false);
    expect(shell.snapshot().windowing.rules[0].enabled).toBe(false);
    await shell.actions.deleteWindowRule("rule-calculator");
    expect(shell.snapshot().windowing.rules).toHaveLength(0);
  });

  it("stores windows in Desktop Shapes and releases them without losing identity", async () => {
    const shell = new MockShell();
    const target = shell.snapshot().windows[0];
    await shell.actions.parkWindow(target.id, "well-test");
    expect(shell.snapshot().windows.find((window) => window.id === target.id)).toMatchObject({
      parkedWellId: "well-test",
      focused: false,
    });
    await shell.actions.releaseWindow(target.id);
    expect(shell.snapshot().windows.find((window) => window.id === target.id)).toMatchObject({
      parkedWellId: undefined,
      focused: true,
    });
  });

  it("launches an inactive application directly into a Gravity Well", async () => {
    const shell = new MockShell();
    expect(shell.snapshot().windows.some((window) => window.appId === "calculator")).toBe(false);
    await shell.actions.storeAppInWell("calculator", "well-launch-target");
    await vi.advanceTimersByTimeAsync(750);
    const calculator = shell.snapshot().windows.find((window) => window.appId === "calculator");
    expect(calculator).toMatchObject({ parkedWellId: "well-launch-target", focused: false });
  });

  it("persists Gravity parity preferences in the interaction contract", async () => {
    const shell = new MockShell();
    const scene = await shell.actions.captureScene("Docked desk");
    await shell.actions.setSceneAutoRestore(scene.id, true);
    await shell.actions.setAppIgnored("calculator", true);
    await shell.actions.setLaunchAtLogin(true);
    expect(shell.snapshot().windowing.scenes[0].autoRestore).toBe(true);
    expect(shell.snapshot().windowing.ignoredAppIds).toContain("calculator");
    expect(shell.snapshot().windowing.launchAtLogin).toBe(true);
  });

  it("remaps, clears, conflict-checks, and resets global shortcuts", async () => {
    const shell = new MockShell();
    await shell.actions.setShortcut("left-half", "ctrl+alt+shift+q");
    expect(shell.snapshot().windowing.shortcuts["left-half"]).toBe("ctrl+alt+shift+q");
    await expect(shell.actions.setShortcut("right-half", "ctrl+alt+shift+q")).rejects.toThrow("already assigned");
    await expect(shell.actions.setShortcut("right-half", "ctrl+alt+g")).rejects.toThrow("reserved");
    await shell.actions.setShortcut("left-half", null);
    expect(shell.snapshot().windowing.shortcuts["left-half"]).toBeUndefined();
    await shell.actions.resetShortcuts();
    expect(shell.snapshot().windowing.shortcuts["left-half"]).toBe("ctrl+alt+left");
  });

  it("rejects stale window, Orbit, app, wallpaper, Scene, and Rule targets", async () => {
    const shell = new MockShell();
    await expect(shell.actions.focusWindow("missing")).rejects.toThrow("no longer available");
    await expect(shell.actions.switchOrbit("missing")).rejects.toThrow("does not exist");
    await expect(shell.actions.launchApp("missing")).rejects.toThrow("no longer installed");
    await expect(shell.actions.setWallpaper("missing")).rejects.toThrow("not available");
    await expect(shell.actions.deleteScene("missing")).rejects.toThrow("no longer exists");
    await expect(shell.actions.deleteWindowRule("missing")).rejects.toThrow("no longer exists");
  });
});
