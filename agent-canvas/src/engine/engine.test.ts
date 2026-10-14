import { fitRouteToOutlines, overlaps, routeHitsBox } from "./geometry";
import { fullLayout, incrementalLayout, placeNotes } from "./layout";
import { emptyModel, followMovedGroups } from "./model";
import { applyOps } from "./ops";

import type { Box } from "./geometry";
import type { Size } from "./layout";
import type { Model } from "./model";
import type { Op } from "./ops";

const build = (ops: Op[]) => {
  const model = emptyModel();
  applyOps(model, ops);
  return model;
};

const sizesOf = (model: Model) =>
  new Map<string, Size>(
    [...model.nodes.keys()].map((id) => [id, { width: 140, height: 64 }]),
  );

const ARCH: Op[] = [
  { op: "group", id: "cp", label: "Control plane" },
  { op: "group", id: "st", label: "Stores", parent: "cp" },
  { op: "node", id: "portal", label: "Portal" },
  { op: "node", id: "daemon", label: "daemon", group: "cp" },
  { op: "node", id: "cli", label: "cli", group: "cp" },
  { op: "node", id: "queue", label: "queue", group: "st" },
  { op: "node", id: "worker", label: "worker" },
  { op: "edge", from: "portal", to: "daemon", label: "action" },
  { op: "edge", from: "daemon", to: "queue" },
  { op: "edge", from: "cli", to: "worker" },
  { op: "edge", from: "worker", to: "queue", line: "dashed" },
  { op: "note", on: "queue", text: "durable" },
];

describe("applyOps", () => {
  it("refuses an edge to a node that does not exist, naming the op", () => {
    expect(() =>
      build([
        { op: "node", id: "a", label: "A" },
        { op: "edge", from: "a", to: "b" },
      ]),
    ).toThrow(/op #2 .*"b" is not a node/);
  });

  it("lets a batch name things created later in the same batch", () => {
    const model = build([
      { op: "edge", from: "a", to: "b" },
      { op: "node", id: "a", label: "A", group: "g" },
      { op: "node", id: "b", label: "B" },
      { op: "group", id: "g", label: "G" },
    ]);
    expect(model.edges.get("a->b")).toBeTruthy();
    expect(model.nodes.get("a")!.group).toBe("g");
  });

  it("refuses one id for two kinds of thing", () => {
    expect(() =>
      build([
        { op: "node", id: "a", label: "A" },
        { op: "group", id: "a", label: "G" },
      ]),
    ).toThrow(/already a node/);
  });

  it("refuses a group that would contain itself", () => {
    expect(() =>
      build([
        { op: "group", id: "a", label: "A", parent: "b" },
        { op: "group", id: "b", label: "B", parent: "a" },
      ]),
    ).toThrow(/contain itself/);
  });

  it("updates an existing node in place, and null clears a field", () => {
    const model = build([
      { op: "group", id: "g", label: "G" },
      { op: "node", id: "a", label: "A", group: "g", kind: "db" },
      { op: "node", id: "a", group: null },
    ]);
    const a = model.nodes.get("a")!;
    expect(a.label).toBe("A");
    expect(a.kind).toBe("db");
    expect(a.group).toBeUndefined();
  });

  it("removing a node removes its edges and frees its notes", () => {
    const model = build([
      { op: "node", id: "a", label: "A" },
      { op: "node", id: "b", label: "B" },
      { op: "edge", from: "a", to: "b" },
      { op: "note", on: "b", text: "n" },
    ]);
    const outcome = applyOps(model, [{ op: "remove", id: "b" }]);
    expect(model.edges.size).toBe(0);
    expect(model.notes.get("note-1")!.on).toBeUndefined();
    expect(outcome.removed).toEqual(new Set(["a->b", "b"]));
    expect(outcome.warnings[0]).toMatch(/free-standing/);
  });

  it("accepts the default edge id when it is named back", () => {
    const model = build([
      { op: "node", id: "a", label: "A" },
      { op: "node", id: "b", label: "B" },
      { op: "edge", from: "a", to: "b" },
      { op: "edge", id: "a->b", from: "a", to: "b", label: "calls" },
    ]);
    expect(model.edges.size).toBe(1);
    expect(model.edges.get("a->b")!.label).toBe("calls");
  });

  it("rejects ids outside the id grammar", () => {
    expect(() => build([{ op: "node", id: "a b", label: "A" }])).toThrow(
      /id must match/,
    );
  });
});

describe("fullLayout", () => {
  it("places every node without overlap, inside its groups, and routes every edge", async () => {
    const model = build(ARCH);
    const labels = new Map([["portal->daemon", { width: 50, height: 20 }]]);
    await fullLayout(model, sizesOf(model), labels, { keepPinned: false });

    const nodes = [...model.nodes.values()] as (Box & { id: string })[];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(overlaps(nodes[i], nodes[j])).toBe(false);
      }
    }
    const cp = model.groups.get("cp")! as Box;
    const st = model.groups.get("st")! as Box;
    const within = (outer: Box, inner: Box) =>
      inner.x >= outer.x &&
      inner.y >= outer.y &&
      inner.x + inner.width <= outer.x + outer.width &&
      inner.y + inner.height <= outer.y + outer.height;
    expect(within(cp, model.nodes.get("daemon") as Box)).toBe(true);
    expect(within(st, model.nodes.get("queue") as Box)).toBe(true);
    expect(within(cp, st)).toBe(true);

    for (const edge of model.edges.values()) {
      expect(edge.points!.length).toBeGreaterThanOrEqual(2);
      // a route never crosses a box it does not connect
      for (const node of nodes) {
        if (node.id !== edge.from && node.id !== edge.to) {
          expect(routeHitsBox(edge.points!, node, 4)).toBe(false);
        }
      }
    }
  });
});

