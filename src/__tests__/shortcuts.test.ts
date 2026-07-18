import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS, formatShortcut, shortcutFromEvent, SHORTCUT_DEFINITIONS } from "../lib/shortcuts";

const key = (code: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers,
}) as KeyboardEvent;

describe("remappable Gravity shortcuts", () => {
  it("keeps action ids and default bindings unique", () => {
    expect(new Set(SHORTCUT_DEFINITIONS.map((item) => item.id)).size).toBe(SHORTCUT_DEFINITIONS.length);
    expect(new Set(Object.values(DEFAULT_SHORTCUTS)).size).toBe(SHORTCUT_DEFINITIONS.length);
    expect(Object.values(DEFAULT_SHORTCUTS)).not.toContain("ctrl+alt+g");
  });

  it("records normalized Windows-compatible combinations", () => {
    expect(shortcutFromEvent(key("ArrowLeft", { ctrlKey: true, altKey: true }))).toBe("ctrl+alt+left");
    expect(shortcutFromEvent(key("KeyA", { ctrlKey: true, shiftKey: true, metaKey: true }))).toBe("ctrl+shift+super+a");
    expect(shortcutFromEvent(key("KeyA"))).toBeNull();
    expect(formatShortcut("ctrl+alt+super+left")).toBe("Ctrl  Alt  Win  ←");
  });
});
