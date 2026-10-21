// The canvas as text, for an agent: what it drew (by its own ids), what a
// person added around it, and where the drawing is visibly wrong (boxes on
// top of each other, an arrow running through a box it does not connect).

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { summarizeBlock } from "./blocks";
import { segmentHitsBox } from "./geometry";
import { elementId, gxOf, isAgentOwned, readModel, widgetEnd } from "./model";

import type { Model } from "./model";

type Box = { x: number; y: number; width: number; height: number };

const round = (n: number) => Math.round(n);

const box = (b: Box) =>
  `(${round(b.x)},${round(b.y)}) ${round(b.width)}x${round(b.height)}`;

const quote = (s: string) => JSON.stringify(s.replace(/\s+/g, " ").trim());

const intersects = (a: Box, b: Box, inset = 0) =>
  a.x + inset < b.x + b.width - inset &&
  b.x + inset < a.x + a.width - inset &&
  a.y + inset < b.y + b.height - inset &&
  b.y + inset < a.y + a.height - inset;

const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1;

export type Issue = { kind: string; ids: string[]; detail: string };

export const findIssues = (
  model: Model,
  elements: readonly ExcalidrawElement[],
): Issue[] => {
  const issues: Issue[] = [];
  const byId = new Map(elements.map((e) => [e.id, e]));
  const nodes = [...model.nodes.values(), ...model.blocks.values()].filter(
    (n) => n.x !== undefined,
  ) as (Box & {
    id: string;
    group?: string;
    type?: string;
  })[];
  const notes = [...model.notes.values()].filter(
    (n) => n.x !== undefined,
  ) as (Box & {
    id: string;
  })[];

  const solids = [
    ...nodes.map((n) => ({ ...n, what: n.type ? "block" : "node" })),
    ...notes.map((n) => ({ ...n, what: "note" })),
  ];
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      if (intersects(solids[i], solids[j], 2)) {
        issues.push({
          kind: "overlap",
          ids: [solids[i].id, solids[j].id],
          detail: `${solids[i].what} "${solids[i].id}" and ${solids[j].what} "${solids[j].id}" overlap`,
        });
      }
    }
  }

  for (const node of nodes) {
    if (!node.group) {
      continue;
    }
    const group = model.groups.get(node.group);
    if (group?.x !== undefined && !contains(group as Box, node)) {
      issues.push({
        kind: "outside-group",
        ids: [node.id, group.id],
        detail: `node "${node.id}" sticks out of its group "${group.id}"`,
      });
    }
  }
  for (const node of nodes) {
    for (const group of model.groups.values()) {
      if (group.x === undefined || node.group === group.id) {
        continue;
      }
      // nested groups contain their children's members legitimately
      let cursor = node.group;
      let inside = false;
      while (cursor) {
        if (cursor === group.id) {
          inside = true;
          break;
        }
        cursor = model.groups.get(cursor)?.parent;
      }
      if (!inside && intersects(group as Box, node, 2)) {
        issues.push({
          kind: "foreign-group",
          ids: [node.id, group.id],
          detail: `${node.type ? "block" : "node"} "${
            node.id
          }" lies inside group "${group.id}" but does not belong to it`,
        });
      }
    }
  }

  for (const edge of model.edges.values()) {
    const arrow = byId.get(elementId.edge(edge.id)) as
      | ExcalidrawArrowElement
      | undefined;
    if (!arrow) {
      continue;
    }
    const points = arrow.points.map(
      ([px, py]) => [arrow.x + px, arrow.y + py] as [number, number],
    );
    // a widget's edge leaves through its own screen
    const owners = [edge.from, edge.to].map(
      (end) => widgetEnd(model, end)?.block ?? end,
    );
    for (const node of nodes) {
      if (owners.includes(node.id)) {
        continue;
      }
      const hit = points.some(
        (p, k) => k > 0 && segmentHitsBox(points[k - 1], p, node, 4),
      );
      if (hit) {
        issues.push({
          kind: "edge-through-node",
          ids: [edge.id, node.id],
          detail: `edge "${edge.id}" runs through ${
            node.type ? "block" : "node"
          } "${node.id}"`,
        });
      }
    }
    for (const note of notes) {
      const hit = points.some(
        (p, k) => k > 0 && segmentHitsBox(points[k - 1], p, note, 2),
      );
      if (hit) {
        issues.push({
          kind: "note-over-edge",
          ids: [note.id, edge.id],
          detail: `note "${note.id}" covers edge "${edge.id}"`,
        });
      }
    }
    if (!arrow.startBinding || !arrow.endBinding) {
      issues.push({
        kind: "edge-unbound",
        ids: [edge.id],
        detail: `edge "${edge.id}" is not attached at its ${
          !arrow.startBinding ? "start" : "end"
        }`,
      });
    }
  }
  return issues;
};

export type Description = {
  text: string;
  json: unknown;
};

