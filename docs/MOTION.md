# Gravity OS motion dictionary

The single reference for every animation constant the shell ships. A change to
feel is a change to this file first; a deviation found in code is either fixed
or documented here as intentional. Global rule: **transforms and opacity only**,
and the `prefers-reduced-motion` clamp in `src/styles/base.css` truncates every
entry.

## Physics constants

Springs live in `src/lib/physics.ts` (`mass`, `stiffness`, `damping`):

| Spec | Values | Used for |
|---|---|---|
| `LIGHT` | 1 / 320 / 26 | toasts, small elements |
| `MEDIUM` | 1.6 / 210 / 26 | panels, overlays |
| `HEAVY` | 2.6 / 150 / 28 | full-surface transitions |

Orbit's shelf enter/exit ramp uses its own per-personality profile
(`src/surfaces/Orbit.tsx`): gentle 220–285 / 31–33, fluid 300–430 / 34–37,
expressive 370–540 / 34–38 (return / active).

## Dictionary

| Event | Spec | Where |
|---|---|---|
| Menus / popovers in | instant (0ms) | `horizon.css` |
| Menus / popovers out | 150ms opacity | `horizon.css` |
| Menu open model | opens on pointer-down; press-drag-release commits; hover slide-track while open | `Horizon.tsx` `titleProps` |
| Dock magnification | **1:1 cursor-tracked, zero smoothing in-shelf**; personality spring ramps field presence on shelf enter/exit only | `Orbit.tsx` `animateMagnify` |
| Dock reflow (insert/remove) | FLIP, 320ms `cubic-bezier(.2,.82,.2,1)` | `Orbit.tsx` layout effect |
| Launch bounce | CSS `orbitBounce`, stops on first real window, 8s hard cutoff | `orbit.css`, `Orbit.tsx` |
| Toast in | `pulseIn` 560ms `--ease-mass` from +46px | `pulse.css` |
| Toast linger | 6000ms; **hover pauses the clock** (800ms minimum on resume) | `Pulse.tsx` |
| Toast swipe | pointer-tracked 1:1; commit at >120px or >0.55px/ms; spring-back 280ms otherwise; fly-out 240ms from release point | `Pulse.tsx`, `pulse.css` |
| Toast out (timer/close) | `pulseOut` 240ms | `pulse.css` |
| Boot veil | black → desk 600ms `--ease-mass` after 320ms hold; monogram pulse 900ms | `deepfield.css` |
| Surface entrance (Horizon/Orbit) | 300ms opacity settle, once per surface boot | `horizon.css`, `orbit.css` |
| Show Desktop | native minimize/restore; no faked window motion | `toggle_show_desktop` |
| Well capture/release effects | existing `orbitCaptureFx` / well pulse timings | `orbit.css`, `gravity-wells.css` |
| Press state (buttons, tiles) | scale 0.97, 120ms | control styles |
| Tooltip | 250ms delay, no entrance animation | `orbit.css` |
| Easing tokens | `--ease-mass: cubic-bezier(0.32,0.72,0,1)`, `--ease-fall: cubic-bezier(0.5,0,0.9,0.4)`; durations `--t-light 150ms / --t-med 250ms / --t-heavy 350ms` | `tokens.css` |

## Deferred (documented, not yet shipped)

- Minimize/restore fly between window and Dock tile (350ms `--ease-mass`) —
  needs the DWM thumbnail service (NS-1.2).
- Constellation enter/exit 250ms MEDIUM with card FLIP from true window rects —
  needs live thumbnails (NS-1.2).
- Lock veil (200ms fade before `LockWorkStation`) — needs a native full-screen
  veil surface; Gravity's strips cannot honestly cover foreign windows.
- In-place Core module expansion morph (300ms) — lands with NS-7.3.
