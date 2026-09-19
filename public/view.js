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

export function renderedNodeGeometry(node, parentRenderScale = 1, maximumCssSize = 1_000_000) {
  const localScale = Math.max(
    1,
    node.width / parentRenderScale / maximumCssSize,
    node.height / parentRenderScale / maximumCssSize,
  );
  const renderScale = parentRenderScale * localScale;
  return {
    localScale,
    renderScale,
    width: node.width / renderScale,
    height: node.height / renderScale,
    fontSize: nodeVisualScale(node) / renderScale,
  };
}

export function minimumScaleForNodes(rects, minimumVisiblePixels) {
  const largestDimension = rects.reduce((largest, rect) => Math.max(largest, rect.width, rect.height), 0);
  return largestDimension > 0 ? minimumVisiblePixels / largestDimension : 0;
}

export function maximumScaleForNodes(rects, viewportWidth, viewportHeight, padding) {
  if (!rects.length) return Infinity;
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  return rects.reduce((maximum, rect) => Math.max(
    maximum,
    Math.min(availableWidth / rect.width, availableHeight / rect.height),
  ), 0);
}
