/* Wishweave Wonders — builds the connected 3D world from the paintings' route data (WW.world.build).

   World units: 1 = Purl's width. Y is up. A scene's local frame has its painting camera at (0, h, 0) looking along
   -Z (pitched down by theta); heading phi rotates a frame about Y (forward = (sin phi, 0, -cos phi), right =
   (cos phi, 0, sin phi), + phi turns right).

   For every point of Purl's painted path (image x, y and his on-screen width w) the distance from the painting's
   camera is f/w, so each scene's road becomes a real 3D surface that projects exactly onto the painted road. The
   connectors are generated roads between one scene's exit and the next scene's entrance; each next scene is
   placed in the world where its connector arrives. Runs in the browser and in Node (tests, texture baking). */
(function (WW) {
  'use strict';
  const U = WW.util;

  function fwd(phi) { return [Math.sin(phi), 0, -Math.cos(phi)]; }
  function right(phi) { return [Math.cos(phi), 0, Math.sin(phi)]; }
  function headingOf(dx, dz) { return Math.atan2(dx, -dz); }
  function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  /* ------------------------------------------------------------------ a painted scene in 3D */
  function buildArea(id, plate, L, layout) {
    const IW = layout.imageW, IH = layout.imageH;
    const f = (IH / 2) / Math.tan(layout.vfov / 2 * Math.PI / 180);
    const cx = IW / 2, cy = IH / 2;
    const theta = Math.atan((cy - L.horizon) / f);
    const h = L.height * Math.cos(theta);
    const ct = Math.cos(theta), st = Math.sin(theta);
    /* image point with sprite width w -> scene-local (x right, y up, z back) */
    function local(x, y, w) {
      const zc = f / w, X = (x - cx) / w, Yc = -(y - cy) / w;
      return [X, h + Yc * ct - zc * st, -(zc * ct + Yc * st)];
    }
    const path = plate.purl.path;
    const cpF = path.map(function (p, i) { return i === 0 ? 0 : i === path.length - 1 ? 1 : WW.path.project(path, p[0], p[1]); });
    function edgesAt(fr) {
      const E = L.edges;
      if (fr <= cpF[0]) return E[0];
      for (let i = 1; i < cpF.length; i++) {
        if (fr <= cpF[i]) {
          const k = (fr - cpF[i - 1]) / Math.max(1e-6, cpF[i] - cpF[i - 1]);
          return [U.lerp(E[i - 1][0], E[i][0], k), U.lerp(E[i - 1][1], E[i][1], k)];
        }
      }
      return E[E.length - 1];
    }
    const exitEv = (plate.purl.events || []).filter(function (e) { return e.type === 'exit'; })[0];
    const exitF = exitEv ? exitEv.f : 1;

    // Dense samples along Purl's route (image path fraction fi), with the carpet edges on the same image row.
    const N = 160, samples = [];
    for (let i = 0; i <= N; i++) {
      const fi = i / N;
      const s = WW.path.sample(path, fi);
      const e = edgesAt(fi);
      samples.push({ fi: fi, ix: s.x, iy: s.y, iw: s.w, ilane: s.lane,
                     c: local(s.x, s.y, s.w), l: local(e[0], s.y, s.w), r: local(e[1], s.y, s.w), laneW: s.lane / s.w });
    }
    // Floor rows between the image's bottom edge and Purl's start (painted, nearer than where he stands).
    const s0 = samples[0], floor = [];
    const c1 = L.height;
    for (let y = IH; y > s0.iy + 1; y -= 12) {
      const w = (y - L.horizon) / c1;
      const e = L.edges[0];
      floor.push({ iy: y, iw: w, c: local(s0.ix, y, w), l: local(e[0], y, w), r: local(e[1], y, w) });
    }
    // 3D arc length along the route (scene-local).
    let acc = 0;
    samples.forEach(function (sm, i) {
      if (i) { const p = samples[i - 1].c; acc += Math.hypot(sm.c[0] - p[0], sm.c[1] - p[1], sm.c[2] - p[2]); }
      sm.dist = acc;
    });
    const exitIdx = Math.round(exitF * N);
    return {
      id: id, image: plate.image, plate: plate,
      cam: { f: f, cx: cx, cy: cy, theta: theta, h: h, vfov: layout.vfov, aspect: IW / IH },
      backdrop: L.backdrop, wall: L.wall, samples: samples, floor: floor, exitF: exitF, exitIdx: exitIdx,
      length: samples[exitIdx].dist, local: local,
      // placement, filled by placeArea()
      phi: 0, origin: [0, 0, 0]
    };
  }

  function toWorld(area, p) {
    const c = Math.cos(area.phi), s = Math.sin(area.phi);
    return [area.origin[0] + p[0] * c - p[2] * s, area.origin[1] + p[1], area.origin[2] + p[0] * s + p[2] * c];
  }
  function placeArea(area, phi, origin) {
    area.phi = phi; area.origin = origin;
    area.samples.forEach(function (sm) { sm.cw = toWorld(area, sm.c); sm.lw = toWorld(area, sm.l); sm.rw = toWorld(area, sm.r); });
    area.floor.forEach(function (fl) { fl.cw = toWorld(area, fl.c); fl.lw = toWorld(area, fl.l); fl.rw = toWorld(area, fl.r); });
    // Painting camera in the world and its relation to Purl's start (used by the chase camera).
    area.camPos = toWorld(area, [0, area.cam.h, 0]);
    area.camPhi = phi;
    const st = area.samples[0].cw;
    const off = [area.camPos[0] - st[0], area.camPos[1] - st[1], area.camPos[2] - st[2]];
    const F = fwd(phi), R = right(phi);
    area.rig = { back: -(off[0] * F[0] + off[2] * F[2]), up: off[1], lat: off[0] * R[0] + off[2] * R[2], pitch: area.cam.theta };
  }

  /* Route samples of one placed scene, from Purl's start (fi = 0) to the scene's exit, by world distance. */
  function areaTrack(area) {
    const pts = [];
    for (let i = 0; i <= area.exitIdx; i++) {
      const sm = area.samples[i];
      const nx = area.samples[Math.min(area.samples.length - 1, i + 1)].cw, pv = area.samples[Math.max(0, i - 1)].cw;
      const phi = headingOf(nx[0] - pv[0], nx[2] - pv[2]);
      const R = right(phi);
      const latL = (sm.lw[0] - sm.cw[0]) * R[0] + (sm.lw[2] - sm.cw[2]) * R[2];
      const latR = (sm.rw[0] - sm.cw[0]) * R[0] + (sm.rw[2] - sm.cw[2]) * R[2];
      pts.push({ d: sm.dist, p: sm.cw, phi: phi, latL: latL, latR: latR, lane: sm.laneW, fi: sm.fi });
    }
    return pts;
  }

  /* ------------------------------------------------------------------ a connecting road */
  function buildConnector(id, spec, start, nextWidth) {
    const pts = [];
    const turn = (spec.turn || 0) * Math.PI / 180, R = spec.radius || 5, S = spec.straight || 6;
    const arcLen = Math.abs(turn) * R, total = arcLen + S;
    const n = Math.max(24, Math.round(total / 0.15));
    let p = start.p.slice(), phi = start.phi;
    const w0 = start.width, w1 = nextWidth || spec.width || w0;
    for (let i = 0; i <= n; i++) {
      const d = total * i / n;
      const k = d / total;
      const half = U.lerp(w0, w1, U.smooth(k)) / 2;
      pts.push({ d: d, p: [p[0], start.p[1] + (spec.rise || 0) * U.smooth(k), p[2]], phi: phi, latL: -half, latR: half,
                 lane: Math.min(0.45, half * 0.42) });
      if (i === n) break;
      const step = total / n;
      // heading changes only along the arc part
      const dTurn = d < arcLen ? Math.min(step, arcLen - d) : 0;
      const phiMid = phi + (dTurn / Math.max(1e-6, arcLen)) * turn * 0.5;
      const F = fwd(phiMid);
      p = [p[0] + F[0] * step, p[1], p[2] + F[2] * step];
      phi += arcLen > 0 ? (dTurn / arcLen) * turn : 0;
    }
    return { id: id, kind: 'connector', length: total, track: pts, spec: spec };
  }

  /* ------------------------------------------------------------------ the whole course */
  function build(opts) {
    opts = opts || {};
    const layout = opts.layout || WW.WORLD_LAYOUT, plates = opts.plates || WW.PLATES, level = opts.level || WW.LEVEL;
    const ids = opts.areas || Object.keys(layout.areas);
    const areas = {};
    ids.forEach(function (id) { areas[id] = buildArea(id, plates[id], layout.areas[id], layout); });

    // Walk the level route: place the first scene at the origin, then every connector and the scene after it.
    const segs = [];
    let prevArea = null;
    for (let i = 0; i < level.route.length; i++) {
      const def = level.route[i];
      if (def.kind === 'plate') {
        const area = areas[def.plate];
        if (!area) break;                       // not built yet (later scenes)
        if (!prevArea) placeArea(area, 0, [0, 0, 0]);
        segs.push({ id: def.id, kind: 'plate', area: area, length: area.length, track: areaTrack(area) });
        prevArea = area;
      } else {
        const spec = layout.connectors[def.id];
        const nextDef = level.route[i + 1];
        const next = nextDef && areas[nextDef.plate];
        if (!spec || !next) break;
        const last = segs[segs.length - 1].track;
        const end = last[last.length - 1];
        const start = { p: end.p, phi: end.phi, width: end.latR - end.latL };
        const ns = next.samples[0];
        const conn = buildConnector(def.id, spec, start, Math.abs(ns.r[0] - ns.l[0]));
        // Place the next scene where the connector arrives, its road continuing the connector's direction.
        const arrive = conn.track[conn.track.length - 1];
        const a2 = next.samples[2].c, a0 = next.samples[0].c;
        const phiLocal = headingOf(a2[0] - a0[0], a2[2] - a0[2]);
        const phiB = wrapAngle(arrive.phi - phiLocal);
        const c = Math.cos(phiB), sn = Math.sin(phiB), s0 = next.samples[0].c;
        const origin = [arrive.p[0] - (s0[0] * c - s0[2] * sn), arrive.p[1] - s0[1], arrive.p[2] - (s0[0] * sn + s0[2] * c)];
        placeArea(next, phiB, origin);
        segs.push(conn);
      }
    }
    let total = 0;
    segs.forEach(function (s) { s.start = total; total += s.length; });
    return { layout: layout, areas: areas, segs: segs, length: total, sample: function (segIndex, f) { return sampleSeg(segs[segIndex], f); } };
  }

  /* Pose on a segment at fraction f of its length: position, heading, lateral bounds and lane spacing. */
  function sampleSeg(seg, f) {
    const tr = seg.track, d = U.clamp(f, 0, 1) * seg.length;
    let lo = 0, hi = tr.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr[m].d <= d) lo = m; else hi = m; }
    const a = tr[lo], b = tr[hi], k = (d - a.d) / Math.max(1e-9, b.d - a.d);
    const dphi = wrapAngle(b.phi - a.phi);
    return {
      p: [U.lerp(a.p[0], b.p[0], k), U.lerp(a.p[1], b.p[1], k), U.lerp(a.p[2], b.p[2], k)],
      phi: a.phi + dphi * k,
      latL: U.lerp(a.latL, b.latL, k), latR: U.lerp(a.latR, b.latR, k),
      lane: U.lerp(a.lane, b.lane, k),
      fi: a.fi !== undefined ? U.lerp(a.fi, b.fi, k) : null,
      slope: (b.p[1] - a.p[1]) / Math.max(1e-6, b.d - a.d)
    };
  }

  WW.world = { build: build, fwd: fwd, right: right, headingOf: headingOf, wrapAngle: wrapAngle, toWorld: toWorld };
})(globalThis.WW = globalThis.WW || {});
