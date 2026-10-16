/* Wishweave Wonders — plate background layers (WW.render.world), docs/ARCHITECTURE.md §8 "Fit", "Layers",
   "Route openings" and occluders.

   framing      cached blurred, darkened copy of a plate, cover-fitted behind the contain-fit (never stretched)
   plate        the clean plate (only its visible source rectangle is sampled)
   route ghost  the clean plates show OPENED routes; before a ribbon/shortcut opens, the not-yet-woven part of its band
                (roll position → far end) is drawn as a pale, desaturated, shimmering ghost with stitched edges, and a carpet
                roll (coral-tinted on the ribbon) sits at the band start. While animating, the roll travels the band
                (half-widths offset along the band normal) revealing the full-colour plate behind it. Open = untouched plate.
   occluders    redraw this background inside a polygon over actors that are farther away (ground y < behindY). */
(function (WW) {
  'use strict';
  WW.render = WW.render || {};
  const U = function () { return WW.render.util; };
  const PW = 841, PH = 1870;

  /* Sub-rectangle of feat.carpet-rolled holding only the rolled cylinder (frame-relative). */
  const ROLL_SUB = { x: 92, y: 3, w: 333, h: 108 };

  function plateImg(R, plateId) {
    const P = R.plates[plateId];
    return R.images[(P && P.image) || plateId];
  }

  /* ---------- framing ---------- */
  function framingCanvas(R, plateId) {
    const key = 'framing:' + plateId;
    if (R.cache[key]) return R.cache[key];
    const img = plateImg(R, plateId), u = U();
    if (!u.imgReady(img)) return null;
    const w = 106, h = 236;
    const c = u.makeCanvas(w, h), g = c.getContext('2d');
    if (u.canFilter()) {
      // blur at an intermediate size so the edges stay soft without per-frame filters
      const m = u.makeCanvas(212, 472), mg = m.getContext('2d');
      mg.drawImage(img, 0, 0, 212, 472);
      g.filter = 'blur(4px) saturate(0.85)';
      g.drawImage(m, -8, -8, w + 16, h + 16);
      g.filter = 'none';
    } else {
      const m = u.makeCanvas(27, 59); m.getContext('2d').drawImage(img, 0, 0, 27, 59);
      g.imageSmoothingEnabled = true; g.drawImage(m, 0, 0, w, h);
    }
    g.fillStyle = 'rgba(28, 12, 6, 0.5)';
    g.fillRect(0, 0, w, h);
    R.cache[key] = c;
    return c;
  }

  /* Screen-space framing behind a view; drawn only where the plate does not cover the target rectangle. */
  function drawFraming(R, ctx, v, rect) {
    const x0 = v.ox, y0 = v.oy, x1 = v.ox + PW * v.s, y1 = v.oy + PH * v.s;
    if (x0 <= rect.x + 0.5 && y0 <= rect.y + 0.5 && x1 >= rect.x + rect.w - 0.5 && y1 >= rect.y + rect.h - 0.5) return;
    const c = framingCanvas(R, v.plate);
    if (!c) { ctx.fillStyle = '#2b150c'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); return; }
    const W = R.fit.W, H = R.fit.H;
    const k = Math.max(W / PW, H / PH) * 1.04;
    const w = PW * k, h = PH * k;
    ctx.drawImage(c, (W - w) / 2, (H - h) / 2, w, h);
  }

  /* ---------- plate ---------- */
  function drawPlate(R, ctx, v, box) {
    const img = plateImg(R, v.plate);
    if (!U().imgReady(img)) return;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const kx = iw / PW, ky = ih / PH;
    // visible plate rectangle (optionally limited to a box), in plate px
    let x0 = Math.max(0, -v.ox / v.s), y0 = Math.max(0, -v.oy / v.s);
    let x1 = Math.min(PW, (R.fit.W - v.ox) / v.s), y1 = Math.min(PH, (R.fit.H - v.oy) / v.s);
    if (box) { x0 = Math.max(x0, box.x0 - 2); y0 = Math.max(y0, box.y0 - 2); x1 = Math.min(x1, box.x1 + 2); y1 = Math.min(y1, box.y1 + 2); }
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.drawImage(img, x0 * kx, y0 * ky, (x1 - x0) * kx, (y1 - y0) * ky, x0, y0, x1 - x0, y1 - y0);
  }

  /* ---------- route ghost + roll ---------- */
  function routeInfo(R, plateId) {
    const key = 'route:' + plateId;
    if (R.cache[key] !== undefined) return R.cache[key];
    const P = R.plates[plateId];
    let info = null;
    if (P && P.ribbon && P.ribbon.band) info = { kind: 'ribbon', stitch: 'ribbon', band: U().buildBand(P.ribbon.band) };
    else if (P && P.shortcut && P.shortcut.band) {
      // p02: the runner's near part is already woven (approved 02); the roll waits at `ghostFrom` and its width is
      // `rollK` × the band width so that at the band end it matches the plate's own roll
      info = { kind: 'shortcut', stitch: 'shortcut', band: U().buildBand(P.shortcut.band),
        from: P.shortcut.ghostFrom || 0, rollK: P.shortcut.rollK || 1.1 };
    }
    if (info) {
      const b = info.band.box;
      info.box = { x0: Math.max(0, Math.floor(b.x0 - 6)), y0: Math.max(0, Math.floor(b.y0 - 6)),
        x1: Math.min(PW, Math.ceil(b.x1 + 6)), y1: Math.min(PH, Math.ceil(b.y1 + 6)) };
    }
    R.cache[key] = info;
    return info;
  }

  function ghostCanvas(R, plateId, info) {
    if (info.ghost) return info.ghost;
    const img = plateImg(R, plateId), u = U();
    if (!u.imgReady(img)) return null;
    const b = info.box, w = b.x1 - b.x0, h = b.y1 - b.y0;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const c = u.makeCanvas(w, h), g = c.getContext('2d');
    g.drawImage(img, b.x0 * iw / PW, b.y0 * ih / PH, w * iw / PW, h * ih / PH, 0, 0, w, h);
    // desaturate (blend modes work on file:// images where getImageData would be blocked)
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    if (g.globalCompositeOperation !== 'source-over') g.globalCompositeOperation = 'source-over';
    // pale wash, faintly tinted toward the route's own colour
    // ribbon: the cream, not-yet-woven crochet of the approved TOUCH/PULL frames
    g.fillStyle = info.kind === 'ribbon' ? 'rgba(255, 247, 232, 0.55)' : 'rgba(240, 248, 242, 0.5)';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = info.kind === 'ribbon' ? 'rgb(250, 230, 200)' : 'rgb(200, 232, 230)';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    info.ghost = c;
    return c;
  }

  function rollCanvas(R, kind) {
    const key = 'roll:' + kind;
    if (R.cache[key]) return R.cache[key];
    const fr = R.assets.frames['feat.carpet-rolled'], img = R.images[fr && fr.img], u = U();
    if (!fr || !u.imgReady(img)) return null;
    const sub = ROLL_SUB;
    const c = u.makeCanvas(sub.w, sub.h), g = c.getContext('2d');
    g.drawImage(img, fr.x + sub.x, fr.y + sub.y, sub.w, sub.h, 0, 0, sub.w, sub.h);
    // soften the cut along the bottom, where the flat carpet starts in the source frame
    g.globalCompositeOperation = 'destination-out';
    const gr = g.createLinearGradient(0, sub.h - 10, 0, sub.h);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = gr; g.fillRect(0, sub.h - 10, sub.w, 10);
    if (kind === 'ribbon') {
      // coral cylinder between the gold braid ends (ends keep their gold)
      g.globalCompositeOperation = 'source-atop';
      g.save(); g.beginPath(); g.rect(40, 0, sub.w - 80, sub.h); g.clip();
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = 'rgb(246, 92, 120)'; g.fillRect(0, 0, sub.w, sub.h);
      g.restore();
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(img, fr.x + sub.x, fr.y + sub.y, sub.w, sub.h, 0, 0, sub.w, sub.h);
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = gr; g.fillRect(0, sub.h - 10, sub.w, 10);
    }
    g.globalCompositeOperation = 'source-over';
    R.cache[key] = c;
    return c;
  }

  /* Roll position along the band: 0 closed (roll at the start), 1 open (gone). */
  function openProgress(st) {
    if (!st) return 0;
    if (st.interaction === 'pull' && WW.render.pull) return WW.render.pull.openProgress(st);   // opening lesson (pull.js)
    if (st.state === 'open') return 1;
    if (st.state === 'animating') return U().easeInOut(st.t || 0);
    return 0;
  }

  function drawRouteGhost(R, ctx, v, state, clock) {
    const info = routeInfo(R, v.plate);
    if (!info) return;
    const st = state && state.stitches && state.stitches[info.stitch];
    const s0 = openProgress(st);
    if (s0 >= 1) return;
    const s = info.from ? info.from + (1 - info.from) * s0 : s0;
    const u = U(), band = info.band;
    const g = ghostCanvas(R, v.plate, info);
    // ghost (not yet woven) part: pre-masked to the band section [s, 1] and cached while s holds still (the long
    // 'ready' wait), so a frame draws one image instead of rasterising the band clip (≈ 10 ms/frame in CPU raster)
    const m = maskedGhost(info, g, s);
    if (m) { ctx.globalAlpha = 0.93; ctx.drawImage(m, info.box.x0, info.box.y0); ctx.globalAlpha = 1; }
    // shimmer: soft glints drifting up the band (kept inside it by their size; no clip)
    const glow = u.glowSprite(R.cache, 'rgba(255,250,240,0.9)', 0.1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const ss = s + (1 - s) * (((clock * 0.18) + k / 3) % 1);
      const p = u.bandAt(band, ss);
      const r = p.hw * 0.95;
      ctx.globalAlpha = 0.2 * Math.sin(Math.PI * (((clock * 0.18) + k / 3) % 1));
      ctx.drawImage(glow, p.x - r, p.y - r * 0.8, 2 * r, 1.6 * r);
    }
    ctx.restore();
    // stitched template edges along the unwoven part
    const edges = u.bandEdges(band, s, 1);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([9, 9]);
    ctx.lineDashOffset = -clock * 14;
    ctx.strokeStyle = 'rgba(255, 238, 190, 0.75)';
    ctx.lineWidth = 3.2;
    u.polyline(ctx, edges[0]); ctx.stroke();
    u.polyline(ctx, edges[1]); ctx.stroke();
    ctx.restore();
    // the roll at the weaving front
    drawRoll(R, ctx, info, s, st);
  }

  /* The ghost canvas masked to the band section [s, 1]; rebuilt only when s changes (one reusable canvas). */
  function maskedGhost(info, g, s) {
    if (!g) return null;
    if (info.masked && info.maskS === s) return info.masked;
    const u = U(), b = info.box;
    if (!info.masked) info.masked = u.makeCanvas(g.width, g.height);
    const c = info.masked, mg = c.getContext('2d');
    mg.setTransform(1, 0, 0, 1, 0, 0);
    mg.clearRect(0, 0, c.width, c.height);
    mg.save();
    mg.translate(-b.x0, -b.y0);
    u.bandPath(mg, info.band, s, 1, 1.0);
    mg.clip();
    mg.drawImage(g, b.x0, b.y0);
    mg.restore();
    info.maskS = s;
    return c;
  }

  /* Roll geometry at band fraction s: centre point on the band, drawn size and rotation (shared with pull.js,
     which ties the gold strand to the roll's fastening). */
  function rollGeomInfo(info, s) {
    const p = U().bandAt(info.band, s);
    const w = 2 * p.hw * (info.rollK || 1.1);
    const h = w * (ROLL_SUB.h / ROLL_SUB.w) * (1 - 0.32 * s);
    return { x: p.x, y: p.y, w: w, h: h, ang: Math.atan2(p.ny, p.nx) };
  }
  function rollGeom(R, plateId, s) {
    const info = routeInfo(R, plateId);
    return info ? rollGeomInfo(info, s) : null;
  }

  function drawRoll(R, ctx, info, s, st) {
    const c = rollCanvas(R, info.kind);
    if (!c) return;
    const u = U();
    const t = st && st.state === 'animating' ? (st.t || 0) : 0;
    const fade = 1 - u.smooth((t - 0.86) / 0.14);
    if (fade <= 0) return;
    const p = rollGeomInfo(info, s), w = p.w, h = p.h, ang = p.ang;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    u.drawShadow(ctx, R.cache, 0, h * 0.18, w * 1.02, 0.45 * fade);
    ctx.globalAlpha = fade;
    ctx.drawImage(c, -w / 2, -h * 0.8, w, h);
    ctx.restore();
  }

  function ghostBox(R, plateId, state) {
    const info = routeInfo(R, plateId);
    if (!info) return null;
    const st = state && state.stitches && state.stitches[info.stitch];
    return openProgress(st) >= 1 ? null : info.box;
  }

  /* Background = plate + unopened-route ghost (+ roll). With a clip polygon it is the occluder redraw. */
  function drawBackground(R, ctx, v, state, clock, poly) {
    if (poly) {
      const u = U(), box = u.polyBox(poly);
      ctx.save();
      u.polyPath(ctx, poly);
      ctx.clip();
      drawPlate(R, ctx, v, box);
      const gb = ghostBox(R, v.plate, state);
      if (gb && u.boxHit(gb, box)) drawRouteGhost(R, ctx, v, state, clock);
      ctx.restore();
      return;
    }
    drawPlate(R, ctx, v, null);
    drawRouteGhost(R, ctx, v, state, clock);
  }

  WW.render.world = {
    drawFraming: drawFraming, drawPlate: drawPlate, drawBackground: drawBackground,
    drawRouteGhost: drawRouteGhost, routeInfo: routeInfo, openProgress: openProgress, framingCanvas: framingCanvas,
    rollGeom: rollGeom,
    plateImg: plateImg
  };
})(globalThis.WW = globalThis.WW || {});
