// The forms Excalidraw's use-case pages call for: standard symbols, UML
// sequence notation, swimlanes, Gantt dependencies, personas, radar charts,
// journey maps, screens joined widget to screen, and pictures.

import { drawBlock, validateBlock } from "./blocks";
import { fullLayout } from "./layout";
import { mermaidLines, sequenceOps } from "./mermaid-text";
import { emptyModel, endElementId, endOf } from "./model";
import { applyOps } from "./ops";
import { outlineSize } from "./shapes";

import type { DrawContext, Item, LineItem, ShapeItem } from "./blocks";
import type { Size } from "./layout";
import type { Model } from "./model";
import type { Op } from "./ops";

const ctx: DrawContext = {
  measure: (text, size) => {
    const lines = text.split("\n");
    return {
      width: Math.max(...lines.map((l) => [...l].length)) * size * 0.5,
      height: lines.length * size * 1.25,
    };
  },
  paint: (name) => ({ stroke: `s:${name}`, fill: `f:${name}` }),
};

const build = (ops: Op[]) => {
  const model = emptyModel();
  applyOps(model, ops);
  return model;
};

const keyed = (items: Item[], key: string) => items.find((i) => i.key === key);

describe("shapes", () => {
  it("turns a fork bar across the flow", () => {
    const label = { width: 40, height: 20 };
    expect(outlineSize("bar", label, "RIGHT").height).toBeGreaterThan(
      outlineSize("bar", label, "RIGHT").width,
    );
    expect(outlineSize("bar", label, "DOWN").width).toBeGreaterThan(
      outlineSize("bar", label, "DOWN").height,
    );
  });

  it("refuses fields on a symbol that is not a card", () => {
    expect(() =>
      build([
        { op: "node", id: "a", label: "A", shape: "cylinder", fields: ["x"] },
      ]),
    ).toThrow(/cannot carry fields/);
  });
});

describe("sequence notation", () => {
  const draw = (items: unknown[], participants: unknown[] = ["a", "b"]) =>
    drawBlock("sequence", { participants, items }, ctx);

  it("draws a synchronous call with a filled head and a reply dashed and open", () => {
    const d = draw([
      { from: "a", to: "b", label: "call" },
      { from: "b", to: "a", label: "ok", kind: "reply" },
      { from: "a", to: "b", label: "event", kind: "async" },
    ]);
    const arrows = d.items.filter((i) => i.kind === "arrow") as LineItem[];
    expect(arrows.map((a) => [a.head, a.line])).toEqual([
      ["triangle", "solid"],
      ["arrow", "dashed"],
      ["arrow", "solid"],
    ]);
  });

  it("draws an activation bar from the call to the reply that ends it", () => {
    const d = draw([
      { from: "a", to: "b", label: "call", activate: true },
      { from: "b", to: "a", label: "ok", kind: "reply", deactivate: true },
    ]);
    const bar = keyed(d.items, "act0") as ShapeItem;
    const call = keyed(d.items, "s0") as LineItem;
    const reply = keyed(d.items, "s1") as LineItem;
    expect(bar.y).toBe(call.points[0][1]);
    expect(bar.y + bar.h).toBe(reply.points[0][1]);
    // the call stops at the bar's edge, not the lifeline
    expect(call.points[1][0]).toBe(bar.x);
  });

  it("draws a created participant where it is created and closes a destroyed one", () => {
    const d = draw(
      [
        { from: "a", to: "b", label: "new", create: true },
        { from: "a", to: "b", label: "bye", destroy: true },
      ],
      ["a", "b"],
    );
    const box = keyed(d.items, "p1") as ShapeItem;
    const created = keyed(d.items, "s0") as LineItem;
    expect(box.y).toBeGreaterThan(0);
    expect(created.points[1][0]).toBe(box.x);
    expect(keyed(d.items, "s1-x1")).toBeTruthy();
    const lifeline = keyed(d.items, "l1") as LineItem;
    expect(lifeline.points[1][1]).toBe(
      (keyed(d.items, "s1") as LineItem).points[0][1],
    );
  });

  it("draws an actor as a stick figure", () => {
    const d = draw([], [{ id: "u", label: "User", kind: "actor" }]);
    expect(keyed(d.items, "p0-h")).toMatchObject({ kind: "ellipse" });
    expect(keyed(d.items, "p0-g")).toMatchObject({ kind: "line" });
  });

  it("reads Mermaid's activations, async arrows, create and destroy", () => {
    const [op] = sequenceOps(
      mermaidLines(`sequenceDiagram
  A->>+B: call
  B-)A: event
  B-->>-A: done
  create participant C
  A->>C: new
  destroy C
  A->>C: bye
  activate A
  deactivate A`),
      "",
    ) as Record<string, any>[];
    expect(op.items).toEqual([
      { from: "A", to: "B", label: "call", kind: "sync", activate: true },
      { from: "B", to: "A", label: "event", kind: "async" },
      { from: "B", to: "A", label: "done", kind: "reply", deactivate: true },
      { from: "A", to: "C", label: "new", kind: "sync", create: true },
      { from: "A", to: "C", label: "bye", kind: "sync", destroy: true },
      { activate: "A" },
      { deactivate: "A" },
    ]);
    expect(() => validateBlock("sequence", op)).not.toThrow();
  });
});

