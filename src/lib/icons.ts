import { useEffect, useState } from "react";
import { isTauri } from "../shell/tauri";

/** Real app icons on Gravity squircle plates (spec §4).
 *  The Rust core extracts a 128px RGBA bitmap via IShellItemImageFactory;
 *  we composite it onto a hue-tinted superellipse plate and cache the
 *  resulting data-URL per app id. Monogram tiles remain the fallback. */

interface IconPayload {
  width: number;
  height: number;
  /** base64-encoded RGBA, row-major, non-premultiplied */
  rgba: string;
}

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/** Squircle-ish path: rounded rect at 24% radius reads as the superellipse
 *  at dock sizes; keep in sync with .appTile border-radius. */
function platePath(ctx: CanvasRenderingContext2D, size: number) {
  const r = size * 0.24;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, r);
}

function compose(payload: IconPayload, hue: number): string | null {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Hue-tinted plate — Gravity's own container, not an Apple asset.
  platePath(ctx, size);
  const g = ctx.createLinearGradient(0, 0, size * 0.4, size);
  g.addColorStop(0, `hsl(${hue} 34% 30%)`);
  g.addColorStop(1, `hsl(${(hue + 42) % 360} 40% 18%)`);
  ctx.fillStyle = g;
  ctx.fill();

  // Icon glyph at 70% of the plate, centered.
  const icon = document.createElement("canvas");
  icon.width = payload.width;
  icon.height = payload.height;
  const ictx = icon.getContext("2d");
  if (!ictx) return null;
  const bytes = Uint8ClampedArray.from(atob(payload.rgba), (c) => c.charCodeAt(0));
  ictx.putImageData(new ImageData(bytes, payload.width, payload.height), 0, 0);
  const inset = size * 0.15;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(icon, inset, inset, size - inset * 2, size - inset * 2);

  // Soft top sheen, clipped to the plate.
  ctx.save();
  platePath(ctx, size);
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, 0, 0, size * 0.5);
  sheen.addColorStop(0, "rgba(255,255,255,0.18)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, size, size * 0.5);
  ctx.restore();

  return canvas.toDataURL("image/png");
}

async function fetchIcon(appId: string, hue: number): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const payload = (await invoke("get_app_icon", { appId })) as IconPayload | null;
    if (!payload || !payload.rgba) return null;
    return compose(payload, hue);
  } catch {
    return null;
  }
}

/** Returns a data-URL for the app's plated icon, or null (→ monogram). */
export function useAppIcon(appId: string, hue: number): string | null {
  const [url, setUrl] = useState<string | null>(() => cache.get(appId) ?? null);

  useEffect(() => {
    if (!isTauri() || cache.has(appId)) {
      setUrl(cache.get(appId) ?? null);
      return;
    }
    let alive = true;
    let p = inflight.get(appId);
    if (!p) {
      p = fetchIcon(appId, hue).then((u) => {
        cache.set(appId, u);
        inflight.delete(appId);
        return u;
      });
      inflight.set(appId, p);
    }
    p.then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [appId, hue]);

  return url;
}
