import { describe, expect, it } from "vitest";
import { HEAVY, LIGHT, gravityWell, isSettled, springStep } from "../lib/physics";

function stepsToSettle(spec: typeof LIGHT): number {
  let pos = 0;
  let vel = 0;
  const dt = 1 / 120;
  for (let i = 0; i < 5000; i++) {
    [pos, vel] = springStep(pos, vel, 1, spec, dt);
    if (isSettled(pos, vel, 1)) return i;
  }
  return Infinity;
}

describe("spring", () => {
  it("settles at the target without exploding", () => {
    expect(stepsToSettle(LIGHT)).toBeLessThan(5000);
    expect(stepsToSettle(HEAVY)).toBeLessThan(5000);
  });
  it("light objects settle faster than heavy ones", () => {
    expect(stepsToSettle(LIGHT)).toBeLessThan(stepsToSettle(HEAVY));
  });
});

describe("gravityWell", () => {
  it("is 1 at the centre and 0 at the edge", () => {
    expect(gravityWell(0, 150)).toBe(1);
    expect(gravityWell(150, 150)).toBe(0);
    expect(gravityWell(300, 150)).toBe(0);
  });
  it("falls off quadratically and symmetrically", () => {
    expect(gravityWell(75, 150)).toBeCloseTo(0.25);
    expect(gravityWell(-75, 150)).toBeCloseTo(0.25);
  });
});
