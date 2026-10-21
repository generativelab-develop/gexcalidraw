// Blocks: composite figures the agent describes as data and the engine draws.
// A table is rows of cells, a sequence diagram is participants and messages,
// a timeline is dated tasks, a wireframe is a screen of widgets, a sketch is
// shapes in the block's own coordinates. Each type has a validator, which
// refuses a description it cannot draw as written, and a drawing function,
// which turns the description into positioned primitives relative to the
// block's top-left corner. Nothing here knows Excalidraw: render.ts turns the
// primitives into elements, and the text measurer is passed in, so the
// geometry is testable without a browser.

import type { BlockType, Head, LineStyle } from "./model";

export type Measure = (
  text: string,
  fontSize: number,
) => { width: number; height: number };

export type Paint = { stroke: string; fill: string };

export type DrawContext = {
  measure: Measure;
  /** a palette name or #rrggbb, as nodes take it */
  paint: (color: string | undefined, fallback: string) => Paint;
};

type Base = { key: string };
export type ShapeItem = Base & {
  kind: "rect" | "ellipse" | "diamond";
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string;
  fill: string;
  fillStyle?: "solid" | "hachure" | "cross-hatch";
  line?: LineStyle;
  strokeWidth?: number;
  rounded?: boolean;
  opacity?: number;
  label?: { text: string; size: number; color?: string; align?: Align };
};
export type Align = "left" | "center" | "right";
export type TextItem = Base & {
  kind: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  align?: Align;
  opacity?: number;
};
export type LineItem = Base & {
  kind: "line" | "arrow";
  points: [number, number][];
  stroke: string;
  /** a closed line filled with `fill`: any polygon */
  closed?: boolean;
  fill?: string;
  opacity?: number;
  line?: LineStyle;
  strokeWidth?: number;
  head?: Head;
  tail?: Head;
};
export type FrameItem = Base & {
  kind: "frame";
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
};
export type ImageItem = Base & {
  kind: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  fileId: string;
};
/** a pen stroke */
export type FreedrawItem = Base & {
  kind: "freedraw";
  points: [number, number][];
  stroke: string;
  strokeWidth?: number;
  opacity?: number;
};
export type Item =
  | ShapeItem
  | TextItem
  | LineItem
  | FrameItem
  | ImageItem
  | FreedrawItem;

export type Drawing = {
  width: number;
  height: number;
  items: Item[];
  /** overrides the theme's line style for this block (a lo-fi sketch) */
  roughness?: number;
};

export class BlockError extends Error {}

const refuse = (message: string): never => {
  throw new BlockError(message);
};

// ---------------------------------------------------------------- helpers

const INK = "#1e1e1e";
const MUTED = "#868e96";
const RULE = "#adb5bd";
const TITLE_SIZE = 24;
const BODY = 16;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const str = (
  v: unknown,
  what: string,
  required = false,
): string | undefined => {
  if (v === undefined || v === null) {
    return required ? refuse(`${what} is required`) : undefined;
  }
  if (typeof v !== "string") {
    return refuse(`${what} must be a string, got ${JSON.stringify(v)}`);
  }
  if (required && !v.trim()) {
    return refuse(`${what} must not be empty`);
  }
  return v;
};

const list = (v: unknown, what: string, max = 400): unknown[] => {
  if (!Array.isArray(v)) {
    return refuse(`${what} must be a list`);
  }
  if (v.length > max) {
    return refuse(`${what} has ${v.length} entries; at most ${max}`);
  }
  return v;
};

const num = (
  v: unknown,
  what: string,
  min: number,
  max: number,
): number | undefined => {
  if (v === undefined || v === null) {
    return undefined;
  }
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    return refuse(`${what} must be a number from ${min} to ${max}`);
  }
  return v;
};

const oneOf = <T extends string>(
  v: unknown,
  what: string,
  options: readonly T[],
): T | undefined => {
  if (v === undefined || v === null) {
    return undefined;
  }
  if (!options.includes(v as T)) {
    return refuse(`${what} must be one of ${options.join(", ")}`);
  }
  return v as T;
};

const LINES = ["solid", "dashed", "dotted"] as const;

/** Breaks `text` into lines no wider than `max`: at spaces, else anywhere. */
export const wrap = (
  text: string,
  max: number,
  size: number,
  measure: Measure,
): string => {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    const push = (word: string) => {
      const next = line ? `${line} ${word}` : word;
      if (!line || measure(next, size).width <= max) {
        line = next;
        return;
      }
      out.push(line);
      line = word;
    };
    for (const word of paragraph.split(/ +/)) {
      if (measure(word, size).width <= max) {
        push(word);
        continue;
      }
      // a word wider than the line (or a run of Hangul with no space)
      let piece = "";
      for (const char of word) {
        if (
          piece &&
          measure(line ? `${line} ${piece}${char}` : piece + char, size).width >
            max
        ) {
          push(piece);
          if (line) {
            out.push(line);
            line = "";
          }
          piece = char;
        } else {
          piece += char;
        }
      }
      if (piece) {
        push(piece);
      }
    }
    out.push(line);
  }
  return out.join("\n");
};

const titleItems = (
  title: string | undefined,
  ctx: DrawContext,
): { items: Item[]; height: number; width: number } => {
  if (!title) {
    return { items: [], height: 0, width: 0 };
  }
  const size = ctx.measure(title, TITLE_SIZE);
  return {
    items: [
      {
        kind: "text",
        key: "title",
        x: 0,
        y: 0,
        text: title,
        size: TITLE_SIZE,
        color: INK,
      },
    ],
    height: size.height + 16,
    width: size.width,
  };
};

const isLine = (item: Item): item is LineItem | FreedrawItem =>
  item.kind === "line" || item.kind === "arrow" || item.kind === "freedraw";

const shift = (items: Item[], dx: number, dy: number): Item[] =>
  items.map((item) => {
    if (isLine(item)) {
      return {
        ...item,
        points: item.points.map(
          ([x, y]) => [x + dx, y + dy] as [number, number],
        ),
      };
    }
    return { ...item, x: item.x + dx, y: item.y + dy };
  });

/** Every block's first item: an invisible box edges bind to and layout sees. */
const box = (width: number, height: number): ShapeItem => ({
  kind: "rect",
  key: "box",
  x: 0,
  y: 0,
  w: width,
  h: height,
  stroke: "transparent",
  fill: "transparent",
});

// ------------------------------------------------------------------ table

type Cell = {
  text?: string;
  title?: string;
  items?: string[];
  /** titled parts inside the cell: "Existing alternatives" under Problem */
  sections?: Section[];
  color?: string;
  span: number;
  rowspan: number;
  align?: Align;
};

const cellOf = (v: unknown, where: string): Cell => {
  if (typeof v === "string" || typeof v === "number") {
    return { text: String(v), span: 1, rowspan: 1 };
  }
  if (v === null || v === undefined) {
    return { text: "", span: 1, rowspan: 1 };
  }
  if (!isObject(v)) {
    return refuse(
      `${where} must be text or {text, title, items, color, span, rowspan}`,
    );
  }
  const items =
    v.items === undefined ? undefined : list(v.items, `${where}.items`, 60);
  return {
    text: str(v.text, `${where}.text`),
    title: str(v.title, `${where}.title`),
    items: items?.map((item, k) => str(item, `${where}.items[${k}]`, true)!),
    sections:
      v.sections === undefined
        ? undefined
        : sectionsOf(v.sections, `${where}.sections`),
    color: str(v.color, `${where}.color`),
    span: num(v.span, `${where}.span`, 1, 20) ?? 1,
    rowspan: num(v.rowspan, `${where}.rowspan`, 1, 40) ?? 1,
    align: oneOf(v.align, `${where}.align`, [
      "left",
      "center",
      "right",
    ] as const),
  };
};

const validateTable = (spec: Record<string, unknown>) => {
  str(spec.title, "title");
  if (spec.columns !== undefined) {
    list(spec.columns, "columns", 20).forEach((c, k) =>
      cellOf(c, `columns[${k}]`),
    );
  }
  const rows = list(spec.rows, "rows", 60);
  if (!rows.length && spec.columns === undefined) {
    refuse("a table needs `rows` (a list of rows, each a list of cells)");
  }
  rows.forEach((row, r) =>
    list(row, `rows[${r}]`, 20).forEach((c, k) =>
      cellOf(c, `rows[${r}][${k}]`),
    ),
  );
  num(spec.maxColumnWidth, "maxColumnWidth", 80, 800);
  str(spec.color, "color");
};

const CELL_PAD = 12;

const drawTable = (
  spec: Record<string, unknown>,
  ctx: DrawContext,
): Drawing => {
  const maxW = (spec.maxColumnWidth as number | undefined) ?? 280;
  const headerPaint = ctx.paint(spec.color as string | undefined, "blue");
  const rowHeaders = spec.rowHeaders === true;
  const grid: { cell: Cell; header: boolean }[][] = [];
  if (Array.isArray(spec.columns)) {
    grid.push(
      (spec.columns as unknown[]).map((c, k) => ({
        cell: cellOf(c, `columns[${k}]`),
        header: true,
      })),
    );
  }
  for (const [r, row] of (spec.rows as unknown[][]).entries()) {
    grid.push(
      row.map((c, k) => ({
        cell: cellOf(c, `rows[${r}][${k}]`),
        header: rowHeaders && k === 0,
      })),
    );
  }

  // place cells on a grid the way HTML does: skip slots a span above took
  const taken = new Set<string>();
  type Placed = {
    cell: Cell;
    header: boolean;
    row: number;
    col: number;
    lines: { text: string; size: number; color: string }[];
    w: number;
    h: number;
  };
  const placed: Placed[] = [];
  let columns = 0;
  grid.forEach((row, r) => {
    let c = 0;
    for (const { cell, header } of row) {
      while (taken.has(`${r}:${c}`)) {
        c++;
      }
      for (let dr = 0; dr < cell.rowspan; dr++) {
        for (let dc = 0; dc < cell.span; dc++) {
          taken.add(`${r + dr}:${c + dc}`);
        }
      }
      placed.push({ cell, header, row: r, col: c, lines: [], w: 0, h: 0 });
      c += cell.span;
      columns = Math.max(columns, c);
    }
  });
  const rowsCount = Math.max(
    grid.length,
    ...placed.map((p) => p.row + p.cell.rowspan),
  );

  for (const p of placed) {
    const paint = p.cell.color ? ctx.paint(p.cell.color, "gray") : null;
    const limit = maxW * p.cell.span;
    const parts: { text: string; size: number; color: string }[] = [];
    if (p.cell.title) {
      parts.push({
        text: wrap(p.cell.title, limit, 18, ctx.measure),
        size: 18,
        color: paint?.stroke ?? (p.header ? headerPaint.stroke : INK),
      });
    }
    if (p.cell.text) {
      parts.push({
        text: wrap(p.cell.text, limit, BODY, ctx.measure),
        size: BODY,
        color: p.header && !p.cell.title ? headerPaint.stroke : INK,
      });
    }
    if (p.cell.items?.length) {
      parts.push({
        text: p.cell.items
          .map((item) => wrap(`• ${item}`, limit, BODY, ctx.measure))
          .join("\n"),
        size: BODY,
        color: INK,
      });
    }
    for (const section of p.cell.sections ?? []) {
      parts.push({
        text: wrap(section.title, limit, 15, ctx.measure),
        size: 15,
        color: paint?.stroke ?? MUTED,
      });
      const body = [
        ...(section.text ? [wrap(section.text, limit, 14, ctx.measure)] : []),
        ...(section.items ?? []).map((i) =>
          wrap(`• ${i}`, limit, 14, ctx.measure),
        ),
      ].join("\n");
      if (body) {
        parts.push({ text: body, size: 14, color: INK });
      }
    }
    p.lines = parts;
    let w = 0;
    let h = 0;
    for (const part of parts) {
      const m = ctx.measure(part.text, part.size);
      w = Math.max(w, m.width);
      h += m.height + (h ? 6 : 0);
    }
    p.w = w + CELL_PAD * 2;
    p.h = h + CELL_PAD * 2;
  }

  const colW = new Array(columns).fill(80);
  const rowH = new Array(rowsCount).fill(40);
  // single-slot cells first, then spans widen what they cover evenly
  for (const p of [...placed].sort((a, b) => a.cell.span - b.cell.span)) {
    const have = colW
      .slice(p.col, p.col + p.cell.span)
      .reduce((a, b) => a + b, 0);
    if (p.w > have) {
      const extra = (p.w - have) / p.cell.span;
      for (let k = p.col; k < p.col + p.cell.span; k++) {
        colW[k] += extra;
      }
    }
  }
  for (const p of [...placed].sort((a, b) => a.cell.rowspan - b.cell.rowspan)) {
    const have = rowH
      .slice(p.row, p.row + p.cell.rowspan)
      .reduce((a, b) => a + b, 0);
    if (p.h > have) {
      const extra = (p.h - have) / p.cell.rowspan;
      for (let k = p.row; k < p.row + p.cell.rowspan; k++) {
        rowH[k] += extra;
      }
    }
  }
  const xAt = (c: number) => colW.slice(0, c).reduce((a, b) => a + b, 0);
  const yAt = (r: number) => rowH.slice(0, r).reduce((a, b) => a + b, 0);

  const title = titleItems(spec.title as string | undefined, ctx);
  const top = title.height;
  const items: Item[] = [];
  for (const p of placed) {
    const x = xAt(p.col);
    const y = top + yAt(p.row);
    const w = xAt(p.col + p.cell.span) - x;
    const h = yAt(p.row + p.cell.rowspan) - yAt(p.row);
    const paint = p.cell.color
      ? ctx.paint(p.cell.color, "gray")
      : p.header
      ? headerPaint
      : null;
    const key = `c${p.row}-${p.col}`;
    items.push({
      kind: "rect",
      key,
      x,
      y,
      w,
      h,
      stroke: RULE,
      fill: paint ? paint.fill : "#ffffff",
      strokeWidth: 1,
    });
    const align: Align =
      p.cell.align ??
      (p.header && !p.cell.title && !p.cell.items ? "center" : "left");
    let ty = y + CELL_PAD;
    p.lines.forEach((part, k) => {
      const m = ctx.measure(part.text, part.size);
      const tx =
        align === "center"
          ? x + (w - m.width) / 2
          : align === "right"
          ? x + w - CELL_PAD - m.width
          : x + CELL_PAD;
      items.push({
        kind: "text",
        key: `${key}-t${k}`,
        x: tx,
        y: ty,
        text: part.text,
        size: part.size,
        color: part.color,
        align,
      });
      ty += m.height + 6;
    });
  }
  const width = Math.max(xAt(columns), title.width);
  const height = top + yAt(rowsCount);
  return {
    width,
    height,
    items: [box(width, height), ...title.items, ...items],
  };
};

// --------------------------------------------------------------- quadrant

const axisOf = (v: unknown, what: string) => {
  if (Array.isArray(v)) {
    const [low, high] = v;
    return {
      low: str(low, `${what}[0]`) ?? "",
      high: str(high, `${what}[1]`) ?? "",
    };
  }
  if (isObject(v)) {
    return {
      low: str(v.low, `${what}.low`) ?? "",
      high: str(v.high, `${what}.high`) ?? "",
    };
  }
  if (v === undefined) {
    return { low: "", high: "" };
  }
  return refuse(`${what} must be [low, high] or {low, high}`);
};

