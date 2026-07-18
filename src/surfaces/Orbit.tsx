import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { GridIcon, SunIcon, TrashIcon, WindowsIcon } from "../components/Icons";
import { isAppRunning, windowsOf } from "../shell/types";
import { reorderPinnedIds } from "../lib/dock";
import { fitOrbitWindow, growOrbitWindow, openOverlay } from "../lib/win";
import { isTauri } from "../shell/tauri";
import "./orbit.css";

/** Orbit — Gravity's dock. A Gaussian target field is integrated through a
 *  damped spring on one read/write-batched animation frame, so pointer motion,
 *  neighbour displacement, insertions and shelf exit all share one fluid law. */

const BASE = 48;
const MAX_SCALE = 2.0;
const SIGMA = 60;

interface OrbitMenuState {
  appId: string;
  left: number;
}

function magnify(dx: number): number {
  return 1 + (MAX_SCALE - 1) * Math.exp(-(dx * dx) / (2 * SIGMA * SIGMA));
}

export interface OrbitProps {
  onOpenAppLibrary?: () => void;
}

export function Orbit({ onOpenAppLibrary }: OrbitProps = {}) {
  const { state, actions } = useShell();
  const tileRefs = useRef(new Map<string, HTMLElement>());
  const [live, setLive] = useState(false);
  const [launching, setLaunching] = useState<ReadonlySet<string>>(new Set());
  const [launchErrors, setLaunchErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [trashArmed, setTrashArmed] = useState(false);
  const [menu, setMenu] = useState<OrbitMenuState | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [fileDropAppId, setFileDropAppId] = useState<string | null>(null);
  const [fileDropCount, setFileDropCount] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const pointerDrag = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef<string | null>(null);
  const pointerX = useRef<number | null>(null);
  const animationFrame = useRef<number | null>(null);
  const previousFrame = useRef<number | null>(null);
  const reducedMotion = useRef(false);
  const motion = useRef(new Map<string, { width: number; velocity: number }>());
  const layoutPositions = useRef(new Map<string, DOMRect>());

  useEffect(() => {
    void growOrbitWindow(menu !== null);
    return () => {
      if (menu !== null) void growOrbitWindow(false);
    };
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

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
  const minimizedWindows = state.windows.filter((window) => window.minimized);
  const pinnedIds = state.apps.filter((app) => app.pinned).map((app) => app.id);
  const layoutSignature = `${items.map((item) => item.id).join("|")}::${minimizedWindows.map((window) => window.id).join("|")}`;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotion.current = preference.matches;
    };
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => () => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
  }, []);

  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    for (const [key, element] of tileRefs.current) {
      if (!element.isConnected) continue;
      const rect = element.getBoundingClientRect();
      next.set(key, rect);
      const previous = layoutPositions.current.get(key);
      const deltaX = previous ? previous.left - rect.left : 0;
      if (!reducedMotion.current && previous && Math.abs(deltaX) > 0.5) {
        element.animate(
          [
            { transform: `translate3d(${deltaX}px, 0, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          { duration: 320, easing: "cubic-bezier(.2,.82,.2,1)" },
        );
      }
    }
    layoutPositions.current = next;
  }, [layoutSignature]);

  useEffect(() => {
    void fitOrbitWindow(items.length + minimizedWindows.length);
  }, [items.length, minimizedWindows.length]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const current = getCurrentWindow();
      const scale = await current.scaleFactor();
      const appAt = (x: number, y: number) =>
        document
          .elementFromPoint(x / scale, y / scale)
          ?.closest<HTMLElement>("[data-orbit-app-id]")
          ?.dataset.orbitAppId ?? null;
      const stop = await current.onDragDropEvent(({ payload }) => {
        if (payload.type === "leave") {
          setFileDropAppId(null);
          setFileDropCount(0);
          return;
        }
        const target = appAt(payload.position.x, payload.position.y);
        setFileDropAppId(target);
        if (payload.type === "enter") setFileDropCount(payload.paths.length);
        if (payload.type !== "drop") return;
        const paths = payload.paths;
        setFileDropCount(0);
        setFileDropAppId(null);
        if (!target) {
          setActionError("Drop files directly onto an application in Orbit.");
          return;
        }
        void actions.launchAppWithFiles(target, paths)
          .catch((error) => setActionError(error instanceof Error ? error.message : String(error)));
      });
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => setActionError(`File drop could not start: ${String(error)}`));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [actions]);

  const animateMagnify = (timestamp: number) => {
    animationFrame.current = null;
    const elapsed = previousFrame.current === null ? 1 / 60 : (timestamp - previousFrame.current) / 1000;
    const deltaTime = Math.min(Math.max(elapsed, 1 / 240), 0.032);
    previousFrame.current = timestamp;

    // Batch all layout reads before writes so one growing tile cannot shift
    // the center used to calculate its neighbours in the same frame.
    const entries = [...tileRefs.current.entries()]
      .filter(([, element]) => element.isConnected)
      .map(([key, element]) => ({ key, element, rect: element.getBoundingClientRect() }));
    const activeKeys = new Set(entries.map(({ key }) => key));
    for (const key of motion.current.keys()) {
      if (!activeKeys.has(key)) motion.current.delete(key);
    }

    let unsettled = false;
    for (const { key, element, rect } of entries) {
      const target = pointerX.current === null
        ? BASE
        : BASE * magnify(rect.left + rect.width / 2 - pointerX.current);
      const value = motion.current.get(key) ?? { width: rect.width || BASE, velocity: 0 };

      if (reducedMotion.current) {
        value.width = target;
        value.velocity = 0;
      } else {
        const returning = pointerX.current === null;
        const stiffness = returning ? 300 : 430;
        const damping = returning ? 34 : 37;
        const acceleration = stiffness * (target - value.width) - damping * value.velocity;
        value.velocity += acceleration * deltaTime;
        value.width += value.velocity * deltaTime;
        value.width = Math.max(BASE * 0.98, Math.min(BASE * 2.04, value.width));
        if (Math.abs(target - value.width) > 0.08 || Math.abs(value.velocity) > 0.25) {
          unsettled = true;
        } else {
          value.width = target;
          value.velocity = 0;
        }
      }

      motion.current.set(key, value);
      element.style.width = `${value.width.toFixed(3)}px`;
      element.style.setProperty("--orbit-energy", `${Math.max(0, (value.width - BASE) / BASE).toFixed(3)}`);
    }

    if (unsettled) animationFrame.current = requestAnimationFrame(animateMagnify);
    else previousFrame.current = null;
  };

  const applyMagnify = (mouseX: number | null) => {
    pointerX.current = mouseX;
    if (animationFrame.current === null) animationFrame.current = requestAnimationFrame(animateMagnify);
  };

  const captureLayout = () => {
    const positions = new Map<string, DOMRect>();
    for (const [key, element] of tileRefs.current) {
      if (element.isConnected) positions.set(key, element.getBoundingClientRect());
    }
    layoutPositions.current = positions;
  };

  const onAppClick = async (appId: string) => {
    if (suppressClick.current === appId) {
      suppressClick.current = null;
      return;
    }
    const wins = windowsOf(state, appId);
    if (wins.length === 0) {
      setLaunching((prev) => new Set(prev).add(appId));
      setLaunchErrors((prev) => {
        if (!prev.has(appId)) return prev;
        const next = new Map(prev);
        next.delete(appId);
        return next;
      });
      try {
        await actions.launchApp(appId);
        // Apps that legitimately open without a top-level window must not
        // bounce forever. A real window still stops this immediately above.
        window.setTimeout(() => {
          setLaunching((prev) => {
            if (!prev.has(appId)) return prev;
            const next = new Set(prev);
            next.delete(appId);
            return next;
          });
        }, 8000);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLaunching((prev) => {
          const next = new Set(prev);
          next.delete(appId);
          return next;
        });
        setLaunchErrors((prev) => new Map(prev).set(appId, message));
      }
      return;
    }
    const target = wins.find((w) => !w.minimized) ?? wins[0];
    await actions.focusWindow(target.id);
  };

  const openAppMenu = (event: React.MouseEvent, appId: string) => {
    event.preventDefault();
    const shelf = event.currentTarget.closest(".orbit")?.getBoundingClientRect();
    const relative = shelf ? event.clientX - shelf.left : event.clientX;
    setMenu({ appId, left: Math.max(116, Math.min(relative, (shelf?.width ?? 420) - 116)) });
  };

  const reorder = async (targetId: string, requestedSource?: string) => {
    const sourceId = requestedSource ?? pointerDrag.current?.id ?? draggedId;
    if (!sourceId) return;
    const next = reorderPinnedIds(pinnedIds, sourceId, targetId);
    captureLayout();
    setDraggedId(null);
    setDragOverId(null);
    if (next !== pinnedIds) await actions.reorderPinnedApps(next);
  };

  const beginReorder = (event: React.PointerEvent<HTMLButtonElement>, appId: string, pinned: boolean) => {
    if (event.pointerType === "mouse" || !pinned || event.button !== 0) return;
    pointerDrag.current = { id: appId, startX: event.clientX, startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveReorder = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = pointerDrag.current;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) {
      drag.moved = true;
      setDraggedId(drag.id);
    }
    if (!drag.moved) return;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-orbit-app-id]")
      ?.dataset.orbitAppId ?? null;
    setDragOverId(target && pinnedIds.includes(target) ? target : null);
  };

  const finishReorder = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = pointerDrag.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved) {
      suppressClick.current = drag.id;
      const candidate = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-orbit-app-id]")
        ?.dataset.orbitAppId ?? null;
      const target = candidate && pinnedIds.includes(candidate) ? candidate : dragOverId;
      if (target) void reorder(target).catch((error) => setActionError(String(error)));
      else {
        setDraggedId(null);
        setDragOverId(null);
      }
    }
    pointerDrag.current = null;
  };

  const beginMouseReorder = (event: React.MouseEvent<HTMLButtonElement>, appId: string, pinned: boolean) => {
    if (!pinned || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const appAt = (next: MouseEvent) =>
      document
        .elementFromPoint(next.clientX, next.clientY)
        ?.closest<HTMLElement>("[data-orbit-app-id]")
        ?.dataset.orbitAppId ?? null;
    const move = (next: MouseEvent) => {
      if (!moved && Math.hypot(next.clientX - startX, next.clientY - startY) > 6) {
        moved = true;
        setDraggedId(appId);
      }
      if (!moved) return;
      const target = appAt(next);
      setDragOverId(target && pinnedIds.includes(target) ? target : null);
    };
    const finish = (next: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", finish);
      if (!moved) return;
      suppressClick.current = appId;
      const candidate = appAt(next);
      const target = candidate && pinnedIds.includes(candidate) ? candidate : null;
      if (target) void reorder(target, appId).catch((error) => setActionError(String(error)));
      else {
        setDraggedId(null);
        setDragOverId(null);
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", finish, { once: true });
  };

  const menuApp = menu ? state.apps.find((app) => app.id === menu.appId) : undefined;
  const menuWindows = menuApp ? windowsOf(state, menuApp.id) : [];
  const setPinned = async (pinned: boolean) => {
    if (!menuApp) return;
    try {
      await actions.setAppPinned(menuApp.id, pinned);
      setMenu(null);
    } catch (error) {
      setActionError(String(error));
    }
  };

  return (
    <nav
      className={`orbit glass ${live ? "is-live" : ""}`}
      onMouseEnter={(event) => {
        setLive(true);
        applyMagnify(event.clientX);
      }}
      onMouseMove={(e) => applyMagnify(e.clientX)}
      onMouseLeave={() => {
        setLive(false);
        applyMagnify(null);
      }}
    >
      {menu && <button className="orbitContextDismiss" aria-label="Close app menu" onClick={() => setMenu(null)} />}
      {items.map((app) => {
        const running = isAppRunning(state, app.id);
        return (
          <button
            key={app.id}
            className={`orbitItem ${launchErrors.has(app.id) ? "is-error" : ""} ${draggedId === app.id ? "is-reordering" : ""} ${dragOverId === app.id ? "is-reorder-target" : ""} ${fileDropAppId === app.id ? "is-file-target" : ""}`}
            style={{ width: BASE }}
            aria-label={app.name}
            data-orbit-app-id={app.id}
            ref={(el) => {
              if (el) tileRefs.current.set(app.id, el);
              else tileRefs.current.delete(app.id);
            }}
            onClick={() => void onAppClick(app.id)}
            title={launchErrors.get(app.id)}
            onMouseDown={(event) => beginMouseReorder(event, app.id, app.pinned)}
            onPointerDown={(event) => beginReorder(event, app.id, app.pinned)}
            onPointerMove={moveReorder}
            onPointerUp={finishReorder}
            onPointerCancel={() => {
              pointerDrag.current = null;
              setDraggedId(null);
              setDragOverId(null);
            }}
            onContextMenu={(event) => openAppMenu(event, app.id)}
          >
            <span className="orbitItem__label glass-heavy">{app.name}</span>
            <span className={`orbitItem__tileWrap ${launching.has(app.id) ? "is-launching" : ""}`}>
              <AppTile name={app.name} hue={app.hue} appId={app.id} fill />
              {fileDropAppId === app.id && (
                <span className="orbitItem__dropBadge">Open {fileDropCount || ""}</span>
              )}
            </span>
            <span className={`orbitItem__dot ${running ? "is-running" : ""}`} />
          </button>
        );
      })}

      <span className="sr-only" role="status" aria-live="polite">
        {launchErrors.size ? [...launchErrors.values()][launchErrors.size - 1] : ""}
      </span>

      <span className="orbit__sep" />

      {minimizedWindows.map((window) => {
        const app = state.apps.find((item) => item.id === window.appId);
        const name = app?.name ?? window.title;
        const hue = app?.hue ?? 222;
        return (
          <button
            key={`window-${window.id}`}
            className="orbitItem orbitWindow"
            style={{ width: BASE }}
            aria-label={`Restore ${window.title}`}
            ref={(element) => {
              const key = `window:${window.id}`;
              if (element) tileRefs.current.set(key, element);
              else tileRefs.current.delete(key);
            }}
            onClick={() => void actions.focusWindow(window.id).catch((error) => setActionError(String(error)))}
            onContextMenu={(event) => openAppMenu(event, window.appId)}
          >
            <span className="orbitItem__label glass-heavy">{window.title}</span>
            <span className="orbitWindow__preview">
              <span className="orbitWindow__bar"><i /><i /><i /></span>
              <span className="orbitWindow__body">
                <AppTile name={name} hue={hue} size={19} appId={app?.id} />
                <span>{window.title}</span>
              </span>
            </span>
            <span className="orbitItem__dot is-minimized" />
          </button>
        );
      })}

      <button
        className="orbitItem orbit__utility orbit__windows"
        style={{ width: BASE }}
        aria-label="Switch to Windows 11"
        ref={(element) => {
          if (element) tileRefs.current.set("__windows", element);
          else tileRefs.current.delete("__windows");
        }}
        onClick={() => {
          setActionError(null);
          void actions.setShellActive(false).catch((error) => setActionError(String(error)));
        }}
      >
        <span className="orbitItem__label glass-heavy">Switch to Windows 11 · Ctrl Alt G to return</span>
        <span className="orbit__utilTile orbit__windowsTile">
          <WindowsIcon size={21} />
        </span>
        <span className="orbitItem__dot" />
      </button>

      <button
        className="orbitItem orbit__utility"
        style={{ width: BASE }}
        aria-label={`Switch to ${state.appearance.resolved === "light" ? "dark" : "light"} appearance`}
        ref={(el) => {
          if (el) tileRefs.current.set("__appearance", el);
          else tileRefs.current.delete("__appearance");
        }}
        onClick={() =>
          void actions.setAppearance(state.appearance.resolved === "light" ? "dark" : "light")
            .catch((error) => setActionError(String(error)))
        }
      >
        <span className="orbitItem__label glass-heavy">
          {state.appearance.resolved === "light" ? "Dark appearance" : "Light appearance"}
        </span>
        <span className="orbit__utilTile orbit__appearanceTile">
          <SunIcon size={20} />
        </span>
        <span className="orbitItem__dot" />
      </button>

      <button
        className="orbitItem orbit__utility"
        style={{ width: BASE }}
        aria-label="Applications"
        ref={(el) => {
          if (el) tileRefs.current.set("__apps", el);
          else tileRefs.current.delete("__apps");
        }}
        onClick={() => onOpenAppLibrary ? onOpenAppLibrary() : void openOverlay("app-library")}
      >
        <span className="orbitItem__label glass-heavy">Applications</span>
        <span className="orbit__utilTile">
          <GridIcon size={20} />
        </span>
        <span className="orbitItem__dot" />
      </button>

      <button
        className={`orbitItem orbit__trash ${state.status.trashFull ? "" : "is-empty"}`}
        style={{ width: BASE }}
        aria-label="Trash"
        ref={(el) => {
          if (el) tileRefs.current.set("__trash", el);
          else tileRefs.current.delete("__trash");
        }}
        onClick={() => {
          if (!state.status.trashFull) return;
          if (trashArmed) {
            void actions.emptyTrash().catch((error) => setActionError(String(error)));
            setTrashArmed(false);
          } else {
            setTrashArmed(true);
            window.setTimeout(() => setTrashArmed(false), 3000);
          }
        }}
        title={
          !state.status.trashFull
            ? "Trash is empty"
            : trashArmed
              ? "Click again to empty"
              : "Trash — click to empty"
        }
      >
        <span className="orbitItem__label glass-heavy">
          {trashArmed ? "Click again to empty" : "Trash"}
        </span>
        <span className={`orbit__trashTile ${trashArmed ? "is-armed" : ""}`}>
          <TrashIcon size={21} />
          {state.status.trashFull && <span className="orbit__trashDot" />}
        </span>
        <span className="orbitItem__dot" />
      </button>

      {menu && menuApp && (
        <div
          className="orbitContext glass-heavy"
          role="menu"
          aria-label={`${menuApp.name} actions`}
          style={{ left: menu.left }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="orbitContext__title">{menuApp.name}</div>
          {menuWindows.map((window) => (
            <button
              key={window.id}
              className="orbitContext__window"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                void actions.focusWindow(window.id).catch((error) => setActionError(String(error)));
              }}
            >
              <span>{window.title}</span>
              <small>{window.minimized ? "Minimized" : window.focused ? "Active" : "Open"}</small>
            </button>
          ))}
          {menuWindows.length === 0 && (
            <button role="menuitem" onClick={() => { setMenu(null); void onAppClick(menuApp.id); }}>
              Open
            </button>
          )}
          <button role="menuitem" onClick={() => {
            setMenu(null);
            void actions.launchApp(menuApp.id).catch((error) => setActionError(String(error)));
          }}>
            New Window
          </button>
          {menuWindows.length > 1 && (
            <button role="menuitem" onClick={() => { setMenu(null); void openOverlay("constellation"); }}>
              Show All Windows
            </button>
          )}
          <span className="orbitContext__sep" />
          <button role="menuitem" onClick={() => void setPinned(!menuApp.pinned)}>
            {menuApp.pinned ? "Remove from Orbit" : "Keep in Orbit"}
          </button>
          {menuWindows.length > 0 && (
            <button
              role="menuitem"
              onClick={() => {
                void Promise.all(menuWindows.map((item) => actions.closeWindow(item.id)))
                  .then(() => setMenu(null))
                  .catch((error) => setActionError(String(error)));
              }}
            >
              Quit
            </button>
          )}
        </div>
      )}
      {actionError && (
        <button className="orbitError glass-heavy" role="alert" onClick={() => setActionError(null)}>
          {actionError}
        </button>
      )}
    </nav>
  );
}
