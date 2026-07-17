import { useEffect, useRef, useState } from "react";
import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { CloseIcon } from "../components/Icons";
import "./pulse.css";

/** Pulse — notifications drift in on a decaying orbit and settle. */

const LINGER_MS = 7000;

export function Pulse() {
  const { state, actions } = useShell();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());

  const dismiss = (id: string) => {
    // Play the exit animation, then actually remove the note.
    setLeaving((prev) => new Set(prev).add(id));
    setTimeout(() => {
      actions.dismissNotification(id);
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 240);
  };

  useEffect(() => {
    // Arm a linger timer once per note; leave existing timers alone so churn
    // in the notification list doesn't reset them (they'd never expire).
    if (!state.status.focus) {
      for (const note of state.notifications) {
        if (!timers.current.has(note.id)) {
          timers.current.set(
            note.id,
            setTimeout(() => {
              dismiss(note.id);
              timers.current.delete(note.id);
            }, LINGER_MS)
          );
        }
      }
    }
    // Drop timers for notes that no longer exist.
    const alive = new Set(state.notifications.map((n) => n.id));
    for (const [id, t] of timers.current) {
      if (!alive.has(id)) {
        clearTimeout(t);
        timers.current.delete(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.notifications, state.status.focus]);

  // Clear everything only on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach(clearTimeout);
      map.clear();
    };
  }, []);

  if (state.status.focus) return null;

  return (
    <div className="pulse">
      {state.notifications.map((n) => (
        <div
          key={n.id}
          className={`pulse__toast glass-heavy lens ${leaving.has(n.id) ? "is-leaving" : ""}`}
        >
          <AppTile name={n.appName} hue={n.hue} size={32} />
          <div className="pulse__text">
            <span className="pulse__app">{n.appName}</span>
            <span className="pulse__title">{n.title}</span>
            <span className="pulse__body">{n.body}</span>
          </div>
          <button className="pulse__close" onClick={() => dismiss(n.id)} aria-label="Dismiss">
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
