import { useEffect, useRef, useState } from "react";
import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { TrashIcon } from "../components/Icons";
import { isAppRunning, windowsOf } from "../shell/types";
import "./orbit.css";

/** Orbit — Gravity's dock, with true magnification (spec §4):
 *  tiles grow toward 2.0× under the cursor with a Gaussian falloff and track
 *  the cursor 1:1 — no smoothing while the pointer moves; springs only on
 *  shelf enter/leave. Width-based growth lets the shelf widen naturally. */

const BASE = 48;
const MAX_SCALE = 2.0;
const SIGMA = 60;

function magnify(dx: number): number {
  return 1 + (MAX_SCALE - 1) * Math.exp(-(dx * dx) / (2 * SIGMA * SIGMA));
}

export function Orbit() {
  const { state, actions } = useShell();
  const tileRefs = useRef(new Map<string, HTMLElement>());
  const [live, setLive] = useState(false);
  const [launching, setLaunching] = useState<ReadonlySet<string>>(new Set());

  // Stop the launch bounce once the app's first window exists.
  useEffect(() => {
    setLaunching((prev) => {
      const next = new Set([...prev].filter((id) => !isAppRunning(state, id)));
      return next.size === prev.size ? prev : next;
    });
  }, [state.windows]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = [
    ...state.apps.filter((a) => a.pinned),
    ...state.apps.filter((a) => !a.pinned && isAppRunning(state, a.id)),
  ];

  const applyMagnify = (mouseX: number | null) => {
    for (const el of tileRefs.current.values()) {
      if (!el.isConnected) continue;
      let w = BASE;
      if (mouseX !== null) {
        const rect = el.getBoundingClientRect();
        w = BASE * magnify(rect.left + rect.width / 2 - mouseX);
      }
      el.style.width = `${w}px`;
    }
  };

  const onAppClick = (appId: string) => {
    const wins = windowsOf(state, appId);
    if (wins.length === 0) {
      setLaunching((prev) => new Set(prev).add(appId));
      actions.launchApp(appId);
      return;
    }
    const target = wins.find((w) => !w.minimized) ?? wins[0];
    actions.focusWindow(target.id);
  };

  return (
    <nav
      className={`orbit glass ${live ? "is-live" : ""}`}
      onMouseEnter={() => setLive(true)}
      onMouseMove={(e) => applyMagnify(e.clientX)}
      onMouseLeave={() => {
        setLive(false);
        applyMagnify(null);
      }}
    >
      {items.map((app) => {
        const running = isAppRunning(state, app.id);
        return (
          <button
            key={app.id}
            className="orbitItem"
            style={{ width: BASE }}
            aria-label={app.name}
            ref={(el) => {
              if (el) tileRefs.current.set(app.id, el);
              else tileRefs.current.delete(app.id);
            }}
            onClick={() => onAppClick(app.id)}
          >
            <span className="orbitItem__label glass-heavy">{app.name}</span>
            <span className={`orbitItem__tileWrap ${launching.has(app.id) ? "is-launching" : ""}`}>
              <AppTile name={app.name} hue={app.hue} appId={app.id} fill />
            </span>
            <span className={`orbitItem__dot ${running ? "is-running" : ""}`} />
          </button>
        );
      })}

      <span className="orbit__sep" />

      <button
        className={`orbitItem orbit__trash ${state.status.trashFull ? "" : "is-empty"}`}
        style={{ width: BASE }}
        ref={(el) => {
          if (el) tileRefs.current.set("__trash", el);
          else tileRefs.current.delete("__trash");
        }}
        onClick={actions.emptyTrash}
        title={state.status.trashFull ? "Trash — click to empty" : "Trash is empty"}
      >
        <span className="orbitItem__label glass-heavy">Trash</span>
        <span className="orbit__trashTile">
          <TrashIcon size={21} />
          {state.status.trashFull && <span className="orbit__trashDot" />}
        </span>
        <span className="orbitItem__dot" />
      </button>
    </nav>
  );
}
