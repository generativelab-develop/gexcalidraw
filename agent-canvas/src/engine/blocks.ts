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
export type Item = ShapeItem | TextItem | LineItem | FrameItem;

export type Drawing = { width: number; height: number; items: Item[] };

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

const isLine = (item: Item): item is LineItem =>
  item.kind === "line" || item.kind === "arrow";

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
type Step =
  | {
      type: "message";
      from: string;
      to: string;
      label?: string;
      line?: LineStyle;
      head?: Head;
    }
  | { type: "note"; text: string; over: string[]; color?: string }
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
        `${at} must be a message {from, to, label}, a note {note, over} or a fragment {fragment, items}`,
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
    return {
      type: "message" as const,
      from: known(raw.from, "from"),
      to: known(raw.to, "to"),
      label: str(raw.label, `${at}.label`),
      line: oneOf(raw.line, `${at}.line`, LINES),
      head:
        raw.head === undefined
          ? undefined
          : (str(raw.head, `${at}.head`) as Head),
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

  const boxW = participants.map((p) =>
    Math.max(120, ctx.measure(p.label, 18).width + 40),
  );
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
  const walk = (steps_: Step[], visit: (s: Step) => void) => {
    for (const s of steps_) {
      visit(s);
      if (s.type === "fragment") {
        walk(s.items, visit);
        s.branches.forEach((b) => walk(b.items, visit));
      }
    }
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
    const w = ctx.measure(texts.get(s) || " ", LABEL).width + 40;
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
  participants.forEach((p, k) => {
    const paint = ctx.paint(
      p.color ??
        (p.kind === "actor" || p.kind === "user" ? "violet" : undefined),
      "blue",
    );
    items.push({
      kind: p.kind === "actor" || p.kind === "user" ? "ellipse" : "rect",
      key: `p${k}`,
      x: centers[k] - boxW[k] / 2,
      y: top,
      w: boxW[k],
      h: BOX_H,
      stroke: paint.stroke,
      fill: paint.fill,
      strokeWidth: 2,
      rounded: true,
      label: { text: p.label, size: 18 },
    });
  });

  let y = top + BOX_H + 28;
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
  let seq = 0;
  const draw = (steps_: Step[]) => {
    for (const s of steps_) {
      const key = `s${seq++}`;
      if (s.type === "message") {
        const a = index.get(s.from)!;
        const b = index.get(s.to)!;
        const text = texts.get(s) ?? "";
        const m = ctx.measure(text || " ", LABEL);
        const dashed = s.line ?? "solid";
        if (a === b) {
          const x0 = centers[a];
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
            line: dashed,
            strokeWidth: 2,
            head: s.head ?? "arrow",
          });
          y = y0 + 26 + 22;
          continue;
        }
        const x1 = centers[a];
        const x2 = centers[b];
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
        const ay = y + (text ? m.height + 6 : 0);
        items.push({
          kind: "arrow",
          key,
          points: [
            [x1, ay],
            [x2, ay],
          ],
          stroke: INK,
          line: dashed,
          strokeWidth: 2,
          head: s.head ?? "arrow",
        });
        y = ay + 22;
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
        const head = [tag, s.label ? `[${s.label}]` : ""]
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
        if (head) {
          items.push({
            kind: "text",
            key: `${key}-h`,
            x: x0 + 8,
            y: y0 + 6,
            text: head,
            size: 14,
            color: MUTED,
          });
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
  participants.forEach((_, k) =>
    items.push({
      kind: "line",
      key: `l${k}`,
      points: [
        [centers[k], top + BOX_H],
        [centers[k], bottom],
      ],
      stroke: RULE,
      line: "dashed",
      strokeWidth: 1,
    }),
  );
  // lifelines go under the messages
  items.sort(
    (a, b) => Number(b.key.startsWith("l")) - Number(a.key.startsWith("l")),
  );
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

type Task = {
  label: string;
  start: number;
  end: number;
  section?: string;
  color?: string;
  done: boolean;
  progress?: number;
  milestone: boolean;
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
    if (start === undefined && t.after !== undefined) {
      const after = str(t.after, `${at}.after`, true)!;
      const before = byId.get(after);
      if (!before) {
        refuse(`${at}.after "${after}" is not an earlier task's id`);
      }
      start = before!.end;
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
    const task: Task = {
      label: str(t.label, `${at}.label`, true)!,
      start: start!,
      end: milestone ? start! : end,
      section: str(t.section, `${at}.section`),
      color: str(t.color, `${at}.color`),
      done: t.done === true,
      progress: num(t.progress, `${at}.progress`, 0, 1),
      milestone,
    };
    if (t.id !== undefined) {
      byId.set(str(t.id, `${at}.id`, true)!, task);
    }
    tasks.push(task);
  });
  if (kinds.size > 1) {
    refuse("tasks mix dates and plain numbers; use one or the other");
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

  for (const [k, tick] of ticks.entries()) {
    const tx = x(tick.at);
    if (tx < labelW - 0.5 || tx > labelW + chartW + 0.5) {
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
    const paint = t.done
      ? { stroke: RULE, fill: "#dee2e6" }
      : ctx.paint(color, "blue");
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
        t.progress !== undefined ? paint.fill : t.done ? RULE : paint.stroke,
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
  const width = Math.max(labelW + chartW + 20, title.width);
  const height = bodyTop + bodyH + (today !== undefined ? 26 : 8);
  return { width, height, items: [box(width, height), ...items] };
};

// -------------------------------------------------------------- wireframe

const WIDGETS = [
  "header",
  "title",
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
  "progress",
  "link",
  "table",
  "row",
] as const;
type Widget = { type: typeof WIDGETS[number] } & Record<string, unknown>;

const DEVICES = {
  mobile: { width: 390, minHeight: 700 },
  tablet: { width: 768, minHeight: 760 },
  desktop: { width: 1200, minHeight: 640 },
  browser: { width: 1200, minHeight: 640 },
} as const;

const widgetsOf = (v: unknown, where: string, depth = 0): Widget[] => {
  if (depth > 3) {
    return refuse(`${where}: rows nest at most 3 deep`);
  }
  return list(v, where, 80).map((raw, k) => {
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
    if (raw.items !== undefined) {
      if (type === "row") {
        widgetsOf(raw.items, `${at}.items`, depth + 1);
      } else {
        list(raw.items, `${at}.items`, 40).forEach((item, j) => {
          if (type === "table") {
            list(item, `${at}.items[${j}]`, 12).forEach((c, i) =>
              str(c, `${at}.items[${j}][${i}]`),
            );
          } else {
            str(item, `${at}.items[${j}]`);
          }
        });
      }
    } else if (type === "row") {
      refuse(`${at}: a row needs \`items\` (widgets side by side)`);
    }
    num(raw.value, `${at}.value`, 0, 1);
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
  widgetsOf(spec.items, "items");
};

const drawWidget = (
  w: Widget,
  x: number,
  y: number,
  width: number,
  key: string,
  ctx: DrawContext,
): { items: Item[]; height: number } => {
  const label = (w.label as string | undefined) ?? "";
  const text = (w.text as string | undefined) ?? "";
  const items: Item[] = [];
  const LINE = "#495057";
  const FILL = "#e9ecef";
  const primary = ctx.paint("blue", "blue");
  const textAt = (
    t: string,
    tx: number,
    ty: number,
    size = BODY,
    color = INK,
    k = "t",
  ): number => {
    const wrapped = wrap(t, Math.max(40, width - (tx - x)), size, ctx.measure);
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
        fill: FILL,
        strokeWidth: 1,
      });
      const m = ctx.measure(label || " ", 20);
      items.push({
        kind: "text",
        key: `${key}-t`,
        x: x + 16,
        y: y + (h - m.height) / 2,
        text: label,
        size: 20,
        color: INK,
      });
      const menu = (w.items as string[] | undefined) ?? [];
      let rx = x + width - 16;
      [...menu].reverse().forEach((item, j) => {
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
    case "title":
      return { items, height: textAt(label || text, x, y, 28) };
    case "text":
      return { items, height: textAt(text || label, x, y, BODY, LINE) };
    case "link":
      return {
        items,
        height: textAt(label || text, x, y, BODY, primary.stroke),
      };
    case "button": {
      const h = 46;
      const filled = w.primary !== false && w.style !== "secondary";
      items.push({
        kind: "rect",
        key,
        x,
        y,
        w: width,
        h,
        stroke: filled ? primary.stroke : LINE,
        fill: filled ? primary.stroke : "#ffffff",
        strokeWidth: 2,
        rounded: true,
        label: {
          text: label || "Button",
          size: 18,
          color: filled ? "#ffffff" : INK,
        },
      });
      return { items, height: h };
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
          color: MUTED,
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
      items.push({
        kind: "text",
        key: `${key}-t`,
        x: x + (w.type === "toggle" ? 52 : 30),
        y: y + (h - m.height) / 2,
        text: label,
        size: BODY,
        color: INK,
      });
      return { items, height: h };
    }
    case "image": {
      const h = w.height === "s" ? 100 : w.height === "l" ? 280 : 180;
      items.push(
        {
          kind: "rect",
          key,
          x,
          y,
          w: width,
          h,
          stroke: LINE,
          fill: FILL,
          strokeWidth: 1,
        },
        {
          kind: "line",
          key: `${key}-a`,
          points: [
            [x, y],
            [x + width, y + h],
          ],
          stroke: RULE,
          strokeWidth: 1,
        },
        {
          kind: "line",
          key: `${key}-b`,
          points: [
            [x + width, y],
            [x, y + h],
          ],
          stroke: RULE,
          strokeWidth: 1,
        },
      );
      if (label) {
        const m = ctx.measure(label, 14);
        items.push({
          kind: "rect",
          key: `${key}-c`,
          x: x + (width - m.width) / 2 - 8,
          y: y + (h - m.height) / 2 - 4,
          w: m.width + 16,
          h: m.height + 8,
          stroke: "transparent",
          fill: FILL,
        });
        items.push({
          kind: "text",
          key: `${key}-t`,
          x: x + (width - m.width) / 2,
          y: y + (h - m.height) / 2,
          text: label,
          size: 14,
          color: LINE,
        });
      }
      return { items, height: h };
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
    case "card": {
      const inner: Item[] = [];
      let cy = y + 14;
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
      const h = Math.max(70, cy - y + 14);
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
          color: MUTED,
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
            key: `${key}-${j}`,
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
        const m = ctx.measure(tab, w.type === "tabbar" ? 14 : BODY);
        items.push({
          kind: "text",
          key: `${key}-${j}`,
          x: x + each * j + (each - m.width) / 2,
          y: y + (h - m.height) / 2,
          text: tab,
          size: w.type === "tabbar" ? 14 : BODY,
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
          stroke: primary.stroke,
          fill: primary.stroke,
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
    case "row": {
      const children = w.items as Widget[];
      const GAPX = 12;
      const each =
        (width - GAPX * (children.length - 1)) / Math.max(1, children.length);
      let h = 0;
      children.forEach((child, j) => {
        const drawn = drawWidget(
          child,
          x + j * (each + GAPX),
          y,
          each,
          `${key}-${j}`,
          ctx,
        );
        items.push(...drawn.items);
        h = Math.max(h, drawn.height);
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
  const device =
    DEVICES[(spec.device as keyof typeof DEVICES | undefined) ?? "mobile"];
  const widgets = widgetsOf(spec.items, "items");
  const PAD = 20;
  const GAP = 14;
  const width = device.width;
  const items: Item[] = [];
  let y = 0;
  if (spec.device === "browser") {
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
  const bottom: Widget[] = [];
  let padded = false;
  widgets.forEach((w, k) => {
    if (w.type === "tabbar") {
      bottom.push(w);
      return;
    }
    if (w.type === "header") {
      const drawn = drawWidget(w, 0, y, width, `w${k}`, ctx);
      items.push(...drawn.items);
      y += drawn.height;
      padded = false;
      return;
    }
    if (!padded) {
      y += PAD;
      padded = true;
    }
    const drawn = drawWidget(w, PAD, y, width - PAD * 2, `w${k}`, ctx);
    items.push(...drawn.items);
    y += drawn.height + GAP;
  });
  const tabH = bottom.length ? 60 : 0;
  const height = Math.max(device.minHeight, y - GAP + PAD + tabH);
  bottom.forEach((w, k) => {
    const drawn = drawWidget(w, 0, height - tabH, width, `b${k}`, ctx);
    items.push(...drawn.items);
  });
  const name = (spec.label as string | undefined) ?? "";
  return {
    width,
    height,
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
  "text",
] as const;
const SIZES: Record<string, number> = { s: 14, m: 20, l: 28, xl: 40 };

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
    if (type === "line" || type === "arrow") {
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
    } else if (type !== "line" && type !== "arrow") {
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
    width: Math.ceil(drawing.width),
    height: Math.ceil(drawing.height),
    items: drawing.items,
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
  }
};
