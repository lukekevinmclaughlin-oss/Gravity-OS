import { useEffect, useMemo, useRef, useState } from "react";
import { AppTile } from "../components/AppTile";
import { SearchIcon } from "../components/Icons";
import { useShell } from "../shell/context";
import "./app-library.css";

export interface AppLibraryProps {
  open: boolean;
  onClose: () => void;
}

export function AppLibrary({ open, onClose }: AppLibraryProps) {
  const { state, actions } = useShell();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(null);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

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

  return (
    <div className="appLibrary" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="appLibrary__top">
        <h1>Applications</h1>
        <label className="appLibrary__search glass-heavy">
          <SearchIcon size={16} />
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && onClose()}
            placeholder="Search installed applications"
          />
          {query && <button onClick={() => setQuery("")} aria-label="Clear search">×</button>}
        </label>
        <button className="appLibrary__close glass" onClick={onClose}>Done</button>
      </div>

      <div className="appLibrary__grid">
        {apps.map((app) => (
          <article key={app.id} className={busy === app.id ? "is-busy" : ""}>
            <button className="appLibrary__launch" onClick={() => launch(app.id)} disabled={busy !== null}>
              <span className="appLibrary__tile"><AppTile name={app.name} hue={app.hue} appId={app.id} fill /></span>
              <span>{app.name}</span>
            </button>
            <button
              className={`appLibrary__pin ${app.pinned ? "is-pinned" : ""}`}
              aria-label={app.pinned ? `Remove ${app.name} from Orbit` : `Keep ${app.name} in Orbit`}
              title={app.pinned ? "Remove from Orbit" : "Keep in Orbit"}
              onClick={() => void actions.setAppPinned(app.id, !app.pinned)}
            >
              {app.pinned ? "●" : "+"}
            </button>
          </article>
        ))}
        {apps.length === 0 && <div className="appLibrary__empty">No installed application matches “{query}”.</div>}
      </div>
      {error && <button className="appLibrary__error glass-heavy" onClick={() => setError(null)} role="alert">{error}</button>}
    </div>
  );
}
