import { drawBlock, validateBlock, wrap } from "./blocks";
import { fullLayout } from "./layout";
import {
  classOps,
  erOps,
  ganttOps,
  mermaidLines,
  mindmapOps,
  quadrantOps,
  sequenceOps,
  stateOps,
} from "./mermaid-text";
import { emptyModel } from "./model";
import { applyOps } from "./ops";

import type { DrawContext, Item, ShapeItem } from "./blocks";
import type { Size } from "./layout";
import type { Model } from "./model";
import type { Op } from "./ops";

// every character 10px wide, every line 20px high
const ctx: DrawContext = {
  measure: (text, size) => {
    const lines = text.split("\n");
    return {
      width: Math.max(...lines.map((l) => [...l].length)) * size * 0.5,
      height: lines.length * size * 1.25,
    };
  },
  paint: (name) =>
    name?.startsWith("#")
      ? { stroke: name, fill: "#ffffff" }
      : { stroke: `stroke:${name ?? "-"}`, fill: `fill:${name ?? "-"}` },
};

const build = (ops: Op[]) => {
  const model = emptyModel();
  applyOps(model, ops);
  return model;
};

const keyed = (items: Item[], key: string) => items.find((i) => i.key === key);

describe("blocks", () => {
  it("wraps at spaces, and inside a word only when it must", () => {
    expect(wrap("aa bb cc", 30, 10, ctx.measure)).toBe("aa bb\ncc");
    expect(wrap("가나다라마바사", 15, 10, ctx.measure)).toBe(
      "가나다\n라마바\n사",
    );
  });

  it("places table cells like HTML, spans included", () => {
    const drawing = drawBlock(
      "table",
      {
        rows: [
          [{ text: "tall", rowspan: 2 }, "b", "c"],
          ["d", "e"],
          [{ text: "wide", span: 3 }],
        ],
      },
      ctx,
    );
    const tall = keyed(drawing.items, "c0-0") as ShapeItem;
    const d = keyed(drawing.items, "c1-1") as ShapeItem;
    const wide = keyed(drawing.items, "c2-0") as ShapeItem;
    expect(d.x).toBe(tall.x + tall.w);
    expect(tall.h).toBeCloseTo(
      (keyed(drawing.items, "c0-1") as typeof d).h + d.h,
    );
    expect(wide.w).toBeCloseTo(drawing.width);
    expect(drawing.items[0].key).toBe("box");
  });

  it("refuses a description it cannot draw, naming the field", () => {
    expect(() => validateBlock("table", { rows: "x" })).toThrow(
      /rows must be a list/,
    );
    expect(() =>
      validateBlock("sequence", {
        participants: ["a"],
        items: [{ from: "a", to: "b" }],
      }),
    ).toThrow(/items\[0\]\.to "b" is not a participant/);
    expect(() =>
      validateBlock("timeline", {
        tasks: [{ label: "x", start: "2026-13-45" }],
      }),
    ).toThrow(/tasks\[0\]\.start/);
    expect(() =>
      validateBlock("quadrant", { items: [{ label: "a", x: 2, y: 0 }] }),
    ).toThrow(/x must be a number from 0 to 1/);
    expect(() =>
      validateBlock("wireframe", { items: [{ type: "carousel" }] }),
    ).toThrow(/type must be one of/);
    expect(() => validateBlock("sketch", { elements: [] })).toThrow(
      /needs `elements`/,
    );
  });

  it("spaces sequence participants for the longest message between them", () => {
    const drawing = drawBlock(
      "sequence",
      {
        participants: ["a", "b"],
        items: [{ from: "a", to: "b", label: "x".repeat(60) }],
      },
      ctx,
    );
    const a = keyed(drawing.items, "p0") as ShapeItem;
    const b = keyed(drawing.items, "p1") as ShapeItem;
    const distance = b.x + b.w / 2 - (a.x + a.w / 2);
    expect(distance).toBeGreaterThanOrEqual(60 * 8 + 40);
  });

  it("puts timeline tasks after the task they follow", () => {
    const drawing = drawBlock(
      "timeline",
      {
        tasks: [
          { id: "a", label: "A", start: "2026-10-01", days: 10 },
          { label: "B", after: "a", days: 5 },
        ],
      },
      ctx,
    );
    const a = keyed(drawing.items, "r0") as ShapeItem;
    const b = keyed(drawing.items, "r1") as ShapeItem;
    expect(b.x).toBeCloseTo(a.x + a.w);
    expect(b.w).toBeCloseTo(a.w / 2);
  });

  it("starts a sketch at its own top-left corner", () => {
    const drawing = drawBlock(
      "sketch",
      {
        elements: [
          { type: "rect", x: 100, y: 50, w: 40, h: 20 },
          {
            type: "line",
            points: [
              [90, 80],
              [200, 80],
            ],
          },
        ],
      },
      ctx,
    );
    expect(drawing.width).toBe(110);
    expect(drawing.height).toBe(30);
    expect(keyed(drawing.items, "e0")).toMatchObject({ x: 10, y: 0 });
  });

  it("draws a wireframe as a frame named after the screen", () => {
    const drawing = drawBlock(
      "wireframe",
      {
        label: "Login",
        items: [
          { type: "header", label: "App" },
          { type: "input", label: "Email" },
          {
            type: "row",
            items: [
              { type: "button", label: "OK" },
              { type: "button", label: "Cancel", primary: false },
            ],
          },
          { type: "tabbar", items: ["Home", "Me"] },
        ],
      },
      ctx,
    );
    expect(drawing.items[0]).toMatchObject({ key: "box", w: 375 });
    expect(drawing.items[1]).toMatchObject({
      kind: "frame",
      name: "Login",
      w: 375,
    });
    const ok = keyed(drawing.items, "w2-0") as ShapeItem;
    const cancel = keyed(drawing.items, "w2-1") as ShapeItem;
    expect(ok.y).toBe(cancel.y);
    expect(cancel.x).toBeGreaterThan(ok.x + ok.w);
    const tabbar = keyed(drawing.items, "b0") as ShapeItem;
    expect(tabbar.y + tabbar.h).toBe(drawing.height);
  });
});

