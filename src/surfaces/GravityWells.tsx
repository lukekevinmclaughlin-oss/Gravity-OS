import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppTile } from "../components/AppTile";
import { useShell } from "../shell/context";
import type { WindowInfo } from "../shell/types";
import {
  scaleWellGroup,
  toggleWellSelection,
  translateWellGroup,
  wellsInMarquee,
} from "../lib/well-selection";
import {
  colorForWell,
  createDefaultWell as defaultWell,
  readDesktopWells as loadWells,
  WELL_CAPACITY as CAPACITY,
  WELL_COLORS as COLORS,
  WELL_GRID_STORAGE_KEY as GRID_STORAGE_KEY,
  WELL_KINDS as KINDS,
  WELL_STORAGE_KEY as STORAGE_KEY,
  writeDesktopWells,
} from "../lib/wells";
import type { WellDefinition } from "../lib/wells";
import "./gravity-wells.css";

interface WellGrid {
  columns: number;
  rows: number;
}

interface WellReleaseVisual {
  windowId: string;
  title: string;
  appId?: string;
  hue: number;
  color: string;
  originX: number;
  originY: number;
  x: number;
  y: number;
  phase: "armed" | "dragging" | "released" | "docked";
}

interface WellMarquee {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

function loadGrid(): WellGrid | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(GRID_STORAGE_KEY) ?? "null") as WellGrid | null;
    if (parsed && [2, 3, 4, 6, 8].includes(parsed.columns) && [2, 3, 4, 5].includes(parsed.rows)) return parsed;
  } catch {
    // Ignore corrupt optional organization data.
  }
  return null;
}

function normalizedWellPosition(x: number, y: number, grid: WellGrid | null) {
  let nextX = Math.max(.04, Math.min(.96, x));
  let nextY = Math.max(.08, Math.min(.9, y));
  if (grid) {
    nextX = (Math.round(nextX * grid.columns - .5) + .5) / grid.columns;
    nextY = (Math.round(nextY * grid.rows - .5) + .5) / grid.rows;
  }
  return {
    x: Math.max(.04, Math.min(.96, nextX)),
    y: Math.max(.08, Math.min(.9, nextY)),
  };
}

