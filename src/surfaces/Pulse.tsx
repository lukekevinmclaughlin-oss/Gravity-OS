import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShell } from "../shell/context";
import { AppTile } from "../components/AppTile";
import { CloseIcon } from "../components/Icons";
import { fitPulseWindow, setPulseInteractionRegion } from "../lib/win";
import { recordNotifications } from "../lib/notificationHistory";
import { isTauri } from "../shell/tauri";
import "./pulse.css";

/** Pulse — notifications drift in on a decaying orbit and settle. */

const LINGER_MS = 6000;
const MAX_TRANSIENT_NOTIFICATIONS = 5;
const SWIPE_COMMIT_PX = 120;
const SWIPE_COMMIT_VELOCITY = 0.55; // px per ms

interface LingerTimer {
  handle: ReturnType<typeof setTimeout> | null;
  deadline: number;
  remaining: number | null;
}

export function Pulse() {
  const { state, actions } = useShell();
  const timers = useRef(new Map<string, LingerTimer>());
  const swipeSession = useRef<{ id: string; pointerId: number; startX: number; startY: number; lastX: number; lastTime: number; velocity: number; active: boolean } | null>(null);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [swipedFrom, setSwipedFrom] = useState<ReadonlyMap<string, number>>(new Map());
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const dismiss = (id: string, remove = true, swipeFromDx?: number) => {
    // Play the exit animation, then actually remove the note.
    if (swipeFromDx !== undefined) setSwipedFrom((prev) => new Map(prev).set(id, swipeFromDx));
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
      setSwipedFrom((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }, 240);
  };

  // Hovering a banner pauses its linger clock; leaving resumes what was left.
  const pauseLinger = (id: string) => {
    const timer = timers.current.get(id);
    if (!timer || timer.handle === null) return;
    clearTimeout(timer.handle);
    timer.handle = null;
    timer.remaining = Math.max(800, timer.deadline - Date.now());
  };

  const resumeLinger = (id: string) => {
    const timer = timers.current.get(id);
    if (!timer || timer.handle !== null || timer.remaining === null) return;
    timer.deadline = Date.now() + timer.remaining;
    timer.handle = setTimeout(() => {
      timers.current.delete(id);
      dismiss(id, false);
    }, timer.remaining);
    timer.remaining = null;
  };

  // Every mirrored note lands in the shared history, including those Focus
  // silences — the clock popover is where silenced notes surface later.
  useEffect(() => {
    recordNotifications(state.notifications);
  }, [state.notifications]);

  useEffect(() => {
    // Arm a linger timer once per note; leave existing timers alone so churn
    // in the notification list doesn't reset them (they'd never expire).
    if (!state.status.focus) {
      for (const note of state.notifications) {
        if (!timers.current.has(note.id)) {
          timers.current.set(note.id, {
            deadline: Date.now() + LINGER_MS,
            remaining: null,
            handle: setTimeout(() => {
              timers.current.delete(note.id);
              dismiss(note.id, false);
            }, LINGER_MS),
          });
        }
      }
    }
    // Drop timers for notes that no longer exist.
    const alive = new Set(state.notifications.map((n) => n.id));
    for (const [id, timer] of timers.current) {
      if (!alive.has(id)) {
        if (timer.handle !== null) clearTimeout(timer.handle);
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
      map.forEach((timer) => {
        if (timer.handle !== null) clearTimeout(timer.handle);
      });
      map.clear();
    };
  }, []);

  const beginSwipe = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".pulse__close")) return;
    swipeSession.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      velocity: 0,
      active: false,
    };
    pauseLinger(id);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveSwipe = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    const session = swipeSession.current;
    if (!session || session.id !== id || session.pointerId !== event.pointerId) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (!session.active) {
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
      session.active = true;
    }
    const elapsed = Math.max(1, event.timeStamp - session.lastTime);
    session.velocity = (event.clientX - session.lastX) / elapsed;
    session.lastX = event.clientX;
    session.lastTime = event.timeStamp;
    // Only rightward travel dismisses; leftward pulls resist to a nudge.
    setDrag({ id, dx: dx > 0 ? dx : Math.max(-24, dx / 6) });
  };

  const endSwipe = (event: React.PointerEvent<HTMLDivElement>, id: string) => {
    const session = swipeSession.current;
    if (!session || session.id !== id || session.pointerId !== event.pointerId) return;
    swipeSession.current = null;
    const dx = event.clientX - session.startX;
    setDrag(null);
    if (session.active && (dx > SWIPE_COMMIT_PX || (dx > 24 && session.velocity > SWIPE_COMMIT_VELOCITY))) {
      dismiss(id, true, dx);
      return;
    }
    resumeLinger(id);
  };

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
      {visible.map((n) => {
        const dragging = drag?.id === n.id;
        const swipeStart = swipedFrom.get(n.id);
        return (
          <div
            key={n.id}
            data-pulse-hit
            className={`pulse__toast glass-heavy lens ${leaving.has(n.id) ? (swipeStart !== undefined ? "is-swiped" : "is-leaving") : ""} ${dragging ? "is-dragging" : ""}`}
            style={{
              ...(dragging ? { transform: `translate3d(${drag.dx}px, 0, 0)`, opacity: Math.max(0.2, 1 - Math.max(0, drag.dx) / 300) } : {}),
              ...(swipeStart !== undefined ? { "--pulse-swipe-from": `${swipeStart}px` } : {}),
            } as React.CSSProperties}
            onPointerEnter={() => pauseLinger(n.id)}
            onPointerLeave={() => {
              if (swipeSession.current?.id !== n.id) resumeLinger(n.id);
            }}
            onPointerDown={(event) => beginSwipe(event, n.id)}
            onPointerMove={(event) => moveSwipe(event, n.id)}
            onPointerUp={(event) => endSwipe(event, n.id)}
            onPointerCancel={(event) => endSwipe(event, n.id)}
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
        );
      })}
      {error && <button data-pulse-hit className="pulse__error glass-heavy" role="alert" onClick={() => setError(null)}>{error}</button>}
    </div>
  );
}
