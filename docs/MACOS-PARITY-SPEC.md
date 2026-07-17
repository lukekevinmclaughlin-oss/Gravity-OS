# Gravity OS — macOS-Parity Specification

**Premise.** You can get ~95% of the macOS feel with zero legal exposure if you
understand what is actually protected. Apple's moat is not the layout — top
menu bar + bottom dock is prior art across two decades of Linux desktops
(elementary/Pantheon, GNOME + Dash-to-Dock, KDE). The moat is the **ornament
and the assets**: the SF fonts, SF Symbols, the exact icon artwork, wallpapers,
sounds, marks, and the gestalt of shipping all of them together.

**The rule this spec follows: copy the grammar, never the glyphs.**

- **Grammar** (safe to adopt exactly): spatial layout, metrics, spacing,
  behaviors, keyboard flows, timing curves, physics values. Numbers and
  behaviors are functional; they are not copyrightable assets.
- **Glyphs** (always Gravity's own): typefaces, icons, logo, wallpaper,
  sounds, feature names, exact brand hues.
- **Identity floor** (never remove — this is what makes the whole thing
  defensible *and* memorable): the Gravity name and surface names, the Deep
  Field wallpaper, the lensing-edge signature, the aurora accent, the
  monogram tiles as icon fallback.

Hard bans (license terms, not paranoia): SF Pro / SF Compact / SF Mono /
NY (licensed for Apple platforms only), SF Symbols (same license), any Apple
wallpaper, app-icon artwork, system sounds, boot chime, the Apple logo, and
Apple product names used as feature names ("Spotlight", "Mission Control",
"Finder", "Launchpad"). Gravity's own names stay. *(Practical engineering
guidance, not legal advice; get counsel before commercial distribution.)*

---

## 1. Typography — the single highest-leverage change

macOS reads like macOS because everything is one neutral grotesque at 13px.
Gravity currently splits Space Grotesk (display) + Inter (UI); Space Grotesk
is geometric-quirky and reads "startup landing page," not "operating system."

**Spec**

| Role | Font | Size/weight | Tracking |
|---|---|---|---|
| Menu bar items | Inter | 13px / 500 | −0.08px |
| Menu items, list rows, buttons | Inter | 13px / 400 | −0.08px |
| Window/section titles | Inter | 13px / 600 | −0.08px |
| Secondary/captions | Inter | 11px / 400 | 0 |
| Search input (Singularity) | Inter | 22px / 300 | −0.2px |
| Large numerals (Core sliders, clock popover) | Inter | 26px / 600, `tabular-nums` | −1.5% |
| Brand only (About box, boot screen, marketing) | Space Grotesk | — | — |

- Inter is the industry-standard SF stand-in and legally clean. Turn on
  `font-feature-settings: "cv05","cv08"` (open digits, no serif-I ambiguity)
  for a more SF-like texture. `font-variant-numeric: tabular-nums` on every
  clock/battery/percentage.
- Kill all uses of Space Grotesk in `tokens.css` control styles; it survives
  only behind a `--font-brand` token.
- Base UI size is **13px**, not 14. This one pixel is weirdly load-bearing:
  13/500 on a 30px bar is the menu-bar look.

## 2. Color & materials — neutralize the chrome, keep the sky