describe("ops for the new shapes", () => {
  it("takes fields as one section or several", () => {
    const model = build([
      { op: "node", id: "a", label: "A", fields: ["x", "y"] },
      { op: "node", id: "b", label: "B", fields: [["x"], ["m()"]] },
    ]);
    expect(model.nodes.get("a")!.fields).toEqual([["x", "y"]]);
    expect(model.nodes.get("b")!.fields).toEqual([["x"], ["m()"]]);
  });

  it("lets an edge end on a block, and refuses an unknown arrowhead", () => {
    const model = build([
      {
        op: "wireframe",
        id: "home",
        label: "Home",
        items: [{ type: "title", label: "Hi" }],
      },
      { op: "wireframe", id: "next", label: "Next", items: [] },
      { op: "edge", from: "home", to: "next", label: "tap", head: "triangle" },
    ]);
    expect(model.edges.get("home->next")!.head).toBe("triangle");
    expect(() =>
      build([
        { op: "node", id: "a", label: "A" },
        { op: "edge", from: "a", to: "a", head: "star" as never },
      ]),
    ).toThrow(/head must be one of/);
  });

  it("refuses a frame inside a frame and a block op naming another type", () => {
    expect(() =>
      build([
        { op: "group", id: "f", label: "F", frame: true },
        { op: "group", id: "g", label: "G", frame: true, parent: "f" },
      ]),
    ).toThrow(/frame cannot be inside another frame/);
    expect(() =>
      build([
        { op: "table", id: "t", rows: [["a"]] },
        { op: "quadrant", id: "t", items: [] },
      ]),
    ).toThrow(/"t" is a table, not a quadrant/);
  });

  it("removes a block with the edges that touch it", () => {
    const model = build([
      { op: "node", id: "a", label: "A" },
      { op: "table", id: "t", rows: [["x"]] },
      { op: "edge", from: "a", to: "t" },
    ]);
    applyOps(model, [{ op: "remove", id: "t" }]);
    expect(model.blocks.size).toBe(0);
    expect(model.edges.size).toBe(0);
  });
});

