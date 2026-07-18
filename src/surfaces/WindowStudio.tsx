import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useShell } from "../shell/context";
import type { WarpOperation, WindowAction } from "../shell/types";
import { formatShortcut, shortcutFromEvent, SHORTCUT_DEFINITIONS } from "../lib/shortcuts";
import "./window-studio.css";

export interface WindowStudioProps {
  open: boolean;
  onClose: () => void;
}

const LAYOUTS: Array<{ action: WindowAction; label: string; glyph: string }> = [
  { action: "left-half", label: "Left Half", glyph: "◧" },
  { action: "right-half", label: "Right Half", glyph: "◨" },
  { action: "top-half", label: "Top Half", glyph: "⬒" },
  { action: "bottom-half", label: "Bottom Half", glyph: "⬓" },
  { action: "top-left", label: "Top Left", glyph: "◰" },
  { action: "top-right", label: "Top Right", glyph: "◳" },
  { action: "bottom-left", label: "Bottom Left", glyph: "◱" },
  { action: "bottom-right", label: "Bottom Right", glyph: "◲" },
  { action: "first-third", label: "First Third", glyph: "▥" },
  { action: "center-third", label: "Center Third", glyph: "▥" },
  { action: "last-third", label: "Last Third", glyph: "▥" },
  { action: "first-two-thirds", label: "First ⅔", glyph: "▤" },
  { action: "last-two-thirds", label: "Last ⅔", glyph: "▤" },
  { action: "sixth-top-left", label: "Top Sixth 1", glyph: "▦" },
  { action: "sixth-top-center", label: "Top Sixth 2", glyph: "▦" },
  { action: "sixth-top-right", label: "Top Sixth 3", glyph: "▦" },
  { action: "sixth-bottom-left", label: "Bottom Sixth 1", glyph: "▦" },
  { action: "sixth-bottom-center", label: "Bottom Sixth 2", glyph: "▦" },
  { action: "sixth-bottom-right", label: "Bottom Sixth 3", glyph: "▦" },
  { action: "maximize", label: "Fill Screen", glyph: "▣" },
  { action: "almost-maximize", label: "Almost Fill", glyph: "▢" },
  { action: "center", label: "Center", glyph: "⊙" },
];

const WORKFLOWS: Array<{ action: WindowAction; label: string; detail: string }> = [
  { action: "undo", label: "Undo", detail: "10-step layout history" },
  { action: "restore", label: "Restore", detail: "Original window frame" },
  { action: "grow", label: "Grow", detail: "Scale the active window" },
  { action: "shrink", label: "Shrink", detail: "Scale the active window" },
  { action: "next-display", label: "Next Display", detail: "Preserve relative geometry" },
  { action: "previous-display", label: "Previous Display", detail: "Move to the prior screen" },
  { action: "tile-app", label: "Tile App", detail: "Tile every window from this app" },
  { action: "pair-previous", label: "Pair Previous", detail: "Split with your last window" },
  { action: "gather-all", label: "Gather All", detail: "Bring every window to this display" },
  { action: "arrange-display", label: "Arrange Display", detail: "Balanced full-display layout" },
  { action: "cascade", label: "Cascade", detail: "Layer visible windows" },
];

const WARP_BUTTONS: Array<{ operation: WarpOperation; label: string; glyph: string }> = [
  { operation: "move-up", label: "Move up", glyph: "↑" },
  { operation: "move-left", label: "Move left", glyph: "←" },
  { operation: "move-down", label: "Move down", glyph: "↓" },
  { operation: "move-right", label: "Move right", glyph: "→" },
  { operation: "shrink-width", label: "Narrower", glyph: "↤↦" },
  { operation: "grow-width", label: "Wider", glyph: "↔" },
  { operation: "shrink-height", label: "Shorter", glyph: "↥↧" },
  { operation: "grow-height", label: "Taller", glyph: "↕" },
];

