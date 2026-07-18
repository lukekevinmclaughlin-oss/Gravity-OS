# Gravity OS — Next Stack: From Shell Replacement to Operating System

**How to use this document.** Paste it whole as the first message of a ChatGPT /
Codex session with access to the `Gravity-OS` repository, then drive with short
follow-ups: *"Run Wave 1"*, *"Execute NS-5.2"*. Every workstream carries current
state (verified against the tree at commit `7e6bd9c`), exact tasks, technology
choices, and acceptance criteria. It extends — never replaces — the governing
`docs/GRAVITY-UX-WORKFLOW.md` and the audit in `docs/GRAVITY-PARITY-MATRIX.md`;
keep both updated as you land work.

---

## 0. Role and mission

You are the platform engineer of **Gravity OS** (Tauri 2 + Rust + React 18 +
TypeScript + WebView2 + Win32/WinRT), a reversible Windows 11 desktop
environment with an original mass-and-orbit identity. Version 1.x proved the
shell: real window management, Dock, wells, search, customization.

The next mission is **the operating-system illusion, made honest**: a user who
boots into Gravity should experience a complete, coherent, self-sufficient OS —
its own compositor feel, its own first-party apps, its own recovery story, its
own update channel — while Windows quietly remains the substrate underneath.

Three laws:

1. **Honesty.** Never fake a capability. Every control invokes a real
   implementation with persistence, error paths, keyboard access, both
   appearances, reduced motion, and installed-build verification
   (the Product Standard in `GRAVITY-UX-WORKFLOW.md`).
2. **Reversibility.** `Ctrl+Alt+G` and the tray always return a clean
   Windows 11. Every deepening of integration ships with its undo.
3. **Identity.** Original assets, names, art, sounds. Gravity's surface names
   are canon: Horizon, Orbit, Singularity, Constellation, Core, Pulse,
   Deep Field, Gravity Wells, Window Studio, App Library, Gravity
   Customization. New apps proposed here use placeholder names
   (**Manifest**, **Conduit**, **Telemetry**, **Lens**) — confirm naming with
   Luke before shipping anything user-visible.

This is **not** kernel or driver work. Gravity does not replace the Windows
kernel, session manager, logon, or security model; it replaces the *experience*.
Anything requiring drivers, kernel patches, or credential handling is out of
scope permanently.

---

## 1. Where the stack stands (verified 7e6bd9c)

**Strong.** Rust geometry engine + Win32 windowing (snap, scenes, rules, undo,
warp, grid); per-monitor AppBar surfaces with physical-pixel correctness;
app catalog with real icon extraction (Win32 + UWP/AppsFolder); wells with
native park/release and a region-shaped interaction layer; a personalization
system (Customization Center; dock size/magnification/material/motion; personal
wallpapers in IndexedDB with fit/dim/blur/saturation/tint); shortcut schema v2
with migrations; reversible taskbar handoff; per-surface React error
boundaries; Vitest + Rust unit tests on the contract.

**The six ceilings** (each maps to a stack addition in §2):

| # | Ceiling | Evidence |
|---|---|---|
| C1 | **Rendering.** Glass is CSS-only — `backdrop-filter` cannot see other apps' pixels (no `window-vibrancy` in `Cargo.toml`); no DWM thumbnails, no `Windows.Graphics.Capture`; wallpaper is a CPU canvas. Live pixels — the heart of Exposé/minimize-fly/well previews — do not exist yet. | `tokens.css:103-112`, no `Dwm*Thumbnail` in tree |
| C2 | **Freshness.** State is poll-dominant: 1s/5s frontend refresh + 5s notification poll, WinEvent hooks used only for drag/foreground. Idle cost and latency are both paying for it. | `shell/tauri.ts:56`, `windows.rs:302`, matrix "Partial" |
| C3 | **Process.** One process owns everything; there is no supervisor, no crash journal, no safe mode. A hang anywhere is a shell hang. | single Tauri proc, `lib.rs` |
| C4 | **Data.** Three stores with a fault line: native `settings.json` (appearance, wallpaper id, shortcuts, scenes, rules, pins) vs frontend localStorage (`gravity.personalization.v1`, wells) vs IndexedDB (wallpaper blobs). No queryable store → no clipboard history, no notification history, no learned ranking, no tags. | `settings.rs`, `customization.ts:44,143` |
| C5 | **Apps.** Gravity has no first-party apps. The moment a user needs a file, a terminal, or a process list, they fall out of Gravity into Explorer/Windows UI — the illusion breaks. | — |
| C6 | **Trust & delivery.** No CI, no rustfmt/clippy configs (the gates named in `GRAVITY-UX-WORKFLOW.md` are aspirational today), no signing pipeline (Smart App Control blocks unsigned release builds), no updater. | no `.github/`, no `rustfmt.toml` |

