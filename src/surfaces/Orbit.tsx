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

/** Orbit — Gravity's dock. While the pointer rides the shelf, tile widths are
 *  a pure same-frame function of cursor X (zero smoothing — the Dock law); a
 *  single damped spring ramps the whole field in and out on shelf enter/exit. */

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
  const [trashMenu, setTrashMenu] = useState<number | null>(null);
  const [windowDropTarget, setWindowDropTarget] = useState(false);
  const [dockCapture, setDockCapture] = useState(false);
  const [dockRelease, setDockRelease] = useState(false);
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
  const presence = useRef({ value: 0, velocity: 0 });
  const lastPointerX = useRef<number | null>(null);
  const layoutPositions = useRef(new Map<string, DOMRect>());
  const previousMinimized = useRef<Set<string> | null>(null);
  const dockReleaseTimer = useRef<number | null>(null);
  const orbitExpanded = menu !== null || trashMenu !== null || draggedWindowId !== null || windowDropTarget || dockCapture || dockRelease;
  const flashDockRelease = () => {
    if (dockReleaseTimer.current !== null) window.clearTimeout(dockReleaseTimer.current);
    setDockRelease(false);
    requestAnimationFrame(() => setDockRelease(true));
    dockReleaseTimer.current = window.setTimeout(() => {
      setDockRelease(false);
      dockReleaseTimer.current = null;
    }, 820);
  };

  useEffect(() => {
    void growOrbitWindow(orbitExpanded);
    return () => {
      if (orbitExpanded) void growOrbitWindow(false);
    };
  }, [orbitExpanded]);

  useEffect(() => {
    if (!menu && trashMenu === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
        setTrashMenu(null);
        setTrashArmed(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, trashMenu]);

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
    const next = new Set(state.windows.filter((window) => window.minimized).map((window) => window.id));
    const previous = previousMinimized.current;
    previousMinimized.current = next;
    if (!previous || ![...next].some((id) => !previous.has(id))) return;
    setDockCapture(true);
    const timer = window.setTimeout(() => setDockCapture(false), 620);
    return () => window.clearTimeout(timer);
  }, [state.windows]);

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
    if (dockReleaseTimer.current !== null) window.clearTimeout(dockReleaseTimer.current);
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
          else if (payload.moved) flashDockRelease();
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

    // The magnification field is 1:1 with the cursor; only the field's overall
    // presence is spring-ramped, so entering/leaving the shelf feels physical
    // while in-shelf tracking has zero lag.
    const target = pointerX.current === null ? 0 : 1;
    const ramp = presence.current;
    if (reducedMotion.current) {
      ramp.value = target;
      ramp.velocity = 0;
    } else {
      const returning = target === 0;
      const profile = personalization.dock.motion === "gentle"
        ? { stiffness: returning ? 220 : 285, damping: returning ? 31 : 33 }
        : personalization.dock.motion === "expressive"
          ? { stiffness: returning ? 370 : 540, damping: returning ? 34 : 38 }
          : { stiffness: returning ? 300 : 430, damping: returning ? 34 : 37 };
      const acceleration = profile.stiffness * (target - ramp.value) - profile.damping * ramp.velocity;
      ramp.velocity += acceleration * deltaTime;
      ramp.value += ramp.velocity * deltaTime;
    }
    const settled = Math.abs(target - ramp.value) < 0.004 && Math.abs(ramp.velocity) < 0.02;
    if (settled) {
      ramp.value = target;
      ramp.velocity = 0;
      if (target === 0) lastPointerX.current = null;
    }
    const shapeX = pointerX.current ?? lastPointerX.current;
    const strength = Math.max(0, Math.min(1, ramp.value));

    // Batch all layout reads before writes so one growing tile cannot shift
    // the center used to calculate its neighbours in the same frame.
    const entries = [...tileRefs.current.entries()]
      .filter(([, element]) => element.isConnected)
      .map(([, element]) => ({ element, rect: element.getBoundingClientRect() }));
    for (const { element, rect } of entries) {
      const magnified = shapeX === null
        ? BASE
        : BASE * magnify(rect.left + rect.width / 2 - shapeX, MAX_SCALE, SIGMA);
      const width = BASE + (magnified - BASE) * strength;
      element.style.width = `${width.toFixed(3)}px`;
      element.style.setProperty("--orbit-energy", `${Math.max(0, (width - BASE) / BASE).toFixed(3)}`);
    }

    // While the pointer rests inside a settled field, widths are already exact;
    // the next pointer move schedules the next frame.
    if (!settled) animationFrame.current = requestAnimationFrame(animateMagnify);
    else previousFrame.current = null;
  };

  const applyMagnify = (mouseX: number | null) => {
    pointerX.current = mouseX;
    if (mouseX !== null) lastPointerX.current = mouseX;
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

  const updateWindowDrag = (clientX: number, clientY: number) => {
    const drag = windowDrag.current;
    if (!drag) return;
    if (!drag.moved && Math.hypot(clientX - drag.startX, clientY - drag.startY) > 6) {
      drag.moved = true;
      setDraggedWindowId(drag.id);
      applyMagnify(null);
    }
  };

  const completeWindowDrag = (clientX: number, clientY: number) => {
    const drag = windowDrag.current;
    if (!drag) return;
    windowDrag.current = null;
    setDraggedWindowId(null);
    if (!drag.moved) return;
    suppressWindowClick.current = drag.id;
    flashDockRelease();
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
    const move = (next: PointerEvent) => updateWindowDrag(next.clientX, next.clientY);
    const finish = (next: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      completeWindowDrag(next.clientX, next.clientY);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  const moveWindowDrag = (event: React.PointerEvent<HTMLButtonElement>) =>
    updateWindowDrag(event.clientX, event.clientY);

  const finishWindowDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    completeWindowDrag(event.clientX, event.clientY);
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
      className={`orbit glass is-material-${personalization.dock.material} is-motion-${personalization.dock.motion} ${personalization.dock.showLabels ? "" : "hide-labels"} ${personalization.dock.showIndicators ? "" : "hide-indicators"} ${personalization.dock.showBadges ? "" : "hide-badges"} ${live ? "is-live" : ""} ${windowDropTarget ? "is-window-drop-target" : ""} ${dockCapture ? "is-window-captured" : ""}`}
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
      {(menu || trashMenu !== null) && (
        <button
          className="orbitContextDismiss"
          aria-label="Close menu"
          onClick={() => {
            setMenu(null);
            setTrashMenu(null);
            setTrashArmed(false);
          }}
        />
      )}
      <span className="orbitCaptureFx" aria-hidden="true">
        <span className="orbitCaptureFx__portal"><i /><i /><i /></span>
        <span className="orbitCaptureFx__beam" />
        <span className="orbitCaptureFx__particles"><i /><i /><i /><i /><i /><i /><i /><i /></span>
      </span>
      {dockRelease && (
        <span className="orbitReleaseFx" aria-hidden="true">
          <span className="orbitReleaseFx__launchRing"><i /><i /></span>
          <span className="orbitReleaseFx__wake" />
          <span className="orbitReleaseFx__sparks"><i /><i /><i /><i /><i /><i /><i /><i /></span>
        </span>
      )}
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
            <span className="orbitWindow__escapeFx" aria-hidden="true">
              <span className="orbitWindow__tether" />
              <span className="orbitWindow__escapeParticles"><i /><i /><i /><i /><i /><i /></span>
            </span>
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
          // Desktop grammar: clicking the Trash opens it; emptying lives in the
          // context menu behind a confirm step.
          setTrashMenu(null);
          setTrashArmed(false);
          void actions.openTrash().catch((error) => setActionError(String(error)));
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          const shelf = event.currentTarget.closest(".orbit")?.getBoundingClientRect();
          const relative = shelf ? event.clientX - shelf.left : event.clientX;
          setMenu(null);
          setTrashArmed(false);
          setTrashMenu(Math.max(116, Math.min(relative, (shelf?.width ?? 420) - 116)));
        }}
        aria-haspopup="menu"
        title={state.status.trashFull ? "Trash — click to open" : "Trash is empty — click to open"}
      >
        <span className="orbitItem__label glass-heavy">Trash</span>
        <span className={`orbit__trashTile ${trashArmed ? "is-armed" : ""}`}>
          <TrashIcon size={21} />
          {state.status.trashFull && <span className="orbit__trashDot" />}
        </span>
        <span className="orbitItem__dot" />
      </button>

      {trashMenu !== null && (
        <div
          className="orbitContext glass-heavy"
          role="menu"
          aria-label="Trash actions"
          style={{ left: trashMenu }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="orbitContext__title">Trash</div>
          <button
            role="menuitem"
            onClick={() => {
              setTrashMenu(null);
              void actions.openTrash().catch((error) => setActionError(String(error)));
            }}
          >
            <span>Open Trash</span>
            <small>{state.status.trashFull ? "Contains items" : "Empty"}</small>
          </button>
          <button
            role="menuitem"
            disabled={!state.status.trashFull}
            className={trashArmed ? "is-danger-armed" : ""}
            onClick={() => {
              if (!trashArmed) {
                setTrashArmed(true);
                window.setTimeout(() => setTrashArmed(false), 4000);
                return;
              }
              setTrashArmed(false);
              setTrashMenu(null);
              void actions.emptyTrash().catch((error) => setActionError(String(error)));
            }}
          >
            <span>{trashArmed ? "Confirm Empty Trash" : "Empty Trash…"}</span>
            {trashArmed && <small>Click again</small>}
          </button>
        </div>
      )}

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
