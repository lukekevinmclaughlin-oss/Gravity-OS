import { ShellRoot } from "./shell/context";
import { Stage } from "./surfaces/Stage";
import { DeepField } from "./surfaces/DeepField";
import { Horizon } from "./surfaces/Horizon";
import { Orbit } from "./surfaces/Orbit";
import { Pulse } from "./surfaces/Pulse";
import { OverlayHost } from "./surfaces/OverlayHost";
import { SnapPreview } from "./surfaces/SnapPreview";
import { openOverlay } from "./lib/win";
import { useShell } from "./shell/context";

/** Routes by ?surface=…  Each Tauri window on Windows loads exactly one
 *  surface; with no param (dev on macOS) the full composed Stage renders. */

function Surface() {
  const { state, actions } = useShell();
  const toggleAppearance = () =>
    actions.setAppearance(state.appearance.resolved === "light" ? "dark" : "light");
  const surface = new URLSearchParams(window.location.search).get("surface");
  switch (surface) {
    case "deepfield":
      return <DeepField />;
    case "horizon":
      return (
        <Horizon
          onOpenSingularity={() => openOverlay("singularity")}
          onOpenCore={() => openOverlay("core")}
          onOpenConstellation={() => openOverlay("constellation")}
          onToggleTheme={toggleAppearance}
          onOpenWindowStudio={() => openOverlay("window-studio")}
          onOpenAbout={() => openOverlay("about")}
        />
      );
    case "orbit":
      return <Orbit />;
    case "pulse":
      return <Pulse />;
    case "overlay":
      return <OverlayHost />;
    case "snap":
      return <SnapPreview />;
    default:
      return <Stage />;
  }
}

export default function App() {
  return (
    <ShellRoot>
      <Surface />
    </ShellRoot>
  );
}