const validateQuadrant = (spec: Record<string, unknown>) => {
  str(spec.title, "title");
  axisOf(spec.x, "x");
  axisOf(spec.y, "y");
  if (spec.quadrants !== undefined) {
    const q = list(spec.quadrants, "quadrants", 4);
    q.forEach((label, k) => str(label, `quadrants[${k}]`));
  }
  list(spec.items ?? [], "items", 80).forEach((item, k) => {
    if (!isObject(item)) {
      refuse(`items[${k}] must be {label, x, y}`);
    }
    const it = item as Record<string, unknown>;
    str(it.label, `items[${k}].label`, true);
    if (
      num(it.x, `items[${k}].x`, 0, 1) === undefined ||
      num(it.y, `items[${k}].y`, 0, 1) === undefined
    ) {
      refuse(`items[${k}] needs x and y between 0 and 1`);
    }
    str(it.color, `items[${k}].color`);
  });
};

const drawQuadrant = (
  spec: Record<string, unknown>,
  ctx: DrawContext,
): Drawing => {
  const side = 520;
  const half = side / 2;
  const x = axisOf(spec.x, "x");
  const y = axisOf(spec.y, "y");
  // Mermaid's numbering: 1 top-right, 2 top-left, 3 bottom-left, 4 bottom-right
  const quadrants = (spec.quadrants as string[] | undefined) ?? [];
  const title = titleItems(spec.title as string | undefined, ctx);
  const yLabel = Math.max(
    ctx.measure(y.low, BODY).width,
    ctx.measure(y.high, BODY).width,
  );
  const left = yLabel + 16;
  const top = title.height + 8;
  const items: Item[] = [...title.items];
  const fills = ["#e7f5ff", "#f8f9fa", "#fff9db", "#f8f9fa"];
  const cells: [number, number][] = [
    [half, 0],
    [0, 0],
    [0, half],
    [half, half],
  ];
  cells.forEach(([cx, cy], k) => {
    items.push({
      kind: "rect",
      key: `q${k + 1}`,
      x: left + cx,
      y: top + cy,
      w: half,
      h: half,
      stroke: RULE,
      fill: fills[k],
      strokeWidth: 1,
    });
    if (quadrants[k]) {
      const text = wrap(quadrants[k], half - 24, 18, ctx.measure);
      items.push({
        kind: "text",
        key: `q${k + 1}-t`,
        x: left + cx + 12,
        y: top + cy + 10,
        text,
        size: 18,
        color: MUTED,
      });
    }
  });
  // axes along the bottom and the left edge, pointing at "high"
  items.push(
    {
      kind: "arrow",
      key: "ax",
      points: [
        [left, top + side],
        [left + side + 16, top + side],
      ],
      stroke: INK,
      strokeWidth: 2,
      head: "arrow",
    },
    {
      kind: "arrow",
      key: "ay",
      points: [
        [left, top + side],
        [left, top - 16],
      ],
      stroke: INK,
      strokeWidth: 2,
      head: "arrow",
    },
  );
  const lowX = ctx.measure(x.low, BODY);
  const highX = ctx.measure(x.high, BODY);
  if (x.low) {
    items.push({
      kind: "text",
      key: "xl",
      x: left,
      y: top + side + 8,
      text: x.low,
      size: BODY,
      color: INK,
    });
  }
  if (x.high) {
    items.push({
      kind: "text",
      key: "xh",
      x: left + side - highX.width,
      y: top + side + 8,
      text: x.high,
      size: BODY,
      color: INK,
    });
  }
  const lowY = ctx.measure(y.low, BODY);
  if (y.low) {
    items.push({
      kind: "text",
      key: "yl",
      x: left - 12 - lowY.width,
      y: top + side - lowY.height,
      text: y.low,
      size: BODY,
      color: INK,
    });
  }
  if (y.high) {
    items.push({
      kind: "text",
      key: "yh",
      x: left - 12 - ctx.measure(y.high, BODY).width,
      y: top,
      text: y.high,
      size: BODY,
      color: INK,
    });
  }
  const DOT = 14;
  const labels: { x: number; y: number; w: number; h: number }[] = [];
  (spec.items as Record<string, unknown>[] | undefined)?.forEach((item, k) => {
    const px = left + (item.x as number) * side;
    const py = top + (1 - (item.y as number)) * side;
    const paint = ctx.paint(item.color as string | undefined, "blue");
    items.push({
      kind: "ellipse",
      key: `p${k}`,
      x: px - DOT / 2,
      y: py - DOT / 2,
      w: DOT,
      h: DOT,
      stroke: paint.stroke,
      fill: paint.stroke,
    });
    const text = item.label as string;
    const m = ctx.measure(text, BODY);
    // right of the dot, else left; then nudge down past an earlier label
    let lx = px + DOT;
    if (lx + m.width > left + side) {
      lx = px - DOT - m.width;
    }
    const clash = (x: number, y: number) =>
      labels.find(
        (l) =>
          x < l.x + l.w &&
          l.x < x + m.width &&
          y < l.y + l.h &&
          l.y < y + m.height,
      );
    let ly = py - m.height / 2;
    for (let guard = 0, hit = clash(lx, ly); hit && guard < 20; guard++) {
      ly = hit.y + hit.h + 2;
      hit = clash(lx, ly);
    }
    labels.push({ x: lx, y: ly, w: m.width, h: m.height });
    items.push({
      kind: "text",
      key: `p${k}-t`,
      x: lx,
      y: ly,
      text,
      size: BODY,
      color: INK,
    });
  });
  const width = Math.max(left + side + 20, title.width);
  const height = top + side + Math.max(lowX.height, highX.height) + 12;
  return { width, height, items: [box(width, height), ...items] };
};

// --------------------------------------------------------------- sequence

type Participant = { id: string; label: string; kind?: string; color?: string };
/**
 * UML message kinds: a synchronous call has a filled head and waits; an
 * asynchronous one has an open head; a reply is dashed with an open head.
 */
const MESSAGE_KINDS = ["sync", "async", "reply"] as const;
type MessageKind = typeof MESSAGE_KINDS[number];
type Step =
  | {
      type: "message";
      from: string;
      to: string;
      label?: string;
      kind: MessageKind;
      line?: LineStyle;
      head?: Head;
      /** starts an activation on `to` */
      activate: boolean;
      /** ends the activation of `from` */
      deactivate: boolean;
      /** `to` comes into being with this message: its box is drawn here */
      create: boolean;
      /** `to` ends with this message: an X closes its lifeline */
      destroy: boolean;
    }
  | { type: "note"; text: string; over: string[]; color?: string }
  | { type: "activation"; id: string; on: boolean }
  | {
      type: "fragment";
      fragment: string;
      label?: string;
      items: Step[];
      branches: { label?: string; items: Step[] }[];
    };

const FRAGMENTS = [
  "loop",
  "alt",
  "opt",
  "par",
  "critical",
  "break",
  "rect",
] as const;

const flag = (v: unknown, what: string) => {
  if (v !== undefined && v !== null && typeof v !== "boolean") {
    refuse(`${what} is true or false`);
  }
  return v === true;
};

const stepsOf = (
  v: unknown,
  where: string,
  ids: Set<string>,
  depth = 0,
): Step[] => {
  if (depth > 6) {
    return refuse(`${where}: fragments nest at most 6 deep`);
  }
  return list(v ?? [], where, 300).map((raw, k) => {
    const at = `${where}[${k}]`;
    if (!isObject(raw)) {
      return refuse(
        `${at} must be a message {from, to, label}, a note {note, over}, {activate | deactivate: id} or a fragment {fragment, items}`,
      );
    }
    const known = (id: unknown, what: string) => {
      const s = str(id, `${at}.${what}`, true)!;
      if (!ids.has(s)) {
        refuse(`${at}.${what} "${s}" is not a participant`);
      }
      return s;
    };
    if (raw.fragment !== undefined) {
      const fragment = oneOf(raw.fragment, `${at}.fragment`, FRAGMENTS)!;
      const branches = list(raw.else ?? [], `${at}.else`, 10).map((b, j) => {
        if (!isObject(b)) {
          return refuse(`${at}.else[${j}] must be {label, items}`);
        }
        return {
          label: str(b.label, `${at}.else[${j}].label`),
          items: stepsOf(b.items, `${at}.else[${j}].items`, ids, depth + 1),
        };
      });
      return {
        type: "fragment" as const,
        fragment,
        label: str(raw.label, `${at}.label`),
        items: stepsOf(raw.items, `${at}.items`, ids, depth + 1),
        branches,
      };
    }
    if (raw.note !== undefined) {
      const over = Array.isArray(raw.over) ? raw.over : [raw.over];
      if (over.length < 1 || over.length > 2) {
        refuse(`${at}.over names one participant or two`);
      }
      return {
        type: "note" as const,
        text: str(raw.note, `${at}.note`, true)!,
        over: over.map((o, j) => known(o, `over[${j}]`)),
        color: str(raw.color, `${at}.color`),
      };
    }
    if (raw.activate !== undefined && raw.from === undefined) {
      return {
        type: "activation" as const,
        id: known(raw.activate, "activate"),
        on: true,
      };
    }
    if (raw.deactivate !== undefined && raw.from === undefined) {
      return {
        type: "activation" as const,
        id: known(raw.deactivate, "deactivate"),
        on: false,
      };
    }
    const kind =
      oneOf(raw.kind, `${at}.kind`, MESSAGE_KINDS) ??
      (raw.line === "dashed" ? "reply" : "sync");
    return {
      type: "message" as const,
      from: known(raw.from, "from"),
      to: known(raw.to, "to"),
      label: str(raw.label, `${at}.label`),
      kind,
      line: oneOf(raw.line, `${at}.line`, LINES),
      head:
        raw.head === undefined
          ? undefined
          : (str(raw.head, `${at}.head`) as Head),
      activate: flag(raw.activate, `${at}.activate`),
      deactivate: flag(raw.deactivate, `${at}.deactivate`),
      create: flag(raw.create, `${at}.create`),
      destroy: flag(raw.destroy, `${at}.destroy`),
    };
  });
};

const participantsOf = (spec: Record<string, unknown>): Participant[] => {
  const raw = list(spec.participants, "participants", 20);
  if (raw.length < 1) {
    refuse("a sequence needs `participants`");
  }
  const seen = new Set<string>();
  return raw.map((p, k) => {
    const at = `participants[${k}]`;
    const entry: Participant =
      typeof p === "string"
        ? { id: p, label: p }
        : isObject(p)
        ? {
            id: str(p.id, `${at}.id`, true)!,
            label: str(p.label, `${at}.label`) ?? (p.id as string),
            kind: str(p.kind, `${at}.kind`),
            color: str(p.color, `${at}.color`),
          }
        : refuse(`${at} must be an id or {id, label, kind}`);
    if (seen.has(entry.id)) {
      refuse(`${at}: "${entry.id}" is listed twice`);
    }
    seen.add(entry.id);
    return entry;
  });
};

const validateSequence = (spec: Record<string, unknown>) => {
  str(spec.title, "title");
  const ids = new Set(participantsOf(spec).map((p) => p.id));
  stepsOf(spec.items, "items", ids);
};

const isActor = (p: Participant) => p.kind === "actor" || p.kind === "user";

