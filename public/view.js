export function zoomedViewAt(view, localX, localY, factor) {
  const scale = view.scale * factor;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const worldX = (localX - view.x) / view.scale;
  const worldY = (localY - view.y) / view.scale;
  return {
    x: localX - worldX * scale,
    y: localY - worldY * scale,
    scale,
  };
}
