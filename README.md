# Gravity OS

Gravity OS is a complete Windows 11 desktop environment built with Tauri 2,
Rust, React, and WebView2. It keeps Windows compatibility underneath while
replacing the everyday shell experience with Gravity's original mass-and-orbit
design language.

Version 1.0 is a native, multi-monitor shell rather than a static concept UI.
Dock applications launch, focus, restore, pin, reorder, and expose window
actions. Window layouts, workspaces, scenes, rules, notifications, radios,
brightness, volume, appearance, wallpapers, and system actions are backed by
Windows APIs and persisted across sessions.

No Apple artwork, fonts, symbols, wallpaper, or branding is included.

## Experience

| Surface | Function |
|---|---|
| **Deep Field** | Per-monitor animated desktop attached to Explorer's WorkerW, with original paired light/dark wallpapers and persistent Desktop Shapes. |
| **Horizon** | Native top AppBar with application, edit, window-management, appearance, system, and session controls. |
| **Orbit** | Native application dock with installed-app discovery, real icons, spring-damped magnification, running/minimized state, launch feedback, focus/restore, drag reordering, pinning, and context actions. |
| **Singularity** | Ranked application/action search and a parser-based calculator. |
| **Constellation** | Live window overview and three managed Orbit workspaces with drag-to-workspace movement. |
| **Window Studio** | Layout gallery, 6×4 freeform Grid Picker, keyboard Warp mode, reusable auto-restoring scenes, app rules, ignore list, gaps, and shortcut reference. |
| **Desktop Shapes** | Nine persistent 3D window wells with capacity, size/color controls, grid organization, native drag-in parking, click/drag-out release, and Dock minimization. |
| **Applications** | Searchable installed-application library with launch and pin controls. |
| **Core** | Live volume, DDC/CI brightness, Wi-Fi, Bluetooth, focus, power, battery, and shell controls. |
| **Pulse** | Windows Action Center feed with focus filtering and dismiss actions. |

Appearance can follow Windows or be forced to light/dark. It can be changed
from Horizon, Orbit, or the desktop context menu; the selected paired wallpaper
and every window update together.

## Window management

Gravity ports and extends the geometry engine from the sibling `Gravity`
project. Supported actions include halves, quarters, thirds, two-thirds,
sixths, maximize, almost-maximize, center, grow/shrink, multi-monitor transfer,
directional focus, cascade, application tiling, gather, paired layouts, undo,
and configurable repeated-key cycling. Every Gravity layout, focus, Scene,
Grid, Warp, and Desktop Shape shortcut can be recorded, cleared, conflict-
checked, or reset live in Window Studio; the Windows 11 handoff chord remains
permanently available as a recovery control.

Default global shortcuts:

| Shortcut | Action |
|---|---|
| `Alt+Space` | Singularity |
| `F3` | Constellation |
| `Ctrl+Alt+Arrow` | Half-screen layout |
| `Ctrl+Alt+Enter` | Maximize |
| `Ctrl+Alt+Z` | Undo last layout |
| `Ctrl+Alt+Shift+Left/Right` | Move to adjacent display |

Snap previews also appear when a normal Windows application is dragged into a
screen edge or corner zone. Holding `Alt` over a left or right edge selects a
two-thirds region. Native windows can also be dropped onto a Desktop Shape to
park them without losing their original position.

Window Studio exposes every ported Gravity workflow: exact 6×4 grid painting,
keyboard move/resize Warp mode, scenes with display-signature auto-restore,
automatic per-app placement rules, directional focus, tile/gather/pair/arrange,
cascade, grow/shrink, display transfer, and ten-level per-window undo history.

## Architecture

```text
src/
  shell/                 Shared state/actions, queued Tauri IPC, browser mock
  surfaces/              All shell surfaces and Window Studio/Applications
  lib/                   Dock, wallpaper, search, icon, and motion utilities

src-tauri/src/
  commands.rs            Validated IPC boundary
  settings.rs            Atomic per-user persistence and migrations
  geometry.rs            Platform-neutral layout engine and tests
  platform/appindex.rs   Start Menu + AppsFolder catalog, icons, launch, AUMID matching
  platform/windowing.rs  Win32 window actions, history, scenes, rules, workspaces
  platform/shell_control.rs  AppBars, taskbar handoff, WorkerW, shell recovery
  platform/snap.rs       Global move/resize hook and snap preview surfaces
  platform/audio.rs      Core Audio volume
  platform/brightness.rs DDC/CI monitor brightness
  platform/radio.rs      Windows Runtime Wi-Fi/Bluetooth controls
  platform/network.rs    Native Wi-Fi connection state
  platform/notifications.rs Windows notification listener
```

Each display receives its own Deep Field, Horizon, Orbit, snap, and overlay
surface using physical coordinates, so mixed-DPI and negative-coordinate
monitor arrangements remain aligned. Native AppBars reserve the usable work
area. Orbit keeps a compact centered hitbox so transparent margins do not steal
input from normal applications.

Gravity starts in reversible overlay mode: Explorer remains available for file
and desktop plumbing, while its taskbar is handed off to Gravity. Switching to
Windows 11 or quitting unregisters every AppBar, restores the user's original
taskbar mode, and shows Explorer's taskbar again. Optional per-user Winlogon
shell replacement is available but is never enabled by the installer.

## Develop and test

Requirements: Node.js 20+, Rust stable, Windows 11, WebView2, and the Microsoft
C++ build tools required by Tauri.

```powershell
npm install
npm run dev
npm test
npx tsc --noEmit
cd src-tauri
cargo check --lib
```

`npm run dev` exposes a composed browser Stage at `http://localhost:1420`.
Running `npm run tauri dev` exercises the real multi-window Windows shell.

The platform-neutral geometry suite can also be run directly:

```powershell
rustc --edition 2021 --test src-tauri/src/geometry.rs -o $env:TEMP\gravity-geometry-tests.exe
& $env:TEMP\gravity-geometry-tests.exe
```

## Build and install

```powershell
npm install
npm run tauri build
```

The current-user NSIS installer is emitted under
`src-tauri\target\release\bundle\nsis`. Installation registers Gravity for
login in safe overlay mode. Uninstall removes autostart and any optional
per-user shell override.

Windows Smart App Control expects public release installers and executables to
be signed by a certificate rooted in a trusted CA. Local development builds can
be tested on the build machine, but public artifacts should be Authenticode
signed as part of the release pipeline.

## Recovery

- Use **Switch to Windows 11** in Horizon, Orbit, or the tray to suspend Gravity.
- Use **Quit Gravity OS** to restore Explorer and exit.
- If optional full shell replacement was enabled and Gravity cannot start,
  remove `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell`
  from another account or Safe Mode.
- The NSIS uninstaller performs that registry cleanup automatically.

## License and assets

Original work by Luke McLaughlin. Inter and Space Grotesk are distributed under
the SIL Open Font License. Gravity's generated wallpapers are original project
assets and contain no third-party marks.