const drawSequence = (
  spec: Record<string, unknown>,
  ctx: DrawContext,
): Drawing => {
  const participants = participantsOf(spec);
  const index = new Map(participants.map((p, k) => [p.id, k]));
  const steps = stepsOf(spec.items, "items", new Set(index.keys()));
  const number = spec.autonumber === true;
  const LABEL = 16;
  const BOX_H = 56;
  const ACT_W = 12;

  const walk = (steps_: Step[], visit: (s: Step) => void) => {
    for (const s of steps_) {
      visit(s);
      if (s.type === "fragment") {
        walk(s.items, visit);
        s.branches.forEach((b) => walk(b.items, visit));
      }
    }
  };
  // a participant some message creates is drawn where it is created
  const created = new Set<string>();
  walk(steps, (s) => {
    if (s.type === "message" && s.create) {
      created.add(s.to);
    }
  });

  const boxW = participants.map((p) =>
    isActor(p)
      ? Math.max(80, ctx.measure(p.label, 16).width + 12)
      : Math.max(120, ctx.measure(p.label, 18).width + 40),
  );
  const boxH = participants.map((p) =>
    isActor(p) ? 74 + ctx.measure(p.label, 16).height + 6 : BOX_H,
  );
  const headH = Math.max(...boxH);
  // the distance two neighbours' lifelines need: their boxes, and the
  // labels of every message between them
  const gap = participants.map((_, k) =>
    k + 1 < participants.length ? (boxW[k] + boxW[k + 1]) / 2 + 40 : 0,
  );
  const selfRoom = new Array(participants.length).fill(0);
  let counter = 0;
  const labelOf = (s: { label?: string }) => {
    if (!s.label && !number) {
      return "";
    }
    counter++;
    return number ? `${counter}. ${s.label ?? ""}`.trim() : s.label!;
  };
  const texts = new Map<Step, string>();
  walk(steps, (s) => {
    if (s.type === "message") {
      texts.set(s, labelOf(s));
    }
  });
  walk(steps, (s) => {
    if (s.type !== "message") {
      return;
    }
    const a = index.get(s.from)!;
    const b = index.get(s.to)!;
    const w =
      ctx.measure(texts.get(s) || " ", LABEL).width +
      40 +
      (s.create ? boxW[b] / 2 : 0);
    if (a === b) {
      selfRoom[a] = Math.max(selfRoom[a], w + 30);
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const have = gap.slice(lo, hi).reduce((x, y) => x + y, 0);
    if (w > have) {
      for (let k = lo; k < hi; k++) {
        gap[k] += (w - have) / (hi - lo);
      }
    }
  });
  for (let k = 0; k + 1 < participants.length; k++) {
    gap[k] = Math.max(gap[k], selfRoom[k] + boxW[k + 1] / 2);
  }

  const title = titleItems(spec.title as string | undefined, ctx);
  const left = 20;
  const centers: number[] = [];
  let cx = left + boxW[0] / 2;
  participants.forEach((_, k) => {
    centers.push(cx);
    cx += gap[k];
  });
  const top = title.height;
  const items: Item[] = [...title.items];
  const lifeTop = participants.map(() => top + headH);
  const lifeEnd: (number | undefined)[] = participants.map(() => undefined);

  const head = (k: number, y: number) => {
    const p = participants[k];
    const paint = ctx.paint(
      p.color ?? (isActor(p) ? "violet" : undefined),
      "blue",
    );
    if (isActor(p)) {
      // a stick figure with its name underneath
      const fx = centers[k];
      const m = ctx.measure(p.label, 16);
      items.push(
        {
          kind: "ellipse",
          key: `p${k}-h`,
          x: fx - 11,
          y,
          w: 22,
          h: 22,
          stroke: paint.stroke,
          fill: paint.fill,
          strokeWidth: 2,
        },
        {
          kind: "line",
          key: `p${k}-b`,
          points: [
            [fx, y + 22],
            [fx, y + 48],
          ],
          stroke: paint.stroke,
          strokeWidth: 2,
        },
        {
          kind: "line",
          key: `p${k}-a`,
          points: [
            [fx - 22, y + 32],
            [fx + 22, y + 32],
          ],
          stroke: paint.stroke,
          strokeWidth: 2,
        },
        {
          kind: "line",
          key: `p${k}-g`,
          points: [
            [fx - 18, y + 72],
            [fx, y + 48],
            [fx + 18, y + 72],
          ],
          stroke: paint.stroke,
          strokeWidth: 2,
        },
        {
          kind: "text",
          key: `p${k}`,
          x: fx - m.width / 2,
          y: y + 78,
          text: p.label,
          size: 16,
          color: paint.stroke,
          align: "center",
        },
      );
      return y + boxH[k];
    }
    items.push({
      kind: "rect",
      key: `p${k}`,
      x: centers[k] - boxW[k] / 2,
      y,
      w: boxW[k],
      h: BOX_H,
      stroke: paint.stroke,
      fill: paint.fill,
      strokeWidth: 2,
      rounded: true,
      label: { text: p.label, size: 18 },
    });
    return y + BOX_H;
  };
  participants.forEach((p, k) => {
    if (!created.has(p.id)) {
      lifeTop[k] = head(k, top + headH - boxH[k]);
    }
  });

  // activations: a stack of open bars per participant
  const open = participants.map(() => [] as number[]);
  let bars = 0;
  const activate = (k: number, y: number) => open[k].push(y);
  const deactivate = (k: number, y: number) => {
    const from = open[k].pop();
    if (from === undefined) {
      return;
    }
    const depth = open[k].length;
    items.push({
      kind: "rect",
      key: `act${bars++}`,
      x: centers[k] - ACT_W / 2 + depth * 6,
      y: from,
      w: ACT_W,
      h: Math.max(12, y - from),
      stroke: INK,
      fill: "#ffffff",
      strokeWidth: 1,
    });
  };
  /**
   * where a message leaves or reaches a lifeline: the outer side of its
   * innermost open bar (`extra` counts a bar this very message opens)
   */
  const edgeX = (k: number, towards: number, extra = 0) => {
    const depth = open[k].length + extra;
    if (!depth) {
      return centers[k];
    }
    const shift = (depth - 1) * 6;
    return towards >= centers[k]
      ? centers[k] + ACT_W / 2 + shift
      : centers[k] - ACT_W / 2 + shift;
  };

  let y = top + headH + 28;
  let fragmentDepth = 0;
  const span = (steps_: Step[]): [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    walk(steps_, (s) => {
      const ids =
        s.type === "message" ? [s.from, s.to] : s.type === "note" ? s.over : [];
      for (const id of ids) {
        lo = Math.min(lo, index.get(id)!);
        hi = Math.max(hi, index.get(id)!);
      }
    });
    return lo === Infinity ? [0, participants.length - 1] : [lo, hi];
  };
  const headOf = (s: Extract<Step, { type: "message" }>): Head =>
    s.head ?? (s.kind === "sync" ? "triangle" : "arrow");
  const lineOf = (s: Extract<Step, { type: "message" }>): LineStyle =>
    s.line ?? (s.kind === "reply" ? "dashed" : "solid");
  let seq = 0;
  const draw = (steps_: Step[]) => {
    for (const s of steps_) {
      const key = `s${seq++}`;
      if (s.type === "activation") {
        const k = index.get(s.id)!;
        if (s.on) {
          activate(k, y - 10);
        } else {
          deactivate(k, y - 10);
        }
        continue;
      }
      if (s.type === "message") {
        const a = index.get(s.from)!;
        const b = index.get(s.to)!;
        const text = texts.get(s) ?? "";
        const m = ctx.measure(text || " ", LABEL);
        if (a === b) {
          const x0 = edgeX(a, Infinity);
          if (text) {
            items.push({
              kind: "text",
              key: `${key}-t`,
              x: x0 + 12,
              y,
              text,
              size: LABEL,
              color: INK,
            });
          }
          const y0 = y + (text ? m.height + 6 : 0);
          items.push({
            kind: "arrow",
            key,
            points: [
              [x0, y0],
              [x0 + 44, y0],
              [x0 + 44, y0 + 26],
              [x0 + 2, y0 + 26],
            ],
            stroke: INK,
            line: lineOf(s),
            strokeWidth: 2,
            head: headOf(s),
          });
          if (s.activate) {
            activate(a, y0 + 22);
          }
          if (s.deactivate) {
            deactivate(a, y0 + 26);
          }
          y = y0 + 26 + 22;
          continue;
        }
        const x1 = edgeX(a, centers[b]);
        const ay = y + (text ? m.height + 6 : 0);
        let x2 = edgeX(b, centers[a], s.activate ? 1 : 0);
        if (s.create) {
          // the new participant's box meets the arrow
          const boxY = ay - boxH[b] / 2;
          lifeTop[b] = head(b, boxY);
          x2 =
            centers[b] + (centers[a] < centers[b] ? -boxW[b] / 2 : boxW[b] / 2);
        }
        if (text) {
          items.push({
            kind: "text",
            key: `${key}-t`,
            x: (x1 + x2) / 2 - m.width / 2,
            y,
            text,
            size: LABEL,
            color: INK,
            align: "center",
          });
        }
        items.push({
          kind: "arrow",
          key,
          points: [
            [x1, ay],
            [x2, ay],
          ],
          stroke: INK,
          line: lineOf(s),
          strokeWidth: 2,
          head: headOf(s),
        });
        if (s.deactivate) {
          deactivate(a, ay);
        }
        if (s.activate) {
          activate(b, ay);
        }
        if (s.destroy) {
          const X = 10;
          items.push(
            {
              kind: "line",
              key: `${key}-x1`,
              points: [
                [centers[b] - X, ay - X],
                [centers[b] + X, ay + X],
              ],
              stroke: INK,
              strokeWidth: 2,
            },
            {
              kind: "line",
              key: `${key}-x2`,
              points: [
                [centers[b] - X, ay + X],
                [centers[b] + X, ay - X],
              ],
              stroke: INK,
              strokeWidth: 2,
            },
          );
          lifeEnd[b] = ay;
          while (open[b].length) {
            deactivate(b, ay);
          }
        }
        y = ay + (s.create ? Math.max(22, boxH[b] / 2 + 12) : 22);
      } else if (s.type === "note") {
        const ks = s.over.map((id) => index.get(id)!);
        const lo = Math.min(...ks);
        const hi = Math.max(...ks);
        const maxW = lo === hi ? 220 : centers[hi] - centers[lo] + 160;
        const text = wrap(s.text, maxW - 24, BODY, ctx.measure);
        const m = ctx.measure(text, BODY);
        const w = Math.max(
          m.width + 24,
          lo === hi ? 120 : centers[hi] - centers[lo] + 80,
        );
        const mid = (centers[lo] + centers[hi]) / 2;
        const paint = ctx.paint(s.color ?? "yellow", "yellow");
        items.push({
          kind: "rect",
          key,
          x: mid - w / 2,
          y,
          w,
          h: m.height + 16,
          stroke: paint.stroke,
          fill: paint.fill,
          strokeWidth: 1,
        });
        items.push({
          kind: "text",
          key: `${key}-t`,
          x: mid - m.width / 2,
          y: y + 8,
          text,
          size: BODY,
          color: INK,
          align: "center",
        });
        y += m.height + 16 + 16;
      } else {
        const [lo, hi] = span([s, ...s.branches.flatMap((b) => b.items)]);
        const inset = 70 - fragmentDepth * 10;
        const x0 = centers[lo] - Math.max(inset, boxW[lo] / 2 - 10);
        const selfExtra = selfRoom[hi] ? selfRoom[hi] : 0;
        const x1 = centers[hi] + Math.max(inset, boxW[hi] / 2 - 10, selfExtra);
        const y0 = y;
        const tag = s.fragment === "rect" ? "" : s.fragment;
        const headText = [tag, s.label ? `[${s.label}]` : ""]
          .filter(Boolean)
          .join(" ");
        y += 34;
        fragmentDepth++;
        draw(s.items);
        const dividers: number[] = [];
        for (const branch of s.branches) {
          dividers.push(y);
          if (branch.label) {
            items.push({
              kind: "text",
              key: `${key}-e${dividers.length}`,
              x: x0 + 10,
              y: y + 4,
              text: `[${branch.label}]`,
              size: 14,
              color: MUTED,
            });
          }
          y += 28;
          draw(branch.items);
        }
        fragmentDepth--;
        y += 6;
        items.push({
          kind: "rect",
          key,
          x: x0,
          y: y0,
          w: x1 - x0,
          h: y - y0,
          stroke: MUTED,
          fill: s.fragment === "rect" ? "#f8f9fa" : "transparent",
          strokeWidth: 1,
          opacity: s.fragment === "rect" ? 60 : 100,
        });
        if (headText) {
          // UML's tag: the operator in a box with a cut corner
          const m = ctx.measure(headText, 14);
          items.push(
            {
              kind: "line",
              key: `${key}-tag`,
              points: [
                [x0, y0 + m.height + 10],
                [x0 + m.width + 10, y0 + m.height + 10],
                [x0 + m.width + 18, y0 + m.height + 2],
                [x0 + m.width + 18, y0],
              ],
              stroke: MUTED,
              strokeWidth: 1,
            },
            {
              kind: "text",
              key: `${key}-h`,
              x: x0 + 6,
              y: y0 + 5,
              text: headText,
              size: 14,
              color: MUTED,
            },
          );
        }
        dividers.forEach((dy, j) =>
          items.push({
            kind: "line",
            key: `${key}-d${j}`,
            points: [
              [x0, dy],
              [x1, dy],
            ],
            stroke: MUTED,
            line: "dashed",
            strokeWidth: 1,
          }),
        );
        y += 14;
      }
    }
  };
  draw(steps);
  const bottom = y + 10;
  // an activation never closed runs to the end
  participants.forEach((_, k) => {
    while (open[k].length) {
      deactivate(k, lifeEnd[k] ?? bottom - 6);
    }
  });
  participants.forEach((_, k) =>
    items.push({
      kind: "line",
      key: `l${k}`,
      points: [
        [centers[k], lifeTop[k]],
        [centers[k], lifeEnd[k] ?? bottom],
      ],
      stroke: RULE,
      line: "dashed",
      strokeWidth: 1,
    }),
  );
  // lifelines go under everything, activation bars under the messages
  const rank = (item: Item) =>
    item.key.startsWith("l") ? 0 : item.key.startsWith("act") ? 1 : 2;
  items.sort((a, b) => rank(a) - rank(b));
  const last = participants.length - 1;
  const width = Math.max(
    centers[last] + Math.max(boxW[last] / 2, selfRoom[last], 70) + 20,
    title.width,
  );
  return { width, height: bottom, items: [box(width, bottom), ...items] };
};

// --------------------------------------------------------------- timeline

const DAY = 86400000;

/** A timeline position: an ISO date, or a plain number of units. */
const parseWhen = (v: unknown, what: string): number | undefined => {
  if (v === undefined || v === null) {
    return undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const t = Date.parse(`${v}T00:00:00Z`);
    if (Number.isFinite(t)) {
      return t / DAY;
    }
  }
  return refuse(
    `${what} must be a date YYYY-MM-DD or a number, got ${JSON.stringify(v)}`,
  );
};

const STATUSES = ["done", "active", "pending", "delayed", "blocked"] as const;
type Status = typeof STATUSES[number];
/** finish-to-start, start-to-start, finish-to-finish, start-to-finish */
const DEPENDENCIES = ["FS", "SS", "FF", "SF"] as const;
type Dependency = typeof DEPENDENCIES[number];

type Task = {
  label: string;
  start: number;
  end: number;
  section?: string;
  color?: string;
  done: boolean;
  status?: Status;
  owner?: string;
  progress?: number;
  milestone: boolean;
  deps: { on: Task; type: Dependency }[];
};

const tasksOf = (spec: Record<string, unknown>) => {
  const raw = list(spec.tasks, "tasks", 120);
  if (!raw.length) {
    refuse("a timeline needs `tasks`");
  }
  const byId = new Map<string, Task>();
  const dated = (task: Record<string, unknown>) =>
    typeof task.start === "string" || typeof task.end === "string";
  const tasks: Task[] = [];
  const kinds = new Set<boolean>();
  const pending: { task: Task; on: string; type: Dependency; at: string }[] =
    [];
  raw.forEach((r, k) => {
    const at = `tasks[${k}]`;
    if (!isObject(r)) {
      refuse(`${at} must be {label, start, end | days | after}`);
    }
    const t = r as Record<string, unknown>;
    if (t.start !== undefined || t.end !== undefined) {
      kinds.add(dated(t));
    }
    const milestone = t.milestone === true;
    let start = parseWhen(t.start, `${at}.start`);
    let after: Task | undefined;
    if (t.after !== undefined) {
      const id = str(t.after, `${at}.after`, true)!;
      after = byId.get(id);
      if (!after) {
        refuse(`${at}.after "${id}" is not an earlier task's id`);
      }
      start ??= after!.end;
    }
    if (start === undefined) {
      refuse(`${at} needs \`start\` (or \`after\`: an earlier task's id)`);
    }
    const days = num(t.days ?? t.duration, `${at}.days`, 0, 100000);
    let end = parseWhen(t.end, `${at}.end`);
    if (end !== undefined && typeof t.end === "string") {
      end += 1; // an end date is the last day, included
    }
    end ??= start! + (days ?? (milestone ? 0 : 1));
    if (end < start!) {
      refuse(`${at} ends before it starts`);
    }
    const status = oneOf(t.status, `${at}.status`, STATUSES);
    const task: Task = {
      label: str(t.label, `${at}.label`, true)!,
      start: start!,
      end: milestone ? start! : end,
      section: str(t.section, `${at}.section`),
      color: str(t.color, `${at}.color`),
      done: t.done === true || status === "done",
      status: t.done === true ? "done" : status,
      owner: str(t.owner, `${at}.owner`),
      progress: num(t.progress, `${at}.progress`, 0, 1),
      milestone,
      deps: after ? [{ on: after, type: "FS" }] : [],
    };
    list(t.depends ?? [], `${at}.depends`, 10).forEach((d, j) => {
      const where = `${at}.depends[${j}]`;
      const dep =
        typeof d === "string"
          ? { on: d, type: "FS" }
          : isObject(d)
          ? { on: str(d.on, `${where}.on`, true)!, type: d.type ?? "FS" }
          : refuse(`${where} is a task id or {on, type: FS | SS | FF | SF}`);
      pending.push({
        task,
        on: dep.on as string,
        type: oneOf(dep.type, `${where}.type`, DEPENDENCIES)!,
        at: where,
      });
    });
    if (t.id !== undefined) {
      byId.set(str(t.id, `${at}.id`, true)!, task);
    }
    tasks.push(task);
  });
  if (kinds.size > 1) {
    refuse("tasks mix dates and plain numbers; use one or the other");
  }
  for (const dep of pending) {
    const on = byId.get(dep.on);
    if (!on) {
      refuse(`${dep.at}: "${dep.on}" is not a task id`);
    }
    dep.task.deps.push({ on: on!, type: dep.type });
  }
  return { tasks, dates: kinds.has(true) };
};

const validateTimeline = (spec: Record<string, unknown>) => {
  str(spec.title, "title");
  oneOf(spec.unit, "unit", [
    "day",
    "week",
    "month",
    "quarter",
    "step",
  ] as const);
  parseWhen(spec.today, "today");
  str(spec.todayLabel, "todayLabel");
  str(spec.stepLabel, "stepLabel");
  if (spec.weekends !== undefined && typeof spec.weekends !== "boolean") {
    refuse("weekends is true or false");
  }
  tasksOf(spec);
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const ticksOf = (
  from: number,
  to: number,
  dates: boolean,
  unit: string | undefined,
  stepLabel: string,
): { at: number; label: string }[] => {
  if (!dates) {
    const ticks = [];
    for (let n = Math.floor(from); n <= Math.ceil(to); n++) {
      ticks.push({ at: n, label: `${stepLabel}${n}` });
    }
    return ticks;
  }
  const span = to - from;
  const chosen =
    unit ??
    (span <= 31
      ? "day"
      : span <= 190
      ? "week"
      : span <= 900
      ? "month"
      : "quarter");
  const ticks: { at: number; label: string }[] = [];
  const date = (d: number) => new Date(d * DAY);
  if (chosen === "day") {
    for (let d = Math.floor(from); d <= to; d++) {
      const t = date(d);
      ticks.push({ at: d, label: `${t.getUTCMonth() + 1}/${t.getUTCDate()}` });
    }
  } else if (chosen === "week") {
    // Mondays
    let d = Math.floor(from);
    while (date(d).getUTCDay() !== 1) {
      d--;
    }
    for (; d <= to; d += 7) {
      const t = date(d);
      ticks.push({ at: d, label: `${t.getUTCMonth() + 1}/${t.getUTCDate()}` });
    }
  } else {
    const step = chosen === "quarter" ? 3 : 1;
    const first = date(from);
    let y = first.getUTCFullYear();
    let m = first.getUTCMonth();
    m -= m % step;
    for (;;) {
      const at = Date.UTC(y, m, 1) / DAY;
      if (at > to) {
        break;
      }
      ticks.push({
        at,
        label: step === 3 ? `${y} Q${m / 3 + 1}` : `${y}-${pad2(m + 1)}`,
      });
      m += step;
      if (m >= 12) {
        m -= 12;
        y++;
      }
    }
  }
  return ticks;
};

const SECTION_COLORS = [
  "blue",
  "green",
  "violet",
  "orange",
  "teal",
  "pink",
  "yellow",
  "red",
];

const drawTimeline = (
  spec: Record<string, unknown>,
  ctx: DrawContext,
): Drawing => {
  const { tasks, dates } = tasksOf(spec);
  const today = parseWhen(spec.today, "today");
  const from = Math.min(...tasks.map((t) => t.start), today ?? Infinity);
  const last = Math.max(
    ...tasks.map((t) => t.end),
    (today ?? -Infinity) + 0.001,
  );
  // room after the last day for a milestone's diamond
  const to = last + Math.max(1, (last - from) * 0.03);
  const span = Math.max(1, to - from);
  const scale = dates
    ? Math.min(60, Math.max(3, 900 / span))
    : Math.min(140, Math.max(40, 900 / span));
  const ticks = ticksOf(
    from,
    to,
    dates,
    spec.unit as string | undefined,
    (spec.stepLabel as string | undefined) ?? "",
  );

  const ROW = 36;
  const BAR = 22;
  const title = titleItems(spec.title as string | undefined, ctx);
  const sections: string[] = [];
  for (const t of tasks) {
    if (t.section && !sections.includes(t.section)) {
      sections.push(t.section);
    }
  }
  const labelW = Math.min(
    320,
    Math.max(
      120,
      ...tasks.map((t) => ctx.measure(t.label, BODY).width + 24),
      ...sections.map((s) => ctx.measure(s, 18).width + 24),
    ),
  );
  const x = (d: number) => labelW + (d - from) * scale;
  const chartW = span * scale;
  // an owner's name after its bar may run past the last day
  const ownerRoom = Math.max(
    0,
    ...tasks
      .filter((t) => t.owner)
      .map(
        (t) =>
          x(t.end) + 10 + ctx.measure(t.owner!, 13).width - (labelW + chartW),
      ),
  );
  const bars = new Map<Task, { x1: number; x2: number; y: number }>();
  const top = title.height;
  const axisH = 30;
  const items: Item[] = [...title.items];

  // rows: a section header row, then its tasks; tasks with no section first
  const rows: ({ section: string } | { task: Task })[] = [];
  for (const t of tasks.filter((t) => !t.section)) {
    rows.push({ task: t });
  }
  for (const s of sections) {
    rows.push({ section: s });
    for (const t of tasks.filter((t) => t.section === s)) {
      rows.push({ task: t });
    }
  }
  const bodyTop = top + axisH;
  const bodyH = rows.length * ROW;

  if (spec.weekends === true && dates && scale >= 6) {
    // Saturdays and Sundays shaded, so no deadline lands on one unseen
    for (let d = Math.floor(from); d < to; d++) {
      const day = new Date(d * DAY).getUTCDay();
      if (day === 0 || day === 6) {
        items.push({
          kind: "rect",
          key: `we${d}`,
          x: x(d),
          y: bodyTop,
          w: scale,
          h: bodyH,
          stroke: "transparent",
          fill: "#f1f3f5",
        });
      }
    }
  }

  // label every n-th tick when the labels would touch
  const widest = Math.max(...ticks.map((t) => ctx.measure(t.label, 14).width));
  const spacing = ticks.length > 1 ? x(ticks[1].at) - x(ticks[0].at) : Infinity;
  const every = Math.max(1, Math.ceil((widest + 10) / spacing));
  for (const [k, tick] of ticks.entries()) {
    const tx = x(tick.at);
    if (tx < labelW - 0.5 || tx > labelW + chartW + 0.5) {
      continue;
    }
    if (k % every) {
      items.push({
        kind: "line",
        key: `g${k}`,
        points: [
          [tx, bodyTop],
          [tx, bodyTop + bodyH],
        ],
        stroke: "#f1f3f5",
        strokeWidth: 1,
      });
      continue;
    }
    const m = ctx.measure(tick.label, 14);
    items.push(
      {
        kind: "line",
        key: `g${k}`,
        points: [
          [tx, bodyTop],
          [tx, bodyTop + bodyH],
        ],
        stroke: "#dee2e6",
        strokeWidth: 1,
      },
      {
        kind: "text",
        key: `g${k}-t`,
        x: tx - m.width / 2,
        y: top + 4,
        text: tick.label,
        size: 14,
        color: MUTED,
        align: "center",
      },
    );
  }
  rows.forEach((row, r) => {
    const y = bodyTop + r * ROW;
    if ("section" in row) {
      const paint = ctx.paint(
        SECTION_COLORS[sections.indexOf(row.section) % SECTION_COLORS.length],
        "gray",
      );
      items.push(
        {
          kind: "rect",
          key: `r${r}`,
          x: 0,
          y: y + 2,
          w: labelW + chartW,
          h: ROW - 4,
          stroke: "transparent",
          fill: paint.fill,
          opacity: 70,
        },
        {
          kind: "text",
          key: `r${r}-t`,
          x: 10,
          y: y + (ROW - ctx.measure(row.section, 18).height) / 2,
          text: row.section,
          size: 18,
          color: paint.stroke,
        },
      );
      return;
    }
    const t = row.task;
    const color =
      t.color ??
      (t.section
        ? SECTION_COLORS[sections.indexOf(t.section) % SECTION_COLORS.length]
        : "blue");
    // status colours: green done, red delayed, orange blocked, grey pending
    const paint = ctx.paint(
      t.status === "done"
        ? "green"
        : t.status === "delayed"
        ? "red"
        : t.status === "blocked"
        ? "orange"
        : t.status === "pending"
        ? "gray"
        : color,
      "blue",
    );
    const m = ctx.measure(t.label, BODY);
    items.push({
      kind: "text",
      key: `r${r}-t`,
      x: 14,
      y: y + (ROW - m.height) / 2,
      text: t.label,
      size: BODY,
      color: t.done ? MUTED : INK,
    });
    if (t.owner) {
      const end = t.milestone ? x(t.start) + 12 : x(t.end);
      const om = ctx.measure(t.owner, 13);
      items.push({
        kind: "text",
        key: `r${r}-o`,
        x: end + 10,
        y: y + (ROW - om.height) / 2,
        text: t.owner,
        size: 13,
        color: MUTED,
      });
    }
    bars.set(t, {
      x1: x(t.start),
      x2: t.milestone ? x(t.start) : x(t.end),
      y: y + ROW / 2,
    });
    if (t.milestone) {
      const D = 20;
      items.push({
        kind: "diamond",
        key: `r${r}`,
        x: x(t.start) - D / 2,
        y: y + (ROW - D) / 2,
        w: D,
        h: D,
        stroke: paint.stroke,
        fill: paint.stroke,
      });
      return;
    }
    const bx = x(t.start);
    const bw = Math.max(4, (t.end - t.start) * scale);
    items.push({
      kind: "rect",
      key: `r${r}`,
      x: bx,
      y: y + (ROW - BAR) / 2,
      w: bw,
      h: BAR,
      stroke: paint.stroke,
      fill:
        t.progress !== undefined
          ? paint.fill
          : t.status === "pending"
          ? paint.fill
          : paint.stroke,
      strokeWidth: 1,
      rounded: true,
    });
    if (t.progress !== undefined && t.progress > 0) {
      items.push({
        kind: "rect",
        key: `r${r}-p`,
        x: bx,
        y: y + (ROW - BAR) / 2,
        w: Math.max(4, bw * t.progress),
        h: BAR,
        stroke: paint.stroke,
        fill: paint.stroke,
        strokeWidth: 1,
        rounded: true,
      });
    }
  });
  // dependencies: from the end (F) or start (S) of one bar to the start or
  // end of another, around the bars rather than through them
  let depN = 0;
  for (const t of tasks) {
    const b = bars.get(t)!;
    for (const dep of t.deps) {
      const a = bars.get(dep.on)!;
      const fromEnd = dep.type === "FS" || dep.type === "FF";
      const toStart = dep.type === "FS" || dep.type === "SS";
      const sx = fromEnd ? a.x2 : a.x1;
      const ex = toStart ? b.x1 : b.x2;
      const sd = fromEnd ? 1 : -1;
      const ed = toStart ? -1 : 1;
      const p1: [number, number] = [sx + sd * 10, a.y];
      const p4: [number, number] = [ex + ed * 10, b.y];
      let points: [number, number][];
      if (sd === ed) {
        const cx = sd > 0 ? Math.max(p1[0], p4[0]) : Math.min(p1[0], p4[0]);
        points = [
          [sx, a.y],
          [cx, a.y],
          [cx, b.y],
          [ex, b.y],
        ];
      } else if ((sd > 0 && p1[0] <= p4[0]) || (sd < 0 && p1[0] >= p4[0])) {
        points = [
          [sx, a.y],
          [p1[0], a.y],
          [p1[0], b.y],
          [ex, b.y],
        ];
      } else {
        const mid = (a.y + b.y) / 2;
        points = [[sx, a.y], p1, [p1[0], mid], [p4[0], mid], p4, [ex, b.y]];
      }
      items.push({
        kind: "arrow",
        key: `dep${depN++}`,
        points,
        stroke: "#495057",
        strokeWidth: 1,
        head: "triangle",
      });
    }
  }
  if (today !== undefined) {
    const tx = x(today);
    const label = (spec.todayLabel as string | undefined) ?? "today";
    const m = ctx.measure(label, 14);
    items.push(
      {
        kind: "line",
        key: "today",
        points: [
          [tx, bodyTop - 4],
          [tx, bodyTop + bodyH],
        ],
        stroke: "#e03131",
        line: "dashed",
        strokeWidth: 2,
      },
      {
        kind: "text",
        key: "today-t",
        x: tx - m.width / 2,
        y: bodyTop + bodyH + 4,
        text: label,
        size: 14,
        color: "#e03131",
        align: "center",
      },
    );
  }
  items.push({
    kind: "line",
    key: "axis",
    points: [
      [labelW, bodyTop],
      [labelW + chartW, bodyTop],
    ],
    stroke: RULE,
    strokeWidth: 1,
  });
  const width = Math.max(labelW + chartW + 20 + ownerRoom, title.width);
  const height = bodyTop + bodyH + (today !== undefined ? 26 : 8);
  return { width, height, items: [box(width, height), ...items] };
};

// -------------------------------------------------------------- wireframe

const WIDGETS = [
  // app and general
  "header",
  "title",
  "heading",
  "text",
  "button",
  "input",
  "textarea",
  "search",
  "checkbox",
  "radio",
  "toggle",
  "select",
  "image",
  "card",
  "list",
  "tabs",
  "tabbar",
  "divider",
  "spacer",
  "avatar",
  "chips",
  "badge",
  "icon",
  "progress",
  "link",
  "table",
  "row",
  "grid",
  // website
  "nav",
  "hero",
  "section",
  "footer",
  // game UI
  "slots",
  "minimap",
] as const;
type Widget = { type: typeof WIDGETS[number] } & Record<string, unknown>;

// the screen widths Excalidraw's guide recommends; a game screen is 16:9
const DEVICES = {
  mobile: { width: 375, minHeight: 667 },
  tablet: { width: 768, minHeight: 760 },
  desktop: { width: 1440, minHeight: 800 },
  browser: { width: 1440, minHeight: 800 },
  game: { width: 1280, minHeight: 720 },
} as const;

const FIDELITY = ["low", "mid", "high"] as const;
type Fidelity = typeof FIDELITY[number];

const widgetsOf = (v: unknown, where: string, depth = 0): Widget[] => {
  if (depth > 3) {
    return refuse(`${where}: rows, grids and sections nest at most 3 deep`);
  }
  return list(v ?? [], where, 80).map((raw, k) => {
    const at = `${where}[${k}]`;
    if (!isObject(raw)) {
      return refuse(`${at} must be a widget {type, label, ...}`);
    }
    const type = oneOf(raw.type, `${at}.type`, WIDGETS);
    if (!type) {
      return refuse(`${at} needs a \`type\` (${WIDGETS.join(", ")})`);
    }
    str(raw.label, `${at}.label`);
    str(raw.text, `${at}.text`);
    if (
      raw.id !== undefined &&
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(String(raw.id))
    ) {
      refuse(
        `${at}.id must be letters, digits, _ or - (it is reached as <screen>.<id>)`,
      );
    }
    const nested = type === "row" || type === "grid" || type === "section";
    if (raw.items !== undefined) {
      if (nested) {
        widgetsOf(raw.items, `${at}.items`, depth + 1);
      } else {
        list(raw.items, `${at}.items`, 40).forEach((item, j) => {
          if (type === "table" || type === "footer") {
            list(item, `${at}.items[${j}]`, 12).forEach((c, i) =>
              str(c, `${at}.items[${j}][${i}]`),
            );
          } else {
            str(item, `${at}.items[${j}]`);
          }
        });
      }
    } else if (type === "row" || type === "grid") {
      refuse(`${at}: a ${type} needs \`items\` (widgets side by side)`);
    }
    num(raw.value, `${at}.value`, 0, 1);
    num(raw.columns, `${at}.columns`, 1, 8);
    num(raw.level, `${at}.level`, 1, 3);
    num(raw.count, `${at}.count`, 1, 40);
    return raw as Widget;
  });
};

const validateWireframe = (spec: Record<string, unknown>) => {
  str(spec.label, "label");
  oneOf(
    spec.device,
    "device",
    Object.keys(DEVICES) as (keyof typeof DEVICES)[],
  );
  oneOf(spec.fidelity, "fidelity", FIDELITY);
  str(spec.color, "color");
  widgetsOf(spec.items, "items");
};

/** Every widget id a screen declares, for edges that start at a widget. */
export const widgetIds = (spec: Record<string, unknown>): Set<string> => {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (isObject(v)) {
      if (typeof v.id === "string" && typeof v.type === "string") {
        ids.add(v.id);
      }
      if (Array.isArray(v.items)) {
        walk(v.items);
      }
    }
  };
  walk(spec.items);
  return ids;
};

/** The item key of a widget an edge can name. */
export const widgetKey = (id: string) => `id-${id}`;

type Look = {
  fidelity: Fidelity;
  line: string;
  fill: string;
  primary: Paint;
  muted: string;
};

const lookOf = (spec: Record<string, unknown>, ctx: DrawContext): Look => {
  const fidelity = (spec.fidelity as Fidelity | undefined) ?? "mid";
  const brand = ctx.paint((spec.color as string | undefined) ?? "blue", "blue");
  return fidelity === "low"
    ? {
        fidelity,
        line: "#495057",
        fill: "#e9ecef",
        primary: { stroke: "#868e96", fill: "#dee2e6" },
        muted: "#adb5bd",
      }
    : fidelity === "high"
    ? {
        fidelity,
        line: "#343a40",
        fill: "#f1f3f5",
        primary: brand,
        muted: MUTED,
      }
    : {
        fidelity,
        line: "#495057",
        fill: "#e9ecef",
        primary: ctx.paint("blue", "blue"),
        muted: MUTED,
      };
};

const drawWidget = (
  w: Widget,
  x: number,
  y: number,
  width: number,
  key: string,
  ctx: DrawContext,
  look: Look,
): { items: Item[]; height: number } => {
  // a widget an edge can start from is keyed by its own id
  key = typeof w.id === "string" ? widgetKey(w.id) : key;
  const label = (w.label as string | undefined) ?? "";
  const text = (w.text as string | undefined) ?? "";
  const items: Item[] = [];
  const { line: LINE, fill: FILL, primary } = look;
  const lofi = look.fidelity === "low";
  const textAt = (
    t: string,
    tx: number,
    ty: number,
    size = BODY,
    color = INK,
    k = "t",
    maxWidth = width - (tx - x),
  ): number => {
    const wrapped = wrap(t, Math.max(40, maxWidth), size, ctx.measure);
    items.push({
      kind: "text",
      key: `${key}-${k}`,
      x: tx,
      y: ty,
      text: wrapped,
      size,
      color,
    });
    return ctx.measure(wrapped, size).height;
  };
  /** low fidelity draws body copy as grey lines, not words */
  const placeholder = (
    lines: number,
    tx: number,
    ty: number,
    w0: number,
    k: string,
  ) => {
    for (let i = 0; i < lines; i++) {
      const lw = i === lines - 1 ? w0 * 0.6 : w0;
      items.push({
        kind: "rect",
        key: `${key}-${k}${i}`,
        x: tx,
        y: ty + i * 16,
        w: lw,
        h: 8,
        stroke: "transparent",
        fill: "#ced4da",
        rounded: true,
      });
    }
    return lines * 16;
  };
  const imageBox = (
    bx: number,
    by: number,
    bw: number,
    bh: number,
    k: string,
    caption = "",
  ) => {
    items.push(
      {
        kind: "rect",
        key: k,
        x: bx,
        y: by,
        w: bw,
        h: bh,
        stroke: LINE,
        fill: FILL,
        strokeWidth: 1,
      },
      {
        kind: "line",
        key: `${k}-a`,
        points: [
          [bx, by],
          [bx + bw, by + bh],
        ],
        stroke: RULE,
        strokeWidth: 1,
      },
      {
        kind: "line",
        key: `${k}-b`,
        points: [
          [bx + bw, by],
          [bx, by + bh],
        ],
        stroke: RULE,
        strokeWidth: 1,
      },
    );
    if (caption) {
      const m = ctx.measure(caption, 14);
      items.push({
        kind: "rect",
        key: `${k}-c`,
        x: bx + (bw - m.width) / 2 - 8,
        y: by + (bh - m.height) / 2 - 4,
        w: m.width + 16,
        h: m.height + 8,
        stroke: "transparent",
        fill: FILL,
      });
      items.push({
        kind: "text",
        key: `${k}-t`,
        x: bx + (bw - m.width) / 2,
        y: by + (bh - m.height) / 2,
        text: caption,
        size: 14,
        color: LINE,
      });
    }
  };
  const button = (
    bx: number,
    by: number,
    bw: number,
    t: string,
    filled: boolean,
    k: string,
  ) => {
    items.push({
      kind: "rect",
      key: k,
      x: bx,
      y: by,
      w: bw,
      h: 46,
      stroke: filled ? primary.stroke : LINE,
      fill: filled ? primary.stroke : "#ffffff",
      strokeWidth: 2,
      rounded: true,
      label: { text: t || "Button", size: 18, color: filled ? "#ffffff" : INK },
    });
  };
  switch (w.type) {
    case "header": {
      const h = 56;
      items.push({
        kind: "rect",
        key,
        x,
        y,
        w: width,
        h,
        stroke: LINE,
        fill: look.fidelity === "high" ? primary.fill : FILL,
        strokeWidth: 1,
      });
      const m = ctx.measure(label || " ", 20);
      if (label) {
        items.push({
          kind: "text",
          key: `${key}-t`,
          x: x + 16,
          y: y + (h - m.height) / 2,
          text: label,
          size: 20,
          color: INK,
        });
      }
      let rx = x + width - 16;
      [...((w.items as string[] | undefined) ?? [])]
        .reverse()
        .forEach((item, j) => {
          const mm = ctx.measure(item, 14);
          rx -= mm.width;
          items.push({
            kind: "text",
            key: `${key}-m${j}`,
            x: rx,
            y: y + (h - mm.height) / 2,
            text: item,
            size: 14,
            color: LINE,
          });
          rx -= 18;
        });
      return { items, height: h };
    }
    case "nav": {
      // a website's top bar: the logo, the menu, an action on the right
      const h = 64;
      items.push({
        kind: "rect",
        key,
        x,
        y,
        w: width,
        h,
        stroke: LINE,
        fill: "#ffffff",
        strokeWidth: 1,
      });
      if (label) {
        const m = ctx.measure(label, 22);
        items.push({
          kind: "rect",
          key: `${key}-logo`,
          x: x + 24,
          y: y + (h - 28) / 2,
          w: 28,
          h: 28,
          stroke: primary.stroke,
          fill: primary.fill,
          strokeWidth: 1,
          rounded: true,
        });
        items.push({
          kind: "text",
          key: `${key}-t`,
          x: x + 60,
          y: y + (h - m.height) / 2,
          text: label,
          size: 22,
          color: INK,
        });
      }
      const menu = (w.items as string[] | undefined) ?? [];
      let rx = x + width - 24;
      if (text) {
        const bw = ctx.measure(text, 16).width + 32;
        rx -= bw;
        items.push({
          kind: "rect",
          key: `${key}-cta`,
          x: rx,
          y: y + 12,
          w: bw,
          h: 40,
          stroke: primary.stroke,
          fill: primary.stroke,
          strokeWidth: 1,
          rounded: true,
          label: { text, size: 16, color: "#ffffff" },
        });
        rx -= 28;
      }
      [...menu].reverse().forEach((item, j) => {
        const mm = ctx.measure(item, 16);
        rx -= mm.width;
        items.push({
          kind: "text",
          key: `${key}-m${j}`,
          x: rx,
          y: y + (h - mm.height) / 2,
          text: item,
          size: 16,
          color: LINE,
        });
        rx -= 28;
      });
      return { items, height: h };
    }
    case "hero": {
      // a banner: headline, copy and a call to action beside an image
      const h = width > 700 ? 360 : 300;
      const side = width > 700;
      items.push({
        kind: "rect",
        key,
        x,
        y,
        w: width,
        h,
        stroke: "transparent",
        fill: look.fidelity === "high" ? primary.fill : "#f8f9fa",
      });
      const tw = side ? width * 0.5 - 40 : width - 48;
      let ty = y + (side ? 64 : 32);
      ty +=
        textAt(label || "Headline", x + 24, ty, side ? 44 : 32, INK, "t", tw) +
        16;
      if (text) {
        ty +=
          (lofi
            ? placeholder(3, x + 24, ty, tw * 0.9, "p")
            : textAt(text, x + 24, ty, 18, LINE, "b", tw)) + 24;
      }
      const cta = (w.items as string[] | undefined) ?? ["Get started"];
      cta.slice(0, 2).forEach((c, j) => {
        const bw = ctx.measure(c, 18).width + 40;
        button(x + 24 + j * (bw + 16), ty, bw, c, j === 0, `${key}-b${j}`);
      });
      if (side) {
        imageBox(
          x + width * 0.55,
          y + 40,
          width * 0.45 - 40,
          h - 80,
          `${key}-img`,
          w.image as string | undefined,
        );
      }
      return { items, height: h };
    }
    case "section": {
      // a band across the page with its own content
      const children = widgetsOf(w.items, key, 1);
      const inner: Item[] = [];
      let cy = y + 32;
      if (label) {
        const t = wrap(label, width - 48, 28, ctx.measure);
        inner.push({
          kind: "text",
          key: `${key}-t`,
          x: x + 24,
          y: cy,
          text: t,
          size: 28,
          color: INK,
        });
        cy += ctx.measure(t, 28).height + 20;
      }
      children.forEach((child, j) => {
        const drawn = drawWidget(
          child,
          x + 24,
          cy,
          width - 48,
          `${key}-${j}`,
          ctx,
          look,
        );
        inner.push(...drawn.items);
        cy += drawn.height + 14;
      });
      const h = cy - y + 18;
      items.push(
        {
          kind: "rect",
          key,
          x,
          y,
          w: width,
          h,
          stroke: "transparent",
          fill: w.fill === false ? "transparent" : "#f8f9fa",
        },
        ...inner,
      );
      return { items, height: h };
    }
    case "footer": {
      const columns = (w.items as string[][] | undefined) ?? [];
      const each = (width - 48) / Math.max(1, columns.length);
      let h = 40;
      const inner: Item[] = [];
      columns.forEach((col, j) => {
        let cy = y + 28;
        col.forEach((entry, i) => {
          const size = i === 0 ? 16 : 14;
          const m = ctx.measure(entry, size);
          inner.push({
            kind: "text",
            key: `${key}-${j}-${i}`,
            x: x + 24 + j * each,
            y: cy,
            text: entry,
            size,
            color: i === 0 ? INK : LINE,
          });
          cy += m.height + 8;
        });
        h = Math.max(h, cy - y + 20);
      });
      if (label) {
        inner.push({
          kind: "text",
          key: `${key}-t`,
          x: x + 24,
          y: y + h,
          text: label,
          size: 12,
          color: look.muted,
        });
        h += 30;
      }
      items.push(
        {
          kind: "rect",
          key,
          x,
          y,
          w: width,
          h,
          stroke: "transparent",
          fill: FILL,
        },
        ...inner,
      );
      return { items, height: h };
    }
    case "title":
      return { items, height: textAt(label || text, x, y, 28) };
    case "heading": {
      // XL for the page title, L for a section, M below
      const size = [36, 28, 22][((w.level as number | undefined) ?? 1) - 1];
      return { items, height: textAt(label || text, x, y, size) };
    }
    case "text":
      return {
        items,
        height:
          lofi && !w.real
            ? placeholder(
                Math.max(
                  1,
                  Math.ceil(
                    ctx.measure(text || label, BODY).width / Math.max(1, width),
                  ),
                ),
                x,
                y + 4,
                width,
                "p",
              )
            : textAt(text || label, x, y, BODY, LINE),
      };
    case "link":
      return {
        items,
        height: textAt(label || text, x, y, BODY, primary.stroke),
      };
    case "button": {
      const filled = w.primary !== false && w.style !== "secondary";
      const bw =
        w.full === false
          ? Math.min(width, ctx.measure(label || "Button", 18).width + 48)
          : width;
      button(x, y, bw, label, filled, key);
      return { items, height: 46 };
    }
    case "input":
    case "search":
    case "select":
    case "textarea": {
      let cy = y;
      if (label && w.type !== "search") {
        cy += textAt(label, x, y, 14, LINE, "l") + 6;
      }
      const h = w.type === "textarea" ? 110 : 44;
      const hint =
        text || (w.type === "search" ? `🔍 ${label || "Search"}` : "");
      items.push({
        kind: "rect",
        key,
        x,
        y: cy,
        w: width,
        h,
        stroke: LINE,
        fill: "#ffffff",
        strokeWidth: 1,
        rounded: true,
      });
      if (hint) {
        const m = ctx.measure(hint, BODY);
        items.push({
          kind: "text",
          key: `${key}-p`,
          x: x + 12,
          y: w.type === "textarea" ? cy + 10 : cy + (h - m.height) / 2,
          text: hint,
          size: BODY,
          color: look.muted,
        });
      }
      if (w.type === "select") {
        const m = ctx.measure("▾", 18);
        items.push({
          kind: "text",
          key: `${key}-a`,
          x: x + width - 14 - m.width,
          y: cy + (h - m.height) / 2,
          text: "▾",
          size: 18,
          color: LINE,
        });
      }
      return { items, height: cy - y + h };
    }
    case "checkbox":
    case "radio":
    case "toggle": {
      const on = w.checked === true;
      const m = ctx.measure(label || " ", BODY);
      const h = Math.max(24, m.height);
      if (w.type === "toggle") {
        items.push({
          kind: "rect",
          key,
          x,
          y: y + (h - 22) / 2,
          w: 40,
          h: 22,
          stroke: on ? primary.stroke : LINE,
          fill: on ? primary.stroke : FILL,
          strokeWidth: 1,
          rounded: true,
        });
        items.push({
          kind: "ellipse",
          key: `${key}-k`,
          x: on ? x + 20 : x + 2,
          y: y + (h - 18) / 2,
          w: 18,
          h: 18,
          stroke: LINE,
          fill: "#ffffff",
          strokeWidth: 1,
        });
      } else {
        items.push({
          kind: w.type === "radio" ? "ellipse" : "rect",
          key,
          x,
          y: y + (h - 20) / 2,
          w: 20,
          h: 20,
          stroke: LINE,
          fill: on ? primary.stroke : "#ffffff",
          strokeWidth: 2,
        });
      }
      if (label) {
        items.push({
          kind: "text",
          key: `${key}-t`,
          x: x + (w.type === "toggle" ? 52 : 30),
          y: y + (h - m.height) / 2,
          text: label,
          size: BODY,
          color: INK,
        });
      }
      return { items, height: h };
    }
    case "image": {
      const h = w.height === "s" ? 100 : w.height === "l" ? 280 : 180;
      imageBox(x, y, width, h, key, label);
      return { items, height: h };
    }
    case "minimap": {
      const s = Math.min(width, 160);
      items.push(
        {
          kind: "rect",
          key,
          x: x + width - s,
          y,
          w: s,
          h: s,
          stroke: LINE,
          fill: "#d3f9d8",
          strokeWidth: 2,
        },
        {
          kind: "ellipse",
          key: `${key}-me`,
          x: x + width - s / 2 - 5,
          y: y + s / 2 - 5,
          w: 10,
          h: 10,
          stroke: "#e03131",
          fill: "#e03131",
        },
      );
      if (label) {
        const m = ctx.measure(label, 12);
        items.push({
          kind: "text",
          key: `${key}-t`,
          x: x + width - s + (s - m.width) / 2,
          y: y + s + 4,
          text: label,
          size: 12,
          color: LINE,
        });
      }
      return { items, height: s + (label ? 20 : 0) };
    }
    case "slots": {
      // an inventory or skill bar: square slots, labels inside
      const names = (w.items as string[] | undefined) ?? [];
      const count =
        (w.count as number | undefined) ?? Math.max(names.length, 6);
      const columns = (w.columns as number | undefined) ?? Math.min(count, 10);
      const S = Math.min(64, (width - (columns - 1) * 8) / columns);
      for (let i = 0; i < count; i++) {
        const c = i % columns;
        const r = Math.floor(i / columns);
        items.push({
          kind: "rect",
          key: `${key}-${i}`,
          x: x + c * (S + 8),
          y: y + r * (S + 8),
          w: S,
          h: S,
          stroke: LINE,
          fill: names[i] ? "#ffffff" : FILL,
          strokeWidth: 2,
          rounded: true,
          ...(names[i] ? { label: { text: names[i], size: 12 } } : null),
        });
      }
      return { items, height: Math.ceil(count / columns) * (S + 8) - 8 };
    }
    case "avatar": {
      const D = 44;
      items.push({
        kind: "ellipse",
        key,
        x,
        y,
        w: D,
        h: D,
        stroke: LINE,
        fill: FILL,
        strokeWidth: 1,
      });
      if (label) {
        const m = ctx.measure(label, BODY);
        items.push({
          kind: "text",
          key: `${key}-t`,
          x: x + D + 12,
          y: y + (D - m.height) / 2,
          text: label,
          size: BODY,
          color: INK,
        });
      }
      return { items, height: D };
    }
    case "icon": {
      const D = 40;
      items.push({
        kind: "rect",
        key,
        x,
        y,
        w: D,
        h: D,
        stroke: LINE,
        fill: FILL,
        strokeWidth: 1,
        rounded: true,
        label: { text: (w.symbol as string | undefined) ?? "★", size: 18 },
      });
      if (label) {
        const m = ctx.measure(label, 14);
        items.push({
          kind: "text",
          key: `${key}-t`,
          x: x + D + 10,
          y: y + (D - m.height) / 2,
          text: label,
          size: 14,
          color: INK,
        });
      }
      return { items, height: D };
    }
    case "badge": {
      const m = ctx.measure(label || " ", 13);
      items.push({
        kind: "rect",
        key,
        x,
        y,
        w: m.width + 20,
        h: 24,
        stroke: primary.stroke,
        fill: primary.fill,
        strokeWidth: 1,
        rounded: true,
        label: { text: label, size: 13 },
      });
      return { items, height: 24 };
    }
    case "card": {
      const inner: Item[] = [];
      let cy = y + 14;
      if (w.image) {
        imageBox(x + 1, y + 1, width - 2, 120, `${key}-img`, w.image as string);
        cy = y + 134;
      }
      if (label) {
        const t = wrap(label, width - 28, 18, ctx.measure);
        inner.push({
          kind: "text",
          key: `${key}-t`,
          x: x + 14,
          y: cy,
          text: t,
          size: 18,
          color: INK,
        });
        cy += ctx.measure(t, 18).height + 6;
      }
      if (text) {
        if (lofi) {
          cy += placeholder(2, x + 14, cy + 4, width - 28, "p");
        } else {
          const t = wrap(text, width - 28, 14, ctx.measure);
          inner.push({
            kind: "text",
            key: `${key}-b`,
            x: x + 14,
            y: cy,
            text: t,
            size: 14,
            color: LINE,
          });
          cy += ctx.measure(t, 14).height;
        }
      }
      const h = Math.max(70, cy - y + 14);
      const imageItems = items.splice(0);
      items.push(
        {
          kind: "rect",
          key,
          x,
          y,
          w: width,
          h,
          stroke: LINE,
          fill: "#ffffff",
          strokeWidth: 1,
          rounded: true,
        },
        ...imageItems,
        ...inner,
      );
      return { items, height: h };
    }
    case "list": {
      const rows = (w.items as string[] | undefined) ?? [];
      let cy = y;
      rows.forEach((row, j) => {
        const m = ctx.measure(row, BODY);
        const h = Math.max(48, m.height + 20);
        items.push({
          kind: "text",
          key: `${key}-r${j}`,
          x: x + 4,
          y: cy + (h - m.height) / 2,
          text: row,
          size: BODY,
          color: INK,
        });
        const chevron = ctx.measure("›", 20);
        items.push({
          kind: "text",
          key: `${key}-c${j}`,
          x: x + width - 8 - chevron.width,
          y: cy + (h - chevron.height) / 2,
          text: "›",
          size: 20,
          color: look.muted,
        });
        cy += h;
        items.push({
          kind: "line",
          key: `${key}-d${j}`,
          points: [
            [x, cy],
            [x + width, cy],
          ],
          stroke: "#dee2e6",
          strokeWidth: 1,
        });
      });
      return { items, height: Math.max(cy - y, 1) };
    }
    case "tabs":
    case "chips":
    case "tabbar": {
      const tabs = (w.items as string[] | undefined) ?? [];
      const h = w.type === "tabbar" ? 60 : w.type === "chips" ? 34 : 42;
      if (w.type === "tabbar") {
        items.push({
          kind: "rect",
          key,
          x,
          y,
          w: width,
          h,
          stroke: LINE,
          fill: FILL,
          strokeWidth: 1,
        });
      }
      if (w.type === "chips") {
        let cx = x;
        tabs.forEach((tab, j) => {
          const m = ctx.measure(tab, 14);
          items.push({
            kind: "rect",
            key: j === 0 ? key : `${key}-${j}`,
            x: cx,
            y,
            w: m.width + 24,
            h,
            stroke: j === 0 ? primary.stroke : LINE,
            fill: j === 0 ? primary.fill : "#ffffff",
            strokeWidth: 1,
            rounded: true,
            label: { text: tab, size: 14 },
          });
          cx += m.width + 32;
        });
        return { items, height: h };
      }
      const each = width / Math.max(1, tabs.length);
      tabs.forEach((tab, j) => {
        const size = w.type === "tabbar" ? 14 : BODY;
        const m = ctx.measure(tab, size);
        items.push({
          kind: "text",
          key: `${key}-${j}`,
          x: x + each * j + (each - m.width) / 2,
          y: y + (h - m.height) / 2,
          text: tab,
          size,
          color: j === 0 ? primary.stroke : LINE,
        });
        if (j === 0 && w.type === "tabs") {
          items.push({
            kind: "line",
            key: `${key}-u`,
            points: [
              [x + each * j + 8, y + h - 2],
              [x + each * (j + 1) - 8, y + h - 2],
            ],
            stroke: primary.stroke,
            strokeWidth: 4,
          });
        }
      });
      if (w.type === "tabs") {
        items.push({
          kind: "line",
          key: `${key}-l`,
          points: [
            [x, y + h],
            [x + width, y + h],
          ],
          stroke: "#dee2e6",
          strokeWidth: 1,
        });
      }
      return { items, height: h };
    }
    case "progress": {
      const value = (w.value as number | undefined) ?? 0.5;
      let cy = y;
      if (label) {
        cy += textAt(label, x, y, 14, LINE, "l") + 6;
      }
      const color = w.color
        ? ctx.paint(w.color as string, "blue").stroke
        : primary.stroke;
      items.push(
        {
          kind: "rect",
          key,
          x,
          y: cy,
          w: width,
          h: 12,
          stroke: LINE,
          fill: FILL,
          strokeWidth: 1,
          rounded: true,
        },
        {
          kind: "rect",
          key: `${key}-v`,
          x,
          y: cy,
          w: Math.max(6, width * value),
          h: 12,
          stroke: color,
          fill: color,
          strokeWidth: 1,
          rounded: true,
        },
      );
      return { items, height: cy - y + 12 };
    }
    case "divider":
      items.push({
        kind: "line",
        key,
        points: [
          [x, y + 6],
          [x + width, y + 6],
        ],
        stroke: RULE,
        strokeWidth: 1,
      });
      return { items, height: 12 };
    case "spacer":
      return {
        items,
        height: w.height === "l" ? 60 : w.height === "s" ? 12 : 30,
      };
    case "table": {
      const rows = (w.items as string[][] | undefined) ?? [];
      const cols = Math.max(1, ...rows.map((r) => r.length));
      const cw = width / cols;
      let cy = y;
      rows.forEach((row, j) => {
        const h = 36;
        for (let i = 0; i < cols; i++) {
          items.push({
            kind: "rect",
            key: `${key}-${j}-${i}`,
            x: x + cw * i,
            y: cy,
            w: cw,
            h,
            stroke: RULE,
            fill: j === 0 ? FILL : "#ffffff",
            strokeWidth: 1,
          });
          const cell = row[i] ?? "";
          if (cell) {
            const t = wrap(cell, cw - 16, 14, ctx.measure);
            const m = ctx.measure(t, 14);
            items.push({
              kind: "text",
              key: `${key}-${j}-${i}-t`,
              x: x + cw * i + 8,
              y: cy + (h - m.height) / 2,
              text: t,
              size: 14,
              color: INK,
            });
          }
        }
        cy += h;
      });
      return { items, height: Math.max(cy - y, 1) };
    }
    case "row":
    case "grid": {
      const children = w.items as Widget[];
      const GAPX = w.type === "grid" ? 20 : 12;
      const columns =
        w.type === "row"
          ? children.length
          : (w.columns as number | undefined) ?? 3;
      const each = (width - GAPX * (columns - 1)) / Math.max(1, columns);
      let h = 0;
      let rowTop = y;
      let rowH = 0;
      children.forEach((child, j) => {
        const c = j % columns;
        if (c === 0 && j > 0) {
          rowTop += rowH + GAPX;
          rowH = 0;
        }
        const drawn = drawWidget(
          child,
          x + c * (each + GAPX),
          rowTop,
          each,
          `${key}-${j}`,
          ctx,
          look,
        );
        items.push(...drawn.items);
        rowH = Math.max(rowH, drawn.height);
        h = rowTop - y + rowH;
      });
      return { items, height: h };
    }
  }
  return { items, height: 0 };
};

const drawWireframe = (
  spec: Record<string, unknown>,
  ctx: DrawContext,
): Drawing => {
  const deviceName =
    (spec.device as keyof typeof DEVICES | undefined) ?? "mobile";
  const device = DEVICES[deviceName];
  const widgets = widgetsOf(spec.items, "items");
  const look = lookOf(spec, ctx);
  const PAD = deviceName === "mobile" ? 20 : deviceName === "tablet" ? 32 : 48;
  const GAP = 14;
  const width = device.width;
  const items: Item[] = [];
  let y = 0;
  if (deviceName === "browser") {
    items.push(
      {
        kind: "rect",
        key: "chrome",
        x: 0,
        y: 0,
        w: width,
        h: 40,
        stroke: "#495057",
        fill: "#e9ecef",
        strokeWidth: 1,
      },
      {
        kind: "rect",
        key: "chrome-url",
        x: 90,
        y: 8,
        w: width - 180,
        h: 24,
        stroke: "#adb5bd",
        fill: "#ffffff",
        strokeWidth: 1,
        rounded: true,
      },
    );
    ["#ff6b6b", "#fcc419", "#51cf66"].forEach((c, k) =>
      items.push({
        kind: "ellipse",
        key: `chrome-${k}`,
        x: 14 + k * 20,
        y: 14,
        w: 12,
        h: 12,
        stroke: c,
        fill: c,
      }),
    );
    y = 40;
  }
  const FULL = new Set(["header", "nav", "hero", "section", "footer"]);
  const bottom: Widget[] = [];
  let padded = false;
  widgets.forEach((w, k) => {
    if (w.type === "tabbar") {
      bottom.push(w);
      return;
    }
    if (FULL.has(w.type)) {
      // page-wide bands touch the screen's edges
      const drawn = drawWidget(w, 0, y, width, `w${k}`, ctx, look);
      items.push(...drawn.items);
      y += drawn.height;
      padded = false;
      return;
    }
    if (!padded) {
      y += PAD;
      padded = true;
    }
    const drawn = drawWidget(w, PAD, y, width - PAD * 2, `w${k}`, ctx, look);
    items.push(...drawn.items);
    y += drawn.height + GAP;
  });
  const tabH = bottom.length ? 60 : 0;
  const height = Math.max(
    device.minHeight,
    y - (padded ? GAP - PAD : 0) + tabH,
  );
  bottom.forEach((w, k) => {
    const drawn = drawWidget(w, 0, height - tabH, width, `b${k}`, ctx, look);
    items.push(...drawn.items);
  });
  const name = (spec.label as string | undefined) ?? "";
  return {
    width,
    height,
    // a low-fidelity screen is a sketch whatever the drawing's theme
    ...(look.fidelity === "low" ? { roughness: 1 } : null),
    // edges bind to the box; the frame around it holds the screen
    items: [
      box(width, height),
      { kind: "frame", key: "frame", x: 0, y: 0, w: width, h: height, name },
      ...items,
    ],
  };
};

// ----------------------------------------------------------------- sketch

const SKETCH_TYPES = [
  "rect",
  "ellipse",
  "diamond",
  "line",
  "arrow",
  "freedraw",
  "polygon",
  "text",
] as const;
const SIZES: Record<string, number> = { s: 14, m: 20, l: 28, xl: 40 };
const POINTED = new Set(["line", "arrow", "freedraw", "polygon"]);

const pointsOf = (v: unknown, where: string): [number, number][] => {
  const pts = list(v, where, 200);
  if (pts.length < 2) {
    refuse(`${where} needs at least two points`);
  }
  return pts.map((p, k) => {
    if (
      !Array.isArray(p) ||
      p.length !== 2 ||
      !p.every((n) => typeof n === "number" && Number.isFinite(n))
    ) {
      return refuse(`${where}[${k}] must be [x, y]`);
    }
    return [p[0], p[1]] as [number, number];
  });
};

const validateSketch = (spec: Record<string, unknown>) => {
  str(spec.label, "label");
  const els = list(spec.elements, "elements", 400);
  if (!els.length) {
    refuse("a sketch needs `elements`");
  }
  els.forEach((raw, k) => {
    const at = `elements[${k}]`;
    if (!isObject(raw)) {
      refuse(`${at} must be {type, x, y, ...}`);
    }
    const e = raw as Record<string, unknown>;
    const type = oneOf(e.type, `${at}.type`, SKETCH_TYPES);
    if (!type) {
      refuse(`${at} needs a \`type\` (${SKETCH_TYPES.join(", ")})`);
    }
    if (POINTED.has(type!)) {
      pointsOf(e.points, `${at}.points`);
    } else {
      num(e.x, `${at}.x`, -10000, 10000);
      num(e.y, `${at}.y`, -10000, 10000);
      if (e.x === undefined || e.y === undefined) {
        refuse(`${at} needs x and y`);
      }
    }
    if (type === "text") {
      str(e.text, `${at}.text`, true);
    } else if (!POINTED.has(type!)) {
      num(e.w, `${at}.w`, 1, 4000);
      num(e.h, `${at}.h`, 1, 4000);
      if (e.w === undefined || e.h === undefined) {
        refuse(`${at} needs w and h`);
      }
      str(e.text, `${at}.text`);
    }
    if (typeof e.size === "string" && !SIZES[e.size]) {
      refuse(`${at}.size must be s, m, l, xl or a number`);
    }
    num(typeof e.size === "number" ? e.size : undefined, `${at}.size`, 8, 120);
    oneOf(e.line, `${at}.line`, LINES);
    oneOf(e.fillStyle, `${at}.fillStyle`, [
      "solid",
      "hachure",
      "cross-hatch",
    ] as const);
    num(e.width, `${at}.width`, 1, 8);
    num(e.opacity, `${at}.opacity`, 0, 100);
    oneOf(e.align, `${at}.align`, ["left", "center", "right"] as const);
  });
};

const drawSketch = (
  spec: Record<string, unknown>,
  ctx: DrawContext,
): Drawing => {
  const items: Item[] = [];
  (spec.elements as Record<string, unknown>[]).forEach((e, k) => {
    const key = `e${k}`;
    const size =
      typeof e.size === "number"
        ? e.size
        : SIZES[(e.size as string | undefined) ?? "m"];
    const paint = ctx.paint(e.color as string | undefined, "black");
    const fill =
      e.fill === undefined || e.fill === "none"
        ? "transparent"
        : e.fill === true
        ? paint.fill
        : ctx.paint(e.fill as string, "gray").fill;
    if (e.type === "text") {
      items.push({
        kind: "text",
        key,
        x: e.x as number,
        y: e.y as number,
        text: e.text as string,
        size,
        color: paint.stroke,
        align: e.align as Align | undefined,
        opacity: e.opacity as number | undefined,
      });
    } else if (e.type === "freedraw") {
      items.push({
        kind: "freedraw",
        key,
        points: pointsOf(e.points, key),
        stroke: paint.stroke,
        strokeWidth: (e.width as number | undefined) ?? 2,
        opacity: e.opacity as number | undefined,
      });
    } else if (e.type === "polygon") {
      // a closed outline, filled like a shape
      const points = pointsOf(e.points, key);
      items.push({
        kind: "line",
        key,
        points: [...points, points[0]],
        stroke: paint.stroke,
        line: e.line as LineStyle | undefined,
        strokeWidth: (e.width as number | undefined) ?? 2,
        closed: true,
        fill,
        opacity: e.opacity as number | undefined,
      });
    } else if (e.type === "line" || e.type === "arrow") {
      items.push({
        kind: e.type,
        key,
        points: pointsOf(e.points, key),
        stroke: paint.stroke,
        line: e.line as LineStyle | undefined,
        strokeWidth: (e.width as number | undefined) ?? 2,
        head:
          (e.head as Head | undefined) ??
          (e.type === "arrow" ? "arrow" : "none"),
        tail: (e.tail as Head | undefined) ?? "none",
      });
    } else {
      items.push({
        kind: e.type as ShapeItem["kind"],
        key,
        x: e.x as number,
        y: e.y as number,
        w: e.w as number,
        h: e.h as number,
        stroke: paint.stroke,
        fill,
        fillStyle: e.fillStyle as ShapeItem["fillStyle"],
        line: e.line as LineStyle | undefined,
        strokeWidth: (e.width as number | undefined) ?? 2,
        rounded: e.rounded === true,
        opacity: e.opacity as number | undefined,
        label: e.text
          ? {
              text: e.text as string,
              size,
              align: e.align as Align | undefined,
            }
          : undefined,
      });
    }
  });
  // the sketch's own coordinates start wherever the agent began; the block
  // starts at the drawing's top-left corner
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extend = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const item of items) {
    if (isLine(item)) {
      item.points.forEach(([x, y]) => extend(x, y));
    } else if (item.kind === "text") {
      const m = ctx.measure(item.text, item.size);
      const x =
        item.align === "center"
          ? item.x - m.width / 2
          : item.align === "right"
          ? item.x - m.width
          : item.x;
      item.x = x;
      extend(x, item.y);
      extend(x + m.width, item.y + m.height);
    } else if (item.kind !== "frame") {
      extend(item.x, item.y);
      extend(item.x + item.w, item.y + item.h);
    }
  }
  let shifted = shift(items, -minX, -minY);
  let width = maxX - minX;
  let height = maxY - minY;
  if (spec.label) {
    const m = ctx.measure(spec.label as string, BODY);
    shifted.push({
      kind: "text",
      key: "label",
      x: Math.max(0, (width - m.width) / 2),
      y: height + 10,
      text: spec.label as string,
      size: BODY,
      color: MUTED,
      align: "center",
    });
    width = Math.max(width, m.width);
    height += 10 + m.height;
  }
  shifted = [box(width, height), ...shifted];
  return { width, height, items: shifted };
};