describe("timeline", () => {
  it("draws a dependency per `after` and `depends`, of the kind asked", () => {
    const d = drawBlock(
      "timeline",
      {
        tasks: [
          { id: "a", label: "A", start: "2026-10-01", days: 4 },
          { id: "b", label: "B", after: "a", days: 3 },
          {
            id: "c",
            label: "C",
            start: "2026-10-02",
            days: 2,
            depends: [{ on: "a", type: "SS" }],
          },
        ],
      },
      ctx,
    );
    const deps = d.items.filter((i) => i.key.startsWith("dep")) as LineItem[];
    expect(deps).toHaveLength(2);
    const a = keyed(d.items, "r0") as ShapeItem;
    // start-to-start leaves A from its start
    expect(deps[1].points[0][0]).toBe(a.x);
  });

  it("refuses a dependency on a task that is not there", () => {
    expect(() =>
      validateBlock("timeline", {
        tasks: [{ label: "A", start: "2026-10-01", depends: ["zz"] }],
      }),
    ).toThrow(/"zz" is not a task id/);
  });

  it("colours a task by its status", () => {
    const d = drawBlock(
      "timeline",
      { tasks: [{ label: "late", start: 1, days: 2, status: "delayed" }] },
      ctx,
    );
    expect(keyed(d.items, "r0")).toMatchObject({ stroke: "s:red" });
  });
});

describe("new blocks", () => {
  it("validates profiles, radar charts, legends and journeys by field", () => {
    expect(() => validateBlock("profile", { sections: [] })).toThrow(
      /name is required/,
    );
    expect(() =>
      validateBlock("radar", {
        axes: ["a", "b", "c"],
        series: [{ label: "x", values: [1, 2] }],
      }),
    ).toThrow(/2 values for 3 axes/);
    expect(() => validateBlock("legend", { items: [] })).toThrow(
      /needs `items`/,
    );
    expect(() =>
      validateBlock("journey", { stages: ["a", "b"], emotions: [3, 0] }),
    ).toThrow(/emotions\[0\]/);
    expect(() => validateBlock("image", { src: "http://x/y.png" })).toThrow(
      /data URL/,
    );
  });

  it("draws a radar series point at its value", () => {
    const d = drawBlock(
      "radar",
      {
        axes: ["a", "b", "c", "d"],
        max: 4,
        series: [{ label: "x", values: [4, 0, 2, 0] }],
      },
      ctx,
    );
    const top = keyed(d.items, "pt0-0") as ShapeItem;
    const centreRing = keyed(d.items, "spoke0") as LineItem;
    const [cx, cy] = centreRing.points[0];
    expect(top.x + 4).toBeCloseTo(cx);
    expect(cy - (top.y + 4)).toBeCloseTo(170);
  });

  it("puts sections inside a table cell", () => {
    const d = drawBlock(
      "table",
      {
        rows: [
          [
            {
              title: "Problem",
              sections: [{ title: "Alternatives", items: ["x"] }],
            },
          ],
        ],
      },
      ctx,
    );
    const texts = d.items
      .filter((i) => i.kind === "text")
      .map((i) => (i as { text: string }).text);
    expect(texts).toEqual(["Problem", "Alternatives", "• x"]);
  });

  it("keeps a picture in the scene's files and only its id in the block", () => {
    const src = "data:image/png;base64,iVBORw0KGgo=";
    const model = emptyModel();
    const outcome = applyOps(model, [
      { op: "image", id: "pic", src, label: "ref" },
    ]);
    expect(outcome.files).toHaveLength(1);
    expect(outcome.files[0]).toMatchObject({
      dataURL: src,
      mimeType: "image/png",
    });
    const spec = model.blocks.get("pic")!.spec;
    expect(spec.src).toBeUndefined();
    expect(spec.fileId).toBe(outcome.files[0].id);
    applyOps(model, [{ op: "image", id: "pic", label: "renamed" }]);
    expect(model.blocks.get("pic")!.spec.fileId).toBe(outcome.files[0].id);
  });
});

