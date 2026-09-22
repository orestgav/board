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

// Те, що зараз видно на екрані, у світових координатах: зворотний бік
// перетворення screenToWorld.
export function worldViewportRect(view, viewportWidth, viewportHeight) {
  return {
    x: -view.x / view.scale,
    y: -view.y / view.scale,
    width: viewportWidth / view.scale,
    height: viewportHeight / view.scale,
  };
}

// Дотик краями рахується перетином: вузол на самій межі екрана видно.
export function rectsOverlap(first, second) {
  return first.x <= second.x + second.width && second.x <= first.x + first.width
    && first.y <= second.y + second.height && second.y <= first.y + first.height;
}

// Рамка виділення бере лише те, що влізло в неї цілком: інакше протяжка
// всередині локації чіпляла б саму локацію — і тягнула б увесь її вміст.
export function rectWithin(inner, outer) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
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

// Шапка локації нижча за спільну шапку вузла (38): під нею лежать картки,
// і висока смуга з назвою забирала б у них надто багато висоти.
export const LOCATION_HEADER_UNITS = 26;

// Вузол-локація малюється рамкою, тому масштаб береться за її варіантом,
// а не за типом вузла в розкладці.
export function nodeVisualScale(node, variant = node.type) {
  const [baseWidth, baseHeight] = variant === "frame" ? [360, 230]
    : variant === "image" ? [480, 320]
      : variant === "npc" ? [400, 210]
        : variant === "statblock" ? [440, 640]
          : variant === "music" ? [320, 46]
            : [320, 190];
  return Math.min(node.width / baseWidth, node.height / baseHeight);
}

export function locationHeaderHeight(width, height) {
  return LOCATION_HEADER_UNITS * nodeVisualScale({ width, height }, "frame");
}

// Локація лишається помітною на загальному плані без зміни геометрії картки.
// Обвід вимірюється в екранних пікселях і зникає, коли картка заповнює екран.
// Найтовстіший він посередині й тримається таким довго: картка в тридцять
// пікселів — це вже позначка на карті, і кільце тут єдине, що її показує.
// Стоншується воно аж на самому кінці, коли від картки лишається цятка на
// десяток пікселів: вісім пікселів обводу роблять із неї пляму, і міста за
// тими плямами на карті світу не видно.
export function locationBorderScreenWidth(width, height, scale, viewportWidth, viewportHeight) {
  if (viewportWidth <= 0 || viewportHeight <= 0 || scale <= 0) return 0;
  const coverage = Math.max(width * scale / viewportWidth, height * scale / viewportHeight);
  const thinnestCoverage = 0.01;
  const fullWidthCoverage = 0.04;
  const hiddenCoverage = 0.5;
  const minimumWidth = 1;
  const maximumWidth = 8;
  if (coverage <= thinnestCoverage) return minimumWidth;
  if (coverage >= hiddenCoverage) return 0;
  if (coverage >= fullWidthCoverage) {
    return maximumWidth * (hiddenCoverage - coverage) / (hiddenCoverage - fullWidthCoverage);
  }
  return minimumWidth + (maximumWidth - minimumWidth)
    * (coverage - thinnestCoverage) / (fullWidthCoverage - thinnestCoverage);
}

// Далі, ніж «найбільший вузол на 70% екрана», віддалятися нема куди: на цьому
// масштабі загальна карта читається цілком, а дрібніше дошка перетворюється
// на купку плям.
export function minimumScaleForNodes(rects, viewportWidth, viewportHeight, coverage) {
  if (!rects.length) return 0;
  const availableWidth = Math.max(1, viewportWidth * coverage);
  const availableHeight = Math.max(1, viewportHeight * coverage);
  return rects.reduce((minimum, rect) => Math.min(
    minimum,
    Math.min(availableWidth / rect.width, availableHeight / rect.height),
  ), Infinity);
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