macOS chrome is *neutral*. Gravity's current blue-black chrome
(#05070f-family everywhere) reads "space theme." Move the blue into the
wallpaper only; make every panel neutral so app content provides the color.

**Dark-mode material table** (light mode mirrors at ~0.72 white alphas):

| Material | Fill | Blur | Extras |
|---|---|---|---|
| Menu bar (Horizon) | `rgba(29,29,33,0.55)` | 36px, saturate 1.8 | bottom hairline `rgba(255,255,255,0.06)` |
| Menus / popovers | `rgba(37,37,42,0.62)` | 50px | radius 10, item radius 6, shadow `0 10px 40px rgba(0,0,0,0.35), 0 0 0 0.5px rgba(0,0,0,0.3)` |
| Dock shelf (Orbit) | `rgba(36,36,40,0.45)` | 40px | radius 22, top-edge specular `inset 0 1px 0 rgba(255,255,255,0.12)` |
| Overlay HUD (Core/Singularity) | `rgba(28,28,32,0.68)` | 60px | radius 16 |
| Keep: Gravity lensing edge | 1px curved highlight | — | this is the brand's Liquid-Glass-analog; it stays |

- **Real behind-window blur:** WebView2 `backdrop-filter` cannot see other
  apps behind a transparent window. Add the `window-vibrancy` crate and apply
  **acrylic** (`DWMSBT_TRANSIENTWINDOW`) to Horizon/Orbit/overlay windows.
  Fallback trick unique to a shell that owns its wallpaper: Deep Field knows
  its own pixels, so strips can composite a pre-blurred copy of the wallpaper
  region behind them when DWM backdrop is unavailable.
- **Accents:** default "Graviton Blue" `#3a7bfd` (distinct from Apple's
  `#0a84ff`), plus user-selectable set: Graphite `#8e8e93`-analog, Teal,
  Green, Amber, Coral, Magenta, Violet — 8 accents, own hex values, applied
  to selection, toggles, focus rings (accent at 40% halo, 3.5px).
- Deep-space palette survives *inside Deep Field only*; aurora remains
  available as an accent choice, not the default chrome color.

## 3. Horizon → full-width menu bar

The two floating pills are the biggest structural divergence. macOS grammar
is a **single full-width 30px translucent strip**.

- **Left → right:** Gravity mark (own logo, 16px) · focused-app name (600) ·
  synthesized menus · spacer · status glyphs · search glyph · Core glyph ·
  clock ("Wed Jul 17 9:41 AM", `tabular-nums`).
- **Gravity menu** (the ex-Apple move: make it *do* things): About Gravity ·
  Settings… · separator · Sleep (`SetSuspendState`) · Restart… · Shut Down…
  (`shutdown.exe` w/ confirm) · separator · Lock (`LockWorkStation`) · Sign Out.
- **Synthesized app menus** — Windows has no global-menu protocol, so fake it
  honestly: **App** (Hide → minimize all its windows, Quit → `WM_CLOSE` all),
  **Edit** (Cut/Copy/Paste via synthesized `Ctrl+X/C/V` to the focused
  window), **Window** (Minimize, Zoom, Tile Left/Right, Close), **Help**.
  Focused app name + real menus that act on the real window = 90% of the
  illusion.
- **Menu behavior** (this is where feel lives): opens on **mouse-down** (not
  up); once one menu is open, hovering an adjacent title switches menus with
  no click ("slide-track"); items 24px tall; panel appears **instantly**,
  fades out in 150ms; submenu opens after 200ms hover; shortcut labels
  right-aligned at 60% opacity; hover highlight is a 5px-radius accent bar.
- Status items: 24px hit targets, 8px padding, own glyph set at 15px.

## 4. Orbit → real Dock physics

The arc-lean is charming but it isn't the Dock. macOS magnification:

- **Magnification curve:** base tile 48px → max **2.0×** directly under
  cursor, Gaussian falloff σ≈60px (≈±3 neighbors affected). Critically:
  magnification tracks the cursor **1:1 with zero smoothing** — no spring, no
  lag. Springs only on mouse-enter/leave of the shelf (`LIGHT` spec).
  Everyone who clones the Dock wrongly springs the magnify; don't.
- **Real app icons in squircles:** extract each app's icon
  (`IShellItemImageFactory`, 256px) and mask into a superellipse (n=5, corner
  ≈22.5% of size) with `inset 0 1px rgba(255,255,255,0.1)` and an ambient
  drop shadow. Monogram AppTile becomes the fallback for icon-less entries.
  **After typography, this is the change that most makes it "look like a Mac."**
- Structure: `[pinned] | [running unpinned] | [Trash]`; running indicator =
  4px dot 2px under the tile (offer the orbital ring as a "Gravity classic"
  toggle).
- **Launch bounce:** 3 bounces max, 420ms period, decaying 24/14/6px, then
  1s pause; stop when first window appears (already wired via `launching`).
- **Minimize-to-dock:** the "Scale" effect (macOS ships it too — genie is v2):
  DWM live thumbnail of the window flies into the dock over 350ms,
  `cubic-bezier(0.32, 0.72, 0, 1)`.
- Right-click context menu per tile: Show All Windows (→ Constellation
  filtered), Keep in Orbit / Remove, Quit.
- Labels: glass tooltip pill above tile after 250ms hover, no entrance
  animation. Auto-hide option: slide down 250ms after 500ms delay, 2px
  reveal strip.

## 5. Singularity → Spotlight grammar

Keep the name, adopt the exact interaction grammar:

- 680px panel, top edge at 26% of screen height. **Appears instantly** (no
  fade-in — Spotlight materializes), closes with 120ms fade.
- **Two-stage Escape:** first Esc clears the query, second closes. This tiny
  behavior is deep muscle memory.
- Global hotkey **Alt+Space** via `tauri-plugin-global-shortcut` (currently
  the palette is unreachable on Windows when no Gravity window is focused —
  ship-blocker for the illusion).
- Result groups in fixed order: Apps · Files · Settings · Calculator · Web.
  Files via the Windows Search index (`SystemIndex` OLE DB query) — do not
  build a crawler in v1. Settings = curated `ms-settings:` deep-link map
  (~40 entries).
- Rows 44px: 32px squircle icon, 13px title, 11px/60% subtitle; selection is
  a full-row 8px-radius accent fill; **Tab** expands a right-side preview
  pane (path, metadata, Open With).
- Calculator stays inline as the first row (already built, no eval — good).

## 6. Constellation → Mission Control grammar

- **Live previews are the whole game:** register **DWM thumbnails**
  (`DwmRegisterThumbnail`) of every enumerated window into the overlay — real,
  live, GPU-composited previews of other apps' windows. No screenshots, no
  fakes. This API is exactly why a Windows Exposé can feel native.
- Layout: exposé packing — windows spread into rows preserving rough spatial
  origin, 16px gutters, min scale 0.15, labels beneath (13px, appears on
  hover). Background = wallpaper **dimmed and desaturated, not blurred**
  (macOS dims; blurring here reads Windows-Task-View).
- Top strip: Orbit (space) thumbnails 180×112 with a + at the right end;
  clicking switches orbit (v1 keeps Gravity's own orbit model; binding to
  Windows virtual desktops is v2 — the documented `IVirtualDesktopManager`
  can only query/move-report, so bridge pragmatically with synthesized
  `Win+Ctrl+←/→` until the private COM interfaces are worth the maintenance).
- Enter/exit 250ms settle (`MEDIUM` spring); Esc and empty-click exit; hover
  corner (top-left, 100ms dwell) as optional trigger; F3 and a global
  shortcut always work.

## 7. Core → Control Center grammar (make the toggles real)

360px panel under the clock/glyph, 2-column module grid, 16px-radius glass
tiles, press-scale 0.97, module expands **in place** to its sub-panel (300ms).

Real backends (all exist in the `windows`/WinRT surface):

| Module | API |
|---|---|
| Wi-Fi / Bluetooth toggles | `Windows.Devices.Radios` (WinRT) — replaces today's cosmetic booleans |
| Brightness | laptop: WMI `WmiMonitorBrightnessMethods`; external: DDC-CI `SetVCPFeature` 0x10 |
| **Now Playing** | `GlobalSystemMediaTransportControlsSessionManager` — artwork, title/artist, play/pause/next for Spotify/Edge/etc. This module sells the panel. |
| Volume + output picker | existing Core Audio endpoint + `IMMDeviceEnumerator` device list |
| Focus | Focus Assist (best-effort registry/QuietHours; degrade to Gravity-local focus) |
| Battery | existing `GetSystemPowerStatus` + `PowerSettingRegisterNotification` for instant updates |

## 8. Pulse → Notification Center

- Mirror **real Windows notifications**: `UserNotificationListener` (WinRT,
  needs one-time user consent) → render as Gravity banners: 380px top-right,
  app icon + title + body, spring in (`LIGHT`), 6s auto-dismiss, hover
  pauses the timer, swipe-right dismisses, click focuses the source app.
- Clock-click opens a history column (banners collapse per-app with a count).
- Until the listener lands, keep synthetic notes dev-only so the surface
  never shows fake data in a shipped build.

## 9. Windows & chrome

- **Traffic-light overlay on foreign windows:** a small layered window pinned
  to the focused window's caption area (track via
  `SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE/EVENT_SYSTEM_FOREGROUND)`).
  Three 12px circles, 8px apart, top-left; close/min/zoom → `WM_CLOSE` /
  `SW_MINIMIZE` / tile-menu. **Hues are Gravity's, not Apple's exact trio**
  (Apple: `#ff5f57/#febc2e/#28c840`) — spec: Coral `#f4573f`, Gold `#e0a52e`,
  Mint `#31c48d`, with Gravity glyphs on hover. Same grammar, own ornament.
