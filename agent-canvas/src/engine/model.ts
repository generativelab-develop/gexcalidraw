// The agent's view of a diagram: nodes, edges, groups and notes, each with a
// stable id the agent chose. The model is never stored on its own; it is read
// back out of the scene (every element the agent owns carries `customData.gx`)
// so whatever a person changed on the canvas, a moved box, a recoloured
// group, is part of the model the next agent operation starts from.

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

export type Shape = "rect" | "ellipse" | "diamond" | "sticky" | "text";
export type Direction = "RIGHT" | "DOWN" | "LEFT" | "UP";
export type Theme = "clean" | "sketch";
export type LineStyle = "solid" | "dashed" | "dotted";
/** how a container (the whole drawing, or one group) arranges its members */
export type Layout = "layered" | "tree" | "radial" | "grid";
export type TextSize = "s" | "m" | "l" | "xl";
/** an arrow end: Excalidraw's own arrowheads, or none */
export type Head =
  | "none"
  | "arrow"
  | "bar"
  | "circle"
  | "circle_outline"
  | "triangle"
  | "triangle_outline"
  | "diamond"
  | "diamond_outline"
  | "cardinality_one"
  | "cardinality_many"
  | "cardinality_one_or_many"
  | "cardinality_exactly_one"
  | "cardinality_zero_or_one"
  | "cardinality_zero_or_many";
export type BlockType =
  | "table"
  | "quadrant"
  | "sequence"
  | "timeline"
  | "wireframe"
  | "sketch";

export type Style = {
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeStyle?: string;
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
};

export type NodeModel = {
  id: string;
  label: string;
  shape: Shape;
  kind?: string;
  source?: string;
  group?: string;
  color?: string;
  /** sections under the label: a card (a UML class, an ER table, a persona) */
  fields?: string[][];
  size?: TextSize;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  pinned: boolean;
  style?: Style;
  /** where the agent last put it */
  laid?: [number, number];
};

export type EdgeModel = {
  id: string;
  from: string;
  to: string;
  label?: string;
  line?: LineStyle;
  color?: string;
  head?: Head;
  tail?: Head;
  style?: Style;
  /** absolute route, first and last point on the end boxes' borders */
  points?: [number, number][];
};

export type GroupModel = {
  id: string;
  label: string;
  parent?: string;
  color?: string;
  /** drawn as an Excalidraw frame: a screen, a slide, a board */
  frame?: boolean;
  /** a frame at least 16:9 presentation size */
  slide?: boolean;
  layout?: Layout;
  columns?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  pinned: boolean;
  style?: Style;
  laid?: [number, number];
};

export type NoteModel = {
  id: string;
  text: string;
  on?: string;
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  pinned: boolean;
};

/**
 * A block is one composite figure the agent describes as data (a table, a
 * sequence diagram, a timeline, a screen) and the engine draws from that
 * description; the layout places it as one box.
 */
export type BlockModel = {
  id: string;
  type: BlockType;
  spec: Record<string, unknown>;
  group?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  pinned: boolean;
  laid?: [number, number];
};

export type Meta = {
  direction: Direction;
  theme: Theme;
  layout?: Layout;
  columns?: number;
};

export type Model = {
  meta: Meta;
  nodes: Map<string, NodeModel>;
  edges: Map<string, EdgeModel>;
  groups: Map<string, GroupModel>;
  notes: Map<string, NoteModel>;
  blocks: Map<string, BlockModel>;
};

/** What every agent-owned element carries in `customData.gx`. */
export type GxData =
  | {
      role: "node";
      id: string;
      shape: Shape;
      kind?: string;
      source?: string;
      group?: string;
      color?: string;
      fields?: string[][];
      size?: TextSize;
      pinned?: boolean;
      laid?: [number, number];
      meta?: Meta;
    }
  | { role: "node-part"; id: string }
  | {
      role: "edge";
      id: string;
      from: string;
      to: string;
      line?: LineStyle;
      color?: string;
    }
  | {
      role: "group";
      id: string;
      label: string;
      parent?: string;
      color?: string;
      frame?: boolean;
      slide?: boolean;
      layout?: Layout;
      columns?: number;
      pinned?: boolean;
      laid?: [number, number];
      meta?: Meta;
    }
  | {
      role: "group-label";
      id: string;
    }
  | {
      role: "note";
      id: string;
      on?: string;
      color?: string;
      pinned?: boolean;
      laid?: [number, number];
    }
  | { role: "note-link"; id: string }
  | {
      role: "block";
      id: string;
      type: BlockType;
      spec: Record<string, unknown>;
      group?: string;
      pinned?: boolean;
      laid?: [number, number];
      meta?: Meta;
    }
  | { role: "block-part"; id: string };

// `>` admits the default edge id `from->to`
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:>-]{0,79}$/;

