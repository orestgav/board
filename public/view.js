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

export function nodeVisualScale(node) {
  const [baseWidth, baseHeight] = node.type === "frame" ? [360, 230]
    : node.type === "image" ? [480, 320]
      : [320, 190];
  return Math.min(node.width / baseWidth, node.height / baseHeight);
}