**Feel debts still open from the parity era** (folded into NS-2/NS-13, verified
absent): 1:1 dock magnification (still spring-smoothed in-shelf,
`Orbit.tsx:274-332`), mouse-down/drag-select menus (click-open today,
`Horizon.tsx:363`), Pulse hover-pause/swipe/history, auto-hide, dock folders,
hot corners, accent picker, icon tint, reduce-transparency, dynamic wallpaper,
desktop widgets, well multi-select/emblems, solar organizer/saver, boot/lock
veils, Show Desktop, traffic-light overlay on foreign windows.

---

## 2. The Next Stack

Additions to the technology stack, layer by layer. Nothing here replaces the
Tauri 2 + React foundation — each layer removes one ceiling.

| Layer | Today | Add | Why |
|---|---|---|---|
| **L1 Compositor & live pixels** | CSS glass, CPU canvas wallpaper | `window-vibrancy` (acrylic `DWMSBT_TRANSIENTWINDOW`); a **DWM thumbnail service** in Rust (`DwmRegisterThumbnail` registry with lifecycle ownership); `Windows.Graphics.Capture` one-shot snapshots; **WebGPU** rendering for Deep Field (WebView2 supports it) with canvas fallback | Real behind-window blur; live window pixels for Constellation/minimize-fly/well faces; wallpaper effects at GPU cost ~0 |
| **L2 Event fabric** | Poll + partial WinEvents | Full WinEvent set (`EVENT_OBJECT_CREATE/DESTROY/NAMECHANGE/LOCATIONCHANGE`, `EVENT_SYSTEM_MINIMIZESTART/END`) + `RegisterShellHookWindow`; Rust-side state hash; push diffs over `gravity://state-changed`; polls remain only for battery (30s) and one 60s reconciliation sweep | <1% idle CPU, <100ms UI reaction, prerequisite for fly animations |
| **L3 Supervision** | none | A ~200KB **`gravity-supervisor`** Rust binary (new workspace member): launches the shell, watches the process + a heartbeat named pipe, restores taskbar/work area on death, respawns once per minute max, offers the recovery console; owns nothing else | An OS may never leave the desk dirty; crash → usable desktop in <1s |
| **L4 System store** | settings.json + localStorage + IndexedDB | **`rusqlite`** (bundled) at `%LOCALAPPDATA%\Gravity OS\system.db`: clipboard history (opt-in, DPAPI-encrypted blobs), notification history, Singularity usage ranking, file tags, session journal. Plus: **unify preferences** — personalization moves into the native settings store through the contract; localStorage remains cache only | History features are what make an OS feel *alive over time*; single source of truth ends the split flagged in the audit |
| **L5 Search** | fuzzy rank over apps/actions | WinRT `Windows.Storage.Search` (indexed, `OnlyUseIndexer`) for files; ranking learned from the store (launch counts, recency); optional later: own USN-journal indexer service — only if the Windows index proves insufficient | Singularity becomes the OS command layer |
| **L6 Media & devices** | volume + DDC brightness + radios | WinRT `GlobalSystemMediaTransportControlsSessionManager` (Now Playing); `IMMDeviceEnumerator` endpoint enumeration + PolicyConfig default-switch behind a capability probe; `PowerSettingRegisterNotification` push battery | Core stops being a toggle box and becomes the system's chest panel |
| **L7 App platform** | shell surfaces only | First-party apps as overlay surfaces sharing one window-chrome kit (traffic lights, glass toolbar, sidebar grammar): **Manifest** (files), **Conduit** (terminal, ConPTY + `xterm.js`), **Telemetry** (system monitor, PDH + DXGI), **Lens** (quick-look service). A third-party SDK is explicitly **not** v1 — build four excellent apps first | C5 is the biggest illusion-breaker; apps are where users *live* |
| **L8 Input & gestures** | global shortcuts | Hot-corner engine (low-rate `GetCursorPos` + dwell); opt-in **Mac-keys mode** (low-level keyboard hook swapping Ctrl/Alt for chosen chords — never default-on, never silent); Precision-Touchpad three/four-finger gestures are **not interceptable** without drivers — instead ship a guided setup that maps Windows' own gesture-to-shortcut settings onto Gravity chords | Hands-feel without the uninstall-provoking hook traps |
| **L9 Trust & delivery** | manual builds | GitHub Actions CI (vitest, tsc, `cargo fmt --check`, `cargo clippy -D warnings`, build matrix); real `rustfmt.toml`/lint config so the documented gates exist; Authenticode signing in release (Smart App Control requirement); `tauri-plugin-updater` with a stable/frontier channel; **Software Update** pane in Customization; winget manifest | An OS updates itself and never asks users to trust unsigned binaries |
| **L10 Intelligence (optional)** | — | Deferred: a local-only assistant tier in Singularity (ONNX/llama.cpp sidecar). Off by default, no network calls, and **not part of this program** — listed to reserve the architectural seam (an `ask` action kind), nothing more | Modern-OS expectation, but never at the cost of the privacy identity |