- **Zoom hover-menu = Sequoia-style tiling:** Left/Right half, quarters,
  Fill — implemented with `SetWindowPos` against the strip-reserved work area.
- Win11 already rounds foreign windows and draws shadows; don't fight DWM.

## 10. Desktop & wallpaper

- Reparent Deep Field into **`WorkerW`** (behind desktop icons) — already on
  the roadmap; it's what makes Gravity feel installed rather than floating.
- **Dynamic wallpaper:** Deep Field gains a time-of-day arc (dawn aurora →
  daylight gradient "Daybreak" → dusk → deep night). The *mechanism* is the
  macOS dynamic-wallpaper feel; the imagery stays 100% Gravity.

## 11. Motion dictionary (global constants)

| Event | Spec |
|---|---|
| Menus/popovers in | instant (0ms) |
| Menus/popovers out | 150ms opacity |
| Panel in (Core, Singularity) | spring 380/34, ~250ms settle |
| Dock magnify | 1:1 cursor-tracked, no easing |
| Launch bounce | 420ms period ×3, decaying |
| Minimize/window fly | 350ms `cubic-bezier(0.32,0.72,0,1)` |
| Constellation in/out | 250ms spring settle |
| Toast in | `LIGHT` spring from +24px x-offset |
| Rule | transforms + opacity only; honor `prefers-reduced-motion` everywhere |

