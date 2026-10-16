/* Route geometry shared by the simulation, renderer and authoring tools.

   A path is an array of control points [x, y, w, lane] in plate design pixels
   (841 × 1870):
     x, y  foot point of the lane centre (bottom-centre sprite anchor)
     w     the racer's on-screen sprite width at that point (depth scale)
     lane  horizontal distance in plate pixels between adjacent lanes (0 = single file)

   Positions are smoothed with a Catmull-Rom spline. The path parameter f (0..1)
   is proportional to distance measured in racer widths (∫ |dp| / w), so a racer
   moving at a constant world speed covers equal f per second whether the path is
   near the camera or far away. Fractions in plate data always use this metric. */
(function (WW) {
  'use strict';
  const SUB = 12;
  const cache = new WeakMap();

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  function prepare(points) {
    let prepared = cache.get(points);
    if (prepared) return prepared;
    if (!points || points.length < 2) throw new Error('A path needs at least two points');
    const n = points.length, dense = [];
    const at = function (i) { return points[Math.max(0, Math.min(n - 1, i))]; };
    for (let i = 0; i < n - 1; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let k = 0; k < SUB; k++) {
        const t = k / SUB;
        dense.push([
          catmull(p0[0], p1[0], p2[0], p3[0], t),
          catmull(p0[1], p1[1], p2[1], p3[1], t),
          p1[2] + (p2[2] - p1[2]) * t,
          (p1[3] || 0) + ((p2[3] || 0) - (p1[3] || 0)) * t
        ]);
      }
    }
    const last = points[n - 1];
    dense.push([last[0], last[1], last[2], last[3] || 0]);
    const cum = [0];
    for (let i = 1; i < dense.length; i++) {
      const a = dense[i - 1], b = dense[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(1, (a[2] + b[2]) / 2);
      cum.push(cum[i - 1] + len);
    }
    const total = cum[cum.length - 1] || 1;
    prepared = { dense: dense, cum: cum.map(function (c) { return c / total; }), widths: total };
    cache.set(points, prepared);
    return prepared;
  }

  /* Returns {x, y, w, lane, tx, ty, f}; (tx, ty) is the unit direction of travel. */
  function sample(points, f) {
    const p = prepare(points);
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const cum = p.cum, d = p.dense;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= f) lo = mid; else hi = mid;
    }
    const span = cum[hi] - cum[lo] || 1;
    const t = (f - cum[lo]) / span;
    const a = d[lo], b = d[hi];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    return {
      x: a[0] + (b[0] - a[0]) * t,
      y: a[1] + (b[1] - a[1]) * t,
      w: a[2] + (b[2] - a[2]) * t,
      lane: a[3] + (b[3] - a[3]) * t,
      tx: tx / len, ty: ty / len, f: f
    };
  }

  /* Path fraction of the point on the path closest to (x, y). */
  function project(points, x, y) {
    const p = prepare(points);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < p.dense.length; i++) {
      const q = p.dense[i];
      const d = (q[0] - x) * (q[0] - x) + (q[1] - y) * (q[1] - y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return p.cum[best];
  }

  /* Foot point for a racer at fraction f, lane value laneX (-1..1, continuous)
     and jump height fraction jumpH (0..1). Lanes offset horizontally. */
  function racerPoint(points, f, laneX, jumpH) {
    const s = sample(points, f);
    return {
      x: s.x + (laneX || 0) * s.lane,
      y: s.y - (jumpH || 0) * s.w * 0.42,
      groundY: s.y,
      w: s.w, tx: s.tx, ty: s.ty, f: s.f
    };
  }

  /* Length of the path in racer widths; useful when choosing segment lengths. */
  function widths(points) { return prepare(points).widths; }

  WW.path = { prepare: prepare, sample: sample, project: project, racerPoint: racerPoint, widths: widths };
})(globalThis.WW = globalThis.WW || {});
