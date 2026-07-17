import { useEffect, useRef, useState } from "react";
import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { TrashIcon } from "../components/Icons";
import { gravityWell } from "../lib/physics";
import { isAppRunning, windowsOf } from "../shell/types";
import "./orbit.css";

/** Orbit — Gravity's dock. Icons sit in a shallow gravity well: instead of
 *  Apple-style magnification they lean and rise toward the cursor's mass.
 *  Running apps carry an orbital ring with a moving satellite. */

const WELL_RADIUS = 150;

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

  const applyPhysics = (mouseX: number | null) => {
    const els = items
      .map((a) => tileRefs.current.get(a.id))
      .filter((el): el is HTMLElement => !!el);
    const n = els.length;
    els.forEach((el, idx) => {
      // Shallow horizon arc: the centre of the bar sits deeper in the well.
      const c = (n - 1) / 2;
      const arc = n > 1 ? 4 * (1 - ((idx - c) / c) ** 2) : 4;
      let scale = 1;
      let tx = 0;
      let ty = arc;
      if (mouseX !== null) {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const inf = gravityWell(cx - mouseX, WELL_RADIUS);
        scale = 1 + 0.24 * inf;
        ty = arc - 18 * inf;
        tx = Math.max(-7, Math.min(7, (mouseX - cx) * 0.06 * inf));
      }
      el.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    });
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
      className={`orbit glass lens ${live ? "is-live" : ""}`}
      onMouseEnter={() => setLive(true)}
      onMouseMove={(e) => applyPhysics(e.clientX)}
      onMouseLeave={() => {
        setLive(false);
        applyPhysics(null);
      }}
    >
      {items.map((app) => {
        const running = isAppRunning(state, app.id);
        return (
          <button
            key={app.id}
            className="orbitItem"
            ref={(el) => {
              if (el) tileRefs.current.set(app.id, el);
              else tileRefs.current.delete(app.id);
            }}
            onClick={() => onAppClick(app.id)}
          >
            <span className="orbitItem__label glass-heavy">{app.name}</span>
            <span className={`orbitItem__tileWrap ${launching.has(app.id) ? "is-launching" : ""}`}>
              <AppTile name={app.name} hue={app.hue} size={46} />
              {running && (
                <span className="orbitItem__ring">
                  <span className="orbitItem__satellite" />
                </span>
              )}
            </span>
          </button>
        );
      })}

      <span className="orbit__sep" />

      <button
        className={`orbitItem orbit__trash ${state.status.trashFull ? "" : "is-empty"}`}
        onClick={actions.emptyTrash}
        title={state.status.trashFull ? "Trash — click to empty" : "Trash is empty"}
      >
        <span className="orbitItem__label glass-heavy">Trash</span>
        <span className="orbit__trashTile">
          <TrashIcon size={21} />
          {state.status.trashFull && <span className="orbit__trashDot" />}
        </span>
      </button>
    </nav>
  );
}