// ---------------------------------------------------------------- profile

// a persona, a competitor's profile, a candidate: who it is, a quote, traits
// on scales, and titled sections

type Section = { title: string; items?: string[]; text?: string };

const sectionsOf = (v: unknown, where: string): Section[] =>
  list(v ?? [], where, 12).map((raw, k) => {
    const at = `${where}[${k}]`;
    if (!isObject(raw)) {
      return refuse(`${at} must be {title, items | text}`);
    }
    const items =
      raw.items === undefined
        ? undefined
        : list(raw.items, `${at}.items`, 30).map(
            (i, j) => str(i, `${at}.items[${j}]`, true)!,
          );
    return {
      title: str(raw.title, `${at}.title`, true)!,
      items,
      text: str(raw.text, `${at}.text`),
    };
  });

const validateProfile = (spec: Record<string, unknown>) => {
  str(spec.name, "name", true);
  str(spec.subtitle, "subtitle");
  str(spec.quote, "quote");
  str(spec.color, "color");
  str(spec.avatar, "avatar");
  sectionsOf(spec.sections, "sections");
  list(spec.tags ?? [], "tags", 12).forEach((t, k) =>
    str(t, `tags[${k}]`, true),
  );
  list(spec.scales ?? [], "scales", 10).forEach((raw, k) => {
    if (!isObject(raw)) {
      refuse(`scales[${k}] must be {label, value, low, high}`);
    }
    const s = raw as Record<string, unknown>;
    str(s.label, `scales[${k}].label`);
    str(s.low, `scales[${k}].low`);
    str(s.high, `scales[${k}].high`);
    if (num(s.value, `scales[${k}].value`, 0, 1) === undefined) {
      refuse(`scales[${k}].value is a number from 0 to 1`);
    }
  });
  num(spec.share, "share", 0, 1);
  str(spec.shareLabel, "shareLabel");
  num(spec.columns, "columns", 1, 3);
  oneOf(spec.size, "size", ["s", "m", "l"] as const);
};

