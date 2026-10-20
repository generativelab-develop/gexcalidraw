// Mermaid -> gexcal ops. A flowchart becomes agent-owned nodes, edges and
// groups with the Mermaid ids, laid out by ELK like anything else, so it can
// be edited op by op afterwards; the other diagram kinds are read from their
// text (mermaid-text.ts).

import { parseMermaid } from "@excalidraw/mermaid-to-excalidraw/dist/parseMermaid.js";

import { mermaidLines, safeId, SUPPORTED, textReader } from "./mermaid-text";

import type { Direction, Shape } from "./model";
import type { Op } from "./ops";

type Flowchart = {
  type: "flowchart";
  subGraphs: { id: string; nodeIds: string[]; text: string }[];
  vertices: Record<
    string,
    { id: string; type: string; text: string } | undefined
  >;
  edges: { start: string; end: string; text: string; stroke?: string }[];
};

const DIRECTIONS: Record<string, Direction> = {
  LR: "RIGHT",
  RL: "LEFT",
  TD: "DOWN",
  TB: "DOWN",
  BT: "UP",
};

const SHAPES: Record<string, Shape> = {
  diamond: "diamond",
  circle: "ellipse",
  doublecircle: "ellipse",
  ellipse: "ellipse",
};

/** Mermaid labels may carry markup: keep the text a person reads. */
const plain = (text: string) =>
  text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/^"|"$/g, "")
    .trim();

export const mermaidToOps = async (
  definition: string,
  prefix = "",
): Promise<Op[]> => {
  const lines = mermaidLines(definition);
  if (!lines.length) {
    throw new Error("the Mermaid definition is empty");
  }
  const reader = textReader(lines[0]);
  if (reader) {
    return reader(lines, prefix);
  }
  const header = definition.match(
    /^\s*(?:flowchart|graph)\s+(LR|RL|TD|TB|BT)\b/m,
  );
  if (!/^\s*(?:flowchart|graph)\b/m.test(definition)) {
    throw new Error(
      `this Mermaid diagram kind is not drawn as an editable diagram; supported: ${SUPPORTED}`,
    );
  }
  const parsed = (await parseMermaid(definition)) as unknown as Flowchart;
  if (parsed.type !== "flowchart") {
    throw new Error(`Mermaid parsed this as "${parsed.type}", not a flowchart`);
  }

  const ids = new Map<string, string>();
  const idFor = (raw: string) => {
    let id = ids.get(raw);
    if (!id) {
      id = safeId(prefix, raw);
      ids.set(raw, id);
    }
    return id;
  };

  // a node or subgraph belongs to the innermost subgraph that lists it
  const subgraphIds = new Set(parsed.subGraphs.map((s) => s.id));
  const containing = (member: string) =>
    parsed.subGraphs.filter(
      (s) => s.id !== member && s.nodeIds.includes(member),
    );
  const depth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) {
      return 0;
    }
    seen.add(id);
    const parents = containing(id);
    return parents.length
      ? 1 + Math.max(...parents.map((p) => depth(p.id, seen)))
      : 0;
  };
  const innermost = (member: string) => {
    const candidates = containing(member);
    if (!candidates.length) {
      return undefined;
    }
    return candidates.reduce((a, b) => (depth(b.id) > depth(a.id) ? b : a)).id;
  };

  const ops: Op[] = [];
  for (const sub of parsed.subGraphs) {
    const parent = innermost(sub.id);
    ops.push({
      op: "group",
      id: idFor(sub.id),
      label: plain(sub.text) || sub.id,
      parent: parent ? idFor(parent) : null,
    });
  }
  for (const vertex of Object.values(parsed.vertices)) {
    if (!vertex || subgraphIds.has(vertex.id)) {
      continue;
    }
    const group = innermost(vertex.id);
    ops.push({
      op: "node",
      id: idFor(vertex.id),
      label: plain(vertex.text) || vertex.id,
      shape: SHAPES[vertex.type] ?? "rect",
      group: group ? idFor(group) : null,
    });
  }
  const seenPairs = new Map<string, number>();
  for (const edge of parsed.edges) {
    if (subgraphIds.has(edge.start) || subgraphIds.has(edge.end)) {
      // an edge to a whole subgraph has no box to attach to
      continue;
    }
    const from = idFor(edge.start);
    const to = idFor(edge.end);
    const pair = `${from}->${to}`;
    const n = (seenPairs.get(pair) ?? 0) + 1;
    seenPairs.set(pair, n);
    ops.push({
      op: "edge",
      id: n === 1 ? pair : `${pair}.${n}`,
      from,
      to,
      label: edge.text ? plain(edge.text) : null,
      line: edge.stroke === "dotted" ? "dashed" : "solid",
    });
  }
  ops.push({
    op: "layout",
    direction: header ? DIRECTIONS[header[1]] : "DOWN",
  });
  return ops;
};
