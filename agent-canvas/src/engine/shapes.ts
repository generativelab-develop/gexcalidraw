// Node shapes Excalidraw has no element for: the standard symbols of
// flowcharts (input/output, document, terminator), data flow diagrams (data
// store), architecture and UML (database cylinder, actor, fork/join bar,
// deployment node, package, component) and a cloud. Each is drawn as
// decorations around an invisible rectangle that carries the label and that
// arrows bind to, so the node behaves like any other.

import type { Item } from "./blocks";
import type { Direction } from "./model";

export const OUTLINE_SHAPES = [
  "parallelogram",
  "cylinder",
  "document",
  "datastore",
  "circle",
  "hexagon",
  "pill",
  "actor",
  "bar",
  "box3d",
  "folder",
  "component",
  "cloud",
] as const;
export type OutlineShape = typeof OUTLINE_SHAPES[number];

export const isOutlineShape = (shape: string): shape is OutlineShape =>
  (OUTLINE_SHAPES as readonly string[]).includes(shape);

type Size = { width: number; height: number };
type Paint = { stroke: string; fill: string };

const ACTOR = { figure: 74, min: 70 };
const BAR = { long: 110, thick: 12 };

/** The box a shape needs around a label of `label` size. */
export const outlineSize = (
  shape: OutlineShape,
  label: Size,
  direction: Direction,
): Size => {
  const w = label.width + 40;
  const h = Math.max(56, label.height + 24);
  switch (shape) {
    case "parallelogram":
      return { width: w + h * 0.6, height: h };
    case "cylinder":
      return { width: Math.max(w, 120), height: h + 30 };
    case "document":
      return { width: w, height: h + 14 };
    case "datastore":
      return { width: w + 30, height: h };
    case "circle": {
      const d = Math.max(w, h) * 1.1;
      return { width: d, height: d };
    }
    case "hexagon":
      return { width: w + h * 0.6, height: h };
    case "pill":
      return { width: w + h * 0.5, height: h };
    case "actor":
      return {
        // the editor pads a bound label 5px a side: less room wraps it
        width: Math.max(ACTOR.min, label.width + 20),
        height: ACTOR.figure + label.height + 14,
      };
    case "bar":
      return direction === "RIGHT" || direction === "LEFT"
        ? { width: BAR.thick, height: BAR.long }
        : { width: BAR.long, height: BAR.thick };
    case "box3d":
      return { width: w + 16, height: h + 16 };
    case "folder":
      return { width: Math.max(w, 120), height: h + 18 };
    case "component":
      // room for the corner icon on both sides, so the label stays centred
      return { width: w + 72, height: h };
    case "cloud":
      return { width: w * 1.35 + 20, height: h * 1.5 + 10 };
  }
};

/** Where the label sits in the box: actors are captioned underneath. */
export const outlineLabel = (shape: OutlineShape) =>
  shape === "actor"
    ? { verticalAlign: "bottom" as const, hidden: false }
    : shape === "bar"
    ? { verticalAlign: "middle" as const, hidden: true }
    : { verticalAlign: "middle" as const, hidden: false };

const arc = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  steps = 16,
): [number, number][] =>
  Array.from({ length: steps + 1 }, (_, k) => {
    const t = from + ((to - from) * k) / steps;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as [number, number];
  });

const poly = (
  key: string,
  points: [number, number][],
  paint: Paint,
  fill = true,
): Item => ({
  kind: "line",
  key,
  points: [...points, points[0]],
  stroke: paint.stroke,
  strokeWidth: 2,
  closed: fill,
  fill: fill ? paint.fill : undefined,
});