const drawProfile = (
  spec: Record<string, unknown>,
  ctx: DrawContext,
): Drawing => {
  const paint = ctx.paint(spec.color as string | undefined, "violet");
  const columns = (spec.columns as number | undefined) ?? 1;
  const width =
    { s: 300, m: 380, l: 460 }[
      (spec.size as "s" | "m" | "l" | undefined) ?? "m"
    ] * (columns > 1 ? 1.6 : 1);
  const PAD = 18;
  const inner = width - PAD * 2;
  const items: Item[] = [];
  // header: avatar, name, subtitle on the profile's colour
  const name = spec.name as string;
  const subtitle = spec.subtitle as string | undefined;
  const AV = 64;
  const nameText = wrap(name, inner - AV - 16, 22, ctx.measure);
  const nm = ctx.measure(nameText, 22);
  const sm = subtitle
    ? ctx.measure(wrap(subtitle, inner - AV - 16, 14, ctx.measure), 14)
    : { width: 0, height: 0 };
  const headH =
    Math.max(AV, nm.height + (subtitle ? sm.height + 4 : 0)) + PAD * 2;
  items.push({
    kind: "rect",
    key: "head",
    x: 0,
    y: 0,
    w: width,
    h: headH,
    stroke: "transparent",
    fill: paint.fill,
    rounded: true,
  });
  // square off the header's bottom corners
  items.push({
    kind: "rect",
    key: "head2",
    x: 0,
    y: headH / 2,
    w: width,
    h: headH / 2,
    stroke: "transparent",
    fill: paint.fill,
  });
  const initials =
    (spec.avatar as string | undefined) ??
    [...name.trim()]
      .filter((c) => c !== " ")
      .slice(0, 2)
      .join("");
  items.push({
    kind: "ellipse",
    key: "avatar",
    x: PAD,
    y: (headH - AV) / 2,
    w: AV,
    h: AV,
    stroke: paint.stroke,
    fill: "#ffffff",
    strokeWidth: 2,
    label: { text: initials, size: 20, color: paint.stroke },
  });
  let ty = (headH - (nm.height + (subtitle ? sm.height + 4 : 0))) / 2;
  items.push({
    kind: "text",
    key: "name",
    x: PAD + AV + 16,
    y: ty,
    text: nameText,
    size: 22,
    color: INK,
  });
  ty += nm.height + 4;
  if (subtitle) {
    items.push({
      kind: "text",
      key: "sub",
      x: PAD + AV + 16,
      y: ty,
      text: wrap(subtitle, inner - AV - 16, 14, ctx.measure),
      size: 14,
      color: paint.stroke,
    });
  }
  let y = headH + 14;
  if (spec.quote) {
    const q = wrap(`“${spec.quote as string}”`, inner, 16, ctx.measure);
    items.push({
      kind: "text",
      key: "quote",
      x: PAD,
      y,
      text: q,
      size: 16,
      color: MUTED,
    });
    y += ctx.measure(q, 16).height + 14;
  }
  const tags = (spec.tags as string[] | undefined) ?? [];
  if (tags.length) {
    let tx = PAD;
    tags.forEach((tag, k) => {
      const m = ctx.measure(tag, 13);
      if (tx + m.width + 20 > width - PAD) {
        tx = PAD;
        y += 32;
      }
      items.push({
        kind: "rect",
        key: `tag${k}`,
        x: tx,
        y,
        w: m.width + 20,
        h: 26,
        stroke: paint.stroke,
        fill: paint.fill,
        strokeWidth: 1,
        rounded: true,
        label: { text: tag, size: 13 },
      });
      tx += m.width + 28;
    });
    y += 40;
  }
  // sections in one or more columns
  const sections = sectionsOf(spec.sections, "sections");
  const colW = (inner - (columns - 1) * 16) / columns;
  const colY = new Array(columns).fill(y);
  sections.forEach((s, k) => {
    const c = colY.indexOf(Math.min(...colY));
    const x = PAD + c * (colW + 16);
    let cy = colY[c];
    items.push({
      kind: "text",
      key: `s${k}`,
      x,
      y: cy,
      text: wrap(s.title, colW, 16, ctx.measure),
      size: 16,
      color: paint.stroke,
    });
    cy += ctx.measure(s.title, 16).height + 6;
    const body = [
      ...(s.text ? [wrap(s.text, colW, 14, ctx.measure)] : []),
      ...(s.items ?? []).map((i) => wrap(`• ${i}`, colW, 14, ctx.measure)),
    ].join("\n");
    if (body) {
      items.push({
        kind: "text",
        key: `s${k}-b`,
        x,
        y: cy,
        text: body,
        size: 14,
        color: INK,
      });
      cy += ctx.measure(body, 14).height;
    }
    colY[c] = cy + 16;
  });
  y = Math.max(...colY);
  // traits on scales between two poles
  const scales = (spec.scales as Record<string, unknown>[] | undefined) ?? [];
  scales.forEach((s, k) => {
    if (s.label) {
      items.push({
        kind: "text",
        key: `sc${k}`,
        x: PAD,
        y,
        text: s.label as string,
        size: 14,
        color: INK,
      });
      y += ctx.measure(s.label as string, 14).height + 4;
    }
    const lo = (s.low as string | undefined) ?? "";
    const hi = (s.high as string | undefined) ?? "";
    const lw = lo ? ctx.measure(lo, 12).width + 8 : 0;
    const hw = hi ? ctx.measure(hi, 12).width + 8 : 0;
    const bx = PAD + lw;
    const bw = inner - lw - hw;
    if (lo) {
      items.push({
        kind: "text",
        key: `sc${k}-l`,
        x: PAD,
        y,
        text: lo,
        size: 12,
        color: MUTED,
      });
    }
    if (hi) {
      items.push({
        kind: "text",
        key: `sc${k}-h`,
        x: PAD + inner - hw + 8,
        y,
        text: hi,
        size: 12,
        color: MUTED,
      });
    }
    items.push(
      {
        kind: "rect",
        key: `sc${k}-bar`,
        x: bx,
        y: y + 4,
        w: bw,
        h: 8,
        stroke: "transparent",
        fill: "#e9ecef",
        rounded: true,
      },
      {
        kind: "ellipse",
        key: `sc${k}-dot`,
        x: bx + bw * (s.value as number) - 8,
        y,
        w: 16,
        h: 16,
        stroke: paint.stroke,
        fill: paint.stroke,
      },
    );
    y += 28;
  });
  if (spec.share !== undefined) {
    const share = spec.share as number;
    const label =
      (spec.shareLabel as string | undefined) ?? `${Math.round(share * 100)}%`;
    items.push(
      {
        kind: "rect",
        key: "share-bar",
        x: PAD,
        y,
        w: inner,
        h: 14,
        stroke: "transparent",
        fill: "#e9ecef",
        rounded: true,
      },
      {
        kind: "rect",
        key: "share-v",
        x: PAD,
        y,
        w: Math.max(8, inner * share),
        h: 14,
        stroke: paint.stroke,
        fill: paint.stroke,
        rounded: true,
      },
      {
        kind: "text",
        key: "share-t",
        x: PAD,
        y: y + 18,
        text: label,
        size: 13,
        color: MUTED,
      },
    );
    y += 44;
  }
  const height = y + 4;
  return {
    width,
    height,
    // the card's white ground under everything, its outline over the header
    items: [
      box(width, height),
      {
        kind: "rect",
        key: "ground",
        x: 0,
        y: 0,
        w: width,
        h: height,
        stroke: "transparent",
        fill: "#ffffff",
        rounded: true,
      },
      ...items,
      {
        kind: "rect",
        key: "card",
        x: 0,
        y: 0,
        w: width,
        h: height,
        stroke: paint.stroke,
        fill: "transparent",
        strokeWidth: 2,
        rounded: true,
      },
    ],
  };
};

