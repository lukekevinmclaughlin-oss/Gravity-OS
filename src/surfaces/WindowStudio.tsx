import { useEffect, useMemo, useState } from "react";
import { useShell } from "../shell/context";
import type { WindowAction } from "../shell/types";
import "./window-studio.css";

export interface WindowStudioProps {
  open: boolean;
  onClose: () => void;
}

const LAYOUTS: Array<{ action: WindowAction; label: string; glyph: string }> = [
  { action: "left-half", label: "Left Half", glyph: "◧" },
  { action: "right-half", label: "Right Half", glyph: "◨" },
  { action: "top-left", label: "Top Left", glyph: "◰" },
  { action: "top-right", label: "Top Right", glyph: "◳" },
  { action: "bottom-left", label: "Bottom Left", glyph: "◱" },
  { action: "bottom-right", label: "Bottom Right", glyph: "◲" },
  { action: "first-third", label: "First Third", glyph: "▥" },
  { action: "center-third", label: "Center Third", glyph: "▥" },
  { action: "last-third", label: "Last Third", glyph: "▥" },
  { action: "first-two-thirds", label: "First ⅔", glyph: "▤" },
  { action: "last-two-thirds", label: "Last ⅔", glyph: "▤" },
  { action: "maximize", label: "Fill Screen", glyph: "▣" },
];

const SHORTCUTS = [
  ["Ctrl Alt ←", "Cycle left ½ → ⅔ → ⅓"],
  ["Ctrl Alt →", "Cycle right ½ → ⅔ → ⅓"],
  ["Ctrl Alt ↑ / ↓", "Top or bottom half"],
  ["Ctrl Alt Enter", "Fill the screen"],
  ["Ctrl Alt Z", "Undo the last Gravity move"],
  ["Ctrl Alt Shift ← / →", "Move to another display"],
  ["F3", "Open Constellation"],
  ["Alt Space", "Open Singularity"],
];

export function WindowStudio({ open, onClose }: WindowStudioProps) {
  const { state, actions } = useShell();
  const [tab, setTab] = useState<"layouts" | "scenes" | "rules" | "shortcuts">("layouts");
  const [gap, setGap] = useState(state.windowing.gap);
  const [sceneName, setSceneName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ruleApp, setRuleApp] = useState(state.apps[0]?.id ?? "");
  const [ruleAction, setRuleAction] = useState<WindowAction>("left-half");
  const target = useMemo(
    () => state.windows.find((window) => window.focused) ??
      state.windows.find((window) => window.orbitId === state.activeOrbit && !window.minimized),
    [state.windows, state.activeOrbit]
  );

  useEffect(() => setGap(state.windowing.gap), [state.windowing.gap]);
  if (!open) return null;

  const report = (work: Promise<unknown>, success?: string, key = "work") => {
    setBusy(key);
    setMessage(null);
    void work
      .then(() => success && setMessage(success))
      .catch((error) => setMessage(String(error)))
      .finally(() => setBusy(null));
  };

  const applyLayout = (action: WindowAction) => {
    if (!target) return setMessage("Open an application window first.");
    report(actions.windowActionFor(target.id, action), undefined, action);
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

        <nav className="windowStudio__tabs" aria-label="Window Studio sections">
          {(["layouts", "scenes", "rules", "shortcuts"] as const).map((item) => (
            <button key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>
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
              </div>
            </>
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
                    <button className="is-danger" disabled={busy !== null} onClick={() => report(actions.deleteScene(scene.id), "Scene deleted.", scene.id)}>Delete</button>
                  </article>
                ))}
                {state.windowing.scenes.length === 0 && <div className="windowStudio__empty">Your saved desktop Scenes will appear here.</div>}
              </div>
            </div>
          )}

          {tab === "shortcuts" && (
            <div className="windowStudio__shortcuts">
              {SHORTCUTS.map(([keys, description]) => (
                <div key={keys}><kbd>{keys}</kbd><span>{description}</span></div>
              ))}
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
                    <button onClick={() => report(actions.upsertWindowRule(rule.appId, rule.action, !rule.enabled), rule.enabled ? "Rule paused." : "Rule enabled.", rule.id)}>{rule.enabled ? "Pause" : "Enable"}</button>
                    <button className="is-danger" onClick={() => report(actions.deleteWindowRule(rule.id), "Rule deleted.", rule.id)}>Delete</button>
                  </article>
                ))}
                {state.windowing.rules.length === 0 && <div className="windowStudio__empty">Add a Rule to place an application's windows automatically.</div>}
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
