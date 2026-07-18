import { useEffect, useRef, useState } from "react";
import { useShell } from "../shell/context";
import {
  BatteryIcon,
  ConstellationIcon,
  GravityMark,
  MoonIcon,
  SearchIcon,
  SunIcon,
  VolumeIcon,
  WifiIcon,
  WindowsIcon,
} from "../components/Icons";
import { growHorizonWindow } from "../lib/win";
import { useDesktopWells, WELL_CAPACITY } from "../lib/wells";
import type { WindowAction } from "../shell/types";
import { formatShortcut } from "../lib/shortcuts";
import "./horizon.css";

export interface HorizonProps {
  onOpenCore?: () => void;
  onOpenConstellation?: () => void;
  onOpenSingularity?: () => void;
  onToggleTheme?: () => void | Promise<void>;
  onOpenWindowStudio?: () => void;
  onOpenAbout?: () => void;
}

interface MenuItem {
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  announce?: boolean;
  action?: () => void | Promise<unknown>;
}
type MenuEntry = MenuItem | "sep";

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const date = now
    .toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    .replace(",", "");
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date}  ${time}`;
}

export function Horizon({
  onOpenCore,
  onOpenConstellation,
  onOpenSingularity,
  onToggleTheme,
  onOpenWindowStudio,
  onOpenAbout,
}: HorizonProps) {
  const { state, actions } = useShell();
  const wells = useDesktopWells();
  const [open, setOpen] = useState<string | null>(null);
  const [windowPalette, setWindowPalette] = useState(false);
  const [confirmPower, setConfirmPower] = useState<"restart" | "shutdown" | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [shellBusy, setShellBusy] = useState(false);
  const openRef = useRef(open);
  const targetRef = useRef<(typeof state.windows)[number] | undefined>(undefined);
  const paletteTimer = useRef<number | null>(null);
  const dragSelect = useRef(false);
  const pressHandled = useRef<string | null>(null);
  openRef.current = open;
  const clock = useClock();

  const notify = (kind: "success" | "error", text: string, duration = 2800) => {
    setMessage({ kind, text });
    window.setTimeout(() => setMessage((current) => current?.text === text ? null : current), duration);
  };

  // Resize to the rendered popup only. The former monitor-height transparent
  // window was able to swallow clicks from every application beneath it.
  useEffect(() => {
    if (!open && !confirmPower && !windowPalette) {
      void growHorizonWindow(false);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const popup = document.querySelector<HTMLElement>(".hzMenu, .hzConfirm, .hzWindowPalette");
      // The closed native window is only 34px tall, so getBoundingClientRect
      // reports the viewport-clipped menu and creates a 34 -> 55px feedback
      // loop. scrollHeight preserves the full menu content even while clipped.
      const needed = popup
        ? Math.max(420, Math.ceil(popup.offsetTop + popup.scrollHeight + 10))
        : 420;
      void growHorizonWindow(true, needed);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, confirmPower, windowPalette]);

  useEffect(() => {
    if (!open && !confirmPower && !windowPalette) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(null);
        setConfirmPower(null);
        setWindowPalette(false);
        return;
      }
      if (!open) return;
      const items = [...document.querySelectorAll<HTMLButtonElement>(".hzMenu__item:not(:disabled)")];
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        items[(current + delta + items.length) % items.length].focus();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        items[event.key === "Home" ? 0 : items.length - 1].focus();
      } else if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1) {
        const needle = event.key.toLocaleLowerCase();
        const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
        const match = ordered.find((item) => item.innerText.trim().toLocaleLowerCase().startsWith(needle));
        if (match) {
          event.preventDefault();
          match.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, confirmPower, windowPalette]);

  useEffect(() => {
    const onBlur = () => {
      setOpen(null);
      setConfirmPower(null);
      setWindowPalette(false);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  // Drag-select: a press that began on a menu title commits whatever item the
  // pointer releases over, exactly like a native menu bar. Releasing back on a
  // title keeps the menu open; releasing anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onUp = (event: PointerEvent) => {
      if (event.button !== 0 || !dragSelect.current) return;
      dragSelect.current = false;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const title = element?.closest<HTMLElement>("[data-hz-menu-key]");
      if (title?.dataset.hzMenuKey !== pressHandled.current) pressHandled.current = null;
      const item = element?.closest<HTMLButtonElement>(".hzMenu__item");
      if (item && !item.disabled) {
        item.click();
        return;
      }
      if (!title && !element?.closest(".hzMenu")) setOpen(null);
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(".hzMenu__item:not(:disabled)")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const liveFocusedWin =
    state.windows.find(
      (window) =>
        window.orbitId === state.activeOrbit && window.focused && !window.minimized
    ) ??
    state.windows.find(
      (window) => window.orbitId === state.activeOrbit && !window.minimized
    );
  const activeWin = open || windowPalette ? targetRef.current ?? liveFocusedWin : liveFocusedWin;
  const activeApp = activeWin ? state.apps.find((app) => app.id === activeWin.appId) : undefined;
  const appName = activeApp?.name ?? "Gravity";
  const appWindows = activeApp ? state.windows.filter((window) => window.appId === activeApp.id) : [];

  const execute = async (label: string, action: () => void | Promise<unknown>, announce = true) => {
    try {
      await action();
      if (announce) notify("success", `${label} completed`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error), 5000);
      throw error;
    }
  };

  const invokeEntry = (entry: MenuItem) => async () => {
    setOpen(null);
    if (!entry.action) return;
    try {
      await execute(entry.label.replace("…", ""), entry.action, entry.announce !== false);
    } catch {
      // execute presents the actionable error in Horizon.
    }
  };

  const manage = (action: WindowAction) => async () => {
    if (!activeWin) throw new Error("Select an application window first.");
    await actions.windowActionFor(activeWin.id, action);
  };

  const shortcutHint = (action: string) => {
    const binding = state.windowing.shortcuts?.[action];
    return binding ? formatShortcut(binding) : undefined;
  };

  const switchToWindows = async () => {
    if (shellBusy) return;
    setShellBusy(true);
    try {
      await actions.setShellActive(false);
    } finally {
      setShellBusy(false);
    }
  };

  const runWindowControl = (kind: "close" | "minimize" | "zoom") => {
    const target = targetRef.current ?? liveFocusedWin;
    if (!target) return;
    const label = kind === "close" ? "Close Window" : kind === "minimize" ? "Minimize" : target.maximized ? "Restore" : "Fill";
    void execute(label, () => actions.activeWindowControl(kind), false).catch(() => undefined);
  };

  const clearPaletteTimer = () => {
    if (paletteTimer.current !== null) {
      window.clearTimeout(paletteTimer.current);
      paletteTimer.current = null;
    }
  };

  const showWindowPaletteSoon = () => {
    clearPaletteTimer();
    if (!targetRef.current) targetRef.current = liveFocusedWin;
    paletteTimer.current = window.setTimeout(() => {
      setOpen(null);
      setWindowPalette(Boolean(targetRef.current));
    }, 420);
  };

  const hideWindowPaletteSoon = () => {
    clearPaletteTimer();
    paletteTimer.current = window.setTimeout(() => setWindowPalette(false), 180);
  };

  const gravityMenu: MenuEntry[] = [
    { label: "About Gravity OS", action: onOpenAbout, announce: false },
    "sep",
    { label: "Settings…", action: () => actions.launchApp("settings"), announce: false },
    { label: "Empty Trash", action: actions.emptyTrash, disabled: !state.status.trashFull },
    "sep",
    { label: "Sleep", action: () => actions.powerAction("sleep"), announce: false },
    { label: "Restart…", action: () => setConfirmPower("restart"), announce: false },
    { label: "Shut Down…", action: () => setConfirmPower("shutdown"), announce: false },
    "sep",
    { label: "Lock Screen", hint: "⊞ L", action: () => actions.powerAction("lock"), announce: false },
    "sep",
    { label: "Switch to Windows 11", hint: "Ctrl Alt G", action: switchToWindows, announce: false },
    { label: "Quit Gravity OS", danger: true, action: actions.quitShell, announce: false },
  ];

  const menus: Array<{ title: string; entries: MenuEntry[] }> = [
    {
      title: appName,
      entries: [
        {
          label: `Hide ${appName}`,
          disabled: appWindows.length === 0,
          action: () => Promise.all(appWindows.map((window) => actions.minimizeWindow(window.id))),
        },
        {
          label: `Quit ${appName}`,
          disabled: appWindows.length === 0,
          danger: true,
          action: () => Promise.all(appWindows.map((window) => actions.closeWindow(window.id))),
        },
      ],
    },
    {
      title: "File",
      entries: [
        { label: "New Window", action: activeApp ? () => actions.launchApp(activeApp.id) : undefined, disabled: !activeApp },
        { label: "Close Window", hint: "Ctrl W", action: activeWin ? () => actions.closeWindow(activeWin.id) : undefined, disabled: !activeWin },
      ],
    },
    {
      title: "Edit",
      entries: [
        { label: "Undo", hint: "Ctrl Z", action: () => actions.editAction("undo", activeWin?.id), disabled: !activeWin },
        { label: "Redo", hint: "Ctrl Y", action: () => actions.editAction("redo", activeWin?.id), disabled: !activeWin },
        "sep",
        { label: "Cut", hint: "Ctrl X", action: () => actions.editAction("cut", activeWin?.id), disabled: !activeWin },
        { label: "Copy", hint: "Ctrl C", action: () => actions.editAction("copy", activeWin?.id), disabled: !activeWin },
        { label: "Paste", hint: "Ctrl V", action: () => actions.editAction("paste", activeWin?.id), disabled: !activeWin },
        "sep",
        { label: "Select All", hint: "Ctrl A", action: () => actions.editAction("select-all", activeWin?.id), disabled: !activeWin },
      ],
    },
    {
      title: "Window",
      entries: [
        { label: "Window Studio…", hint: shortcutHint("open-window-studio"), action: onOpenWindowStudio, announce: false },
        "sep",
        { label: "Minimize", hint: shortcutHint("minimize-active"), action: activeWin ? () => actions.minimizeWindow(activeWin.id) : undefined, disabled: !activeWin },
        ...wells.map<MenuEntry>((well, index) => {
          const occupied = state.windows.filter((window) => window.parkedWellId === well.id).length;
          const full = occupied >= WELL_CAPACITY[well.kind];
          return {
            label: `Add to ${well.name}`,
            hint: full ? "Full" : shortcutHint(`store-well-${index + 1}`) ?? `${occupied}/${WELL_CAPACITY[well.kind]}`,
            action: activeWin && !full ? () => actions.parkWindow(activeWin.id, well.id) : undefined,
            disabled: !activeWin || full,
          };
        }),
        ...(wells.length ? ["sep" as const] : []),
        { label: "Undo Gravity Move", hint: shortcutHint("undo"), action: activeWin ? manage("undo") : undefined, disabled: !activeWin },
        { label: "Restore Original Size", hint: shortcutHint("restore"), action: activeWin ? manage("restore") : undefined, disabled: !activeWin },
        "sep",
        { label: "Move to Left Half", hint: shortcutHint("left-half"), action: activeWin ? manage("left-half") : undefined, disabled: !activeWin },
        { label: "Move to Right Half", hint: shortcutHint("right-half"), action: activeWin ? manage("right-half") : undefined, disabled: !activeWin },
        { label: "Move to Top Half", hint: shortcutHint("top-half"), action: activeWin ? manage("top-half") : undefined, disabled: !activeWin },
        { label: "Move to Bottom Half", hint: shortcutHint("bottom-half"), action: activeWin ? manage("bottom-half") : undefined, disabled: !activeWin },
        { label: activeWin?.maximized ? "Restore from Full Screen" : "Fill", hint: shortcutHint("maximize"), action: activeWin ? () => actions.toggleMaximizeWindow(activeWin.id) : undefined, disabled: !activeWin },
        { label: "Center", hint: shortcutHint("center"), action: activeWin ? manage("center") : undefined, disabled: !activeWin },
        "sep",
        { label: "Previous Display", hint: shortcutHint("previous-display"), action: activeWin ? manage("previous-display") : undefined, disabled: !activeWin },
        { label: "Next Display", hint: shortcutHint("next-display"), action: activeWin ? manage("next-display") : undefined, disabled: !activeWin },
        "sep",
        { label: "Pair with Previous Window", hint: shortcutHint("pair-previous"), action: activeWin ? manage("pair-previous") : undefined, disabled: !activeWin },
        { label: "Tile This Application", hint: shortcutHint("tile-app"), action: activeWin ? manage("tile-app") : undefined, disabled: !activeWin },
        { label: "Arrange This Display", hint: shortcutHint("arrange-display"), action: activeWin ? manage("arrange-display") : undefined, disabled: !activeWin },
        { label: "Cascade This Display", hint: shortcutHint("cascade"), action: activeWin ? manage("cascade") : undefined, disabled: !activeWin },
        { label: "Gather All Windows Here", hint: shortcutHint("gather-all"), action: activeWin ? manage("gather-all") : undefined, disabled: !activeWin },
        "sep",
        { label: "Constellation", hint: "F3", action: onOpenConstellation, announce: false },
        { label: "Toggle Daybreak", hint: shortcutHint("toggle-appearance"), action: onToggleTheme },
        ...(state.windows.length ? ["sep" as const] : []),
        ...state.windows.map<MenuEntry>((window) => ({
          label: window.title.length > 34 ? `${window.title.slice(0, 33)}…` : window.title,
          action: () => actions.focusWindow(window.id),
          announce: false,
        })),
      ],
    },
  ];

  const renderMenu = (entries: MenuEntry[], alignRight = false) => (
    <div className={`hzMenu glass-heavy ${alignRight ? "hzMenu--right" : ""}`} role="menu">
      {entries.map((entry, index) => entry === "sep" ? (
        <div className="hzMenu__sep" role="separator" key={`separator-${index}`} />
      ) : (
        <button
          key={`${entry.label}-${index}`}
          className={`hzMenu__item ${entry.danger ? "is-danger" : ""}`}
          disabled={entry.disabled || !entry.action}
          role="menuitem"
          onClick={invokeEntry(entry)}
        >
          <span>{entry.label}</span>
          {entry.hint && <span className="hzMenu__hint">{entry.hint}</span>}
        </button>
      ))}
    </div>
  );

  const openMenu = (key: string | null) => {
    if (key && !openRef.current) targetRef.current = liveFocusedWin;
    setWindowPalette(false);
    setOpen(key);
  };

  const titleProps = (key: string) => ({
    // Menus open on the down-stroke; press-drag-release commits an item in one
    // gesture, and a second press on the open title closes it.
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      if (!openRef.current) targetRef.current = liveFocusedWin;
      pressHandled.current = key;
      dragSelect.current = openRef.current !== key;
      openMenu(openRef.current === key ? null : key);
    },
    // The pointer path already toggled on pointerdown; click remains only for
    // keyboard activation, which arrives without a preceding pointerdown.
    onClick: () => {
      if (pressHandled.current === key) {
        pressHandled.current = null;
        return;
      }
      openMenu(openRef.current === key ? null : key);
    },
    onMouseEnter: () => {
      if (openRef.current && openRef.current !== key) setOpen(key);
    },
    "data-hz-menu-key": key,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open === key,
  });

  const battery = state.status.batteryPercent;
  const runStatus = (label: string, action: () => void | Promise<unknown>) => {
    void execute(label, action).catch(() => undefined);
  };

  return (
    <div className="horizon">
      {(open || confirmPower || windowPalette) && (
        <button
          className="horizon__scrim"
          aria-label="Close menu"
          onPointerDown={() => {
            setOpen(null);
            setConfirmPower(null);
            setWindowPalette(false);
          }}
        />
      )}

      <div className="horizon__bar glass" role="menubar" aria-label="Gravity menu bar">
        <span className="horizon__anchor">
          <button
            className={`horizon__gravity ${open === "gravity" ? "is-open" : ""}`}
            {...titleProps("gravity")}
            title="Gravity"
            role="menuitem"
          >
            <GravityMark size={16} />
          </button>
          {open === "gravity" && renderMenu(gravityMenu)}
        </span>

        <span
          className={`hzWindowControls ${activeWin ? "is-available" : ""}`}
          aria-label="Active window controls"
          onPointerEnter={showWindowPaletteSoon}
          onPointerLeave={hideWindowPaletteSoon}
        >
          <button
            className="hzWindowControl is-close"
            aria-label="Close active window"
            disabled={!activeWin}
            onPointerDown={() => { targetRef.current = liveFocusedWin; }}
            onClick={() => runWindowControl("close")}
          ><span aria-hidden="true">×</span></button>
          <button
            className="hzWindowControl is-minimize"
            aria-label="Minimize active window to Orbit"
            disabled={!activeWin}
            onPointerDown={() => { targetRef.current = liveFocusedWin; }}
            onClick={() => runWindowControl("minimize")}
          ><span aria-hidden="true">−</span></button>
          <span
            className="hzWindowZoomAnchor"
            onMouseEnter={showWindowPaletteSoon}
            onMouseLeave={hideWindowPaletteSoon}
          >
            <button
              className="hzWindowControl is-zoom"
              aria-label={activeWin?.maximized ? "Restore active window" : "Fill active window"}
              disabled={!activeWin}
              onPointerDown={() => { targetRef.current = liveFocusedWin; }}
              onClick={() => runWindowControl("zoom")}
              onContextMenu={(event) => {
                event.preventDefault();
                clearPaletteTimer();
                targetRef.current = liveFocusedWin;
                setOpen(null);
                setWindowPalette(Boolean(liveFocusedWin));
              }}
            ><span aria-hidden="true">↗</span></button>
            {windowPalette && activeWin && (
              <div className="hzWindowPalette glass-heavy" role="menu" aria-label="Move and resize active window">
                <div className="hzWindowPalette__title">Move & Resize</div>
                <div className="hzWindowPalette__grid">
                  {([
                    ["left-half", "Left half"], ["right-half", "Right half"],
                    ["top-left", "Top left"], ["top-right", "Top right"],
                    ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"],
                  ] as Array<[WindowAction, string]>).map(([action, label]) => (
                    <button
                      key={action}
                      className={`hzWindowPalette__zone is-${action}`}
                      role="menuitem"
                      aria-label={label}
                      title={label}
                      onClick={() => {
                        setWindowPalette(false);
                        void execute(label, () => actions.windowActionFor(activeWin.id, action), false)
                          .catch(() => undefined);
                      }}
                    ><span /></button>
                  ))}
                </div>
                <button
                  className="hzWindowPalette__fill"
                  role="menuitem"
                  onClick={() => {
                    setWindowPalette(false);
                    runWindowControl("zoom");
                  }}
                >{activeWin.maximized ? "Restore" : "Fill"}</button>
              </div>
            )}
          </span>
        </span>

        {menus.map((menu) => (
          <span className="horizon__anchor" key={menu.title}>
            <button
              className={`horizon__menuBtn ${menu.title === appName ? "horizon__app" : ""} ${open === menu.title ? "is-open" : ""}`}
              {...titleProps(menu.title)}
              role="menuitem"
            >
              {menu.title}
            </button>
            {open === menu.title && renderMenu(menu.entries)}
          </span>
        ))}

        <span className="horizon__spacer" />

        <button
          className="horizon__shellToggle"
          onClick={() => runStatus("Switch to Windows 11", switchToWindows)}
          disabled={shellBusy}
          title="Switch to the normal Windows 11 interface (Ctrl+Alt+G to return)"
        >
          <WindowsIcon size={13} />
          <span>{shellBusy ? "Switching…" : "Windows 11"}</span>
        </button>

        <button
          title={`Switch to ${state.appearance.resolved === "light" ? "dark" : "light"} appearance`}
          className="horizon__status horizon__appearance"
          onClick={() => onToggleTheme && runStatus("Appearance", onToggleTheme)}
        >
          <SunIcon size={14.5} />
        </button>
        <button
          title="Focus"
          className={`horizon__status ${state.status.focus ? "is-on" : ""}`}
          onClick={() => runStatus("Focus", () => actions.toggleSetting("focus"))}
        >
          <MoonIcon size={14.5} />
        </button>
        <button
          title={state.status.network ?? "Offline"}
          className={`horizon__status ${state.status.online ? "" : "is-off"}`}
          onClick={() => runStatus("Wi-Fi", () => actions.toggleSetting("wifi"))}
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
        <button className="horizon__clock" onClick={onOpenCore} title="Date, time and system controls">
          {clock}
        </button>
      </div>

      {confirmPower && (
        <div className="hzConfirm glass-heavy" role="alertdialog" aria-modal="true" aria-label={`${confirmPower} confirmation`}>
          <p>{confirmPower === "restart" ? "Restart this PC now?" : "Shut down this PC now?"}</p>
          <div className="hzConfirm__row">
            <button className="hzConfirm__cancel" onClick={() => setConfirmPower(null)}>Cancel</button>
            <button
              className="hzConfirm__go"
              onClick={() => {
                const kind = confirmPower;
                setConfirmPower(null);
                runStatus(kind === "restart" ? "Restart" : "Shut down", () => actions.powerAction(kind));
              }}
            >
              {confirmPower === "restart" ? "Restart" : "Shut Down"}
            </button>
          </div>
        </div>
      )}

      {message && (
        <button
          className={`hzToast glass-heavy is-${message.kind}`}
          role={message.kind === "error" ? "alert" : "status"}
          onClick={() => setMessage(null)}
        >
          {message.text}
        </button>
      )}
    </div>
  );
}
