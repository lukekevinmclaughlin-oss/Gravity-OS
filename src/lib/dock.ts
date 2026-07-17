export function reorderPinnedIds(ids: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId || !ids.includes(draggedId) || !ids.includes(targetId)) return ids;
  const next = ids.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex, 0, draggedId);
  return next;
}