/** The drawing of a shape in its own box, top-left at 0,0. */
export const outlineItems = (
  shape: OutlineShape,
  width: number,
  height: number,
  paint: Paint,
): Item[] => {
  const w = width;
  const h = height;
  switch (shape) {
    case "parallelogram": {
      const s = Math.min(h * 0.6, w * 0.25);
      return [
        poly(
          "o",
          [
            [s, 0],
            [w, 0],
            [w - s, h],
            [0, h],
          ],
          paint,
        ),
      ];
    }
    case "cylinder": {
      const ry = Math.min(14, h * 0.15);
      return [
        poly(
          "o",
          [
            [0, ry],
            // down the left side, along the bottom rim, up the right side,
            // and back along the near half of the top
            ...arc(w / 2, h - ry, w / 2, ry, Math.PI, 0),
            [w, ry],
            ...arc(w / 2, ry, w / 2, ry, 0, Math.PI),
          ],
          paint,
        ),
        {
          kind: "ellipse",
          key: "top",
          x: 0,
          y: 0,
          w,
          h: ry * 2,
          stroke: paint.stroke,
          fill: paint.fill,
          strokeWidth: 2,
        },
      ];
    }
    case "document": {
      const wave = Math.min(12, h * 0.14);
      const bottom: [number, number][] = Array.from({ length: 17 }, (_, k) => {
        const x = w - (w * k) / 16;
        return [x, h - wave + wave * Math.sin((k / 16) * Math.PI * 2)];
      });
      return [poly("o", [[0, 0], [w, 0], ...bottom], paint)];
    }
    case "datastore": {
      const id = Math.min(30, w * 0.2);
      return [
        {
          ...poly(
            "f",
            [
              [0, 0],
              [w, 0],
              [w, h],
              [0, h],
            ],
            { ...paint, stroke: "transparent" },
          ),
        },
        {
          kind: "line",
          key: "o",
          points: [
            [w, 0],
            [0, 0],
            [0, h],
            [w, h],
          ],
          stroke: paint.stroke,
          strokeWidth: 2,
        },
        {
          kind: "line",
          key: "id",
          points: [
            [id, 0],
            [id, h],
          ],
          stroke: paint.stroke,
          strokeWidth: 2,
        },
      ];
    }
    case "circle":
      return [
        {
          kind: "ellipse",
          key: "o",
          x: 0,
          y: 0,
          w,
          h,
          stroke: paint.stroke,
          fill: paint.fill,
          strokeWidth: 2,
        },
      ];
    case "hexagon": {
      const s = Math.min(h * 0.5, w * 0.25);
      return [
        poly(
          "o",
          [
            [s, 0],
            [w - s, 0],
            [w, h / 2],
            [w - s, h],
            [s, h],
            [0, h / 2],
          ],
          paint,
        ),
      ];
    }
    case "pill": {
      const r = h / 2;
      return [
        poly(
          "o",
          [
            ...arc(w - r, r, r, r, -Math.PI / 2, Math.PI / 2, 12),
            ...arc(r, r, r, r, Math.PI / 2, (Math.PI * 3) / 2, 12),
          ],
          paint,
        ),
      ];
    }
    case "actor": {
      const cx = w / 2;
      const head = 22;
      return [
        {
          kind: "ellipse",
          key: "head",
          x: cx - head / 2,
          y: 0,
          w: head,
          h: head,
          stroke: paint.stroke,
          fill: paint.fill,
          strokeWidth: 2,
        },
        {
          kind: "line",
          key: "body",
          points: [
            [cx, head],
            [cx, 48],
          ],
          stroke: paint.stroke,
          strokeWidth: 2,
        },
        {
          kind: "line",
          key: "arms",
          points: [
            [cx - 22, 32],
            [cx + 22, 32],
          ],
          stroke: paint.stroke,
          strokeWidth: 2,
        },
        {
          kind: "line",
          key: "legs",
          points: [
            [cx - 18, 72],
            [cx, 48],
            [cx + 18, 72],
          ],
          stroke: paint.stroke,
          strokeWidth: 2,
        },
      ];
    }
    case "bar":
      return [
        {
          kind: "rect",
          key: "o",
          x: 0,
          y: 0,
          w,
          h,
          stroke: paint.stroke,
          fill: paint.stroke,
          strokeWidth: 1,
        },
      ];
    case "box3d": {
      const d = 16;
      return [
        poly(
          "top",
          [
            [0, d],
            [d, 0],
            [w, 0],
            [w - d, d],
          ],
          paint,
        ),
        poly(
          "side",
          [
            [w - d, d],
            [w, 0],
            [w, h - d],
            [w - d, h],
          ],
          paint,
        ),
        {
          kind: "rect",
          key: "o",
          x: 0,
          y: d,
          w: w - d,
          h: h - d,
          stroke: paint.stroke,
          fill: paint.fill,
          strokeWidth: 2,
        },
      ];
    }
    case "folder": {
      const tab = 18;
      return [
        {
          kind: "rect",
          key: "tab",
          x: 0,
          y: 0,
          w: Math.min(80, w * 0.4),
          h: tab + 2,
          stroke: paint.stroke,
          fill: paint.fill,
          strokeWidth: 2,
        },
        {
          kind: "rect",
          key: "o",
          x: 0,
          y: tab,
          w,
          h: h - tab,
          stroke: paint.stroke,
          fill: paint.fill,
          strokeWidth: 2,
        },
      ];
    }
    case "component":
      return [
        {
          kind: "rect",
          key: "o",
          x: 0,
          y: 0,
          w,
          h,
          stroke: paint.stroke,
          fill: paint.fill,
          strokeWidth: 2,
        },
        // the UML component icon in the corner
        {
          kind: "rect",
          key: "i",
          x: w - 26,
          y: 8,
          w: 16,
          h: 20,
          stroke: paint.stroke,
          fill: paint.fill,
          strokeWidth: 1,
        },
        {
          kind: "rect",
          key: "i1",
          x: w - 30,
          y: 11,
          w: 8,
          h: 4,
          stroke: paint.stroke,
          fill: paint.fill,
          strokeWidth: 1,
        },
        {
          kind: "rect",
          key: "i2",
          x: w - 30,
          y: 19,
          w: 8,
          h: 4,
          stroke: paint.stroke,
          fill: paint.fill,
          strokeWidth: 1,
        },
      ];
    case "cloud": {
      const points: [number, number][] = [];
      const bumps = 9;
      for (let k = 0; k <= 72; k++) {
        const t = (k / 72) * Math.PI * 2;
        const r = 1 + 0.07 * Math.abs(Math.sin((t * bumps) / 2));
        points.push([
          w / 2 + (w / 2 / 1.07) * r * Math.cos(t),
          h / 2 + (h / 2 / 1.07) * r * Math.sin(t),
        ]);
      }
      return [poly("o", points.slice(0, -1), paint)];
    }
  }
};
