// Agent operations. Every operation names things by the agent's own ids and
// never by coordinates; placement is the layout's job. An operation that
// cannot be applied as written is REFUSED with a reason rather than guessed
// at, so the agent learns the id it got wrong instead of a silently different
// drawing.

import { BLOCK_TYPES, BlockError, validateBlock, widgetIds } from "./blocks";
import { MermaidError } from "./mermaid-text";
import { ID_PATTERN, widgetEnd } from "./model";
import { OUTLINE_SHAPES } from "./shapes";

import type {
  BlockModel,
  Border,
  BlockType,
  Direction,
  EdgeModel,
  GroupModel,
  Head,
  Layout,
  LineStyle,
  Model,
  NodeModel,
  NoteModel,
  Shape,
  TextSize,
  Theme,
} from "./model";

export type Op =
  | {
      op: "node";
      id: string;
      label?: string;
      shape?: Shape;
      kind?: string | null;
      source?: string | null;
      group?: string | null;
      color?: string | null;
      fields?: string[] | string[][] | null;
      size?: TextSize | null;
      link?: string | null;
      border?: Border | null;
      at?: [number, number];
      width?: number;
      height?: number;
    }
  | {
      op: "edge";
      id?: string;
      from: string;
      to: string;
      label?: string | null;
      line?: LineStyle;
      color?: string | null;
      head?: Head;
      tail?: Head;
    }
  | {
      op: "group";
      id: string;
      label?: string;
      parent?: string | null;
      color?: string | null;
      frame?: boolean;
      slide?: boolean;
      layout?: Layout | null;
      columns?: number | null;
      border?: Border | null;
    }
  | ({
      op: BlockType;
      id: string;
      group?: string | null;
    } & Record<string, unknown>)
  | {
      op: "note";
      id?: string;
      text: string;
      on?: string | null;
      color?: string | null;
      link?: string | null;
      at?: [number, number];
    }
  | { op: "remove"; id: string }
  | {
      op: "layout";
      direction?: Direction;
      keepPinned?: boolean;
      algorithm?: Layout;
      columns?: number;
    }
  | {
      op: "meta";
      direction?: Direction;
      theme?: Theme;
      layout?: Layout;
      columns?: number;
    }
  | { op: "clear" };

export type ApplyOutcome = {
  touched: Set<string>;
  removed: Set<string>;
  warnings: string[];
  layout: null | { keepPinned: boolean };
  /** pictures an image op brought, to add to the scene's files */
  files: { id: string; dataURL: string; mimeType: string }[];
};

/** FNV-1a over the data URL: one file id per picture, whoever sends it. */
const fileIdOf = (dataURL: string) => {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < dataURL.length; i++) {
    const c = dataURL.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  return `gx-img-${a.toString(16).padStart(8, "0")}${b
    .toString(16)
    .padStart(8, "0")}`;
};

const SHAPES: Shape[] = [
  "rect",
  "ellipse",
  "diamond",
  "sticky",
  "text",
  ...OUTLINE_SHAPES,
];
const LINES: LineStyle[] = ["solid", "dashed", "dotted"];
const DIRECTIONS: Direction[] = ["RIGHT", "DOWN", "LEFT", "UP"];
const THEMES: Theme[] = ["clean", "sketch"];
export const LAYOUTS: Layout[] = ["layered", "tree", "radial", "grid", "lanes"];
const SIZES: TextSize[] = ["s", "m", "l", "xl"];
const BORDERS: Border[] = ["solid", "dashed", "dotted", "bold", "none"];
export const HEADS: Head[] = [
  "none",
  "arrow",
  "bar",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "cardinality_one",
  "cardinality_many",
  "cardinality_one_or_many",
  "cardinality_exactly_one",
  "cardinality_zero_or_one",
  "cardinality_zero_or_many",
];

class OpError extends Error {}

const fail = (index: number, op: unknown, message: string): never => {
  throw new OpError(`op #${index + 1} ${JSON.stringify(op)}: ${message}`);
};

const checkId = (index: number, op: unknown, id: unknown, what = "id") => {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    fail(
      index,
      op,
      `${what} must match ${ID_PATTERN} (letters, digits, _ . : - >), got ${JSON.stringify(
        id,
      )}`,
    );
  }
};

const optional = <T>(value: T | null | undefined, previous: T | undefined) =>
  value === undefined ? previous : value === null ? undefined : value;

const ownerOf = (model: Model, id: string) =>
  model.nodes.has(id)
    ? "node"
    : model.edges.has(id)
    ? "edge"
    : model.groups.has(id)
    ? "group"
    : model.notes.has(id)
    ? "note"
    : model.blocks.has(id)
    ? "block"
    : null;