const sizesOf = (model: Model) =>
  new Map<string, Size>(
    [...model.nodes.keys(), ...model.blocks.keys()].map((id) => [
      id,
      { width: 100, height: 50 },
    ]),
  );

describe("layouts", () => {
  it("lays a grid in the order things were made, columns as asked", async () => {
    const model = build([
      { op: "meta", layout: "grid", columns: 2 },
      { op: "node", id: "a", label: "A" },
      { op: "node", id: "b", label: "B" },
      { op: "node", id: "c", label: "C" },
    ]);
    await fullLayout(model, sizesOf(model), new Map(), { keepPinned: false });
    const [a, b, c] = ["a", "b", "c"].map((id) => model.nodes.get(id)!);
    expect(a.y).toBe(b.y);
    expect(b.x!).toBeGreaterThan(a.x!);
    expect(c.x).toBe(a.x);
    expect(c.y!).toBeGreaterThan(a.y!);
  });

  it("lays a group its own way inside a layered drawing", async () => {
    const model = build([
      { op: "group", id: "board", label: "Board", layout: "grid", columns: 3 },
      { op: "node", id: "x", label: "X", group: "board" },
      { op: "node", id: "y", label: "Y", group: "board" },
      { op: "node", id: "z", label: "Z", group: "board" },
      { op: "node", id: "out", label: "Out" },
      { op: "edge", from: "out", to: "x" },
    ]);
    await fullLayout(model, sizesOf(model), new Map(), { keepPinned: false });
    const [x, y, z] = ["x", "y", "z"].map((id) => model.nodes.get(id)!);
    expect(x.y).toBe(y.y);
    expect(y.y).toBe(z.y);
    const board = model.groups.get("board")!;
    for (const n of [x, y, z]) {
      expect(n.x!).toBeGreaterThanOrEqual(board.x!);
      expect(n.x! + n.width!).toBeLessThanOrEqual(board.x! + board.width!);
    }
    // an edge into a group laid out on its own is left to the editor
    expect(model.edges.get("out->x")!.points).toBeUndefined();
  });

  it("puts a mind map's root among its branches", async () => {
    const model = build(
      mindmapOps(
        mermaidLines("mindmap\n  root((Plan))\n    A\n    B\n    C\n    D"),
        "",
      ),
    );
    await fullLayout(model, sizesOf(model), new Map(), { keepPinned: false });
    const root = model.nodes.get("root")!;
    const others = ["n1", "n2", "n3", "n4"].map((id) => model.nodes.get(id)!);
    const xs = others.map((n) => n.x!);
    const ys = others.map((n) => n.y!);
    expect(root.x!).toBeGreaterThan(Math.min(...xs));
    expect(root.x!).toBeLessThan(Math.max(...xs));
    expect(root.y!).toBeGreaterThan(Math.min(...ys));
    expect(root.y!).toBeLessThan(Math.max(...ys));
  });
});

