export interface ShortcutDefinition {
  id: string;
  group: "Layouts" | "Sizing" | "Displays & windows" | "Advanced" | "Focus" | "Scenes & shapes" | "Shell & Wells";
  label: string;
  detail: string;
  defaultBinding: string;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { id: "left-half", group: "Layouts", label: "Left half", detail: "Cycles ½ → ⅔ → ⅓", defaultBinding: "ctrl+alt+left" },
  { id: "right-half", group: "Layouts", label: "Right half", detail: "Cycles ½ → ⅔ → ⅓", defaultBinding: "ctrl+alt+right" },
  { id: "top-half", group: "Layouts", label: "Top half", detail: "Upper screen region", defaultBinding: "ctrl+alt+up" },
  { id: "bottom-half", group: "Layouts", label: "Bottom half", detail: "Lower screen region", defaultBinding: "ctrl+alt+down" },
  { id: "top-left", group: "Layouts", label: "Top-left quarter", detail: "Upper-left corner", defaultBinding: "ctrl+alt+u" },
  { id: "top-right", group: "Layouts", label: "Top-right quarter", detail: "Upper-right corner", defaultBinding: "ctrl+alt+i" },
  { id: "bottom-left", group: "Layouts", label: "Bottom-left quarter", detail: "Lower-left corner", defaultBinding: "ctrl+alt+j" },
  { id: "bottom-right", group: "Layouts", label: "Bottom-right quarter", detail: "Lower-right corner", defaultBinding: "ctrl+alt+k" },
  { id: "first-third", group: "Layouts", label: "First third", detail: "First major-axis third", defaultBinding: "ctrl+alt+d" },
  { id: "center-third", group: "Layouts", label: "Center third", detail: "Middle major-axis third", defaultBinding: "ctrl+alt+f" },
  { id: "last-third", group: "Layouts", label: "Last third", detail: "H keeps Ctrl Alt G reserved", defaultBinding: "ctrl+alt+h" },
  { id: "first-two-thirds", group: "Layouts", label: "First two-thirds", detail: "Leading wide region", defaultBinding: "ctrl+alt+e" },
  { id: "last-two-thirds", group: "Layouts", label: "Last two-thirds", detail: "Trailing wide region", defaultBinding: "ctrl+alt+t" },
  { id: "maximize", group: "Sizing", label: "Fill screen", detail: "Maximize active window", defaultBinding: "ctrl+alt+enter" },
  { id: "almost-maximize", group: "Sizing", label: "Almost fill", detail: "Inset maximum layout", defaultBinding: "ctrl+alt+shift+enter" },
  { id: "center", group: "Sizing", label: "Center", detail: "Center without resizing", defaultBinding: "ctrl+alt+c" },
  { id: "restore", group: "Sizing", label: "Restore", detail: "Return to prior frame", defaultBinding: "ctrl+alt+r" },
  { id: "undo", group: "Sizing", label: "Undo Gravity move", detail: "Ten-level window history", defaultBinding: "ctrl+alt+z" },
  { id: "grow", group: "Sizing", label: "Grow", detail: "Expand about the center", defaultBinding: "ctrl+alt+pageup" },
  { id: "shrink", group: "Sizing", label: "Shrink", detail: "Contract about the center", defaultBinding: "ctrl+alt+pagedown" },
  { id: "previous-display", group: "Displays & windows", label: "Previous display", detail: "Preserve relative geometry", defaultBinding: "ctrl+alt+super+left" },
  { id: "next-display", group: "Displays & windows", label: "Next display", detail: "Preserve relative geometry", defaultBinding: "ctrl+alt+super+right" },
  { id: "tile-app", group: "Displays & windows", label: "Tile this app", detail: "Grid the current app's windows", defaultBinding: "ctrl+alt+a" },
  { id: "gather-all", group: "Displays & windows", label: "Gather all", detail: "Move all windows to this display", defaultBinding: "ctrl+alt+m" },
  { id: "arrange-display", group: "Displays & windows", label: "Arrange display", detail: "Smart grid every visible window", defaultBinding: "ctrl+alt+shift+a" },
  { id: "pair-previous", group: "Displays & windows", label: "Pair previous", detail: "Place the two latest apps side by side", defaultBinding: "ctrl+alt+p" },
  { id: "cascade", group: "Displays & windows", label: "Cascade app windows", detail: "Classic diagonal stack", defaultBinding: "ctrl+alt+b" },
  { id: "grid-picker", group: "Advanced", label: "Grid Picker", detail: "Open the 6 × 4 painter", defaultBinding: "ctrl+alt+space" },
  { id: "warp-mode", group: "Advanced", label: "Warp Mode", detail: "Keyboard move and resize", defaultBinding: "ctrl+alt+w" },
  { id: "focus-left", group: "Focus", label: "Focus left", detail: "Nearest window to the left", defaultBinding: "ctrl+alt+shift+left" },
  { id: "focus-right", group: "Focus", label: "Focus right", detail: "Nearest window to the right", defaultBinding: "ctrl+alt+shift+right" },
  { id: "focus-up", group: "Focus", label: "Focus up", detail: "Nearest window above", defaultBinding: "ctrl+alt+shift+up" },
  { id: "focus-down", group: "Focus", label: "Focus down", detail: "Nearest window below", defaultBinding: "ctrl+alt+shift+down" },
  { id: "save-scene", group: "Scenes & shapes", label: "Save desktop Scene", detail: "Capture every managed window", defaultBinding: "ctrl+alt+shift+s" },
  { id: "restore-scene", group: "Scenes & shapes", label: "Restore latest Scene", detail: "Restore the latest capture", defaultBinding: "ctrl+alt+s" },
  { id: "toggle-shapes", group: "Scenes & shapes", label: "Show or hide shapes", detail: "Stored windows stay safely parked", defaultBinding: "ctrl+alt+o" },
  { id: "equalize-shapes", group: "Scenes & shapes", label: "Equalize shape sizes", detail: "Return every shape to medium", defaultBinding: "ctrl+alt+shift+e" },
  { id: "release-parked-windows", group: "Scenes & shapes", label: "Release parked windows", detail: "Bring every stored window back", defaultBinding: "ctrl+alt+shift+o" },
  { id: "open-window-studio", group: "Shell & Wells", label: "Window Studio", detail: "Open Gravity's full window controls", defaultBinding: "ctrl+alt+0" },
  { id: "minimize-active", group: "Shell & Wells", label: "Minimize active window", detail: "Send the active window into Orbit", defaultBinding: "ctrl+alt+n" },
  { id: "close-active", group: "Shell & Wells", label: "Close active window", detail: "Close the foreground application window", defaultBinding: "ctrl+alt+q" },
  { id: "toggle-appearance", group: "Shell & Wells", label: "Toggle Daybreak", detail: "Switch between light and dark appearance", defaultBinding: "ctrl+alt+y" },
  { id: "new-well", group: "Shell & Wells", label: "Create Gravity Well", detail: "Add a new Well on the active display", defaultBinding: "ctrl+alt+shift+n" },
  ...Array.from({ length: 9 }, (_, index) => ({
    id: `store-well-${index + 1}`,
    group: "Shell & Wells" as const,
    label: `Store in Gravity Well ${index + 1}`,
    detail: `Store the active window in Well ${index + 1}`,
    defaultBinding: `ctrl+alt+${index + 1}`,
  })),
];

