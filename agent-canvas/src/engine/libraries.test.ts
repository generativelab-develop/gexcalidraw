// The forms the community libraries at libraries.excalidraw.com are made
// for: data charts and dashboards, Wardley maps, any library item redrawn as
// it was drawn, dashed boundaries and bold end events, and the Mermaid kinds
// that describe them.

import { drawBlock, niceTicks, validateBlock } from "./blocks";
import {
  journeyOps,
  kanbanOps,
  mermaidLines,
  pieOps,
  timelineEventOps,
  xychartOps,
} from "./mermaid-text";
import { emptyModel } from "./model";
import { applyOps } from "./ops";

import type {
  DrawContext,
  Item,
  LineItem,
  ShapeItem,
  TextItem,
} from "./blocks";
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

const keyed = (items: Item[], key: string) => items.find((i) => i.key === key);
const texts = (items: Item[]) =>
  items.filter((i): i is TextItem => i.kind === "text").map((t) => t.text);

describe("chart", () => {
  it("draws one bar per value, taller for a larger value, labelled", () => {
    const d = drawBlock(
      "chart",
      {
        type: "bar",
        categories: ["Q1", "Q2", "Q3"],
        series: [{ label: "매출", values: [10, 30, 20] }],
        unit: "억",
      },
      ctx,
    );
    const bars = [0, 1, 2].map((j) => keyed(d.items, `bar0-${j}`) as ShapeItem);
    expect(bars.every(Boolean)).toBe(true);
    expect(bars[1].h).toBeGreaterThan(bars[2].h);
    expect(bars[2].h).toBeGreaterThan(bars[0].h);
    // every bar stands on the same baseline
    expect(new Set(bars.map((b) => Math.round(b.y + b.h))).size).toBe(1);
    expect(texts(d.items)).toEqual(expect.arrayContaining(["30억", "Q2"]));
  });

  it("stacks series on one bar and writes the total above it", () => {
    const d = drawBlock(
      "chart",
      {
        type: "bar",
        stacked: true,
        categories: ["A"],
        series: [
          { label: "x", values: [3] },
          { label: "y", values: [5] },
        ],
      },
      ctx,
    );
    const a = keyed(d.items, "bar0-0") as ShapeItem;
    const b = keyed(d.items, "bar1-0") as ShapeItem;
    expect(Math.round(b.y + b.h)).toBe(Math.round(a.y));
    expect(a.x).toBe(b.x);
    expect(texts(d.items)).toContain("8");
  });

  it("draws a line series over bars in a combination chart", () => {
    const d = drawBlock(
      "chart",
      {
        type: "bar",
        categories: ["1월", "2월"],
        series: [
          { label: "매출", values: [4, 6] },
          { label: "목표", values: [5, 5], type: "line" },
        ],
      },
      ctx,
    );
    expect(keyed(d.items, "bar0-0")).toBeTruthy();
    expect(keyed(d.items, "bar1-0")).toBeUndefined();
    expect((keyed(d.items, "line1") as LineItem).points).toHaveLength(2);
  });

  it("lays bars across with the names down the left", () => {
    const d = drawBlock(
      "chart",
      {
        type: "bar",
        horizontal: true,
        categories: ["짧음", "길다"],
        series: [{ values: [1, 4] }],
      },
      ctx,
    );
    const short = keyed(d.items, "bar0-0") as ShapeItem;
    const long = keyed(d.items, "bar0-1") as ShapeItem;
    expect(long.w).toBeGreaterThan(short.w);
    expect(long.y).toBeGreaterThan(short.y);
  });

  it("splits a pie by share, writes each share and lists the key", () => {
    const d = drawBlock(
      "chart",
      {
        type: "pie",
        slices: [
          { label: "A", value: 3 },
          { label: "B", value: 1 },
        ],
      },
      ctx,
    );
    const slices = d.items.filter((i) => i.key.startsWith("slice"));
    expect(slices).toHaveLength(2);
    expect(slices.every((s) => (s as LineItem).closed)).toBe(true);
    expect(texts(d.items)).toEqual(
      expect.arrayContaining(["75%", "25%", "A  3 (75%)"]),
    );
  });

  it("leaves a donut's middle open for its total", () => {
    const d = drawBlock(
      "chart",
      {
        type: "donut",
        center: "총 4",
        slices: [
          { label: "A", value: 3 },
          { label: "B", value: 1 },
        ],
      },
      ctx,
    );
    expect(texts(d.items)).toContain("총 4");
  });

  it("narrows a funnel stage by stage with each stage's share of the first", () => {
    const d = drawBlock(
      "chart",
      {
        type: "funnel",
        slices: [
          { label: "방문", value: 1000 },
          { label: "가입", value: 300 },
          { label: "결제", value: 60 },
        ],
      },
      ctx,
    );
    const top = keyed(d.items, "stage0") as LineItem;
    const last = keyed(d.items, "stage2") as LineItem;
    const width = (l: LineItem) => l.points[1][0] - l.points[0][0];
    expect(width(top)).toBeGreaterThan(width(last));
    expect(texts(d.items)).toContain("가입 — 300 (30%)");
  });

  it("draws a function's graph with axes through zero", () => {
    const points = Array.from({ length: 41 }, (_, k) => {
      const x = -2 + k * 0.1;
      return [x, x * x - 1];
    });
    const d = drawBlock(
      "chart",
      {
        type: "scatter",
        origin: true,
        series: [{ label: "y = x² − 1", points, line: true }],
      },
      ctx,
    );
    const path = keyed(d.items, "path0") as LineItem;
    expect(path.points).toHaveLength(41);
    // a long curve is drawn without a dot per point
    expect(keyed(d.items, "pt0-0")).toBeUndefined();
    const xAxis = keyed(d.items, "axis-x") as LineItem;
    expect(xAxis.kind).toBe("arrow");
    // the x axis is at y = 0, not along the bottom
    const yAxis = keyed(d.items, "axis-y") as LineItem;
    expect(xAxis.points[0][1]).toBeLessThan(yAxis.points[0][1]);
  });

  it("refuses values that do not match the categories", () => {
    expect(() =>
      validateBlock("chart", {
        type: "line",
        categories: ["a", "b"],
        series: [{ values: [1] }],
      }),
    ).toThrow(/1 values for 2 categories/);
    expect(() => validateBlock("chart", { type: "gauge" })).toThrow(
      /type must be one of/,
    );
  });

  it("picks round ticks", () => {
    expect(niceTicks(0, 87).ticks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(-3, 3).ticks).toEqual([-4, -2, 0, 2, 4]);
  });
});

