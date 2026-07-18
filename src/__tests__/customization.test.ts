import { describe, expect, it, vi } from "vitest";
import { distributeWindowsToWells, snapWindowsToGrid } from "../lib/customization";
import type { ShellActions, WindowInfo } from "../shell/types";
import type { WellDefinition } from "../lib/wells";

const windowInfo = (id: string, parkedWellId?: string): WindowInfo => ({
  id,
  appId: `app-${id}`,
  title: id,
  minimized: false,
  maximized: false,
  focused: id === "one",
  orbitId: "o1",
  parkedWellId,
});

describe("desktop customization workflows", () => {
  it("applies a real normalized frame to every unparked window", async () => {
    const applyGridRegion = vi.fn(async () => undefined);
    const actions = { applyGridRegion } as unknown as ShellActions;
    const count = await snapWindowsToGrid(
      [windowInfo("one"), windowInfo("two"), windowInfo("stored", "well-1")],
      actions,
      "quarters",
    );
    expect(count).toBe(2);
    expect(applyGridRegion).toHaveBeenNthCalledWith(1, "one", 0, 0, .5, .5);
    expect(applyGridRegion).toHaveBeenNthCalledWith(2, "two", .5, 0, .5, .5);
  });

  it("fills Gravity Wells by available capacity and reports overflow", async () => {
    const parkWindow = vi.fn(async () => undefined);
    const actions = { parkWindow } as unknown as ShellActions;
    const wells: WellDefinition[] = [
      { id: "well-1", name: "One", kind: "slab", color: "emerald", x: .2, y: .5, scale: 1, monitor: 0, rotation: 0 },
      { id: "well-2", name: "Two", kind: "diamond", color: "ocean", x: .7, y: .5, scale: 1, monitor: 0, rotation: 0 },
    ];
    const windows = [windowInfo("stored", "well-1"), ...["one", "two", "three", "four", "five", "overflow"].map((id) => windowInfo(id))];
    const result = await distributeWindowsToWells(windows, wells, actions);
    expect(result).toEqual({ stored: 5, remaining: 1 });
    expect(parkWindow).toHaveBeenNthCalledWith(1, "one", "well-1");
    expect(parkWindow).toHaveBeenNthCalledWith(2, "two", "well-2");
    expect(parkWindow).toHaveBeenCalledTimes(5);
  });
});
