# Gravity capability and parity matrix

Audit baseline: 2026-07-18, `codex/gravity-os-frontier` at `8b1d993`.

This document tracks the Windows-native Gravity OS implementation and the shell
experience needed for a polished daily-driver desktop. A capability is only marked **Complete** when a
real Windows path exists; a browser-only demonstration does not count.

Status vocabulary:

- **Complete**: native path, persistent behavior, and a recovery/error path are present.
- **Partial**: useful native behavior exists, but an important parity detail is absent.
- **Missing**: no production implementation yet.

## Gravity window-management parity

| Capability | Legacy Gravity reference | Gravity OS status | Evidence and remaining work |
|---|---|---|---|
| Halves, quarters, thirds, two-thirds, sixths, maximize, almost-maximize and center | `WindowEngine.swift`, `SnapCommand.swift` | **Complete** | Implemented by the Rust geometry engine and Win32 placement commands, including configurable gaps. |
| Repeated-shortcut snap cycling | `WindowEngine.swift` | **Complete** | Native history/cycle state is enabled by the persisted `cycling` preference. |
| Drag-to-edge snapping with preview | `DragSnapController.swift` | **Complete** | WinEvent move/size hooks drive per-monitor preview windows; `Alt` selects two-thirds edge zones. |
| Move to next/previous display | `WindowEngine.moveFocused` | **Complete** | Win32 monitor transfer preserves normalized placement across physical displays. |
| Grow, shrink, restore and ten-level undo | `WindowEngine.scaleFocused`, snap history | **Complete** | Native per-window frame history is maintained in `platform/windowing.rs`. |
| Tile current app, gather all, pair previous, arrange display and cascade | `WindowEngine.swift` | **Complete** | Exposed in Horizon and Window Studio and executed against real enumerated windows. |
| Directional focus navigation | `WindowEngine.focus` | **Complete** | Native nearest-window selection is available through commands and remappable shortcuts. |
| 6x4 Grid Picker | Gravity Grid Picker | **Complete** | Window Studio paints a normalized region and applies it through the native geometry path. |
| Keyboard Warp mode | Gravity Warp Mode | **Complete** | Move and resize operations target the selected native window; Enter/Escape end the mode. |
| Scenes and display-signature auto-restore | Gravity `SceneManager` | **Complete** | Capture, conservative title/app matching, persistence, restore and display-change auto-restore are present. |
| Per-app placement rules | Gravity `RulesManager` | **Complete** | Persisted rules apply on native window creation with deterministic layout validation. |
| Ignore list | Gravity preferences | **Complete** | Persisted ignored applications are excluded from automatic window-management behavior. |
| Launch at login | Gravity preferences | **Complete** | Current-user Windows Run registration has an explicit off path and is reflected in settings. |
| Live shortcut remapping | Gravity shortcut recorder | **Complete** | Chords are parsed, conflict-checked, atomically replaced and re-registered without restart. Critical recovery chords cannot be displaced. |

## Desktop Shapes / Gravity Well parity

| Capability | Legacy Gravity reference | Gravity OS status | Evidence and remaining work |
|---|---|---|---|
| Persistent free-floating shapes | Legacy Gravity Wells | **Complete** | Eighteen orbital geometries, eighteen preset colors plus arbitrary color, position, scale and rotation persist in shared WebView storage. |
| Native window drop-in parking | `handleDrop`, `WellController.capture` | **Complete** | Global WinEvent tracking hit-tests registered well centers and hides/restores real windows without discarding their frames. |
| Click-to-release and release-all | `faceClicked`, `restoreAllWindows` | **Complete** | Occupant controls release individual windows; removal safely releases all occupants. |
| Drag face out to desktop | `releaseFace` | **Complete** | The native cursor is resolved to a sorted physical monitor and normalized destination; the released window is restored and moved through the target monitor's work area. |
| Drag face out to Dock to minimize | `DockTrash.frame`, `releaseFace` | **Complete** | Every Orbit surface publishes its rendered Trash rectangle in physical pixels; release minimizes only when the hardware pointer is inside that exact target. |
| Drag shape onto Trash to delete | `DockTrash.frame`, `moveEnded` | **Complete** | The same exact per-monitor Trash registry is shared by Orbit and Deep Field; deletion safely releases every occupant first. |
| Multi-monitor shape movement | `moveEnded` / AppKit screen coordinates | **Complete** | Native pointer resolution handles sorted displays, mixed resolutions, negative origins and monitor gaps, then transfers the persisted shape to the destination Deep Field. |
| Shape capacity | face count per shape | **Complete** | Capacity is visually metered, full targets show a blocked-drop state, frontend storage is guarded, and the native parking path rechecks live occupancy before hiding a window. |
| Well pointer interaction and management | Per-shape controls | **Complete** | Wells render in a region-shaped native desktop interaction layer: their bodies receive real mouse input without transparent areas stealing desktop clicks. Drag movement temporarily expands the interaction surface and defers region clipping so geometry cannot flicker behind the background. Wheel rotation, Ctrl-wheel scaling, multi-monitor transfer, right-click quick controls and a full settings panel are wired. |
| App and window assignment | `handleDrop`, `WellController.capture` | **Complete** | Live windows drag directly into Wells. Active or inactive applications can be assigned from Orbit, Applications, Horizon, or Constellation; inactive apps launch and their first real window is captured. Every route rechecks native capacity. |
| Well creation and customization | Shape creation/settings | **Complete** | Desktop, global Customization and per-Well right-click menus create new Wells. Name, eighteen geometries, eighteen presets, arbitrary custom color, scale, rotation, individual release, release-all, and release-to-Orbit persist. Native selects were replaced with opaque Gravity pickers. |
| Shape selection and group operations | `select`, `deselectAll`, `equalizeAll` | **Partial** | Equalize-all and organization controls exist; shift selection, marquee selection, group move/scale and selection affordances remain. |
| Grid organization | well grid presets | **Complete** | Configurable row/column snapping persists and is available from the desktop controls. |
| Live window preview on faces | `WellFace.thumbnail` | **Missing** | Current faces use app identity tiles. Windows DWM thumbnail hosting or a safe capture fallback is required. |
| Solar organizer and screen saver | `SolarSystemController`, `SolarShowScene`, saver target | **Missing** | No Windows organizer/saver equivalent is present. It should reuse the same persisted well model rather than creating a second source of truth. |
| Recovery after restart/crash | `restoreAll` and app lifecycle | **Partial** | Normal release and shell handoff recover windows. Automated restart/crash tests for parked native windows are still required. |