describe("wardley map", () => {
  const spec = {
    title: "차 한 잔",
    components: [
      {
        id: "user",
        label: "손님",
        evolution: 0.7,
        visibility: 1,
        kind: "anchor",
      },
      { id: "cup", label: "찻잔", evolution: 0.75, visibility: 0.8 },
      {
        id: "kettle",
        label: "주전자",
        evolution: 0.4,
        visibility: 0.4,
        evolve: 0.7,
        inertia: true,
      },
      {
        id: "power",
        label: "전기",
        evolution: 0.95,
        visibility: 0.1,
        method: "outsource",
      },
    ],
    links: [
      ["user", "cup"],
      ["cup", "kettle"],
      { from: "kettle", to: "power", label: "전력" },
    ],
  };

  it("places components by evolution and visibility, links and movements", () => {
    const d = drawBlock("wardley", spec, ctx);
    const cup = keyed(d.items, "c-cup") as ShapeItem;
    const kettle = keyed(d.items, "c-kettle") as ShapeItem;
    expect(cup.x).toBeGreaterThan(kettle.x); // further evolved
    expect(cup.y).toBeLessThan(kettle.y); // more visible
    expect(keyed(d.items, "evolve-kettle")).toMatchObject({
      line: "dashed",
      head: "arrow",
    });
    expect(keyed(d.items, "inertia-kettle")).toBeTruthy();
    expect(keyed(d.items, "method-power")).toBeTruthy();
    expect(d.items.filter((i) => i.key.startsWith("link"))).toHaveLength(4);
    expect(texts(d.items)).toEqual(
      expect.arrayContaining(["Genesis", "Evolution", "손님"]),
    );
  });

  it("refuses a link to a component it does not have", () => {
    expect(() =>
      validateBlock("wardley", { ...spec, links: [["cup", "tea"]] }),
    ).toThrow(/"tea" is not a component/);
  });
});

