import type { WellDefinition } from "./wells";

export interface NormalizedRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const X_MIN = .04;
const X_MAX = .96;
const Y_MIN = .08;
const Y_MAX = .9;

export function toggleWellSelection(
  current: ReadonlySet<string>,
  id: string,
  additive: boolean,
): ReadonlySet<string> {
  if (!additive) return new Set([id]);
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function wellsInMarquee(
  wells: readonly WellDefinition[],
  monitor: number,
  rect: NormalizedRect,
  viewportWidth: number,
  viewportHeight: number,
): ReadonlySet<string> {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  return new Set(wells
    .filter((well) => {
      if (well.monitor !== monitor) return false;
      const radiusX = 64 * well.scale / width;
      const radiusY = 73 * well.scale / height;
      return well.x + radiusX >= rect.left
        && well.x - radiusX <= rect.right
        && well.y + radiusY >= rect.top
        && well.y - radiusY <= rect.bottom;
    })
    .map((well) => well.id));
}

export function translateWellGroup(
  wells: readonly WellDefinition[],
  ids: ReadonlySet<string>,
  anchorId: string,
  targetX: number,
  targetY: number,
  targetMonitor?: number,
): WellDefinition[] {
  const selected = wells.filter((well) => ids.has(well.id));
  const anchor = selected.find((well) => well.id === anchorId);
  if (!anchor || selected.length === 0) return [...wells];

  const requestedX = targetX - anchor.x;
  const requestedY = targetY - anchor.y;
  const minX = Math.min(...selected.map((well) => well.x));
  const maxX = Math.max(...selected.map((well) => well.x));
  const minY = Math.min(...selected.map((well) => well.y));
  const maxY = Math.max(...selected.map((well) => well.y));
  const dx = Math.max(X_MIN - minX, Math.min(X_MAX - maxX, requestedX));
  const dy = Math.max(Y_MIN - minY, Math.min(Y_MAX - maxY, requestedY));

  return wells.map((well) => ids.has(well.id)
    ? {
      ...well,
      x: Math.max(X_MIN, Math.min(X_MAX, well.x + dx)),
      y: Math.max(Y_MIN, Math.min(Y_MAX, well.y + dy)),
      monitor: targetMonitor ?? well.monitor,
    }
    : well);
}

export function scaleWellGroup(
  wells: readonly WellDefinition[],
  ids: ReadonlySet<string>,
  delta: number,
): WellDefinition[] {
  return wells.map((well) => ids.has(well.id)
    ? { ...well, scale: Math.max(.7, Math.min(1.5, well.scale + delta)) }
    : well);
}