**Dependency allowlist for this program** (closed; additions need sign-off):
`window-vibrancy`, `rusqlite` (bundled feature), `xterm.js` (+ its fit addon),
`tauri-plugin-updater`, and `windows`-crate feature additions for: DWM
(`Win32_Graphics_Dwm`), capture (`Graphics_Capture`, `Graphics_DirectX*`),
media (`Media_Control`), storage search (`Storage_Search`, `Storage_Streams`),
clipboard listener (`Win32_System_DataExchange`), DPAPI
(`Win32_Security_Cryptography`), PDH (`Win32_System_Performance`), ConPTY
(`Win32_System_Console`). Keep features minimal; compile time is a budget.

---

## 3. Workstreams

### NS-1 · Live-pixel compositor

- **NS-1.1 Acrylic.** Add `window-vibrancy`; apply acrylic to Horizon, Orbit,
  overlay, Pulse, snap-preview windows at creation in `lib.rs`; keep CSS blur
  for in-surface layering; runtime probe with CSS-only fallback; expose
  "Reduce transparency" (see NS-13.4) as the opaque path.
- **NS-1.2 Thumbnail service.** `platform/thumbnails.rs`: register/update/
  unregister DWM thumbnails keyed by (surface, hwnd); automatic cleanup on
  `EVENT_OBJECT_DESTROY` (via NS-3 fabric), surface hide, and shell exit; debug
  counter asserting zero leaks in tests. Consumers: Constellation live cards
  (exposé packing, labels on hover, wallpaper dimmed-not-blurred behind),
  minimize/restore fly (350ms `cubic-bezier(0.32,0.72,0,1)` source↔dock-tile),
  app-open zoom (tile→window on first window of a launching app).
- **NS-1.3 Well face snapshots.** One-shot `Windows.Graphics.Capture` frame at
  park time (before `SW_HIDE`), stored as the face texture; identity-tile
  fallback when capture is denied. Closes the matrix's "Live window preview on
  faces" gap correctly — a hidden window has no newer pixels than its park
  moment.
