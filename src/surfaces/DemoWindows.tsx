import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { mulberry32 } from "../lib/rng";
import "./demowindows.css";

/** Dev-preview only: renders the mock backend's windows as real Gravity-chrome
 *  windows so the desktop, Constellation and Orbit have something to govern.
 *  On Windows this layer doesn't exist — real app windows do, and the chrome
 *  concept shown here becomes the caption overlay. */

function seatOf(id: string): { left: number; top: number; w: number; h: number } {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = mulberry32(h);
  return {
    left: 6 + rand() * 38,
    top: 10 + rand() * 26,
    w: 30 + rand() * 14,
    h: 36 + rand() * 18,
  };
}

export function DemoWindows() {
  const { state, actions } = useShell();
  const wins = state.windows.filter((w) => w.orbitId === state.activeOrbit && !w.minimized);

  return (
    <>
      {wins.map((w) => {
        const app = state.apps.find((a) => a.id === w.appId);
        if (!app) return null;
        const seat = seatOf(w.id);
        return (
          <div
            key={w.id}
            className={`demoWin glass ${w.focused ? "is-focused" : ""}`}
            style={{
              left: `${seat.left}%`,
              top: `${seat.top}%`,
              width: `${seat.w}vw`,
              height: `${seat.h}vh`,
            }}
            onMouseDown={() => !w.focused && actions.focusWindow(w.id)}
          >
            <div className="demoWin__bar">
              <span className="demoWin__orbs">
                <button
                  className="demoWin__orb is-close"
                  title="Close"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.closeWindow(w.id);
                  }}
                />
                <button
                  className="demoWin__orb is-min"
                  title="Minimize"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.minimizeWindow(w.id);
                  }}
                />
                <button className="demoWin__orb is-zoom" title="Zoom" />
              </span>
              <span className="demoWin__title">{w.title}</span>
            </div>
            <div
              className="demoWin__body"
              style={{
                background: `linear-gradient(160deg,
                  hsl(${app.hue} 32% 16% / 0.55),
                  hsl(${(app.hue + 42) % 360} 36% 9% / 0.6))`,
              }}
            >
              <AppTile name={app.name} hue={app.hue} size={44} />
            </div>
          </div>
        );
      })}
    </>
  );
}
