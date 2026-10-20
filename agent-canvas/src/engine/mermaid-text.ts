// Mermaid diagrams other than flowcharts, read from their text. Mermaid's
// own parser renders an SVG to find positions; what an agent wants is the
// meaning (who sends what to whom, which class extends which), so these small
// readers take the common syntax line by line and produce gexcal ops: cards
// and edges for class, ER and state diagrams, a radial tree for a mind map,
// and one block for a sequence diagram, a gantt chart or a quadrant chart. The
// result is ordinary ops, editable one id at a time afterwards.

import type { Head, LineStyle } from "./model";
import type { Op } from "./ops";

export class MermaidError extends Error {}

const refuse = (message: string): never => {
  throw new MermaidError(message);
};

/** The diagram's lines without front matter, comments or blank lines. */
export const mermaidLines = (definition: string) => {
  let text = definition.replace(/\r\n?/g, "\n");
  const front = text.match(/^\s*---\n[\s\S]*?\n---\n/);
  if (front) {
    text = text.slice(front[0].length);
  }
  return text
    .split("\n")
    .map((line) => line.replace(/%%.*$/, "").replace(/\s+$/, ""))
    .filter((line) => line.trim());
};

/** FNV-1a, base 36: a short stable tag for a name with characters ids lack. */
const tag = (text: string) => {
  let h = 0x811c9dc5;
  for (const char of text) {
    h ^= char.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};

/**
 * An op id for a Mermaid name. Ids are ASCII, so a name written in Hangul
 * keeps its ASCII part and gains a tag of the whole name: "대기" and "질문"
 * must not both become "__".
 */
export const safeId = (prefix: string, raw: string) => {
  const full = `${prefix}${raw}`;
  let id = full.replace(/[^A-Za-z0-9_.:>-]/g, "_");
  if (id !== full) {
    id = `${id.replace(/_+/g, "_").replace(/^_|_$/g, "")}_${tag(full)}`;
  }
  return /^[A-Za-z0-9]/.test(id) ? id.slice(0, 80) : `m_${id}`.slice(0, 80);
};

const idFor = safeId;

const unquote = (s: string) =>
  s
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();

// ------------------------------------------------------------- sequence

const ARROWS: [RegExp, LineStyle, Head][] = [
  [/^-->>/, "dashed", "arrow"],
  [/^->>/, "solid", "arrow"],
  [/^--x/, "dashed", "bar"],
  [/^-x/, "solid", "bar"],
  [/^--\)/, "dashed", "triangle_outline"],
  [/^-\)/, "solid", "triangle_outline"],
  [/^-->/, "dashed", "triangle_outline"],
  [/^->/, "solid", "triangle_outline"],
];

