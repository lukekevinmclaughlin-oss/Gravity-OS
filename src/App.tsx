import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { ShellRoot } from "./shell/context";
import { Stage } from "./surfaces/Stage";
import { DeepField } from "./surfaces/DeepField";
import { Horizon } from "./surfaces/Horizon";
import { Orbit } from "./surfaces/Orbit";
import { Pulse } from "./surfaces/Pulse";
import { OverlayHost } from "./surfaces/OverlayHost";
import { SnapPreview } from "./surfaces/SnapPreview";
import { GravityWells } from "./surfaces/GravityWells";
import { openOverlay } from "./lib/win";
import { useShell } from "./shell/context";

class SurfaceErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Gravity surface failed", error, info.componentStack);
  }

  render() {
    if (!this.state.message) return this.props.children;
    return (
      <main className="surfaceFailure" role="alert">
        <strong>This Gravity surface could not start.</strong>
        <span>{this.state.message}</span>
        <button onClick={() => window.location.reload()}>Reload surface</button>
      </main>
    );
  }
}

/** Routes by ?surface=… Each native window loads exactly one surface; with no
 * query parameter the full composed development Stage renders. */

function Surface() {
  const { state, actions } = useShell();
  const toggleAppearance = () =>
    actions.setAppearance(state.appearance.resolved === "light" ? "dark" : "light");
  const surface = new URLSearchParams(window.location.search).get("surface");
  switch (surface) {
    case "deepfield":
      return <DeepField />;
    case "wells":
      return <GravityWells />;
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
      <SurfaceErrorBoundary>
        <Surface />
      </SurfaceErrorBoundary>
    </ShellRoot>
  );
}
