export type Point = [number, number];
export type Box = { x: number; y: number; width: number; height: number };

export const overlaps = (a: Box, b: Box, margin = 0) =>
  a.x < b.x + b.width + margin &&
  b.x < a.x + a.width + margin &&
  a.y < b.y + b.height + margin &&
  b.y < a.y + a.height + margin;

export const centerOf = (e: Box): Point => [
  e.x + e.width / 2,
  e.y + e.height / 2,
];

/** The point on `e`'s bounding box along the line from its centre to `towards`. */
export const closestEdgePoint = (e: Box, towards: Point): Point => {
  const [cx, cy] = centerOf(e);
  const dx = towards[0] - cx;
  const dy = towards[1] - cy;
  if (dx === 0 && dy === 0) {
    return [cx, cy];
  }
  const sx = dx === 0 ? Infinity : e.width / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : e.height / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
};

/** Border to border, for an edge the layout did not route. */
export const straightRoute = (from: Box, to: Box): Point[] => [
  closestEdgePoint(from, centerOf(to)),
  closestEdgePoint(to, centerOf(from)),
];

/** Whether the segment p–q passes through `b` shrunk by `inset` (Liang–Barsky). */
export const segmentHitsBox = (p: Point, q: Point, b: Box, inset = 0) => {
  const x1 = b.x + inset;
  const y1 = b.y + inset;
  const x2 = b.x + b.width - inset;
  const y2 = b.y + b.height - inset;
  if (x1 >= x2 || y1 >= y2) {
    return false;
  }
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const clip = (den: number, num: number) => {
    if (den === 0) {
      return num >= 0;
    }
    const t = num / den;
    if (den < 0) {
      if (t > t1) {
        return false;
      }
      if (t > t0) {
        t0 = t;
      }
    } else {
      if (t < t0) {
        return false;
      }
      if (t < t1) {
        t1 = t;
      }
    }
    return true;
  };
  return (
    clip(-dx, p[0] - x1) &&
    clip(dx, x2 - p[0]) &&
    clip(-dy, p[1] - y1) &&
    clip(dy, y2 - p[1])
  );
};

export const routeHitsBox = (route: Point[], b: Box, inset = 0) =>
  route.some((p, k) => k > 0 && segmentHitsBox(route[k - 1], p, b, inset));

/** The box around a polyline's middle, where its label is drawn. */
export const labelBoxOnRoute = (
  route: Point[],
  size: { width: number; height: number },
): Box => {
  const lengths = route
    .slice(1)
    .map((p, k) => Math.hypot(p[0] - route[k][0], p[1] - route[k][1]));
  const half = lengths.reduce((a, b) => a + b, 0) / 2;
  let walked = 0;
  for (let k = 0; k < lengths.length; k++) {
    if (walked + lengths[k] >= half) {
      const t = lengths[k] ? (half - walked) / lengths[k] : 0;
      const x = route[k][0] + (route[k + 1][0] - route[k][0]) * t;
      const y = route[k][1] + (route[k + 1][1] - route[k][1]) * t;
      return {
        x: x - size.width / 2,
        y: y - size.height / 2,
        width: size.width,
        height: size.height,
      };
    }
    walked += lengths[k];
  }
  const [x, y] = route[route.length - 1];
  return { x, y, width: size.width, height: size.height };
};

export type Outline = "rect" | "ellipse" | "diamond";

/** How far a shape reaches from its centre at relative offset t (0..1) across. */
const reach = (outline: Outline, t: number) =>
  outline === "diamond"
    ? Math.max(0, 1 - t)
    : outline === "ellipse"
    ? Math.sqrt(Math.max(0, 1 - t * t))
    : 1;

/**
 * Moves the ends of an orthogonal route from a box's bounding rectangle onto
 * its real outline (a diamond's or an ellipse's), sliding the first and last
 * segment toward the centre first when they would only graze the outline.
 */
export const fitRouteToOutlines = (
  route: Point[],
  from: { box: Box; outline: Outline },
  to: { box: Box; outline: Outline },
): Point[] => {
  const points = route.map((p) => [p[0], p[1]] as Point);
  if (points.length < 2) {
    return points;
  }
  const fit = (end: number, next: number, { box, outline }: typeof from) => {
    if (outline === "rect") {
      return;
    }
    const [cx, cy] = centerOf(box);
    const p = points[end];
    const q = points[next];
    const horizontal = Math.abs(p[1] - q[1]) < 0.01;
    const axis = horizontal ? 1 : 0; // the coordinate the segment runs at
    const half = horizontal ? box.height / 2 : box.width / 2;
    const centre = horizontal ? cy : cx;
    let t = Math.abs(p[axis] - centre) / half;
    // keep both ends of a two-point route where they are: moving one moves both
    if (t > 0.5 && points.length > 2) {
      const at = centre + Math.sign(p[axis] - centre) * half * 0.5;
      p[axis] = at;
      q[axis] = at;
      t = 0.5;
    }
    if (t >= 1) {
      return;
    }
    const other = 1 - axis;
    const [ocentre, ohalf] = horizontal
      ? [cx, box.width / 2]
      : [cy, box.height / 2];
    p[other] =
      ocentre + Math.sign(p[other] - ocentre || 1) * ohalf * reach(outline, t);
  };
  fit(0, 1, from);
  fit(points.length - 1, points.length - 2, to);
  return points;
};

/** Where the line from `box`'s centre towards `towards` leaves its outline. */
export const outlinePoint = (
  box: Box,
  outline: Outline,
  towards: Point,
): Point => {
  if (outline === "rect") {
    return closestEdgePoint(box, towards);
  }
  const [cx, cy] = centerOf(box);
  const dx = towards[0] - cx;
  const dy = towards[1] - cy;
  if (dx === 0 && dy === 0) {
    return [cx, cy];
  }
  const a = box.width / 2;
  const b = box.height / 2;
  const t =
    outline === "ellipse"
      ? 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2)
      : 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  return [cx + dx * t, cy + dy * t];
};

/** A straight line between two shapes, ending on their real outlines. */
export const straightBetween = (
  from: { box: Box; outline: Outline },
  to: { box: Box; outline: Outline },
): Point[] => [
  outlinePoint(from.box, from.outline, centerOf(to.box)),
  outlinePoint(to.box, to.outline, centerOf(from.box)),
];
