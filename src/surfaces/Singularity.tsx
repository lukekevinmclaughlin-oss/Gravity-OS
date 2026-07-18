import { useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { ConstellationIcon, MoonIcon, SearchIcon, SunIcon, TrashIcon } from "../components/Icons";
import { evaluate, formatNumber, looksLikeMath, rank } from "../lib/search";
import { commandResults } from "../lib/actions";
import { isAppRunning } from "../shell/types";
import "./singularity.css";

/** Singularity — the command palette. Summoning it pulls the whole desktop
 *  slightly toward it (the Stage applies the lensing scale). */

export interface SingularityProps {
  open: boolean;
  onClose: () => void;
  onOpenConstellation?: () => void;
  onToggleTheme?: () => void | Promise<void>;
}

interface Result {
  id: string;
  kind: "app" | "action" | "calc" | "setting";
  title: string;
  sub?: string;
  hue?: number;
  appId?: string;
  icon?: React.ReactNode;
  run: () => void | Promise<void>;
}

/** Curated ms-settings deep links (spec §5). Opened via the Rust core,
 *  which whitelists the ms-settings: scheme. */
const SETTINGS_LINKS: Array<{ title: string; uri: string }> = [
  { title: "Wi-Fi Settings", uri: "ms-settings:network-wifi" },
  { title: "Bluetooth Settings", uri: "ms-settings:bluetooth" },
  { title: "Display Settings", uri: "ms-settings:display" },
  { title: "Night Light", uri: "ms-settings:nightlight" },
  { title: "Sound Settings", uri: "ms-settings:sound" },
  { title: "Notifications Settings", uri: "ms-settings:notifications" },
  { title: "Battery & Power", uri: "ms-settings:powersleep" },
  { title: "Storage Settings", uri: "ms-settings:storagesense" },
  { title: "Personalization", uri: "ms-settings:personalization" },
  { title: "Default Apps", uri: "ms-settings:defaultapps" },
  { title: "Windows Update", uri: "ms-settings:windowsupdate" },
  { title: "About This PC", uri: "ms-settings:about" },
];

export function Singularity({ open, onClose, onOpenConstellation, onToggleTheme }: SingularityProps) {
  const { state, actions } = useShell();
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const targetWindowRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (open) {
      targetWindowRef.current = state.windows.find((window) => window.focused && !window.minimized)?.id;
      setQuery("");
      setSel(0);
      setError(null);
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
          sub: `${query.trim()} · copy result`,
          run: async () => {
            await navigator.clipboard.writeText(formatNumber(value));
            onClose();
          },
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
        appId: app.id,
        run: async () => {
          await actions.launchApp(app.id);
          onClose();
        },
      });
    }

    const allActions: Array<Omit<Result, "run"> & { run: Result["run"] }> = [
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
        run: async () => {
          await actions.toggleSetting("focus");
          onClose();
        },
      },
      {
        id: "act-theme",
        kind: "action",
        title: "Toggle Daybreak",
        sub: "Switch between dark and light",
        icon: <SunIcon size={17} />,
        run: async () => {
          await onToggleTheme?.();
          onClose();
        },
      },
      {
        id: "act-window-left",
        kind: "action",
        title: "Window: Left Half",
        sub: "Cycle between half, two-thirds, and one-third",
        icon: <ConstellationIcon size={17} />,
        run: async () => {
          const target = targetWindowRef.current;
          if (!target) throw new Error("Open an application window first.");
          await actions.windowActionFor(target, "left-half");
          onClose();
        },
      },
      {
        id: "act-window-right",
        kind: "action",
        title: "Window: Right Half",
        sub: "Cycle between half, two-thirds, and one-third",
        icon: <ConstellationIcon size={17} />,
        run: async () => {
          const target = targetWindowRef.current;
          if (!target) throw new Error("Open an application window first.");
          await actions.windowActionFor(target, "right-half");
          onClose();
        },
      },
      {
        id: "act-window-arrange",
        kind: "action",
        title: "Arrange Windows on This Display",
        sub: "Create a balanced, gap-aware grid",
        icon: <ConstellationIcon size={17} />,
        run: async () => {
          const target = targetWindowRef.current;
          if (!target) throw new Error("Open an application window first.");
          await actions.windowActionFor(target, "arrange-display");
          onClose();
        },
      },
      {
        id: "act-window-gather",
        kind: "action",
        title: "Gather All Windows Here",
        sub: "Bring every window to the active display",
        icon: <ConstellationIcon size={17} />,
        run: async () => {
          const target = targetWindowRef.current;
          if (!target) throw new Error("Open an application window first.");
          await actions.windowActionFor(target, "gather-all");
          onClose();
        },
      },
      {
        id: "act-trash",
        kind: "action",
        title: "Empty Trash",
        sub: state.status.trashFull ? "Trash contains items" : "Already empty",
        icon: <TrashIcon size={17} />,
        run: async () => {
          await actions.emptyTrash();
          onClose();
        },
      },
    ];
    const actionResults = query
      ? rank(query, allActions, (a) => a.title)
      : [];
    out.push(...actionResults.slice(0, 4));

    // Command registry (NS-6.2): verb phrases with typed parameters —
    // `accent coral`, `volume 40`, `snap left-half`, `scene <name>`.
    // A run() that resolves to a string completes the query instead of closing.
    for (const command of commandResults(query, {
      state,
      actions,
      targetWindowId: targetWindowRef.current,
      toggleTheme: onToggleTheme,
      openConstellation: onOpenConstellation,
    }).slice(0, 6)) {
      out.push({
        id: `cmd-${command.id}`,
        kind: "action",
        title: command.title,
        sub: command.sub,
        icon: <SearchIcon size={17} />,
        run: async () => {
          const next = await command.run();
          if (typeof next === "string") {
            setQuery(next);
            requestAnimationFrame(() => inputRef.current?.focus());
            return;
          }
          onClose();
        },
      });
    }

    if (query) {
      const settings = rank(query, SETTINGS_LINKS, (s) => s.title);
      for (const s of settings.slice(0, 3)) {
        out.push({
          id: `set-${s.uri}`,
          kind: "setting",
          title: s.title,
          sub: "System Settings",
          icon: <SunIcon size={17} />,
          run: async () => {
            await actions.openSetting(s.uri);
            onClose();
          },
        });
      }
    }

    return out;
  }, [query, state, actions, onClose, onOpenConstellation, onToggleTheme]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;

  const runResult = (result?: Result) => {
    if (!result) return;
    setError(null);
    void Promise.resolve(result.run()).catch((reason) => setError(String(reason)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      runResult(results[sel]);
    } else if (e.key === "Escape") {
      // Two-stage escape (spec §5): first clears the query, second closes.
      // Stop propagation so outer Escape handlers don't force a close.
      e.stopPropagation();
      if (query) setQuery("");
      else onClose();
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
                onClick={() => runResult(r)}
              >
                {r.kind === "app" && (
                  <AppTile name={r.title} hue={r.hue!} size={30} appId={r.appId} />
                )}
                {(r.kind === "action" || r.kind === "setting") && (
                  <span className="sing__actIcon">{r.icon}</span>
                )}
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
        {error && <button className="sing__error" role="alert" onClick={() => setError(null)}>{error}</button>}
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
