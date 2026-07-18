import { useState } from "react";
import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { CloseIcon } from "../components/Icons";
import "./constellation.css";

/** Constellation — the exposé. Windows cluster by app with faint connecting
 *  lines; Orbits (virtual desktops) sit along the top. */

export interface ConstellationProps {
  open: boolean;
  onClose: () => void;
}

export function Constellation({ open, onClose }: ConstellationProps) {
  const { state, actions } = useShell();
  const [draggedWindow, setDraggedWindow] = useState<string | null>(null);
  const [dropOrbit, setDropOrbit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const wins = state.windows.filter((w) => w.orbitId === state.activeOrbit);
  const groups = new Map<string, typeof wins>();
  for (const w of wins) {
    const list = groups.get(w.appId) ?? [];
    list.push(w);
    groups.set(w.appId, list);
  }

  return (
    <div className="constel" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="constel__orbits">
        {state.orbits.map((o) => (
          <button
            key={o.id}
            className={`constel__orbitPill glass ${o.id === state.activeOrbit ? "is-active" : ""} ${dropOrbit === o.id ? "is-drop" : ""}`}
            onClick={() => {
              setError(null);
              void actions.switchOrbit(o.id).catch((reason) => setError(String(reason)));
            }}
            onDragOver={(event) => {
              if (!draggedWindow) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropOrbit(o.id);
            }}
            onDragLeave={() => setDropOrbit((current) => current === o.id ? null : current)}
            onDrop={(event) => {
              event.preventDefault();
              const windowId = draggedWindow ?? event.dataTransfer.getData("application/x-gravity-window");
              setDropOrbit(null);
              setDraggedWindow(null);
              if (windowId) {
                setError(null);
                void actions.moveWindowToOrbit(windowId, o.id).catch((reason) => setError(String(reason)));
              }
            }}
          >
            {o.name}
            <span className="constel__orbitCount">
              {state.windows.filter((w) => w.orbitId === o.id).length}
            </span>
          </button>
        ))}
      </div>

      <div className="constel__field" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {[...groups.entries()].map(([appId, groupWins]) => {
          const app = state.apps.find((a) => a.id === appId);
          if (!app) return null;
          return (
            <div className="constel__group" key={appId}>
              <div className="constel__groupLabel">
                <AppTile name={app.name} hue={app.hue} size={18} appId={app.id} />
                {app.name}
              </div>
              <div className="constel__cards">
                {groupWins.map((w, i) => {
                  const mid = (groupWins.length - 1) / 2;
                  const fan = (i - mid) * 1.6;
                  return (
                    <div
                      key={w.id}
                      className={`constel__card glass lens ${w.minimized ? "is-min" : ""}`}
                      style={{ transform: `rotate(${fan}deg) translateY(${Math.abs(i - mid) * 5}px)` }}
                      draggable
                      onDragStart={(event) => {
                        setDraggedWindow(w.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("application/x-gravity-window", w.id);
                      }}
                      onDragEnd={() => {
                        setDraggedWindow(null);
                        setDropOrbit(null);
                      }}
                    >
                      <button
                        className="constel__cardOpen"
                        aria-label={`Open ${w.title}`}
                        onClick={() => {
                          setError(null);
                          void actions.focusWindow(w.id)
                            .then(onClose)
                            .catch((reason) => setError(String(reason)));
                        }}
                      >
                        <span className="constel__cardHead">
                          <span className="constel__cardTitle">{w.title}</span>
                        </span>
                        <span
                          className="constel__cardBody"
                          style={{
                            background: `linear-gradient(155deg,
                              hsl(${app.hue} 40% 22% / 0.85),
                              hsl(${(app.hue + 42) % 360} 45% 12% / 0.9))`,
                          }}
                        >
                          <AppTile name={app.name} hue={app.hue} size={34} appId={app.id} />
                        </span>
                      </button>
                      <button
                        className="constel__cardClose"
                        aria-label={`Close ${w.title}`}
                        onClick={() => {
                          setError(null);
                          void actions.closeWindow(w.id).catch((reason) => setError(String(reason)));
                        }}
                      >
                        <CloseIcon size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {wins.length === 0 && <div className="constel__empty">Nothing in this orbit yet</div>}
      </div>
      {error && <button className="constel__error glass-heavy" role="alert" onClick={() => setError(null)}>{error}</button>}
    </div>
  );
}