describe("screens joined widget to screen", () => {
  const screens: Op[] = [
    {
      op: "wireframe",
      id: "login",
      items: [{ type: "button", id: "go", label: "Go" }],
    },
    { op: "wireframe", id: "home", items: [] },
  ];

  it("lets an edge start at a widget, and binds it to that widget", () => {
    const model = build([
      ...screens,
      { op: "edge", from: "login.go", to: "home" },
    ]);
    expect(endOf(model, "login.go")!.id).toBe("login");
    expect(endElementId(model, "login.go")).toBe("gx-b-login-id-go");
    applyOps(model, [{ op: "remove", id: "login" }]);
    expect(model.edges.size).toBe(0);
  });

  it("refuses a widget the screen does not have", () => {
    expect(() =>
      build([...screens, { op: "edge", from: "login.nope", to: "home" }]),
    ).toThrow(/no widget with id "nope"/);
  });

  it("places the screens along the flow", async () => {
    const model = build([
      ...screens,
      { op: "edge", from: "login.go", to: "home" },
    ]);
    const sizes = new Map<string, Size>([
      ["login", { width: 375, height: 667 }],
      ["home", { width: 375, height: 667 }],
    ]);
    await fullLayout(model, sizes, new Map(), { keepPinned: false });
    const [a, b] = ["login", "home"].map((id) => model.blocks.get(id)!);
    expect(b.x!).toBeGreaterThan(a.x! + a.width!);
    // the editor routes it, from the widget
    expect(model.edges.get("login.go->home")!.points).toBeUndefined();
  });
});

describe("swimlanes", () => {
  const sizesOf = (model: Model) =>
    new Map<string, Size>(
      [...model.nodes.keys()].map((id) => [id, { width: 100, height: 50 }]),
    );

  it("keeps every step in its lane, lanes one length, steps in flow order", async () => {
    const model = build([
      { op: "group", id: "p", label: "Process", layout: "lanes" },
      { op: "group", id: "a", label: "A", parent: "p" },
      { op: "group", id: "b", label: "B", parent: "p" },
      { op: "node", id: "s1", label: "1", group: "a" },
      { op: "node", id: "s2", label: "2", group: "b" },
      { op: "node", id: "s3", label: "3", group: "a" },
      { op: "edge", from: "s1", to: "s2" },
      { op: "edge", from: "s2", to: "s3" },
    ]);
    await fullLayout(model, sizesOf(model), new Map(), { keepPinned: false });
    const [a, b] = ["a", "b"].map((id) => model.groups.get(id)!);
    const inside = (
      n: { x?: number; y?: number; width?: number; height?: number },
      g: typeof a,
    ) =>
      n.x! >= g.x! &&
      n.y! >= g.y! &&
      n.x! + n.width! <= g.x! + g.width! &&
      n.y! + n.height! <= g.y! + g.height!;
    const [s1, s2, s3] = ["s1", "s2", "s3"].map((id) => model.nodes.get(id)!);
    expect(inside(s1, a) && inside(s3, a) && inside(s2, b)).toBe(true);
    expect(a.width).toBe(b.width);
    expect(a.x).toBe(b.x);
    expect(s1.x!).toBeLessThan(s2.x!);
    expect(s2.x!).toBeLessThan(s3.x!);
  });
});
