import { afterEach, describe, expect, it, vi } from "vitest";
import { commandResults, quickKeyResults } from "../lib/actions";
import type { ActionContext } from "../lib/actions";
import { MockShell } from "../shell/mock";
import type { ShellActions } from "../shell/types";

const makeContext = (overrides: Partial<ActionContext> = {}): ActionContext => {
  const shell = new MockShell();
  return { state: shell.snapshot(), actions: shell.actions, ...overrides };
};

describe("Singularity command registry", () => {
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage;
  });

  it("parses a numeric parameter and drives the real action", async () => {
    const setVolume = vi.fn(async () => undefined);
    const context = makeContext({ actions: { setVolume } as unknown as ShellActions });
    const results = commandResults("volume 40", context);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Set Volume: 40%");
    await results[0].run();
    expect(setVolume).toHaveBeenCalledWith(0.4);
  });

  it("expands option parameters and requires a focused window for snapping", async () => {
    const windowActionFor = vi.fn(async () => undefined);
    const base = makeContext({ actions: { windowActionFor } as unknown as ShellActions });
    const results = commandResults("snap le", base);
    const left = results.find((result) => result.title === "Snap: Left Half");
    expect(left).toBeDefined();
    await expect(left!.run()).rejects.toThrow("Open an application window first.");

    const focused = commandResults("snap le", { ...base, targetWindowId: "w1" });
    await focused.find((result) => result.title === "Snap: Left Half")!.run();
    expect(windowActionFor).toHaveBeenCalledWith("w1", "left-half");
  });

  it("derives orbit options from live shell state", () => {
    const context = makeContext();
    const results = commandResults("orbit", context);
    expect(results.length).toBe(context.state.orbits.length);
    expect(results[0].title).toContain(context.state.orbits[0].name);
  });

  it("expands Quick Keys into badged, runnable registry results", async () => {
    const windowActionFor = vi.fn(async () => undefined);
    const context = { ...makeContext({ actions: { windowActionFor } as unknown as ShellActions }), targetWindowId: "w9" };
    const results = quickKeyResults("tl", { tl: "snap left-half" }, context);
    expect(results).toHaveLength(1);
    expect(results[0].sub).toContain("Quick Key");
    await results[0].run();
    expect(windowActionFor).toHaveBeenCalledWith("w9", "left-half");
    expect(quickKeyResults("nope", { tl: "snap left-half" }, context)).toHaveLength(0);
  });

  it("offers a template completion for a partial verb", async () => {
    const results = commandResults("acc", makeContext());
    const template = results.find((result) => result.title === "Set Accent…");
    expect(template).toBeDefined();
    await expect(template!.run()).resolves.toBe("accent ");
  });

  it("writes the accent preference through the personalization store", async () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    (globalThis as { window?: unknown }).window ??= globalThis;
    (globalThis as { CustomEvent?: unknown }).CustomEvent ??= class {
      constructor(public type: string) {}
    };
    (globalThis as unknown as { window: { dispatchEvent?: (event: unknown) => boolean } }).window.dispatchEvent ??= () => true;

    const results = commandResults("accent coral", makeContext());
    const coral = results.find((result) => result.title === "Accent: Coral");
    expect(coral).toBeDefined();
    await coral!.run();
    const written = JSON.parse(store.get("gravity.personalization.v1")!);
    expect(written.desktop.accent).toBe("coral");
  });
});