Silence is accurate: macOS ships almost no UI sounds. No sounds in v1.

## 12. Keyboard grammar

- Alt+Space → Singularity (global). F3 / hot-corner → Constellation.
  Alt+` → cycle windows of focused app. Two-stage Esc in Singularity.
- v2 (opt-in only, low-level hook): "Mac keys" mode mapping Ctrl↔Alt so
  Ctrl+C feels like ⌘C. Never default-on; hooks that rewrite modifiers are
  how shells get uninstalled.

## 13. Engineering substrate (what makes all of it feel native)

1. **AppBars, not `SPI_SETWORKAREA`:** register Horizon/Orbit as real appbars
   (`SHAppBarMessage` ABM_NEW/ABM_SETPOS) — per-monitor correct, and Windows
   self-restores the work area if Gravity crashes. Removes the current
   physical/logical px mismatch (46/78 vs 56/124) by construction.
2. **Event-driven state, not 4×1s polling:** WinEvent hooks
   (`EVENT_OBJECT_CREATE/DESTROY/NAMECHANGE`, `EVENT_SYSTEM_FOREGROUND`) push
   diffs over Tauri events; poll only battery (30s). Frontend: one shared
   provider; skip listener notify when a cheap state hash is unchanged.
   Target: **<1% idle CPU, <250MB total**, wallpaper pauses when fully
   occluded.
3. **Crash guard:** named-mutex singleton + a watchdog that restores the
   taskbar/work area if the shell dies (a shell's first duty is leaving the
   desk clean).
4. Multi-monitor: strips per monitor; DWM thumbnails and appbars are
   per-monitor already.

## 14. Build order

- **P1 — Look (1–2 weeks):** §1 type, §2 materials + acrylic, §3 full-width
  bar (menus can be static), §4 magnification + real icons in squircles.
  *Exit test: a screenshot at 100% zoom is repeatedly mistaken for a Mac at
  a glance, yet contains zero Apple assets.*
- **P2 — Feel:** §11 motion dictionary, §5 Spotlight behaviors, §3 menu
  slide-track/mouse-down, two-stage Esc, global hotkeys.
  *Exit test: a Mac user's hands work without instructions.*
- **P3 — Native depth:** §6 DWM-thumbnail Constellation, §13 appbars +
  event-driven state, §7 real toggles + Now Playing, §9 tiling menu.
- **P4 — Replacement polish:** §9 traffic lights on foreign windows, §8
  notification listener, §10 WorkerW, dynamic wallpaper.

---

*Everything above is implementable in the current stack (Tauri 2 + WebView2 +
`windows` crate); items needing new crates: `window-vibrancy`,
`tauri-plugin-global-shortcut`, WinRT features of `windows` for Radios /
Media / Notifications.*