describe("placeNotes", () => {
  it("puts a note beside its target, clear of boxes and routes", async () => {
    const model = build(ARCH);
    await fullLayout(model, sizesOf(model), new Map(), { keepPinned: false });
    placeNotes(
      model,
      new Map([["note-1", { width: 240, height: 100 }]]),
      new Map(),
    );
    const note = model.notes.get("note-1")! as Box;
    for (const node of model.nodes.values()) {
      expect(overlaps(note, node as Box)).toBe(false);
    }
    for (const edge of model.edges.values()) {
      expect(routeHitsBox(edge.points!, note)).toBe(false);
    }
  });
});

describe("hand placement", () => {
  it("places a new node next to its neighbour without moving a hand-placed one", async () => {
    const model = build(ARCH);
    await fullLayout(model, sizesOf(model), new Map(), { keepPinned: false });
    const daemon = model.nodes.get("daemon")!;
    daemon.x! += 300;
    daemon.pinned = true;
    const at = [daemon.x, daemon.y];

    applyOps(model, [
      { op: "node", id: "monitor", label: "monitor" },
      { op: "edge", from: "daemon", to: "monitor" },
    ]);
    incrementalLayout(model, sizesOf(model));

    expect([daemon.x, daemon.y]).toEqual(at);
    const monitor = model.nodes.get("monitor")! as Box;
    expect(monitor.x).toBeGreaterThan(daemon.x! + daemon.width!);
    for (const node of model.nodes.values()) {
      if (node.id !== "monitor") {
        expect(overlaps(monitor, node as Box)).toBe(false);
      }
    }
  });

  it("carries a group's members when a person drags the group box", () => {
    const model = build([
      { op: "group", id: "g", label: "G" },
      { op: "node", id: "a", label: "A", group: "g" },
    ]);
    const g = model.groups.get("g")!;
    const a = model.nodes.get("a")!;
    Object.assign(a, { x: 40, y: 80, laid: [40, 80] });
    // laid where the agent put it, then dragged by +100,+50
    Object.assign(g, { x: 112, y: 78, laid: [12, 28] });
    followMovedGroups(model);
    expect([a.x, a.y]).toEqual([140, 130]);
    expect(a.pinned).toBe(true);
    expect(g.pinned).toBe(true);
  });
});

describe("fitRouteToOutlines", () => {
  it("ends a route on a diamond's outline, not its bounding box", () => {
    const diamond = { x: 0, y: 0, width: 200, height: 100 };
    const target = { x: 400, y: 80, width: 100, height: 40 };
    // leaves the diamond's box near its bottom corner
    const route = fitRouteToOutlines(
      [
        [200, 90],
        [300, 90],
        [300, 100],
        [400, 100],
      ],
      { box: diamond, outline: "diamond" },
      { box: target, outline: "rect" },
    );
    const [x, y] = route[0];
    // on the outline: |dx|/100 + |dy|/50 = 1
    expect(Math.abs(x - 100) / 100 + Math.abs(y - 50) / 50).toBeCloseTo(1);
    // still orthogonal
    for (let k = 1; k < route.length; k++) {
      const [a, b] = [route[k - 1], route[k]];
      expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
    }
    expect(route[route.length - 1]).toEqual([400, 100]);
  });
});
