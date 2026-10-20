// Placement. Two modes:
//
// - full: ELK's layered algorithm lays out every node and group (groups are
//   compound nodes, so nesting is respected and edges are routed around
//   boxes). Used while nobody has hand-placed anything, and on an explicit
//   `layout` op.
// - incremental: once a person has moved something, existing positions are
//   kept and only elements without a position are placed, next to a
//   connected neighbour, in the first spot that overlaps nothing.
//
// Notes are never part of the graph layout: they are placed afterwards beside
// what they are attached to.

import ELK from "elkjs/lib/elk.bundled.js";

import {
  fitRouteToOutlines,
  labelBoxOnRoute,
  overlaps,
  routeHitsBox,
  straightBetween,
  straightRoute,
} from "./geometry";

import { endOf } from "./model";

import type { Box, Outline, Point } from "./geometry";
import type { Direction, Layout, Model } from "./model";

export type Size = { width: number; height: number };
export type { Box };

export const GROUP_PAD = { top: 52, side: 28, bottom: 28 };
const GAP = 60;
const LAYER_GAP = 110;
const NOTE_GAP = 36;
// how far around its target a note looks for a free place, and in what steps
const NEAR_REACH = 520;
const NEAR_STEP = 20;

const elk = new ELK();

const bounds = (boxes: Box[]): Box | null => {
  if (!boxes.length) {
    return null;
  }
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.width));
  const y2 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

const ancestors = (model: Model, groupId: string | undefined) => {
  const chain: string[] = [];
  let cursor = groupId;
  while (cursor && !chain.includes(cursor)) {
    chain.push(cursor);
    cursor = model.groups.get(cursor)?.parent;
  }
  return chain;
};

/** Every group's box derived from its members (nodes and child groups). */
export const fitGroups = (model: Model) => {
  const depth = (id: string) => ancestors(model, id).length;
  const groups = [...model.groups.values()].sort(
    (a, b) => depth(b.id) - depth(a.id),
  );
  for (const group of groups) {
    const members: Box[] = [];
    for (const node of [...model.nodes.values(), ...model.blocks.values()]) {
      if (node.group === group.id && node.x !== undefined) {
        members.push(node as Box);
      }
    }
    for (const child of model.groups.values()) {
      if (child.parent === group.id && child.x !== undefined) {
        members.push(child as Box);
      }
    }
    const inner = bounds(members);
    if (!inner) {
      if (group.x === undefined) {
        group.width = 240;
        group.height = 140;
      }
      continue;
    }
    const fitted: Box = {
      x: inner.x - GROUP_PAD.side,
      y: inner.y - GROUP_PAD.top,
      width: inner.width + GROUP_PAD.side * 2,
      height: inner.height + GROUP_PAD.top + GROUP_PAD.bottom,
    };
    if (group.slide) {
      fitted.width = Math.max(fitted.width, SLIDE.width);
      fitted.height = Math.max(fitted.height, SLIDE.height);
    }
    if (group.pinned && group.x !== undefined) {
      // a hand-placed group keeps its box but always contains its members
      const merged = bounds([group as Box, fitted])!;
      Object.assign(group, merged);
    } else {
      Object.assign(group, fitted);
    }
  }
};

type ElkNode = {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  labels?: { text: string; width: number; height: number }[];
  layoutOptions?: Record<string, string>;
  edges?: unknown[];
};

/** Where a container's members are laid: groups nest, the drawing is the root. */
type Container = string | undefined;

const containerOf = (model: Model, id: string): Container =>
  model.nodes.get(id)?.group ??
  model.blocks.get(id)?.group ??
  model.groups.get(id)?.parent;

/**
 * A group lays its members out its own way, else the way its parent does;
 * except that a grid is for things that are not connected, so a group whose
 * members are joined by an edge and that names no layout is layered.
 */
export const algorithmOf = (model: Model, container: Container): Layout => {
  if (container === undefined) {
    return model.meta.layout ?? "layered";
  }
  const group = model.groups.get(container);
  if (group?.layout) {
    return group.layout;
  }
  const inherited = algorithmOf(model, group?.parent);
  if (inherited !== "grid") {
    return inherited;
  }
  const inside = (id: string) => containerOf(model, id) === container;
  return [...model.edges.values()].some((e) => inside(e.from) && inside(e.to))
    ? "layered"
    : "grid";
};

/** A slide is a 16:9 frame however little it holds. */
export const SLIDE = { width: 960, height: 540 };