/** `fields` as sections: a flat list is one section. */
const sectionsOf = (
  index: number,
  op: unknown,
  fields: unknown,
): string[][] | undefined => {
  if (fields === undefined || fields === null) {
    return undefined;
  }
  const bad = () =>
    fail(
      index,
      op,
      "`fields` is a list of lines, or a list of sections (each a list of lines)",
    );
  if (!Array.isArray(fields) || !fields.length) {
    bad();
  }
  const list = fields as unknown[];
  const sections = list.every((f) => typeof f === "string")
    ? [list as string[]]
    : list.every(
        (f) => Array.isArray(f) && f.every((l) => typeof l === "string"),
      )
    ? (list as string[][])
    : bad();
  if (sections!.length > 6 || sections!.some((s) => s.length > 40)) {
    fail(index, op, "a card has at most 6 sections of 40 lines");
  }
  return sections!;
};

const checkLayout = (
  index: number,
  op: unknown,
  layout: unknown,
  columns: unknown,
) => {
  if (
    layout !== undefined &&
    layout !== null &&
    !LAYOUTS.includes(layout as Layout)
  ) {
    fail(index, op, `layout must be one of ${LAYOUTS.join(", ")}`);
  }
  if (
    columns !== undefined &&
    columns !== null &&
    (typeof columns !== "number" ||
      !Number.isInteger(columns) ||
      columns < 1 ||
      columns > 20)
  ) {
    fail(index, op, "columns must be a whole number from 1 to 20");
  }
};

const checkBorder = (index: number, op: unknown, border: unknown) => {
  if (
    border !== undefined &&
    border !== null &&
    !BORDERS.includes(border as Border)
  ) {
    fail(index, op, `border must be one of ${BORDERS.join(", ")}`);
  }
};

/** A link opens from the element: a web address or any short reference. */
const checkLink = <T>(index: number, op: unknown, link: T): T => {
  if (
    link !== undefined &&
    link !== null &&
    (typeof link !== "string" || !link.trim() || link.length > 2000)
  ) {
    fail(
      index,
      op,
      "link is a non-empty string (a URL) of at most 2000 characters",
    );
  }
  return link;
};

const isFrame = (model: Model, id: string | undefined) =>
  !!id && !!model.groups.get(id)?.frame;

const groupCycle = (model: Model, id: string, parent: string | undefined) => {
  let cursor = parent;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id || seen.has(cursor)) {
      return true;
    }
    seen.add(cursor);
    cursor = model.groups.get(cursor)?.parent;
  }
  return false;
};

const nextNoteId = (model: Model) => {
  let n = model.notes.size + 1;
  while (model.notes.has(`note-${n}`)) {
    n++;
  }
  return `note-${n}`;
};

/**
 * Applies `ops` to `model` in order. All or nothing: the model is only
 * changed when every op is valid; the caller passes a copy.
 */
