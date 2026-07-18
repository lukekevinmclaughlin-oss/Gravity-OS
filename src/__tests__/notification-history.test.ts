import { afterEach, describe, expect, it } from "vitest";
import { clearNotificationHistory, readNotificationHistory, recordNotifications } from "../lib/notificationHistory";

const store = new Map<string, string>();
const events: string[] = [];

describe("notification history", () => {
  afterEach(() => {
    store.clear();
    events.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage;
  });

  const install = () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    (globalThis as { window?: unknown }).window ??= globalThis;
    (globalThis as { CustomEvent?: unknown }).CustomEvent ??= class {
      constructor(public type: string) {}
    };
    (globalThis as unknown as { window: { dispatchEvent?: (event: { type: string }) => boolean } }).window.dispatchEvent =
      (event: { type: string }) => {
        events.push(event.type);
        return true;
      };
  };

  const note = (id: string) => ({ id, appName: "Mail", hue: 210, title: `Note ${id}`, body: "b" });

  it("records unseen notes once, newest first, and clears on demand", () => {
    install();
    recordNotifications([note("a"), note("b")]);
    recordNotifications([note("b"), note("c")]);
    const history = readNotificationHistory();
    expect(history.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
    expect(events.length).toBe(2);
    clearNotificationHistory();
    expect(readNotificationHistory()).toEqual([]);
  });

  it("drops malformed and stale entries on read", () => {
    install();
    store.set("gravity.notification-history.v1", JSON.stringify([
      { id: "ok", appName: "Mail", hue: 1, title: "t", body: "b", seenAt: Date.now() },
      { id: "stale", appName: "Mail", hue: 1, title: "t", body: "b", seenAt: Date.now() - 8 * 24 * 3600 * 1000 },
      { nonsense: true },
    ]));
    expect(readNotificationHistory().map((entry) => entry.id)).toEqual(["ok"]);
  });
});
