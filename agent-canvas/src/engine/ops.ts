// Agent operations. Every operation names things by the agent's own ids and
// never by coordinates; placement is the layout's job. An operation that
// cannot be applied as written is REFUSED with a reason rather than guessed
// at, so the agent learns the id it got wrong instead of a silently different
// drawing.

import { ID_PATTERN } from "./model";

import type {
  Direction,
  EdgeModel,
  GroupModel,
  LineStyle,
  Model,
  NodeModel,
  NoteModel,
  Shape,
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
    }
  | {
      op: "group";
      id: string;
      label?: string;
      parent?: string | null;
      color?: string | null;
    }
  | {
      op: "note";
      id?: string;
      text: string;
      on?: string | null;
      color?: string | null;
      at?: [number, number];
    }
  | { op: "remove"; id: string }
  | { op: "layout"; direction?: Direction; keepPinned?: boolean }
  | { op: "meta"; direction?: Direction; theme?: Theme }
  | { op: "clear" };

export type ApplyOutcome = {
  touched: Set<string>;
  removed: Set<string>;
  warnings: string[];
  layout: null | { keepPinned: boolean };
};

const SHAPES: Shape[] = ["rect", "ellipse", "diamond"];
const LINES: LineStyle[] = ["solid", "dashed", "dotted"];
const DIRECTIONS: Direction[] = ["RIGHT", "DOWN", "LEFT", "UP"];
const THEMES: Theme[] = ["clean", "sketch"];

class OpError extends Error {}

const fail = (index: number, op: unknown, message: string): never => {
  throw new OpError(`op #${index + 1} ${JSON.stringify(op)}: ${message}`);
};

const checkId = (index: number, op: unknown, id: unknown, what = "id") => {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    fail(
      index,
      op,
      `${what} must match ${ID_PATTERN} (letters, digits, _ . : -), got ${JSON.stringify(
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
    : null;

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
          x: op.at ? op.at[0] : prev?.x,
          y: op.at ? op.at[1] : prev?.y,
          width: op.width ?? prev?.width,
          height: op.height ?? prev?.height,
          pinned: op.at ? true : prev?.pinned ?? false,
          style: op.color !== undefined ? undefined : prev?.style,
        };
        if (op.label !== undefined || op.shape !== undefined) {
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
        const prev = model.edges.get(id);
        const edge: EdgeModel = {
          id,
          from: op.from,
          to: op.to,
          label: optional(op.label, prev?.label),
          line: op.line ?? prev?.line,
          color: optional(op.color, prev?.color),
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
            if (!model.nodes.has(end)) {
              fail(index, op, `edge end "${end}" is not a node`);
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
        const group: GroupModel = {
          id: op.id,
          label: op.label ?? prev!.label,
          parent: optional(op.parent, prev?.parent),
          color: optional(op.color, prev?.color),
          x: prev?.x,
          y: prev?.y,
          width: prev?.width,
          height: prev?.height,
          pinned: prev?.pinned ?? false,
          style: op.color !== undefined ? undefined : prev?.style,
        };
        deferred.push(() => {
          if (group.parent && !model.groups.has(group.parent)) {
            fail(index, op, `parent group "${group.parent}" does not exist`);
          }
          if (groupCycle(model, group.id, group.parent)) {
            fail(index, op, `group "${group.id}" would contain itself`);
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
                `note target "${target}" is not a node, edge or group`,
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
        } else if (kind === "group") {
          const parent = model.groups.get(op.id)!.parent;
          model.groups.delete(op.id);
          for (const node of model.nodes.values()) {
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
        break;
      }
      case "clear": {
        for (const map of [
          model.nodes,
          model.edges,
          model.groups,
          model.notes,
        ]) {
          for (const id of map.keys()) {
            outcome.removed.add(id);
          }
          map.clear();
        }
        break;
      }
      default:
        fail(index, op, `unknown op "${(op as { op: string }).op}"`);
    }
  });

  for (const check of deferred) {
    check();
  }
  return outcome;
};

export const isOpError = (error: unknown): error is Error =>
  error instanceof OpError;
