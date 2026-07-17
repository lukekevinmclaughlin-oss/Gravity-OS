import { useEffect, useRef, useState } from "react";
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
import { growHorizonWindow } from "../lib/win";
import "./horizon.css";

/** Horizon — a single full-width menu bar (spec §3).
 *  macOS grammar: menus open on mouse-down, appear instantly, and slide-track
 *  while one is open; the Gravity menu performs real session actions. */

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
  danger?: boolean;
  action?: () => void;
}
type MenuEntry = MenuItem | "sep";

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  const date = now
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .replace(",", "");
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${date} ${time}`;
}

export function Horizon({ onOpenCore, onOpenConstellation, onOpenSingularity, onToggleTheme }: HorizonProps) {
  const { state, actions } = useShell();
  const [open, setOpen] = useState<string | null>(null);
  const [confirmPower, setConfirmPower] = useState<"restart" | "shutdown" | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const clock = useClock();

  // Menus drop below the 30px strip — grow the Tauri window while open.
  useEffect(() => {
    void growHorizonWindow(open !== null || confirmPower !== null);
  }, [open, confirmPower]);

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
  const appName = focusedApp?.name ?? "Gravity";
  const appWindows = focusedApp ? state.windows.filter((w) => w.appId === focusedApp.id) : [];

  const run = (fn?: () => void) => () => {
    setOpen(null);
    fn?.();
  };

  const gravityMenu: MenuEntry[] = [
    { label: "About Gravity OS", disabled: true },
    "sep",
    { label: "Settings…", action: () => actions.launchApp("settings") },
    { label: "Empty Trash", action: actions.emptyTrash, disabled: !state.status.trashFull },
    "sep",
    { label: "Sleep", action: () => actions.powerAction("sleep") },
    { label: "Restart…", action: () => setConfirmPower("restart") },
    { label: "Shut Down…", action: () => setConfirmPower("shutdown") },
    "sep",
    { label: "Lock Screen", hint: "⊞L", action: () => actions.powerAction("lock") },
  ];

  const menus: Array<{ title: string; entries: MenuEntry[] }> = [
    {
      title: appName,
      entries: [
        {
          label: `Hide ${appName}`,
          disabled: appWindows.length === 0,
          action: () => appWindows.forEach((w) => actions.minimizeWindow(w.id)),
        },
        {
          label: `Quit ${appName}`,
          disabled: appWindows.length === 0,
          danger: true,
          action: () => appWindows.forEach((w) => actions.closeWindow(w.id)),
        },
      ],
    },
    {
      title: "File",
      entries: [
        { label: "New Window", action: focusedApp ? () => actions.launchApp(focusedApp.id) : undefined, disabled: !focusedApp },
        { label: "Close Window", hint: "Ctrl W", action: focusedWin ? () => actions.closeWindow(focusedWin.id) : undefined, disabled: !focusedWin },
      ],
    },
    {
      title: "Edit",
      entries: [
        { label: "Undo", hint: "Ctrl Z", action: () => actions.editAction("undo"), disabled: !focusedWin },
        { label: "Redo", hint: "Ctrl Y", action: () => actions.editAction("redo"), disabled: !focusedWin },
        "sep",
        { label: "Cut", hint: "Ctrl X", action: () => actions.editAction("cut"), disabled: !focusedWin },
        { label: "Copy", hint: "Ctrl C", action: () => actions.editAction("copy"), disabled: !focusedWin },
        { label: "Paste", hint: "Ctrl V", action: () => actions.editAction("paste"), disabled: !focusedWin },
        "sep",
        { label: "Select All", hint: "Ctrl A", action: () => actions.editAction("select-all"), disabled: !focusedWin },
      ],
    },
    {
      title: "Window",
      entries: [
        { label: "Minimize", action: focusedWin ? () => actions.minimizeWindow(focusedWin.id) : undefined, disabled: !focusedWin },
        { label: "Constellation", hint: "F3", action: onOpenConstellation },
        { label: "Toggle Daybreak", action: onToggleTheme },
        ...(state.windows.length ? ["sep" as const] : []),
        ...state.windows.map<MenuEntry>((w) => ({
          label: w.title.length > 34 ? w.title.slice(0, 33) + "…" : w.title,
          action: () => actions.focusWindow(w.id),
        })),
      ],
    },
  ];

  const renderMenu = (entries: MenuEntry[], alignRight = false) => (
    <div className={`hzMenu glass-heavy ${alignRight ? "hzMenu--right" : ""}`} role="menu">
      {entries.map((entry, i) =>
        entry === "sep" ? (
          <div className="hzMenu__sep" key={`s${i}`} />
        ) : (
          <button
            key={entry.label + i}
            className={`hzMenu__item ${entry.danger ? "is-danger" : ""}`}
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

  // Mouse-down open + slide-track (spec §3): press opens; while any menu is
  // open, entering an adjacent title switches without another press.
  const titleProps = (key: string) => ({
    onMouseDown: (e: React.MouseEvent) => {
      e.preventDefault();
      setOpen(openRef.current === key ? null : key);
    },
    onMouseEnter: () => {
      if (openRef.current && openRef.current !== key) setOpen(key);
    },
  });

  const battery = state.status.batteryPercent;

  return (
    <div className="horizon">
      {(open || confirmPower) && (
        <div
          className="horizon__scrim"
          onMouseDown={() => {
            setOpen(null);
            setConfirmPower(null);
          }}
        />
      )}

      <div className="horizon__bar glass">
        <span className="horizon__anchor">
          <button
            className={`horizon__gravity ${open === "gravity" ? "is-open" : ""}`}
            {...titleProps("gravity")}
            title="Gravity"
          >
            <GravityMark size={16} />
          </button>
          {open === "gravity" && renderMenu(gravityMenu)}
        </span>

        <span className="horizon__anchor">
          <button className={`horizon__menuBtn horizon__app ${open === menus[0].title ? "is-open" : ""}`} {...titleProps(menus[0].title)}>
            {appName}
          </button>
          {open === menus[0].title && renderMenu(menus[0].entries)}
        </span>
        {menus.slice(1).map((m) => (
          <span className="horizon__anchor" key={m.title}>
            <button className={`horizon__menuBtn ${open === m.title ? "is-open" : ""}`} {...titleProps(m.title)}>
              {m.title}
            </button>
            {open === m.title && renderMenu(m.entries)}
          </span>
        ))}

        <span className="horizon__spacer" />

        <button
          title="Focus"
          className={`horizon__status ${state.status.focus ? "is-on" : ""}`}
          onClick={() => actions.toggleSetting("focus")}
        >
          <MoonIcon size={14.5} />
        </button>
        <button
          title={state.status.network ?? "Offline"}
          className={`horizon__status ${state.status.online ? "" : "is-off"}`}
          onClick={() => actions.toggleSetting("wifi")}
        >
          <WifiIcon size={15} />
        </button>
        {battery !== null && (
          <button className="horizon__status horizon__batt" onClick={onOpenCore} title="Battery">
            <BatteryIcon size={17} level={battery / 100} charging={state.status.charging} />
            <span>{battery}%</span>
          </button>
        )}
        <button className="horizon__status" onClick={onOpenSingularity} title="Search">
          <SearchIcon size={14} />
        </button>
        <button className="horizon__status" onClick={onOpenConstellation} title="Constellation">
          <ConstellationIcon size={15} />
        </button>
        <button className="horizon__status" onClick={onOpenCore} title="Core">
          <VolumeIcon size={15} level={state.status.volume} />
        </button>
        <button className="horizon__clock" onClick={onOpenCore}>
          {clock}
        </button>
      </div>

      {confirmPower && (
        <div className="hzConfirm glass-heavy">
          <p>
            {confirmPower === "restart"
              ? "Restart this PC now?"
              : "Shut down this PC now?"}
          </p>
          <div className="hzConfirm__row">
            <button className="hzConfirm__cancel" onClick={() => setConfirmPower(null)}>
              Cancel
            </button>
            <button
              className="hzConfirm__go"
              onClick={() => {
                const kind = confirmPower;
                setConfirmPower(null);
                actions.powerAction(kind);
              }}
            >
              {confirmPower === "restart" ? "Restart" : "Shut Down"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