// ------------------------------------------------------------------ radar

const validateRadar = (spec: Record<string, unknown>) => {
  str(spec.title, "title");
  const axes = list(spec.axes, "axes", 12);
  if (axes.length < 3) {
    refuse("a radar chart needs at least 3 `axes`");
  }
  axes.forEach((a, k) => str(a, `axes[${k}]`, true));
  const max = num(spec.max, "max", 1, 100) ?? 5;
  const series = list(spec.series, "series", 8);
  if (!series.length) {
    refuse("a radar chart needs `series`: [{label, values}]");
  }
  series.forEach((raw, k) => {
    if (!isObject(raw)) {
      refuse(`series[${k}] must be {label, values, color}`);
    }
    const s = raw as Record<string, unknown>;
    str(s.label, `series[${k}].label`, true);
    str(s.color, `series[${k}].color`);
    const values = list(s.values, `series[${k}].values`, 12);
    if (values.length !== axes.length) {
      refuse(
        `series[${k}].values has ${values.length} values for ${axes.length} axes`,
      );
    }
    values.forEach((v, j) => {
      if (num(v, `series[${k}].values[${j}]`, 0, max) === undefined) {
        refuse(`series[${k}].values[${j}] is a number from 0 to ${max}`);
      }
    });
  });
};

const SERIES_COLORS = [
  "violet",
  "blue",
  "orange",
  "green",
  "red",
  "teal",
  "pink",
  "yellow",
];

