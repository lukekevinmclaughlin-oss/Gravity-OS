import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";
import { mulberry32 } from "../lib/rng";
import { WALLPAPERS, wallpaperSource } from "../lib/wallpapers";
import { useShell } from "../shell/context";
import type { AppearanceMode } from "../shell/types";
import { WindowsIcon } from "../components/Icons";
import { GravityWells } from "./GravityWells";
import "./deepfield.css";

/** Deep Field — Gravity's live generative wallpaper.
 *  Perf model (spec §13): the base sky, lensing rings and vignette are static
 *  → rendered once per resize into offscreen layers; the aurora drifts ~2px/s
 *  → re-rendered every 400ms; only the ~340 twinkling stars are painted per
 *  frame. Zero per-frame allocations, ~30fps. */

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
}

const AURORA_INTERVAL = 400; // ms between aurora layer refreshes

function LiveDeepField({ light }: { light: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = 0;
    let lastAurora = -Infinity;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let stars: Star[] = [];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const base = document.createElement("canvas"); // sky + lensing rings
    const aurora = document.createElement("canvas"); // slow-drift ribbons
    const vignette = document.createElement("canvas");

    const paintBase = () => {
      const c = base.getContext("2d")!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, light ? "#d8e4ec" : "#05070f");
      g.addColorStop(0.55, light ? "#c9dde3" : "#070b16");
      g.addColorStop(1, light ? "#eef0ec" : "#0a1020");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);

      // Lensing rings around an unseen mass, upper right — static.
      const mx = w * 0.78;
      const my = h * 0.3;
      c.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const rr = w * (0.09 + k * 0.055);
        c.strokeStyle = light
          ? `rgba(66, 93, 132, ${0.12 - k * 0.02})`
          : `rgba(180, 200, 255, ${0.05 - k * 0.012})`;
        c.beginPath();
        c.ellipse(mx, my, rr, rr * 0.62, -0.5, 0, Math.PI * 2);
        c.stroke();
      }
    };

    const paintAurora = (t: number) => {
      const c = aurora.getContext("2d")!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      c.globalCompositeOperation = "lighter";
      const ribbons: Array<[number, number, number, string]> = light
        ? [
            [w * (0.28 + 0.05 * Math.sin(t * 0.021)), h * 0.78, w * 0.5, "rgba(40, 165, 143, 0.17)"],
            [w * (0.72 + 0.04 * Math.cos(t * 0.017)), h * 0.24, w * 0.46, "rgba(82, 144, 190, 0.14)"],
            [w * (0.55 + 0.06 * Math.sin(t * 0.013 + 2)), h * 0.55, w * 0.6, "rgba(167, 125, 190, 0.1)"],
          ]
        : [
            [w * (0.28 + 0.05 * Math.sin(t * 0.021)), h * 0.78, w * 0.5, "rgba(25, 201, 138, 0.16)"],
            [w * (0.72 + 0.04 * Math.cos(t * 0.017)), h * 0.24, w * 0.46, "rgba(43, 217, 199, 0.10)"],
            [w * (0.55 + 0.06 * Math.sin(t * 0.013 + 2)), h * 0.55, w * 0.6, "rgba(122, 140, 255, 0.09)"],
          ];
      for (const [cx, cy, r, color] of ribbons) {
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, color);
        g.addColorStop(1, "transparent");
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
      }
    };

    const paintVignette = () => {
      const c = vignette.getContext("2d")!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      const vg = c.createRadialGradient(w / 2, h * 0.45, h * 0.3, w / 2, h * 0.55, h * 0.95);
      vg.addColorStop(0, "transparent");
      vg.addColorStop(1, light ? "rgba(83, 105, 126, 0.18)" : "rgba(2, 4, 10, 0.5)");
      c.fillStyle = vg;
      c.fillRect(0, 0, w, h);
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      for (const c of [canvas, base, aurora, vignette]) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rand = mulberry32(20260717);
      const count = Math.round((w * h) / 6200);
      stars = Array.from({ length: count }, () => ({
        x: rand() * w,
        y: rand() * h,
        r: 0.35 + rand() * 1.25,
        phase: rand() * Math.PI * 2,
        speed: 0.15 + rand() * 0.5,
      }));
      paintBase();
      paintVignette();
      lastAurora = -Infinity; // repaint aurora on next frame
    };

    const draw = (now: number) => {
      if (!reducedMotion) raf = requestAnimationFrame(draw);
      if (now - last < 33) return; // ~30fps is plenty for a sky
      last = now;
      const t = now / 1000;

      if (now - lastAurora >= AURORA_INTERVAL) {
        paintAurora(t);
        lastAurora = now;
      }

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(base, 0, 0, w, h);
      ctx.drawImage(aurora, 0, 0, w, h);

      // Stars with slow twinkle — the only per-frame path work.
      ctx.globalCompositeOperation = "lighter";
      for (const s of stars) {
        const a = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
        ctx.fillStyle = light ? `rgba(64, 91, 118, ${a * 0.45})` : `rgba(226, 234, 255, ${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(vignette, 0, 0, w, h);
    };

    const syncVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", syncVisibility);
    if (!document.hidden) raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [light]);

  return (
    <canvas
      ref={ref}
      className="deepField__live"
    />
  );
}

interface DesktopMenuState {
  x: number;
  y: number;
}

export function DeepField() {
  const { state, actions } = useShell();
  const [menu, setMenu] = useState<DesktopMenuState | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const selected =
    WALLPAPERS.find((wallpaper) => wallpaper.id === state.appearance.wallpaperId) ?? WALLPAPERS[0];
  const source = wallpaperSource(selected, state.appearance.resolved);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const openMenu = (event: MouseEvent) => {
    event.preventDefault();
    setMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 340)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 560)),
    });
  };

  const openKeyboardMenu = (event: ReactKeyboardEvent) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    setMenu({ x: 16, y: 48 });
  };

  const chooseAppearance = async (mode: AppearanceMode) => {
    try {
      await actions.setAppearance(mode);
      setMenu(null);
    } catch (error) {
      setMenuError(String(error));
    }
  };

  return (
    <div
      className="deepField"
      role="region"
      aria-label="Gravity desktop"
      tabIndex={0}
      onKeyDown={openKeyboardMenu}
      onContextMenu={openMenu}
    >
      {source ? (
        <div className="deepField__image" style={{ backgroundImage: `url(${source})` }} />
      ) : (
        <LiveDeepField light={state.appearance.resolved === "light"} />
      )}
      <GravityWells />

      {menu && (
        <>
          <button className="desktopMenuDismiss" aria-label="Close desktop menu" onClick={() => setMenu(null)} />
          <div
            className="desktopMenu glass-heavy"
            role="menu"
            aria-label="Desktop quick settings"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="desktopMenu__heading">Appearance</div>
            <div className="desktopMenu__appearance">
              {(["system", "light", "dark"] as const).map((mode) => (
                <button
                  key={mode}
                  className={state.appearance.mode === mode ? "is-selected" : ""}
                  role="menuitemradio"
                  aria-checked={state.appearance.mode === mode}
                  onClick={() => void chooseAppearance(mode)}
                >
                  {mode[0].toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>

            <div className="desktopMenu__heading">Gravity tools</div>
            <button
              className="desktopMenu__windows"
              role="menuitem"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("gravity:add-well"));
                setMenu(null);
              }}
            >
              <span className="desktopMenu__toolIcon" aria-hidden="true">◇</span>
              <span><strong>Add Desktop Shape</strong><small>A 3D home for live application windows</small></span>
            </button>
            <button
              className="desktopMenu__windows"
              role="menuitem"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("gravity:toggle-wells"));
                setMenu(null);
              }}
            >
              <span className="desktopMenu__toolIcon" aria-hidden="true">◈</span>
              <span><strong>Show or Hide Desktop Shapes</strong><small>Keep stored windows parked until released</small></span>
            </button>
            <button
              className="desktopMenu__windows"
              role="menuitem"
              onClick={() => {
                setMenuError(null);
                void actions.releaseAllParkedWindows()
                  .then(() => setMenu(null))
                  .catch((error) => setMenuError(String(error)));
              }}
            >
              <span className="desktopMenu__toolIcon" aria-hidden="true">↗</span>
              <span><strong>Release Stored Windows</strong><small>Restore every parked window to the desktop</small></span>
            </button>

            <div className="desktopMenu__heading">Shape organization</div>
            <div className="desktopMenu__presets" aria-label="Desktop shape grid">
              {[
                ["Free", null],
                ["2 × 2", { columns: 2, rows: 2 }],
                ["3 × 3", { columns: 3, rows: 3 }],
                ["4 × 3", { columns: 4, rows: 3 }],
                ["6 × 4", { columns: 6, rows: 4 }],
                ["8 × 5", { columns: 8, rows: 5 }],
              ].map(([label, detail]) => (
                <button key={String(label)} role="menuitem" onClick={() => {
                  window.dispatchEvent(new CustomEvent("gravity:organize-wells", { detail }));
                  setMenu(null);
                }}>{String(label)}</button>
              ))}
            </div>
            <div className="desktopMenu__presets" aria-label="Desktop shape size">
              {[["Small", .8], ["Medium", 1], ["Large", 1.25]].map(([label, scale]) => (
                <button key={String(label)} role="menuitem" onClick={() => {
                  window.dispatchEvent(new CustomEvent("gravity:equalize-wells", { detail: { scale } }));
                  setMenu(null);
                }}>{String(label)}</button>
              ))}
            </div>

            <div className="desktopMenu__heading">Wallpaper</div>
            <div className="desktopMenu__wallpapers">
              {WALLPAPERS.map((wallpaper) => {
                const previewSource = wallpaperSource(wallpaper, state.appearance.resolved);
                return (
                  <button
                    key={wallpaper.id}
                    className="wallpaperChoice"
                    role="menuitemradio"
                    aria-checked={wallpaper.id === selected.id}
                    onClick={() => {
                      void actions.setWallpaper(wallpaper.id)
                        .then(() => setMenu(null))
                        .catch((error) => setMenuError(String(error)));
                    }}
                  >
                    <span
                      className="wallpaperChoice__preview"
                      style={{ backgroundImage: previewSource ? `url(${previewSource})` : wallpaper.preview }}
                    />
                    <span className="wallpaperChoice__copy">
                      <span className="wallpaperChoice__name">{wallpaper.name}</span>
                      <span className="wallpaperChoice__description">{wallpaper.description}</span>
                    </span>
                    <span className="wallpaperChoice__check">
                      {wallpaper.id === selected.id ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="desktopMenu__heading">System</div>
            <button
              className="desktopMenu__windows"
              role="menuitem"
              onClick={() => {
                setMenuError(null);
                void actions.setShellActive(false)
                  .then(() => setMenu(null))
                  .catch((error) => setMenuError(String(error)));
              }}
            >
              <span className="desktopMenu__windowsIcon"><WindowsIcon size={16} /></span>
              <span><strong>Switch to Windows 11</strong><small>Return with Ctrl Alt G or the Gravity tray icon</small></span>
            </button>
            {menuError && (
              <button className="desktopMenu__error" role="alert" onClick={() => setMenuError(null)}>
                {menuError}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