export function GravityWells() {
  const { state, actions } = useShell();
  const monitor = Number(new URLSearchParams(window.location.search).get("monitor") ?? 0);
  const [wells, setWells] = useState(loadWells);
  const [grid, setGrid] = useState<WellGrid | null>(loadGrid);
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [settingsWellId, setSettingsWellId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<{ id: string; accepting: boolean } | null>(null);
  const [draggingWellIds, setDraggingWellIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedWellIds, setSelectedWellIds] = useState<ReadonlySet<string>>(new Set());
  const [marqueeMode, setMarqueeMode] = useState(false);
  const [marquee, setMarquee] = useState<WellMarquee | null>(null);
  const [capturedWellId, setCapturedWellId] = useState<string | null>(null);
  const [releaseVisual, setReleaseVisual] = useState<WellReleaseVisual | null>(null);
  const previousOccupancy = useRef<Map<string, number> | null>(null);
  const suppressRelease = useRef(new Set<string>());
  const releaseActive = releaseVisual !== null;
  const draggingActive = draggingWellIds.size > 0;
  const selectionActive = selectedWellIds.size > 0 || marqueeMode || marquee !== null;

  useEffect(() => {
    const timer = window.setTimeout(() => writeDesktopWells(wells), draggingActive ? 140 : 0);
    return () => window.clearTimeout(timer);
  }, [wells, draggingActive]);

  useEffect(() => {
    void actions.setWellSurfaceExpanded(Boolean(menu || settingsWellId || draggingActive || releaseActive || selectionActive)).catch((error) => setMessage(String(error)));
    return () => {
      void actions.setWellSurfaceExpanded(false).catch(() => undefined);
    };
  }, [actions, menu, settingsWellId, draggingActive, releaseActive, selectionActive]);

  useEffect(() => {
    if (grid) localStorage.setItem(GRID_STORAGE_KEY, JSON.stringify(grid));
    else localStorage.removeItem(GRID_STORAGE_KEY);
  }, [grid]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void actions.registerDesktopWells((visible ? wells : []).map((well) => ({
        id: well.id,
        monitor: well.monitor,
        x: well.x,
        y: well.y,
        radius: 78 * well.scale,
        capacity: CAPACITY[well.kind],
        occupied: state.windows.filter((window) => window.parkedWellId === well.id).length,
      }))).catch((error) => setMessage(String(error)));
    }, 90);
    return () => window.clearTimeout(timer);
  }, [wells, visible, actions, state.windows]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3600);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlistenHover: (() => void) | undefined;
    let unlistenCommand: (() => void) | undefined;
    void listen<{ wellId?: string | null; accepting?: boolean }>("gravity://well-hover", (event) => {
      const id = event.payload.wellId ?? null;
      setHoverTarget(id ? { id, accepting: event.payload.accepting !== false } : null);
    }).then((dispose) => { unlistenHover = dispose; });
    void listen<{ command?: string; detail?: WellGrid | { scale?: number } | null }>("gravity://well-command", (event) => {
      const { command, detail } = event.payload;
      if (command === "toggle-shapes" || command === "toggle-wells") setVisible((current) => !current);
      if (command === "add-well") setWells((current) => [...current, defaultWell(monitor, current.length)]);
      if (command === "equalize-shapes" || command === "equalize-wells") {
        const scale = Number((detail as { scale?: number } | null)?.scale ?? 1);
        setWells((current) => current.map((well) => ({ ...well, scale: Number.isFinite(scale) ? Math.max(.7, Math.min(1.5, scale)) : 1 })));
      }
      if (command === "organize-wells") {
        const grid = detail as WellGrid | null;
        if (!grid) setGrid(null);
        else if (grid.columns > 0 && grid.rows > 0) setGrid(grid);
      }
    }).then((dispose) => { unlistenCommand = dispose; });
    return () => {
      unlistenHover?.();
      unlistenCommand?.();
    };
  }, [monitor]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setWells(loadWells());
      if (event.key === GRID_STORAGE_KEY) setGrid(loadGrid());
    };
    const add = () => setWells((current) => [...current, defaultWell(monitor, current.length)]);
    const toggle = () => setVisible((current) => !current);
    const equalize = (event: Event) => {
      const scale = Number((event as CustomEvent<{ scale?: number }>).detail?.scale ?? 1);
      if (!Number.isFinite(scale)) return;
      setWells((current) => current.map((well) => ({ ...well, scale: Math.max(.7, Math.min(1.5, scale)) })));
    };
    const organize = (event: Event) => {
      const detail = (event as CustomEvent<WellGrid | null>).detail;
      if (!detail) return setGrid(null);
      if (detail.columns > 0 && detail.rows > 0) setGrid(detail);
    };
    window.addEventListener("storage", sync);
    window.addEventListener("gravity:add-well", add);
    window.addEventListener("gravity:toggle-wells", toggle);
    window.addEventListener("gravity:equalize-wells", equalize);
    window.addEventListener("gravity:organize-wells", organize);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("gravity:add-well", add);
      window.removeEventListener("gravity:toggle-wells", toggle);
      window.removeEventListener("gravity:equalize-wells", equalize);
      window.removeEventListener("gravity:organize-wells", organize);
    };
  }, [monitor]);

  const parked = useMemo(
    () => new Map(wells.map((well) => [well.id, state.windows.filter((window) => window.parkedWellId === well.id)])),
    [state.windows, wells],
  );

  useEffect(() => {
    const available = new Set(wells.filter((well) => well.monitor === monitor).map((well) => well.id));
    setSelectedWellIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [monitor, wells]);

  useEffect(() => {
    const next = new Map(wells.map((well) => [
      well.id,
      state.windows.filter((window) => window.parkedWellId === well.id).length,
    ]));
    const previous = previousOccupancy.current;
    previousOccupancy.current = next;
    if (!previous) return;
    const captured = wells.find((well) => (next.get(well.id) ?? 0) > (previous.get(well.id) ?? 0));
    if (!captured) return;
    setCapturedWellId(captured.id);
    const timer = window.setTimeout(() => setCapturedWellId((current) => current === captured.id ? null : current), 620);
    return () => window.clearTimeout(timer);
  }, [state.windows, wells]);
  const activeWindow = state.windows.find((window) => window.focused && !window.minimized && !window.parkedWellId)
    ?? state.windows.find((window) => window.orbitId === state.activeOrbit && !window.minimized && !window.parkedWellId);

  const updateWell = (id: string, patch: Partial<WellDefinition>) =>
    setWells((current) => current.map((well) => well.id === id ? { ...well, ...patch } : well));

  const storeActive = async (well: WellDefinition) => {
    const occupants = parked.get(well.id) ?? [];
    if (!activeWindow) return setMessage("Open or focus an application window first.");
    if (occupants.length >= CAPACITY[well.kind]) return setMessage(`${well.name} is full.`);
    try {
      await actions.parkWindow(activeWindow.id, well.id);
      setMessage(`${activeWindow.title} stored in ${well.name}.`);
      setMenu(null);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const removeWells = async (ids: ReadonlySet<string>) => {
    const targets = wells.filter((well) => ids.has(well.id));
    if (!targets.length) return;
    try {
      await Promise.all(targets.flatMap((well) => parked.get(well.id) ?? []).map((window) => actions.releaseWindow(window.id)));
      setWells((current) => current.filter((item) => !ids.has(item.id)));
      setSelectedWellIds((current) => new Set([...current].filter((id) => !ids.has(id))));
      setMenu(null);
      setSettingsWellId((current) => current && ids.has(current) ? null : current);
      setMessage(targets.length === 1
        ? `${targets[0].name} removed. Its windows were safely released.`
        : `${targets.length} selected Gravity Wells removed. Their windows were safely released.`);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const removeWell = (well: WellDefinition) => removeWells(new Set([well.id]));

  const releaseEvery = async (well: WellDefinition, intoOrbit = false) => {
    const occupants = parked.get(well.id) ?? [];
    try {
      for (const window of occupants) {
        await actions.releaseWindow(window.id);
        if (intoOrbit) await actions.minimizeWindow(window.id);
      }
      setMenu(null);
      setMessage(occupants.length
        ? `${occupants.length} window${occupants.length === 1 ? "" : "s"} released ${intoOrbit ? "into Orbit" : "to the desktop"}.`
        : `${well.name} is already empty.`);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const createWell = (openSettings = false) => {
    const next = defaultWell(monitor, wells.length);
    setWells((current) => [...current, next]);
    setMenu(null);
    if (openSettings) setSettingsWellId(next.id);
    setMessage(`${next.name} created.`);
  };

  const beginMove = (event: ReactPointerEvent<HTMLButtonElement>, well: WellDefinition) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      setSelectedWellIds((current) => toggleWellSelection(current, well.id, true));
      return;
    }
    const ids = selectedWellIds.has(well.id) ? new Set(selectedWellIds) : new Set([well.id]);
    setSelectedWellIds(ids);
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = wells;
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const grabOffsetX = event.clientX / viewportWidth - well.x;
    const grabOffsetY = event.clientY / viewportHeight - well.y;
    const startX = event.clientX;
    const startY = event.clientY;
    let lastX = event.clientX;
    let lastY = event.clientY;
    let moved = false;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const targetX = lastX / viewportWidth - grabOffsetX;
      const targetY = lastY / viewportHeight - grabOffsetY;
      setWells(translateWellGroup(base, ids, well.id, targetX, targetY));
    };
    const move = (next: PointerEvent) => {
      lastX = next.clientX;
      lastY = next.clientY;
      if (!moved && Math.hypot(lastX - startX, lastY - startY) > 5) {
        moved = true;
        setDraggingWellIds(ids);
      }
      if (moved && !frame) frame = requestAnimationFrame(paint);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      if (frame) cancelAnimationFrame(frame);
    };
    const finish = (next: PointerEvent) => {
      cleanup();
      if (!moved) {
        setDraggingWellIds(new Set());
        return;
      }
      lastX = next.clientX;
      lastY = next.clientY;
      void actions.isDesktopTrashTarget(lastX, lastY).then(async (overTrash) => {
        if (overTrash) {
          await removeWells(ids);
          return;
        }
        const destination = await actions.desktopPointerLocation(lastX, lastY);
        const position = normalizedWellPosition(
          destination.x - grabOffsetX,
          destination.y - grabOffsetY,
          grid,
        );
        setWells(translateWellGroup(base, ids, well.id, position.x, position.y, destination.monitor));
        if (destination.monitor !== well.monitor) {
          setMessage(`${ids.size === 1 ? well.name : `${ids.size} selected Gravity Wells`} moved to Display ${destination.monitor + 1}.`);
        }
      }).catch((error) => setMessage(String(error))).finally(() => {
        window.setTimeout(() => setDraggingWellIds(new Set()), 180);
      });
    };
    const cancel = () => {
      cleanup();
      if (moved) setWells(base);
      setDraggingWellIds(new Set());
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  };

  const nudgeSelection = (dxPixels: number, dyPixels: number) => {
    const anchorId = [...selectedWellIds][0];
    if (!anchorId) return;
    setWells((current) => {
      const anchor = current.find((well) => well.id === anchorId);
      if (!anchor) return current;
      return translateWellGroup(
        current,
        selectedWellIds,
        anchorId,
        anchor.x + dxPixels / Math.max(1, window.innerWidth),
        anchor.y + dyPixels / Math.max(1, window.innerHeight),
      );
    });
  };

  const resizeSelection = (delta: number) => {
    if (!selectedWellIds.size) return;
    setWells((current) => scaleWellGroup(current, selectedWellIds, delta));
  };

  const beginMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    if (!marqueeMode) {
      setSelectedWellIds(new Set());
      return;
    }
    event.preventDefault();
    const start = new Set(selectedWellIds);
    const startX = event.clientX;
    const startY = event.clientY;
    const additive = event.shiftKey;
    let lastX = startX;
    let lastY = startY;
    let frame = 0;
    setMarquee({ startX, startY, x: startX, y: startY });
    const paint = () => {
      frame = 0;
      setMarquee((current) => current ? { ...current, x: lastX, y: lastY } : current);
    };
    const move = (next: PointerEvent) => {
      lastX = next.clientX;
      lastY = next.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      if (frame) cancelAnimationFrame(frame);
    };
    const finish = (next: PointerEvent) => {
      cleanup();
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      const rect = {
        left: Math.min(startX, next.clientX) / width,
        top: Math.min(startY, next.clientY) / height,
        right: Math.max(startX, next.clientX) / width,
        bottom: Math.max(startY, next.clientY) / height,
      };
      const hit = wellsInMarquee(wells, monitor, rect, width, height);
      const selected = additive ? new Set([...start, ...hit]) : hit;
      setSelectedWellIds(selected);
      setMarquee(null);
      setMarqueeMode(false);
      setMessage(`${selected.size} Gravity Well${selected.size === 1 ? "" : "s"} selected.`);
    };
    const cancel = () => {
      cleanup();
      setMarquee(null);
      setMarqueeMode(false);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  };

  const handleSelectionKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).matches("input, textarea, select")) return;
    const visibleIds = wells.filter((well) => well.monitor === monitor).map((well) => well.id);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelectedWellIds(new Set(visibleIds));
      return;
    }
    if (event.key === "Escape") {
      setSelectedWellIds(new Set());
      setMarqueeMode(false);
      setMarquee(null);
      return;
    }
    if (!selectedWellIds.size) return;
    const step = event.shiftKey ? 24 : 6;
    if (event.key === "ArrowLeft") { event.preventDefault(); nudgeSelection(-step, 0); }
    if (event.key === "ArrowRight") { event.preventDefault(); nudgeSelection(step, 0); }
    if (event.key === "ArrowUp") { event.preventDefault(); nudgeSelection(0, -step); }
    if (event.key === "ArrowDown") { event.preventDefault(); nudgeSelection(0, step); }
    if (event.key === "[") { event.preventDefault(); resizeSelection(-.05); }
    if (event.key === "]") { event.preventDefault(); resizeSelection(.05); }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void removeWells(selectedWellIds);
    }
  };

  const beginReleaseDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    well: WellDefinition,
    storedWindow: WindowInfo,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const windowId = storedWindow.id;
    const startX = event.clientX;
    const startY = event.clientY;
    const faceBounds = event.currentTarget.getBoundingClientRect();
    const app = state.apps.find((item) => item.id === storedWindow.appId);
    setReleaseVisual({
      windowId,
      title: storedWindow.title,
      appId: app?.id,
      hue: app?.hue ?? 222,
      color: colorForWell(well),
      originX: faceBounds.left + faceBounds.width / 2,
      originY: faceBounds.top + faceBounds.height / 2,
      x: startX,
      y: startY,
      phase: "armed",
    });
    let moved = false;
    let frame = 0;
    let lastX = startX;
    let lastY = startY;
    const paint = () => {
      frame = 0;
      setReleaseVisual((current) => current?.windowId === windowId
        ? { ...current, x: lastX, y: lastY, phase: "dragging" }
        : current);
    };
    const move = (next: PointerEvent) => {
      lastX = next.clientX;
      lastY = next.clientY;
      if (!moved && Math.hypot(next.clientX - startX, next.clientY - startY) > 8) {
        moved = true;
        suppressRelease.current.add(windowId);
      }
      if (moved && !frame) frame = requestAnimationFrame(paint);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      if (frame) cancelAnimationFrame(frame);
    };
    const finish = (next: PointerEvent) => {
      cleanup();
      if (!moved) {
        setReleaseVisual((current) => current?.windowId === windowId ? null : current);
        return;
      }
      const width = .42;
      const height = .48;
      void actions.isDesktopTrashTarget(next.clientX, next.clientY).then(async (overTrash) => {
        setReleaseVisual((current) => current?.windowId === windowId
          ? { ...current, x: next.clientX, y: next.clientY, phase: overTrash ? "docked" : "released" }
          : current);
        const destination = overTrash
          ? null
          : await actions.desktopPointerLocation(next.clientX, next.clientY);
        await actions.releaseWindow(windowId);
        if (overTrash) {
          await actions.minimizeWindow(windowId);
          setMessage("Window released into Orbit.");
          return;
        }
        if (!destination) return;
        const x = Math.max(0, Math.min(1 - width, destination.x - width / 2));
        const y = Math.max(0, Math.min(1 - height, destination.y - height / 2));
        await actions.applyGridRegionOnMonitor(
          windowId,
          destination.monitor,
          x,
          y,
          width,
          height,
        );
        setMessage(`Window released onto Display ${destination.monitor + 1}.`);
      }).catch((error) => setMessage(String(error))).finally(() => {
        window.setTimeout(() => setReleaseVisual((current) => current?.windowId === windowId ? null : current), 520);
      });
    };
    const cancel = () => {
      cleanup();
      suppressRelease.current.delete(windowId);
      setReleaseVisual((current) => current?.windowId === windowId ? null : current);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  };

  if (!visible) return null;

  return (
    <div
      className={`gravityWells ${marqueeMode ? "is-marquee-mode" : ""} ${selectionActive ? "has-selection" : ""}`}
      aria-label="Gravity desktop shapes"
      tabIndex={selectionActive ? 0 : -1}
      onPointerDown={beginMarquee}
      onKeyDown={handleSelectionKey}
    >
      {wells.filter((well) => well.monitor === monitor).map((well) => {
        const occupants = parked.get(well.id) ?? [];
        const capacity = CAPACITY[well.kind];
        const full = occupants.length >= capacity;
        const color = colorForWell(well);
        const style = {
          left: `${well.x * 100}%`,
          top: `${well.y * 100}%`,
          "--well-scale": well.scale,
          "--well-color": color,
          "--well-fill": Math.min(1, occupants.length / capacity),
        } as CSSProperties;
        return (
          <section
            key={well.id}
            className={`gravityWell gravityWell--${well.kind} ${draggingWellIds.has(well.id) ? "is-dragging" : ""} ${selectedWellIds.has(well.id) ? "is-selected" : ""} ${capturedWellId === well.id ? "is-capture-complete" : ""} ${full ? "is-full" : ""} ${hoverTarget?.id === well.id ? hoverTarget.accepting ? "is-drop-target" : "is-drop-blocked" : ""}`}
            style={style}
            aria-label={`${well.name}, ${occupants.length} of ${capacity} windows${full ? ", full" : ""}`}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!selectedWellIds.has(well.id)) setSelectedWellIds(new Set([well.id]));
              setMenu({
                id: well.id,
                x: Math.max(12, Math.min(event.clientX, window.innerWidth - 310)),
                y: Math.max(42, Math.min(event.clientY, window.innerHeight - 630)),
              });
            }}
            onWheel={(event) => {
              event.preventDefault();
              const ids = selectedWellIds.has(well.id) ? selectedWellIds : new Set([well.id]);
              if (!selectedWellIds.has(well.id)) setSelectedWellIds(ids);
              if (event.ctrlKey || event.metaKey) {
                setWells((current) => scaleWellGroup(current, ids, -Math.sign(event.deltaY) * .05));
              } else {
                setWells((current) => current.map((item) => ids.has(item.id)
                  ? { ...item, rotation: (item.rotation ?? 0) + Math.sign(event.deltaY) * 18 }
                  : item));
              }
            }}
          >
            <button
              className="gravityWell__body"
              aria-label={`Move ${well.name}`}
              aria-pressed={selectedWellIds.has(well.id)}
              title="Drag to move · right-click for controls"
              onPointerDown={(event) => beginMove(event, well)}
              onDoubleClick={() => void storeActive(well)}
            >
              <span className="gravityWell__shape" style={{ "--well-rotation": `${well.rotation ?? 0}deg` } as CSSProperties} aria-hidden="true"><i /><i /><i /></span>
              <span className="gravityWell__core" aria-hidden="true" />
              <span className="gravityWell__captureFx" aria-hidden="true">
                <span className="gravityWell__lens"><i /><i /><i /></span>
                <span className="gravityWell__particles"><i /><i /><i /><i /><i /><i /><i /><i /></span>
              </span>
            </button>
            <span className="gravityWell__name">{well.name}</span>
            <span className="gravityWell__count" title={full ? "This shape is full" : `${capacity - occupants.length} spaces available`}>
              {full ? "Full" : `${occupants.length}/${capacity}`}
            </span>
            {selectedWellIds.has(well.id) && <span className="gravityWell__selectedMark" aria-hidden="true">✓</span>}
            <div className="gravityWell__faces">
              {occupants.map((window, index) => {
                const app = state.apps.find((item) => item.id === window.appId);
                return (
                  <button
                    key={window.id}
                    className="gravityWell__face"
                    style={{ "--face-index": index } as CSSProperties}
                    aria-label={`Release ${window.title}`}
                    title={`Release ${window.title}`}
                    onPointerDown={(event) => beginReleaseDrag(event, well, window)}
                    onClick={() => {
                      if (suppressRelease.current.delete(window.id)) return;
                      void actions.releaseWindow(window.id)
                        .then(() => setMessage(`${window.title} released to the desktop.`))
                        .catch((error) => setMessage(String(error)));
                    }}
                  >
                    <AppTile name={app?.name ?? window.title} hue={app?.hue ?? 222} size={22} appId={app?.id} />
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {selectedWellIds.size > 0 && (
        <div
          className="wellSelectionBar glass-heavy"
          role="toolbar"
          aria-label={`${selectedWellIds.size} selected Gravity Wells`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="wellSelectionBar__count"><strong>{selectedWellIds.size}</strong><small>selected</small></span>
          <span className="wellSelectionBar__sep" />
          <button className={marqueeMode ? "is-active" : ""} onClick={() => setMarqueeMode((current) => !current)} title="Drag an area to replace the selection">Marquee</button>
          <button onClick={() => setSelectedWellIds(new Set(wells.filter((well) => well.monitor === monitor).map((well) => well.id)))} title="Ctrl+A">Select all</button>
          <button onClick={() => resizeSelection(-.05)} title="Smaller · [">−</button>
          <button onClick={() => resizeSelection(.05)} title="Larger · ]">+</button>
          <button onClick={() => setWells((current) => current.map((well) => selectedWellIds.has(well.id) ? { ...well, scale: 1 } : well))}>Normalize size</button>
          <span className="wellSelectionBar__sep" />
          <button onClick={() => { setSelectedWellIds(new Set()); setMarqueeMode(false); }}>Done</button>
          <button className="is-danger" onClick={() => void removeWells(selectedWellIds)} title="Delete selected shapes and safely release their windows">Delete</button>
        </div>
      )}

      {marquee && (
        <span
          className="wellMarquee"
          aria-hidden="true"
          style={{
            left: Math.min(marquee.startX, marquee.x),
            top: Math.min(marquee.startY, marquee.y),
            width: Math.abs(marquee.x - marquee.startX),
            height: Math.abs(marquee.y - marquee.startY),
          }}
        />
      )}

      {releaseVisual && (() => {
        const dx = releaseVisual.x - releaseVisual.originX;
        const dy = releaseVisual.y - releaseVisual.originY;
        const bend = Math.min(78, Math.hypot(dx, dy) * .18);
        const path = `M ${releaseVisual.originX} ${releaseVisual.originY} C ${releaseVisual.originX + dx * .28} ${releaseVisual.originY - bend}, ${releaseVisual.originX + dx * .72} ${releaseVisual.y + bend}, ${releaseVisual.x} ${releaseVisual.y}`;
        const style = { "--release-color": releaseVisual.color } as CSSProperties;
        return (
          <div className={`wellReleaseFx is-${releaseVisual.phase}`} style={style} aria-hidden="true">
            <svg className="wellReleaseFx__field" width="100%" height="100%">
              <path className="wellReleaseFx__tetherGlow" d={path} />
              <path className="wellReleaseFx__tether" d={path} />
            </svg>
            <span className="wellReleaseFx__origin" style={{ left: releaseVisual.originX, top: releaseVisual.originY }} />
            <span className="wellReleaseFx__ghost" style={{ left: releaseVisual.x, top: releaseVisual.y }}>
              <span className="wellReleaseFx__ghostTile">
                <AppTile name={releaseVisual.title} hue={releaseVisual.hue} appId={releaseVisual.appId} fill />
              </span>
              <span className="wellReleaseFx__ghostLabel">{releaseVisual.title}</span>
            </span>
            <span className="wellReleaseFx__burst" style={{ left: releaseVisual.x, top: releaseVisual.y }}>
              <i /><i /><i /><i /><i /><i /><i /><i />
            </span>
          </div>
        );
      })()}

      {menu && (() => {
        const well = wells.find((item) => item.id === menu.id);
        if (!well) return null;
        return (
          <>
            <button className="wellMenuDismiss" aria-label="Close shape menu" onClick={() => setMenu(null)} />
            <div className="wellMenu glass-heavy" role="menu" style={{ left: menu.x, top: menu.y }}>
              <div className="wellMenu__header">
                <span className="wellMenu__glyph" style={{ "--menu-well-color": colorForWell(well) } as CSSProperties}><i /></span>
                <span><strong>{well.name}</strong><small>{parked.get(well.id)?.length ?? 0} of {CAPACITY[well.kind]} windows</small></span>
              </div>
              <button role="menuitem" onClick={() => {
                setSelectedWellIds((current) => toggleWellSelection(current, well.id, true));
                setMenu(null);
              }}><span>{selectedWellIds.has(well.id) ? "Remove from selection" : "Add to selection"}</span><small>Shift-click</small></button>
              <button role="menuitem" onClick={() => {
                setSelectedWellIds(new Set(wells.filter((item) => item.monitor === monitor).map((item) => item.id)));
                setMenu(null);
              }}><span>Select all Gravity Wells</span><small>Ctrl+A</small></button>
              {selectedWellIds.size > 1 && (
                <>
                  <button role="menuitem" onClick={() => { resizeSelection(.05); setMenu(null); }}><span>Enlarge selected group</span><small>]</small></button>
                  <button role="menuitem" onClick={() => { resizeSelection(-.05); setMenu(null); }}><span>Reduce selected group</span><small>[</small></button>
                  <button role="menuitem" className="is-danger" onClick={() => void removeWells(selectedWellIds)}><span>Remove selected group</span><small>Delete</small></button>
                </>
              )}
              <span className="wellMenu__sep" />
              <button role="menuitem" disabled={!activeWindow} onClick={() => void storeActive(well)}><span>Store active window</span><small>Double-click</small></button>
              <button role="menuitem" disabled={!(parked.get(well.id)?.length)} onClick={() => void releaseEvery(well)}><span>Release all to desktop</span><small>{parked.get(well.id)?.length ?? 0}</small></button>
              <button role="menuitem" disabled={!(parked.get(well.id)?.length)} onClick={() => void releaseEvery(well, true)}><span>Release all into Orbit</span></button>
              {(parked.get(well.id) ?? []).map((window) => (
                <button className="wellMenu__window" role="menuitem" key={window.id} onClick={() => {
                  void actions.releaseWindow(window.id).then(() => setMessage(`${window.title} released.`)).catch((error) => setMessage(String(error)));
                }}><span>{window.title}</span><small>Release</small></button>
              ))}
              <span className="wellMenu__sep" />
              <details className="wellMenu__picker">
                <summary><span>Shape</span><b>{well.kind} · {CAPACITY[well.kind]} windows</b></summary>
                <div className="wellMenu__kindGrid">
                  {KINDS.map((kind) => <button key={kind} className={well.kind === kind ? "is-selected" : ""} onClick={() => updateWell(well.id, { kind })}><i className={`is-${kind}`} /><span>{kind}</span><small>{CAPACITY[kind]}</small></button>)}
                </div>
              </details>
              <details className="wellMenu__picker">
                <summary><span>Color</span><b>{well.color}</b></summary>
                <div className="wellMenu__colorGrid">
                  {COLORS.filter((color) => color !== "custom").map((color) => <button key={color} className={well.color === color ? "is-selected" : ""} style={{ "--swatch": colorForWell({ color }) } as CSSProperties} aria-label={color} title={color} onClick={() => updateWell(well.id, { color })} />)}
                  <label className={well.color === "custom" ? "is-selected" : ""} title="Custom color"><input type="color" value={well.customColor ?? "#42e6a4"} onChange={(event) => updateWell(well.id, { color: "custom", customColor: event.target.value })} /><span style={{ "--swatch": well.customColor ?? "#42e6a4" } as CSSProperties}>+</span></label>
                </div>
              </details>
              {well.color === "custom" && <label>Custom<input type="color" value={well.customColor ?? "#42e6a4"} onChange={(event) => updateWell(well.id, { customColor: event.target.value })} /></label>}
              <label>Size<input type="range" min="0.7" max="1.5" step="0.05" value={well.scale} onChange={(event) => updateWell(well.id, { scale: Number(event.target.value) })} /></label>
              <span className="wellMenu__sep" />
              <button className="wellMenu__settings" role="menuitem" onClick={() => { setMenu(null); setSettingsWellId(well.id); }}><span>Gravity Well Settings…</span><small>Full controls</small></button>
              <button role="menuitem" onClick={() => createWell(true)}>Create new Gravity Well</button>
              <button className="is-danger" role="menuitem" onClick={() => void removeWell(well)}>Remove Gravity Well</button>
            </div>
          </>
        );
      })()}
      {settingsWellId && (() => {
        const well = wells.find((item) => item.id === settingsWellId);
        if (!well) return null;
        const occupants = parked.get(well.id) ?? [];
        return (
          <>
            <button className="wellSettingsScrim" aria-label="Close Gravity Well settings" onClick={() => setSettingsWellId(null)} />
            <aside className="wellSettings glass-heavy" role="dialog" aria-modal="true" aria-label={`${well.name} settings`}>
              <header className="wellSettings__header">
                <span className={`wellSettings__preview is-${well.kind}`} style={{ "--well-color": colorForWell(well) } as CSSProperties}><i /><b /></span>
                <span><small>GRAVITY WELL</small><input aria-label="Gravity Well name" value={well.name} maxLength={64} onChange={(event) => updateWell(well.id, { name: event.target.value })} /><em>{occupants.length}/{CAPACITY[well.kind]} windows · Display {well.monitor + 1}</em></span>
                <button onClick={() => setSettingsWellId(null)} aria-label="Close settings">×</button>
              </header>

              <div className="wellSettings__actions">
                <button disabled={!activeWindow || occupants.length >= CAPACITY[well.kind]} onClick={() => void storeActive(well)}><strong>Store active</strong><small>{activeWindow?.title ?? "No active window"}</small></button>
                <button disabled={!occupants.length} onClick={() => void releaseEvery(well)}><strong>Release all</strong><small>Return to desktop</small></button>
                <button disabled={!occupants.length} onClick={() => void releaseEvery(well, true)}><strong>Send to Orbit</strong><small>Minimize safely</small></button>
                <button onClick={() => createWell(true)}><strong>New Well</strong><small>Create another</small></button>
              </div>

              <section className="wellSettings__section">
                <div className="wellSettings__sectionTitle"><strong>Stored windows</strong><span>{occupants.length ? "Drag a face out, or use the controls below" : "Drop any application window onto this Well"}</span></div>
                <div className="wellSettings__windows">
                  {occupants.map((window) => {
                    const app = state.apps.find((item) => item.id === window.appId);
                    return <article key={window.id}>
                      <AppTile name={app?.name ?? window.title} hue={app?.hue ?? 222} size={34} appId={app?.id} />
                      <span><strong>{window.title}</strong><small>{app?.name ?? window.appId}</small></span>
                      <button onClick={() => void actions.releaseWindow(window.id).then(() => actions.focusWindow(window.id)).catch((error) => setMessage(String(error)))}>Open</button>
                      <button onClick={() => void actions.releaseWindow(window.id).then(() => actions.minimizeWindow(window.id)).catch((error) => setMessage(String(error)))}>Orbit</button>
                    </article>;
                  })}
                  {!occupants.length && <div className="wellSettings__empty"><b>0</b><span>This Well is ready to hold {CAPACITY[well.kind]} application windows.</span></div>}
                </div>
              </section>

              <section className="wellSettings__section">
                <div className="wellSettings__sectionTitle"><strong>Geometry</strong><span>Shape controls storage capacity</span></div>
                <div className="wellSettings__kinds">
                  {KINDS.map((kind) => <button key={kind} className={well.kind === kind ? "is-selected" : ""} onClick={() => updateWell(well.id, { kind })}><i className={`is-${kind}`} /><span>{kind}</span><small>{CAPACITY[kind]}</small></button>)}
                </div>
              </section>

              <section className="wellSettings__section wellSettings__appearance">
                <div className="wellSettings__sectionTitle"><strong>Appearance & motion</strong><span>Original Gravity materials</span></div>
                <div className="wellSettings__swatches">
                  {COLORS.filter((color) => color !== "custom").map((color) => <button key={color} className={well.color === color ? "is-selected" : ""} style={{ "--swatch": colorForWell({ color }) } as CSSProperties} aria-label={color} onClick={() => updateWell(well.id, { color })} />)}
                  <label className={well.color === "custom" ? "is-selected" : ""} title="Custom color"><input type="color" value={well.customColor ?? "#42e6a4"} onChange={(event) => updateWell(well.id, { color: "custom", customColor: event.target.value })} /><span style={{ "--swatch": well.customColor ?? "#42e6a4" } as CSSProperties}>+</span></label>
                </div>
                <label><span>Size <b>{Math.round(well.scale * 100)}%</b></span><input type="range" min="0.7" max="1.5" step="0.05" value={well.scale} onChange={(event) => updateWell(well.id, { scale: Number(event.target.value) })} /></label>
                <label><span>Rotation <b>{Math.round(well.rotation)}°</b></span><input type="range" min="0" max="360" step="6" value={well.rotation} onChange={(event) => updateWell(well.id, { rotation: Number(event.target.value) })} /></label>
              </section>

              <footer className="wellSettings__footer"><button onClick={() => createWell(true)}>Create new Gravity Well</button><button className="is-danger" onClick={() => void removeWell(well)}>Release contents and remove</button></footer>
            </aside>
          </>
        );
      })()}
      {message && <button className="gravityWells__message glass-heavy" onClick={() => setMessage(null)}>{message}</button>}
    </div>
  );
}