export const describeScene = (
  elements: readonly ExcalidrawElement[],
): Description => {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const model = readModel(live);
  const issues = findIssues(model, live);

  const textOf = (container: ExcalidrawElement) => {
    const bound = container.boundElements?.find((b) => b.type === "text");
    const t = bound
      ? (byId.get(bound.id) as ExcalidrawTextElement | undefined)
      : undefined;
    return t ? t.originalText ?? t.text : "";
  };

  const agentIdOfElement = (id: string | undefined) => {
    if (!id) {
      return null;
    }
    const e = byId.get(id);
    const gx = e && gxOf(e);
    return gx && "id" in gx ? `${gx.role}:${gx.id}` : null;
  };

  // what a person drew: everything the agent does not own
  const human = live.filter(
    (e) =>
      !isAgentOwned(e) &&
      !(e.type === "text" && (e as ExcalidrawTextElement).containerId),
  );
  const humanItems = human.map((e) => {
    const base = { elementId: e.id, type: e.type, box: box(e) };
    if (e.type === "text") {
      return { ...base, text: (e as ExcalidrawTextElement).originalText };
    }
    if (e.type === "arrow" || e.type === "line") {
      const a = e as ExcalidrawArrowElement;
      return {
        ...base,
        text: textOf(e) || undefined,
        from:
          agentIdOfElement(a.startBinding?.elementId) ??
          a.startBinding?.elementId,
        to:
          agentIdOfElement(a.endBinding?.elementId) ?? a.endBinding?.elementId,
      };
    }
    return { ...base, text: textOf(e) || undefined };
  });

  const lines: string[] = [];
  const counts = `${model.nodes.size} nodes, ${model.edges.size} edges, ${model.groups.size} groups, ${model.blocks.size} blocks, ${model.notes.size} notes, ${human.length} elements drawn by hand`;
  lines.push(
    `diagram: layout ${model.meta.layout ?? "layered"}${
      model.meta.columns ? ` (${model.meta.columns} columns)` : ""
    }, direction ${model.meta.direction}, theme ${model.meta.theme}; ${counts}`,
  );

  if (model.groups.size) {
    lines.push("", "groups:");
    for (const g of model.groups.values()) {
      const members = [...model.nodes.values(), ...model.blocks.values()]
        .filter((n) => n.group === g.id)
        .map((n) => n.id);
      const attrs = [
        g.slide ? "slide" : g.frame ? "frame" : null,
        g.layout ? `layout=${g.layout}` : null,
        g.columns ? `columns=${g.columns}` : null,
        g.pinned ? "[hand-placed]" : null,
      ].filter(Boolean);
      lines.push(
        `  ${g.id} ${quote(g.label)}${g.parent ? ` in ${g.parent}` : ""} ${box(
          g as Box,
        )}${attrs.length ? ` ${attrs.join(" ")}` : ""} members=[${members.join(
          ", ",
        )}]`,
      );
    }
  }
  if (model.nodes.size) {
    lines.push("", "nodes:");
    for (const n of model.nodes.values()) {
      const attrs = [
        n.shape !== "rect" ? n.shape : null,
        n.size && n.size !== "m" ? `size=${n.size}` : null,
        n.fields ? `fields=${JSON.stringify(n.fields).slice(0, 160)}` : null,
        n.kind ? `kind=${n.kind}` : null,
        n.group ? `group=${n.group}` : null,
        n.color ? `color=${n.color}` : null,
        n.source ? `source=${n.source}` : null,
        n.pinned ? "[hand-placed]" : null,
      ].filter(Boolean);
      lines.push(
        `  ${n.id} ${quote(n.label)} ${box(n as Box)} ${attrs.join(
          " ",
        )}`.trimEnd(),
      );
    }
  }
  if (model.edges.size) {
    lines.push("", "edges:");
    for (const e of model.edges.values()) {
      lines.push(
        `  ${e.id}: ${e.from} -> ${e.to}${e.label ? ` ${quote(e.label)}` : ""}${
          e.line && e.line !== "solid" ? ` (${e.line})` : ""
        }${e.head && e.head !== "arrow" ? ` head=${e.head}` : ""}${
          e.tail && e.tail !== "none" ? ` tail=${e.tail}` : ""
        }`,
      );
    }
  }
  if (model.blocks.size) {
    lines.push(
      "",
      "blocks (drawn from their description; resend the op to change one):",
    );
    for (const b of model.blocks.values()) {
      lines.push(
        `  ${b.id} ${summarizeBlock(b.type, b.spec)} ${box(b as Box)}${
          b.group ? ` group=${b.group}` : ""
        }${b.pinned ? " [hand-placed]" : ""}`,
      );
      const spec = JSON.stringify({ op: b.type, id: b.id, ...b.spec });
      lines.push(
        spec.length <= 1500
          ? `    ${spec}`
          : `    (${spec.length} characters; describe --json shows the whole op)`,
      );
    }
  }
  if (model.notes.size) {
    lines.push("", "notes:");
    for (const n of model.notes.values()) {
      lines.push(
        `  ${n.id}${n.on ? ` on ${n.on}` : ""}: ${quote(n.text)}${
          n.pinned ? " [hand-placed]" : ""
        }`,
      );
    }
  }
  if (humanItems.length) {
    lines.push(
      "",
      "drawn by hand (not agent-managed; read them, do not assume they are wrong):",
    );
    for (const h of humanItems) {
      const parts = [`  ${h.elementId} ${h.type} ${h.box}`];
      if ("text" in h && h.text) {
        parts.push(quote(h.text));
      }
      if ("from" in h && (h.from || h.to)) {
        parts.push(`${h.from ?? "?"} -> ${h.to ?? "?"}`);
      }
      lines.push(parts.join(" "));
    }
  }
  lines.push("", issues.length ? "issues:" : "issues: none");
  for (const issue of issues) {
    lines.push(`  [${issue.kind}] ${issue.detail}`);
  }

  return {
    text: lines.join("\n"),
    json: {
      meta: model.meta,
      groups: [...model.groups.values()],
      nodes: [...model.nodes.values()].map(({ style, ...n }) => n),
      edges: [...model.edges.values()].map(({ style, ...e }) => e),
      notes: [...model.notes.values()],
      blocks: [...model.blocks.values()],
      human: humanItems,
      issues,
    },
  };
};
