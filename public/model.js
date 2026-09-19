export const WORLD_SIZE = 10_000;

export function cloneLayout(layout) {
  return structuredClone(layout);
}

export function walkNodes(children, visit, parent = null, depth = 0) {
  children.forEach((node, index) => {
    visit({ node, parent, children, index, depth });
    walkNodes(node.children, visit, node, depth + 1);
  });
}

export function findEntry(layout, id) {
  let result = null;
  walkNodes(layout.children, (entry) => {
    if (!result && entry.node.id === id) result = entry;
  });
  return result;
}

export function findNode(layout, id) {
  return findEntry(layout, id)?.node ?? null;
}

export function parentRect(layout, parent) {
  if (!parent) return { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE };
  return absoluteRect(layout, parent.id);
}

export function absoluteRect(layout, id) {
  const path = [];
  let entry = findEntry(layout, id);
  if (!entry) return null;
  path.unshift(entry.node);
  while (entry.parent) {
    entry = findEntry(layout, entry.parent.id);
    path.unshift(entry.node);
  }

  let area = { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE };
  for (const node of path) {
    area = {
      x: area.x + node.x * area.width / 100,
      y: area.y + node.y * area.height / 100,
      width: node.width,
      height: node.height,
    };
  }
  return area;
}

export function isDescendant(layout, ancestorId, candidateId) {
  const ancestor = findNode(layout, ancestorId);
  if (!ancestor) return false;
  let found = false;
  walkNodes(ancestor.children, ({ node }) => { if (node.id === candidateId) found = true; });
  return found;
}

function contains(rect, point) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export function deepestNodeAt(layout, point, { includeLocked = false, excludeId = null } = {}) {
  let winner = null;
  let order = 0;
  walkNodes(layout.children, ({ node, depth }) => {
    order += 1;
    if (node.id === excludeId || (excludeId && isDescendant(layout, excludeId, node.id))) return;
    if (!includeLocked && node.locked) return;
    const rect = absoluteRect(layout, node.id);
    if (contains(rect, point) && (!winner || depth > winner.depth || (depth === winner.depth && order > winner.order))) {
      winner = { node, depth, order };
    }
  });
  return winner?.node ?? null;
}

export function deepestContainerAt(layout, point, excludeId) {
  return deepestNodeAt(layout, point, { includeLocked: true, excludeId });
}

export function reparentNode(layout, id, newParentId) {
  const entry = findEntry(layout, id);
  if (!entry || id === newParentId || (newParentId && isDescendant(layout, id, newParentId))) return false;
  if ((entry.parent?.id ?? null) === (newParentId ?? null)) return false;

  const absolute = absoluteRect(layout, id);
  const newParent = newParentId ? findNode(layout, newParentId) : null;
  if (newParentId && !newParent) return false;
  const destination = newParent ? newParent.children : layout.children;
  const targetRect = parentRect(layout, newParent);
  const [node] = entry.children.splice(entry.index, 1);
  node.x = (absolute.x - targetRect.x) / targetRect.width * 100;
  node.y = (absolute.y - targetRect.y) / targetRect.height * 100;
  destination.push(node);
  return true;
}

export function reorderNode(layout, id, operation) {
  const entry = findEntry(layout, id);
  if (!entry) return false;
  const last = entry.children.length - 1;
  const target = operation === "front" ? last
    : operation === "back" ? 0
      : operation === "forward" ? Math.min(last, entry.index + 1)
        : Math.max(0, entry.index - 1);
  if (target === entry.index) return false;
  const [node] = entry.children.splice(entry.index, 1);
  entry.children.splice(target, 0, node);
  return true;
}

export function allAbsoluteRects(layout) {
  const result = [];
  walkNodes(layout.children, ({ node }) => result.push({ id: node.id, ...absoluteRect(layout, node.id) }));
  return result;
}

export function nearestPointParent(layout, point) {
  const parent = deepestNodeAt(layout, point, { includeLocked: true });
  const rect = parent ? absoluteRect(layout, parent.id) : { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE };
  return { parent, rect };
}

export function lineage(layout, id) {
  const result = [];
  let entry = id ? findEntry(layout, id) : null;
  while (entry) {
    result.push(entry.node);
    entry = entry.parent ? findEntry(layout, entry.parent.id) : null;
  }
  return result;
}

export function nearestAncestor(layout, id, predicate) {
  return lineage(layout, id).find(predicate) ?? null;
}
