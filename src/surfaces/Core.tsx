import { useShell } from "../shell/context";
import {
  BatteryIcon,
  BluetoothIcon,
  MoonIcon,
  SunIcon,
  VolumeIcon,
  WifiIcon,
} from "../components/Icons";
import type { ToggleKey } from "../shell/types";
import "./core.css";

/** Core — Gravity's control centre. Orbital toggles, sliders with inertia. */

export interface CoreProps {
  open: boolean;
  onClose: () => void;
  onToggleTheme?: () => void;
  daybreak?: boolean;
}

interface ToggleSpec {
  key: ToggleKey | "theme";
  icon: React.ReactNode;
  label: string;
  sub: string;
  on: boolean;
}

export function Core({ open, onClose, onToggleTheme, daybreak }: CoreProps) {
  const { state, actions } = useShell();
  if (!open) return null;

  const s = state.status;
  const toggles: ToggleSpec[] = [
    {
      key: "wifi",
      icon: <WifiIcon size={16} />,
      label: "Wi-Fi",
      sub: s.network ?? "Off",
      on: s.online,
    },
    {
      key: "bluetooth",
      icon: <BluetoothIcon size={16} />,
      label: "Bluetooth",
      sub: s.bluetooth ? "On" : "Off",
      on: s.bluetooth,
    },
    {
      key: "focus",
      icon: <MoonIcon size={16} />,
      label: "Focus",
      sub: s.focus ? "Pulse silenced" : "Off",
      on: s.focus,
    },
    {
      key: "theme",
      icon: <SunIcon size={16} />,
      label: "Daybreak",
      sub: daybreak ? "On" : "Off",
      on: !!daybreak,
    },
  ];

  const fire = (key: ToggleSpec["key"]) => {
    if (key === "theme") onToggleTheme?.();
    else actions.toggleSetting(key);
  };

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <>
      <div className="core__scrim" onClick={onClose} />
      <div className="core glass-heavy lens">
        <div className="core__grid">
          {toggles.map((t) => (
            <button
              key={t.key}
              className={`core__toggle ${t.on ? "is-on" : ""}`}
              onClick={() => fire(t.key)}
            >
              <span className="core__toggleIcon">{t.icon}</span>
              <span className="core__toggleText">
                <span className="core__toggleLabel">{t.label}</span>
                <span className="core__toggleSub">{t.sub}</span>
              </span>
              <span className="core__switch">
                <span className="core__knob" />
              </span>
            </button>
          ))}
        </div>

        <div className="core__slider">
          <VolumeIcon size={16} level={s.volume} />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(s.volume * 100)}
            onChange={(e) => actions.setVolume(Number(e.target.value) / 100)}
            style={{ "--fill": pct(s.volume) } as React.CSSProperties}
          />
        </div>
        {s.brightness !== null && (
          <div className="core__slider">
            <SunIcon size={16} />
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(s.brightness * 100)}
              onChange={(e) => actions.setBrightness(Number(e.target.value) / 100)}
              style={{ "--fill": pct(s.brightness) } as React.CSSProperties}
            />
          </div>
        )}

        <div className="core__foot">
          {s.batteryPercent !== null && (
            <span className="core__batt">
              <BatteryIcon size={17} level={s.batteryPercent / 100} charging={s.charging} />
              {s.batteryPercent}%{s.charging ? " · charging" : ""}
            </span>
          )}
          <span className="core__brand">Gravity OS 0.2 · Deep Field</span>
        </div>
      </div>
    </>
  );
}
