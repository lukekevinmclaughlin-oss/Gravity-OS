import { useEffect, useRef, useState } from "react";
import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { GridIcon, SunIcon, TrashIcon } from "../components/Icons";
import { isAppRunning, windowsOf } from "../shell/types";
import { reorderPinnedIds } from "../lib/dock";
import { fitOrbitWindow, growOrbitWindow, openOverlay } from "../lib/win";
import "./orbit.css";

/** Orbit — Gravity's dock, with true magnification (spec §4):
 *  tiles grow toward 2.0× under the cursor with a Gaussian falloff and track
 *  the cursor 1:1 — no smoothing while the pointer moves; springs only on
 *  shelf enter/leave. Width-based growth lets the shelf widen naturally. */

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
  const pinnedIds = state.apps.filter((app) => app.pinned).map((app) => app.id);

  useEffect(() => {
    void fitOrbitWindow(items.length);
  }, [items.length]);

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

  const onAppClick = async (appId: string) => {
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
    actions.focusWindow(target.id);
  };

  const openAppMenu = (event: React.MouseEvent, appId: string) => {
    event.preventDefault();
    const shelf = event.currentTarget.closest(".orbit")?.getBoundingClientRect();
    const relative = shelf ? event.clientX - shelf.left : event.clientX;
    setMenu({ appId, left: Math.max(116, Math.min(relative, (shelf?.width ?? 420) - 116)) });
  };

  const reorder = async (targetId: string) => {
    if (!draggedId) return;
    const next = reorderPinnedIds(pinnedIds, draggedId, targetId);
    setDraggedId(null);
    if (next !== pinnedIds) await actions.reorderPinnedApps(next);
  };

  const menuApp = menu ? state.apps.find((app) => app.id === menu.appId) : undefined;
  const menuWindows = menuApp ? windowsOf(state, menuApp.id) : [];
  const setPinned = async (pinned: boolean) => {
    if (!menuApp) return;
    await actions.setAppPinned(menuApp.id, pinned);
    setMenu(null);
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
      {menu && <button className="orbitContextDismiss" aria-label="Close app menu" onClick={() => setMenu(null)} />}
      {items.map((app) => {
        const running = isAppRunning(state, app.id);
        return (
          <button
            key={app.id}
            className={`orbitItem ${launchErrors.has(app.id) ? "is-error" : ""}`}
            style={{ width: BASE }}
            aria-label={app.name}
            ref={(el) => {
              if (el) tileRefs.current.set(app.id, el);
              else tileRefs.current.delete(app.id);
            }}
            onClick={() => void onAppClick(app.id)}
            title={launchErrors.get(app.id)}
            draggable={app.pinned}
            onDragStart={() => setDraggedId(app.id)}
            onDragEnd={() => setDraggedId(null)}
            onDragOver={(event) => {
              if (app.pinned && draggedId) event.preventDefault();
            }}
            onDrop={() => void reorder(app.id)}
            onContextMenu={(event) => openAppMenu(event, app.id)}
          >
            <span className="orbitItem__label glass-heavy">{app.name}</span>
            <span className={`orbitItem__tileWrap ${launching.has(app.id) ? "is-launching" : ""}`}>
              <AppTile name={app.name} hue={app.hue} appId={app.id} fill />
            </span>
            <span className={`orbitItem__dot ${running ? "is-running" : ""}`} />
          </button>
        );
      })}

      <span className="sr-only" role="status" aria-live="polite">
        {launchErrors.size ? [...launchErrors.values()][launchErrors.size - 1] : ""}
      </span>

      <span className="orbit__sep" />

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
          if (el) tileRefs.current.set("__win11", el);
          else tileRefs.current.delete("__win11");
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
            actions.emptyTrash();
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
          <button role="menuitem" onClick={() => { setMenu(null); void onAppClick(menuApp.id); }}>
            {menuWindows.length ? "Show" : "Open"}
          </button>
          <button role="menuitem" onClick={() => { setMenu(null); void actions.launchApp(menuApp.id); }}>
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
                menuWindows.forEach((item) => actions.closeWindow(item.id));
                setMenu(null);
              }}
            >
              Quit
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
