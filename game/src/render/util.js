/* Wishweave Wonders — renderer utilities (WW.render.util), docs/ARCHITECTURE.md §8.
   Offscreen canvases, cached sprites (tints, glows, shadows), atlas frame drawing, polygon/band geometry.
   Only defines functions at load; every cache is built lazily on first use and kept for the renderer's life. */
(function (WW) {
  'use strict';
  WW.render = WW.render || {};

  const clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  const lerp = function (a, b, t) { return a + (b - a) * t; };
  const smooth = function (t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const easeOutCubic = function (t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); };
  const easeInOut = function (t) { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const easeOutBack = function (t) { t = clamp(t, 0, 1); const c = 1.70158; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; };

  function makeCanvas(w, h) {
    const c = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  /* Supports ctx.filter (Chrome/Android WebView). Only used while building caches, never per frame. */
  let filterOK = null;
  function canFilter() {
    if (filterOK !== null) return filterOK;
    try { const c = makeCanvas(2, 2).getContext('2d'); c.filter = 'blur(2px)'; filterOK = c.filter === 'blur(2px)'; }
    catch (e) { filterOK = false; }
    return filterOK;
  }

  function imgReady(img) {
    return !!img && (img.complete === undefined || img.complete) && (img.naturalWidth || img.width) > 0;
  }

  /* Draws an atlas frame with its pivot at (x, y), uniformly scaled; sx/sy multiply the scale (squash). */
  function drawFrame(ctx, img, fr, x, y, scale, sx, sy, alpha) {
    if (!fr || !imgReady(img)) return false;
    sx = sx === undefined ? 1 : sx; sy = sy === undefined ? 1 : sy;
    const kx = scale * sx, ky = scale * sy;
    const prevA = ctx.globalAlpha;
    if (alpha !== undefined) ctx.globalAlpha = prevA * alpha;
    ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, x - fr.px * kx, y - fr.py * ky, fr.w * kx, fr.h * ky);
    ctx.globalAlpha = prevA;
    return true;
  }

  /* Cached canvas of a frame (optionally a sub-rectangle of it), with a tint applied once.
     mode 'multiply' keeps shading (used for the coral roll), 'silhouette' fills the alpha with a flat colour (rims). */
  function frameCanvas(cache, key, img, fr, build) {
    if (cache[key]) return cache[key];
    if (!imgReady(img)) return null;
    const c = makeCanvas(fr.w, fr.h), g = c.getContext('2d');
    g.drawImage(img, fr.x, fr.y, fr.w, fr.h, 0, 0, fr.w, fr.h);
    if (build) build(g, c);
    cache[key] = c;
    return c;
  }

  function silhouette(g, c, color) {
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
  }

  /* Soft radial glow sprite (64×64), drawn scaled. */
  function glowSprite(cache, color, inner) {
    const key = 'glow:' + color + ':' + (inner || 0);
    if (cache[key]) return cache[key];
    const c = makeCanvas(64, 64), g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, color);
    gr.addColorStop(inner || 0.25, color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    cache[key] = c;
    return c;
  }

  /* Contact shadow: warm dark ellipse with a soft edge (128×48). */
  function shadowSprite(cache) {
    if (cache.shadow) return cache.shadow;
    const c = makeCanvas(128, 48), g = c.getContext('2d');
    g.translate(64, 24); g.scale(1, 24 / 64);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(48,18,10,0.85)');
    gr.addColorStop(0.45, 'rgba(48,18,10,0.55)');
    gr.addColorStop(1, 'rgba(48,18,10,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 64, 0, Math.PI * 2); g.fill();
    cache.shadow = c;
    return c;
  }

  function drawShadow(ctx, cache, x, y, w, alpha) {
    const s = shadowSprite(cache);
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * alpha;
    ctx.drawImage(s, x - w / 2, y - w * 0.19, w, w * 0.375);
    ctx.globalAlpha = prev;
  }

  /* Four-point sparkle star. */
  function star(ctx, x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = rot + i * Math.PI / 4, rr = i % 2 ? r * 0.22 : r;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  function polyPath(ctx, poly) {
    ctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      if (i) ctx.lineTo(poly[i][0], poly[i][1]); else ctx.moveTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
  }

  function polyBox(poly) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function boxHit(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }

  /* ---- Bands (ribbon / shortcut): centre line [x, y, halfWidth] with half-widths along the normal ---- */
  const SUB = 10;
  function cr(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  function buildBand(points) {
    const n = points.length, pts = [];
    const at = function (i) { return points[clamp(i, 0, n - 1)]; };
    for (let i = 0; i < n - 1; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let k = 0; k < SUB; k++) {
        const t = k / SUB;
        pts.push({ x: cr(p0[0], p1[0], p2[0], p3[0], t), y: cr(p0[1], p1[1], p2[1], p3[1], t), hw: lerp(p1[2], p2[2], t) });
      }
    }
    const last = points[n - 1];
    pts.push({ x: last[0], y: last[1], hw: last[2] });
    const N = pts.length;
    let cum = 0;
    for (let i = 0; i < N; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      pts[i].tx = tx; pts[i].ty = ty; pts[i].nx = -ty; pts[i].ny = tx;
      if (i) {
        const p = pts[i - 1], q = pts[i];
        cum += Math.hypot(q.x - p.x, q.y - p.y) / Math.max(8, (p.hw + q.hw) / 2);
      }
      pts[i].s = cum;
    }
    for (let i = 0; i < N; i++) pts[i].s /= (cum || 1);
    let box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      for (let side = -1; side <= 1; side += 2) {
        const x = p.x + side * p.nx * p.hw, y = p.y + side * p.ny * p.hw;
        box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
        box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
      }
    }
    return { pts: pts, box: box };
  }

  function bandAt(band, s) {
    const pts = band.pts; s = clamp(s, 0, 1);
    let i = 1;
    while (i < pts.length - 1 && pts[i].s < s) i++;
    const a = pts[i - 1], b = pts[i];
    const t = (s - a.s) / ((b.s - a.s) || 1);
    const tx = lerp(a.tx, b.tx, t), ty = lerp(a.ty, b.ty, t), l = Math.hypot(tx, ty) || 1;
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), hw: lerp(a.hw, b.hw, t), tx: tx / l, ty: ty / l, nx: -ty / l, ny: tx / l, s: s };
  }

  /* Adds the band section [s0, s1] as consistently wound quads (a union that tolerates folds at tight turns). */
  function bandPath(ctx, band, s0, s1, widen) {
    widen = widen || 1;
    const pts = [bandAt(band, s0)];
    for (let i = 0; i < band.pts.length; i++) { const p = band.pts[i]; if (p.s > s0 && p.s < s1) pts.push(p); }
    pts.push(bandAt(band, s1));
    ctx.beginPath();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const q = [
        [a.x - a.nx * a.hw * widen, a.y - a.ny * a.hw * widen], [b.x - b.nx * b.hw * widen, b.y - b.ny * b.hw * widen],
        [b.x + b.nx * b.hw * widen, b.y + b.ny * b.hw * widen], [a.x + a.nx * a.hw * widen, a.y + a.ny * a.hw * widen]
      ];
      let area = 0;
      for (let k = 0; k < 4; k++) { const u = q[k], v = q[(k + 1) % 4]; area += u[0] * v[1] - v[0] * u[1]; }
      if (area < 0) q.reverse();
      ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[1][0], q[1][1]); ctx.lineTo(q[2][0], q[2][1]); ctx.lineTo(q[3][0], q[3][1]);
      ctx.closePath();
    }
  }

  /* Edge polylines of the band section, for stitched outlines. */
  function bandEdges(band, s0, s1) {
    const L = [], Rr = [];
    const push = function (p) { L.push([p.x - p.nx * p.hw, p.y - p.ny * p.hw]); Rr.push([p.x + p.nx * p.hw, p.y + p.ny * p.hw]); };
    push(bandAt(band, s0));
    for (let i = 0; i < band.pts.length; i++) { const p = band.pts[i]; if (p.s > s0 && p.s < s1) push(p); }
    push(bandAt(band, s1));
    return [L, Rr];
  }

  function polyline(ctx, pts) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) { if (i) ctx.lineTo(pts[i][0], pts[i][1]); else ctx.moveTo(pts[i][0], pts[i][1]); }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* Small deterministic hash noise for cosmetic variation (no shared RNG state). */
  function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

  WW.render.util = {
    clamp: clamp, lerp: lerp, smooth: smooth, easeOutCubic: easeOutCubic, easeInOut: easeInOut, easeOutBack: easeOutBack,
    makeCanvas: makeCanvas, canFilter: canFilter, imgReady: imgReady,
    drawFrame: drawFrame, frameCanvas: frameCanvas, silhouette: silhouette,
    glowSprite: glowSprite, shadowSprite: shadowSprite, drawShadow: drawShadow, star: star,
    polyPath: polyPath, polyBox: polyBox, boxHit: boxHit, polyline: polyline, roundRect: roundRect,
    buildBand: buildBand, bandAt: bandAt, bandPath: bandPath, bandEdges: bandEdges, hash: hash
  };
})(globalThis.WW = globalThis.WW || {});
