import { describe, expect, it } from "vitest";
import type { WellDefinition } from "../lib/wells";
import {
  scaleWellGroup,
  toggleWellSelection,
  translateWellGroup,
  wellsInMarquee,
} from "../lib/well-selection";

const wells: WellDefinition[] = [
  { id: "a", name: "A", kind: "cube", color: "mint", x: .2, y: .3, monitor: 0, scale: 1, rotation: 0 },
  { id: "b", name: "B", kind: "orb", color: "ocean", x: .4, y: .5, monitor: 0, scale: 1, rotation: 0 },
  { id: "c", name: "C", kind: "ring", color: "violet", x: .8, y: .8, monitor: 1, scale: 1, rotation: 0 },
];

describe("Gravity Well selection transforms", () => {
  it("supports replacement and additive toggles", () => {
    expect([...toggleWellSelection(new Set(["a"]), "b", false)]).toEqual(["b"]);
    expect([...toggleWellSelection(new Set(["a"]), "b", true)]).toEqual(["a", "b"]);
    expect([...toggleWellSelection(new Set(["a", "b"]), "a", true)]).toEqual(["b"]);
  });

  it("marquee-selects intersecting shapes only on the active display", () => {
    const selected = wellsInMarquee(wells, 0, { left: .1, top: .2, right: .45, bottom: .56 }, 1000, 800);
    expect([...selected]).toEqual(["a", "b"]);
  });

  it("moves a group without changing spacing and clamps the whole group", () => {
    const moved = translateWellGroup(wells, new Set(["a", "b"]), "a", .95, .85);
    const a = moved.find((well) => well.id === "a")!;
    const b = moved.find((well) => well.id === "b")!;
    expect(b.x).toBeCloseTo(.96);
    expect(b.y).toBeCloseTo(.9);
    expect(b.x - a.x).toBeCloseTo(.2);
    expect(b.y - a.y).toBeCloseTo(.2);
  });

  it("scales only the group and respects the supported range", () => {
    const larger = scaleWellGroup(wells, new Set(["a", "b"]), .8);
    expect(larger.find((well) => well.id === "a")?.scale).toBe(1.5);
    expect(larger.find((well) => well.id === "b")?.scale).toBe(1.5);
    expect(larger.find((well) => well.id === "c")?.scale).toBe(1);
  });
});
