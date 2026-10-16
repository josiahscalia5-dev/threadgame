/* Wishweave Wonders — racers, spools and other depth-sorted actors (WW.render.actors), docs/ARCHITECTURE.md §8
   "Characters", "Spools", "Snagling", §12.1/12.6.

   Racers: rear atlas frames with foot pivots, one scale per racer (frame widths differ per pose, so scaling each
   frame to the path width would make him pulse): drawn width ≈ path w · WIDTH_K. 4-frame run cycle from `distance`
   (one cycle = 1.6 m), idle breathing, jump pose with a shrinking contact shadow, stumble while tangled.
   Front poses (purlFront/loopFront) are never used here. */
(function (WW) {
  'use strict';
  WW.render = WW.render || {};
  const U = function () { return WW.render.util; };

  const RUN = ['run-left', 'run-pass-a', 'run-right', 'run-pass-b'];
  const CYCLE_M = 1.6;
  /* Reference frame width (idle) and the fraction of the path width the idle pose occupies (from the approved art). */
  const REF = { purl: 337, loop: 354 };
  const WIDTH_K = { purl: 0.97, loop: 0.92 };
  const SPOOL = { coral: 'prop.coral-thread', teal: 'prop.teal-thread', gold: 'prop.golden-thread' };
  const SPOOL_GLOW = { coral: 'rgba(255,170,150,0.75)', teal: 'rgba(150,240,235,0.7)', gold: 'rgba(255,214,120,0.8)' };

  function scaleFor(who, w) { return w * WIDTH_K[who] / REF[who]; }

  function poseName(who, st) {
    const a = st.action || 'idle';
    if ((st.jumpH || 0) > 0.03 || st.airborne) return 'jump';
    if (a === 'tangled' || a === 'failed' || a === 'stumble') return 'stumble';
    const moving = a === 'run' || a === 'transition' || a === 'looping' || a === 'returning' || a === 'recover';
    if (moving && (st.speed === undefined || st.speed > 0.15 || a !== 'run')) {
      const d = st.distance || 0;
      return RUN[((Math.floor(d / (CYCLE_M / 4)) % 4) + 4) % 4];
    }
    return 'idle';
  }

  /* Draws a racer with feet at (x, groundY) lifted by `lift` (same units as w). opts: {alpha, rim, wobble, clock}. */
  function drawRacer(R, ctx, who, st, x, groundY, lift, w, opts) {
    opts = opts || {};
    const u = U(), fr = R.assets.frames[who + '.' + poseName(who, st)];
    if (!fr) return;
    const img = R.images[fr.img];
    const scale = scaleFor(who, w);
    const jumpH = st.jumpH || 0;
    const clock = opts.clock || 0;
    // contact shadow (stays on the ground, shrinks with height)
    u.drawShadow(ctx, R.cache, x, groundY, w * 0.7 * (1 - 0.4 * jumpH), (opts.alpha === undefined ? 1 : opts.alpha) * 0.7 * (1 - 0.5 * jumpH));
    let sx = 1, sy = 1, rot = 0;
    const name = poseName(who, st);
    if (name === 'idle') {
      const b = Math.sin(clock * 2 * Math.PI / 1.7 + (who === 'loop' ? 1.3 : 0));
      sy = 1 + 0.018 * b; sx = 1 - 0.008 * b;
    }
    if (opts.wobble) rot = opts.wobble;
    const y = groundY - lift;
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    if (opts.rim) drawRim(R, ctx, who, name, fr, img, scale, sx, sy, opts.rim);
    u.drawFrame(ctx, img, fr, 0, 0, scale, sx, sy, opts.alpha);
    ctx.restore();
  }

  /* Subtle golden rim (immunity / recovery): a gold silhouette a touch larger behind the sprite. */
  function drawRim(R, ctx, who, name, fr, img, scale, sx, sy, strength) {
    const u = U();
    const c = u.frameCanvas(R.cache, 'rim:' + who + '.' + name, img, fr, function (g, cv) { u.silhouette(g, cv, 'rgb(255, 214, 110)'); });
    if (!c) return;
    const k = 1.06;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * strength;
    ctx.drawImage(c, -fr.px * scale * sx * k, -fr.py * scale * sy * (1 + (k - 1) * 0.5) , fr.w * scale * sx * k, fr.h * scale * sy * (1 + (k - 1) * 0.5));
    ctx.globalAlpha = prev;
  }

  /* ---------- spools ---------- */
  function itemSize(P, owner, color) {
    const ev = (P[owner] && P[owner].events) || [];
    for (let i = 0; i < ev.length; i++) if (ev[i].type === 'pickup' && ev[i].item === color && ev[i].size) return ev[i].size;
    return owner === 'loop' ? 48 : 64;
  }

  function drawSpool(R, ctx, color, x, y, size, opts) {
    opts = opts || {};
    const u = U(), fr = R.assets.frames[SPOOL[color] || SPOOL.coral];
    if (!fr) return;
    const img = R.images[fr.img];
    const scale = size / fr.w, h = fr.h * scale;
    const clock = opts.clock || 0;
    const hover = opts.hover === undefined ? (2.5 + size * 0.04) * (0.5 + 0.5 * Math.sin(clock * 2.6 + (opts.phase || 0))) : opts.hover;
    if (opts.shadow !== false) u.drawShadow(ctx, R.cache, x, y, size * 1.05 * (1 - hover / (size * 1.2)), 0.42 * (opts.alpha === undefined ? 1 : opts.alpha));
    // soft glow behind
    const glow = u.glowSprite(R.cache, SPOOL_GLOW[color] || SPOOL_GLOW.coral, 0.15);
    const pulse = 0.75 + 0.25 * Math.sin(clock * 3.1 + (opts.phase || 0));
    const gr = size * 1.05 * (opts.glowScale || 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45 * pulse * (opts.alpha === undefined ? 1 : opts.alpha);
    ctx.drawImage(glow, x - gr, y - hover - h * 0.5 - gr, 2 * gr, 2 * gr);
    ctx.restore();
    u.drawFrame(ctx, img, fr, x, y - hover, scale, 1, 1, opts.alpha);
    // occasional twinkle
    const tw = (clock * 0.7 + (opts.phase || 0)) % 1;
    if (tw < 0.25) {
      ctx.save();
      ctx.globalAlpha = Math.sin(tw / 0.25 * Math.PI) * 0.9 * (opts.alpha === undefined ? 1 : opts.alpha);
      ctx.fillStyle = '#fff6d6';
      u.star(ctx, x + size * 0.32, y - hover - h * 0.78, size * 0.16, tw * 3);
      ctx.restore();
    }
    return { x: x, y: y - hover - h * 0.5, w: size, h: h };
  }

  WW.render.actors = {
    RUN: RUN, REF: REF, WIDTH_K: WIDTH_K, SPOOL: SPOOL,
    poseName: poseName, scaleFor: scaleFor, drawRacer: drawRacer, drawSpool: drawSpool, itemSize: itemSize
  };
})(globalThis.WW = globalThis.WW || {});