const minimumOf = (model: Model, container: Container) =>
  container !== undefined && model.groups.get(container)?.slide
    ? SLIDE
    : { width: 240, height: 120 };

const padOf = (container: Container) =>
  container === undefined ? { top: 0, side: 0, bottom: 0 } : GROUP_PAD;

const ELK_LAYERED = (direction: Direction) => ({
  "elk.algorithm": "layered",
  "elk.direction": direction,
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.spacing.nodeNode": String(GAP),
  "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYER_GAP),
  "elk.spacing.edgeNode": "30",
  "elk.spacing.edgeEdge": "20",
  "elk.layered.spacing.edgeNodeBetweenLayers": "30",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
  "elk.edgeLabels.placement": "CENTER",
  // every route in one coordinate system, whatever group the ends are in
  "elk.json.edgeCoords": "ROOT",
});

const ELK_FLAT = (
  layout: Layout,
  direction: Direction,
): Record<string, string> =>
  layout === "tree"
    ? {
        "elk.algorithm": "mrtree",
        "elk.direction": direction,
        "elk.spacing.nodeNode": String(GAP),
        "elk.json.edgeCoords": "ROOT",
      }
    : {
        "elk.algorithm": "radial",
        "elk.spacing.nodeNode": String(GAP),
        "elk.radial.compactor": "WEDGE_COMPACTION",
        "elk.json.edgeCoords": "ROOT",
      };

/**
 * Lays out every node, block and group. Each container (the drawing, or a
 * group) arranges its direct members with its own algorithm:
 *
 * - layered (default): ELK's layered algorithm; groups that are also layered
 *   are its compound nodes, so nesting is respected and edges are routed
 *   around boxes;
 * - tree: ELK's mrtree (org charts, hierarchies, decision trees);
 * - radial: ELK's radial (mind maps), the first root in the middle;
 * - grid: members in rows and columns, in the order they were made (boards,
 *   card walls, slide decks).
 *
 * A member group with another algorithm is laid out first and placed as one
 * box. An edge is routed when the run that placed both its ends routes; any
 * other edge is drawn as an elbow arrow the editor routes.
 */
