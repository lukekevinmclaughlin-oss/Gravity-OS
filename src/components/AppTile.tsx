import { useAppIcon } from "../lib/icons";
import "./apptile.css";

/** Gravity's app tile. On Windows it shows the app's real icon composited
 *  onto a hue-tinted squircle plate (extracted by the Rust core, spec §4);
 *  everywhere else — and for apps without icons — the monogram plate.
 *  Both are Gravity's own look; no third-party icon set is imitated. */

export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface AppTileProps {
  name: string;
  hue: number;
  /** Fixed square size in px; ignored when `fill` is set. */
  size?: number;
  /** Fill the parent width (dock magnification drives the width). */
  fill?: boolean;
  /** When present, try the real extracted icon for this app id. */
  appId?: string;
}

export function AppTile({ name, hue, size = 46, fill = false, appId }: AppTileProps) {
  const iconUrl = useAppIcon(appId ?? "", hue);

  if (appId && iconUrl) {
    return (
      <img
        className={`appTile appTile--img ${fill ? "appTile--fill" : ""}`}
        style={fill ? undefined : { width: size, height: size }}
        src={iconUrl}
        alt=""
        draggable={false}
        aria-hidden
      />
    );
  }

  const style: React.CSSProperties = fill
    ? {
        background: `linear-gradient(148deg,
      hsl(${hue} 52% 52%) 0%,
      hsl(${(hue + 42) % 360} 58% 32%) 100%)`,
      }
    : {
        width: size,
        height: size,
        borderRadius: size * 0.24,
        fontSize: size * 0.36,
        background: `linear-gradient(148deg,
      hsl(${hue} 52% 52%) 0%,
      hsl(${(hue + 42) % 360} 58% 32%) 100%)`,
      };
  const mono = monogram(name);
  return (
    <span className={`appTile ${fill ? "appTile--fill" : ""}`} style={style} aria-hidden>
      <span className="appTile__mono">{mono[0].toUpperCase() + (mono[1] ?? "").toLowerCase()}</span>
    </span>
  );
}
