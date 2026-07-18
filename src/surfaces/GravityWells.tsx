import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppTile } from "../components/AppTile";
import { useShell } from "../shell/context";
import "./gravity-wells.css";

type WellKind = "cube" | "pyramid" | "prism" | "hexagon" | "column" | "orb" | "ring" | "slab" | "carousel";
type WellColor = "emerald" | "ocean" | "ice" | "indigo" | "violet" | "rose" | "crimson" | "amber" | "gold" | "copper" | "graphite";

interface WellDefinition {
  id: string;
  name: string;
  kind: WellKind;
  color: WellColor;
  x: number;
  y: number;
  scale: number;
  monitor: number;
  rotation: number;
}

const STORAGE_KEY = "gravity.desktop-wells.v1";
const GRID_STORAGE_KEY = "gravity.desktop-wells.grid.v1";
const KINDS: WellKind[] = ["cube", "pyramid", "prism", "hexagon", "column", "orb", "ring", "slab", "carousel"];
const COLORS: WellColor[] = ["emerald", "ocean", "ice", "indigo", "violet", "rose", "crimson", "amber", "gold", "copper", "graphite"];
const CAPACITY: Record<WellKind, number> = {
  cube: 6, pyramid: 4, prism: 3, hexagon: 6, column: 8,
  orb: 8, ring: 10, slab: 2, carousel: 12,
};
const COLOR: Record<WellColor, string> = {
  emerald: "#42e6a4", ocean: "#49b7ff", ice: "#a9e8ff", indigo: "#7288ff",
  violet: "#b783ff", rose: "#ff87b7", crimson: "#ff626f", amber: "#f4b84b",
  gold: "#f6d365", copper: "#d58a59", graphite: "#9aa0ad",
};

interface WellGrid {
  columns: number;
  rows: number;
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

function defaultWell(monitor = 0, index = 0): WellDefinition {
  return {
    id: `well-${Date.now()}-${index}`,
    name: `Gravity Well ${index + 1}`,
    kind: KINDS[index % KINDS.length],
    color: COLORS[index % COLORS.length],
    x: Math.min(.78, .18 + index * .12),
    y: Math.max(.2, .68 - index * .08),
    scale: 1,
    monitor,
    rotation: 0,
  };
}

function loadWells(): WellDefinition[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as WellDefinition[] | null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // A clean default replaces corrupt or legacy client-only shape data.
  }
  return [defaultWell()];
}

