import { useEffect, useState } from "react";
import type { PulseNote } from "../shell/types";

/** Notification history (NS-8-lite): every note Pulse mirrors is recorded to
 *  shared browser storage so the Horizon clock popover can show what arrived
 *  even after banners expire. Capped and age-limited; a SQLite-backed store
 *  (NS-5) later replaces the persistence layer without changing this API. */

export interface HistoryNote extends PulseNote {
  seenAt: number;
}

const STORAGE_KEY = "gravity.notification-history.v1";
const EVENT = "gravity:notification-history-changed";
const CAP = 100;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function readNotificationHistory(): HistoryNote[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - MAX_AGE_MS;
    return parsed
      .filter((note): note is HistoryNote =>
        typeof note === "object" && note !== null
        && typeof (note as HistoryNote).id === "string"
        && typeof (note as HistoryNote).appName === "string"
        && typeof (note as HistoryNote).title === "string"
        && typeof (note as HistoryNote).seenAt === "number"
        && (note as HistoryNote).seenAt > cutoff)
      .slice(0, CAP);
  } catch {
    return [];
  }
}

export function recordNotifications(notes: readonly PulseNote[]): void {
  if (notes.length === 0) return;
  try {
    const existing = readNotificationHistory();
    const known = new Set(existing.map((note) => note.id));
    const fresh = notes
      .filter((note) => !known.has(note.id))
      .map((note) => ({ ...note, body: note.body.slice(0, 300), seenAt: Date.now() }));
    if (fresh.length === 0) return;
    const merged = [...fresh, ...existing].slice(0, CAP);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // History is best-effort; live banners are unaffected.
  }
}

export function clearNotificationHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // Nothing to clear.
  }
}

export function useNotificationHistory(): HistoryNote[] {
  const [history, setHistory] = useState(readNotificationHistory);
  useEffect(() => {
    const refresh = () => setHistory(readNotificationHistory());
    const storage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", storage);
    window.addEventListener(EVENT, refresh);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener(EVENT, refresh);
    };
  }, []);
  return history;
}