export const DEFAULT_SHORTCUTS = Object.fromEntries(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition.defaultBinding]),
);

const KEY_FROM_CODE: Record<string, string> = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
  Space: "space", Enter: "enter", Tab: "tab", PageUp: "pageup", PageDown: "pagedown",
  Home: "home", End: "end", Backspace: "backspace", Delete: "delete", Insert: "insert",
  Equal: "=", Minus: "-", Comma: ",", Period: ".", Backquote: "`",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Slash: "/",
};

export function shortcutFromEvent(event: KeyboardEvent): string | null {
  let key = KEY_FROM_CODE[event.code];
  if (!key && /^Key[A-Z]$/.test(event.code)) key = event.code.slice(3).toLowerCase();
  if (!key && /^Digit\d$/.test(event.code)) key = event.code.slice(5);
  if (!key && /^F([1-9]|1\d|2[0-4])$/.test(event.code)) key = event.code.toLowerCase();
  if (!key) return null;
  const modifiers = [
    event.ctrlKey ? "ctrl" : "",
    event.altKey ? "alt" : "",
    event.shiftKey ? "shift" : "",
    event.metaKey ? "super" : "",
  ].filter(Boolean);
  if (!modifiers.length) return null;
  return [...modifiers, key].join("+");
}

export function formatShortcut(binding?: string): string {
  if (!binding) return "None";
  const names: Record<string, string> = {
    ctrl: "Ctrl", alt: "Alt", shift: "Shift", super: "Win", left: "←", right: "→",
    up: "↑", down: "↓", pageup: "Page Up", pagedown: "Page Down", space: "Space",
    enter: "Enter", tab: "Tab", backspace: "Backspace", delete: "Delete",
  };
  return binding.split("+").map((part) => names[part] ?? part.toUpperCase()).join("  ");
}
