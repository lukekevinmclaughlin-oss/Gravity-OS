import { useEffect, useState } from "react";
import { useShell } from "../shell/context";
import {
  BatteryIcon,
  ConstellationIcon,
  GravityMark,
  MoonIcon,
  SearchIcon,
  VolumeIcon,
  WifiIcon,
} from "../components/Icons";
import "./horizon.css";

/** Horizon — Gravity's take on the global menu bar: two floating glass pills
 *  instead of a full-width strip. App menus left, status cluster right. */

export interface HorizonProps {
  onOpenCore?: () => void;
  onOpenConstellation?: () => void;
  onOpenSingularity?: () => void;
  onToggleTheme?: () => void;
}

interface MenuItem {
  label: string;
  hint?: string;
  disabled?: boolean;
  action?: () => void;
}
type MenuEntry = MenuItem | "sep";

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  const date = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

export function Horizon({ onOpenCore, onOpenConstellation, onOpenSingularity, onToggleTheme }: HorizonProps) {
  const { state, actions } = useShell();
  const [open, setOpen] = useState<string | null>(null);
  const clock = useClock();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const focusedWin = state.windows.find((w) => w.focused && !w.minimized);
  const focusedApp = focusedWin ? state.apps.find((a) => a.id === focusedWin.appId) : undefined;
  const appName = focusedApp?.name ?? "Deep Field";

  const run = (fn?: () => void) => () => {
    setOpen(null);
    fn?.();
  };

  const menus: Array<{ title: string; entries: MenuEntry[] }> = [
    {
      title: "File",
      entries: [
        { label: "New Window", hint: "⌘N", action: focusedApp ? () => actions.launchApp(focusedApp.id) : undefined, disabled: !focusedApp },
        { label: "Close Window", hint: "⌘W", action: focusedWin ? () => actions.closeWindow(focusedWin.id) : undefined, disabled: !focusedWin },
      ],
    },
    {
      title: "Edit",
      entries: [
        { label: "Undo", hint: "⌘Z", disabled: true },
        { label: "Redo", hint: "⇧⌘Z", disabled: true },
        "sep",
        { label: "Cut", hint: "⌘X", disabled: true },
        { label: "Copy", hint: "⌘C", disabled: true },
        { label: "Paste", hint: "⌘V", disabled: true },
      ],
    },
    {
      title: "View",
      entries: [
        { label: "Enter Constellation", hint: "F3", action: onOpenConstellation },
        { label: "Toggle Daybreak", action: onToggleTheme },
      ],
    },
    {
      title: "Window",
      entries: [
        { label: "Minimize", hint: "⌘M", action: focusedWin ? () => actions.minimizeWindow(focusedWin.id) : undefined, disabled: !focusedWin },
        "sep",
        ...state.windows.map<MenuEntry>((w) => ({
          label: w.title.length > 34 ? w.title.slice(0, 33) + "…" : w.title,
          action: () => actions.focusWindow(w.id),
        })),
      ],
    },
    {
      title: "Help",
      entries: [{ label: "Gravity OS Help", disabled: true }],
    },
  ];

  const gravityMenu: MenuEntry[] = [
    { label: "About Gravity OS", disabled: true },
    "sep",
    { label: "Settings…", action: () => actions.launchApp("settings") },
    { label: "Empty Trash", action: actions.emptyTrash, disabled: !state.status.trashFull },
    "sep",
    { label: "Restart Shell", disabled: true },
    { label: "Exit Gravity", disabled: true },
  ];

  const renderMenu = (entries: MenuEntry[]) => (
    <div className="hzMenu glass-heavy lens" role="menu">
      {entries.map((entry, i) =>
        entry === "sep" ? (
          <div className="hzMenu__sep" key={`s${i}`} />
        ) : (
          <button
            key={entry.label + i}
            className="hzMenu__item"
            disabled={entry.disabled || !entry.action}
            onClick={run(entry.action)}
          >
            <span>{entry.label}</span>
            {entry.hint && <span className="hzMenu__hint">{entry.hint}</span>}
          </button>
        )
      )}
    </div>
  );

  const battery = state.status.batteryPercent;

  return (
    <div className="horizon">
      {open && <div className="horizon__scrim" onClick={() => setOpen(null)} />}

      <div className="horizon__pill glass lens">
        <span className="horizon__anchor">
          <button
            className={`horizon__gravity ${open === "gravity" ? "is-open" : ""}`}
            onClick={() => setOpen(open === "gravity" ? null : "gravity")}
            title="Gravity"
          >
            <GravityMark size={17} />
          </button>
          {open === "gravity" && renderMenu(gravityMenu)}
        </span>
        <span className="horizon__app">{appName}</span>
        {menus.map((m) => (
          <span className="horizon__anchor" key={m.title}>
            <button
              className={`horizon__menuBtn ${open === m.title ? "is-open" : ""}`}
              onClick={() => setOpen(open === m.title ? null : m.title)}
              onMouseEnter={() => open && open !== "gravity" && setOpen(m.title)}
            >
              {m.title}
            </button>
            {open === m.title && renderMenu(m.entries)}
          </span>
        ))}
      </div>

      <div className="horizon__pill glass lens horizon__statusPill">
        <button title="Singularity search" onClick={onOpenSingularity}>
          <SearchIcon size={14} />
        </button>
        <button title="Constellation" onClick={onOpenConstellation}>
          <ConstellationIcon size={15} />
        </button>
        <button
          title="Focus"
          className={state.status.focus ? "is-on" : ""}
          onClick={() => actions.toggleSetting("focus")}
        >
          <MoonIcon size={14.5} />
        </button>
        <button
          title={state.status.network ?? "Offline"}
          className={state.status.online ? "" : "is-off"}
          onClick={() => actions.toggleSetting("wifi")}
        >
          <WifiIcon size={15} />
        </button>
        {battery !== null && (
          <button className="horizon__batt" onClick={onOpenCore} title="Battery">
            <BatteryIcon size={17} level={battery / 100} charging={state.status.charging} />
            <span>{battery}%</span>
          </button>
        )}
        <button onClick={onOpenCore} title="Core">
          <VolumeIcon size={15} level={state.status.volume} />
        </button>
        <button className="horizon__clock" onClick={onOpenCore}>
          {clock}
        </button>
      </div>
    </div>
  );
}
