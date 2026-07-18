import { useState } from "react";
import { GravityMark, WindowsIcon } from "../components/Icons";
import { useShell } from "../shell/context";
import "./about-gravity.css";

interface AboutGravityProps {
  open: boolean;
  onClose: () => void;
}

export function AboutGravity({ open, onClose }: AboutGravityProps) {
  const { state, actions } = useShell();
  const [message, setMessage] = useState<string | null>(null);
  if (!open) return null;

  const diagnostics = [
    "Gravity OS 1.0.0",
    `Shell mode: ${state.shellMode}`,
    `Appearance: ${state.appearance.mode} (${state.appearance.resolved})`,
    `Wallpaper: ${state.appearance.wallpaperId}`,
    `Applications indexed: ${state.apps.length}`,
    `Windows managed: ${state.windows.length}`,
    `Active Orbit: ${state.activeOrbit}`,
  ].join("\n");

  const copyDiagnostics = async () => {
    await navigator.clipboard.writeText(diagnostics);
    setMessage("System summary copied");
  };

  return (
    <div className="aboutGravity__scrim" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="aboutGravity glass-heavy lens" role="dialog" aria-modal="true" aria-labelledby="about-gravity-title">
        <button className="aboutGravity__close" onClick={onClose} aria-label="Close About Gravity OS">×</button>
        <div className="aboutGravity__mark"><GravityMark size={62} /></div>
        <h1 id="about-gravity-title">Gravity OS</h1>
        <p className="aboutGravity__version">Version 1.0.0 · Windows shell environment</p>
        <p className="aboutGravity__summary">
          A reversible, native Windows workspace built around Orbit, Horizon and spatial window management.
        </p>
        <dl className="aboutGravity__facts">
          <div><dt>Mode</dt><dd>{state.shellMode === "gravity" ? "Gravity active" : state.shellMode}</dd></div>
          <div><dt>Appearance</dt><dd>{state.appearance.resolved}</dd></div>
          <div><dt>Managed windows</dt><dd>{state.windows.length}</dd></div>
          <div><dt>Applications</dt><dd>{state.apps.length}</dd></div>
        </dl>
        <div className="aboutGravity__actions">
          <button onClick={() => void actions.openSetting("ms-settings:about").catch((error) => setMessage(String(error)))}>Windows system information</button>
          <button onClick={() => void copyDiagnostics().catch((error) => setMessage(String(error)))}>Copy system summary</button>
          <button className="is-primary" onClick={() => void actions.setShellActive(false).catch((error) => setMessage(String(error)))}>
            <WindowsIcon size={14} /> Switch to Windows 11
          </button>
        </div>
        <p className="aboutGravity__shortcut">Return at any time with <kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>G</kbd> or the Gravity tray icon.</p>
        {message && <button className="aboutGravity__message" onClick={() => setMessage(null)} role="status">{message}</button>}
      </section>
    </div>
  );
}
