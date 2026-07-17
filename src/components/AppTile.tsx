import "./apptile.css";

/** Gravity's app identity: a monogram tile with a stable per-app hue.
 *  Deliberately not imitating anyone's icon set — this is our own look,
 *  and it renders identically for every Windows app without icon extraction.
 *  (Real extracted icons are a roadmap upgrade; the tile stays the fallback.) */

export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}

interface AppTileProps {
  name: string;
  hue: number;
  size?: number;
}

export function AppTile({ name, hue, size = 46 }: AppTileProps) {
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: size * 0.3,
    fontSize: size * 0.36,
    background: `linear-gradient(148deg,
      hsl(${hue} 62% 60%) 0%,
      hsl(${(hue + 42) % 360} 70% 38%) 100%)`,
  };
  const mono = monogram(name);
  return (
    <span className="appTile" style={style} aria-hidden>
      <span className="appTile__mono">{mono[0].toUpperCase() + (mono[1] ?? "").toLowerCase()}</span>
    </span>
  );
}