export const elementId = {
  node: (id: string) => `gx-n-${id}`,
  nodeLabel: (id: string) => `gx-n-${id}-t`,
  edge: (id: string) => `gx-e-${id}`,
  edgeLabel: (id: string) => `gx-e-${id}-t`,
  group: (id: string) => `gx-g-${id}`,
  groupLabel: (id: string) => `gx-g-${id}-t`,
  note: (id: string) => `gx-m-${id}`,
  noteLabel: (id: string) => `gx-m-${id}-t`,
  noteLink: (id: string) => `gx-ml-${id}`,
  /** a card's title, divider lines and field texts */
  nodePart: (id: string, part: string) => `gx-n-${id}-${part}`,
  nodeField: (id: string, index: number) => `gx-n-${id}-f${index}`,
  block: (id: string) => `gx-b-${id}`,
  blockPart: (id: string, part: string) => `gx-b-${id}-${part}`,
};

/** What an edge may connect: a node, or a whole block (a screen, a table). */
export const endOf = (
  model: Model,
  id: string,
): NodeModel | BlockModel | undefined =>
  model.nodes.get(id) ?? model.blocks.get(id);

/** The element an edge end binds to. */
export const endElementId = (model: Model, id: string) =>
  model.blocks.has(id) ? elementId.block(id) : elementId.node(id);

export const gxOf = (element: ExcalidrawElement): GxData | null => {
  const gx = (element.customData as { gx?: GxData } | undefined)?.gx;
  return gx && typeof gx === "object" && typeof gx.role === "string"
    ? gx
    : null;
};

export const isAgentOwned = (element: ExcalidrawElement) => {
  if (gxOf(element)) {
    return true;
  }
  // a bound label belongs to whoever owns its container
  return element.id.startsWith("gx-");
};

const moved = (
  element: ExcalidrawElement,
  gx: { pinned?: boolean; laid?: [number, number] },
) =>
  !!gx.pinned ||
  (!!gx.laid &&
    (Math.abs(element.x - gx.laid[0]) > 0.5 ||
      Math.abs(element.y - gx.laid[1]) > 0.5));

const styleOf = (element: ExcalidrawElement): Style => ({
  strokeColor: element.strokeColor,
  backgroundColor: element.backgroundColor,
  fillStyle: element.fillStyle,
  strokeStyle: element.strokeStyle,
  strokeWidth: element.strokeWidth,
  roughness: element.roughness,
  opacity: element.opacity,
});

const labelOf = (
  container: ExcalidrawElement,
  byId: Map<string, ExcalidrawElement>,
) => {
  const bound = container.boundElements?.find((b) => b.type === "text");
  const text = bound
    ? (byId.get(bound.id) as ExcalidrawTextElement | undefined)
    : undefined;
  return text && !text.isDeleted ? text.originalText ?? text.text : "";
};

const textAt = (id: string, byId: Map<string, ExcalidrawElement>) => {
  const text = byId.get(id) as ExcalidrawTextElement | undefined;
  return text && text.type === "text" ? text.originalText ?? text.text : null;
};

/** A card's title is its own text, not a bound label. */
const cardTitle = (id: string, byId: Map<string, ExcalidrawElement>) =>
  textAt(elementId.nodePart(id, "title"), byId) ?? "";

/** A card's sections as the canvas shows them (a person may have edited one). */
const cardFields = (
  id: string,
  fields: string[][],
  byId: Map<string, ExcalidrawElement>,
) =>
  fields.map((section, index) => {
    const text = textAt(elementId.nodeField(id, index), byId);
    return text === null ? section : text.split("\n");
  });

const headOf = (element: ExcalidrawElement, end: "start" | "end") => {
  if (element.type !== "arrow" && element.type !== "line") {
    return undefined;
  }
  const head = (element as unknown as Record<string, string | null>)[
    `${end}Arrowhead`
  ];
  return (head ?? "none") as Head;
};

export const emptyModel = (): Model => ({
  meta: { direction: "RIGHT", theme: "clean" },
  nodes: new Map(),
  edges: new Map(),
  groups: new Map(),
  notes: new Map(),
  blocks: new Map(),
});

