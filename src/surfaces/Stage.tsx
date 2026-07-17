import { useCallback, useEffect, useState } from "react";
import { DeepField } from "./DeepField";
import { DemoWindows } from "./DemoWindows";
import { Horizon } from "./Horizon";
import { Orbit } from "./Orbit";
import { Singularity } from "./Singularity";
import { Core } from "./Core";
import { Constellation } from "./Constellation";
import { Pulse } from "./Pulse";
import "./stage.css";

/** Stage — the composed desktop. On macOS this is the dev harness with the
 *  mock machine; on Windows each surface also runs standalone in its own
 *  transparent Tauri window (see src-tauri). */

export function Stage() {
  const [singOpen, setSingOpen] = useState(false);
  const [coreOpen, setCoreOpen] = useState(false);
  const [constOpen, setConstOpen] = useState(false);
  const [daybreak, setDaybreak] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (daybreak) root.dataset.theme = "daybreak";
    else delete root.dataset.theme;
  }, [daybreak]);

  const toggleTheme = useCallback(() => setDaybreak((d) => !d), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSingOpen((o) => !o);
        setCoreOpen(false);
        setConstOpen(false);
      } else if (e.key === "F3") {
        e.preventDefault();
        setConstOpen((o) => !o);
        setSingOpen(false);
        setCoreOpen(false);
      } else if (e.key === "Escape") {
        setSingOpen(false);
        setCoreOpen(false);
        setConstOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="stage" style={singOpen ? { transform: "scale(1.012)" } : undefined}>
      <DeepField />
      <DemoWindows />
      <Horizon
        onOpenCore={() => setCoreOpen((o) => !o)}
        onOpenConstellation={() => setConstOpen(true)}
        onOpenSingularity={() => setSingOpen(true)}
        onToggleTheme={toggleTheme}
      />
      <Orbit />
      <Pulse />
      <Core open={coreOpen} onClose={() => setCoreOpen(false)} onToggleTheme={toggleTheme} daybreak={daybreak} />
      <Constellation open={constOpen} onClose={() => setConstOpen(false)} />
      <Singularity
        open={singOpen}
        onClose={() => setSingOpen(false)}
        onOpenConstellation={() => setConstOpen(true)}
        onToggleTheme={toggleTheme}
      />
      <div className="stage__hint">
        <span className="keycap">⌘K</span> Singularity
        <span className="stage__hintDot">·</span>
        <span className="keycap">F3</span> Constellation
      </div>
    </div>
  );
}
