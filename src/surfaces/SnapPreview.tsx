import { useEffect, useState } from "react";
import { isTauri } from "../shell/tauri";
import "./snap-preview.css";

type SnapAction =
  | "left-half"
  | "right-half"
  | "top-half"
  | "bottom-half"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "maximize";

/** A click-through, monitor-local magnetic placement preview. */
export function SnapPreview() {
  const [action, setAction] = useState<SnapAction>("maximize");

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ action: SnapAction }>("gravity://snap-preview", (event) => {
        setAction(event.payload.action);
      }).then((dispose) => {
        unlisten = dispose;
      })
    );
    return () => unlisten?.();
  }, []);

  return (
    <div className={`snapPreview snapPreview--${action}`} aria-hidden="true">
      <div className="snapPreview__zone glass-heavy">
        <div className="snapPreview__glow" />
      </div>
    </div>
  );
}
