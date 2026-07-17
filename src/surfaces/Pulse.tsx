import { useEffect, useRef } from "react";
import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { CloseIcon } from "../components/Icons";
import "./pulse.css";

/** Pulse — notifications drift in on a decaying orbit and settle. */

const LINGER_MS = 7000;

export function Pulse() {
  const { state, actions } = useShell();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    for (const note of state.notifications) {
      if (!timers.current.has(note.id) && !state.status.focus) {
        timers.current.set(
          note.id,
          setTimeout(() => {
            actions.dismissNotification(note.id);
            timers.current.delete(note.id);
          }, LINGER_MS)
        );
      }
    }
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.notifications, state.status.focus]);

  if (state.status.focus) return null;

  return (
    <div className="pulse">
      {state.notifications.map((n) => (
        <div key={n.id} className="pulse__toast glass-heavy lens">
          <AppTile name={n.appName} hue={n.hue} size={32} />
          <div className="pulse__text">
            <span className="pulse__app">{n.appName}</span>
            <span className="pulse__title">{n.title}</span>
            <span className="pulse__body">{n.body}</span>
          </div>
          <button className="pulse__close" onClick={() => actions.dismissNotification(n.id)}>
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
