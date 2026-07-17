# Gravity OS

A complete desktop-shell replacement for **Windows 11** that delivers a
macOS-Tahoe-class experience with its own identity: **mass and orbit** instead
of glass and light. Every surface obeys one law — *everything has mass* — from
the way dock icons lean into the cursor's gravity well to the way overlays pull
the desktop toward them.

Gravity OS hides the Windows taskbar and paints its own shell on top: a floating
menu bar, a physics-driven dock, a command palette, an exposé, and a control
centre. It installs and uninstalls cleanly, and always hands the desktop back to
Explorer when removed.

> Status: **v0.1**. The full UI is built and verified; the Rust core compiles on
> the mock (non-Windows) path. Producing and runtime-testing the Windows
> installer requires a Windows 11 host (see [Building on Windows](#building-the-windows-installer)).

---

## The Gravity design language

Apple's Liquid Glass is about light through glass. Gravity's metaphor is
**gravitation**, executed with the same restraint.

| Idea | How it shows up |
|------|-----------------|
| **Graviton glass** | Deep smoked-glass panels with a subtle lensing edge (light bends around mass), cool curved highlights instead of frost. |
| **Mass-based motion** | One spring model (`src/lib/physics.ts`). Light things (menus, toasts) snap; heavy things (windows, overlays) settle. |
| **Deep-space palette** | Near-black blues, never gray, with a single **aurora** accent (green→teal→indigo) for focus and toggles. |
| **Type** | Space Grotesk for display, Inter for UI — geometric, clearly not San Francisco. |
| **Two skins** | **Deep Field** (dark) and **Daybreak** (light), same physics. |

## The surfaces

Each has a Gravity name and an intentional twist away from its macOS ancestor.

| Gravity surface | macOS analogue | The difference |
|-----------------|----------------|----------------|
| **Horizon** | Menu bar | Two floating pills (app menus • status), not a full-width strip. |
| **Orbit** | Dock | Icons sit in a shallow arc and lean into the cursor's **gravity well**; running apps carry an orbital ring with a satellite, not a dot. |
| **Singularity** | Spotlight | Command palette: app search, actions, and a no-`eval` calculator (`+ - * / % ^`, parens). |
| **Constellation** | Mission Control | Windows cluster by app along constellation lines; **Orbits** are the virtual desktops. |
| **Core** | Control Center | Orbital toggles, inertial sliders, battery + brand. |
| **Pulse** | Notifications | Toasts drift in on a decaying orbit and settle. |
| **Deep Field** | Wallpaper | Live generative starfield, aurora ribbons, and lensing rings. |

All are visible together in the dev **Stage** (`src/surfaces/Stage.tsx`).

---

## Architecture

**Tauri 2 (Rust core) + React/TypeScript (WebView2 UI).** Chosen because a shell
runs all day and must idle lean, and because Graviton glass is far easier to get
pixel-right in CSS than in WinUI.

```
src/                     React shell UI (runs in the browser on macOS via a mock)
  shell/                 Backend-agnostic state layer
    types.ts             ShellState/actions shared with Rust
    mock.ts              Simulated Windows machine for macOS dev
    tauri.ts             Live IPC provider (polls the Rust core on Windows)
    context.tsx          Picks mock vs Tauri automatically
  surfaces/              Horizon, Orbit, Singularity, Core, Constellation, Pulse, DeepField, Stage
  lib/                   physics.ts (springs, gravity well), search.ts (rank + calculator)
  components/            AppTile (per-app monogram identity), Icons

src-tauri/               Rust core
  src/shell.rs           ShellState mirror (serde camelCase)
  src/commands.rs        Tauri IPC commands
  src/platform/
    mod.rs               ShellPlatform trait + compile-time backend selection
    mock.rs              Off-Windows backend (keeps macOS `cargo check` green)
    windows.rs           Win32: window enum/control, power, recycle bin
    audio.rs             Core Audio endpoint volume (COM)
    appindex.rs          Start-Menu .lnk scan, launch, window→app attribution
    shell_control.rs     Taskbar hide/restore, work-area reserve, shell swap
  installer/hooks.nsi    NSIS install/uninstall hooks (autostart + shell restore)
```

The platform is chosen at compile time: `#[cfg(windows)]` selects the real
Win32 backend, everything else selects the mock. That's why the whole project
type-checks and `cargo check`s on this Mac while the real shell logic is
Windows-only.

### How the shell takes over the desktop

Two levels, both reversible:

1. **Overlay mode (default, safe).** Gravity hides the taskbar
   (`Shell_TrayWnd`), reserves the work area so maximized apps don't sit under
   Horizon/Orbit, and floats its surfaces as separate transparent always-on-top
   windows. Explorer keeps running for file plumbing. Nothing permanent changes.

2. **Full shell replacement (opt-in).** Gravity sets itself as the per-user
   Winlogon shell (`HKCU\…\Winlogon\Shell`), so it launches instead of the
   Windows desktop at sign-in. Toggled from within Gravity
   (`set_full_replacement` command); **never forced by the installer**.

The uninstaller removes autostart and deletes the shell override, so the machine
always boots back into Explorer. If Gravity is ever set as the shell and won't
start, sign-in to another account or boot Safe Mode and delete that registry
value to recover.

---

## Develop on macOS (or any OS)

The entire UI runs against the mock backend in a normal browser.

```bash
npm install
npm run dev        # http://localhost:1420 — full composed desktop
npm test           # vitest: physics + search/calculator
npx tsc --noEmit   # type-check
```

Try it: **⌘/Ctrl-K** opens Singularity, **F3** opens Constellation, the clock
opens Core, and the dock reacts to your cursor.

---

## Building the Windows installer

Requires a **Windows 11** machine (or VM) with the
[Tauri prerequisites](https://tauri.app/start/prerequisites/): Rust, the
WebView2 runtime, and the MSVC C++ build tools.

```powershell
npm install
npm run tauri build
```

Output: `src-tauri\target\release\bundle\nsis\Gravity OS_0.1.0_x64-setup.exe`.

- **Install** runs the app and registers login autostart (overlay mode).
- **Uninstall** (Windows *Apps & features*, or the bundled uninstaller) removes
  autostart and restores the Explorer shell.

Enable full shell replacement only after you've confirmed Gravity launches
reliably on your hardware.

### Cross-compiling from macOS

You can produce a Windows binary from this Mac with
`rustup target add x86_64-pc-windows-msvc` and `cargo xwin`, but the NSIS bundle
and any runtime behaviour still need to be assembled and tested on Windows.
Treat macOS as the UI/logic environment and Windows as the integration target.

---

## Roadmap

- Reparent Deep Field to `WorkerW` so real desktop icons sit above the wallpaper.
- Per-window traffic-light overlay on third-party windows (caption hooks).
- Virtual-desktop ↔ Orbit binding via `IVirtualDesktopManager`.
- Real Wi-Fi/Bluetooth radio state; brightness via WMI/DDC-CI.
- Notification source via `UserNotificationListener`.
- Daybreak-specific light wallpaper.
- Cursor-passthrough on transparent strip regions.

## Licence & assets

Original work. Fonts are OFL (Inter, Space Grotesk). No Apple fonts, symbols,
wallpapers, or marks are used or shipped — Gravity's identity is its own.
