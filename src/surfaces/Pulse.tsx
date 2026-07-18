import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { CloseIcon } from "../components/Icons";
import { fitPulseWindow, setPulseInteractionRegion } from "../lib/win";
import { isTauri } from "../shell/tauri";
import "./pulse.css";

/** Pulse — notifications drift in on a decaying orbit and settle. */

const LINGER_MS = 7000;
const MAX_TRANSIENT_NOTIFICATIONS = 5;

export function Pulse() {
  const { state, actions } = useShell();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const dismiss = (id: string, remove = true) => {
    // Play the exit animation, then actually remove the note.
    setLeaving((prev) => new Set(prev).add(id));
    setTimeout(() => {
      if (remove) {
        void actions.dismissNotification(id).catch((reason) => setError(String(reason)));
      } else setHidden((prev) => new Set(prev).add(id));
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
              dismiss(note.id, false);
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
    setHidden((previous) => {
      const next = new Set([...previous].filter((id) => alive.has(id)));
      return next.size === previous.size ? previous : next;
    });
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

  const visible = state.status.focus
    ? []
    : state.notifications
        .filter((notification) => !hidden.has(notification.id))
        .slice(0, MAX_TRANSIENT_NOTIFICATIONS);

  useEffect(() => {
    void fitPulseWindow(visible.length);
  }, [visible.length]);

  useLayoutEffect(() => {
    if (!isTauri() || visible.length === 0) return;
    let disposed = false;
    let frame = 0;
    const publish = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed) return;
        const rectangles = [...document.querySelectorAll<HTMLElement>("[data-pulse-hit]")]
          .map((element) => element.getBoundingClientRect())
          .map((rect) => {
            const left = Math.max(0, rect.left - 56);
            const top = Math.max(0, rect.top - 18);
            const right = Math.min(window.innerWidth, rect.right + 20);
            const bottom = Math.min(window.innerHeight, rect.bottom + 22);
            return right - left >= 1 && bottom - top >= 1
              ? { left, top, width: right - left, height: bottom - top }
              : null;
          })
          .filter((rectangle): rectangle is NonNullable<typeof rectangle> => rectangle !== null);
        void setPulseInteractionRegion(rectangles).catch((reason) => setError(String(reason)));
      });
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
    document.querySelectorAll<HTMLElement>("[data-pulse-hit]").forEach((element) => observer?.observe(element));
    publish();
    window.addEventListener("resize", publish);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", publish);
    };
  }, [visible.length, leaving.size, error]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<boolean>("gravity://shell-active", (event) => {
        void fitPulseWindow(event.payload ? visible.length : 0);
      }).then((dispose) => { unlisten = dispose; })
    );
    return () => unlisten?.();
  }, [visible.length]);

  if (visible.length === 0) return null;

  return (
    <div className="pulse">
      {visible.map((n) => (
        <div
          key={n.id}
          data-pulse-hit
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
      {error && <button data-pulse-hit className="pulse__error glass-heavy" role="alert" onClick={() => setError(null)}>{error}</button>}
    </div>
  );
}
