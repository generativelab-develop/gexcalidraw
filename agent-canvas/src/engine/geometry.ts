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