describe("library item", () => {
  const elements = [
    {
      type: "rectangle",
      x: 100,
      y: 50,
      width: 80,
      height: 40,
      strokeColor: "#ab5d24",
      backgroundColor: "#ffd8a8",
      fillStyle: "hachure",
      strokeWidth: 2,
      roughness: 1,
      roundness: { type: 3 },
    },
    {
      type: "line",
      x: 100,
      y: 120,
      width: 80,
      height: 0,
      points: [
        [0, 0],
        [80, 0],
      ],
      strokeColor: "#1e1e1e",
      strokeStyle: "dashed",
    },
    {
      type: "arrow",
      x: 100,
      y: 140,
      points: [
        [0, 0],
        [40, 0],
      ],
      endArrowhead: "dot",
      startArrowhead: null,
    },
    {
      type: "text",
      x: 110,
      y: 60,
      width: 60,
      height: 20,
      text: "λ",
      fontSize: 16,
      fontFamily: 5,
      textAlign: "center",
    },
    { type: "image", x: 0, y: 0, width: 10, height: 10, fileId: "f" },
    { type: "ellipse", x: 0, y: 0, width: 10, height: 10, isDeleted: true },
  ];

  it("redraws the item's elements in its own colours, moved to the origin", () => {
    const d = drawBlock(
      "library",
      { library: "AWS", item: "Lambda", elements },
      ctx,
    );
    const rect = keyed(d.items, "l0") as ShapeItem;
    expect(rect).toMatchObject({
      kind: "rect",
      x: 0,
      y: 0,
      w: 80,
      stroke: "#ab5d24",
      fill: "#ffd8a8",
      fillStyle: "hachure",
      rounded: true,
      roughness: 1,
    });
    expect(keyed(d.items, "l1")).toMatchObject({ line: "dashed" });
    expect(keyed(d.items, "l2")).toMatchObject({
      head: "circle",
      tail: "none",
    });
    expect(keyed(d.items, "l3")).toMatchObject({
      text: "λ",
      font: 5,
      align: "center",
      w: 60,
    });
    // the picture and the deleted shape are not drawn
    expect(d.items.filter((i) => i.key.startsWith("l"))).toHaveLength(4);
    expect(d.width).toBe(80);
  });

  it("scales the item to the width asked", () => {
    const d = drawBlock(
      "library",
      { elements, width: 40, label: "Lambda" },
      ctx,
    );
    expect((keyed(d.items, "l0") as ShapeItem).w).toBe(40);
    expect(texts(d.items)).toContain("Lambda");
  });

  it("asks for the item by name when the command has not fetched it", () => {
    expect(() =>
      validateBlock("library", { library: "AWS", item: "Lambda" }),
    ).toThrow(/fetch the item's elements/);
  });

  it("keeps the fetched elements when only the caption changes", () => {
    const model = emptyModel();
    applyOps(model, [
      {
        op: "library",
        id: "fn",
        library: "AWS",
        item: "Lambda",
        elements,
      } as Op,
    ]);
    applyOps(model, [{ op: "library", id: "fn", label: "함수" } as Op]);
    expect(model.blocks.get("fn")!.spec).toMatchObject({
      label: "함수",
      item: "Lambda",
    });
    expect((model.blocks.get("fn")!.spec.elements as unknown[]).length).toBe(
      elements.length,
    );
  });
});

describe("borders", () => {
  it("keeps a dashed boundary and a bold event, and refuses a made-up one", () => {
    const model = emptyModel();
    applyOps(model, [
      { op: "group", id: "sys", label: "결제 시스템", border: "dashed" },
      { op: "node", id: "end", label: "끝", shape: "circle", border: "bold" },
    ]);
    expect(model.groups.get("sys")!.border).toBe("dashed");
    expect(model.nodes.get("end")!.border).toBe("bold");
    expect(() =>
      applyOps(emptyModel(), [
        { op: "node", id: "x", label: "x", border: "double" } as unknown as Op,
      ]),
    ).toThrow(/border must be one of/);
  });
});

describe("wireframe dashboards", () => {
  it("draws a chart card, a KPI and a map on a screen", () => {
    const d = drawBlock(
      "wireframe",
      {
        device: "desktop",
        items: [
          {
            type: "row",
            items: [
              { type: "stat", label: "매출", text: "₩12.4M", delta: "+12%" },
              { type: "stat", label: "이탈", text: "3.1%", delta: "-0.4%p" },
            ],
          },
          { type: "chart", chart: "line", label: "주간 방문" },
          { type: "chart", chart: "donut", label: "채널", values: [5, 3, 2] },
          { type: "map", label: "매장", count: 4 },
        ],
      },
      ctx,
    );
    expect(texts(d.items)).toEqual(
      expect.arrayContaining(["₩12.4M", "+12%", "주간 방문"]),
    );
    const deltas = d.items.filter(
      (i) =>
        i.kind === "text" &&
        /%/.test((i as TextItem).text) &&
        /^[+-]/.test((i as TextItem).text),
    ) as TextItem[];
    expect(deltas.map((t) => t.color)).toEqual(["#2f9e44", "#e03131"]);
  });
});

describe("mermaid charts, journeys, boards and timelines", () => {
  it("reads a pie chart", () => {
    const [op] = pieOps(
      mermaidLines('pie title 반려동물\n  "개" : 386\n  "고양이" : 85'),
      "",
    ) as Record<string, unknown>[];
    expect(op).toMatchObject({ op: "chart", type: "pie", title: "반려동물" });
    expect(op.slices).toEqual([
      { label: "개", value: 386 },
      { label: "고양이", value: 85 },
    ]);
  });

  it("reads an xychart with bars and a line as one combination chart", () => {
    const [op] = xychartOps(
      mermaidLines(
        'xychart-beta\n  title "매출"\n  x-axis [jan, feb, mar]\n  y-axis "원" 0 --> 100\n  bar [10, 50, 30]\n  line [20, 40, 35]',
      ),
      "",
    ) as Record<string, unknown>[];
    expect(op).toMatchObject({
      type: "bar",
      title: "매출",
      categories: ["jan", "feb", "mar"],
      min: 0,
      max: 100,
      yLabel: "원",
    });
    expect((op.series as { type: string }[]).map((s) => s.type)).toEqual([
      "bar",
      "line",
    ]);
    validateBlock("chart", op);
  });

  it("reads a user journey with scores as feelings", () => {
    const [op] = journeyOps(
      mermaidLines(
        "journey\n  title 출근\n  section 집\n    차 마시기: 5: 나\n    계단: 1: 나, 고양이",
      ),
      "",
    ) as Record<string, unknown>[];
    expect(op).toMatchObject({
      op: "journey",
      stages: ["차 마시기", "계단"],
      emotions: [2, -2],
    });
    validateBlock("journey", op);
  });

  it("reads a kanban board into a column per state", () => {
    const ops = kanbanOps(
      mermaidLines(
        "kanban\n  todo[할 일]\n    a[문서 쓰기]\n    b[블로그]@{ assigned: 'knsv', priority: 'High' }\n  doing[진행 중]\n    c[렌더러]",
      ),
      "",
    ) as Record<string, unknown>[];
    const groups = ops.filter((o) => o.op === "group");
    expect(groups.map((g) => g.label)).toEqual(["Kanban", "할 일", "진행 중"]);
    const cards = ops.filter((o) => o.op === "node");
    expect(cards.map((c) => c.label)).toEqual([
      "문서 쓰기",
      "블로그\nassigned: knsv\npriority: High",
      "렌더러",
    ]);
    const model = emptyModel();
    applyOps(model, ops as Op[]);
    expect(model.groups.size).toBe(3);
  });

  it("reads a timeline of events into a table of periods", () => {
    const [op] = timelineEventOps(
      mermaidLines(
        "timeline\n  title SNS\n  section 2000년대\n    2004 : Facebook : Google\n    2005 : YouTube\n  section 2010년대\n    2010 : Instagram",
      ),
      "",
    ) as Record<string, unknown>[];
    const sections = op.columns as Record<string, unknown>[];
    expect(sections.map((c) => [c.text, c.span])).toEqual([
      ["2000년대", 2],
      ["2010년대", 1],
    ]);
    const [periods, events] = op.rows as Record<string, unknown>[][];
    expect(periods.map((c) => c.title)).toEqual(["2004", "2005", "2010"]);
    expect(events[0].items).toEqual(["Facebook", "Google"]);
    validateBlock("table", op);
  });
});
