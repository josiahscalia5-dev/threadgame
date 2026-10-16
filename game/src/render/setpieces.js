/* Wishweave Wonders — plate set pieces (WW.render.setpieces), docs/ARCHITECTURE.md §8 "Tassels", "butterfly", "gate",
   "Snagling", "Spools" (callouts) and Loop's task effects. Drawn from read-only sim state; cosmetic timing only from the
   renderer clock. Every sprite variant (ropes, embroidery, shadows, veil) is cached once; no per-frame canvas filters.

   Hooks called by renderer.js for one plate view v (world transform set unless noted):
     behind(R, ctx, v, state)          after the plate/route ghost: p02 teal preview + Snagling cameo, p03 tassels on gold
                                       ropes, p06 tapestry embroidery butterfly, p07 gate veil
     entries(R, v, P, state, list)     depth-sorted actors: p04 Snagling (occluders apply)
     afterRacer(R, ctx, who, st, pose, state)   ankle yarn + motion marks (tangle), recovery swirl + held spool, Loop's
                                       stumble stars — drawn right after that racer
     air(R, ctx, v, state)             after actors + occluders: butterfly emergence/flight/placing/exit, Snagling's
                                       yarn line, gate flash, Loop's task sparkles
     screen(R, ctx, v, state)          CSS-px transform: the approved "−1 THREAD" pill and "+1 THREAD" text callouts
     update(R, dt, state), event(R, e, state), onDrop(R, ...), onRecover(R, ...) */
