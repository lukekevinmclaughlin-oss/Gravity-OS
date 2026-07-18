import { useCallback, useEffect, useState } from "react";
import { DeepField } from "./DeepField";
import { GravityWells } from "./GravityWells";
import { DemoWindows } from "./DemoWindows";
import { Horizon } from "./Horizon";
import { Orbit } from "./Orbit";
import { Singularity } from "./Singularity";
import { Core } from "./Core";
import { Constellation } from "./Constellation";
import { Pulse } from "./Pulse";
import { WindowStudio } from "./WindowStudio";
import { AppLibrary } from "./AppLibrary";
import { AboutGravity } from "./AboutGravity";
import { CustomizationCenter } from "./CustomizationCenter";
import { useShell } from "../shell/context";
import type { OverlaySurface } from "../lib/win";
import "./stage.css";

/** Stage — the composed development desktop. In production each surface runs in its own
 *  transparent Tauri window (see src-tauri). */

export function Stage() {
  const { state, actions } = useShell();
  const [overlay, setOverlay] = useState<OverlaySurface | null>(null);
  const daybreak = state.appearance.resolved === "light";

  const toggleTheme = useCallback(
    () => actions.setAppearance(daybreak ? "dark" : "light"),
    [actions, daybreak]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay((current) => (current === "singularity" ? null : "singularity"));
      } else if (e.key === "F3") {
        e.preventDefault();
        setOverlay((current) => (current === "constellation" ? null : "constellation"));
      } else if (e.key === "Escape") {
        setOverlay(null);
      } else if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        void actions.setShellActive(state.shellMode !== "gravity");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, state.shellMode]);

  return (
    <div className="stage" style={overlay === "singularity" ? { transform: "scale(1.012)" } : undefined}>
      <DeepField />
      {/* Production runs Wells in its own region-shaped native window; the
          composed Stage mounts the same surface so the dev loop and browser
          tests exercise every well behavior (mock-first product standard). */}
      <GravityWells />
      <DemoWindows />
      <Horizon
        onOpenCore={() => setOverlay((current) => (current === "core" ? null : "core"))}
        onOpenConstellation={() => setOverlay((current) => (current === "constellation" ? null : "constellation"))}
        onOpenSingularity={() => setOverlay((current) => (current === "singularity" ? null : "singularity"))}
        onToggleTheme={toggleTheme}
        onOpenWindowStudio={() => setOverlay((current) => (current === "window-studio" ? null : "window-studio"))}
        onOpenAbout={() => setOverlay((current) => (current === "about" ? null : "about"))}
      />
      <Orbit
        onOpenAppLibrary={() => setOverlay((current) => (current === "app-library" ? null : "app-library"))}
        onOpenCustomization={() => setOverlay((current) => (current === "customization" ? null : "customization"))}
      />
      <Pulse />
      <Core open={overlay === "core"} onClose={() => setOverlay(null)} onToggleTheme={toggleTheme} daybreak={daybreak} />
      <Constellation open={overlay === "constellation"} onClose={() => setOverlay(null)} />
      <WindowStudio open={overlay === "window-studio"} onClose={() => setOverlay(null)} />
      <AppLibrary open={overlay === "app-library"} onClose={() => setOverlay(null)} />
      <CustomizationCenter open={overlay === "customization"} onClose={() => setOverlay(null)} />
      <AboutGravity open={overlay === "about"} onClose={() => setOverlay(null)} />
      <Singularity
        open={overlay === "singularity"}
        onClose={() => setOverlay(null)}
        onOpenConstellation={() => setOverlay("constellation")}
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
