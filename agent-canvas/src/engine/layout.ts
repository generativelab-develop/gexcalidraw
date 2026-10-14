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
  straightRoute,
} from "./geometry";

import type { Box, Outline, Point } from "./geometry";
import type { Direction, Model } from "./model";

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
    for (const node of model.nodes.values()) {
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

export const fullLayout = async (
  model: Model,
  sizes: Map<string, Size>,
  edgeLabelSizes: Map<string, Size>,
  opts: { keepPinned: boolean; outlines?: Map<string, Outline> },
) => {
  const direction: Direction = model.meta.direction;
  const before = bounds(
    [...model.nodes.values(), ...model.groups.values()].filter(
      (b) => b.x !== undefined,
    ) as Box[],
  );

  const groupNodes = new Map<string, ElkNode>();
  for (const group of model.groups.values()) {
    groupNodes.set(group.id, {
      id: `g:${group.id}`,
      children: [],
      labels: [{ text: group.label, width: 10, height: 10 }],
      layoutOptions: {
        "elk.padding": `[top=${GROUP_PAD.top},left=${GROUP_PAD.side},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.side}]`,
      },
    });
  }
  const root: ElkNode = {
    id: "root",
    children: [],
    layoutOptions: {
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
    },
    edges: [],
  };

  for (const group of model.groups.values()) {
    const parent = group.parent ? groupNodes.get(group.parent) : root;
    (parent ?? root).children!.push(groupNodes.get(group.id)!);
  }
  for (const node of model.nodes.values()) {
    const size = sizes.get(node.id)!;
    const parent = node.group ? groupNodes.get(node.group) : root;
    (parent ?? root).children!.push({
      id: `n:${node.id}`,
      width: size.width,
      height: size.height,
    });
  }
  // an empty group still needs a size to be laid out
  for (const group of groupNodes.values()) {
    if (!group.children!.length) {
      group.width = 240;
      group.height = 120;
    }
  }
  for (const edge of model.edges.values()) {
    if (!model.nodes.has(edge.from) || !model.nodes.has(edge.to)) {
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

  const origin = before ? { x: before.x, y: before.y } : { x: 0, y: 0 };
  const walk = (node: ElkNode, ox: number, oy: number) => {
    for (const child of node.children ?? []) {
      const x = ox + (child.x ?? 0);
      const y = oy + (child.y ?? 0);
      if (child.id.startsWith("n:")) {
        const model_node = model.nodes.get(child.id.slice(2))!;
        if (
          !(opts.keepPinned && model_node.pinned && model_node.x !== undefined)
        ) {
          model_node.x = x;
          model_node.y = y;
          model_node.pinned = false;
        }
        model_node.width = child.width;
        model_node.height = child.height;
      } else if (child.id.startsWith("g:")) {
        const group = model.groups.get(child.id.slice(2))!;
        if (!(opts.keepPinned && group.pinned)) {
          group.pinned = false;
        }
        walk(child, x, y);
      }
    }
  };
  walk(laid, origin.x, origin.y);

  const routed = new Set<string>();
  for (const e of (laid.edges ?? []) as ElkEdge[]) {
    const edge = model.edges.get(e.id.slice(2));
    const section = e.sections?.[0];
    if (!edge || !section) {
      continue;
    }
    const from = model.nodes.get(edge.from)!;
    const to = model.nodes.get(edge.to)!;
    // a node that kept its hand-placed spot was not where ELK routed to
    if (opts.keepPinned && (from.pinned || to.pinned)) {
      edge.points = undefined;
      continue;
    }
    edge.points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ].map((p) => [origin.x + p.x, origin.y + p.y] as [number, number]);
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
    ...([...model.notes.values()].filter((n) => n.x !== undefined) as Box[]),
  ];

  const fresh = [...model.nodes.values()].filter((n) => n.x === undefined);
  for (const node of fresh) {
    const size = sizes.get(node.id)!;
    node.width = size.width;
    node.height = size.height;

    const neighbours = [...model.edges.values()]
      .filter((e) => e.from === node.id || e.to === node.id)
      .map((e) => ({
        other: model.nodes.get(e.from === node.id ? e.to : e.from),
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
      const siblings = [...model.nodes.values()].filter(
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
    const from = model.nodes.get(edge.from);
    const to = model.nodes.get(edge.to);
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
