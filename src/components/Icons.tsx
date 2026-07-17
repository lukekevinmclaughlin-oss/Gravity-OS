interface IconProps {
  size?: number;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function GravityMark({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="gv-aurora" x1="0" y1="0" x2="24" y2="24">
          <stop offset="0" stopColor="#3df0a6" />
          <stop offset="0.55" stopColor="#2bd9c7" />
          <stop offset="1" stopColor="#7a8cff" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="5" fill="url(#gv-aurora)" />
      <ellipse
        cx="12"
        cy="12"
        rx="10"
        ry="3.4"
        stroke="url(#gv-aurora)"
        strokeWidth="1.5"
        transform="rotate(-18 12 12)"
      />
    </svg>
  );
}

export function WifiIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M3 9.5a13.5 13.5 0 0 1 18 0" />
      <path d="M6.2 13a9 9 0 0 1 11.6 0" />
      <path d="M9.4 16.4a4.6 4.6 0 0 1 5.2 0" />
      <circle cx="12" cy="19.4" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BatteryIcon({ size = 16, level = 1, charging = false }: IconProps & { level?: number; charging?: boolean }) {
  const w = Math.max(0.5, 14 * Math.min(1, Math.max(0, level)));
  const color = charging ? "#3df0a6" : level <= 0.15 ? "#ff5d73" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="7.5" width="18" height="9" rx="2.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M22 10.6v2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4" y="9.5" width={w} height="5" rx="1.4" fill={color} />
      {charging && (
        <path d="M12.6 8.6 9.8 12.3h2.4l-1 3.1 2.9-3.7h-2.4z" fill="#07101d" stroke="none" />
      )}
    </svg>
  );
}

export function VolumeIcon({ size = 16, level = 0.6 }: IconProps & { level?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M4 9.5v5h3.4L12 18.6V5.4L7.4 9.5H4Z" fill="currentColor" stroke="none" />
      {level > 0.02 && <path d="M15 9.6a4 4 0 0 1 0 4.8" />}
      {level > 0.45 && <path d="M17.6 7.4a7.4 7.4 0 0 1 0 9.2" />}
    </svg>
  );
}

export function BluetoothIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M11.7 2.8v18.4l5-4.6-9.5-8.6M11.7 12l5-4.6-5-4.6M7.2 16.6l4.5-4.6" />
    </svg>
  );
}

export function MoonIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M20 13.6A8.3 8.3 0 0 1 10.4 4a8.3 8.3 0 1 0 9.6 9.6Z" />
    </svg>
  );
}

export function SunIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
    </svg>
  );
}

export function SearchIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <circle cx="10.5" cy="10.5" r="6.2" />
      <path d="m15.3 15.3 5 5" />
    </svg>
  );
}

export function TrashIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M4.5 6.5h15M9.5 6.5V4.6c0-.6.5-1.1 1.1-1.1h2.8c.6 0 1.1.5 1.1 1.1v1.9M6.3 6.5l.9 12.9c.05.7.65 1.3 1.4 1.3h6.8c.75 0 1.35-.6 1.4-1.3l.9-12.9" />
      <path d="M10 10.4v6M14 10.4v6" />
    </svg>
  );
}

export function CloseIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

/** Generic 2×2 grid — the "switch to the other desktop" glyph.
 *  Deliberately not the Windows flag mark: square panes, even gaps. */
export function GridIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="7.2" height="7.2" rx="1.4" />
      <rect x="12.8" y="4" width="7.2" height="7.2" rx="1.4" />
      <rect x="4" y="12.8" width="7.2" height="7.2" rx="1.4" />
      <rect x="12.8" y="12.8" width="7.2" height="7.2" rx="1.4" />
    </svg>
  );
}

export function ConstellationIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <circle cx="5.5" cy="17.5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="6" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="18.8" cy="14.5" r="1.6" fill="currentColor" stroke="none" />
      <path d="M6.6 16.2 11 7.4M13.3 7.1l4.6 6.2M7.1 17.3l10.1-1.9" opacity="0.55" />
    </svg>
  );
}
