import { useEffect, useState } from "react";
import { Singularity } from "./Singularity";
import { Core } from "./Core";
import { Constellation } from "./Constellation";
import { hideOverlaySelf, type OverlaySurface } from "../lib/win";

/** Host for the single reusable overlay window on Windows. Listens for
 *  `gravity://overlay` events from Horizon and shows the requested surface,
 *  hiding its own window when dismissed. */

export function OverlayHost() {
  const [surface, setSurface] = useState<OverlaySurface | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ surface: OverlaySurface }>("gravity://overlay", (e) => {
        setSurface(e.payload.surface);
      }).then((u) => {
        unlisten = u;
      });
    });
    return () => unlisten?.();
  }, []);

  const close = () => {
    setSurface(null);
    void hideOverlaySelf();
  };

  return (
    <>
      <Singularity
        open={surface === "singularity"}
        onClose={close}
        onOpenConstellation={() => setSurface("constellation")}
      />
      <Core open={surface === "core"} onClose={close} />
      <Constellation open={surface === "constellation"} onClose={close} />
    </>
  );
}
