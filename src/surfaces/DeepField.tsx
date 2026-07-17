import { useEffect, useRef } from "react";
import { mulberry32 } from "../lib/rng";

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

export function DeepField() {
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

    const base = document.createElement("canvas"); // sky + lensing rings
    const aurora = document.createElement("canvas"); // slow-drift ribbons
    const vignette = document.createElement("canvas");

    const paintBase = () => {
      const c = base.getContext("2d")!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#05070f");
      g.addColorStop(0.55, "#070b16");
      g.addColorStop(1, "#0a1020");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);

      // Lensing rings around an unseen mass, upper right — static.
      const mx = w * 0.78;
      const my = h * 0.3;
      c.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const rr = w * (0.09 + k * 0.055);
        c.strokeStyle = `rgba(180, 200, 255, ${0.05 - k * 0.012})`;
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
      const ribbons: Array<[number, number, number, string]> = [
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
      vg.addColorStop(1, "rgba(2, 4, 10, 0.5)");
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
      raf = requestAnimationFrame(draw);
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
        ctx.fillStyle = `rgba(226, 234, 255, ${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(vignette, 0, 0, w, h);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