- **NS-1.4 WebGPU Deep Field.** Port `LiveDeepField` star/aurora passes to
  WebGPU with the canvas path kept as fallback; add **time-of-day palette
  keyframes** (dawn/day/dusk/night, 60s re-evaluation, 2s cross-blend) and a
  battery-saver degrade (static frame on `EnergySaverStatus::On`). Occlusion
  pause stays.

**Accept:** dragging a real window under Horizon blurs through it; a playing
video is live inside its Constellation card; minimize visibly flies; park
faces show true pixels; thumbnail leak counter reads 0 after a 100-cycle
open/close soak; wallpaper GPU cost measured and recorded in the matrix.

### NS-2 · Interaction-correctness pass (the feel debts)

- **NS-2.1** 1:1 magnification: in-shelf tile scale becomes a pure same-frame
  function of cursor X (`Orbit.tsx` `animateMagnify` spring restricted to
  shelf enter/exit ramps only).
- **NS-2.2** Horizon menus: open on `pointerdown`; press-drag-release commits
  the item under the pointer; hover slide-track stays; metrics audit (24px
  items, instant in / 150ms out, submenu 200ms).
- **NS-2.3** Pulse banners: hover pauses the linger timer; pointer-drag
  swipe-right dismisses (>120px or velocity, else spring back); linger 6000ms.
- **NS-2.4** Boot/lock veils: animate `entering-gravity`/`leaving-gravity`
  (600ms Deep-Field fade + monogram pulse; 300ms reverse); 200ms fade before
  `LockWorkStation`.
- **NS-2.5** Show Desktop: double-click empty Deep Field toggles
  minimize-all/restore-set; setting-gated.
- **NS-2.6** Motion conformance: sweep all animation constants against the
  motion dictionary (`docs/` — carry the v2 table forward into
  `docs/MOTION.md` as the single reference).

**Accept:** a Mac user's hands work without instruction; a 120Hz pointer sweep
across Orbit shows zero smoothing lag; every deviation from `MOTION.md` is
either fixed or documented as intentional.

### NS-3 · Event fabric & performance program

- **NS-3.1** Extend `snap.rs` hooks with create/destroy/name/minimize events +
  `RegisterShellHookWindow`; Rust maintains the window inventory and pushes
  hashed diffs; frontend drops its 1s/5s intervals for event subscription +
  one 60s reconciliation sweep; battery via push notification registration.
- **NS-3.2** Suspend hidden surfaces: `CoreWebView2.TrySuspend` for overlay/
  Pulse/App Library when hidden; resume on show; verify no stale-state wake
  bugs (state re-sync on resume).
- **NS-3.3** Instrumentation: a dev-only `?surface=hud` overlay showing FPS,
  frame budget violations, state-event rate, WS memory per process; ETW-style
  timing marks around state pushes; record the numbers in the matrix.
- **NS-3.4** Budgets become gates: idle < 1% CPU / < 300MB total with two
  first-party apps open; cold start < 2s from process start to interactive
  Horizon; all animation transforms/opacity only.

**Accept:** Task Manager idle < 1%; Notepad open/close reflected in Orbit
< 100ms with the poll interval deleted from `shell/tauri.ts`; HUD screenshots
attached to the PR; budgets recorded in the matrix.

### NS-4 · Supervision & recovery

- **NS-4.1** `gravity-supervisor` workspace member: spawns/monitors the shell
  (process handle + heartbeat pipe, 5s interval), restores taskbar + work area
  + AppBar state on abnormal exit (reuse `shell_control.rs` cleanup),
  bounded respawn, `--recovery` console (a minimal window offering: restart
  shell, switch to Windows, release parked windows, open logs). Installer
  registers the supervisor, not the shell, for autostart.
- **NS-4.2** Session journal: parked-window records (app id, title, original
  frame), open orbits, and surface layout written to the system store on
  change; on start after abnormal exit → Pulse note "Recovered N parked
  windows" with one-click release-all (closes matrix backlog #4).
- **NS-4.3** Safe mode: holding `Shift` during launch (or supervisor `--safe`)
  starts with default personalization + shortcuts, without wells, with the
  event fabric in verbose logging.
