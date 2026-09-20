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

export function centeredViewOnRect(view, rect, viewportWidth, viewportHeight) {
  return {
    x: viewportWidth / 2 - (rect.x + rect.width / 2) * view.scale,
    y: viewportHeight / 2 - (rect.y + rect.height / 2) * view.scale,
    scale: view.scale,
  };
}

export function rebasedView(view, viewportWidth, viewportHeight) {
  const translateX = viewportWidth / 2;
  const translateY = viewportHeight / 2;
  return {
    originX: (translateX - view.x) / view.scale,
    originY: (translateY - view.y) / view.scale,
    translateX,
    translateY,
  };
}

export const FRAME_HEADER_UNITS = 38;

// Вузол-локація малюється рамкою, тому масштаб береться за її варіантом,
// а не за типом вузла в розкладці.
export function nodeVisualScale(node, variant = node.type) {
  const [baseWidth, baseHeight] = variant === "frame" ? [360, 230]
    : variant === "image" ? [480, 320]
      : variant === "npc" ? [400, 210]
        : [320, 190];
  return Math.min(node.width / baseWidth, node.height / baseHeight);
}

export function frameHeaderHeight(width, height) {
  return FRAME_HEADER_UNITS * nodeVisualScale({ width, height }, "frame");
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