export const sequenceOps = (lines: string[], prefix: string): Op[] => {
  const participants: { id: string; label: string; kind?: string }[] = [];
  const known = (raw: string, label?: string, kind?: string) => {
    const id = raw.trim();
    let p = participants.find((x) => x.id === id);
    if (!p) {
      p = { id, label: label ?? id, kind };
      participants.push(p);
    } else if (label) {
      p.label = label;
    }
    return id;
  };
  type Frame = {
    step: Record<string, unknown> & { items: unknown[] };
    current: unknown[];
  };
  const root: unknown[] = [];
  const stack: Frame[] = [];
  const into = () => (stack.length ? stack[stack.length - 1].current : root);
  let title: string | undefined;
  let autonumber = false;

  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^title:?\s+(.*)$/i))) {
      title = m[1].trim();
    } else if (/^autonumber\b/i.test(line)) {
      autonumber = true;
    } else if (
      (m = line.match(/^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i))
    ) {
      known(
        m[2],
        m[3] ? unquote(m[3]) : undefined,
        m[1].toLowerCase() === "actor" ? "actor" : undefined,
      );
    } else if (
      /^(activate|deactivate|create|destroy|box|link|links|properties|details)\b/i.test(
        line,
      )
    ) {
      // presentation only
    } else if (
      (m = line.match(/^note\s+(right of|left of|over)\s+([^:]+):\s*(.*)$/i))
    ) {
      const over = m[2].split(",").map((s) => known(s));
      into().push({
        note: m[3].replace(/<br\s*\/?>/gi, "\n"),
        over: over.length > 2 ? over.slice(0, 2) : over,
      });
    } else if (
      (m = line.match(/^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/i))
    ) {
      const step = {
        fragment: m[1].toLowerCase(),
        label:
          m[1].toLowerCase() === "rect" ? undefined : m[2].trim() || undefined,
        items: [] as unknown[],
        else: [] as { label?: string; items: unknown[] }[],
      };
      into().push(step);
      stack.push({ step, current: step.items });
    } else if ((m = line.match(/^(else|and|option)\b\s*(.*)$/i))) {
      const frame = stack[stack.length - 1];
      if (!frame) {
        refuse(`"${line}" is outside any alt, par or critical block`);
      }
      const branch = {
        label: m[2].trim() || undefined,
        items: [] as unknown[],
      };
      (frame.step.else as unknown[]).push(branch);
      frame.current = branch.items;
    } else if (/^end$/i.test(line)) {
      if (!stack.pop()) {
        refuse("an `end` closes nothing");
      }
    } else {
      m = line.match(
        /^([^-+:]+?)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->)\s*[+-]?\s*([^:]+?)\s*(?::\s*(.*))?$/,
      );
      if (!m) {
        refuse(`cannot read the sequence line "${line}"`);
      }
      const [, from, arrow, to, label] = m!;
      const [, lineStyle, head] = ARROWS.find(([re]) => re.test(arrow))!;
      into().push({
        from: known(from),
        to: known(to),
        label: label?.replace(/<br\s*\/?>/gi, "\n") || undefined,
        line: lineStyle,
        head,
      });
    }
  }
  if (stack.length) {
    refuse(`a ${stack[stack.length - 1].step.fragment} block has no \`end\``);
  }
  // fragments carry their branches as `else`; drop empty ones
  const tidy = (steps: unknown[]) =>
    steps.forEach((s) => {
      const step = s as { items?: unknown[]; else?: unknown[] };
      if (step.items) {
        tidy(step.items);
        if (!step.else?.length) {
          delete step.else;
        } else {
          (step.else as { items: unknown[] }[]).forEach((b) => tidy(b.items));
        }
      }
    });
  tidy(root);
  return [
    {
      op: "sequence",
      id: idFor(prefix, "sequence"),
      title,
      autonumber,
      participants,
      items: root,
    } as Op,
  ];
};

// ---------------------------------------------------------------- class

const CLASS_LINKS: [string, { tail?: Head; head?: Head; line: LineStyle }][] = [
  ["<|--", { tail: "triangle_outline", line: "solid" }],
  ["--|>", { head: "triangle_outline", line: "solid" }],
  ["<|..", { tail: "triangle_outline", line: "dashed" }],
  ["..|>", { head: "triangle_outline", line: "dashed" }],
  ["*--", { tail: "diamond", line: "solid" }],
  ["--*", { head: "diamond", line: "solid" }],
  ["o--", { tail: "diamond_outline", line: "solid" }],
  ["--o", { head: "diamond_outline", line: "solid" }],
  ["<--", { tail: "arrow", line: "solid" }],
  ["-->", { head: "arrow", line: "solid" }],
  ["<..", { tail: "arrow", line: "dashed" }],
  ["..>", { head: "arrow", line: "dashed" }],
  ["--", { line: "solid" }],
  ["..", { line: "dashed" }],
];