export const fullLayout = async (
  model: Model,
  sizes: Map<string, Size>,
  edgeLabelSizes: Map<string, Size>,
  opts: { keepPinned: boolean; outlines?: Map<string, Outline> },
) => {
  const direction: Direction = model.meta.direction;
  const leaves = () => [
    ...([...model.nodes.values(), ...model.blocks.values()] as {
      id: string;
      x?: number;
      y?: number;
      pinned: boolean;
    }[]),
  ];
  const before = bounds(
    [
      ...model.nodes.values(),
      ...model.groups.values(),
      ...model.blocks.values(),
    ].filter((b) => b.x !== undefined) as Box[],
  );
  const kept = new Map<string, [number, number]>();
  if (opts.keepPinned) {
    for (const leaf of leaves()) {
      if (leaf.pinned && leaf.x !== undefined) {
        kept.set(leaf.id, [leaf.x, leaf.y!]);
      }
    }
  }

  // positions relative to the top-left corner of the box of the container
  // they are in; a group's own entry is its box in its parent's frame
  const local = new Map<string, [number, number]>();
  const groupSize = new Map<string, Size>();
  // routes relative to the container whose run routed them
  const routes = new Map<
    string,
    { container: Container; points: Point[]; straight?: boolean }
  >();

  const membersOf = (container: Container) => ({
    groups: [...model.groups.values()].filter((g) => g.parent === container),
    blocks: [...model.blocks.values()].filter((b) => b.group === container),
    nodes: [...model.nodes.values()].filter((n) => n.group === container),
  });
  const sizeOf = (id: string): Size =>
    groupSize.get(id) ?? sizes.get(id) ?? { width: 140, height: 64 };

  const layLayered = async (container: Container) => {
    const pad = padOf(container);
    // groups in this run: same algorithm, reachable through same-run groups
    const runGroups = new Set<string>();
    const elkGroups = new Map<string, ElkNode>();
    const build = async (parent: Container, into: ElkNode) => {
      const { groups, blocks, nodes } = membersOf(parent);
      for (const group of groups) {
        if (algorithmOf(model, group.id) === "layered") {
          runGroups.add(group.id);
          const min = minimumOf(model, group.id);
          const child: ElkNode = {
            id: `g:${group.id}`,
            children: [],
            labels: [{ text: group.label, width: 10, height: 10 }],
            layoutOptions: {
              "elk.padding": `[top=${GROUP_PAD.top},left=${GROUP_PAD.side},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.side}]`,
              ...(group.slide
                ? {
                    "elk.nodeSize.constraints": "MINIMUM_SIZE",
                    "elk.nodeSize.minimum": `(${min.width},${min.height})`,
                  }
                : null),
            },
          };
          elkGroups.set(group.id, child);
          into.children!.push(child);
          await build(group.id, child);
          if (!child.children!.length) {
            child.width = 240;
            child.height = 120;
          }
        } else {
          await layContainer(group.id);
          const size = sizeOf(group.id);
          into.children!.push({ id: `x:${group.id}`, ...size });
        }
      }
      for (const item of [...nodes, ...blocks]) {
        const size = sizeOf(item.id);
        into.children!.push({ id: `n:${item.id}`, ...size });
      }
    };
    const root: ElkNode = {
      id: "root",
      children: [],
      layoutOptions: {
        ...ELK_LAYERED(direction),
        "elk.padding": `[top=${pad.top},left=${pad.side},bottom=${pad.bottom},right=${pad.side}]`,
      },
      edges: [],
    };
    await build(container, root);
    // an edge is this run's when both ends are leaves placed by it
    const inRun = (id: string) => {
      let cursor = containerOf(model, id);
      for (let n = 0; n < 60; n++) {
        if (cursor === container) {
          return true;
        }
        if (cursor === undefined || !runGroups.has(cursor)) {
          return false;
        }
        cursor = model.groups.get(cursor)?.parent;
      }
      return false;
    };
    for (const edge of model.edges.values()) {
      if (!endOf(model, edge.from) || !endOf(model, edge.to)) {
        continue;
      }
      if (!inRun(edge.from) || !inRun(edge.to)) {
        continue;
      }
      const label = edgeLabelSizes.get(edge.id);
      root.edges!.push({
        id: `e:${edge.id}`,
        sources: [`n:${edge.from}`],
        targets: [`n:${edge.to}`],
        labels: label
          ? [
              {
                text: edge.label,
                width: label.width + 16,
                height: label.height + 8,
              },
            ]
          : [],
      });
    }
    const laid = (await elk.layout(root as never)) as unknown as ElkNode;
    const walk = (node: ElkNode) => {
      for (const child of node.children ?? []) {
        const id = child.id.slice(2);
        local.set(id, [child.x ?? 0, child.y ?? 0]);
        if (child.id.startsWith("g:")) {
          groupSize.set(id, { width: child.width!, height: child.height! });
          walk(child);
        }
      }
    };
    walk(laid);
    for (const e of (laid.edges ?? []) as ElkEdge[]) {
      const section = e.sections?.[0];
      if (!section) {
        continue;
      }
      routes.set(e.id.slice(2), {
        container,
        points: [
          section.startPoint,
          ...(section.bendPoints ?? []),
          section.endPoint,
        ].map((p) => [p.x, p.y] as Point),
      });
    }
    return { width: laid.width ?? 0, height: laid.height ?? 0 };
  };

  const layFlat = async (container: Container, layout: Layout) => {
    const pad = padOf(container);
    const { groups, blocks, nodes } = membersOf(container);
    for (const group of groups) {
      await layContainer(group.id);
    }
    const members = [
      ...groups.map((g) => g.id),
      ...blocks.map((b) => b.id),
      ...nodes.map((n) => n.id),
    ];
    const placed = new Map<string, [number, number]>();
    if (layout === "grid") {
      const columns =
        (container === undefined
          ? model.meta.columns
          : model.groups.get(container)?.columns) ??
        Math.max(1, Math.ceil(Math.sqrt(members.length)));
      const gap = groups.length ? GAP * 1.5 : GAP / 1.5;
      const colW: number[] = [];
      const rowH: number[] = [];
      members.forEach((id, k) => {
        const size = sizeOf(id);
        const c = k % columns;
        const r = Math.floor(k / columns);
        colW[c] = Math.max(colW[c] ?? 0, size.width);
        rowH[r] = Math.max(rowH[r] ?? 0, size.height);
      });
      members.forEach((id, k) => {
        const c = k % columns;
        const r = Math.floor(k / columns);
        const x = colW.slice(0, c).reduce((a, b) => a + b + gap, 0);
        const y = rowH.slice(0, r).reduce((a, b) => a + b + gap, 0);
        placed.set(id, [x, y]);
      });
    } else {
      const root: ElkNode = {
        id: "root",
        children: members.map((id) => ({ id: `n:${id}`, ...sizeOf(id) })),
        layoutOptions: ELK_FLAT(layout, direction),
        edges: [],
      };
      const ids = new Set(members);
      for (const edge of model.edges.values()) {
        if (ids.has(edge.from) && ids.has(edge.to)) {
          root.edges!.push({
            id: `e:${edge.id}`,
            sources: [`n:${edge.from}`],
            targets: [`n:${edge.to}`],
          });
        }
      }
      const laid = (await elk.layout(root as never)) as unknown as ElkNode;
      for (const child of laid.children ?? []) {
        placed.set(child.id.slice(2), [child.x ?? 0, child.y ?? 0]);
      }
      // radial and tree draw straight connections; the editor binds them
    }
    const all = bounds(
      members.map((id) => ({
        x: placed.get(id)![0],
        y: placed.get(id)![1],
        ...sizeOf(id),
      })),
    ) ?? { x: 0, y: 0, width: 0, height: 0 };
    for (const id of members) {
      const [x, y] = placed.get(id)!;
      local.set(id, [x - all.x + pad.side, y - all.y + pad.top]);
    }
    if (layout === "radial") {
      // a mind map's branches are straight lines from the middle outwards
      const boxOf = (id: string): Box => ({
        x: local.get(id)![0],
        y: local.get(id)![1],
        ...sizeOf(id),
      });
      const leaves = new Set([...blocks, ...nodes].map((n) => n.id));
      for (const edge of model.edges.values()) {
        if (leaves.has(edge.from) && leaves.has(edge.to)) {
          routes.set(edge.id, {
            container,
            points: straightRoute(boxOf(edge.from), boxOf(edge.to)),
            straight: true,
          });
        }
      }
    }
    return {
      width: all.width + pad.side * 2,
      height: all.height + pad.top + pad.bottom,
    };
  };

  const layContainer = async (container: Container): Promise<Size> => {
    const layout = algorithmOf(model, container);
    const size =
      layout === "layered"
        ? await layLayered(container)
        : await layFlat(container, layout);
    if (container !== undefined) {
      const min = minimumOf(model, container);
      groupSize.set(container, {
        width: Math.max(size.width, min.width),
        height: Math.max(size.height, min.height),
      });
    }
    return size;
  };

  await layContainer(undefined);

  // local frames to absolute positions, starting where the drawing was
  const origin = before ? { x: before.x, y: before.y } : { x: 0, y: 0 };
  const originOf = new Map<Container, [number, number]>([
    [undefined, [origin.x, origin.y]],
  ]);
  const absolute = (container: Container): [number, number] => {
    const known = originOf.get(container);
    if (known) {
      return known;
    }
    const [px, py] = absolute(model.groups.get(container!)?.parent);
    const [lx, ly] = local.get(container!) ?? [0, 0];
    const at: [number, number] = [px + lx, py + ly];
    originOf.set(container, at);
    return at;
  };
  for (const item of [...model.nodes.values(), ...model.blocks.values()]) {
    const [ox, oy] = absolute(item.group);
    const [lx, ly] = local.get(item.id) ?? [0, 0];
    const size = sizes.get(item.id);
    if (size) {
      item.width = size.width;
      item.height = size.height;
    }
    const keep = kept.get(item.id);
    if (keep) {
      [item.x, item.y] = keep;
    } else {
      item.x = ox + lx;
      item.y = oy + ly;
      item.pinned = false;
    }
  }
  for (const group of model.groups.values()) {
    if (!(opts.keepPinned && group.pinned)) {
      group.pinned = false;
    }
  }

  const routed = new Set<string>();
  for (const [id, route] of routes) {
    const edge = model.edges.get(id);
    if (!edge) {
      continue;
    }
    const from = endOf(model, edge.from)!;
    const to = endOf(model, edge.to)!;
    if (kept.has(edge.from) || kept.has(edge.to)) {
      continue;
    }
    const [ox, oy] = absolute(route.container);
    edge.points = route.points.map(
      ([x, y]) => [ox + x, oy + y] as [number, number],
    );
    if (route.straight) {
      edge.points = straightBetween(
        { box: from as Box, outline: opts.outlines?.get(from.id) ?? "rect" },
        { box: to as Box, outline: opts.outlines?.get(to.id) ?? "rect" },
      );
      routed.add(edge.id);
      continue;
    }
    // ELK sees every node as a rectangle: end on a diamond's or ellipse's line
    edge.points = fitRouteToOutlines(
      edge.points,
      { box: from as Box, outline: opts.outlines?.get(from.id) ?? "rect" },
      { box: to as Box, outline: opts.outlines?.get(to.id) ?? "rect" },
    );
    routed.add(edge.id);
  }
  for (const edge of model.edges.values()) {
    if (!routed.has(edge.id)) {
      edge.points = undefined;
    }
  }
  fitGroups(model);
};

