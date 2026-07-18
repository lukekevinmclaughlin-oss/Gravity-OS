import { useEffect, useState } from "react";
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
  onToggleTheme?: () => void | Promise<void>;
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [volumePreview, setVolumePreview] = useState(() => state.status.volume);
  const [brightnessPreview, setBrightnessPreview] = useState(
    () => state.status.brightness ?? 0.5
  );
  useEffect(() => {
    if (state.status.brightness !== null) setBrightnessPreview(state.status.brightness);
  }, [state.status.brightness]);
  useEffect(() => setVolumePreview(state.status.volume), [state.status.volume]);
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
    if (busy) return;
    setBusy(key);
    setError(null);
    const work = key === "theme" ? Promise.resolve(onToggleTheme?.()) : actions.toggleSetting(key);
    void work.catch((reason) => setError(String(reason))).finally(() => setBusy(null));
  };

  const commitVolume = (event: React.SyntheticEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value) / 100;
    setVolumePreview(value);
    setError(null);
    void actions.setVolume(value).catch((reason) => setError(String(reason)));
  };

  const commitBrightness = (event: React.SyntheticEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value) / 100;
    setBrightnessPreview(value);
    void actions.setBrightness(value).catch((reason) => setError(String(reason)));
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
              disabled={busy !== null}
              aria-pressed={t.on}
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
          <VolumeIcon size={16} level={volumePreview} />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volumePreview * 100)}
            aria-label="System volume"
            onChange={(e) => setVolumePreview(Number(e.target.value) / 100)}
            onPointerUp={commitVolume}
            onKeyUp={commitVolume}
            style={{ "--fill": pct(volumePreview) } as React.CSSProperties}
          />
        </div>
        {s.brightness !== null && (
          <div className="core__slider">
            <SunIcon size={16} />
            <input
              type="range"
              min={0}
            max={100}
              value={Math.round(brightnessPreview * 100)}
              aria-label="Display brightness"
              onChange={(e) => setBrightnessPreview(Number(e.target.value) / 100)}
              onPointerUp={commitBrightness}
              onKeyUp={commitBrightness}
              style={{ "--fill": pct(brightnessPreview) } as React.CSSProperties}
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
          <span className="core__brand">Gravity OS 1.0 · Deep Field</span>
        </div>
        {error && (
          <button className="core__error" onClick={() => setError(null)} role="alert">
            {error}
          </button>
        )}
      </div>
    </>
  );
}
