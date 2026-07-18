# Gravity OS frontier UX workflow

Gravity OS is a complete, reversible Windows 11 desktop environment built with
Tauri 2, Rust, React, TypeScript, WebView2, and native Win32 integration. Its
visual system, terminology, interaction physics, artwork, icons, and product
identity are original to Gravity OS.

## Product standard

Every shipped control must invoke a real implementation. A feature is complete
only when its production path, persistence, error handling, keyboard access,
light and dark appearance, reduced-motion behavior, and native installed-build
verification are present. Browser-only demonstrations and inert placeholders do
not count.

The principal surfaces are Horizon (menu and active-window controls), Orbit
(Dock), Singularity (search and actions), Constellation (window overview and
workspaces), Core (system controls), Pulse (notifications), Deep Field
(desktop and wallpapers), Gravity Wells (window storage and organization),
Window Studio (native layout tools), App Library, and Gravity Customization.

## Architecture contract

State flows from `ShellState` into surfaces, and behavior flows through
`ShellActions`. Backend capabilities must remain consistent across
`src/shell/types.ts`, the development mock, the Tauri bridge, the Rust command
boundary, and the native platform implementation. Add a focused automated test
for each contract change.

Persistent native preferences live in `%LOCALAPPDATA%\Gravity OS\settings.json`.
Frontend-owned visual state uses validated, versioned browser storage shared by
Gravity's WebView surfaces. Personal wallpaper images use IndexedDB so large
images do not overflow localStorage.

## Continuous workstreams

1. Horizon: every menu entry works, exposes keyboard navigation or an actual
   registered shortcut, and controls the correct foreground native window.
2. Orbit: application launching, minimized windows, notifications, file drops,
   app and window drag-out, smooth spring magnification, and live customization.
3. Gravity Wells: native window and application drag-in/out, capacity-aware
   distribution, multi-display placement, custom geometry and color, and stable
   pointer/z-order behavior.
4. Desktop: complete right-click controls, native window grids, personal and
   curated wallpapers, reversible appearance options, and customization access.
5. Window management: snapping, grids, scenes, rules, multi-display movement,
   undo, focus navigation, and full native control verification.
6. Applications: reliable discovery, real vendor icons, launch targets, running
   state, window lists, notifications, and context actions.
7. System integrity: Gravity/Windows handoff, taskbar and work-area restoration,
   multi-monitor DPI behavior, accessibility, performance, crash recovery,
   packaging, fresh installation, and smoke tests.

## Required gates

- `npm test`
- `npm run build`
- `cargo fmt --check` and `cargo clippy --lib -- -D warnings`
- Rust unit tests where Windows Application Control permits the test host
- Installed-build shell handoff smoke test
- Human-style pointer and keyboard testing of every changed interaction
- Dark and light visual inspection at normal and mixed display scaling

Update `docs/GRAVITY-PARITY-MATRIX.md` whenever a capability changes. Commit
only the intentional files, keep local agent configuration out of version
control, build a fresh installer, reinstall it, and leave the verified Gravity
OS process running for inspection.
