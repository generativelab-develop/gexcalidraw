// Model -> Excalidraw elements. Sizes are measured by the editor's own code:
// a node is converted once with its label and no width, which makes the
// editor grow the box to fit the text exactly as it would for a person typing
// it, and that measured size is what the layout places.

import {
  FONT_FAMILY,
  getFontString,
  getLineHeight,
  randomInteger,
} from "@excalidraw/common";
import {
  measureText,
  redrawTextBoundingBox,
  Scene,
  updateElbowArrowPoints,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";
import { convertToExcalidrawElements, Fonts } from "@excalidraw/excalidraw";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import type {
  ExcalidrawElbowArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
  FixedPoint,
  FixedPointBinding,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";
import type { LocalPoint } from "@excalidraw/math";

import { blockTexts, drawBlock } from "./blocks";
import {
  isOutlineShape,
  outlineItems,
  outlineLabel,
  outlineSize,
} from "./shapes";

import { closestEdgePoint, centerOf, straightRoute } from "./geometry";
import { GROUP_PAD } from "./layout";
import { elementId, endElementId, endOf } from "./model";

import type { DrawContext, Drawing, Item } from "./blocks";
import type { Box } from "./geometry";
import type { Size } from "./layout";
import type {
  BlockModel,
  Direction,
  GxData,
  Model,
  NodeModel,
  Style,
  TextSize,
  Theme,
} from "./model";

export const PALETTE: Record<string, { stroke: string; fill: string }> = {
  blue: { stroke: "#1971c2", fill: "#d0ebff" },
  green: { stroke: "#2f9e44", fill: "#d3f9d8" },
  red: { stroke: "#e03131", fill: "#ffe3e3" },
  yellow: { stroke: "#e67700", fill: "#fff3bf" },
  orange: { stroke: "#e8590c", fill: "#ffe8cc" },
  violet: { stroke: "#6741d9", fill: "#e5dbff" },
  pink: { stroke: "#c2255c", fill: "#ffdeeb" },
  teal: { stroke: "#0c8599", fill: "#c5f6fa" },
  gray: { stroke: "#495057", fill: "#f1f3f5" },
  black: { stroke: "#1e1e1e", fill: "#ffffff" },
};

/** A node `kind` picks a colour and shape when the agent names neither. */
export const KINDS: Record<
  string,
  { color: string; shape?: NodeModel["shape"] }
> = {
  service: { color: "blue" },
  api: { color: "blue" },
  ui: { color: "violet" },
  client: { color: "violet" },
  user: { color: "violet", shape: "ellipse" },
  actor: { color: "violet", shape: "ellipse" },
  store: { color: "yellow" },
  db: { color: "yellow" },
  database: { color: "yellow" },
  file: { color: "yellow" },
  queue: { color: "orange" },
  topic: { color: "orange" },
  job: { color: "green" },
  worker: { color: "green" },
  process: { color: "green" },
  external: { color: "gray" },
  decision: { color: "pink", shape: "diamond" },
  config: { color: "teal" },
};

export const NOTE_COLORS: Record<string, string> = {
  yellow: "#fff3bf",
  blue: "#d0ebff",
  green: "#d3f9d8",
  pink: "#ffdeeb",
  orange: "#ffe8cc",
  violet: "#e5dbff",
  gray: "#f1f3f5",
};

const FONT_SIZES: Record<TextSize, number> = { s: 16, m: 20, l: 28, xl: 40 };
const FIELD_FONT_SIZE = 16;
const CARD_PAD = { x: 18, y: 12 };
const GROUP_LABEL_INSET = { x: 18, y: 14 };
const EDGE_FONT_SIZE = 16;
const GROUP_FONT_SIZE = 18;
const NOTE_FONT_SIZE = 18;
const NOTE_WIDTH = 240;
const MIN_NODE = { width: 140, height: 64 };
const NODE_PAD = { x: 28, y: 18 };

const fontFor = (theme: Theme) =>
  theme === "sketch" ? FONT_FAMILY.Excalifont : FONT_FAMILY.Nunito;

const roughnessFor = (theme: Theme) => (theme === "sketch" ? 1 : 0);

const colorFor = (name: string | undefined) => {
  if (!name) {
    return null;
  }
  if (PALETTE[name]) {
    return PALETTE[name];
  }
  // a raw "#rrggbb" is used as the stroke with a pale fill
  if (/^#[0-9a-f]{6}$/i.test(name)) {
    return { stroke: name, fill: "#ffffff" };
  }
  return null;
};

export const paint = (
  name: string | undefined,
  fallback: string,
): { stroke: string; fill: string } =>
  colorFor(name) ?? PALETTE[fallback] ?? PALETTE.black;

const fontSizeOf = (node: NodeModel) => FONT_SIZES[node.size ?? "m"];

const nodeColor = (node: NodeModel) =>
  colorFor(node.color) ??
  colorFor(node.kind ? KINDS[node.kind]?.color : undefined) ??
  PALETTE.black;

export const nodeShape = (node: NodeModel) =>
  node.fields
    ? "rect"
    : node.shape !== "rect"
    ? node.shape
    : node.kind && KINDS[node.kind]?.shape
    ? KINDS[node.kind]!.shape!
    : "rect";

/** The outline the router ends arrows on. */
export const nodeOutline = (node: NodeModel) => {
  const shape = nodeShape(node);
  return shape === "ellipse" || shape === "diamond"
    ? shape
    : shape === "circle"
    ? "ellipse"
    : "rect";
};

const excalidrawType = (shape: NodeModel["shape"]) =>
  shape === "rect" || shape === "text" || isOutlineShape(shape)
    ? "rectangle"
    : shape === "sticky"
    ? "stickynote"
    : shape;

/** Loads every font face the labels will need, so measuring is exact. */
export const loadFonts = async (model: Model) => {
  const fontFamily = fontFor(model.meta.theme);
  const texts = [
    ...[...model.nodes.values()].map((n) => n.label),
    ...[...model.edges.values()].map((e) => e.label ?? ""),
    ...[...model.groups.values()].map((g) => g.label),
    ...[...model.notes.values()].map((n) => n.text),
    ...[...model.nodes.values()].flatMap((n) => n.fields?.flat() ?? []),
    ...[...model.blocks.values()].flatMap((b) => blockTexts(b.spec)),
  ].join("\n");
  if (!texts.trim()) {
    return;
  }
  const probe = convertToExcalidrawElements(
    [{ type: "text", x: 0, y: 0, text: texts, fontFamily }],
    { regenerateIds: true },
  );
  await Fonts.loadElementsFonts(probe);
};

export const measureNode = (
  node: NodeModel,
  theme: Theme,
  direction: Direction = "RIGHT",
): Size => {
  if (node.width !== undefined && node.height !== undefined) {
    return { width: node.width, height: node.height };
  }
  const fontFamily = fontFor(theme);
  const shape = nodeShape(node);
  const fontSize = fontSizeOf(node);
  if (isOutlineShape(shape)) {
    const size = outlineSize(
      shape,
      measureText_(node.label, theme, fontSize),
      direction,
    );
    return { width: Math.ceil(size.width), height: Math.ceil(size.height) };
  }
  if (node.fields) {
    const card = cardGeometry(node, theme);
    return { width: card.width, height: card.height };
  }
  if (shape === "sticky") {
    const size = measureNote(node.label, theme);
    return { width: size.width, height: Math.max(size.height, 120) };
  }
  if (shape === "text") {
    const m = measureText_(node.label, theme, fontSize);
    return { width: m.width + 16, height: m.height + 12 };
  }
  const [box] = convertToExcalidrawElements(
    [
      {
        type: excalidrawType(shape),
        x: 0,
        y: 0,
        label: { text: node.label, fontSize, fontFamily },
      } as ExcalidrawElementSkeleton,
    ],
    { regenerateIds: true },
  );
  // the editor's own fit, plus breathing room so a box never looks crammed
  let width = Math.ceil(box.width + NODE_PAD.x);
  let height = Math.ceil(box.height + NODE_PAD.y);
  if (shape === "diamond") {
    width = Math.ceil(width * 1.25);
    height = Math.ceil(height * 1.25);
  }
  return {
    width: Math.max(MIN_NODE.width, width),
    height: Math.max(MIN_NODE.height, height),
  };
};

export const measureText_ = (
  text: string,
  theme: Theme,
  fontSize: number,
): Size => {
  const fontFamily = fontFor(theme);
  const metrics = measureText(
    text,
    getFontString({ fontFamily, fontSize }),
    getLineHeight(fontFamily),
  );
  return { width: Math.ceil(metrics.width), height: Math.ceil(metrics.height) };
};

/** A card: the title across the top, then each section under a rule. */
const cardGeometry = (node: NodeModel, theme: Theme) => {
  const titleSize = fontSizeOf(node);
  const title = measureText_(node.label, theme, titleSize);
  const sections = (node.fields ?? []).map((lines) =>
    measureText_(lines.join("\n") || " ", theme, FIELD_FONT_SIZE),
  );
  const width = Math.max(
    160,
    Math.ceil(
      Math.max(title.width, ...sections.map((m) => m.width)) + CARD_PAD.x * 2,
    ),
  );
  const titleH = title.height + CARD_PAD.y * 2;
  const offsets: number[] = [];
  let y = titleH;
  for (const m of sections) {
    offsets.push(y);
    y += m.height + CARD_PAD.y * 2;
  }
  return { width, height: Math.ceil(y), titleSize, title, offsets };
};

/** What a block needs to draw itself: the editor's text measure, the palette. */
export const blockContext = (theme: Theme): DrawContext => ({
  measure: (text, fontSize) => measureText_(text || " ", theme, fontSize),
  paint,
});

export const measureBlock = (block: BlockModel, theme: Theme): Drawing =>
  drawBlock(block.type, block.spec, blockContext(theme));

export const measureEdgeLabel = (label: string, theme: Theme) =>
  measureText_(label, theme, EDGE_FONT_SIZE);

export const measureNote = (text: string, theme: Theme): Size => {
  const [note] = convertToExcalidrawElements(
    [
      {
        type: "stickynote",
        x: 0,
        y: 0,
        width: NOTE_WIDTH,
        height: 80,
        label: {
          text,
          fontSize: NOTE_FONT_SIZE,
          fontFamily: fontFor(theme),
        },
      } as ExcalidrawElementSkeleton,
    ],
    { regenerateIds: true },
  );
  return { width: Math.ceil(note.width), height: Math.ceil(note.height) };
};

const styleProps = (style: Style | undefined) =>
  style
    ? Object.fromEntries(
        Object.entries(style).filter(([, v]) => v !== undefined),
      )
    : {};

/**
 * Builds every agent-owned element for `model`. Positions must already be
 * set. `previous` (the agent elements currently on the canvas) supplies
 * versions, so the editor and any other open canvas take the new ones.
 */
export const buildElements = (
  model: Model,
  previous: Map<string, ExcalidrawElement>,
  drawings: Map<string, Drawing> = new Map(),
): { elements: ExcalidrawElement[]; warnings: string[] } => {
  const theme = model.meta.theme;
  const fontFamily = fontFor(theme);
  const roughness = roughnessFor(theme);
  const warnings: string[] = [];
  const skeletons: ExcalidrawElementSkeleton[] = [];
  const gxById = new Map<string, GxData>();
  const meta = { ...model.meta };

  const elbows: string[] = [];

  const add = (skeleton: ExcalidrawElementSkeleton, gx?: GxData) => {
    skeletons.push(skeleton);
    if (gx && skeleton.id) {
      gxById.set(skeleton.id, gx);
    }
  };

  const addBlock = (block: BlockModel, drawing: Drawing) => {
    const ox = block.x!;
    const oy = block.y!;
    const frame = drawing.items.find((item) => item.kind === "frame");
    // what a frame holds moves with it; anything else is one Excalidraw group
    const together = frame ? [] : [`gx-bg-${block.id}`];
    const ids: string[] = [];
    const blockGx: GxData = {
      role: "block",
      id: block.id,
      type: block.type,
      spec: block.spec,
      group: block.group,
      pinned: block.pinned || undefined,
      laid: [ox, oy],
      meta,
    };
    for (const item of drawing.items) {
      const own = item.key === "box";
      const id = own
        ? elementId.block(block.id)
        : elementId.blockPart(block.id, item.key);
      const gx: GxData = own ? blockGx : { role: "block-part", id: block.id };
      const skeleton = itemSkeleton(
        item,
        id,
        ox,
        oy,
        together,
        drawing.roughness,
      );
      if (!skeleton) {
        continue;
      }
      if (item !== frame) {
        ids.push(id, `${id}-t`);
      }
      add(skeleton, gx);
    }
    if (frame) {
      frames.set(elementId.blockPart(block.id, frame.key), new Set(ids));
    } else {
      inFrame(block.group, ...ids);
    }
  };

  const itemSkeleton = (
    item: Item,
    id: string,
    ox: number,
    oy: number,
    groupIds: string[],
    rough: number = roughness,
  ): ExcalidrawElementSkeleton | null => {
    switch (item.kind) {
      case "frame":
        return {
          type: "frame",
          id,
          x: ox + item.x,
          y: oy + item.y,
          width: item.w,
          height: item.h,
          name: item.name,
          children: [],
        } as unknown as ExcalidrawElementSkeleton;
      case "text": {
        if (!item.text.trim()) {
          return null;
        }
        // the editor reads a centred or right-aligned text's x as that line's
        // anchor, not its left edge
        const width =
          item.align === "center" || item.align === "right"
            ? measureText_(item.text, theme, item.size).width
            : 0;
        return {
          type: "text",
          id,
          x: ox + item.x + (item.align === "center" ? width / 2 : width),
          y: oy + item.y,
          text: item.text,
          fontSize: item.size,
          fontFamily,
          textAlign: item.align ?? "left",
          strokeColor: item.color,
          opacity: item.opacity ?? 100,
          groupIds,
        } as ExcalidrawElementSkeleton;
      }
      case "line":
      case "arrow": {
        const [x0, y0] = item.points[0];
        const rel = item.points.map(([px, py]) => [px - x0, py - y0]);
        const xs = rel.map((p) => p[0]);
        const ys = rel.map((p) => p[1]);
        return {
          type: item.kind,
          id,
          x: ox + x0,
          y: oy + y0,
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
          points: rel,
          strokeColor: item.stroke,
          strokeStyle: item.line ?? "solid",
          strokeWidth: item.strokeWidth ?? 2,
          roughness: rough,
          roundness: null,
          opacity: item.opacity ?? 100,
          ...(item.closed
            ? {
                polygon: true,
                backgroundColor: item.fill ?? "transparent",
                fillStyle: "solid",
              }
            : null),
          ...(item.kind === "arrow"
            ? {
                elbowed: false,
                startArrowhead:
                  !item.tail || item.tail === "none" ? null : item.tail,
                endArrowhead:
                  item.head === "none" ? null : item.head ?? "arrow",
              }
            : null),
          groupIds,
        } as unknown as ExcalidrawElementSkeleton;
      }
      case "freedraw": {
        const [x0, y0] = item.points[0];
        const rel = item.points.map(([px, py]) => [px - x0, py - y0]);
        const xs = rel.map((p) => p[0]);
        const ys = rel.map((p) => p[1]);
        return {
          type: "freedraw",
          id,
          x: ox + x0,
          y: oy + y0,
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
          points: rel,
          pressures: [],
          simulatePressure: true,
          strokeColor: item.stroke,
          strokeWidth: item.strokeWidth ?? 2,
          opacity: item.opacity ?? 100,
          groupIds,
        } as unknown as ExcalidrawElementSkeleton;
      }
      case "image":
        return {
          type: "image",
          id,
          x: ox + item.x,
          y: oy + item.y,
          width: item.w,
          height: item.h,
          fileId: item.fileId,
          status: "saved",
          scale: [1, 1],
          groupIds,
        } as unknown as ExcalidrawElementSkeleton;
      default:
        return {
          type: item.kind === "rect" ? "rectangle" : item.kind,
          id,
          x: ox + item.x,
          y: oy + item.y,
          width: item.w,
          height: item.h,
          strokeColor: item.stroke,
          backgroundColor: item.fill,
          fillStyle: item.fillStyle ?? "solid",
          strokeStyle: item.line ?? "solid",
          strokeWidth: item.strokeWidth ?? 2,
          roughness: rough,
          opacity: item.opacity ?? 100,
          roundness: item.rounded && item.kind === "rect" ? { type: 3 } : null,
          groupIds,
          ...(item.label
            ? {
                label: {
                  text: item.label.text,
                  id: `${id}-t`,
                  fontSize: item.label.size,
                  fontFamily,
                  textAlign: item.label.align ?? "center",
                  ...(item.label.color
                    ? { strokeColor: item.label.color }
                    : null),
                },
              }
            : null),
        } as ExcalidrawElementSkeleton;
    }
  };

  // groups first, outermost first, so they sit underneath their members
  const depth = (id: string) => {
    let d = 0;
    let cursor = model.groups.get(id)?.parent;
    while (cursor && d < 50) {
      d++;
      cursor = model.groups.get(cursor)?.parent;
    }
    return d;
  };
  const groups = [...model.groups.values()].sort(
    (a, b) => depth(a.id) - depth(b.id),
  );
  // frame id -> the element ids drawn inside it (set after conversion)
  const frames = new Map<string, Set<string>>();
  const frameOf = (container: string | undefined): string | undefined => {
    for (
      let cursor = container, n = 0;
      cursor && n < 50;
      cursor = model.groups.get(cursor)?.parent, n++
    ) {
      if (model.groups.get(cursor)?.frame) {
        return cursor;
      }
    }
    return undefined;
  };
  const inFrame = (container: string | undefined, ...ids: string[]) => {
    const frame = frameOf(container);
    if (frame) {
      const members = frames.get(elementId.group(frame)) ?? new Set();
      ids.forEach((id) => members.add(id));
      frames.set(elementId.group(frame), members);
    }
  };

  for (const group of groups) {
    const color = colorFor(group.color) ?? PALETTE.gray;
    const id = elementId.group(group.id);
    if (group.frame) {
      frames.set(id, frames.get(id) ?? new Set());
      add(
        {
          type: "frame",
          id,
          x: group.x!,
          y: group.y!,
          width: group.width!,
          height: group.height!,
          name: group.label,
          children: [],
        } as unknown as ExcalidrawElementSkeleton,
        {
          role: "group",
          id: group.id,
          label: group.label,
          parent: group.parent,
          color: group.color,
          frame: true,
          slide: group.slide,
          layout: group.layout,
          columns: group.columns,
          pinned: group.pinned || undefined,
          laid: [group.x!, group.y!],
          meta,
        },
      );
      continue;
    }
    inFrame(group.parent, id, elementId.groupLabel(group.id));
    add(
      {
        type: "rectangle",
        id,
        x: group.x!,
        y: group.y!,
        width: group.width!,
        height: group.height!,
        strokeColor: color.stroke,
        backgroundColor: color.fill,
        fillStyle: "solid",
        strokeStyle: "dashed",
        strokeWidth: 1,
        roughness,
        opacity: 100,
        roundness: { type: 3 },
        groupIds: [`gx-gg-${group.id}`],
        ...styleProps(group.style),
      } as ExcalidrawElementSkeleton,
      {
        role: "group",
        id: group.id,
        label: group.label,
        parent: group.parent,
        color: group.color,
        layout: group.layout,
        columns: group.columns,
        pinned: group.pinned || undefined,
        laid: [group.x!, group.y!],
        meta,
      },
    );
    // the name is its own text, not a bound label: a bound label gets 5px of
    // padding and runs into the rounded border; grouped with the box, it
    // still moves with it
    add(
      {
        type: "text",
        id: elementId.groupLabel(group.id),
        x: group.x! + GROUP_LABEL_INSET.x,
        y: group.y! + GROUP_LABEL_INSET.y,
        text: group.label,
        fontSize: GROUP_FONT_SIZE,
        fontFamily,
        strokeColor:
          (group.style?.strokeColor as string | undefined) ?? color.stroke,
        groupIds: [`gx-gg-${group.id}`],
      } as ExcalidrawElementSkeleton,
      { role: "group-label", id: group.id },
    );
  }

  for (const node of model.nodes.values()) {
    const color = nodeColor(node);
    const shape = nodeShape(node);
    const id = elementId.node(node.id);
    const fontSize = fontSizeOf(node);
    const gx: GxData = {
      role: "node",
      id: node.id,
      shape: node.shape,
      kind: node.kind,
      source: node.source,
      group: node.group,
      color: node.color,
      fields: node.fields,
      size: node.size,
      pinned: node.pinned || undefined,
      laid: [node.x!, node.y!],
      meta,
    };
    if (node.fields) {
      // a card: its parts are grouped with the box, so they move together
      const card = cardGeometry(node, theme);
      const together = [`gx-ng-${node.id}`];
      const parts: string[] = [id];
      add(
        {
          type: "rectangle",
          id,
          x: node.x!,
          y: node.y!,
          width: node.width!,
          height: node.height!,
          strokeColor: color.stroke,
          backgroundColor: color.fill,
          fillStyle: "solid",
          strokeWidth: 2,
          roughness,
          roundness: { type: 3 },
          groupIds: together,
          ...styleProps(node.style),
          link: node.link ?? null,
        } as ExcalidrawElementSkeleton,
        gx,
      );
      const titleId = elementId.nodePart(node.id, "title");
      parts.push(titleId);
      add(
        {
          type: "text",
          id: titleId,
          // a centred text's x is its middle
          x: node.x! + node.width! / 2,
          y: node.y! + CARD_PAD.y,
          text: node.label,
          fontSize: card.titleSize,
          fontFamily,
          textAlign: "center",
          strokeColor: color.stroke,
          groupIds: together,
        } as ExcalidrawElementSkeleton,
        { role: "node-part", id: node.id },
      );
      node.fields.forEach((lines, k) => {
        const y = node.y! + card.offsets[k];
        const ruleId = elementId.nodePart(node.id, `rule${k}`);
        const fieldId = elementId.nodeField(node.id, k);
        parts.push(ruleId, fieldId);
        add(
          {
            type: "line",
            id: ruleId,
            x: node.x!,
            y,
            width: node.width!,
            height: 0,
            points: [
              [0, 0],
              [node.width!, 0],
            ],
            strokeColor: color.stroke,
            strokeWidth: 1,
            roughness,
            groupIds: together,
          } as unknown as ExcalidrawElementSkeleton,
          { role: "node-part", id: node.id },
        );
        add(
          {
            type: "text",
            id: fieldId,
            x: node.x! + CARD_PAD.x,
            y: y + CARD_PAD.y,
            text: lines.join("\n") || " ",
            fontSize: FIELD_FONT_SIZE,
            fontFamily,
            textAlign: "left",
            strokeColor: "#1e1e1e",
            groupIds: together,
          } as ExcalidrawElementSkeleton,
          { role: "node-part", id: node.id },
        );
      });
      inFrame(node.group, ...parts);
      continue;
    }
    const sticky = shape === "sticky";
    const text = shape === "text";
    inFrame(node.group, id, elementId.nodeLabel(node.id));
    if (isOutlineShape(shape)) {
      // the symbol's lines first, then the invisible box that holds the
      // label and that arrows bind to, all moving as one
      const together = [`gx-ng-${node.id}`];
      for (const item of outlineItems(
        shape,
        node.width!,
        node.height!,
        color,
      )) {
        const partId = elementId.nodePart(node.id, `s-${item.key}`);
        const skeleton = itemSkeleton(item, partId, node.x!, node.y!, together);
        if (skeleton) {
          inFrame(node.group, partId);
          add(skeleton, { role: "node-part", id: node.id });
        }
      }
      const place = outlineLabel(shape);
      add(
        {
          type: "rectangle",
          id,
          x: node.x!,
          y: node.y!,
          width: node.width!,
          height: node.height!,
          strokeColor: "transparent",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 2,
          roughness,
          roundness: null,
          groupIds: together,
          link: node.link ?? null,
          label: {
            text: node.label,
            id: elementId.nodeLabel(node.id),
            fontSize,
            fontFamily,
            verticalAlign: place.verticalAlign,
            strokeColor: place.hidden ? "transparent" : color.stroke,
          },
        } as ExcalidrawElementSkeleton,
        gx,
      );
      continue;
    }
    add(
      {
        type: excalidrawType(shape),
        id,
        x: node.x!,
        y: node.y!,
        width: node.width!,
        height: node.height!,
        strokeColor: text ? "transparent" : color.stroke,
        backgroundColor: text
          ? "transparent"
          : sticky
          ? NOTE_COLORS[node.color ?? "yellow"] ?? color.fill
          : color.fill,
        fillStyle: "solid",
        strokeWidth: 2,
        roughness,
        roundness: shape === "rect" ? { type: 3 } : null,
        ...(sticky ? { baseHeight: node.height! } : null),
        ...(text ? null : styleProps(node.style)),
        link: node.link ?? null,
        label: {
          text: node.label,
          id: elementId.nodeLabel(node.id),
          fontSize: sticky ? NOTE_FONT_SIZE : fontSize,
          fontFamily,
          ...(text
            ? {
                textAlign: "left",
                strokeColor: colorFor(node.color)?.stroke ?? "#1e1e1e",
              }
            : null),
        },
      } as ExcalidrawElementSkeleton,
      gx,
    );
  }

  for (const edge of model.edges.values()) {
    const from = endOf(model, edge.from);
    const to = endOf(model, edge.to);
    if (!from || !to) {
      warnings.push(
        `edge "${edge.id}" was dropped: "${
          !from ? edge.from : edge.to
        }" no longer exists`,
      );
      continue;
    }
    const color = colorFor(edge.color) ?? { stroke: "#495057", fill: "" };
    // ELK's route when the layout made one; otherwise an elbow arrow the
    // editor routes, and keeps routing while a person drags its boxes
    const routed = !!edge.points && edge.points.length >= 2;
    if (!routed) {
      elbows.push(edge.id);
    }
    const route = routed ? edge.points! : straightRoute(from as Box, to as Box);
    const [ox, oy] = route[0];
    const rel = route.map(([px, py]) => [px - ox, py - oy]);
    const xs = rel.map((p) => p[0]);
    const ys = rel.map((p) => p[1]);
    add(
      {
        type: "arrow",
        id: elementId.edge(edge.id),
        x: ox,
        y: oy,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        points: rel,
        strokeColor: color.stroke,
        strokeWidth: 2,
        strokeStyle: edge.line ?? "solid",
        roughness,
        elbowed: false,
        roundness: null,
        ...styleProps(edge.style),
        startArrowhead: !edge.tail || edge.tail === "none" ? null : edge.tail,
        endArrowhead: edge.head === "none" ? null : edge.head ?? "arrow",
        start: { id: endElementId(model, edge.from) },
        end: { id: endElementId(model, edge.to) },
        ...(edge.label
          ? {
              label: {
                text: edge.label,
                id: elementId.edgeLabel(edge.id),
                fontSize: EDGE_FONT_SIZE,
                fontFamily,
                strokeColor: color.stroke,
              },
            }
          : null),
      } as unknown as ExcalidrawElementSkeleton,
      {
        role: "edge",
        id: edge.id,
        from: edge.from,
        to: edge.to,
        line: edge.line,
        color: edge.color,
      },
    );
    if (frameOf(from.group) && frameOf(from.group) === frameOf(to.group)) {
      inFrame(
        from.group,
        elementId.edge(edge.id),
        elementId.edgeLabel(edge.id),
      );
    }
  }

  for (const block of model.blocks.values()) {
    const drawing =
      drawings.get(block.id) ??
      drawBlock(block.type, block.spec, blockContext(theme));
    addBlock(block, drawing);
  }

  for (const note of model.notes.values()) {
    const id = elementId.note(note.id);
    add(
      {
        type: "stickynote",
        id,
        x: note.x!,
        y: note.y!,
        width: NOTE_WIDTH,
        height: 80,
        backgroundColor: NOTE_COLORS[note.color ?? "yellow"] ?? note.color,
        roughness,
        link: note.link ?? null,
        label: {
          text: note.text,
          id: elementId.noteLabel(note.id),
          fontSize: NOTE_FONT_SIZE,
          fontFamily,
        },
      } as ExcalidrawElementSkeleton,
      {
        role: "note",
        id: note.id,
        on: note.on,
        color: note.color,
        pinned: note.pinned || undefined,
        laid: [note.x!, note.y!],
      },
    );
  }

  let elements = convertToExcalidrawElements(skeletons, {
    regenerateIds: false,
  }) as ExcalidrawElement[];
  elements = routeElbows(elements, model, elbows);

  // note links: a thin dashed line from the note to what it is about, drawn
  // after conversion because a sticky note is not an arrow binding target
  const byId = new Map(elements.map((e) => [e.id, e]));
  const links: ExcalidrawElementSkeleton[] = [];
  for (const note of model.notes.values()) {
    if (!note.on) {
      continue;
    }
    const noteEl = byId.get(elementId.note(note.id));
    const targetId = model.nodes.has(note.on)
      ? elementId.node(note.on)
      : model.blocks.has(note.on)
      ? elementId.block(note.on)
      : model.groups.has(note.on)
      ? elementId.group(note.on)
      : model.edges.has(note.on)
      ? elementId.edge(note.on)
      : null;
    const target = targetId ? byId.get(targetId) : undefined;
    if (!noteEl || !target) {
      continue;
    }
    const [sx, sy] = closestEdgePoint(noteEl, centerOf(target));
    const [ex, ey] = closestEdgePoint(target, [sx, sy]);
    const id = elementId.noteLink(note.id);
    links.push({
      type: "line",
      id,
      x: sx,
      y: sy,
      width: ex - sx,
      height: ey - sy,
      points: [
        [0, 0],
        [ex - sx, ey - sy],
      ],
      strokeColor: "#868e96",
      strokeStyle: "dashed",
      strokeWidth: 1,
      roughness,
      locked: false,
    } as unknown as ExcalidrawElementSkeleton);
    gxById.set(id, { role: "note-link", id: note.id });
  }
  if (links.length) {
    elements = elements.concat(
      convertToExcalidrawElements(links, {
        regenerateIds: false,
      }) as ExcalidrawElement[],
    );
  }

  const frameBoxes = new Map<string, Box>();
  for (const skeleton of skeletons) {
    if (skeleton.type === "frame" && skeleton.id) {
      frameBoxes.set(skeleton.id, {
        x: skeleton.x as number,
        y: skeleton.y as number,
        width: skeleton.width as number,
        height: skeleton.height as number,
      });
    }
  }
  elements = settleFrames(elements, frames, frameBoxes);

  // stamp identity and versions
  elements = elements.map((element) => {
    const gx = gxById.get(element.id);
    const prev = previous.get(element.id);
    return {
      ...element,
      customData: gx
        ? { ...(element.customData ?? {}), gx }
        : element.customData,
      seed: prev?.seed ?? element.seed,
      version: (prev?.version ?? 0) + 1,
      versionNonce: randomInteger(),
      // keep bindings people made to agent boxes (their own arrows)
      boundElements: mergeBound(element, prev, previous),
    } as ExcalidrawElement;
  });

  return { elements, warnings };
};

/**
 * Frames come out of conversion with their children unset (and an x of 0
 * read as missing): put back the geometry asked for, mark each member, and
 * keep every frame's members right before it, the order the editor keeps.
 */
const settleFrames = (
  elements: ExcalidrawElement[],
  frames: Map<string, Set<string>>,
  geometry?: Map<string, Box>,
): ExcalidrawElement[] => {
  if (!frames.size) {
    return elements;
  }
  const memberOf = new Map<string, string>();
  for (const [frame, members] of frames) {
    members.forEach((m) => memberOf.set(m, frame));
  }
  const byId = new Map(elements.map((e) => [e.id, e]));
  const frameFor = (e: ExcalidrawElement) => {
    const own = memberOf.get(e.id);
    if (own) {
      return own;
    }
    const container = (e as ExcalidrawTextElement).containerId;
    return container ? memberOf.get(container) : undefined;
  };
  const fixed = elements.map((e) => {
    if (frames.has(e.id)) {
      const want = geometry?.get(e.id);
      return want ? ({ ...e, ...want } as ExcalidrawElement) : e;
    }
    const frame = frameFor(e);
    return frame && byId.has(frame)
      ? ({ ...e, frameId: frame } as ExcalidrawElement)
      : e;
  });
  const rest = fixed.filter((e) => !frames.has(e.id) && !e.frameId);
  const ordered = [...rest];
  for (const frame of frames.keys()) {
    const el = fixed.find((e) => e.id === frame);
    if (!el) {
      continue;
    }
    ordered.push(...fixed.filter((e) => e.frameId === frame), el);
  }
  return ordered;
};

/** The sides two boxes face each other with, as fixed points. */
const facingSides = (a: Box, b: Box): [FixedPoint, FixedPoint] => {
  const [ax, ay] = centerOf(a);
  const [bx, by] = centerOf(b);
  const gapX = Math.abs(bx - ax) - (a.width + b.width) / 2;
  const gapY = Math.abs(by - ay) - (a.height + b.height) / 2;
  if (gapX >= gapY) {
    return bx >= ax
      ? [[1, 0.5] as FixedPoint, [0, 0.5] as FixedPoint]
      : [[0, 0.5] as FixedPoint, [1, 0.5] as FixedPoint];
  }
  return by >= ay
    ? [[0.5, 1] as FixedPoint, [0.5, 0] as FixedPoint]
    : [[0.5, 0] as FixedPoint, [0.5, 1] as FixedPoint];
};

/** Turns the listed edges into elbow arrows routed by the editor's own code. */
const routeElbows = (
  elements: ExcalidrawElement[],
  model: Model,
  edgeIds: string[],
): ExcalidrawElement[] => {
  if (!edgeIds.length) {
    return elements;
  }
  const map = new Map(
    elements.map((e) => [e.id, { ...e } as ExcalidrawElement]),
  );
  const elementsMap = map as unknown as NonDeletedSceneElementsMap;
  const labelled: [string, string][] = [];
  for (const id of edgeIds) {
    const edge = model.edges.get(id)!;
    const arrow = map.get(elementId.edge(id));
    const a = map.get(endElementId(model, edge.from));
    const b = map.get(endElementId(model, edge.to));
    if (!arrow || !a || !b) {
      continue;
    }
    const [startPoint, endPoint] = facingSides(a, b);
    const start = [
      a.x + a.width * startPoint[0],
      a.y + a.height * startPoint[1],
    ];
    const end = [b.x + b.width * endPoint[0], b.y + b.height * endPoint[1]];
    const startBinding: FixedPointBinding = {
      elementId: a.id,
      fixedPoint: startPoint,
      mode: "orbit",
    };
    const endBinding: FixedPointBinding = {
      elementId: b.id,
      fixedPoint: endPoint,
      mode: "orbit",
    };
    const points = [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(end[0] - start[0], end[1] - start[1]),
    ];
    const base = {
      ...arrow,
      x: start[0],
      y: start[1],
      points,
      elbowed: true,
      roundness: null,
      fixedSegments: null,
      startIsSpecial: null,
      endIsSpecial: null,
      startBinding,
      endBinding,
    } as unknown as ExcalidrawElbowArrowElement;
    map.set(arrow.id, {
      ...base,
      ...updateElbowArrowPoints(base, elementsMap, {
        points,
        startBinding,
        endBinding,
      }),
    } as ExcalidrawElement);
    if (edge.label) {
      labelled.push([arrow.id, elementId.edgeLabel(id)]);
    }
  }
  // labels sit on the middle of the new route
  const scene = new Scene(elementsMap);
  for (const [arrowId, textId] of labelled) {
    const text = map.get(textId) as ExcalidrawTextElement | undefined;
    const arrow = map.get(arrowId);
    if (text && arrow) {
      redrawTextBoundingBox(text, arrow as never, scene);
    }
  }
  return elements.map((e) => scene.getElement(e.id) ?? map.get(e.id)!);
};

const mergeBound = (
  element: ExcalidrawElement,
  prev: ExcalidrawElement | undefined,
  previous: Map<string, ExcalidrawElement>,
) => {
  const own = element.boundElements ?? [];
  const extra = (prev?.boundElements ?? []).filter(
    (b) =>
      !b.id.startsWith("gx-") &&
      !previous.has(b.id) &&
      !own.some((o) => o.id === b.id),
  );
  return own.length || extra.length ? [...own, ...extra] : null;
};

export const labelOfText = (e: ExcalidrawTextElement) =>
  e.originalText ?? e.text;

export { GROUP_PAD };
