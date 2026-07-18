import { useEffect, useMemo, useRef, useState } from "react";
import { AppTile } from "../components/AppTile";
import { SearchIcon } from "../components/Icons";
import { useDesktopWells, WELL_CAPACITY } from "../lib/wells";
import { useShell } from "../shell/context";
import { isTauri } from "../shell/tauri";
import "./app-library.css";

export interface AppLibraryProps {
  open: boolean;
  onClose: () => void;
}

export function AppLibrary({ open, onClose }: AppLibraryProps) {
  const { state, actions } = useShell();
  const wells = useDesktopWells();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ appId: string; x: number; y: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(null);
    setMenu(null);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const stops: Array<() => void> = [];
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const stopDrag = await listen<{ error: string | null }>("gravity://dock-app-drag-ended", ({ payload }) => {
        if (payload.error) setError(payload.error);
      });
      const stopStore = await listen<{ error: string | null }>("gravity://well-store-result", ({ payload }) => {
        if (payload.error) setError(payload.error);
      });
      if (disposed) { stopDrag(); stopStore(); } else stops.push(stopDrag, stopStore);
    });
    return () => { disposed = true; stops.forEach((stop) => stop()); };
  }, []);

  const apps = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return [...state.apps]
      .filter((app) => !needle || app.name.toLocaleLowerCase().includes(needle))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
  }, [query, state.apps]);

  if (!open) return null;

  const launch = (appId: string) => {
    setBusy(appId);
    setError(null);
    void actions.launchApp(appId)
      .then(onClose)
      .catch((reason) => setError(String(reason)))
      .finally(() => setBusy(null));
  };

  const togglePinned = (appId: string, pinned: boolean) => {
    setBusy(`pin-${appId}`);
    setError(null);
    void actions.setAppPinned(appId, pinned)
      .catch((reason) => setError(String(reason)))
      .finally(() => setBusy(null));
  };

  return (
    <div className="appLibrary" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="appLibrary__panel glass-heavy" aria-label="Application Library">
        <div className="appLibrary__top">
          <span className="appLibrary__heading"><small>GRAVITY OS</small><h1>Applications</h1><em>{apps.length} installed</em></span>
          <div className="appLibrary__search">
            <SearchIcon size={17} />
            <input
              ref={input}
              value={query}
              aria-label="Search installed applications"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && onClose()}
              placeholder="Search applications"
            />
            {query && <button onClick={() => setQuery("")} aria-label="Clear search">×</button>}
            <kbd>Esc</kbd>
          </div>
          <button className="appLibrary__close" onClick={onClose}>Done</button>
        </div>

        <div className="appLibrary__grid">
          {apps.map((app, index) => (
            <article
              key={app.id}
              style={{ "--library-index": index } as React.CSSProperties}
              className={busy === app.id || busy === `pin-${app.id}` ? "is-busy" : ""}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ appId: app.id, x: Math.min(event.clientX, window.innerWidth - 270), y: Math.min(event.clientY, window.innerHeight - 330) });
              }}
            >
              <button
                className="appLibrary__launch"
                onClick={() => launch(app.id)}
                disabled={busy !== null}
                onPointerDown={(event) => {
                  if (isTauri() && event.button === 0) void actions.beginDockAppDrag(app.id).catch((reason) => setError(String(reason)));
                }}
              >
                <span className="appLibrary__tile"><AppTile name={app.name} hue={app.hue} appId={app.id} fill /></span>
                <span>{app.name}</span>
                <small>{state.windows.some((window) => window.appId === app.id) ? "Running" : app.pinned ? "In Orbit" : "Application"}</small>
              </button>
              <button
                className={`appLibrary__pin ${app.pinned ? "is-pinned" : ""}`}
                aria-label={app.pinned ? `Remove ${app.name} from Orbit` : `Keep ${app.name} in Orbit`}
                title={app.pinned ? "Remove from Orbit" : "Keep in Orbit"}
                onClick={() => togglePinned(app.id, !app.pinned)}
                disabled={busy !== null}
              >{app.pinned ? "●" : "+"}</button>
            </article>
          ))}
          {apps.length === 0 && <div className="appLibrary__empty">No installed application matches “{query}”.</div>}
        </div>
      </section>

      {menu && (() => {
        const app = state.apps.find((candidate) => candidate.id === menu.appId);
        if (!app) return null;
        return <>
          <button className="appLibraryMenuDismiss" aria-label="Close application menu" onClick={() => setMenu(null)} />
          <div className="appLibraryMenu glass-heavy" role="menu" style={{ left: menu.x, top: menu.y }}>
            <div className="appLibraryMenu__header"><AppTile name={app.name} hue={app.hue} appId={app.id} size={34} /><span><strong>{app.name}</strong><small>{state.windows.filter((window) => window.appId === app.id).length} open windows</small></span></div>
            <button role="menuitem" onClick={() => { setMenu(null); launch(app.id); }}>Open new window</button>
            <button role="menuitem" onClick={() => { setMenu(null); togglePinned(app.id, !app.pinned); }}>{app.pinned ? "Remove from Orbit" : "Keep in Orbit"}</button>
            <div className="appLibraryMenu__heading">Add to Gravity Well</div>
            {wells.map((well) => {
              const occupied = state.windows.filter((window) => window.parkedWellId === well.id).length;
              const full = occupied >= WELL_CAPACITY[well.kind];
              return <button key={well.id} role="menuitem" disabled={full} onClick={() => {
                setMenu(null);
                void actions.storeAppInWell(app.id, well.id).catch((reason) => setError(String(reason)));
              }}><span>{well.name}</span><small>{full ? "Full" : `${occupied}/${WELL_CAPACITY[well.kind]}`}</small></button>;
            })}
            {!wells.length && <span className="appLibraryMenu__empty">Create a Gravity Well from the desktop first.</span>}
          </div>
        </>;
      })()}
      {error && <button className="appLibrary__error glass-heavy" onClick={() => setError(null)} role="alert">{error}</button>}
    </div>
  );
}