describe("Mermaid text readers", () => {
  const read = (fn: (l: string[], p: string) => Op[], text: string) =>
    fn(mermaidLines(text), "");

  it("reads a sequence diagram with fragments and notes", () => {
    const [op] = read(
      sequenceOps,
      `sequenceDiagram
        autonumber
        actor U as User
        participant API
        U->>API: POST /login
        alt ok
          API-->>U: 200
        else bad password
          API-->>U: 401
        end
        Note over U,API: TLS everywhere`,
    ) as Record<string, any>[];
    expect(op.op).toBe("sequence");
    expect(op.participants).toEqual([
      { id: "U", label: "User", kind: "actor" },
      { id: "API", label: "API", kind: undefined },
    ]);
    expect(op.items[1]).toMatchObject({ fragment: "alt", label: "ok" });
    expect(op.items[1].else[0].label).toBe("bad password");
    expect(op.items[2]).toEqual({ note: "TLS everywhere", over: ["U", "API"] });
    expect(() => validateBlock("sequence", op)).not.toThrow();
  });

  it("reads a class diagram into cards and UML arrows", () => {
    const ops = read(
      classOps,
      `classDiagram
        class Animal {
          <<abstract>>
          +String name
          +eat() void
        }
        Animal <|-- Dog
        Dog "1" *-- "4" Leg : has`,
    ) as Record<string, any>[];
    const animal = ops.find((o) => o.id === "Animal")!;
    expect(animal.label).toBe("«abstract»\nAnimal");
    expect(animal.fields).toEqual([["+String name"], ["+eat() void"]]);
    const inherit = ops.find((o) => o.op === "edge" && o.to === "Dog")!;
    expect(inherit).toMatchObject({
      from: "Animal",
      tail: "triangle_outline",
      head: "none",
    });
    const legs = ops.find((o) => o.op === "edge" && o.to === "Leg")!;
    expect(legs).toMatchObject({ tail: "diamond", label: "has (1 … 4)" });
    expect(() => build(ops as Op[])).not.toThrow();
  });

  it("reads an ER diagram with crow's feet", () => {
    const ops = read(
      erOps,
      `erDiagram
        CUSTOMER ||--o{ ORDER : places
        ORDER {
          string id PK
          int total
        }`,
    ) as Record<string, any>[];
    expect(ops.find((o) => o.op === "edge")).toMatchObject({
      tail: "cardinality_exactly_one",
      head: "cardinality_zero_or_many",
      label: "places",
    });
    expect(ops.find((o) => o.id === "ORDER")!.fields).toEqual([
      ["id: string PK", "total: int"],
    ]);
    expect(() => build(ops as Op[])).not.toThrow();
  });

  it("reads a state diagram with start, end and a composite", () => {
    const ops = read(
      stateOps,
      `stateDiagram-v2
        [*] --> Idle
        Idle --> Running : start
        state Running {
          [*] --> Fast
        }
        Running --> [*]`,
    );
    const model = build(ops);
    expect(model.groups.has("Running")).toBe(true);
    expect(model.nodes.get("Fast")!.group).toBe("Running");
    expect(model.nodes.has("start")).toBe(true);
    expect(model.nodes.has("Running_start")).toBe(true);
    expect(model.edges.get("Idle->Running_start.1")!.from).toBe("Idle");
    expect(
      [...model.edges.values()].some(
        (e) => e.from === "Fast" && e.to === "end",
      ),
    ).toBe(true);
  });

  it("reads a gantt chart into a timeline", () => {
    const [op] = read(
      ganttOps,
      `gantt
        title Launch
        dateFormat YYYY-MM-DD
        section Build
        Design :done, d1, 2026-10-01, 5d
        Code   :active, c1, after d1, 2w
        section Ship
        Release :milestone, r1, 2026-11-01, 0d`,
    ) as Record<string, any>[];
    expect(op.tasks).toEqual([
      {
        id: "d1",
        label: "Design",
        section: "Build",
        start: "2026-10-01",
        days: 5,
        done: true,
      },
      {
        id: "c1",
        label: "Code",
        section: "Build",
        after: "d1",
        days: 14,
        progress: 0.5,
      },
      {
        id: "r1",
        label: "Release",
        section: "Ship",
        start: "2026-11-01",
        milestone: true,
      },
    ]);
    expect(() => validateBlock("timeline", op)).not.toThrow();
  });

  it("reads a quadrant chart", () => {
    const [op] = read(
      quadrantOps,
      `quadrantChart
        title Priorities
        x-axis Low effort --> High effort
        y-axis Low impact --> High impact
        quadrant-1 Plan
        quadrant-2 Do now
        Feature A: [0.2, 0.9]`,
    ) as Record<string, any>[];
    expect(op).toMatchObject({
      x: ["Low effort", "High effort"],
      y: ["Low impact", "High impact"],
      quadrants: ["Plan", "Do now", "", ""],
      items: [{ label: "Feature A", x: 0.2, y: 0.9 }],
    });
  });

  it("keeps Hangul names apart in ids", () => {
    const model = build(
      read(stateOps, "stateDiagram-v2\n  대기 --> 질문\n  질문 --> 대기"),
    );
    expect(model.nodes.size).toBe(2);
    expect([...model.nodes.values()].map((n) => n.label).sort()).toEqual([
      "대기",
      "질문",
    ]);
  });

  it("names the line it cannot read", () => {
    expect(() => read(sequenceOps, "sequenceDiagram\n  what is this")).toThrow(
      /cannot read the sequence line "what is this"/,
    );
  });
});