- **NS-4.4** Failure-injection tests: extend
  `scripts/native-shell-smoke.ps1` — kill -9 the shell mid-park, assert
  Explorer usable, supervisor respawn, journal recovery; run in CI's
  installed-build lane (NS-14).

**Accept:** `taskkill /f` on the shell leaves a usable desktop in < 1s and a
recovered session after respawn; the recovery console opens even when the
WebView cannot.

### NS-5 · System store & history

- **NS-5.1** `platform/store.rs`: rusqlite with WAL, schema-versioned
  migrations, integrity check on open, corruption → rename-and-recreate
  (never crash the shell over history data).
- **NS-5.2** Preference unification: move `gravity.personalization.v1` (dock,
  wallpaper adjustments) and wells into the native settings path through the
  contract (types → mock → tauri → commands → settings.rs), with a one-time
  localStorage import migration; localStorage remains a warm cache only;
  wallpaper *blobs* stay in IndexedDB. Ends the split-brain flagged in the
  audit.
- **NS-5.3** Clipboard history (opt-in, default OFF): hidden listener window
  (`AddClipboardFormatListener`); respect
  `ExcludeClipboardContentFromMonitorProcessing` / `CanIncludeInClipboardHistory`;
  text + images ≤1MB + file lists; DPAPI-encrypt blobs at rest; cap 50 / 72h;
  clear-on-demand and clear-on-disable; surfaced in Singularity (`/clip`, and
  `Alt+Shift+Space`); paste = place on clipboard, refocus previous window,
  synthesize `Ctrl+V` via `platform/input.rs`.
- **NS-5.4** Notification history: every Pulse note recorded (app, title,
  body, timestamp, dismissed) feeding NS-8's history column; retention 7 days.
- **NS-5.5** Usage ranking: Singularity launches/action-runs recorded
  (counts + recency halflife); rank blends fuzzy score with learned frecency.

**Accept:** a password-manager copy never appears in history (tested);
disabling wipes the table; preferences round-trip through settings.json with
the migration covered by a test; store corruption injected → shell boots
clean.

### NS-6 · Singularity → the OS command layer

- **NS-6.1** Files group via `Windows.Storage.Search` (120ms debounce, top 8,
  `kind:` filters, Enter opens, Ctrl+Enter reveals in Manifest — NS-9 — with
  Explorer fallback).
- **NS-6.2** Action registry (`src/lib/actions.ts`) with typed inline
  parameters (`snap left`, `orbit 2`, `accent coral`, `volume 40`,
  `scene studio`, `empty trash`, power verbs); parameter chips in the query
  field; per-action enable toggles in Customization.
- **NS-6.3** Quick Keys (user abbreviations, badged, matched first).
- **NS-6.4** Apps browse: Tab on empty query expands to the App Library grid
  in-panel; typing filters live.
- **NS-6.5** Tab preview pane (980px expansion): file/app metadata + Open /
  Reveal / Open With (`SHOpenWithDialog`); Lens preview embed once NS-11
  lands.
- **NS-6.6** Web fallback row (default browser; no suggestion APIs).

**Accept:** indexed files land < 150ms after pause; `accent coral` recolors
live; frecency reorders results after a week of simulated usage (unit-tested
against the store); two-stage Escape grammar intact.

### NS-7 · Core completion

- **NS-7.1** Now Playing module (artwork, title/artist, transport, per-session
  expansion) via the media-session manager; MockShell fakes a session.
- **NS-7.2** Output picker: endpoint list under volume; PolicyConfig switch
  behind a probe; `ms-settings:sound` fallback row.
- **NS-7.3** In-place module expansion morph (300ms `--ease-mass`): Wi-Fi,
  Bluetooth, Focus durations, Volume+outputs.
- **NS-7.4** Edit mode: reorder (FLIP), resize S/M/L, add/remove from a module
  gallery; layout persisted natively; per-module "Show in Horizon" promotion.

**Accept:** Spotify/Edge respond with artwork live; a customized layout
survives restart; every module keyboard-operable.