const drawRadar = (
  spec: Record<string, unknown>,
  ctx: DrawContext,
): Drawing => {
  const axes = spec.axes as string[];
  const max = (spec.max as number | undefined) ?? 5;
  const series = spec.series as Record<string, unknown>[];
  const title = titleItems(spec.title as string | undefined, ctx);
  const R = 170;
  const labelW = Math.max(...axes.map((a) => ctx.measure(a, 14).width)) + 12;
  const cx = labelW + R;
  const cy = title.height + 30 + R;
  const items: Item[] = [...title.items];
  const at = (j: number, r: number): [number, number] => {
    const t = -Math.PI / 2 + (j * Math.PI * 2) / axes.length;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  };
  for (let level = 1; level <= max; level++) {
    const r = (R * level) / max;
    items.push({
      kind: "line",
      key: `ring${level}`,
      points: [...axes.map((_, j) => at(j, r)), at(0, r)],
      stroke: "#dee2e6",
      strokeWidth: 1,
    });
  }
  axes.forEach((axis, j) => {
    items.push({
      kind: "line",
      key: `spoke${j}`,
      points: [[cx, cy], at(j, R)],
      stroke: "#dee2e6",
      strokeWidth: 1,
    });
    const [lx, ly] = at(j, R + 14);
    const m = ctx.measure(axis, 14);
    const x =
      Math.abs(lx - cx) < 4 ? lx - m.width / 2 : lx < cx ? lx - m.width : lx;
    const y =
      Math.abs(ly - cy) < 4 ? ly - m.height / 2 : ly < cy ? ly - m.height : ly;
    items.push({
      kind: "text",
      key: `axis${j}`,
      x,
      y,
      text: axis,
      size: 14,
      color: INK,
    });
  });
  series.forEach((s, k) => {
    const paint = ctx.paint(
      (s.color as string | undefined) ??
        SERIES_COLORS[k % SERIES_COLORS.length],
      "blue",
    );
    const points = (s.values as number[]).map((v, j) => at(j, (R * v) / max));
    items.push(
      {
        kind: "line",
        key: `area${k}`,
        points: [...points, points[0]],
        stroke: "transparent",
        closed: true,
        fill: paint.stroke,
        opacity: 18,
      },
      {
        kind: "line",
        key: `edge${k}`,
        points: [...points, points[0]],
        stroke: paint.stroke,
        strokeWidth: 2,
      },
    );
    points.forEach(([x, y], j) =>
      items.push({
        kind: "ellipse",
        key: `pt${k}-${j}`,
        x: x - 4,
        y: y - 4,
        w: 8,
        h: 8,
        stroke: paint.stroke,
        fill: paint.stroke,
      }),
    );
  });
  // the legend under the chart
  let lx = cx - R;
  let ly = cy + R + 40;
  series.forEach((s, k) => {
    const paint = ctx.paint(
      (s.color as string | undefined) ??
        SERIES_COLORS[k % SERIES_COLORS.length],
      "blue",
    );
    const m = ctx.measure(s.label as string, 14);
    if (lx + m.width + 24 > cx + R + labelW) {
      lx = cx - R;
      ly += 24;
    }
    items.push(
      {
        kind: "rect",
        key: `lg${k}`,
        x: lx,
        y: ly + 2,
        w: 14,
        h: 14,
        stroke: paint.stroke,
        fill: paint.stroke,
      },
      {
        kind: "text",
        key: `lg${k}-t`,
        x: lx + 20,
        y: ly,
        text: s.label as string,
        size: 14,
        color: INK,
      },
    );
    lx += m.width + 44;
  });
  const width = Math.max(cx + R + labelW, title.width);
  const height = ly + 28;
  return { width, height, items: [box(width, height), ...items] };
};