export function GravityWells() {
  const { state, actions } = useShell();
  const monitor = Number(new URLSearchParams(window.location.search).get("monitor") ?? 0);
  const [wells, setWells] = useState(loadWells);
  const [grid, setGrid] = useState<WellGrid | null>(loadGrid);
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hoverWell, setHoverWell] = useState<string | null>(null);
  const suppressRelease = useRef(new Set<string>());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wells));
  }, [wells]);

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
      }))).catch((error) => setMessage(String(error)));
    }, 90);
    return () => window.clearTimeout(timer);
  }, [wells, visible, actions]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    void listen<{ wellId?: string | null }>("gravity://well-hover", (event) => {
      setHoverWell(event.payload.wellId ?? null);
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, []);

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

  const removeWell = async (well: WellDefinition) => {
    try {
      await Promise.all((parked.get(well.id) ?? []).map((window) => actions.releaseWindow(window.id)));
      setWells((current) => current.filter((item) => item.id !== well.id));
      setMenu(null);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const beginMove = (event: ReactPointerEvent<HTMLButtonElement>, well: WellDefinition) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => {
      let x = Math.max(.04, Math.min(.96, next.clientX / Math.max(1, window.innerWidth)));
      let y = Math.max(.08, Math.min(.9, next.clientY / Math.max(1, window.innerHeight)));
      if (grid) {
        x = (Math.round(x * grid.columns - .5) + .5) / grid.columns;
        y = (Math.round(y * grid.rows - .5) + .5) / grid.rows;
      }
      updateWell(well.id, {
        x: Math.max(.04, Math.min(.96, x)),
        y: Math.max(.08, Math.min(.9, y)),
      });
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", finish, { once: true });
  };

  const beginReleaseDrag = (event: ReactPointerEvent<HTMLButtonElement>, windowId: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const move = (next: PointerEvent) => {
      if (!moved && Math.hypot(next.clientX - startX, next.clientY - startY) > 8) {
        moved = true;
        suppressRelease.current.add(windowId);
      }
    };
    const finish = (next: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      if (!moved) return;
      const width = .42;
      const height = .48;
      const x = Math.max(0, Math.min(1 - width, next.clientX / Math.max(1, window.innerWidth) - width / 2));
      const y = Math.max(0, Math.min(1 - height, next.clientY / Math.max(1, window.innerHeight) - height / 2));
      void actions.releaseWindow(windowId)
        .then(() => next.clientY >= window.innerHeight - 170
          ? actions.minimizeWindow(windowId)
          : actions.applyGridRegion(windowId, x, y, width, height))
        .then(() => setMessage(next.clientY >= window.innerHeight - 170 ? "Window released into Orbit." : "Window released onto the desktop."))
        .catch((error) => setMessage(String(error)));
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", finish, { once: true });
  };

  if (!visible) return null;

  return (
    <div className="gravityWells" aria-label="Gravity desktop shapes">
      {wells.filter((well) => well.monitor === monitor).map((well) => {
        const occupants = parked.get(well.id) ?? [];
        const color = COLOR[well.color];
        const style = {
          left: `${well.x * 100}%`,
          top: `${well.y * 100}%`,
          "--well-scale": well.scale,
          "--well-color": color,
        } as CSSProperties;
        return (
          <section
            key={well.id}
            className={`gravityWell gravityWell--${well.kind} ${hoverWell === well.id ? "is-drop-target" : ""}`}
            style={style}
            aria-label={`${well.name}, ${occupants.length} of ${CAPACITY[well.kind]} windows`}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenu({
                id: well.id,
                x: Math.max(12, Math.min(event.clientX, window.innerWidth - 246)),
                y: Math.max(42, Math.min(event.clientY, window.innerHeight - 342)),
              });
            }}
            onWheel={(event) => {
              event.preventDefault();
              updateWell(well.id, { rotation: (well.rotation ?? 0) + Math.sign(event.deltaY) * 18 });
            }}
          >
            <button
              className="gravityWell__body"
              aria-label={`Move ${well.name}`}
              title="Drag to move · right-click for controls"
              onPointerDown={(event) => beginMove(event, well)}
              onDoubleClick={() => void storeActive(well)}
            >
              <span className="gravityWell__shape" style={{ "--well-rotation": `${well.rotation ?? 0}deg` } as CSSProperties} aria-hidden="true"><i /><i /><i /></span>
              <span className="gravityWell__core" aria-hidden="true" />
            </button>
            <span className="gravityWell__name">{well.name}</span>
            <span className="gravityWell__count">{occupants.length}/{CAPACITY[well.kind]}</span>
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
                    onPointerDown={(event) => beginReleaseDrag(event, window.id)}
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

      {menu && (() => {
        const well = wells.find((item) => item.id === menu.id);
        if (!well) return null;
        return (
          <>
            <button className="wellMenuDismiss" aria-label="Close shape menu" onClick={() => setMenu(null)} />
            <div className="wellMenu glass-heavy" role="menu" style={{ left: menu.x, top: menu.y }}>
              <strong>{well.name}</strong>
              <button role="menuitem" disabled={!activeWindow} onClick={() => void storeActive(well)}>Store active window</button>
              <button role="menuitem" disabled={!(parked.get(well.id)?.length)} onClick={() => {
                void Promise.all((parked.get(well.id) ?? []).map((window) => actions.releaseWindow(window.id)))
                  .then(() => setMenu(null)).catch((error) => setMessage(String(error)));
              }}>Release every window</button>
              <label>Shape<select value={well.kind} onChange={(event) => updateWell(well.id, { kind: event.target.value as WellKind })}>
                {KINDS.map((kind) => <option key={kind} value={kind}>{kind} · {CAPACITY[kind]} windows</option>)}
              </select></label>
              <label>Color<select value={well.color} onChange={(event) => updateWell(well.id, { color: event.target.value as WellColor })}>
                {COLORS.map((color) => <option key={color} value={color}>{color}</option>)}
              </select></label>
              <label>Size<input type="range" min="0.7" max="1.5" step="0.05" value={well.scale} onChange={(event) => updateWell(well.id, { scale: Number(event.target.value) })} /></label>
              <span className="wellMenu__sep" />
              <button role="menuitem" onClick={() => setWells((current) => [...current, defaultWell(monitor, current.length)])}>Add another shape</button>
              <button className="is-danger" role="menuitem" onClick={() => void removeWell(well)}>Remove shape</button>
            </div>
          </>
        );
      })()}
      {message && <button className="gravityWells__message glass-heavy" onClick={() => setMessage(null)}>{message}</button>}
    </div>
  );
}
