import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { mulberry32 } from "../lib/rng";
import { useRef, useState } from "react";
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
  const [positions, setPositions] = useState<ReadonlyMap<string, { x: number; y: number }>>(new Map());
  const drag = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
  } | null>(null);
  const wins = state.windows.filter((w) => w.orbitId === state.activeOrbit && !w.minimized);

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>, windowId: string) => {
    if (event.pointerType === "mouse" || event.button !== 0 || (event.target as Element).closest("button")) return;
    const windowElement = event.currentTarget.closest<HTMLElement>(".demoWin");
    if (!windowElement) return;
    const rect = windowElement.getBoundingClientRect();
    drag.current = {
      id: windowId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      width: rect.width,
      height: rect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const x = Math.max(0, Math.min(window.innerWidth - current.width, current.originX + event.clientX - current.startX));
    const y = Math.max(30, Math.min(window.innerHeight - current.height - 36, current.originY + event.clientY - current.startY));
    setPositions((positions) => new Map(positions).set(current.id, { x, y }));
  };

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };

  const beginMouseDrag = (event: React.MouseEvent<HTMLDivElement>, windowId: string) => {
    if (event.button !== 0 || (event.target as Element).closest("button")) return;
    const windowElement = event.currentTarget.closest<HTMLElement>(".demoWin");
    if (!windowElement) return;
    const rect = windowElement.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (next: MouseEvent) => {
      const x = Math.max(0, Math.min(window.innerWidth - rect.width, rect.left + next.clientX - startX));
      const y = Math.max(30, Math.min(window.innerHeight - rect.height - 36, rect.top + next.clientY - startY));
      setPositions((positions) => new Map(positions).set(windowId, { x, y }));
    };
    const finish = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish, { once: true });
  };

  return (
    <>
      {wins.map((w) => {
        const app = state.apps.find((a) => a.id === w.appId);
        if (!app) return null;
        const seat = seatOf(w.id);
        const isMaximized = w.maximized;
        const position = positions.get(w.id);
        return (
          <div
            key={w.id}
            data-demo-window-id={w.id}
            className={`demoWin glass ${w.focused ? "is-focused" : ""} ${isMaximized ? "is-maximized" : ""}`}
            style={{
              left: isMaximized ? "2%" : position ? `${position.x}px` : `${seat.left}%`,
              top: isMaximized ? "5%" : position ? `${position.y}px` : `${seat.top}%`,
              width: isMaximized ? "96vw" : `${seat.w}vw`,
              height: isMaximized ? "82vh" : `${seat.h}vh`,
            }}
            onMouseDown={() => { if (!w.focused) void actions.focusWindow(w.id); }}
          >
            <div
              className="demoWin__bar"
              role="toolbar"
              aria-label={`Window title bar for ${w.title}`}
              onMouseDown={(event) => beginMouseDrag(event, w.id)}
              onPointerDown={(event) => beginDrag(event, w.id)}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={() => { drag.current = null; }}
              onDoubleClick={(event) => {
                if (!(event.target as Element).closest("button")) void actions.toggleMaximizeWindow(w.id);
              }}
            >
              <span className="demoWin__orbs">
                <button
                  className="demoWin__orb is-close"
                  title="Close"
                  onClick={(e) => {
                    e.stopPropagation();
                    void actions.closeWindow(w.id);
                  }}
                />
                <button
                  className="demoWin__orb is-min"
                  title="Minimize"
                  onClick={(e) => {
                    e.stopPropagation();
                    void actions.minimizeWindow(w.id);
                  }}
                />
                <button
                  className="demoWin__orb is-zoom"
                  title={isMaximized ? "Restore" : "Zoom"}
                  onClick={(event) => {
                    event.stopPropagation();
                    void actions.toggleMaximizeWindow(w.id);
                  }}
                />
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