// ----------------------------------------------------------------- legend

const LEGEND_SHAPES = [
  "rect",
  "ellipse",
  "line",
  "dashed",
  "arrow",
  "sticky",
] as const;

const validateLegend = (spec: Record<string, unknown>) => {
  str(spec.title, "title");
  const entries = list(spec.items, "items", 20);
  if (!entries.length) {
    refuse("a legend needs `items`: [{label, color}]");
  }
  entries.forEach((raw, k) => {
    if (!isObject(raw)) {
      refuse(`items[${k}] must be {label, color, shape}`);
    }
    str((raw as Record<string, unknown>).label, `items[${k}].label`, true);
    str((raw as Record<string, unknown>).color, `items[${k}].color`);
    oneOf(
      (raw as Record<string, unknown>).shape,
      `items[${k}].shape`,
      LEGEND_SHAPES,
    );
  });
};

const drawLegend = (
  spec: Record<string, unknown>,
  ctx: DrawContext,
): Drawing => {
  const items: Item[] = [];
  const PAD = 14;
  let y = PAD;
  let width = 0;
  if (spec.title) {
    items.push({
      kind: "text",
      key: "title",
      x: PAD,
      y,
      text: spec.title as string,
      size: 16,
      color: INK,
    });
    const m = ctx.measure(spec.title as string, 16);
    y += m.height + 10;
    width = m.width;
  }
  (spec.items as Record<string, unknown>[]).forEach((e, k) => {
    const paint = ctx.paint(e.color as string | undefined, "gray");
    const shape = (e.shape as string | undefined) ?? "rect";
    const sw = 28;
    if (shape === "line" || shape === "dashed" || shape === "arrow") {
      items.push({
        kind: shape === "arrow" ? "arrow" : "line",
        key: `k${k}`,
        points: [
          [PAD, y + 10],
          [PAD + sw, y + 10],
        ],
        stroke: paint.stroke,
        strokeWidth: 2,
        line: shape === "dashed" ? "dashed" : "solid",
        head: shape === "arrow" ? "arrow" : "none",
      });
    } else {
      items.push({
        kind: shape === "ellipse" ? "ellipse" : "rect",
        key: `k${k}`,
        x: PAD,
        y: y + 2,
        w: sw,
        h: 18,
        stroke: paint.stroke,
        fill: shape === "sticky" ? "#fff3bf" : paint.fill,
        strokeWidth: 2,
        rounded: shape !== "ellipse",
      });
    }
    const m = ctx.measure(e.label as string, 14);
    items.push({
      kind: "text",
      key: `k${k}-t`,
      x: PAD + sw + 10,
      y: y + (22 - m.height) / 2,
      text: e.label as string,
      size: 14,
      color: INK,
    });
    width = Math.max(width, sw + 10 + m.width);
    y += 28;
  });
  width += PAD * 2;
  const height = y + PAD - 6;
  return {
    width,
    height,
    items: [
      box(width, height),
      {
        kind: "rect",
        key: "frame",
        x: 0,
        y: 0,
        w: width,
        h: height,
        stroke: RULE,
        fill: "#ffffff",
        strokeWidth: 1,
        rounded: true,
      },
      ...items,
    ],
  };
};

// ---------------------------------------------------------------- journey

const validateJourney = (spec: Record<string, unknown>) => {
  str(spec.title, "title");
  str(spec.persona, "persona");
  const stages = list(spec.stages, "stages", 10);
  if (stages.length < 2) {
    refuse("a journey needs at least 2 `stages`");
  }
  stages.forEach((s, k) => str(s, `stages[${k}]`, true));
  list(spec.rows ?? [], "rows", 8).forEach((raw, k) => {
    if (!isObject(raw)) {
      refuse(`rows[${k}] must be {label, cells}`);
    }
    const r = raw as Record<string, unknown>;
    str(r.label, `rows[${k}].label`, true);
    const cells = list(r.cells, `rows[${k}].cells`, 10);
    if (cells.length > stages.length) {
      refuse(`rows[${k}].cells has more cells than there are stages`);
    }
    cells.forEach((c, j) => str(c, `rows[${k}].cells[${j}]`));
  });
  if (spec.emotions !== undefined) {
    const e = list(spec.emotions, "emotions", 10);
    if (e.length !== stages.length) {
      refuse("`emotions` has one score per stage, from -2 to 2");
    }
    e.forEach((v, j) => {
      if (num(v, `emotions[${j}]`, -2, 2) === undefined) {
        refuse(`emotions[${j}] is a number from -2 to 2`);
      }
    });
  }
  str(spec.color, "color");
};

const FACES = ["😞", "🙁", "😐", "🙂", "😀"];

const drawJourney = (
  spec: Record<string, unknown>,
  ctx: DrawContext,
): Drawing => {
  const stages = spec.stages as string[];
  const rows = (spec.rows as Record<string, unknown>[] | undefined) ?? [];
  const emotions = spec.emotions as number[] | undefined;
  const paint = ctx.paint(spec.color as string | undefined, "blue");
  const title = titleItems(
    [spec.title, spec.persona && `— ${spec.persona as string}`]
      .filter(Boolean)
      .join(" ") || undefined,
    ctx,
  );
  const labelW = Math.max(
    110,
    ...rows.map((r) => ctx.measure(r.label as string, 15).width + 24),
    emotions
      ? ctx.measure((spec.emotionLabel as string | undefined) ?? "Emotion", 15)
          .width + 24
      : 0,
  );
  const colW = 200;
  const PAD = 10;
  const top = title.height;
  const items: Item[] = [...title.items];
  // stage headers as arrows' chevrons
  const headH = 44;
  stages.forEach((stage, j) => {
    items.push({
      kind: "rect",
      key: `st${j}`,
      x: labelW + j * colW + 4,
      y: top,
      w: colW - 8,
      h: headH,
      stroke: paint.stroke,
      fill: paint.fill,
      strokeWidth: 2,
      rounded: true,
      label: { text: wrap(stage, colW - 24, 16, ctx.measure), size: 16 },
    });
  });
  let y = top + headH + 10;
  rows.forEach((row, k) => {
    const cells = (row.cells as (string | undefined)[]).map((c) =>
      wrap(c ?? "", colW - PAD * 2, 14, ctx.measure),
    );
    const h = Math.max(
      48,
      ...cells.map((c) => ctx.measure(c || " ", 14).height + PAD * 2),
    );
    items.push(
      {
        kind: "rect",
        key: `r${k}`,
        x: 0,
        y,
        w: labelW + stages.length * colW,
        h,
        stroke: "transparent",
        fill: k % 2 ? "#ffffff" : "#f8f9fa",
      },
      {
        kind: "text",
        key: `r${k}-l`,
        x: 10,
        y: y + PAD,
        text: row.label as string,
        size: 15,
        color: paint.stroke,
      },
    );
    cells.forEach((c, j) => {
      if (c.trim()) {
        items.push({
          kind: "text",
          key: `r${k}-${j}`,
          x: labelW + j * colW + PAD,
          y: y + PAD,
          text: c,
          size: 14,
          color: INK,
        });
      }
    });
    y += h;
  });
  if (emotions) {
    // the emotion curve: higher is better
    const H = 140;
    const label = (spec.emotionLabel as string | undefined) ?? "Emotion";
    items.push(
      {
        kind: "rect",
        key: "em",
        x: 0,
        y,
        w: labelW + stages.length * colW,
        h: H,
        stroke: "transparent",
        fill: rows.length % 2 ? "#ffffff" : "#f8f9fa",
      },
      {
        kind: "text",
        key: "em-l",
        x: 10,
        y: y + PAD,
        text: label,
        size: 15,
        color: paint.stroke,
      },
      {
        kind: "line",
        key: "em-0",
        points: [
          [labelW, y + H / 2],
          [labelW + stages.length * colW, y + H / 2],
        ],
        stroke: "#dee2e6",
        line: "dashed",
        strokeWidth: 1,
      },
    );
    const pts = emotions.map(
      (e, j) =>
        [labelW + j * colW + colW / 2, y + H / 2 - (e / 2) * (H / 2 - 22)] as [
          number,
          number,
        ],
    );
    items.push({
      kind: "line",
      key: "em-c",
      points: pts,
      stroke: paint.stroke,
      strokeWidth: 3,
    });
    pts.forEach(([px, py], j) => {
      const face = FACES[Math.round(emotions[j]) + 2];
      const m = ctx.measure(face, 22);
      items.push({
        kind: "text",
        key: `em-f${j}`,
        x: px - m.width / 2,
        y: py - m.height / 2,
        text: face,
        size: 22,
        color: INK,
      });
    });
    y += H;
  }
  const width = Math.max(labelW + stages.length * colW, title.width);
  return { width, height: y, items: [box(width, y), ...items] };
};

// ------------------------------------------------------------------ image

/** The kinds of picture a scene may hold, as data URLs. */
const IMAGE_URL =
  /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
export const MAX_IMAGE_URL = 900_000;

const validateImage = (spec: Record<string, unknown>) => {
  str(spec.label, "label");
  num(spec.width, "width", 40, 1600);
  if (spec.src !== undefined) {
    const src = str(spec.src, "src", true)!;
    if (src.length > MAX_IMAGE_URL) {
      refuse(
        `src is ${src.length} characters; an image is at most ${MAX_IMAGE_URL} (about 650 KB)`,
      );
    }
    if (!IMAGE_URL.test(src)) {
      refuse(
        "src must be a base64 data URL of a png, jpeg, webp, gif or svg image (cerebrate canvas and gexcal turn a file path into one)",
      );
    }
  } else if (typeof spec.fileId !== "string") {
    refuse("a new image needs `src`");
  }
};

const drawImage = (
  spec: Record<string, unknown>,
  ctx: DrawContext,
): Drawing => {
  const aspect = (spec.aspect as number | undefined) ?? 0.75;
  const width =
    (spec.width as number | undefined) ??
    Math.min(480, (spec.naturalWidth as number | undefined) ?? 480);
  const h = Math.round(width * aspect);
  const items: Item[] = [
    {
      kind: "image",
      key: "img",
      x: 0,
      y: 0,
      w: width,
      h,
      fileId: spec.fileId as string,
    },
  ];
  let height = h;
  if (spec.label) {
    const t = wrap(spec.label as string, width, 14, ctx.measure);
    const m = ctx.measure(t, 14);
    items.push({
      kind: "text",
      key: "cap",
      x: (width - m.width) / 2,
      y: h + 8,
      text: t,
      size: 14,
      color: MUTED,
      align: "center",
    });
    height += 8 + m.height;
  }
  return { width, height, items: [box(width, height), ...items] };
};

// --------------------------------------------------------------- registry

const BLOCKS: Record<
  BlockType,
  {
    validate: (spec: Record<string, unknown>) => void;
    draw: (spec: Record<string, unknown>, ctx: DrawContext) => Drawing;
  }
> = {
  table: { validate: validateTable, draw: drawTable },
  quadrant: { validate: validateQuadrant, draw: drawQuadrant },
  sequence: { validate: validateSequence, draw: drawSequence },
  timeline: { validate: validateTimeline, draw: drawTimeline },
  wireframe: { validate: validateWireframe, draw: drawWireframe },
  sketch: { validate: validateSketch, draw: drawSketch },
  profile: { validate: validateProfile, draw: drawProfile },
  radar: { validate: validateRadar, draw: drawRadar },
  legend: { validate: validateLegend, draw: drawLegend },
  journey: { validate: validateJourney, draw: drawJourney },
  image: { validate: validateImage, draw: drawImage },
};

export const BLOCK_TYPES = Object.keys(BLOCKS) as BlockType[];

/** Throws a BlockError naming the field when `spec` cannot be drawn. */
export const validateBlock = (type: BlockType, spec: Record<string, unknown>) =>
  BLOCKS[type].validate(spec);

export const drawBlock = (
  type: BlockType,
  spec: Record<string, unknown>,
  ctx: DrawContext,
): Drawing => {
  const drawing = BLOCKS[type].draw(spec, ctx);
  return {
    ...drawing,
    width: Math.ceil(drawing.width),
    height: Math.ceil(drawing.height),
  };
};

/** Every text a block shows, so the fonts it needs load before measuring. */
export const blockTexts = (spec: unknown): string[] => {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      out.push(v);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (isObject(v)) {
      Object.values(v).forEach(walk);
    }
  };
  walk(spec);
  return out;
};

/** One line saying what a block holds, for describe. */
export const summarizeBlock = (
  type: BlockType,
  spec: Record<string, unknown>,
) => {
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  switch (type) {
    case "table":
      return `table ${count(spec.rows)} rows${
        spec.columns ? ` x ${count(spec.columns)} columns` : ""
      }`;
    case "quadrant":
      return `quadrant with ${count(spec.items)} items`;
    case "sequence":
      return `sequence: ${count(spec.participants)} participants, ${count(
        spec.items,
      )} steps`;
    case "timeline":
      return `timeline with ${count(spec.tasks)} tasks`;
    case "wireframe":
      return `wireframe (${
        (spec.device as string | undefined) ?? "mobile"
      }) with ${count(spec.items)} widgets`;
    case "sketch":
      return `sketch of ${count(spec.elements)} elements`;
    case "profile":
      return `profile of ${String(spec.name)}`;
    case "radar":
      return `radar chart: ${count(spec.axes)} axes, ${count(
        spec.series,
      )} series`;
    case "legend":
      return `legend of ${count(spec.items)} entries`;
    case "journey":
      return `journey map: ${count(spec.stages)} stages, ${count(
        spec.rows,
      )} rows`;
    case "image":
      return `image${spec.label ? ` "${String(spec.label)}"` : ""}`;
  }
};
