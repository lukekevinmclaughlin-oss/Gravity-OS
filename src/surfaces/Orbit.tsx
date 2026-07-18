import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { GridIcon, SlidersIcon, SunIcon, TrashIcon, WindowsIcon } from "../components/Icons";
import { isAppRunning, windowsOf } from "../shell/types";
import { reorderPinnedIds } from "../lib/dock";
import { fitOrbitWindow, growOrbitWindow, openOverlay } from "../lib/win";
import { isTauri } from "../shell/tauri";
import { useDesktopWells, WELL_CAPACITY } from "../lib/wells";
import { usePersonalization } from "../lib/customization";
import "./orbit.css";

/** Orbit — Gravity's dock. A Gaussian target field is integrated through a
 *  damped spring on one read/write-batched animation frame, so pointer motion,
 *  neighbour displacement, insertions and shelf exit all share one fluid law. */

interface OrbitMenuState {
  appId: string;
  left: number;
}

function magnify(dx: number, maxScale: number, sigma: number): number {
  return 1 + (maxScale - 1) * Math.exp(-(dx * dx) / (2 * sigma * sigma));
}

export interface OrbitProps {
  onOpenAppLibrary?: () => void;
  onOpenCustomization?: () => void;
}

export function Orbit({ onOpenAppLibrary, onOpenCustomization }: OrbitProps = {}) {
  const { state, actions } = useShell();
  const wells = useDesktopWells();
  const [personalization] = usePersonalization();
  const BASE = personalization.dock.size;
  const MAX_SCALE = personalization.dock.magnification;
  const SIGMA = personalization.dock.magnifyRadius;
  const tileRefs = useRef(new Map<string, HTMLElement>());
  const [live, setLive] = useState(false);
  const [launching, setLaunching] = useState<ReadonlySet<string>>(new Set());
  const [launchErrors, setLaunchErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [trashArmed, setTrashArmed] = useState(false);
  const [windowDropTarget, setWindowDropTarget] = useState(false);
  const [draggedWindowId, setDraggedWindowId] = useState<string | null>(null);
  const [menu, setMenu] = useState<OrbitMenuState | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [fileDropAppId, setFileDropAppId] = useState<string | null>(null);
  const [fileDropCount, setFileDropCount] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const pointerDrag = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef<string | null>(null);
  const windowDrag = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressWindowClick = useRef<string | null>(null);
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
    ...(personalization.dock.showOpenApps ? state.apps.filter((a) => !a.pinned && isAppRunning(state, a.id)) : []),
  ];
  const minimizedWindows = state.windows.filter((window) => window.minimized);
  const pinnedIds = state.apps.filter((app) => app.pinned).map((app) => app.id);
  const layoutSignature = `${items.map((item) => item.id).join("|")}::${minimizedWindows.map((window) => window.id).join("|")}`;
  const notificationsByApp = useMemo(() => {
    const normalized = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
    return new Map(state.apps.map((app) => {
      const key = normalized(app.name);
      const notes = state.notifications.filter((note) => {
        const source = normalized(note.appName);
        return source === key || (source.length > 3 && (source.includes(key) || key.includes(source)));
      });
      return [app.id, notes] as const;
    }));
  }, [state.apps, state.notifications]);

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
    void fitOrbitWindow(items.length + minimizedWindows.length, BASE, MAX_SCALE);
  }, [items.length, minimizedWindows.length, BASE, MAX_SCALE]);

  useEffect(() => {
    const trash = tileRefs.current.get("__trash");
    const shelf = trash?.closest<HTMLElement>(".orbit");
    if (!trash || !shelf) return;
    let disposed = false;
    let timer: number | null = null;
    let lastPublished = 0;
    const publish = () => {
      timer = null;
      if (disposed || !trash.isConnected) return;
      lastPublished = performance.now();
      const rect = trash.getBoundingClientRect();
      const dockRect = shelf.getBoundingClientRect();
      void actions.registerDesktopTrashTarget({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        dockX: dockRect.left,
        dockY: dockRect.top,
        dockWidth: dockRect.width,
        dockHeight: dockRect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }).catch((error) => setActionError(`Dock targeting could not update: ${String(error)}`));
    };
    // Magnification changes both the Trash width and its physical x position.
    // Publish on the leading edge, then at most once per frame pair while the
    // spring is moving so a fast cross-window drop still uses current geometry.
    const schedule = () => {
      if (disposed) return;
      const delay = Math.max(0, 32 - (performance.now() - lastPublished));
      if (delay === 0) publish();
      else if (timer === null) timer = window.setTimeout(publish, delay);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(trash);
    observer?.observe(shelf);
    window.addEventListener("resize", schedule);
    const initialFrame = requestAnimationFrame(schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(initialFrame);
      if (timer !== null) window.clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      void actions.registerDesktopTrashTarget(null).catch(() => {});
    };
  }, [actions, layoutSignature]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisten: Array<() => void> = [];
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const stopHover = await listen<{ active: boolean }>("gravity://dock-window-hover", ({ payload }) => {
        setWindowDropTarget(Boolean(payload.active));
      });
      const stopDrag = await listen<{ windowId: string; moved: boolean; error: string | null }>(
        "gravity://dock-window-drag-ended",
        ({ payload }) => {
          setDraggedWindowId((current) => current === payload.windowId ? null : current);
          if (payload.error) setActionError(`Window could not leave Orbit: ${payload.error}`);
        },
      );
      const stopAppDrag = await listen<{ appId: string; error: string | null }>(
        "gravity://dock-app-drag-ended",
        ({ payload }) => {
          if (payload.error) setActionError(`Application could not enter a Gravity Well: ${payload.error}`);
        },
      );
      const stopStore = await listen<{ error: string | null }>("gravity://well-store-result", ({ payload }) => {
        if (payload.error) setActionError(`Gravity Well could not store the application: ${payload.error}`);
      });
      if (disposed) {
        stopHover();
        stopDrag();
        stopAppDrag();
        stopStore();
      } else {
        unlisten.push(stopHover, stopDrag, stopAppDrag, stopStore);
      }
    }).catch((error) => setActionError(`Dock window-drop feedback could not start: ${String(error)}`));
    return () => {
      disposed = true;
      unlisten.forEach((stop) => stop());
    };
  }, []);

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
        : BASE * magnify(rect.left + rect.width / 2 - pointerX.current, MAX_SCALE, SIGMA);
      const value = motion.current.get(key) ?? { width: rect.width || BASE, velocity: 0 };

      if (reducedMotion.current) {
        value.width = target;
        value.velocity = 0;
      } else {
        const returning = pointerX.current === null;
        const profile = personalization.dock.motion === "gentle"
          ? { stiffness: returning ? 220 : 285, damping: returning ? 31 : 33 }
          : personalization.dock.motion === "expressive"
            ? { stiffness: returning ? 370 : 540, damping: returning ? 34 : 38 }
            : { stiffness: returning ? 300 : 430, damping: returning ? 34 : 37 };
        const { stiffness, damping } = profile;
        const acceleration = stiffness * (target - value.width) - damping * value.velocity;
        value.velocity += acceleration * deltaTime;
        value.width += value.velocity * deltaTime;
        value.width = Math.max(BASE * 0.98, Math.min(BASE * (MAX_SCALE + .04), value.width));
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

  const beginWindowDrag = (event: React.PointerEvent<HTMLButtonElement>, windowId: string) => {
    if (event.button !== 0) return;
    if (isTauri()) {
      setDraggedWindowId(windowId);
      void actions.beginDockWindowDrag(windowId).catch((error) => {
        setDraggedWindowId(null);
        setActionError(`Window drag could not start: ${String(error)}`);
      });
      return;
    }
    windowDrag.current = {
      id: windowId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveWindowDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = windowDrag.current;
    if (!drag) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) {
      drag.moved = true;
      setDraggedWindowId(drag.id);
      applyMagnify(null);
    }
  };

  const finishWindowDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = windowDrag.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    windowDrag.current = null;
    setDraggedWindowId(null);
    if (!drag.moved) return;
    suppressWindowClick.current = drag.id;
    const clientX = event.clientX;
    const clientY = event.clientY;
    void (async () => {
      const pointer = await actions.desktopPointerLocation(clientX, clientY);
      const width = 0.42;
      const height = 0.48;
      const x = Math.max(0, Math.min(1 - width, pointer.x - width / 2));
      const y = Math.max(0, Math.min(1 - height, pointer.y - height / 2));
      await actions.focusWindow(drag.id);
      await actions.applyGridRegionOnMonitor(drag.id, pointer.monitor, x, y, width, height);
    })().catch((error) => setActionError(`Window could not leave Orbit: ${String(error)}`));
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
      className={`orbit glass is-material-${personalization.dock.material} is-motion-${personalization.dock.motion} ${personalization.dock.showLabels ? "" : "hide-labels"} ${personalization.dock.showIndicators ? "" : "hide-indicators"} ${personalization.dock.showBadges ? "" : "hide-badges"} ${live ? "is-live" : ""} ${windowDropTarget ? "is-window-drop-target" : ""}`}
      style={{ "--orbit-gap": `${personalization.dock.spacing}px`, "--orbit-opacity": personalization.dock.opacity } as React.CSSProperties}
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
        const notificationCount = notificationsByApp.get(app.id)?.length ?? 0;
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
            onPointerDown={(event) => {
              if (isTauri() && event.button === 0) {
                void actions.beginDockAppDrag(app.id).catch((error) => setActionError(String(error)));
              }
              beginReorder(event, app.id, app.pinned);
            }}
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
              {notificationCount > 0 && <span className="orbitItem__badge" aria-label={`${notificationCount} notifications`}>{notificationCount > 99 ? "99+" : notificationCount}</span>}
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
            className={`orbitItem orbitWindow ${draggedWindowId === window.id ? "is-window-dragging" : ""}`}
            style={{ width: BASE }}
            aria-label={`Restore ${window.title}`}
            ref={(element) => {
              const key = `window:${window.id}`;
              if (element) tileRefs.current.set(key, element);
              else tileRefs.current.delete(key);
            }}
            onClick={() => {
              if (suppressWindowClick.current === window.id) {
                suppressWindowClick.current = null;
                return;
              }
              void actions.focusWindow(window.id).catch((error) => setActionError(String(error)));
            }}
            onPointerDown={(event) => beginWindowDrag(event, window.id)}
            onPointerMove={moveWindowDrag}
            onPointerUp={finishWindowDrag}
            onPointerCancel={() => {
              if (!isTauri()) {
                windowDrag.current = null;
                setDraggedWindowId(null);
              }
            }}
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
        className="orbitItem orbit__utility orbit__customization"
        style={{ width: BASE }}
        aria-label="Gravity customization"
        ref={(el) => {
          if (el) tileRefs.current.set("__customization", el);
          else tileRefs.current.delete("__customization");
        }}
        onClick={() => onOpenCustomization ? onOpenCustomization() : void openOverlay("customization")}
      >
        <span className="orbitItem__label glass-heavy">Customize Gravity OS</span>
        <span className="orbit__utilTile orbit__customizationTile"><SlidersIcon size={20} /></span>
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
          {wells.length > 0 && <div className="orbitContext__heading">Add to Gravity Well</div>}
          {wells.map((well) => {
            const occupied = state.windows.filter((window) => window.parkedWellId === well.id).length;
            const full = occupied >= WELL_CAPACITY[well.kind];
            return <button key={well.id} role="menuitem" disabled={full} onClick={() => {
              setMenu(null);
              void actions.storeAppInWell(menuApp.id, well.id)
                .catch((error) => setActionError(String(error)));
            }}><span>{well.name}</span><small>{full ? "Full" : `${occupied}/${WELL_CAPACITY[well.kind]}`}</small></button>;
          })}
          {(notificationsByApp.get(menuApp.id)?.length ?? 0) > 0 && <button role="menuitem" onClick={() => {
            const notes = notificationsByApp.get(menuApp.id) ?? [];
            void Promise.all(notes.map((note) => actions.dismissNotification(note.id)))
              .then(() => setMenu(null)).catch((error) => setActionError(String(error)));
          }}>Clear {notificationsByApp.get(menuApp.id)?.length} notification{notificationsByApp.get(menuApp.id)?.length === 1 ? "" : "s"}</button>}
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