type ElkPoint = { x: number; y: number };
type ElkEdge = {
  id: string;
  sections?: {
    startPoint: ElkPoint;
    endPoint: ElkPoint;
    bendPoints?: ElkPoint[];
  }[];
};

const sideStep = (direction: Direction) =>
  direction === "RIGHT" || direction === "LEFT"
    ? { dx: 0, dy: 1 }
    : { dx: 1, dy: 0 };

/** Places nodes that have no position yet, without moving anything else. */
export const incrementalLayout = (model: Model, sizes: Map<string, Size>) => {
  const direction = model.meta.direction;
  const placed = (): Box[] => [
    ...([...model.nodes.values()].filter((n) => n.x !== undefined) as Box[]),
    ...([...model.blocks.values()].filter((n) => n.x !== undefined) as Box[]),
    ...([...model.notes.values()].filter((n) => n.x !== undefined) as Box[]),
  ];

  const fresh = [...model.nodes.values(), ...model.blocks.values()].filter(
    (n) => n.x === undefined,
  );
  for (const node of fresh) {
    const size = sizes.get(node.id)!;
    node.width = size.width;
    node.height = size.height;

    const neighbours = [...model.edges.values()]
      .filter((e) => e.from === node.id || e.to === node.id)
      .map((e) => ({
        other: endOf(model, e.from === node.id ? e.to : e.from),
        outgoing: e.to === node.id, // the neighbour points at this node
      }))
      .filter((n) => n.other && n.other.x !== undefined);

    let start: { x: number; y: number };
    if (neighbours.length) {
      const { other, outgoing } = neighbours[0];
      const sign = outgoing ? 1 : -1;
      const o = other as Box;
      switch (direction) {
        case "RIGHT":
          start = {
            x:
              o.x +
              sign * (o.width + LAYER_GAP) +
              (sign < 0 ? o.width - size.width : 0),
            y: o.y,
          };
          break;
        case "LEFT":
          start = { x: o.x - sign * (size.width + LAYER_GAP), y: o.y };
          break;
        case "DOWN":
          start = {
            x: o.x,
            y:
              o.y +
              sign * (o.height + LAYER_GAP) +
              (sign < 0 ? o.height - size.height : 0),
          };
          break;
        case "UP":
          start = { x: o.x, y: o.y - sign * (size.height + LAYER_GAP) };
          break;
      }
    } else {
      const siblings = [
        ...model.nodes.values(),
        ...model.blocks.values(),
      ].filter(
        (n) => n !== node && n.group === node.group && n.x !== undefined,
      ) as Box[];
      const area = bounds(siblings.length ? siblings : placed());
      start = area
        ? direction === "RIGHT" || direction === "LEFT"
          ? { x: area.x, y: area.y + area.height + GAP }
          : { x: area.x + area.width + GAP, y: area.y }
        : { x: 0, y: 0 };
    }

    const step = sideStep(direction);
    const others = placed();
    const free = (c: Box) => !others.some((b) => overlaps(c, b, GAP / 2));
    let candidate: Box = { ...start, ...size };
    for (let i = 0; i < 200; i++) {
      const offset = Math.ceil(i / 2) * (i % 2 ? 1 : -1) * 40;
      candidate = {
        x: start.x + step.dx * offset,
        y: start.y + step.dy * offset,
        ...size,
      };
      if (free(candidate)) {
        break;
      }
    }
    node.x = candidate.x;
    node.y = candidate.y;
  }
  fitGroups(model);
};