(function (WW) {
  'use strict';
  WW.render = WW.render || {};
  const U = function () { return WW.render.util; };
  const TAU = Math.PI * 2;

  function S(R) {
    return R.sp || (R.sp = { callouts: [], recover: null, ankleT: -9, gateBurstAt: -9, blockedAt: -9, petalAcc: 0,
      loopTaskSeen: {} });
  }

  function frameOf(R, name) { return R.assets.frames[name] || null; }

  /* Draws a frame with its pivot at (x, y) and width w. o: {flip, rot, sx, sy, alpha, clipY (frame px kept from top)} */
  function drawAt(ctx, R, name, x, y, w, o) {
    const f = frameOf(R, name);
    if (!f) return null;
    const im = R.images[f.img];
    if (!U().imgReady(im)) return null;
    o = o || {};
    const k = w / f.w;
    const h = o.clipY ? Math.min(f.h, o.clipY) : f.h;
    ctx.save();
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale((o.flip ? -1 : 1) * (o.sx || 1), o.sy || 1);
    if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
    ctx.drawImage(im, f.x, f.y, f.w, h, -f.px * k, -f.py * k, f.w * k, h * k);
    ctx.restore();
    return { k: k, f: f };
  }

  function glow(ctx, R, color, x, y, r, alpha) {
    if (alpha <= 0.002) return;
    const g = U().glowSprite(R.cache, color, 0.12);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(g, x - r, y - r, 2 * r, 2 * r);
    ctx.restore();
  }

  function sparkles(ctx, x, y, r, n, clock, alpha, color) {
    const u = U();
    ctx.save();
    ctx.fillStyle = color || '#fff2c0';
    for (let i = 0; i < n; i++) {
      const a = clock * (1.3 + 0.2 * i) + i * TAU / n;
      const tw = 0.5 + 0.5 * Math.sin(clock * 6 + i * 2.1);
      ctx.globalAlpha = alpha * tw;
      u.star(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7, r * (0.12 + 0.08 * tw), a);
    }
    ctx.restore();
  }

  /* Smooth (Catmull-Rom) polyline of [x, y, w] points, sampled by arc length. */
  function polyline(R, key, pts) {
    if (R.cache[key]) return R.cache[key];
    const n = pts.length, d = [];
    const at = function (i) { return pts[Math.max(0, Math.min(n - 1, i))]; };
    const cr = function (a, b, c, e, t) {
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t2 + (-a + 3 * b - 3 * c + e) * t3);
    };
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < 12; s++) {
        const t = s / 12, p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        d.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t), p1[2] + (p2[2] - p1[2]) * t]);
      }
    }
    d.push(pts[n - 1].slice(0, 3));
    const cum = [0];
    for (let i = 1; i < d.length; i++) cum.push(cum[i - 1] + Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]));
    const L = cum[cum.length - 1] || 1;
    R.cache[key] = { d: d, cum: cum.map(function (c) { return c / L; }) };
    return R.cache[key];
  }

  function polyAt(pl, k) {
    k = U().clamp(k, 0, 1);
    let i = 1;
    while (i < pl.d.length - 1 && pl.cum[i] < k) i++;
    const a = pl.d[i - 1], b = pl.d[i], t = (k - pl.cum[i - 1]) / ((pl.cum[i] - pl.cum[i - 1]) || 1);
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, w: a[2] + (b[2] - a[2]) * t, dx: b[0] - a[0], dy: b[1] - a[1] };
  }

  /* ======================= p02: teal preview + harmless Snagling cameo ======================= */
  function drawPreviews(R, ctx, v, P, state) {
    const actors = WW.render.actors;
    (P.previews || []).forEach(function (pv, i) {
      actors.drawSpool(R, ctx, pv.item, pv.x, pv.y, pv.size, { clock: R.clock, phase: 3.1 + i, hover: 1.5 + 1.5 * Math.sin(R.clock * 2.1 + i) });
    });
  }

  function drawCameo(R, ctx, v, P, state) {
    const C = P.cameo;
    if (!C) return;
    const u = U(), st = state.stitches && state.stitches.shortcut;
    let gone = 0;
    if (st && st.tappedAt !== null && st.tappedAt !== undefined) gone = u.smooth(((state.time || 0) - st.tappedAt - 0.35) / 0.8);
    else if (st && st.state === 'open') gone = 1;
    if (gone >= 1) return;
    const bob = Math.sin(R.clock * 2.3) * 3, sway = Math.sin(R.clock * 1.7) * 0.05;
    const breath = 1 + 0.025 * Math.sin(R.clock * 3.1);
    ctx.save();
    if (C.clip) { u.polyPath(ctx, C.clip); ctx.clip(); }
    drawAt(ctx, R, gone > 0 ? 'snag.walk' : 'snag.idle', C.x - gone * 95, C.y + bob * (1 - gone) + gone * 8, C.w,
      { rot: sway * (1 - gone), sy: breath });
    ctx.restore();
  }

  /* ======================= p03: tassels on gold ropes ======================= */
  function ropeCanvas(R) {
    if (R.cache['sp:rope']) return R.cache['sp:rope'];
    const u = U(), w = 16, h = 256, c = u.makeCanvas(w, h), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#5f340b'); gr.addColorStop(0.22, '#b97b22'); gr.addColorStop(0.5, '#f7d06e');
    gr.addColorStop(0.78, '#b97b22'); gr.addColorStop(1, '#5f340b');
    g.fillStyle = gr; g.fillRect(1, 0, w - 2, h);
    g.lineCap = 'round';
    for (let y = -14; y < h + 14; y += 8) {
      g.strokeStyle = 'rgba(84, 44, 8, 0.6)'; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(1.5, y + 7); g.lineTo(w - 1.5, y); g.stroke();
      g.strokeStyle = 'rgba(255, 244, 200, 0.6)'; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(4, y + 4.6); g.lineTo(w - 5, y + 0.4); g.stroke();
    }
    R.cache['sp:rope'] = c;
    return c;
  }

  function drawRope(ctx, R, x, y0, y1, width) {
    const c = ropeCanvas(R);
    const tile = 256 * width / 16;
    for (let y = y0; y < y1 - 0.5; y += tile) {
      const seg = Math.min(tile, y1 - y);
      ctx.drawImage(c, 0, 0, 16, seg * 16 / width, x - width / 2, y, width, seg + 0.6);
    }
  }

  /* prop.swinging-tassel from its gold cap down (frame y ≥ CAP_Y; the gold rope replaces the striped cord), body and
     pompom fringe shifted to the approved deep plum. */
  const CAP_Y = 104, RING_Y = 214;
  function tasselCanvas(R) {
    if (R.cache['sp:tassel']) return R.cache['sp:tassel'];
    const f = frameOf(R, 'prop.swinging-tassel'), u = U();
    if (!f || !u.imgReady(R.images[f.img])) return null;
    const h = f.h - CAP_Y, c = u.makeCanvas(f.w, h), g = c.getContext('2d');
    const src = function () { g.drawImage(R.images[f.img], f.x, f.y + CAP_Y, f.w, h, 0, 0, f.w, h); };
    src();
    g.save();
    g.beginPath(); g.rect(0, 280, f.w, h - 280); g.clip();
    g.globalCompositeOperation = 'hue'; g.fillStyle = 'rgb(150, 28, 92)'; g.fillRect(0, 0, f.w, h);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgb(176, 150, 170)'; g.fillRect(0, 0, f.w, h);
    g.restore();
    g.save();
    g.beginPath(); g.rect(0, 112, f.w, 168); g.clip();
    g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgb(218, 206, 220)'; g.fillRect(0, 0, f.w, h);
    g.restore();
    g.globalCompositeOperation = 'destination-in';
    src();
    g.globalCompositeOperation = 'source-over';
    R.cache['sp:tassel'] = c;
    return c;
  }

  function drawTassels(R, ctx, v, P, state) {
    const u = U(), st = (state.stitches && state.stitches.tassels) || { state: 'idle', lifts: [0, 0, 0] };
    const f = frameOf(R, 'prop.swinging-tassel');
    if (!f) return;
    const lifts = st.state === 'open' ? [1, 1, 1] : (st.lifts || [0, 0, 0]);
    const cue = st.state === 'ready' || st.state === 'animating';
    const beamY = (P.tasselBeamY || 210);
    P.tassels.forEach(function (T, i) {
      const l = lifts[i] || 0;
      const e = u.easeOutBack(l);
      const top = T.y - T.lift * e;
      const h = T.w * f.h / f.w;
      const swing = Math.sin(R.clock * 1.35 + i * 1.9) * 0.022 * (1 - 0.5 * l) +
        Math.sin(Math.PI * Math.min(1, l * 1.2)) * 0.06 * Math.sin(R.clock * 7 + i);
      const rw = Math.max(8, T.w * 0.075);
      ctx.save();
      ctx.translate(T.x, beamY);
      ctx.rotate(swing);
      const kt = T.w / f.w, tc = tasselCanvas(R);
      // the approved tassels are longer than the sprite: cap → fringe spans the whole authored height from the anchor
      const ky = f.h / (f.h - CAP_Y);
      drawRope(ctx, R, 0, -beamY - 20, top - beamY + 10 * kt, rw);
      if (tc) ctx.drawImage(tc, -f.px * kt, top - beamY, f.w * kt, tc.height * kt * ky);
      else drawAt(ctx, R, 'prop.swinging-tassel', 0, top - beamY, T.w);
      // gold halo ring on the cap while the stitch is waiting / lifting
      const ringA = cue ? (0.55 + 0.25 * Math.sin(R.clock * 4 + i)) * (1 - u.smooth(l * 1.5)) : 0;
      if (ringA > 0.01) {
        const cy = top - beamY + (RING_Y - CAP_Y) * kt * (f.h / (f.h - CAP_Y));
        glow(ctx, R, 'rgba(255,214,110,0.9)', 0, cy, T.w * 0.5, ringA * 0.35);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = ringA;
        ctx.strokeStyle = 'rgba(255, 210, 100, 0.55)'; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.ellipse(0, cy, T.w * 0.42, T.w * 0.09, 0, 0, TAU); ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 246, 200, 0.9)'; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.ellipse(0, cy, T.w * 0.42, T.w * 0.09, 0, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      // upward lift arrows beside each tassel
      const arA = cue ? (1 - u.smooth(l * 3)) : 0;
      if (arA > 0.01) {
        const ph = (R.clock * 0.7 + i * 0.37) % 1;
        const ax = T.x - T.w * 0.6, len = T.w * 0.42, ay = top + h * 0.5 - ph * T.w * 0.25;
        const aa = arA * Math.min(1, Math.sin(ph * Math.PI) * 1.6);
        glow(ctx, R, 'rgba(255,214,110,0.9)', ax, ay + len * 0.5, len * 0.7, 0.3 * aa);
        ctx.save();
        ctx.globalAlpha = aa;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let pass = 0; pass < 2; pass++) {
          ctx.strokeStyle = pass ? '#ffdc6a' : 'rgba(110, 60, 10, 0.5)';
          ctx.lineWidth = pass ? 4 : 8;
          ctx.beginPath(); ctx.moveTo(ax, ay + len); ctx.lineTo(ax, ay);
          ctx.moveTo(ax - len * 0.24, ay + len * 0.26); ctx.lineTo(ax, ay); ctx.lineTo(ax + len * 0.24, ay + len * 0.26);
          ctx.stroke();
        }
        ctx.restore();
      }
    });
  }

  /* ======================= p04: Snagling ======================= */
  function snagPose(R, P, state) {
    const s = state.snagling;
    if (!s || !P.snagling || s.state === 'concealed' || s.state === 'done') return null;
    const u = U(), T = R.tuning, hide = P.snagling.hide, peek = P.snagling.peek;
    const t0 = T.snagRevealToContact || 0.55;
    const purl = state.purl || {};
    const cf = typeof s.contactF === 'number' ? s.contactF : (purl.f || 0);
    const c = WW.path.racerPoint(P.purl.path, u.clamp(cf, 0, 1), s.targetLane || 0, 0);
    const L = { x: c.x - 0.6 * c.w, y: c.groundY + 4, w: Math.max(150, c.w * 0.84) };
    const M = { x: peek.x - 6, y: peek.y - 6, w: peek.w * 0.92 };   // tugging from the tower edge (approved 04)
    const t = s.t || 0;
    let p = null;
    if (s.state === 'hop') {
      if (t < 0.16) {
        const k = t / 0.16, e = u.easeOutBack(k);
        p = { name: 'snag.alert', x: u.lerp(hide.x, peek.x, e), y: u.lerp(hide.y, peek.y, k), w: u.lerp(hide.w, peek.w, k), sy: 0.8 + 0.2 * e };
      } else if (t < t0) {
        const k = (t - 0.16) / (t0 - 0.16), e = u.easeInOut(k);
        const w = u.lerp(peek.w, L.w, k);
        p = { name: 'snag.reach', x: u.lerp(peek.x, L.x, e), y: u.lerp(peek.y, L.y, e), w: w, lift: Math.sin(Math.PI * k) * w * 0.55,
          rot: 0.25 * Math.sin(Math.PI * k) };
      } else {
        const k = u.clamp((t - t0) / 0.1, 0, 1);
        p = { name: 'snag.grab', flip: true, x: L.x, y: L.y, w: L.w, sy: 1 - 0.14 * Math.sin(Math.PI * k), sx: 1 + 0.08 * Math.sin(Math.PI * k) };
      }
    } else if (s.state === 'tangle') {
      const k = u.easeOutCubic(t / 0.3);
      p = { name: 'snag.grab', flip: true, x: u.lerp(L.x, M.x, k) + Math.sin(t * 38) * 2.5, y: u.lerp(L.y, M.y, k), w: u.lerp(L.w, M.w, k),
        rot: -0.06 * Math.sin(t * 19) };
    } else if (s.state === 'retreat') {
      const from = s.result === 'hit' ? M : L;
      if (t < 0.3) {
        p = { name: s.result === 'hit' ? 'snag.cheer' : 'snag.spin', x: from.x, y: from.y, w: from.w, lift: Math.abs(Math.sin(t / 0.3 * Math.PI)) * from.w * 0.12 };
      } else {
        const k = u.easeInOut((t - 0.3) / 1.0);
        p = { name: k < 0.35 && s.result !== 'hit' ? 'snag.walk' : 'snag.peek', x: u.lerp(from.x, hide.x, k), y: u.lerp(from.y, hide.y + 20, k),
          w: u.lerp(from.w, hide.w, k), lift: s.result !== 'hit' ? Math.abs(Math.sin(k * Math.PI * 3)) * 10 * (1 - k) : 0 };
      }
    }
    if (!p) return null;
    const f = frameOf(R, p.name);
    if (f) {
      const k = p.w / f.w;
      const dir = p.flip ? 1 : -1;
      p.hand = { x: p.x + dir * f.px * k * 0.9 * (p.sx || 1), y: p.y - (p.lift || 0) - f.h * k * 0.52 };
      p.box = { x0: p.x - f.w * k, y0: p.y - (p.lift || 0) - f.h * k * 1.1, x1: p.x + f.w * k, y1: p.y + 4 };
    }
    return p;
  }

  function entries(R, v, P, state, list) {
    if (P.tassels) {
      // tassels hang between Purl's route and the central tower: in front of Loop's bridge end, behind Purl
      list.push({ y: P.tasselDepthY || 1000, box: { x0: 0, y0: 0, x1: 0, y1: 0 }, draw: function (c) { drawTassels(R, c, v, P, state); } });
    }
    if (!P.snagling || !state.snagling) return;
    const s = state.snagling;
    if (s.seg && R.segIndexOf && R.segIndexOf(s.seg) !== v.segIdx) return;
    const p = snagPose(R, P, state);
    if (!p || !p.box) return;
    S(R).snag = { plate: v.plate, pose: p };
    list.push({
      y: p.y, box: p.box, snag: true,
      draw: function (c) {
        U().drawShadow(c, R.cache, p.x, p.y, p.w * 0.62, 0.5 * (1 - 0.5 * Math.min(1, (p.lift || 0) / (p.w * 0.4))));
        drawAt(c, R, p.name, p.x, p.y - (p.lift || 0), p.w, { flip: p.flip, sx: p.sx, sy: p.sy, rot: p.rot });
      }
    });
  }

  function yarnStroke(ctx, path, width, alpha) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#3d0b2b'; ctx.lineWidth = width * 1.45; path(); ctx.stroke();
    ctx.strokeStyle = '#8f2a6c'; ctx.lineWidth = width; path(); ctx.stroke();
    ctx.strokeStyle = 'rgba(214, 120, 176, 0.85)'; ctx.lineWidth = width * 0.32;
    ctx.setLineDash([width * 0.9, width * 0.9]); path(); ctx.stroke();
    ctx.restore();
  }

  function drawYarnLine(R, ctx, v, state) {
    const sp = S(R), s = state.snagling;
    if (!s || !sp.snag || sp.snag.plate !== v.plate || s.result !== 'hit') return;
    const pp = R.lastPurlPose;
    if (!pp || pp.plate !== v.plate) return;
    let a = 0, slack = 0;
    if (s.state === 'hop' && s.contactConsumed) a = 1;
    else if (s.state === 'tangle') a = 1;
    else if (s.state === 'retreat' && s.t < 0.35) { a = 1 - s.t / 0.35; slack = s.t / 0.35; }
    if (a <= 0) return;
    const h = sp.snag.pose.hand;
    if (!h) return;
    const ax = pp.x - pp.w * 0.2, ay = pp.y - pp.w * 0.07;
    const mx = (h.x + ax) / 2, my = (h.y + ay) / 2 + Math.hypot(ax - h.x, ay - h.y) * (0.06 + 0.25 * slack) + Math.sin(R.clock * 30) * 2;
    yarnStroke(ctx, function () { ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.quadraticCurveTo(mx, my, ax, ay); }, Math.max(4, pp.w * 0.024), a);
  }

  /* Loops of plum yarn around Purl's ankles while tangled (+ white wobble marks). */
  function drawAnkles(R, ctx, x, gy, w, a, clock) {
    const lw = Math.max(3.5, w * 0.022);
    yarnStroke(ctx, function () {
      ctx.beginPath();
      ctx.ellipse(x - w * 0.13, gy - w * 0.075, w * 0.12, w * 0.042, -0.18, 0.15, Math.PI - 0.15);
      ctx.moveTo(x + w * 0.28, gy - w * 0.09);
      ctx.ellipse(x + w * 0.15, gy - w * 0.09, w * 0.13, w * 0.048, 0.22, 0, Math.PI);
      ctx.moveTo(x - w * 0.02, gy - w * 0.06);
      ctx.bezierCurveTo(x + w * 0.02, gy - w * 0.12, x + w * 0.06, gy - w * 0.02, x + w * 0.1, gy - w * 0.07);
      ctx.moveTo(x - w * 0.25, gy - w * 0.08);
      ctx.quadraticCurveTo(x - w * 0.3, gy - w * 0.02, x - w * 0.36, gy - w * 0.05);
    }, lw, a);
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineCap = 'round'; ctx.lineWidth = Math.max(2.5, w * 0.016);
    const fl = Math.floor(clock * 9) % 2;
    for (let s = -1; s <= 1; s += 2) {
      for (let j = 0; j < 2; j++) {
        if ((j + fl) % 2 && j) continue;
        const cx = x + s * w * (0.6 + 0.08 * j), cy = gy - w * (0.5 - 0.3 * j), r = w * (0.1 - 0.02 * j);
        ctx.beginPath();
        ctx.arc(cx - s * r, cy, r, s > 0 ? -0.7 : Math.PI - 0.7, s > 0 ? 0.7 : Math.PI + 0.7);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ======================= p06: butterfly ======================= */
  function embroideryCanvas(R) {
    const f = frameOf(R, 'feat.butterfly-closed');
    if (!f) return null;
    return U().frameCanvas(R.cache, 'sp:embroidery', R.images[f.img], f, function (g, c) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(16, 72, 82, 0.2)'; g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'source-over';
    });
  }

  function shadowCanvas(R, name) {
    const key = 'sp:shadow:' + name;
    if (R.cache[key]) return R.cache[key];
    const f = frameOf(R, name), u = U();
    if (!f || !u.imgReady(R.images[f.img])) return null;
    const pad = 24, c = u.makeCanvas(f.w / 2 + pad * 2, f.h / 2 + pad * 2), g = c.getContext('2d');
    const m = u.makeCanvas(f.w / 2, f.h / 2), mg = m.getContext('2d');
    mg.drawImage(R.images[f.img], f.x, f.y, f.w, f.h, 0, 0, f.w / 2, f.h / 2);
    u.silhouette(mg, m, 'rgb(6, 30, 36)');
    if (u.canFilter()) g.filter = 'blur(6px)';
    g.drawImage(m, pad, pad);
    g.filter = 'none';
    R.cache[key] = { c: c, pad: pad };
    return R.cache[key];
  }

  /* The horizontal spool cut from feat.butterfly-carrying-spool (frame px x 100..270, y 312..435). */
  const CARRY_SPOOL = { x: 98, y: 312, w: 174, h: 123, cx: 184 - 98 };
  const CARRY_CLIP = 322;
  function carrySpoolCanvas(R) {
    if (R.cache['sp:carrySpool']) return R.cache['sp:carrySpool'];
    const f = frameOf(R, 'feat.butterfly-carrying-spool'), u = U();
    if (!f || !u.imgReady(R.images[f.img])) return null;
    const c = u.makeCanvas(CARRY_SPOOL.w, CARRY_SPOOL.h), g = c.getContext('2d');
    g.drawImage(R.images[f.img], f.x + CARRY_SPOOL.x, f.y + CARRY_SPOOL.y, CARRY_SPOOL.w, CARRY_SPOOL.h, 0, 0, CARRY_SPOOL.w, CARRY_SPOOL.h);
    // keep only the spool: erase the thread ends above its top flange line
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(0, 0, CARRY_SPOOL.w, 4);
    R.cache['sp:carrySpool'] = c;
    return c;
  }

  function butterflyInfo(P, state) {
    const st = state.stitches && state.stitches.butterfly;
    if (!P.butterfly || !st) return null;
    return st;
  }

  /* Coral/gold fill of the plate's own butterfly outline (P.butterfly.embroidery wing polygons), keeping the plate's
     stitch texture (soft-light) and its gold outline; built once. */
  function embroideryFill(R, P) {
    const key = 'sp:embfill:' + P.id;
    if (R.cache[key] !== undefined) return R.cache[key];
    const polys = P.butterfly.embroidery, u = U(), img = WW.render.world.plateImg(R, P.id);
    if (!polys || !u.imgReady(img)) return null;
    let b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    polys.forEach(function (q) { const bb = u.polyBox(q); b = { x0: Math.min(b.x0, bb.x0), y0: Math.min(b.y0, bb.y0), x1: Math.max(b.x1, bb.x1), y1: Math.max(b.y1, bb.y1) }; });
    const pad = 6, x0 = Math.floor(b.x0 - pad), y0 = Math.floor(b.y0 - pad), w = Math.ceil(b.x1 - b.x0 + 2 * pad), h = Math.ceil(b.y1 - b.y0 + 2 * pad);
    const c = u.makeCanvas(w, h), g = c.getContext('2d');
    g.translate(-x0, -y0);
    const cx = 131, cy = 668;
    const gr = g.createRadialGradient(cx, cy, 4, cx, cy, 120);
    gr.addColorStop(0, '#ffd166'); gr.addColorStop(0.28, '#f7a24a'); gr.addColorStop(0.5, '#ee5a5c'); gr.addColorStop(1, '#c42f45');
    g.fillStyle = gr;
    polys.forEach(function (q) { u.polyPath(g, q); g.fill(); });
    // the tapestry's own crochet texture through the fill
    g.globalCompositeOperation = 'soft-light';
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    g.drawImage(img, x0 * iw / 841, y0 * ih / 1870, w * iw / 841, h * ih / 1870, x0, y0, w, h);
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = '#000';
    g.beginPath();   // one path: each destination-in fill would erase the other wings
    polys.forEach(function (q) { q.forEach(function (pt, i) { if (i) g.lineTo(pt[0], pt[1]); else g.moveTo(pt[0], pt[1]); }); g.closePath(); });
    g.fill();
    g.globalCompositeOperation = 'source-over';
    // scalloped gold inner stitching + body
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255, 220, 120, 0.85)'; g.lineWidth = 3; g.setLineDash([2.5, 4]);
    polys.forEach(function (q) {
      g.save(); g.translate(cx, cy); g.scale(0.78, 0.78); g.translate(-cx, -cy); u.polyPath(g, q); g.stroke(); g.restore();
    });
    g.setLineDash([]);
    g.strokeStyle = '#e9a93a'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(131, 652); g.lineTo(131, 752); g.stroke();
    g.strokeStyle = '#ffe08a'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(130, 654); g.lineTo(130, 750); g.stroke();
    R.cache[key] = { c: c, x: x0, y: y0 };
    return R.cache[key];
  }

  /* Embroidery on the tapestry (dormant/ready), fading as the butterfly peels off; the plate keeps the outline. */
  function drawEmbroidery(R, ctx, v, P, state) {
    const st = butterflyInfo(P, state);
    if (!st) return;
    const B = P.butterfly.rest, u = U();
    let a = 1;
    if (st.phase === 'emerge') a = 1 - u.smooth((st.phaseT || 0) / 0.45);
    else if (st.phase !== 'dormant' && st.phase !== undefined) a = 0;
    if (st.state === 'open') a = 0;
    const ready = st.state === 'ready' || st.state === 'animating';
    if (ready) glow(ctx, R, 'rgba(255,206,110,0.9)', 112, 652, 150, (0.18 + 0.08 * Math.sin(R.clock * 3.2)) * (st.state === 'ready' ? 1 : 0.8));
    if (a <= 0.01) return;
    const fill = P.butterfly.embroidery ? embroideryFill(R, P) : null;
    if (fill) {
      ctx.save();
      ctx.globalAlpha = 0.95 * a;
      ctx.drawImage(fill.c, fill.x, fill.y);
      ctx.restore();
      if (ready) sparkles(ctx, 120, 660, 70, 4, R.clock, 0.7 * a);
      return;
    }
    const c = embroideryCanvas(R), f = frameOf(R, 'feat.butterfly-closed');
    if (!c || !f) return;
    const k = B.w / f.w;
    ctx.save();
    ctx.globalAlpha = 0.93 * a;
    ctx.translate(B.x, B.y);
    if (B.rot) ctx.rotate(B.rot);
    ctx.drawImage(c, -f.px * k, -f.py * k, f.w * k, f.h * k);
    ctx.restore();
    if (ready) sparkles(ctx, B.x, B.y - f.h * k * 0.5, B.w * 0.5, 4, R.clock, 0.7 * a);
  }

  function drawButterfly(R, ctx, v, P, state) {
    const st = butterflyInfo(P, state);
    if (!st) return;
    const u = U(), B = P.butterfly, ph = st.phase, k = st.phaseT || 0;
    if (ph === 'emerge') {
      const lift = Math.sin(Math.PI * k * 0.5);
      const sh = shadowCanvas(R, 'feat.butterfly-closed'), fc = frameOf(R, 'feat.butterfly-closed');
      if (sh && fc) {
        const kk = B.rest.w / fc.w * 2;
        ctx.save();
        ctx.globalAlpha = 0.38 * u.smooth(k / 0.5);
        ctx.drawImage(sh.c, B.rest.x - fc.px * kk / 2 - sh.pad * kk + 10 + 16 * lift, B.rest.y - fc.py * kk / 2 - sh.pad * kk + 12 + 14 * lift,
          sh.c.width * kk, sh.c.height * kk);
        ctx.restore();
      }
      const flapOpen = k > 0.3 && Math.floor((k - 0.3) / 0.12) % 2 === 0;
      const s = 1 + 0.08 * Math.sin(Math.PI * k);
      const ox = 8 * Math.sin(Math.PI * k), oy = -12 * Math.sin(Math.PI * k);
      if (flapOpen) {
        const fo = frameOf(R, 'feat.butterfly-open');
        drawAt(ctx, R, 'feat.butterfly-open', B.rest.x + ox + 14, B.rest.y + oy, B.rest.w * 1.25 * s, { sx: 0.8 });
        void fo;
      } else {
        const peel = k < 0.3 ? Math.sin(Math.PI * k / 0.3) : 0;
        drawAt(ctx, R, 'feat.butterfly-closed', B.rest.x + ox, B.rest.y + oy, B.rest.w * s, { sy: 1 + 0.05 * peel, rot: -0.08 * peel });
      }
      glow(ctx, R, 'rgba(255,220,130,0.9)', B.rest.x, B.rest.y - B.rest.w * 0.6, B.rest.w * 0.9, 0.3 * Math.sin(Math.PI * k));
      return;
    }
    if (ph === 'fly' || ph === 'place') {
      const fl = polyline(R, 'sp:bfly:' + P.id, B.flight);
      const kk = ph === 'fly' ? u.easeInOut(k) : 1;
      const p = polyAt(fl, kk);
      const fc = frameOf(R, 'feat.butterfly-carrying-spool');
      if (!fc) return;
      const sc = p.w / fc.w;
      const flap = 0.58 + 0.42 * Math.abs(Math.cos(R.clock * Math.PI * 3.6));
      const rot = u.clamp(p.dx * 0.012, -0.22, 0.22) * (ph === 'fly' ? 1 : 0.3);
      const bodyY = p.y - (fc.h - 175) * sc;
      // golden threads streaming from the tapestry outline to the butterfly
      const ta = ph === 'fly' ? 0.85 * (1 - 0.55 * k) : 0.4 * (1 - k);
      if (ta > 0.02) {
        const srcs = [[150, 600], [168, 668], [138, 728]];
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let i = 0; i < srcs.length; i++) {
          const s0 = srcs[i], mx = (s0[0] + p.x) / 2, my = (s0[1] + bodyY) / 2 + Math.sin(R.clock * 3 + i * 2) * 26 - 30;
          for (let pass = 0; pass < 2; pass++) {
            ctx.globalAlpha = ta * (pass ? 0.9 : 0.3);
            ctx.strokeStyle = pass ? 'rgba(255, 238, 170, 1)' : 'rgba(255, 196, 80, 1)';
            ctx.lineWidth = pass ? 1.8 : 6;
            ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.quadraticCurveTo(mx, my, p.x, bodyY); ctx.stroke();
          }
        }
        ctx.restore();
      }
      // spool (scaled so its flange matches the 70 px pickup), hanging, then set down and stood upright
      const size = WW.render.actors.itemSize(P, 'purl', 'gold');
      const ss = size / CARRY_SPOOL.h;
      const hangX = p.x + (CARRY_SPOOL.cx + CARRY_SPOOL.x - fc.px) * sc, hangTop = p.y - (fc.h - CARRY_CLIP + 6) * sc;
      const sc0 = carrySpoolCanvas(R);
      let spA = ph === 'fly' ? u.smooth(k / 0.18) : 1;
      let sx = hangX, sy = hangTop + CARRY_SPOOL.h * ss * 0.5, srot = 0, upright = 0;
      if (ph === 'place') {
        const pick = pickupPoint(P, 'gold');
        const e = u.easeInOut(k);
        if (pick) { sx = u.lerp(hangX, pick.x, e); sy = u.lerp(sy, pick.y - size * 0.73, e); }
        srot = -Math.PI / 2 * u.smooth((k - 0.35) / 0.45);
        upright = u.smooth((k - 0.7) / 0.3);
      }
      // butterfly (wings + threads); the frame's own spool is replaced by the scaled one
      const lift = ph === 'place' ? -u.smooth((k - 0.55) / 0.45) * 26 : 0;
      drawAt(ctx, R, 'feat.butterfly-carrying-spool', p.x, p.y + lift, p.w, { clipY: CARRY_CLIP, sx: flap, rot: rot });
      if (sc0 && spA > 0.01 && upright < 1) {
        ctx.save();
        ctx.globalAlpha = spA * (1 - upright);
        ctx.translate(sx, sy); ctx.rotate(srot);
        ctx.drawImage(sc0, -CARRY_SPOOL.w * ss / 2, -CARRY_SPOOL.h * ss / 2, CARRY_SPOOL.w * ss, CARRY_SPOOL.h * ss);
        ctx.restore();
        if (ph === 'fly' && k < 0.25) sparkles(ctx, sx, sy, size * 0.8, 5, R.clock, 1 - k / 0.25);
      }
      if (upright > 0.01) {
        const pick = pickupPoint(P, 'gold');
        if (pick) WW.render.actors.drawSpool(R, ctx, 'gold', pick.x, pick.y, size, { clock: R.clock, alpha: upright, hover: 0 });
      }
      return;
    }
    // exit after the spool is set (cosmetic, ~1.6 s after the stitch opened)
    if (st.state === 'open' && typeof st.openedAt === 'number') {
      const t = ((state.time || 0) - st.openedAt) / 1.6;
      if (t < 0 || t >= 1) return;
      const ex = polyline(R, 'sp:bexit:' + P.id, B.exit);
      const p = polyAt(ex, u.easeInOut(t) * 0.85 + t * 0.15);
      const flap = 0.5 + 0.5 * Math.abs(Math.cos(R.clock * Math.PI * 4.2));
      drawAt(ctx, R, 'feat.butterfly-open', p.x, p.y, p.w * 1.1, { sx: flap, rot: 0.15, alpha: 1 - u.smooth((t - 0.75) / 0.25) });
    }
  }

  function pickupPoint(P, item) {
    const ev = (P.purl && P.purl.events) || [];
    for (let i = 0; i < ev.length; i++) {
      if (ev[i].type === 'pickup' && ev[i].item === item) {
        const p = WW.path.racerPoint(P.purl.path, ev[i].f, ev[i].lane || 0, 0);
        return { x: p.x, y: p.groundY };
      }
    }
    return null;
  }

  /* ======================= p07: gate veil ======================= */
  function veilCanvas(R, P) {
    const key = 'sp:veil:' + P.id;
    if (R.cache[key]) return R.cache[key];
    const u = U(), arch = P.gate.arch, b = u.polyBox(arch), pad = 10;
    const w = b.x1 - b.x0 + pad * 2, h = b.y1 - b.y0 + pad * 2;
    const c = u.makeCanvas(w, h), g = c.getContext('2d');
    g.translate(pad - b.x0, pad - b.y0);
    u.polyPath(g, arch);
    g.save();
    g.clip();
    const cx = P.gate.x, cy = P.gate.y;
    const gr = g.createRadialGradient(cx, cy + 40, 10, cx, cy, Math.max(w, h) * 0.7);
    gr.addColorStop(0, 'rgba(255, 250, 236, 0.95)');
    gr.addColorStop(0.45, 'rgba(255, 224, 226, 0.9)');
    gr.addColorStop(1, 'rgba(240, 160, 186, 0.92)');
    g.fillStyle = gr; g.fillRect(b.x0 - pad, b.y0 - pad, w, h);
    // woven lattice
    g.lineWidth = 1.3;
    g.strokeStyle = 'rgba(214, 150, 80, 0.32)';
    for (let d = -h; d < w + h; d += 15) {
      g.beginPath(); g.moveTo(b.x0 + d, b.y0); g.lineTo(b.x0 + d - h, b.y1); g.stroke();
      g.beginPath(); g.moveTo(b.x0 + d - h, b.y0); g.lineTo(b.x0 + d, b.y1); g.stroke();
    }
    // embroidered rosettes
    for (let y = b.y0 + 50; y < b.y1; y += 70) {
      for (let x = b.x0 + 34 + ((y / 70) % 2) * 35; x < b.x1; x += 70) {
        for (let i = 0; i < 5; i++) {
          const a = i * TAU / 5;
          g.fillStyle = 'rgba(232, 96, 140, 0.32)';
          g.beginPath(); g.ellipse(x + Math.cos(a) * 7, y + Math.sin(a) * 7, 7, 4, a, 0, TAU); g.fill();
        }
        g.fillStyle = 'rgba(255, 206, 96, 0.55)';
        g.beginPath(); g.arc(x, y, 3.5, 0, TAU); g.fill();
      }
    }
    g.restore();
    // glowing stitched rim
    u.polyPath(g, arch);
    g.strokeStyle = 'rgba(255, 220, 140, 0.45)'; g.lineWidth = 12; g.stroke();
    g.strokeStyle = 'rgba(255, 244, 200, 0.95)'; g.lineWidth = 3; g.setLineDash([8, 6]); g.stroke();
    R.cache[key] = { c: c, x: b.x0 - pad, y: b.y0 - pad, w: w, h: h };
    return R.cache[key];
  }

  function drawGate(R, ctx, v, P, state) {
    const gs = state.gate || { state: 'closed', t: 0 };
    const u = U(), sp = S(R);
    if (gs.state === 'open') {
      glow(ctx, R, 'rgba(255,236,170,0.9)', P.gate.x, P.gate.y + 20, 260, 0.16 + 0.05 * Math.sin(R.clock * 2));
      return;
    }
    const veil = veilCanvas(R, P);
    let a = 1, s = 1;
    if (gs.state === 'opening') { const e = u.easeOutCubic(Math.min(1, (gs.t || 0) / 0.4)); a = 1 - e; s = 1 + 0.22 * e; }
    const bAge = R.clock - sp.blockedAt;
    const shake = bAge < 0.7 ? Math.sin(bAge * 42) * 5 * (1 - bAge / 0.7) : 0;
    if (a > 0.01) {
      ctx.save();
      ctx.globalAlpha = a * (0.9 + 0.06 * Math.sin(R.clock * 2.2));
      ctx.translate(P.gate.x + shake, P.gate.y + 90);
      ctx.scale(s, s);
      ctx.drawImage(veil.c, veil.x - P.gate.x, veil.y - P.gate.y - 90);
      ctx.restore();
      // shimmer rising through the veil
      ctx.save();
      u.polyPath(ctx, P.gate.arch); ctx.clip();
      const ph = (R.clock * 0.25) % 1;
      glow(ctx, R, 'rgba(255,250,230,0.9)', P.gate.x + Math.sin(R.clock) * 40, 1080 - ph * 420, 120, 0.22 * a * Math.sin(ph * Math.PI));
      if (bAge < 0.9) glow(ctx, R, 'rgba(255,120,110,0.9)', P.gate.x, P.gate.y + 60, 220, 0.4 * (1 - bAge / 0.9));
      ctx.restore();
    }
    if (gs.state === 'opening') glow(ctx, R, 'rgba(255,240,190,0.95)', P.gate.x, P.gate.y + 40, 320 * (0.6 + gs.t), 0.75 * (1 - gs.t));
  }

  /* ======================= Loop's task effects ======================= */
  function drawLoopTasks(R, ctx, v, state) {
    const tasks = state.loopTasks || {}, loop = state.loop || {};
    if (loop.seg !== v.segIdx) return;
    const u = U();
    for (const key in tasks) {
      const tk = tasks[key];
      if (tk.segIndex !== undefined && tk.segIndex !== v.segIdx) continue;
      if (tk.kind !== 'stitch' || typeof tk.x !== 'number') continue;
      if (tk.state !== 'react' && tk.state !== 'hesitate' && tk.state !== 'active') continue;
      const P = R.plates[v.plate];
      const lw = WW.path.sample(P.loop.path, u.clamp(loop.f || 0, 0, 1)).w;
      const r = lw * 0.42, pulse = 0.5 + 0.5 * Math.sin(R.clock * 5);
      glow(ctx, R, 'rgba(255,214,120,0.9)', tk.x, tk.y, r * 1.5, 0.35 + 0.15 * pulse);
      ctx.save();
      ctx.lineWidth = Math.max(2, r * 0.09);
      ctx.strokeStyle = 'rgba(255, 216, 96, ' + (0.55 + 0.3 * pulse).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(tk.x, tk.y, r * (0.7 + 0.15 * pulse), r * (0.62 + 0.13 * pulse), 0, 0, TAU); ctx.stroke();
      if (tk.state === 'active') {
        ctx.strokeStyle = '#fff4c8'; ctx.lineWidth *= 1.2;
        ctx.beginPath(); ctx.ellipse(tk.x, tk.y, r * 0.95, r * 0.84, 0, -Math.PI / 2, -Math.PI / 2 + TAU * u.clamp(tk.t || 0, 0, 1)); ctx.stroke();
      }
      ctx.restore();
      sparkles(ctx, tk.x, tk.y, r * 0.8, 3, R.clock, 0.9);
    }
  }

  /* ======================= racer overlays ======================= */
  function afterRacer(R, ctx, who, st, pose, state) {
    const sp = S(R), u = U();
    const x = pose.x, gy = pose.groundY, w = pose.w, lift = pose.lift || 0;
    if (who === 'purl') {
      let a = 0;
      if (st.action === 'tangled' || st.action === 'failed') { a = 1; sp.ankleT = R.clock; }
      else a = 1 - (R.clock - sp.ankleT) / 0.3;
      if (a > 0) drawAnkles(R, ctx, x, gy - lift, w, u.clamp(a, 0, 1), R.clock);
      const rc = sp.recover;
      if (rc) {
        const age = R.clock - rc.at;
        if (age > 1.5) sp.recover = null;
        else {
          const env = u.smooth(age / 0.12) * (1 - u.smooth((age - 0.9) / 0.6));
          const cx = x, cy = gy - lift - w * 0.48;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.lineCap = 'round';
          for (let i = 0; i < 2; i++) {
            const a0 = R.clock * 4.2 + i * Math.PI;
            for (let pass = 0; pass < 2; pass++) {
              ctx.globalCompositeOperation = pass ? 'source-over' : 'lighter';
              ctx.globalAlpha = env * (pass ? 0.9 : 0.35);
              ctx.strokeStyle = pass ? 'rgb(255, 205, 80)' : 'rgba(255, 170, 40, 1)';
              ctx.lineWidth = pass ? Math.max(2, w * 0.013) : Math.max(6, w * 0.045);
              ctx.beginPath(); ctx.ellipse(cx, cy, w * (0.66 + 0.04 * i), w * (0.5 + 0.03 * i), -0.15, a0, a0 + 2.3 + 0.6 * i); ctx.stroke();
            }
          }
          ctx.restore();
          glow(ctx, R, 'rgba(255,200,90,0.9)', cx, cy, w * 0.8, 0.22 * env);
          sparkles(ctx, cx, cy, w * 0.62, 6, R.clock, env);
          // the recovered spool held up at Purl's hand, then it flies to the HUD
          if (age < 0.55) {
            const hx = x + w * 0.6, hy = gy - lift - w * 0.36;
            WW.render.actors.drawSpool(R, ctx, rc.color, hx, hy, w * 0.25, { clock: R.clock, hover: 0, shadow: false });
            rc.hand = { x: hx, y: hy - w * 0.15, plate: pose.plate };
          } else if (!rc.flown && rc.hand) {
            rc.flown = true;
            rc.flyFrom = rc.hand;
          }
          rc.textAt = { x: x + w * 0.95, y: gy - lift - w * 0.52, plate: pose.plate, w: w };
        }
      }
    } else if (who === 'loop' && st.action === 'stumble') {
      ctx.save();
      ctx.fillStyle = '#ffe9a6';
      const hy = gy - lift - w * 1.02;
      for (let i = 0; i < 3; i++) {
        const a = R.clock * 5 + i * TAU / 3;
        ctx.globalAlpha = 0.85;
        u.star(ctx, x + Math.cos(a) * w * 0.32, hy + Math.sin(a) * w * 0.09, w * 0.08, a);
      }
      ctx.restore();
    }
  }

  /* ======================= callouts (screen space) ======================= */
  function callout(R, kind, plate, x, y, delay) {
    S(R).callouts.push({ kind: kind, plate: plate, x: x, y: y, at: R.clock + (delay || 0), life: kind === 'minus' ? 1.8 : 1.5 });
  }

  function onDrop(R, plate, spot, size) {
    callout(R, 'minus', plate, spot.x - size * 0.25, spot.y - size * 1.55 - 26, 0.15);
  }

  function onRecover(R, color) {
    const sp = S(R);
    sp.recover = { at: R.clock, color: color };
    for (let i = sp.callouts.length - 1; i >= 0; i--) if (sp.callouts[i].kind === 'minus') sp.callouts.splice(i, 1);
  }

  const FONT = 'Nunito, "Baloo 2", "Trebuchet MS", "Segoe UI", Roboto, Arial, sans-serif';

  function screen(R, ctx, v, state) {
    const sp = S(R), u = U();
    const list = sp.callouts;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      const age = R.clock - c.at;
      if (age > c.life) { list.splice(i, 1); continue; }
      if (age < 0 || c.plate !== v.plate) continue;
      const k = age / c.life;
      const x = v.ox + c.x * v.s, y = v.oy + c.y * v.s - u.easeOutCubic(k) * 14 * Math.max(0.5, v.s * 2);
      const pop = age < 0.18 ? u.easeOutBack(age / 0.18) : 1;
      const a = k > 0.78 ? (1 - k) / 0.22 : 1;
      drawMinusPill(ctx, x, y, v.s, pop, a);
    }
    const rc = sp.recover;
    if (rc && rc.textAt && rc.textAt.plate === v.plate) {
      const age = R.clock - rc.at;
      const a = u.smooth(age / 0.15) * (1 - u.smooth((age - 1.1) / 0.4));
      if (a > 0.01) {
        const fw = Math.max(11, 24 * v.s) * 6.2;   // ≈ text width; keep it on screen (Purl may be in the right lane)
        const x = Math.min(v.ox + rc.textAt.x * v.s, R.fit.W - fw - 6), y = v.oy + rc.textAt.y * v.s - age * 16;
        drawPlusText(R, ctx, x, y, v.s, a, age);
      }
    }
    if (rc && rc.flyFrom && !rc.flyDone) {
      rc.flyDone = true;
      const p = rc.flyFrom;
      if (p.plate === v.plate && R.hudTarget) {
        WW.render.fx.flyup(R.fx, WW.render.actors.SPOOL[rc.color] || WW.render.actors.SPOOL.coral,
          { x: v.ox + p.x * v.s, y: v.oy + p.y * v.s }, R.hudTarget('purl'), 60 * v.s);
      }
    }
  }

  /* Approved "−1 THREAD": cream stitched pill with a tail, warm dark-red text (≈22 plate px type). */
  function drawMinusPill(ctx, x, y, s, pop, a) {
    const font = Math.max(10.5, 22 * s);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x, y); ctx.scale(pop, pop);
    ctx.font = '900 ' + font.toFixed(1) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const text = '−1 THREAD';
    const tw = ctx.measureText(text).width, h = font * 1.75, w = tw + font * 1.3;
    ctx.shadowColor = 'rgba(60, 25, 10, 0.35)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 1.5;
    U().roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fillStyle = '#fdf6ea'; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.beginPath(); ctx.moveTo(-font * 0.35, h / 2 - 1); ctx.lineTo(font * 0.05, h / 2 + font * 0.45); ctx.lineTo(font * 0.35, h / 2 - 1); ctx.closePath();
    ctx.fill();
    U().roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.lineWidth = Math.max(1, font * 0.07); ctx.strokeStyle = '#d5bc98'; ctx.stroke();
    ctx.fillStyle = '#9b2a3a';
    ctx.fillText(text, 0, font * 0.04);
    ctx.restore();
  }

  /* Approved "+1 THREAD": cream lettering with a warm brown outline and gold sparkles. */
  function drawPlusText(R, ctx, x, y, s, a, age) {
    const font = Math.max(11, 24 * s);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '900 ' + font.toFixed(1) + 'px ' + FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(92, 44, 16, 0.85)'; ctx.lineWidth = Math.max(2.5, font * 0.22);
    ctx.strokeText('+1 THREAD', 0 + x, y);
    ctx.fillStyle = '#fff6df';
    ctx.fillText('+1 THREAD', x, y);
    ctx.restore();
    sparkles(ctx, x - font * 0.6, y, font * 0.8, 3, R.clock + age, a, '#ffe39a');
  }

  /* ======================= update / events ======================= */
  function update(R, dt, state) {
    const sp = S(R), F = R.fx;
    // ambient petals and glints at the open flower gate
    const view = R.views && R.views[0];
    const P = view && R.plates[view.plate];
    const gs = state.gate;
    if (P && P.gate && gs && gs.state !== 'closed' && dt > 0) {
      sp.petalAcc += dt * 5;
      const cols = ['#f45d8a', '#ffb3c9', '#ffd36e', '#ff8a5c', '#fff1d0'];
      while (sp.petalAcc >= 1) {
        sp.petalAcc -= 1;
        const r = function (lo, hi) { return lo + (hi - lo) * F.rng.next(); };
        F.parts.push({ kind: 'petal', plate: P.id, x: r(60, 780), y: r(380, 900), vx: r(-30, 30), vy: r(20, 60), g: 12, drag: 0.3,
          life: 0, max: r(2.5, 4), size: r(10, 17), rot: r(0, 6), vr: r(-3, 3), color: cols[Math.floor(r(0, 5))] });
        if (F.rng.next() < 0.5) WW.render.fx.sparkle(F, P.id, r(250, 620), r(650, 1100), 1, 50);
      }
    }
    // Loop's stitch tasks: a burst when one completes
    const tasks = state.loopTasks || {};
    for (const key in tasks) {
      const tk = tasks[key], was = sp.loopTaskSeen[key];
      sp.loopTaskSeen[key] = tk.state;
      if (was && was !== 'done' && tk.state === 'done' && tk.kind === 'stitch' && typeof tk.x === 'number') {
        const seg = R.level.route[tk.segIndex];
        if (seg && seg.plate) WW.render.fx.sparkle(F, seg.plate, tk.x, tk.y, 12, 150);
      }
    }
  }

  function event(R, e, state) {
    const sp = S(R), fx = WW.render.fx;
    if (e.type === 'gate-open') {
      const pl = R.views && R.views[0] && R.plates[R.views[0].plate];
      if (pl && pl.gate) {
        sp.gateBurstAt = R.clock;
        fx.petals(R.fx, pl.id, pl.gate.x, pl.gate.y + 60, 70, 460);
        fx.sparkle(R.fx, pl.id, pl.gate.x, pl.gate.y + 20, 30, 320);
      }
    } else if (e.type === 'gate-blocked') {
      sp.blockedAt = R.clock;
      const pl = R.views && R.views[0] && R.plates[R.views[0].plate];
      if (pl && pl.gate) fx.sparkle(R.fx, pl.id, pl.gate.x, pl.gate.y + 100, 14, 160, '#ffb0a0');
    } else if (e.type === 'jump' && e.who === 'loop' && R.lastLoopPose) {
      const p = R.lastLoopPose; fx.dust(R.fx, p.plate, p.x, p.y, p.w);
    } else if (e.type === 'loop-recover' && R.lastLoopPose) {
      const p = R.lastLoopPose; fx.sparkle(R.fx, p.plate, p.x, p.y - p.w * 0.6, 10, 120);
    }
  }

  /* ======================= layer entry points ======================= */
  function behind(R, ctx, v, state) {
    const P = R.plates[v.plate];
    if (!P) return;
    if (P.previews) drawPreviews(R, ctx, v, P, state);
    if (P.cameo) drawCameo(R, ctx, v, P, state);
    if (P.butterfly) drawEmbroidery(R, ctx, v, P, state);
    if (P.gate) drawGate(R, ctx, v, P, state);
  }

  function air(R, ctx, v, state) {
    const P = R.plates[v.plate];
    if (!P) return;
    drawLoopTasks(R, ctx, v, state);
    if (P.snagling) drawYarnLine(R, ctx, v, state);
    if (P.butterfly) drawButterfly(R, ctx, v, P, state);
  }

  WW.render.setpieces = {
    behind: behind, entries: entries, air: air, afterRacer: afterRacer, screen: screen, update: update, event: event,
    onDrop: onDrop, onRecover: onRecover, snagPose: snagPose, drawAt: drawAt
  };
})(globalThis.WW = globalThis.WW || {});