## Gravity OS shell experience

| Surface / behavior | Status | Evidence and remaining work |
|---|---|---|
| Reversible Gravity / Windows 11 handoff | **Complete** | Horizon, Orbit, tray and `Ctrl+Alt+G` restore Explorer's taskbar and Gravity AppBars without changing the default Windows shell. Installer cleanup removes optional shell override state. |
| Horizon global menu bar | **Complete** | Menus operate on real focused windows and system/session APIs; appearance and Windows handoff are available directly in the bar. Further work is interaction polish and broader focused-app menu synthesis. |
| Orbit application Dock | **Complete** | Installed applications are discovered, registered AppsFolder/AUMID icons are extracted (including ChatGPT and Claude), clicks launch/focus/restore, pins reorder, files open through drop, minimized windows restore, notification badges render per app, and context actions operate on real windows. |
| Applications library | **Complete** | The installed-app grid uses an opaque Deep Field material, visible border, staged motion, search, running/pinned state, real icons, launch/pin controls, right-click actions, and app-to-Well drag/drop. |
| Orbit motion and customization | **Complete** | Spring-damped magnification, FLIP reflow and reduced-motion handling are present. Users can change icon size, magnification, radius, spacing, opacity, motion profile, labels, indicators, badges, open-app inclusion, and Floating/Glass/Solid material. Floating mode removes the continuous shelf by default. |
| Native minimize-to-Dock visual | **Partial** | Minimized windows are represented in Orbit and restore correctly; a DWM-backed live fly-to-Dock transition is not implemented. |
| Constellation overview | **Partial** | Window enumeration, focus, close and workspace movement work; cards are representations rather than live DWM thumbnails. |
| Appearance, desktop menu and wallpapers | **Complete** | System/light/dark modes update every surface. Desktop right-click offers real native grid layouts, automatic capacity-aware Well distribution, Well organization, Dock presets, Windows handoff, and global customization. Curated paired wallpapers persist; personal light/dark images use IndexedDB with fit, position, dim, blur, saturation, tint, reset and local removal. |
| Gravity Customization | **Complete** | A dedicated Dock icon and desktop action open an opaque native overlay for Desktop, Orbit and Well controls. Every control writes shared live preferences or invokes a real shell action. |
| Core controls | **Partial** | Volume, supported brightness, network/radio state, focus, power and shell controls have native paths. Media transport/output selection and richer unsupported-device messaging remain. |
| Pulse notifications | **Partial** | Windows notification access and dismiss paths exist; permission onboarding, action buttons and robust history grouping need expansion. |
| Accessibility and keyboard operation | **Partial** | Labels, arrow/Home/End/type-ahead menu navigation, visible current shortcut hints, fourteen new shell/Well shortcuts, remapping, reduced-motion support and visible messages exist. A complete screen-reader and 100/125/150/200% DPI audit remains. |
| Performance/recovery instrumentation | **Partial** | Event-driven state changes are combined with a low-rate reconciliation poll and shell cleanup paths. Formal idle CPU/memory budgets, watchdog telemetry and failure-injection tests remain. |

## Ordered implementation backlog

1. Add DWM-backed live thumbnails for Constellation and shape faces, with
   explicit cleanup on source-window destruction and surface teardown.
2. Add shift/marquee multi-selection and group movement/scaling for Desktop
   Shapes, keeping keyboard and screen-reader selection equivalent.
3. Port the Solar organizer as a second view over the existing well model,
   then add an opt-in Windows screen-saver package.
4. Add parked-window restart/crash recovery tests and a visible recovery
   command before broadening visual effects.
5. Profile idle and animated rendering at mixed DPI, then tune frame budgets,
   WebView transparency and GPU resource lifetime.
