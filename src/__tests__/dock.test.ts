import { describe, expect, it } from "vitest";
import { reorderPinnedIds } from "../lib/dock";

describe("dock ordering", () => {
  it("moves a pinned application before its drop target", () => {
    expect(reorderPinnedIds(["files", "edge", "mail"], "mail", "files")).toEqual([
      "mail",
      "files",
      "edge",
    ]);
  });

  it("does not alter the order for unknown or identical ids", () => {
    const ids = ["files", "edge"];
    expect(reorderPinnedIds(ids, "missing", "edge")).toBe(ids);
    expect(reorderPinnedIds(ids, "edge", "edge")).toBe(ids);
  });
});
