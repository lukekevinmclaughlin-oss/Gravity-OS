import { useRef, useState } from "react";
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
  const pointerDrag = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressOpen = useRef<string | null>(null);
  if (!open) return null;

  const orbitAt = (x: number, y: number) =>
    document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-constellation-orbit]")
      ?.dataset.constellationOrbit ?? null;

  const beginWindowDrag = (event: React.PointerEvent<HTMLDivElement>, windowId: string) => {
    if (event.pointerType === "mouse" || event.button !== 0 || (event.target as Element).closest(".constel__cardControls")) return;
    pointerDrag.current = { id: windowId, startX: event.clientX, startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveWindowDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDrag.current;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 7) {
      drag.moved = true;
      setDraggedWindow(drag.id);
    }
    if (drag.moved) setDropOrbit(orbitAt(event.clientX, event.clientY));
  };

  const finishWindowDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDrag.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const orbitId = drag.moved ? orbitAt(event.clientX, event.clientY) ?? dropOrbit : null;
    if (drag.moved) suppressOpen.current = drag.id;
    pointerDrag.current = null;
    setDraggedWindow(null);
    setDropOrbit(null);
    if (orbitId) {
      setError(null);
      void actions.moveWindowToOrbit(drag.id, orbitId).catch((reason) => setError(String(reason)));
    }
  };

  const beginWindowMouseDrag = (event: React.MouseEvent<HTMLDivElement>, windowId: string) => {
    if (event.button !== 0 || (event.target as Element).closest(".constel__cardControls")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const move = (next: MouseEvent) => {
      if (!moved && Math.hypot(next.clientX - startX, next.clientY - startY) > 7) {
        moved = true;
        setDraggedWindow(windowId);
      }
      if (moved) setDropOrbit(orbitAt(next.clientX, next.clientY));
    };
    const finish = (next: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
      const orbitId = moved ? orbitAt(next.clientX, next.clientY) : null;
      if (!moved) return;
      suppressOpen.current = windowId;
      setDraggedWindow(null);
      setDropOrbit(null);
      if (orbitId) {
        setError(null);
        void actions.moveWindowToOrbit(windowId, orbitId).catch((reason) => setError(String(reason)));
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish, { once: true });
  };

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
            data-constellation-orbit={o.id}
            onClick={() => {
              setError(null);
              if (draggedWindow) {
                const windowId = draggedWindow;
                setDraggedWindow(null);
                setDropOrbit(null);
                void actions.moveWindowToOrbit(windowId, o.id).catch((reason) => setError(String(reason)));
              } else {
                void actions.switchOrbit(o.id).catch((reason) => setError(String(reason)));
              }
            }}
          >
            {o.name}
            <span className="constel__orbitCount">
              {state.windows.filter((w) => w.orbitId === o.id).length}
            </span>
          </button>
        ))}
        {draggedWindow && (
          <span className="constel__moveHint glass">Choose an Orbit or drag onto one</span>
        )}
      </div>

      <div className="constel__field" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {[...groups.entries()].map(([appId, groupWins]) => {
          const app = state.apps.find((a) => a.id === appId);
          const appName = app?.name ?? groupWins[0]?.title ?? "Application";
          const appHue = app?.hue ?? 222;
          return (
            <div className="constel__group" key={appId}>
              <div className="constel__groupLabel">
                <AppTile name={appName} hue={appHue} size={18} appId={app?.id} />
                {appName}
              </div>
              <div className="constel__cards">
                {groupWins.map((w, i) => {
                  const mid = (groupWins.length - 1) / 2;
                  const fan = (i - mid) * 1.6;
                  return (
                    <div
                      key={w.id}
                      className={`constel__card glass lens ${w.minimized ? "is-min" : ""} ${w.maximized ? "is-max" : ""} ${draggedWindow === w.id ? "is-dragging" : ""}`}
                      style={{ transform: `rotate(${fan}deg) translateY(${Math.abs(i - mid) * 5}px)` }}
                      onMouseDown={(event) => beginWindowMouseDrag(event, w.id)}
                      onPointerDown={(event) => beginWindowDrag(event, w.id)}
                      onPointerMove={moveWindowDrag}
                      onPointerUp={finishWindowDrag}
                      onPointerCancel={() => {
                        pointerDrag.current = null;
                        setDraggedWindow(null);
                        setDropOrbit(null);
                      }}
                    >
                      <button
                        className="constel__dragHandle"
                        aria-label={`Drag ${w.title} to another Orbit`}
                        title="Drag to another Orbit"
                        aria-pressed={draggedWindow === w.id}
                        onClick={(event) => {
                          event.preventDefault();
                          if (suppressOpen.current === w.id) {
                            suppressOpen.current = null;
                            return;
                          }
                          setDraggedWindow((current) => current === w.id ? null : w.id);
                          setDropOrbit(null);
                        }}
                      ><span /></button>
                      <button
                        className="constel__cardOpen"
                        aria-label={`Open ${w.title}`}
                        onClick={() => {
                          if (suppressOpen.current === w.id) {
                            suppressOpen.current = null;
                            return;
                          }
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
                              hsl(${appHue} 40% 22% / 0.85),
                              hsl(${(appHue + 42) % 360} 45% 12% / 0.9))`,
                          }}
                        >
                          <AppTile name={appName} hue={appHue} size={34} appId={app?.id} />
                        </span>
                      </button>
                      <span className="constel__cardControls">
                        <button
                          className="constel__cardControl is-close"
                          aria-label={`Close ${w.title}`}
                          onClick={() => {
                            setError(null);
                            void actions.closeWindow(w.id).catch((reason) => setError(String(reason)));
                          }}
                        ><CloseIcon size={8} /></button>
                        <button
                          className="constel__cardControl is-minimize"
                          aria-label={`${w.minimized ? "Restore" : "Minimize"} ${w.title}`}
                          onClick={() => {
                            setError(null);
                            const operation = w.minimized ? actions.focusWindow(w.id) : actions.minimizeWindow(w.id);
                            void operation.catch((reason) => setError(String(reason)));
                          }}
                        ><span aria-hidden="true">−</span></button>
                        <button
                          className="constel__cardControl is-zoom"
                          aria-label={`${w.maximized ? "Restore" : "Fill"} ${w.title}`}
                          onClick={() => {
                            setError(null);
                            void actions.toggleMaximizeWindow(w.id).catch((reason) => setError(String(reason)));
                          }}
                        ><span aria-hidden="true">↗</span></button>
                      </span>
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
