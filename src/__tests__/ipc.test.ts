import { describe, expect, it } from "vitest";
import { ipc } from "../shell/ipc";

describe("Tauri IPC contracts", () => {
  it("sends camelCase appId to the Rust launch_app command", () => {
    expect(ipc.launchApp("calculator")).toEqual({
      command: "launch_app",
      args: { appId: "calculator" },
    });
  });
});
