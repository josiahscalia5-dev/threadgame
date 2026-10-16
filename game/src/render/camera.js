/* Wishweave Wonders — renderer camera (WW.render.camera), docs/ARCHITECTURE.md §8 "Fit" and "Camera".

   fit       contain-fit of the 841 × 1870 plate into the CSS canvas: s0 CSS px per plate px, (x0, y0) plate origin.
   camera    {plate, z, fx, fy}: zoom over the fit and the plate point (fx, fy) shown at the canvas centre.
   view      {plate, s, ox, oy}: screen = (ox + x * s, oy + y * s) in CSS px; drawn with one setTransform.

   Target for Purl at path sample {x, y, w}: z = clamp(w0 / w, 1, zMax) (w0 = path start width) keeps him at a constant
   size; as z rises his screen anchor blends from where the contain-fit puts him toward (centre, anchorY · H); the view
   is then clamped inside the plate. At z = 1 the view is exactly the contain-fit, i.e. the approved composition. */
(function (WW) {
  'use strict';
  WW.render = WW.render || {};
  const U = function () { return WW.render.util; };
  const PW = 841, PH = 1870;

  function fit(W, H) {
    const s0 = Math.min(W / PW, H / PH);
    return { s0: s0, x0: (W - PW * s0) / 2, y0: (H - PH * s0) / 2, W: W, H: H };
  }

  function exitF(P) {
    const ev = (P.purl && P.purl.events) || [];
    for (let i = 0; i < ev.length; i++) if (ev[i].type === 'exit') return ev[i].f;
    return 1;
  }

  function eventF(P, type, fallback) {
    const ev = (P.purl && P.purl.events) || [];
    for (let i = 0; i < ev.length; i++) if (ev[i].type === type) return ev[i].f;
    return fallback;
  }

  /* Camera target for Purl at path fraction f on plate P (lane-0 point; his lane offset shows on screen). */
  function target(fitInfo, P, f) {
    const u = U();
    const path = P.purl.path;
    const s = WW.path.sample(path, f);
    const w0 = path[0][2];
    const zMax = (P.camera && P.camera.zMax) || 1.8;
    const anchorY = (P.camera && P.camera.anchorY) || 0.8;
    const z = u.clamp(w0 / Math.max(1, s.w), 1, zMax);
    const b = zMax > 1 ? u.smooth((z - 1) / (zMax - 1)) : 0;
    const W = fitInfo.W, H = fitInfo.H, s0 = fitInfo.s0;
    const nx = fitInfo.x0 + s.x * s0, ny = fitInfo.y0 + s.y * s0;     // where the contain-fit shows him
    const ax = u.lerp(nx, W / 2, b), ay = u.lerp(ny, anchorY * H, b);
    const k = s0 * z;
    let fx = s.x - (ax - W / 2) / k, fy = s.y - (ay - H / 2) / k;
    return clampCam(fitInfo, { plate: P.id, z: z, fx: fx, fy: fy });
  }

  function clampCam(fitInfo, cam) {
    const k = fitInfo.s0 * cam.z;
    const hw = fitInfo.W / (2 * k), hh = fitInfo.H / (2 * k);
    cam.fx = 2 * hw >= PW ? PW / 2 : Math.min(Math.max(cam.fx, hw), PW - hw);
    cam.fy = 2 * hh >= PH ? PH / 2 : Math.min(Math.max(cam.fy, hh), PH - hh);
    return cam;
  }

  /* Frame-rate independent follow; ~0.2 s to settle. */
  function follow(cam, tgt, dt) {
    const d = WW.util.damp;
    cam.z = d(cam.z, tgt.z, 0.07, dt);
    cam.fx = d(cam.fx, tgt.fx, 0.07, dt);
    cam.fy = d(cam.fy, tgt.fy, 0.07, dt);
    return cam;
  }

  function view(fitInfo, cam, dx) {
    const s = fitInfo.s0 * cam.z;
    return { plate: cam.plate, s: s, ox: fitInfo.W / 2 - cam.fx * s + (dx || 0), oy: fitInfo.H / 2 - cam.fy * s, z: cam.z, cam: cam };
  }

  function toScreen(v, x, y) { return { x: v.ox + x * v.s, y: v.oy + y * v.s }; }

  WW.render.camera = { fit: fit, target: target, clampCam: clampCam, follow: follow, view: view, toScreen: toScreen,
    exitF: exitF, eventF: eventF, PW: PW, PH: PH };
})(globalThis.WW = globalThis.WW || {});
