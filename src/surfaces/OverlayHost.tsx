import { useEffect, useState } from "react";
import { Singularity } from "./Singularity";
import { Core } from "./Core";
import { Constellation } from "./Constellation";
import { WindowStudio } from "./WindowStudio";
import { AppLibrary } from "./AppLibrary";
import { AboutGravity } from "./AboutGravity";
import { hideOverlaySelf, type OverlaySurface } from "../lib/win";
import { useShell } from "../shell/context";

/** Host for the single reusable overlay window on Windows. Listens for
 *  `gravity://overlay` events from Horizon and shows the requested surface,
 *  hiding its own window when dismissed. */

export function OverlayHost() {
  const { state, actions } = useShell();
  const [surface, setSurface] = useState<OverlaySurface | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ surface: OverlaySurface | null }>("gravity://overlay", (e) => {
        setSurface(e.payload.surface);
        if (e.payload.surface === null) void hideOverlaySelf();
      }).then((u) => {
        unlisten = u;
      });
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!surface) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSurface(null);
      void hideOverlaySelf();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [surface]);

  const close = () => {
    setSurface(null);
    void hideOverlaySelf();
  };
  const toggleAppearance = () =>
    actions.setAppearance(state.appearance.resolved === "light" ? "dark" : "light");

  return (
    <>
      <Singularity
        open={surface === "singularity"}
        onClose={close}
        onOpenConstellation={() => setSurface("constellation")}
        onToggleTheme={toggleAppearance}
      />
      <Core
        open={surface === "core"}
        onClose={close}
        onToggleTheme={toggleAppearance}
        daybreak={state.appearance.resolved === "light"}
      />
      <Constellation open={surface === "constellation"} onClose={close} />
      <WindowStudio open={surface === "window-studio"} onClose={close} />
      <AppLibrary open={surface === "app-library"} onClose={close} />
      <AboutGravity open={surface === "about"} onClose={close} />
    </>
  );
}