export const applyOps = (model: Model, ops: Op[]): ApplyOutcome => {
  const outcome: ApplyOutcome = {
    touched: new Set(),
    removed: new Set(),
    warnings: [],
    layout: null,
    files: [],
  };

  // edges, notes and groups may name things created later in the same batch
  const deferred: (() => void)[] = [];

  ops.forEach((op, index) => {
    if (!op || typeof op !== "object" || typeof op.op !== "string") {
      fail(index, op, "an op is an object with an `op` field");
    }
    switch (op.op) {
      case "node": {
        checkId(index, op, op.id);
        const kind = ownerOf(model, op.id);
        if (kind && kind !== "node") {
          fail(index, op, `id "${op.id}" is already a ${kind}`);
        }
        if (op.shape !== undefined && !SHAPES.includes(op.shape)) {
          fail(index, op, `shape must be one of ${SHAPES.join(", ")}`);
        }
        if (
          op.size !== undefined &&
          op.size !== null &&
          !SIZES.includes(op.size)
        ) {
          fail(index, op, `size must be one of ${SIZES.join(", ")}`);
        }
        const fields =
          op.fields === undefined
            ? undefined
            : sectionsOf(index, op, op.fields);
        checkBorder(index, op, op.border);
        const prev = model.nodes.get(op.id);
        if (!prev && (typeof op.label !== "string" || !op.label.trim())) {
          fail(index, op, "a new node needs a non-empty `label`");
        }
        const node: NodeModel = {
          id: op.id,
          label: op.label ?? prev!.label,
          shape: op.shape ?? prev?.shape ?? "rect",
          kind: optional(op.kind, prev?.kind),
          source: optional(op.source, prev?.source),
          group: optional(op.group, prev?.group),
          color: optional(op.color, prev?.color),
          fields: op.fields === undefined ? prev?.fields : fields,
          size: optional(op.size, prev?.size),
          border: optional(op.border, prev?.border),
          link: optional(checkLink(index, op, op.link), prev?.link),
          x: op.at ? op.at[0] : prev?.x,
          y: op.at ? op.at[1] : prev?.y,
          width: op.width ?? prev?.width,
          height: op.height ?? prev?.height,
          pinned: op.at ? true : prev?.pinned ?? false,
          style:
            op.color !== undefined || op.border !== undefined
              ? undefined
              : prev?.style,
        };
        if (node.fields && node.shape !== "rect") {
          fail(
            index,
            op,
            `a ${node.shape} node cannot carry fields (a card is a rect)`,
          );
        }
        if (
          op.label !== undefined ||
          op.shape !== undefined ||
          op.fields !== undefined ||
          op.size !== undefined
        ) {
          // re-measure the box for the new label or shape
          if (op.width === undefined) {
            node.width = undefined;
          }
          if (op.height === undefined) {
            node.height = undefined;
          }
        }
        if (node.group) {
          const group = node.group;
          deferred.push(() => {
            if (!model.groups.has(group)) {
              fail(
                index,
                op,
                `group "${group}" does not exist (add it with a group op)`,
              );
            }
          });
        }
        model.nodes.set(op.id, node);
        outcome.touched.add(op.id);
        break;
      }
      case "edge": {
        checkId(index, op, op.from, "from");
        checkId(index, op, op.to, "to");
        const id = op.id ?? `${op.from}->${op.to}`;
        if (op.id !== undefined) {
          checkId(index, op, op.id);
        }
        const kind = ownerOf(model, id);
        if (kind && kind !== "edge") {
          fail(index, op, `id "${id}" is already a ${kind}`);
        }
        if (op.line !== undefined && !LINES.includes(op.line)) {
          fail(index, op, `line must be one of ${LINES.join(", ")}`);
        }
        for (const end of ["head", "tail"] as const) {
          if (op[end] !== undefined && !HEADS.includes(op[end]!)) {
            fail(index, op, `${end} must be one of ${HEADS.join(", ")}`);
          }
        }
        const prev = model.edges.get(id);
        const edge: EdgeModel = {
          id,
          from: op.from,
          to: op.to,
          label: optional(op.label, prev?.label),
          line: op.line ?? prev?.line,
          color: optional(op.color, prev?.color),
          head: op.head ?? prev?.head,
          tail: op.tail ?? prev?.tail,
          style: op.color !== undefined ? undefined : prev?.style,
          points:
            prev &&
            prev.from === op.from &&
            prev.to === op.to &&
            op.label === undefined
              ? prev.points
              : undefined,
        };
        deferred.push(() => {
          for (const end of [edge.from, edge.to]) {
            if (model.nodes.has(end) || model.blocks.has(end)) {
              continue;
            }
            const widget = widgetEnd(model, end);
            if (!widget) {
              fail(
                index,
                op,
                `edge end "${end}" is not a node, a block or <screen>.<widget id>`,
              );
            }
            if (
              !widgetIds(model.blocks.get(widget!.block)!.spec).has(
                widget!.widget,
              )
            ) {
              fail(
                index,
                op,
                `screen "${widget!.block}" has no widget with id "${
                  widget!.widget
                }"`,
              );
            }
          }
        });
        model.edges.set(id, edge);
        outcome.touched.add(id);
        break;
      }
      case "group": {
        checkId(index, op, op.id);
        const kind = ownerOf(model, op.id);
        if (kind && kind !== "group") {
          fail(index, op, `id "${op.id}" is already a ${kind}`);
        }
        const prev = model.groups.get(op.id);
        if (!prev && (typeof op.label !== "string" || !op.label.trim())) {
          fail(index, op, "a new group needs a non-empty `label`");
        }
        checkLayout(index, op, op.layout, op.columns);
        checkBorder(index, op, op.border);
        for (const flag of ["frame", "slide"] as const) {
          if (op[flag] !== undefined && typeof op[flag] !== "boolean") {
            fail(index, op, `${flag} is true or false`);
          }
        }
        const group: GroupModel = {
          id: op.id,
          label: op.label ?? prev!.label,
          parent: optional(op.parent, prev?.parent),
          color: optional(op.color, prev?.color),
          // a slide is a frame
          frame: op.slide ? true : op.frame ?? prev?.frame,
          slide: op.slide ?? prev?.slide,
          layout: optional(op.layout, prev?.layout),
          columns: optional(op.columns, prev?.columns),
          border: optional(op.border, prev?.border),
          x: prev?.x,
          y: prev?.y,
          width: prev?.width,
          height: prev?.height,
          pinned: prev?.pinned ?? false,
          style:
            op.color !== undefined || op.border !== undefined
              ? undefined
              : prev?.style,
        };
        deferred.push(() => {
          if (group.parent && !model.groups.has(group.parent)) {
            fail(index, op, `parent group "${group.parent}" does not exist`);
          }
          if (groupCycle(model, group.id, group.parent)) {
            fail(index, op, `group "${group.id}" would contain itself`);
          }
          // Excalidraw frames do not nest
          if (group.frame) {
            for (
              let cursor = group.parent, n = 0;
              cursor && n < 50;
              cursor = model.groups.get(cursor)?.parent, n++
            ) {
              if (isFrame(model, cursor)) {
                fail(
                  index,
                  op,
                  `a frame cannot be inside another frame ("${cursor}")`,
                );
              }
            }
          }
        });
        model.groups.set(op.id, group);
        outcome.touched.add(op.id);
        break;
      }
      case "note": {
        if (typeof op.text !== "string" || !op.text.trim()) {
          fail(index, op, "a note needs non-empty `text`");
        }
        const id = op.id ?? nextNoteId(model);
        checkId(index, op, id);
        const kind = ownerOf(model, id);
        if (kind && kind !== "note") {
          fail(index, op, `id "${id}" is already a ${kind}`);
        }
        const prev = model.notes.get(id);
        const note: NoteModel = {
          id,
          text: op.text,
          on: optional(op.on, prev?.on),
          color: optional(op.color, prev?.color),
          link: optional(checkLink(index, op, op.link), prev?.link),
          x: op.at ? op.at[0] : prev?.x,
          y: op.at ? op.at[1] : prev?.y,
          width: op.text !== prev?.text ? undefined : prev?.width,
          height: op.text !== prev?.text ? undefined : prev?.height,
          pinned: op.at ? true : prev?.pinned ?? false,
        };
        if (note.on) {
          const target = note.on;
          deferred.push(() => {
            if (!ownerOf(model, target) || model.notes.has(target)) {
              fail(
                index,
                op,
                `note target "${target}" is not a node, edge, group or block`,
              );
            }
          });
        }
        model.notes.set(id, note);
        outcome.touched.add(id);
        break;
      }
      case "remove": {
        checkId(index, op, op.id);
        const kind = ownerOf(model, op.id);
        if (!kind) {
          fail(index, op, `nothing is called "${op.id}"`);
        }
        if (kind === "node") {
          model.nodes.delete(op.id);
          for (const edge of [...model.edges.values()]) {
            if (edge.from === op.id || edge.to === op.id) {
              model.edges.delete(edge.id);
              outcome.removed.add(edge.id);
            }
          }
        } else if (kind === "edge") {
          model.edges.delete(op.id);
        } else if (kind === "block") {
          model.blocks.delete(op.id);
          const inside = (end: string) =>
            end === op.id || end.startsWith(`${op.id}.`);
          for (const edge of [...model.edges.values()]) {
            if (inside(edge.from) || inside(edge.to)) {
              model.edges.delete(edge.id);
              outcome.removed.add(edge.id);
            }
          }
        } else if (kind === "group") {
          const parent = model.groups.get(op.id)!.parent;
          model.groups.delete(op.id);
          for (const node of [
            ...model.nodes.values(),
            ...model.blocks.values(),
          ]) {
            if (node.group === op.id) {
              node.group = parent;
            }
          }
          for (const group of model.groups.values()) {
            if (group.parent === op.id) {
              group.parent = parent;
            }
          }
        } else {
          model.notes.delete(op.id);
        }
        for (const note of model.notes.values()) {
          if (note.on === op.id) {
            note.on = undefined;
            outcome.warnings.push(
              `note "${note.id}" was attached to "${op.id}" and is now free-standing`,
            );
          }
        }
        outcome.removed.add(op.id);
        outcome.touched.delete(op.id);
        break;
      }
      case "layout": {
        if (op.direction !== undefined) {
          if (!DIRECTIONS.includes(op.direction)) {
            fail(
              index,
              op,
              `direction must be one of ${DIRECTIONS.join(", ")}`,
            );
          }
          model.meta.direction = op.direction;
        }
        checkLayout(index, op, op.algorithm, op.columns);
        if (op.algorithm !== undefined) {
          model.meta.layout = op.algorithm;
        }
        if (op.columns !== undefined) {
          model.meta.columns = op.columns;
        }
        outcome.layout = { keepPinned: !!op.keepPinned };
        break;
      }
      case "meta": {
        if (op.direction !== undefined) {
          if (!DIRECTIONS.includes(op.direction)) {
            fail(
              index,
              op,
              `direction must be one of ${DIRECTIONS.join(", ")}`,
            );
          }
          model.meta.direction = op.direction;
        }
        if (op.theme !== undefined) {
          if (!THEMES.includes(op.theme)) {
            fail(index, op, `theme must be one of ${THEMES.join(", ")}`);
          }
          model.meta.theme = op.theme;
        }
        checkLayout(index, op, op.layout, op.columns);
        if (op.layout !== undefined) {
          model.meta.layout = op.layout;
        }
        if (op.columns !== undefined) {
          model.meta.columns = op.columns;
        }
        break;
      }
      case "clear": {
        for (const map of [
          model.nodes,
          model.edges,
          model.groups,
          model.notes,
          model.blocks,
        ]) {
          for (const id of map.keys()) {
            outcome.removed.add(id);
          }
          map.clear();
        }
        break;
      }
      default: {
        const type = (op as { op: string }).op as BlockType;
        if (!BLOCK_TYPES.includes(type)) {
          fail(
            index,
            op,
            `unknown op "${type}" (node, edge, group, note, ${BLOCK_TYPES.join(
              ", ",
            )}, remove, layout, meta, clear)`,
          );
        }
        const raw = op as { id: string; group?: string | null } & Record<
          string,
          unknown
        >;
        checkId(index, op, raw.id);
        const kind = ownerOf(model, raw.id);
        if (kind && kind !== "block") {
          fail(index, op, `id "${raw.id}" is already a ${kind}`);
        }
        const prev = model.blocks.get(raw.id);
        if (prev && prev.type !== type) {
          fail(index, op, `"${raw.id}" is a ${prev.type}, not a ${type}`);
        }
        const { op: _op, id: _id, group, ...spec } = raw;
        if (type === "image" && spec.src === undefined && prev) {
          // a new label or width for a picture already in the scene
          spec.fileId = prev.spec.fileId;
        }
        if (type === "library" && spec.elements === undefined && prev) {
          // a new caption or size for an item already drawn
          spec.elements = prev.spec.elements;
          spec.library ??= prev.spec.library;
          spec.item ??= prev.spec.item;
          spec.source ??= prev.spec.source;
        }
        try {
          validateBlock(type, spec);
        } catch (error) {
          if (error instanceof BlockError) {
            fail(index, op, error.message);
          }
          throw error;
        }
        if (type === "image") {
          // the picture goes to the scene's files; the description keeps its id
          if (typeof spec.src === "string") {
            const src = spec.src as string;
            const fileId = fileIdOf(src);
            outcome.files.push({
              id: fileId,
              dataURL: src,
              mimeType: src.slice(5, src.indexOf(";")),
            });
            delete spec.src;
            delete spec.aspect;
            spec.fileId = fileId;
          } else if (prev) {
            spec.fileId = prev.spec.fileId;
            spec.aspect = prev.spec.aspect;
            spec.naturalWidth = prev.spec.naturalWidth;
          }
        }
        const block: BlockModel = {
          id: raw.id,
          type,
          spec,
          group: optional(group, prev?.group),
          x: prev?.x,
          y: prev?.y,
          // a new description is drawn at a new size
          width: undefined,
          height: undefined,
          pinned: prev?.pinned ?? false,
          laid: prev?.laid,
        };
        if (block.group) {
          const g = block.group;
          deferred.push(() => {
            if (!model.groups.has(g)) {
              fail(index, op, `group "${g}" does not exist`);
            }
          });
        }
        if (type === "wireframe" && block.group) {
          const g = block.group;
          deferred.push(() => {
            for (
              let cursor: string | undefined = g, n = 0;
              cursor && n < 50;
              cursor = model.groups.get(cursor)?.parent, n++
            ) {
              if (isFrame(model, cursor)) {
                fail(
                  index,
                  op,
                  `a wireframe is a frame and cannot be inside frame "${cursor}"`,
                );
              }
            }
          });
        }
        model.blocks.set(raw.id, block);
        outcome.touched.add(raw.id);
      }
    }
  });

  for (const check of deferred) {
    check();
  }
  return outcome;
};

/** A refusal the agent caused and can fix, rather than a fault in the canvas. */
export const isOpError = (error: unknown): error is Error =>
  error instanceof OpError || error instanceof MermaidError;