export const readModel = (elements: readonly ExcalidrawElement[]): Model => {
  const model = emptyModel();
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  // a group's name as it reads on the canvas (a person may have edited it)
  const groupNames = new Map<string, string>();
  for (const element of live) {
    const gx = gxOf(element);
    if (gx?.role === "group-label" && element.type === "text") {
      const text = element as ExcalidrawTextElement;
      groupNames.set(gx.id, text.originalText ?? text.text);
    }
  }
  let metaFound = false;

  for (const element of live) {
    const gx = gxOf(element);
    if (!gx) {
      continue;
    }
    if (
      (gx.role === "node" || gx.role === "group" || gx.role === "block") &&
      gx.meta &&
      !metaFound
    ) {
      model.meta = { ...model.meta, ...gx.meta };
      metaFound = true;
    }
    switch (gx.role) {
      case "node":
        model.nodes.set(gx.id, {
          id: gx.id,
          label: labelOf(element, byId) || cardTitle(gx.id, byId),
          shape: gx.shape,
          kind: gx.kind,
          source: gx.source,
          group: gx.group,
          color: gx.color,
          fields: gx.fields ? cardFields(gx.id, gx.fields, byId) : undefined,
          size: gx.size,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          pinned: moved(element, gx),
          laid: gx.laid,
          style: styleOf(element),
        });
        break;
      case "edge":
        model.edges.set(gx.id, {
          id: gx.id,
          from: gx.from,
          to: gx.to,
          label: labelOf(element, byId) || undefined,
          line: gx.line,
          color: gx.color,
          head: headOf(element, "end"),
          tail: headOf(element, "start"),
          style: styleOf(element),
          points:
            "points" in element
              ? (element.points as readonly (readonly [number, number])[]).map(
                  ([px, py]) =>
                    [element.x + px, element.y + py] as [number, number],
                )
              : undefined,
        });
        break;
      case "group":
        model.groups.set(gx.id, {
          id: gx.id,
          label:
            (element.type === "frame"
              ? (element as { name?: string | null }).name
              : groupNames.get(gx.id)) || gx.label,
          parent: gx.parent,
          color: gx.color,
          frame: gx.frame,
          slide: gx.slide,
          layout: gx.layout,
          columns: gx.columns,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          pinned: moved(element, gx),
          laid: gx.laid,
          style: styleOf(element),
        });
        break;
      case "note":
        model.notes.set(gx.id, {
          id: gx.id,
          text: labelOf(element, byId),
          on: gx.on,
          color: gx.color,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          pinned: moved(element, gx),
        });
        break;
      case "block":
        model.blocks.set(gx.id, {
          id: gx.id,
          type: gx.type,
          spec: gx.spec,
          group: gx.group,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          pinned: moved(element, gx),
          laid: gx.laid,
        });
        break;
    }
  }
  followMovedGroups(model);
  // a box a person placed is no longer where ELK routed to: its arrows become
  // elbow arrows the editor routes (and re-routes as the box is dragged)
  for (const edge of model.edges.values()) {
    if (endOf(model, edge.from)?.pinned || endOf(model, edge.to)?.pinned) {
      edge.points = undefined;
    }
  }
  return model;
};

/**
 * A person who drags a group's box means the group: everything inside that
 * they did not move themselves comes along by the same distance.
 */
export const followMovedGroups = (model: Model) => {
  const inside = (groupId: string | undefined, root: string): boolean => {
    for (let cursor = groupId, n = 0; cursor && n < 50; n++) {
      if (cursor === root) {
        return true;
      }
      cursor = model.groups.get(cursor)?.parent;
    }
    return false;
  };
  const unmoved = (item: { x?: number; y?: number; laid?: [number, number] }) =>
    !!item.laid &&
    item.x !== undefined &&
    Math.abs(item.x - item.laid[0]) <= 0.5 &&
    Math.abs(item.y! - item.laid[1]) <= 0.5;

  for (const group of model.groups.values()) {
    if (!group.laid || group.x === undefined || unmoved(group)) {
      continue;
    }
    const dx = group.x - group.laid[0];
    const dy = group.y! - group.laid[1];
    let carried = 0;
    for (const node of model.nodes.values()) {
      if (inside(node.group, group.id) && unmoved(node)) {
        node.x! += dx;
        node.y! += dy;
        node.laid = [node.x!, node.y!];
        node.pinned = true;
        carried++;
      }
    }
    for (const block of model.blocks.values()) {
      if (inside(block.group, group.id) && unmoved(block)) {
        block.x! += dx;
        block.y! += dy;
        block.laid = [block.x!, block.y!];
        block.pinned = true;
        carried++;
      }
    }
    for (const child of model.groups.values()) {
      if (child !== group && inside(child.parent, group.id) && unmoved(child)) {
        child.x! += dx;
        child.y! += dy;
        child.laid = [child.x!, child.y!];
        child.pinned = true;
      }
    }
    group.laid = [group.x, group.y!];
    group.pinned = true;
    if (carried) {
      // routes into the group no longer start where they did
      for (const edge of model.edges.values()) {
        const ends = [edge.from, edge.to].map((id) => endOf(model, id)?.group);
        if (ends.some((g) => inside(g, group.id))) {
          edge.points = undefined;
        }
      }
    }
  }
};

/**
 * Whether a person's drag needs the drawing settled: a group box moved (its
 * contents follow) or a box moved for the first time (its arrows turn into
 * editor-routed ones).
 */
export const needsSettling = (elements: readonly ExcalidrawElement[]) =>
  elements.some((element) => {
    const gx = gxOf(element);
    if (
      element.isDeleted ||
      !gx ||
      (gx.role !== "group" && gx.role !== "node" && gx.role !== "block") ||
      !gx.laid
    ) {
      return false;
    }
    const movedNow =
      Math.abs(element.x - gx.laid[0]) > 0.5 ||
      Math.abs(element.y - gx.laid[1]) > 0.5;
    return movedNow && (gx.role === "group" || !gx.pinned);
  });