export function WindowStudio({ open, onClose }: WindowStudioProps) {
  const { state, actions } = useShell();
  const [tab, setTab] = useState<"layouts" | "grid" | "warp" | "scenes" | "rules" | "shortcuts">("layouts");
  const [gap, setGap] = useState(state.windowing.gap);
  const [sceneName, setSceneName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ruleApp, setRuleApp] = useState(state.apps[0]?.id ?? "");
  const [ruleAction, setRuleAction] = useState<WindowAction>("left-half");
  const [gridSelection, setGridSelection] = useState<{ start: [number, number]; end: [number, number] } | null>(null);
  const gridAnchor = useRef<[number, number] | null>(null);
  const gridDragging = useRef(false);
  const [warpActive, setWarpActive] = useState(false);
  const [recordingShortcut, setRecordingShortcut] = useState<string | null>(null);
  const target = useMemo(
    () => state.windows.find((window) => window.focused) ??
      state.windows.find((window) => window.orbitId === state.activeOrbit && !window.minimized),
    [state.windows, state.activeOrbit]
  );

  useEffect(() => setGap(state.windowing.gap), [state.windowing.gap]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let dispose: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen<{ tab?: string }>("gravity://window-studio-tab", (event) => {
      if (event.payload.tab === "grid" || event.payload.tab === "warp") {
        setTab(event.payload.tab);
        if (event.payload.tab === "warp") setWarpActive(true);
      }
    })).then((unlisten) => { dispose = unlisten; });
    return () => dispose?.();
  }, []);

  const report = (work: Promise<unknown>, success?: string, key = "work") => {
    setBusy(key);
    setMessage(null);
    void work
      .then(() => success && setMessage(success))
      .catch((error) => setMessage(String(error)))
      .finally(() => setBusy(null));
  };

  useEffect(() => {
    if (!open || tab !== "shortcuts" || !recordingShortcut) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordingShortcut(null);
        setMessage("Shortcut recording cancelled.");
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        const definition = SHORTCUT_DEFINITIONS.find((item) => item.id === recordingShortcut);
        setRecordingShortcut(null);
        report(actions.setShortcut(recordingShortcut, null), `${definition?.label ?? "Shortcut"} disabled.`, `shortcut-${recordingShortcut}`);
        return;
      }
      const binding = shortcutFromEvent(event);
      if (!binding) {
        setMessage("Use at least one modifier: Ctrl, Alt, Shift, or the Windows key.");
        return;
      }
      const definition = SHORTCUT_DEFINITIONS.find((item) => item.id === recordingShortcut);
      setRecordingShortcut(null);
      report(actions.setShortcut(recordingShortcut, binding), `${definition?.label ?? "Shortcut"} set to ${formatShortcut(binding)}.`, `shortcut-${recordingShortcut}`);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, tab, recordingShortcut, actions]);

  const runWarp = (operation: WarpOperation) => {
    if (!target || busy) return;
    report(actions.warpWindow(target.id, operation), `${operation.replaceAll("-", " ")} · ${target.title}`, operation);
  };

  useEffect(() => {
    if (!open || tab !== "warp" || !warpActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        setWarpActive(false);
        setMessage(event.key === "Enter" ? "Warp position accepted." : "Warp Mode closed. Every move remains available through Undo.");
        return;
      }
      const operation: WarpOperation | undefined = event.shiftKey
        ? ({ ArrowLeft: "shrink-width", ArrowRight: "grow-width", ArrowUp: "shrink-height", ArrowDown: "grow-height" } as const)[event.key as "ArrowLeft"]
        : ({ ArrowLeft: "move-left", ArrowRight: "move-right", ArrowUp: "move-up", ArrowDown: "move-down" } as const)[event.key as "ArrowLeft"];
      if (!operation) return;
      event.preventDefault();
      runWarp(operation);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, tab, warpActive, target?.id, busy]);

  if (!open) return null;

  const applyLayout = (action: WindowAction) => {
    if (!target) return setMessage("Open an application window first.");
    const label = LAYOUTS.find((layout) => layout.action === action)?.label ?? action;
    report(actions.windowActionFor(target.id, action), `${label} applied to “${target.title}”.`, action);
  };

  const gridCellAt = (event: ReactPointerEvent<HTMLDivElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(5, Math.floor(((event.clientX - rect.left) / rect.width) * 6))),
      Math.max(0, Math.min(3, Math.floor(((event.clientY - rect.top) / rect.height) * 4))),
    ];
  };

  const applyGrid = (start: [number, number], end: [number, number]) => {
    if (!target) return setMessage("Open an application window first.");
    const left = Math.min(start[0], end[0]);
    const top = Math.min(start[1], end[1]);
    const width = Math.abs(end[0] - start[0]) + 1;
    const height = Math.abs(end[1] - start[1]) + 1;
    report(
      actions.applyGridRegion(target.id, left / 6, top / 4, width / 6, height / 4),
      `${target.title} placed in a ${width} × ${height} grid region.`,
      "grid",
    );
  };

  const gridCellSelected = (column: number, row: number) => {
    if (!gridSelection) return false;
    const left = Math.min(gridSelection.start[0], gridSelection.end[0]);
    const right = Math.max(gridSelection.start[0], gridSelection.end[0]);
    const top = Math.min(gridSelection.start[1], gridSelection.end[1]);
    const bottom = Math.max(gridSelection.start[1], gridSelection.end[1]);
    return column >= left && column <= right && row >= top && row <= bottom;
  };

  const savePreferences = (nextGap = gap, cycling = state.windowing.cycling) =>
    report(actions.setWindowPreferences(nextGap, cycling), "Window preferences saved.", "prefs");

  const capture = () => {
    const name = sceneName.trim();
    if (!name) return setMessage("Give this Scene a name first.");
    setBusy("capture");
    setMessage(null);
    void actions.captureScene(name)
      .then((scene) => {
        setSceneName("");
        setMessage(`Captured ${scene.windows.length} windows in “${scene.name}”.`);
      })
      .catch((error) => setMessage(String(error)))
      .finally(() => setBusy(null));
  };

  return (
    <div className="windowStudioScrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="windowStudio glass-heavy lens" aria-label="Gravity Window Studio">
        <header className="windowStudio__header">
          <div className="windowStudio__mark" aria-hidden="true">G</div>
          <div>
            <h1>Window Studio</h1>
            <p>{target ? `Arranging ${target.title}` : "Gravity's native window engine"}</p>
          </div>
          <button className="windowStudio__close" onClick={onClose} aria-label="Close Window Studio">×</button>
        </header>

        <nav className="windowStudio__tabs" aria-label="Window Studio sections" role="tablist">
          {(["layouts", "grid", "warp", "scenes", "rules", "shortcuts"] as const).map((item) => (
            <button key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)} role="tab" aria-selected={tab === item}>
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>

        <div className="windowStudio__body">
          {tab === "layouts" && (
            <>
              <div className="windowStudio__layoutGrid">
                {LAYOUTS.map((layout) => (
                  <button
                    key={layout.action}
                    className="windowStudio__layout"
                    disabled={!target || busy !== null}
                    onClick={() => applyLayout(layout.action)}
                  >
                    <span>{layout.glyph}</span>
                    <small>{layout.label}</small>
                  </button>
                ))}
              </div>
              <div className="windowStudio__preferences">
                <label>
                  <span><b>Window gap</b><em>{gap}px</em></span>
                  <input
                    type="range"
                    min="0"
                    max="48"
                    value={gap}
                    onChange={(event) => setGap(Number(event.target.value))}
                    onPointerUp={() => savePreferences()}
                    onKeyUp={() => savePreferences()}
                  />
                </label>
                <button
                  className={`windowStudio__switchRow ${state.windowing.cycling ? "is-on" : ""}`}
                  onClick={() => savePreferences(gap, !state.windowing.cycling)}
                >
                  <span><b>Shortcut cycling</b><small>Repeat halves to cycle ½ → ⅔ → ⅓</small></span>
                  <i><i /></i>
                </button>
                <button
                  className={`windowStudio__switchRow ${state.windowing.launchAtLogin ? "is-on" : ""}`}
                  onClick={() => report(actions.setLaunchAtLogin(!state.windowing.launchAtLogin), state.windowing.launchAtLogin ? "Launch at login disabled." : "Gravity will start with Windows.", "login")}
                >
                  <span><b>Launch at login</b><small>Start the complete Gravity shell with Windows</small></span>
                  <i><i /></i>
                </button>
              </div>
              <div className="windowStudio__workflowHeading">
                <b>Window workflows</b>
                <span>Native multi-window and multi-display tools</span>
              </div>
              <div className="windowStudio__workflows">
                {WORKFLOWS.map((workflow) => (
                  <button
                    key={workflow.action}
                    disabled={!target || busy !== null}
                    onClick={() => report(
                      actions.windowActionFor(target!.id, workflow.action),
                      `${workflow.label} completed.`,
                      workflow.action,
                    )}
                  >
                    <b>{workflow.label}</b>
                    <small>{workflow.detail}</small>
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === "grid" && (
            <div className="windowStudio__gridPicker">
              <div className="windowStudio__toolIntro">
                <span className="windowStudio__toolGlyph" aria-hidden="true">▦</span>
                <div><h2>6 × 4 Grid Picker</h2><p>Drag across cells to place {target?.title ?? "the active window"} with exact, display-relative geometry.</p></div>
              </div>
              <div
                className={`windowStudio__grid ${!target || busy ? "is-disabled" : ""}`}
                role="grid"
                aria-label="Choose a window region on the six by four grid"
                onPointerDown={(event) => {
                  if (!target || busy) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const cell = gridCellAt(event);
                  gridAnchor.current = cell;
                  gridDragging.current = true;
                  setGridSelection({ start: cell, end: cell });
                }}
                onPointerMove={(event) => {
                  if (!gridDragging.current || !gridAnchor.current) return;
                  setGridSelection({ start: gridAnchor.current, end: gridCellAt(event) });
                }}
                onPointerUp={(event) => {
                  if (!gridDragging.current || !gridAnchor.current) return;
                  const end = gridCellAt(event);
                  const start = gridAnchor.current;
                  gridDragging.current = false;
                  gridAnchor.current = null;
                  setGridSelection({ start, end });
                  applyGrid(start, end);
                }}
                onPointerCancel={() => {
                  gridDragging.current = false;
                  gridAnchor.current = null;
                }}
              >
                {Array.from({ length: 24 }, (_, index) => {
                  const column = index % 6;
                  const row = Math.floor(index / 6);
                  return <span key={index} role="gridcell" aria-selected={gridCellSelected(column, row)} className={gridCellSelected(column, row) ? "is-selected" : ""} />;
                })}
              </div>
              <div className="windowStudio__gridPresets">
                {[
                  ["Cinema", 0, 0, 6, 4], ["Centered", 1, 0, 4, 4], ["Reading", 1, 0, 3, 4],
                  ["Triple Left", 0, 0, 2, 4], ["Upper Deck", 0, 0, 6, 2], ["Focus", 1, 1, 4, 2],
                ].map(([label, column, row, width, height]) => (
                  <button key={label} disabled={!target || busy !== null} onClick={() => applyGrid([column as number, row as number], [(column as number) + (width as number) - 1, (row as number) + (height as number) - 1])}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="windowStudio__toolHint">Every Grid placement is added to Gravity’s per-window Undo history.</p>
            </div>
          )}

          {tab === "warp" && (
            <div className={`windowStudio__warp ${warpActive ? "is-active" : ""}`}>
              <div className="windowStudio__toolIntro">
                <span className="windowStudio__toolGlyph" aria-hidden="true">⌖</span>
                <div><h2>Warp Mode</h2><p>Move and resize {target?.title ?? "the active window"} in precise 48-pixel steps without reaching for its frame.</p></div>
              </div>
              <button
                className="windowStudio__warpToggle"
                disabled={!target}
                onClick={() => {
                  setWarpActive((current) => !current);
                  setMessage(warpActive ? "Warp Mode paused." : "Warp Mode listening. Use arrows, Shift + arrows, Enter, or Escape.");
                }}
              >
                <span className="windowStudio__warpPulse" />
                <span><b>{warpActive ? "Warp Mode is listening" : "Start Warp Mode"}</b><small>{warpActive ? "Arrow keys move · Shift + arrows resize" : "Keyboard control for the focused native window"}</small></span>
                <kbd>{warpActive ? "ENTER" : "START"}</kbd>
              </button>
              <div className="windowStudio__warpGrid">
                {WARP_BUTTONS.map((item) => (
                  <button key={item.operation} disabled={!target || busy !== null} onClick={() => runWarp(item.operation)}>
                    <span>{item.glyph}</span><small>{item.label}</small>
                  </button>
                ))}
              </div>
              <div className="windowStudio__focusPad">
                <span>Directional focus</span>
                {(["focus-left", "focus-up", "focus-down", "focus-right"] as WindowAction[]).map((action) => (
                  <button key={action} disabled={!target || busy !== null} onClick={() => report(actions.windowActionFor(target!.id, action), `${action.replace("focus-", "Focus moved ")}.`, action)}>{({ "focus-left": "←", "focus-up": "↑", "focus-down": "↓", "focus-right": "→" } as Record<string, string>)[action]}</button>
                ))}
              </div>
            </div>
          )}

          {tab === "scenes" && (
            <div className="windowStudio__scenes">
              <form onSubmit={(event) => { event.preventDefault(); capture(); }}>
                <input
                  value={sceneName}
                  onChange={(event) => setSceneName(event.target.value)}
                  placeholder="Scene name, e.g. Design desk"
                  maxLength={64}
                />
                <button disabled={busy !== null || !sceneName.trim()}>Capture Current Desktop</button>
              </form>
              <p className="windowStudio__sceneHelp">Scenes remember applications, windows, displays, and exact relative geometry.</p>
              <div className="windowStudio__sceneList">
                {state.windowing.scenes.map((scene) => (
                  <article key={scene.id}>
                    <span className="windowStudio__sceneOrb" aria-hidden="true" />
                    <div>
                      <b>{scene.name}</b>
                      <small>{scene.windows.length} window{scene.windows.length === 1 ? "" : "s"} · {new Date(scene.createdAt * 1000).toLocaleDateString()}</small>
                    </div>
                    <button disabled={busy !== null} onClick={() => report(actions.restoreScene(scene.id), `Restored “${scene.name}”.`, scene.id)}>Restore</button>
                    <button
                      className={scene.autoRestore ? "is-auto" : ""}
                      disabled={busy !== null}
                      onClick={() => report(actions.setSceneAutoRestore(scene.id, !scene.autoRestore), scene.autoRestore ? "Automatic restore disabled." : "Scene will restore when this display setup returns.", scene.id)}
                      title={scene.displayFingerprint || "Display configuration"}
                    >{scene.autoRestore ? "Auto On" : "Auto"}</button>
                    <button className="is-danger" disabled={busy !== null} onClick={() => report(actions.deleteScene(scene.id), "Scene deleted.", scene.id)}>Delete</button>
                  </article>
                ))}
                {state.windowing.scenes.length === 0 && <div className="windowStudio__empty">Your saved desktop Scenes will appear here.</div>}
              </div>
            </div>
          )}

          {tab === "shortcuts" && (
            <div className="windowStudio__shortcutStudio">
              <div className="windowStudio__shortcutIntro">
                <div><b>Global shortcuts</b><span>Click a binding, then press a new combination. Escape cancels; Backspace or Delete clears it.</span></div>
                <button disabled={busy !== null} onClick={() => report(actions.resetShortcuts(), "Magnet-compatible defaults restored.", "shortcut-reset")}>Reset Defaults</button>
              </div>
              <div className="windowStudio__shortcuts">
                {SHORTCUT_DEFINITIONS.map((definition, index) => (
                  <div key={definition.id} className="windowStudio__shortcutRow">
                    {(index === 0 || SHORTCUT_DEFINITIONS[index - 1].group !== definition.group) && <strong>{definition.group}</strong>}
                    <span><b>{definition.label}</b><small>{definition.detail}</small></span>
                    <button
                      className={recordingShortcut === definition.id ? "is-recording" : ""}
                      disabled={busy !== null && busy !== `shortcut-${definition.id}`}
                      onClick={() => {
                        setMessage(null);
                        setRecordingShortcut((current) => current === definition.id ? null : definition.id);
                      }}
                      aria-label={`Record shortcut for ${definition.label}`}
                    >{recordingShortcut === definition.id ? "Press shortcut…" : formatShortcut(state.windowing.shortcuts?.[definition.id])}</button>
                    <button
                      className="windowStudio__shortcutClear"
                      disabled={!state.windowing.shortcuts?.[definition.id] || busy !== null}
                      onClick={() => report(actions.setShortcut(definition.id, null), `${definition.label} disabled.`, `shortcut-${definition.id}`)}
                      aria-label={`Clear shortcut for ${definition.label}`}
                    >×</button>
                  </div>
                ))}
              </div>
              <p className="windowStudio__shortcutReserved">Always available: <kbd>Alt Space</kbd> Singularity · <kbd>F3</kbd> Constellation · <kbd>Ctrl Alt G</kbd> Windows 11 handoff.</p>
            </div>
          )}

          {tab === "rules" && (
            <div className="windowStudio__rules">
              <form onSubmit={(event) => {
                event.preventDefault();
                if (ruleApp) report(actions.upsertWindowRule(ruleApp, ruleAction, true), "Application Rule saved.", "rule");
              }}>
                <label>
                  <span>When this application opens</span>
                  <select value={ruleApp} onChange={(event) => setRuleApp(event.target.value)}>
                    {[...state.apps].sort((a, b) => a.name.localeCompare(b.name)).map((app) => (
                      <option key={app.id} value={app.id}>{app.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Place its window here</span>
                  <select value={ruleAction} onChange={(event) => setRuleAction(event.target.value as WindowAction)}>
                    {LAYOUTS.map((layout) => <option key={layout.action} value={layout.action}>{layout.label}</option>)}
                  </select>
                </label>
                <button disabled={!ruleApp || busy !== null}>Add Rule</button>
              </form>
              <p className="windowStudio__sceneHelp">Rules run once when a new top-level window appears. They remain reversible with Gravity Undo.</p>
              <div className="windowStudio__ruleList">
                {state.windowing.rules.map((rule) => (
                  <article key={rule.id} className={rule.enabled ? "" : "is-disabled"}>
                    <div><b>{rule.appName}</b><small>{LAYOUTS.find((layout) => layout.action === rule.action)?.label ?? rule.action}</small></div>
                    <button disabled={busy !== null} onClick={() => report(actions.upsertWindowRule(rule.appId, rule.action, !rule.enabled), rule.enabled ? "Rule paused." : "Rule enabled.", rule.id)}>{rule.enabled ? "Pause" : "Enable"}</button>
                    <button className="is-danger" disabled={busy !== null} onClick={() => report(actions.deleteWindowRule(rule.id), "Rule deleted.", rule.id)}>Delete</button>
                  </article>
                ))}
                {state.windowing.rules.length === 0 && <div className="windowStudio__empty">Add a Rule to place an application's windows automatically.</div>}
              </div>
              <div className="windowStudio__ignoreHeading"><b>Ignore list</b><span>Ignored applications are never moved, snapped, warped, ruled, or stored.</span></div>
              <div className="windowStudio__ignoreList">
                {[...state.apps].sort((a, b) => a.name.localeCompare(b.name)).map((app) => {
                  const ignored = state.windowing.ignoredAppIds.includes(app.id);
                  return (
                    <button
                      key={app.id}
                      className={ignored ? "is-ignored" : ""}
                      disabled={busy !== null}
                      onClick={() => report(actions.setAppIgnored(app.id, !ignored), ignored ? `${app.name} returned to Gravity.` : `${app.name} added to the ignore list.`, `ignore-${app.id}`)}
                      aria-pressed={ignored}
                    ><span>{app.name}</span><small>{ignored ? "Ignored" : "Managed"}</small></button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <footer className={message ? "is-visible" : ""} role="status">
          {busy ? "Gravity is working…" : message}
        </footer>
      </section>
    </div>
  );
}