### NS-8 · Pulse → Notification Center

- **NS-8.1** History column on clock click: per-app groups with count
  collapse, Clear All, empty state; fed by NS-5.4; Focus routes banners
  silently into history with a clock badge.
- **NS-8.2** Widget stack under history: Clock/date, month Calendar, Battery,
  Now Playing (NS-7.1 backend).
- **NS-8.3** Listener-permission onboarding card
  (`ms-settings:privacy-notifications` + recheck); action buttons only when
  the toast payload exposes them.

**Accept:** real toasts mirror < 300ms; history grouping matches counts; zero
fabricated data in release builds.

### NS-9 · Manifest — the Files app (flagship)

The single biggest OS-feel unlock: a beautiful, fast, Gravity-native file
manager so daily life never requires Explorer's UI. Built on the Windows shell
data layer — `IShellItem` enumeration, `IFileOperation` (undo-capable,
recycle-aware), existing icon extraction — so nothing fights Explorer's
ownership of the filesystem.

- **NS-9.1** Shell: overlay app window using the shared chrome kit (traffic
  lights, glass toolbar, sidebar). Sidebar: Home, Desktop, Documents,
  Downloads, Pictures, drives (volume watcher), **Wells** (a well's parked
  windows listed as a place), Tags, Trash. Views: icon / list / column
  (Miller) with per-folder persistence; breadcrumb path bar; type-ahead;
  ⌫ = up, Enter = rename (Gravity grammar), Ctrl+L path entry.
- **NS-9.2** Operations: copy/move/rename/delete/new-folder through
  `IFileOperation` with progress sheets and undo toast; multi-select
  (marquee + modifiers); drag-drop to/from Explorer, Orbit tiles, wells and
  the Trash tile (OLE `IDropTarget`/`IDataObject` on the app window).