/** Puts every unplaced note beside its target in the first free spot. */
export const placeNotes = (
  model: Model,
  noteSizes: Map<string, Size>,
  edgeLabelSizes: Map<string, Size>,
) => {
  // notes must not hide an edge or its label
  const routes: Point[][] = [];
  const labelBoxes: Box[] = [];
  for (const edge of model.edges.values()) {
    const from = endOf(model, edge.from);
    const to = endOf(model, edge.to);
    if (!from || !to || from.x === undefined || to.x === undefined) {
      continue;
    }
    const route = edge.points?.length
      ? edge.points
      : straightRoute(from as Box, to as Box);
    routes.push(route);
    const label = edgeLabelSizes.get(edge.id);
    if (label) {
      labelBoxes.push(labelBoxOnRoute(route, label));
    }
  }
  const clear = (c: Box, blocking: Box[]) =>
    !blocking.some((b) => overlaps(c, b, 12)) &&
    !labelBoxes.some((b) => overlaps(c, b, 8)) &&
    !routes.some((r) =>
      routeHitsBox(r, {
        x: c.x - 10,
        y: c.y - 10,
        width: c.width + 20,
        height: c.height + 20,
      }),
    );

  const obstacles = (): Box[] => [
    ...([...model.nodes.values()].filter((n) => n.x !== undefined) as Box[]),
    ...([...model.blocks.values()].filter((n) => n.x !== undefined) as Box[]),
    ...([...model.notes.values()].filter((n) => n.x !== undefined) as Box[]),
  ];
  const groupBoxes = () =>
    [...model.groups.values()].filter((g) => g.x !== undefined) as Box[];

  const all = bounds([...obstacles(), ...groupBoxes()]);

  for (const note of model.notes.values()) {
    const size = noteSizes.get(note.id)!;
    note.width = size.width;
    note.height = size.height;
    if (note.x !== undefined && note.pinned) {
      continue;
    }
    note.x = undefined;

    const target =
      (note.on &&
        ((model.nodes.get(note.on) as Box | undefined) ??
          (model.blocks.get(note.on) as Box | undefined) ??
          (model.groups.get(note.on) as Box | undefined))) ||
      undefined;
    const others = obstacles();
    const isGroupTarget = !!note.on && model.groups.has(note.on);
    // a note must not sit on top of a group border it does not belong to
    const blocking = [
      ...others,
      ...groupBoxes()
        .filter((g) => !(isGroupTarget && g === (target as Box)))
        .map((g) => ({ ...g, height: GROUP_PAD.top })),
    ];

    const candidates: Box[] = [];
    if (target && target.x !== undefined) {
      const t = target;
      const above = t.y - size.height - NOTE_GAP;
      const below = t.y + t.height + NOTE_GAP;
      const right = t.x + t.width + NOTE_GAP;
      const left = t.x - size.width - NOTE_GAP;
      candidates.push(
        { x: right, y: above + size.height / 2, ...size },
        { x: t.x + t.width - size.width / 2, y: above, ...size },
        { x: right, y: t.y, ...size },
        { x: t.x, y: above, ...size },
        { x: t.x, y: below, ...size },
        { x: left, y: t.y, ...size },
      );
      // in a dense drawing the spots above may all be taken: try every free
      // place near the target, nearest first, before giving up on nearness
      const near: { box: Box; distance: number }[] = [];
      for (let dx = -NEAR_REACH; dx <= NEAR_REACH; dx += NEAR_STEP) {
        for (let dy = -NEAR_REACH; dy <= NEAR_REACH; dy += NEAR_STEP) {
          const box = {
            x: t.x + t.width / 2 + dx - size.width / 2,
            y: t.y + t.height / 2 + dy - size.height / 2,
            ...size,
          };
          const gapX = Math.max(
            0,
            box.x - (t.x + t.width),
            t.x - (box.x + box.width),
          );
          const gapY = Math.max(
            0,
            box.y - (t.y + t.height),
            t.y - (box.y + box.height),
          );
          if (gapX + gapY >= NOTE_GAP) {
            near.push({ box, distance: Math.hypot(gapX, gapY) });
          }
        }
      }
      near.sort((a, b) => a.distance - b.distance);
      candidates.push(...near.map((n) => n.box));
    }
    // free notes (and the fallback for attached ones) go in a column on the right
    const column = all ? all.x + all.width + NOTE_GAP * 2 : 0;
    const top = all ? all.y : 0;
    for (let r = 0; r < 60; r++) {
      candidates.push({
        x: column,
        y: top + r * (size.height / 2 + 10),
        ...size,
      });
    }
    const spot =
      candidates.find((c) => clear(c, blocking)) ??
      candidates[candidates.length - 1];
    note.x = spot.x;
    note.y = spot.y;
  }
};
