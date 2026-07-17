import { useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { ConstellationIcon, MoonIcon, SearchIcon, SunIcon, TrashIcon } from "../components/Icons";
import { evaluate, formatNumber, looksLikeMath, rank } from "../lib/search";
import { isAppRunning } from "../shell/types";
import "./singularity.css";

/** Singularity — the command palette. Summoning it pulls the whole desktop
 *  slightly toward it (the Stage applies the lensing scale). */

export interface SingularityProps {
  open: boolean;
  onClose: () => void;
  onOpenConstellation?: () => void;
  onToggleTheme?: () => void;
}

interface Result {
  id: string;
  kind: "app" | "action" | "calc";
  title: string;
  sub?: string;
  hue?: number;
  icon?: React.ReactNode;
  run: () => void;
}

export function Singularity({ open, onClose, onOpenConstellation, onToggleTheme }: SingularityProps) {
  const { state, actions } = useShell();
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      // Focus after the entrance animation has begun.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const out: Result[] = [];

    if (looksLikeMath(query)) {
      const value = evaluate(query);
      if (value !== null) {
        out.push({
          id: "calc",
          kind: "calc",
          title: formatNumber(value),
          sub: query.trim(),
          run: () => onClose(),
        });
      }
    }

    const apps = rank(query, state.apps, (a) => a.name, (a) =>
      (isAppRunning(state, a.id) ? 4 : 0) + (a.pinned ? 2 : 0)
    );
    for (const app of apps.slice(0, query ? 5 : 6)) {
      out.push({
        id: `app-${app.id}`,
        kind: "app",
        title: app.name,
        sub: isAppRunning(state, app.id) ? "Running" : "Application",
        hue: app.hue,
        run: () => {
          actions.launchApp(app.id);
          onClose();
        },
      });
    }

    const allActions: Array<Omit<Result, "run"> & { run: () => void }> = [
      {
        id: "act-const",
        kind: "action",
        title: "Enter Constellation",
        sub: "Overview of every window",
        icon: <ConstellationIcon size={17} />,
        run: () => {
          onClose();
          onOpenConstellation?.();
        },
      },
      {
        id: "act-focus",
        kind: "action",
        title: state.status.focus ? "Disable Focus" : "Enable Focus",
        sub: "Silence Pulse notifications",
        icon: <MoonIcon size={17} />,
        run: () => {
          actions.toggleSetting("focus");
          onClose();
        },
      },
      {
        id: "act-theme",
        kind: "action",
        title: "Toggle Daybreak",
        sub: "Switch between dark and light",
        icon: <SunIcon size={17} />,
        run: () => {
          onToggleTheme?.();
          onClose();
        },
      },
      {
        id: "act-trash",
        kind: "action",
        title: "Empty Trash",
        sub: state.status.trashFull ? "Trash contains items" : "Already empty",
        icon: <TrashIcon size={17} />,
        run: () => {
          actions.emptyTrash();
          onClose();
        },
      },
    ];
    const actionResults = query
      ? rank(query, allActions, (a) => a.title)
      : [];
    out.push(...actionResults.slice(0, 4));

    return out;
  }, [query, state, actions, onClose, onOpenConstellation, onToggleTheme]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      results[sel]?.run();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="sing" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sing__panel glass-heavy lens">
        <div className="sing__inputRow">
          <SearchIcon size={19} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search apps, run actions, calculate…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
        </div>
        {results.length > 0 && (
          <div className="sing__results">
            {results.map((r, i) => (
              <button
                key={r.id}
                className={`sing__item ${i === sel ? "is-sel" : ""} ${r.kind === "calc" ? "is-calc" : ""}`}
                onMouseEnter={() => setSel(i)}
                onClick={r.run}
              >
                {r.kind === "app" && <AppTile name={r.title} hue={r.hue!} size={30} />}
                {r.kind === "action" && <span className="sing__actIcon">{r.icon}</span>}
                {r.kind === "calc" ? (
                  <>
                    <span className="sing__calcExpr">{r.sub} =</span>
                    <span className="sing__calcVal">{r.title}</span>
                  </>
                ) : (
                  <>
                    <span className="sing__title">{r.title}</span>
                    <span className="sing__sub">{r.sub}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="sing__foot">
          <span>
            <span className="keycap">↑↓</span> navigate
          </span>
          <span>
            <span className="keycap">↵</span> open
          </span>
          <span>
            <span className="keycap">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}