export const classOps = (lines: string[], prefix: string): Op[] => {
  type Klass = {
    name: string;
    label: string;
    attrs: string[];
    methods: string[];
    note?: string;
    ns?: string;
  };
  const classes = new Map<string, Klass>();
  const namespaces: string[] = [];
  const edges: Op[] = [];
  const klass = (raw: string, ns?: string) => {
    const name = raw.trim().replace(/~.*~$/, "");
    let k = classes.get(name);
    if (!k) {
      k = {
        name,
        label: raw.trim().replace(/~(.*)~/, "<$1>"),
        attrs: [],
        methods: [],
        ns,
      };
      classes.set(name, k);
    }
    return k;
  };
  const member = (k: Klass, text: string) => {
    const t = text.trim();
    if (!t) {
      return;
    }
    if (/^<<.*>>$/.test(t)) {
      k.label = `«${t.slice(2, -2)}»\n${k.label}`;
    } else if (t.includes("(")) {
      k.methods.push(t);
    } else {
      k.attrs.push(t);
    }
  };
  let open: Klass | null = null;
  let ns: string | undefined;
  let direction: string | undefined;
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if (open) {
      if (line === "}") {
        open = null;
      } else {
        member(open, line);
      }
      continue;
    }
    if ((m = line.match(/^direction\s+(LR|RL|TB|TD|BT)$/i))) {
      direction = m[1].toUpperCase();
    } else if ((m = line.match(/^namespace\s+(\S+)\s*\{$/))) {
      ns = m[1];
      namespaces.push(ns);
    } else if (line === "}" && ns) {
      ns = undefined;
    } else if (
      (m = line.match(
        /^class\s+([^\s{[]+)(?:\["([^"]*)"\])?\s*(\{)?\s*(?:\{\s*\})?$/,
      ))
    ) {
      const k = klass(m[1], ns);
      if (m[2]) {
        k.label = m[2];
      }
      if (m[3]) {
        open = k;
      }
    } else if ((m = line.match(/^<<(.+)>>\s+(\S+)$/))) {
      member(klass(m[2], ns), `<<${m[1]}>>`);
    } else if ((m = line.match(/^note\s+for\s+(\S+)\s+"(.*)"$/i))) {
      klass(m[1], ns).note = m[2].replace(/\\n/g, "\n");
    } else if (
      /^(note|style|classDef|cssClass|click|link|callback)\b/i.test(line)
    ) {
      // presentation only
    } else if (
      (m = line.match(/^(\S+?)\s*:\s*(.+)$/)) &&
      !CLASS_LINKS.some(([op]) => line.includes(op))
    ) {
      member(klass(m[1], ns), m[2]);
    } else {
      const ops = CLASS_LINKS.map(([op]) =>
        op.replace(/[|*.()]/g, "\\$&"),
      ).join("|");
      m = line.match(
        new RegExp(
          `^(\\S+)\\s*(?:"([^"]*)")?\\s*(${ops})\\s*(?:"([^"]*)")?\\s*(\\S+)\\s*(?::\\s*(.*))?$`,
        ),
      );
      if (!m) {
        refuse(`cannot read the class diagram line "${line}"`);
      }
      const [, a, ca, op, cb, b, label] = m!;
      const kind = CLASS_LINKS.find(([o]) => o === op)![1];
      const from = klass(a, ns).name;
      const to = klass(b, ns).name;
      const cards = ca || cb ? `${ca ?? ""} … ${cb ?? ""}`.trim() : "";
      edges.push({
        op: "edge",
        id: idFor(
          prefix,
          `${from}->${to}${edges.length ? `.${edges.length}` : ""}`,
        ),
        from: idFor(prefix, from),
        to: idFor(prefix, to),
        label:
          [label?.trim(), cards && `(${cards})`].filter(Boolean).join(" ") ||
          null,
        line: kind.line,
        head: kind.head ?? "none",
        tail: kind.tail ?? "none",
      });
    }
  }
  const ops: Op[] = namespaces.map((n) => ({
    op: "group",
    id: idFor(prefix, `ns-${n}`),
    label: n,
  }));
  for (const k of classes.values()) {
    ops.push({
      op: "node",
      id: idFor(prefix, k.name),
      label: k.label,
      fields: k.attrs.length || k.methods.length ? [k.attrs, k.methods] : null,
      color: "blue",
      group: k.ns ? idFor(prefix, `ns-${k.ns}`) : null,
    });
    if (k.note) {
      ops.push({
        op: "note",
        id: idFor(prefix, `note-${k.name}`),
        on: idFor(prefix, k.name),
        text: k.note,
      });
    }
  }
  ops.push(...edges, {
    op: "layout",
    direction:
      direction === "LR"
        ? "RIGHT"
        : direction === "RL"
        ? "LEFT"
        : direction === "BT"
        ? "UP"
        : "DOWN",
  });
  return ops;
};

// ------------------------------------------------------------------- ER

const ER_LEFT: Record<string, Head> = {
  "|o": "cardinality_zero_or_one",
  "||": "cardinality_exactly_one",
  "}o": "cardinality_zero_or_many",
  "}|": "cardinality_one_or_many",
};
const ER_RIGHT: Record<string, Head> = {
  "o|": "cardinality_zero_or_one",
  "||": "cardinality_exactly_one",
  "o{": "cardinality_zero_or_many",
  "|{": "cardinality_one_or_many",
};

export const erOps = (lines: string[], prefix: string): Op[] => {
  const entities = new Map<string, { label: string; fields: string[] }>();
  const entity = (raw: string) => {
    const m = raw.match(/^([^[\s]+)(?:\["?([^"\]]*)"?\])?$/);
    const name = m ? m[1] : raw;
    let e = entities.get(name);
    if (!e) {
      e = { label: m?.[2] || name, fields: [] };
      entities.set(name, e);
    }
    return name;
  };
  const edges: Op[] = [];
  let open: string | null = null;
  let direction: string | undefined;
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if (open) {
      if (line === "}") {
        open = null;
        continue;
      }
      m = line.match(
        /^(\S+)\s+(\S+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"(.*)")?$/,
      );
      if (!m) {
        refuse(`cannot read the attribute "${line}"`);
      }
      const [, type, name, keys, comment] = m!;
      entities
        .get(open)!
        .fields.push(
          [`${name}: ${type}`, keys, comment && `— ${comment}`]
            .filter(Boolean)
            .join(" "),
        );
      continue;
    }
    if ((m = line.match(/^direction\s+(LR|RL|TB|TD|BT)$/i))) {
      direction = m[1].toUpperCase();
    } else if ((m = line.match(/^([^\s{]+)\s*\{$/))) {
      open = entity(m[1]);
    } else if (
      (m = line.match(
        /^(\S+)\s+(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)\s+(\S+)\s*:\s*(.*)$/,
      ))
    ) {
      const [, a, left, link, right, b, label] = m;
      const from = entity(a);
      const to = entity(b);
      edges.push({
        op: "edge",
        id: idFor(
          prefix,
          `${from}->${to}${edges.length ? `.${edges.length}` : ""}`,
        ),
        from: idFor(prefix, from),
        to: idFor(prefix, to),
        label: unquote(label) || null,
        line: link === ".." ? "dashed" : "solid",
        tail: ER_LEFT[left],
        head: ER_RIGHT[right],
      });
    } else if ((m = line.match(/^([^\s{]+)$/))) {
      entity(m[1]);
    } else if (!/^(style|classDef|class)\b/.test(line)) {
      refuse(`cannot read the ER diagram line "${line}"`);
    }
  }
  const ops: Op[] = [...entities].map(([name, e]) => ({
    op: "node",
    id: idFor(prefix, name),
    label: e.label,
    fields: e.fields.length ? [e.fields] : null,
    color: "yellow",
  }));
  ops.push(...edges, {
    op: "layout",
    direction:
      direction === "TB" || direction === "TD"
        ? "DOWN"
        : direction === "BT"
        ? "UP"
        : direction === "RL"
        ? "LEFT"
        : "RIGHT",
  });
  return ops;
};

// ---------------------------------------------------------------- state

export const stateOps = (lines: string[], prefix: string): Op[] => {
  const nodes = new Map<
    string,
    {
      label: string;
      shape: "rect" | "ellipse" | "diamond";
      group?: string;
      note?: string;
      size?: "s";
    }
  >();
  const groups: { id: string; label: string; parent?: string }[] = [];
  const transitions: { from: string; to: string; label?: string }[] = [];
  const stack: string[] = [];
  let direction: string | undefined;
  const scope = () => stack[stack.length - 1];
  const state = (raw: string, end: "start" | "end") => {
    if (raw === "[*]") {
      const id = `${scope() ?? ""}${scope() ? "_" : ""}${end}`;
      if (!nodes.has(id)) {
        nodes.set(id, {
          label: end === "start" ? "●" : "◉",
          shape: "ellipse",
          group: scope(),
          size: "s",
        });
      }
      return id;
    }
    if (!nodes.has(raw) && !groups.some((g) => g.id === raw)) {
      nodes.set(raw, { label: raw, shape: "rect", group: scope() });
    }
    return raw;
  };
  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^direction\s+(LR|RL|TB|TD|BT)$/i))) {
      direction = m[1].toUpperCase();
    } else if ((m = line.match(/^state\s+"([^"]+)"\s+as\s+(\S+)$/))) {
      state(m[2], "start");
      nodes.get(m[2])!.label = m[1];
    } else if ((m = line.match(/^state\s+(\S+)\s+<<(choice|fork|join)>>$/))) {
      state(m[1], "start");
      nodes.get(m[1])!.shape = m[2] === "choice" ? "diamond" : "rect";
      if (m[2] !== "choice") {
        nodes.get(m[1])!.label = "▬";
      }
    } else if ((m = line.match(/^state\s+(?:"([^"]+)"\s+as\s+)?(\S+)\s*\{$/))) {
      nodes.delete(m[2]);
      groups.push({ id: m[2], label: m[1] ?? m[2], parent: scope() });
      stack.push(m[2]);
    } else if (line === "}") {
      stack.pop();
    } else if (line === "--") {
      // concurrent regions draw as one group
    } else if (
      (m = line.match(/^note\s+(?:right|left)\s+of\s+(\S+)\s*:\s*(.*)$/i))
    ) {
      state(m[1], "start");
      nodes.get(m[1])!.note = m[2];
    } else if (/^(note|end note|classDef|class|style)\b/i.test(line)) {
      // multi-line notes and styling are not drawn
    } else if ((m = line.match(/^(\S+)\s*-->\s*(\S+)\s*(?::\s*(.*))?$/))) {
      transitions.push({
        from: state(m[1], "start"),
        to: state(m[2], "end"),
        label: m[3]?.trim() || undefined,
      });
    } else if ((m = line.match(/^(\S+)\s*:\s*(.*)$/))) {
      state(m[1], "start");
      nodes.get(m[1])!.label = `${nodes.get(m[1])!.label}\n${m[2]}`;
    } else if ((m = line.match(/^(\S+)$/))) {
      state(m[1], "start");
    } else {
      refuse(`cannot read the state diagram line "${line}"`);
    }
  }
  // a transition into a composite state enters at its start, one out of it
  // leaves from its end (else its first or last state)
  const isGroup = (id: string) => groups.some((g) => g.id === id);
  const inside = (group: string) =>
    [...nodes].filter(([, n]) => n.group === group).map(([id]) => id);
  const entry = (id: string) =>
    !isGroup(id)
      ? id
      : nodes.has(`${id}_start`)
      ? `${id}_start`
      : inside(id)[0];
  const exit = (id: string) =>
    !isGroup(id)
      ? id
      : nodes.has(`${id}_end`)
      ? `${id}_end`
      : inside(id).at(-1);
  const edges: Op[] = [];
  for (const t of transitions) {
    const from = exit(t.from);
    const to = entry(t.to);
    if (!from || !to) {
      refuse(
        `the composite state "${
          !from ? t.from : t.to
        }" has no states to connect`,
      );
    }
    edges.push({
      op: "edge",
      id: idFor(
        prefix,
        `${from}->${to}${edges.length ? `.${edges.length}` : ""}`,
      ),
      from: idFor(prefix, from!),
      to: idFor(prefix, to!),
      label: t.label ?? null,
    });
  }
  const ops: Op[] = groups.map((g) => ({
    op: "group",
    id: idFor(prefix, g.id),
    label: g.label,
    parent: g.parent ? idFor(prefix, g.parent) : null,
  }));
  for (const [id, n] of nodes) {
    ops.push({
      op: "node",
      id: idFor(prefix, id),
      label: n.label,
      shape: n.shape,
      size: n.size ?? null,
      color: n.size ? "black" : null,
      group: n.group ? idFor(prefix, n.group) : null,
      // a start or end point is a dot, not a box
      ...(n.size ? { width: 40, height: 40 } : null),
    });
    if (n.note) {
      ops.push({
        op: "note",
        id: idFor(prefix, `note-${id}`),
        on: idFor(prefix, id),
        text: n.note,
      });
    }
  }
  ops.push(...edges, {
    op: "layout",
    direction:
      direction === "LR"
        ? "RIGHT"
        : direction === "RL"
        ? "LEFT"
        : direction === "BT"
        ? "UP"
        : "DOWN",
  });
  return ops;
};

// -------------------------------------------------------------- mindmap

const BRANCH_COLORS = [
  "blue",
  "green",
  "orange",
  "violet",
  "teal",
  "pink",
  "red",
  "yellow",
];

export const mindmapOps = (lines: string[], prefix: string): Op[] => {
  const items: {
    depth: number;
    label: string;
    shape: "rect" | "ellipse" | "diamond";
  }[] = [];
  for (const raw of lines.slice(1)) {
    const depth = raw.match(/^\s*/)![0].replace(/\t/g, "  ").length;
    const text = raw.trim();
    if (/^::icon\(|^:::/.test(text)) {
      continue;
    }
    const m =
      text.match(/^[^([{)]*?\(\((.*)\)\)$/) ??
      text.match(/^[^([{)]*?\)\)(.*)\(\($/) ??
      text.match(/^[^([{)]*?\)(.*)\($/) ??
      text.match(/^[^([{)]*?\{\{(.*)\}\}$/) ??
      text.match(/^[^([{)]*?\[(.*)\]$/) ??
      text.match(/^[^([{)]*?\((.*)\)$/);
    const label = unquote(m ? m[1] : text).replace(/<br\s*\/?>/gi, "\n");
    const shape =
      /\(\(|\)\)/.test(text) || /^[^([]*\)/.test(text)
        ? "ellipse"
        : /\{\{/.test(text)
        ? "diamond"
        : "rect";
    items.push({ depth, label, shape });
  }
  if (!items.length) {
    refuse("the mind map is empty");
  }
  const ops: Op[] = [];
  const stack: { depth: number; id: string; color: string }[] = [];
  let branch = 0;
  items.forEach((item, k) => {
    while (stack.length && stack[stack.length - 1].depth >= item.depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    const id = idFor(prefix, k === 0 ? "root" : `n${k}`);
    const color = !parent
      ? "violet"
      : stack.length === 1
      ? BRANCH_COLORS[branch++ % BRANCH_COLORS.length]
      : parent.color;
    ops.push({
      op: "node",
      id,
      label: item.label,
      shape: !parent ? "ellipse" : item.shape,
      size: !parent ? "l" : stack.length === 1 ? null : "s",
      color,
    });
    if (parent) {
      ops.push({ op: "edge", from: parent.id, to: id, head: "none", color });
    }
    stack.push({ depth: item.depth, id, color });
  });
  ops.push({ op: "layout", algorithm: "radial" });
  return ops;
};

// ----------------------------------------------------------------- gantt

const durationDays = (s: string): number | null => {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(d|w|day|days|week|weeks)$/i);
  if (!m) {
    return null;
  }
  return Number(m[1]) * (/^w/i.test(m[2]) ? 7 : 1);
};

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim());

export const ganttOps = (lines: string[], prefix: string): Op[] => {
  let title: string | undefined;
  let section: string | undefined;
  const tasks: Record<string, unknown>[] = [];
  let previous: string | undefined;
  let n = 0;
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^title\s+(.*)$/i))) {
      title = m[1];
    } else if ((m = line.match(/^dateFormat\s+(.*)$/i))) {
      if (m[1].trim() !== "YYYY-MM-DD") {
        refuse(`only \`dateFormat YYYY-MM-DD\` is read, not "${m[1].trim()}"`);
      }
    } else if (
      /^(axisFormat|tickInterval|excludes|includes|todayMarker|weekday|inclusiveEndDates|topAxis|displayMode|click)\b/i.test(
        line,
      )
    ) {
      // presentation only
    } else if ((m = line.match(/^section\s+(.*)$/i))) {
      section = m[1].trim();
    } else if ((m = line.match(/^(.+?)\s*:\s*(.*)$/))) {
      const label = m[1].trim();
      const tags = new Set<string>();
      const rest: string[] = [];
      for (const part of m[2]
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)) {
        if (/^(done|active|crit|milestone)$/i.test(part)) {
          tags.add(part.toLowerCase());
        } else {
          rest.push(part);
        }
      }
      let id: string | undefined;
      let start: string | undefined;
      let end: string | undefined;
      if (rest.length >= 3) {
        [id, start, end] = rest;
      } else if (rest.length === 2) {
        [start, end] = rest;
      } else {
        end = rest[0];
      }
      id = id ?? `t${++n}`;
      const task: Record<string, unknown> = { id, label, section };
      if (start && isDate(start)) {
        task.start = start.trim();
      } else if (start && /^after\s+/i.test(start)) {
        task.after = start.replace(/^after\s+/i, "").split(/\s+/)[0];
      } else if (!start && previous) {
        task.after = previous;
      } else if (!start) {
        refuse(`the task "${label}" has no start`);
      } else {
        refuse(`cannot read the start "${start}" of "${label}"`);
      }
      if (end !== undefined) {
        const days = durationDays(end);
        if (days !== null) {
          task.days = days;
        } else if (isDate(end)) {
          task.end = end.trim();
        } else {
          refuse(
            `cannot read the end "${end}" of "${label}" (a date or a length like 3d, 2w)`,
          );
        }
      }
      if (tags.has("milestone")) {
        task.milestone = true;
        delete task.days;
        delete task.end;
      }
      if (tags.has("done")) {
        task.done = true;
      }
      if (tags.has("active")) {
        task.progress = 0.5;
      }
      if (tags.has("crit")) {
        task.color = "red";
      }
      tasks.push(task);
      previous = id;
    } else {
      refuse(`cannot read the gantt line "${line}"`);
    }
  }
  return [
    { op: "timeline", id: idFor(prefix, "timeline"), title, tasks } as Op,
  ];
};

// -------------------------------------------------------------- quadrant

export const quadrantOps = (lines: string[], prefix: string): Op[] => {
  let title: string | undefined;
  const x: [string, string] = ["", ""];
  const y: [string, string] = ["", ""];
  const quadrants = ["", "", "", ""];
  const items: Record<string, unknown>[] = [];
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^title\s+(.*)$/i))) {
      title = m[1];
    } else if ((m = line.match(/^([xy])-axis\s+(.*?)(?:\s*-->\s*(.*))?$/i))) {
      const axis = m[1].toLowerCase() === "x" ? x : y;
      axis[0] = unquote(m[2]);
      axis[1] = unquote(m[3] ?? "");
    } else if ((m = line.match(/^quadrant-([1-4])\s+(.*)$/i))) {
      quadrants[Number(m[1]) - 1] = unquote(m[2]);
    } else if (
      (m = line.match(
        /^(.+?)(?::::\S+)?\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\](.*)$/,
      ))
    ) {
      const color = m[4].match(/color:\s*(#[0-9a-f]{6})/i)?.[1];
      items.push({
        label: unquote(m[1]),
        x: Number(m[2]),
        y: Number(m[3]),
        ...(color ? { color } : null),
      });
    } else if (!/^classDef\b/.test(line)) {
      refuse(`cannot read the quadrant chart line "${line}"`);
    }
  }
  return [
    {
      op: "quadrant",
      id: idFor(prefix, "quadrant"),
      title,
      x,
      y,
      quadrants,
      items,
    } as Op,
  ];
};

/** The reader for a diagram's first line; null for a flowchart. */
export const textReader = (
  header: string,
): ((lines: string[], prefix: string) => Op[]) | null => {
  const word = header.trim().split(/\s+/)[0];
  switch (word) {
    case "sequenceDiagram":
      return sequenceOps;
    case "classDiagram":
    case "classDiagram-v2":
      return classOps;
    case "erDiagram":
      return erOps;
    case "stateDiagram":
    case "stateDiagram-v2":
      return stateOps;
    case "mindmap":
      return mindmapOps;
    case "gantt":
      return ganttOps;
    case "quadrantChart":
      return quadrantOps;
    default:
      return null;
  }
};

export const SUPPORTED =
  "flowchart/graph, sequenceDiagram, classDiagram, erDiagram, stateDiagram-v2, mindmap, gantt, quadrantChart";
