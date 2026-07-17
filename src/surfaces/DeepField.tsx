import { useEffect, useRef } from "react";
import { mulberry32 } from "../lib/rng";

/** Deep Field — Gravity's live generative wallpaper.
 *  A seeded starfield, slow aurora ribbons, and faint lensing rings around an
 *  unseen mass. Renders at ~30fps; everything drifts on minute timescales. */

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
}

export function DeepField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = 0;
    let w = 0;
    let h = 0;
    let stars: Star[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
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
    };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33) return; // ~30fps is plenty for a sky
      last = now;
      const t = now / 1000;

      // Night sky base
      const base = ctx.createLinearGradient(0, 0, 0, h);
      base.addColorStop(0, "#05070f");
      base.addColorStop(0.55, "#070b16");
      base.addColorStop(1, "#0a1020");
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);

      // Aurora ribbons: three drifting radial masses, additive
      ctx.globalCompositeOperation = "lighter";
      const ribbons: Array<[number, number, number, string]> = [
        [w * (0.28 + 0.05 * Math.sin(t * 0.021)), h * 0.78, w * 0.5, "rgba(25, 201, 138, 0.16)"],
        [w * (0.72 + 0.04 * Math.cos(t * 0.017)), h * 0.24, w * 0.46, "rgba(43, 217, 199, 0.10)"],
        [w * (0.55 + 0.06 * Math.sin(t * 0.013 + 2)), h * 0.55, w * 0.6, "rgba(122, 140, 255, 0.09)"],
      ];
      for (const [cx, cy, r, color] of ribbons) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, color);
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      // Lensing rings around an unseen mass, upper right
      const mx = w * 0.78;
      const my = h * 0.3;
      ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const rr = w * (0.09 + k * 0.055);
        ctx.strokeStyle = `rgba(180, 200, 255, ${0.05 - k * 0.012})`;
        ctx.beginPath();
        ctx.ellipse(mx, my, rr, rr * 0.62, -0.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Stars with slow twinkle
      for (const s of stars) {
        const a = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
        ctx.fillStyle = `rgba(226, 234, 255, ${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // Gentle vignette so glass panels pop
      const vg = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.3, w / 2, h * 0.55, h * 0.95);
      vg.addColorStop(0, "transparent");
      vg.addColorStop(1, "rgba(2, 4, 10, 0.5)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
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