- **NS-9.3** Context menu: Gravity-native verbs (Open, Open With, Reveal,
  Tag, Compress via `IShellItem` zip folder, Park window's app…), plus an
  "Open Windows menu" escape hatch invoking the classic `IContextMenu` for
  full ecosystem compatibility (do not re-implement shell extensions).
- **NS-9.4** Tags: colored dots stored in the system store (never in file
  ADS v1), filterable from the sidebar; Singularity `tag:` token.
- **NS-9.5** Space = Lens preview (NS-11); thumbnails via
  `IShellItemImageFactory` with a virtualized grid (10k-item folders must
  scroll at 60fps).

**Accept:** a full workday of file tasks without opening Explorer UI; 10k-item
folder scrolls at frame budget; every operation undoable or confirmable;
delete goes to the real Recycle Bin; drag-drop interop with Explorer both
directions.

### NS-10 · Conduit (terminal) & Telemetry (monitor)

- **NS-10.1 Conduit:** ConPTY sessions (`CreatePseudoConsole`) bridged to
  `xterm.js` over the Tauri channel; tabs, profiles (PowerShell, cmd, WSL
  autodetect), 24-bit color, JetBrains Mono, glass chrome with opaque-pane
  option, Ctrl+F search, paste-guard for multiline. No shell integration
  gimmicks v1.
- **NS-10.2 Telemetry:** process table (ToolHelp/NtQuery via PDH counters),
  CPU/memory/GPU (DXGI budget) / disk / network graphs (60s ring buffer),
  per-process quit/kill with confirm, "heaviest now" strip; a compact Core
  module ("System load") deep-links into it.

**Accept:** Conduit survives a `vim` + resize + unicode torture script; kill
from Telemetry updates the process list < 500ms; both apps pass the chrome-kit
keyboard audit.

### NS-11 · Lens — quick-look service

- One overlay surface servicing Space-bar preview requests from Manifest,
  Singularity, and desktop selections: images (incl. animated), video/audio
  (`<video>/<audio>` with native codecs), PDF (WebView2 built-in viewer),
  text/code (syntax highlight, 2MB cap), folders (summary), fallback card
  (icon + metadata). Arrow keys page within the invoking selection; Space
  closes; Enter opens fully.

**Accept:** preview opens < 150ms for images < 5MB; no handle leaks after
1000 previews (soak script); keyboard-only operation complete.

### NS-12 · Full-OS mode & first run

- **NS-12.1 OOBE:** first-launch flow in the onboarding grammar of the
  original Gravity app (3 steps: welcome → permissions [notification listener,
  capture consent, autostart] with live grant detection → try-it tutorial for
  snap/park/search); "What's new" sheet per update.
- **NS-12.2 Boot-to-Gravity, supported:** the optional Winlogon shell
  replacement graduates from "available" to "supported": supervisor-owned
  (NS-4), pre-flight checklist (signing, recovery chord test, restore-point
  suggestion), one-click revert, and the recovery console reachable without
  the WebView. Never default; installer still never enables it.
- **NS-12.3 Session restore:** reopening Gravity restores orbits, well
  layout, open first-party apps and their windows from the session journal.
- **NS-12.4 Guided gesture setup:** a Customization page walking the user
  through mapping Windows Precision-Touchpad three/four-finger gestures to
  Gravity chords (honest about the mechanism); Mac-keys mode ships here,
  opt-in with an always-on escape chord and a first-run explainer.

**Accept:** wipe-VM test — fresh install to productive desktop in < 3
minutes without touching Windows UI except granted permissions; shell
replacement round-trips (enable → reboot → revert) cleanly on a test VM.

### NS-13 · Personalization & desktop depth

- **NS-13.1** Accent system: the 8 Gravity accents applied live to `--accent`
  + **accent-from-wallpaper** (sample dominant hue on wallpaper change,
  offered as a 9th "Auto" chip).
- **NS-13.2** Icon tint modes (Normal / Tinted / Clear at plate level;
  photographic-icon fallback; Experimental label).
- **NS-13.3** Dock: auto-hide (250ms slide / 500ms delay / 2px reveal strip,
  AppBar released while hidden), folder tiles with grid popover
  (`IShellItem` enumeration), unpin poof (original aurora-dust art),
  running-indicator style toggle.
- **NS-13.4** Reduce Transparency (opaque token set + acrylic off) and
  high-contrast pass.
- **NS-13.5** Hot corners (4 × {Constellation, Show Desktop, Singularity,
  Lock, Sleep, None}, 100ms dwell, drag-suppressed).
- **NS-13.6** Desktop widgets on Deep Field (Clock, Calendar, Battery, Now
  Playing; glass tiles, grid snap, native-persisted via NS-5.2; hit-test
  order wells > widgets > desktop).
- **NS-13.7** Wells: shift/ctrl + marquee multi-select, group move/scale,
  keyboard + screen-reader selection parity (matrix backlog #2); per-well
  emblems (glyph/emoji) rendered on bodies.
- **NS-13.8** Solar organizer as a second view over the same well store +
  opt-in `.scr` screensaver package reusing the Deep Field/solar renderer
  (matrix backlog #3; ported motion values live in the original repo's
  `OrbitWells.swift` / `SolarShowScene.swift`).
- **NS-13.9** Optional original sound pack (park thock, notification chime —
  own art, default **off**; the default experience stays silent).
- **NS-13.10** Traffic-light overlay on foreign windows (opt-in "Window
  orbs"): layered `WS_EX_NOACTIVATE` caption follower, Gravity hues, zoom
  hover → tiling menu; hidden on fullscreen/ignored apps.

**Accept:** each item lands with both appearances, reduced-motion, keyboard
path, and a matrix row flip; widgets and wells never fight over drags.

### NS-14 · Trust, delivery & platform hygiene

- **NS-14.1** Make the documented gates real: add `rustfmt.toml`, clippy
  configuration, and fix the tree to pass `cargo fmt --check` +
  `cargo clippy --lib -- -D warnings`.
- **NS-14.2** GitHub Actions: PR lane (vitest, `tsc --noEmit`, fmt, clippy,
  `cargo test` where hostable, vite build) + release lane (Tauri build, NSIS,
  Authenticode signing via secure secret, artifact upload). Document the
  Smart App Control constraint (unsigned local builds run only on the build
  machine).
- **NS-14.3** Updater: `tauri-plugin-updater`, stable/frontier channels,
  signature-verified manifests; **Software Update** pane in Customization
  (version, channel, release notes, "restart & update" with session restore
  via NS-12.3); winget manifest for `Gravity.GravityOS`.
- **NS-14.4** Accessibility & DPI audit with fixes: UIA exposure of every
  surface (WebView2 a11y tree), focus order, 4.5:1 contrast on glass,
  100/125/150/200% matrix — publish `docs/A11Y.md`.
- **NS-14.5** i18n scaffold: extract user-visible strings to a catalog
  (en-US only shipped; structure ready).
- **NS-14.6** Docs upkeep: keep `GRAVITY-UX-WORKFLOW.md` (product standard) and
  `GRAVITY-PARITY-MATRIX.md` current; add `docs/MOTION.md` (NS-2.6) and
  `docs/ARCHITECTURE.md` (the L1–L10 stack as-built).

**Accept:** CI green on a clean clone; a signed installer updates itself from
frontier channel on a test VM; `docs/` describes the system as it actually is.

---

## 4. Execution waves

- **Wave 1 — Foundations & feel:** NS-14.1/14.2 (gates + CI first — everything
  after lands safely), NS-3 (event fabric), NS-2 (feel debts), NS-1.1
  (acrylic).
- **Wave 2 — Live pixels & resilience:** NS-1.2–1.4, NS-4 (supervisor),
  NS-5.1/5.2 (store + unification), NS-7.
- **Wave 3 — Command layer & history:** NS-5.3–5.5, NS-6, NS-8, NS-13.1–13.6.
- **Wave 4 — The apps & full-OS mode:** NS-9 (Manifest), NS-11 (Lens),
  NS-10 (Conduit, Telemetry), NS-12, NS-13.7–13.10, NS-14.3–14.6.

Within a wave, order by dependency; one NS-x.y (or coherent cluster) per
commit; never mix behavior and material changes in one commit.

**Per-change checklist** (extends `GRAVITY-UX-WORKFLOW.md`): contract rule
(types → mock → tauri → commands → platform + focused test) · gates green ·
both appearances · reduced motion · keyboard path · installed-build
verification for native features · matrix updated · screenshots for visuals ·
intentional files only.

---

## 5. Budgets and exit tests

| Budget | Target |
|---|---|
| Cold start → interactive Horizon | < 2s |
| Idle CPU / total memory (2 apps open) | < 1% / < 300MB |
| Input → screen reaction (state events) | < 100ms |
| Animation | transforms + opacity only, 60fps minimum, 120Hz clean |
| Crash → usable desktop | < 1s (supervisor) |
| Fresh install → productive | < 3 min |

- **Exit test A — "It boots like an OS":** from login to Gravity (overlay
  mode), a newcomer completes: launch two apps, snap them, park one in a
  well, find a file with Singularity, browse it in Manifest, preview with
  Lens, adjust volume output, check a notification in history — without ever
  seeing Explorer UI or instructions.
- **Exit test B — "It survives like an OS":** kill -9 the shell during a
  park; desktop remains usable, session recovers, nothing is lost.
- **Exit test C — "It maintains itself like an OS":** a frontier-channel
  update arrives, installs from the Software Update pane, relaunches, and
  restores the session.
- **Exit test D — identity floor:** every screenshot in every state contains
  zero third-party assets and reads unmistakably as Gravity.

---

## 6. Definition of done

All NS acceptance criteria demonstrated in PRs; matrix backlog items 1–5
closed (NS-1.2/1.3, NS-13.7, NS-13.8, NS-4.2/4.4, NS-3.3/3.4); CI + signing +
updater live; the four exit tests pass on a clean Windows 11 VM; and
`docs/ARCHITECTURE.md` describes the shipped L1–L10 stack accurately.
