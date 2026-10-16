/* Wishweave Wonders — stitch interactions and their cues (WW.render.features), docs/ARCHITECTURE.md §8 "Cues",
   "Tassels", "butterfly", "gate".

   Stitch: feat.stitch-loop stands at the stitch's world anchor (idle/ready), tightens away with a flash when tapped.
   Cue (screen space, world-anchored): soft gold glow + pulsing gold ring while 'ready'; the approved "Tap the stitch"
   pill + curved arrow on the first two stitches, later stitches show the ring only unless the stitch has been ready
   for cueRepeatAfter s. Snagling never gets a cue. */
(function (WW) {
  'use strict';
  WW.render = WW.render || {};
  const U = function () { return WW.render.util; };

  /* Text-cue placement relative to the stitch (plate px), measured on the approved screens. */
  const CUE = {
    ribbon: { dx: 34, dy: -109, text: true, side: 1 },
    shortcut: { dx: 40, dy: -112, text: true, side: 1 },
    tassels: { dx: -40, dy: -112, text: false, side: -1 },
    butterfly: { dx: 70, dy: -100, text: false, side: 1 }
  };
  const STITCH_W = 46;          // stitch-loop sprite width (plate px) at r = 70
  const LOOP_RING_Y = 0.31;     // loop ring centre, fraction of the sprite height from its top

  function stitchFor(R, plateId) {
    const P = R.plates[plateId];
    return P && P.stitch ? P.stitch : null;
  }

  /* World entry for the stitch loop sprite (depth-sorted with actors). */
  function stitchEntry(R, plateId, state) {
    const S = stitchFor(R, plateId);
    if (!S) return null;
    const st = (state.stitches && state.stitches[S.id]) || { state: 'idle', t: 0 };
    if (st.state === 'open') return null;
    const fr = R.assets.frames['feat.stitch-loop'];
    if (!fr) return null;
    const w = STITCH_W * (S.r || 70) / 70, h = w * fr.h / fr.w;
    let k = 1, a = 1;
    if (st.state === 'animating') {
      const t = U().clamp((st.t || 0) / 0.28, 0, 1);
      k = 1 - U().easeOutCubic(t) * 0.85; a = 1 - t;
      if (a <= 0) return null;
    }
    const bottom = S.y + (1 - LOOP_RING_Y) * h;
    return {
      y: bottom - 4,
      box: { x0: S.x - w, y0: bottom - h, x1: S.x + w, y1: bottom },
      draw: function (ctx) {
        const scale = w / fr.w * k;
        U().drawFrame(ctx, R.images[fr.img], fr, S.x, bottom - (1 - k) * h * (1 - LOOP_RING_Y), scale, 1, 1, a);
      }
    };
  }

  /* Glow, ring and (optionally) the text pill + arrow, in CSS px at the stitch's screen position. */
  function drawCue(R, ctx, v, S, opts) {
    const u = U();
    const k = v.s, clock = opts.clock || 0;
    const x = v.ox + S.x * k, y = v.oy + S.y * k;
    const fade = u.smooth(opts.age / 0.35);
    const r = (S.r || 70) * k;
    // soft glow on the stitch
    const glow = u.glowSprite(R.cache, 'rgba(255,212,104,0.95)', 0.12);
    const pulse = 0.5 + 0.5 * Math.sin(clock * 4.2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = fade * (0.42 + 0.22 * pulse);
    const gr = r * 0.95;
    ctx.drawImage(glow, x - gr, y - gr, gr * 2, gr * 2);
    ctx.globalAlpha = fade * (0.55 + 0.3 * pulse);
    const gr2 = r * 0.42;
    ctx.drawImage(glow, x - gr2, y - gr2, gr2 * 2, gr2 * 2);
    ctx.restore();
    // pulsing gold rings
    ctx.save();
    ctx.globalAlpha = fade;
    for (let i = 0; i < 2; i++) {
      const ph = ((clock / 1.3) + i * 0.5) % 1;
      const rr = r * u.lerp(0.42, 1.0, u.easeOutCubic(ph));
      ctx.globalAlpha = fade * (1 - ph) * 0.95;
      ctx.lineWidth = Math.max(2, r * 0.07) * (1 - ph * 0.5);
      ctx.strokeStyle = 'rgba(120, 66, 10, 0.55)';
      ctx.beginPath(); ctx.ellipse(x, y, rr + 1, (rr + 1) * 0.92, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffd35c';
      ctx.lineWidth *= 0.6;
      ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 0.92, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // sparkle rays around the stitch
    ctx.fillStyle = '#fff4c8';
    for (let i = 0; i < 4; i++) {
      const a = clock * 0.9 + i * Math.PI / 2;
      const tw = 0.5 + 0.5 * Math.sin(clock * 5 + i * 1.7);
      ctx.globalAlpha = fade * tw;
      u.star(ctx, x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.42, r * (0.1 + 0.06 * tw), a);
    }
    ctx.restore();
    if (opts.text) drawPill(R, ctx, x, y, k, CUE[S.id] || CUE.ribbon, fade, clock);
  }

  function drawPill(R, ctx, x, y, k, cfg, fade, clock) {
    const u = U();
    const font = Math.max(11, 24 * k);
    const bob = Math.sin(clock * 2.4) * 2.5 * k;
    const cx = x + cfg.dx * k, cy = y + cfg.dy * k + bob;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.font = '800 ' + font.toFixed(1) + 'px Nunito, "Baloo 2", "Trebuchet MS", "Segoe UI", Roboto, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const text = 'Tap the stitch';
    const tw = ctx.measureText(text).width;
    const h = font * 2.0, w = tw + font * 1.35;
    // curved arrow from the pill's lower edge down to the stitch (drawn first so the pill overlaps its root)
    const ax0 = cx - cfg.side * w * 0.02, ay0 = cy + h * 0.38;
    const ax1 = x + cfg.side * 9 * k, ay1 = y - 38 * k;
    const c1x = ax0 + cfg.side * 2 * k, c1y = ay0 + (ay1 - ay0) * 0.7;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#4a2716'; ctx.lineWidth = Math.max(5, 11.5 * k);
    ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.quadraticCurveTo(c1x, c1y, ax1, ay1); ctx.stroke();
    // arrowhead
    const ang = Math.atan2(ay1 - c1y, ax1 - c1x);
    const hs = Math.max(6.5, 15 * k);
    const head = function () {
      ctx.beginPath();
      ctx.moveTo(ax1 + Math.cos(ang) * hs * 0.75, ay1 + Math.sin(ang) * hs * 0.75);
      ctx.lineTo(ax1 + Math.cos(ang + 2.3) * hs, ay1 + Math.sin(ang + 2.3) * hs);
      ctx.lineTo(ax1 + Math.cos(ang - 2.3) * hs, ay1 + Math.sin(ang - 2.3) * hs);
      ctx.closePath();
    };
    ctx.fillStyle = '#4a2716'; ctx.lineWidth = Math.max(3, 5 * k); head(); ctx.stroke(); ctx.fill();
    ctx.strokeStyle = '#fff8ea'; ctx.lineWidth = Math.max(2.5, 5.5 * k);
    ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.quadraticCurveTo(c1x, c1y, ax1, ay1); ctx.stroke();
    ctx.fillStyle = '#fff8ea'; head(); ctx.fill();
    // pill: soft shadow, cream body, thin warm outline, inner stitched line
    ctx.shadowColor = 'rgba(60, 25, 10, 0.35)'; ctx.shadowBlur = 6 * Math.max(1, k * 2); ctx.shadowOffsetY = 2;
    u.roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fillStyle = '#fbf3e4'; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.lineWidth = Math.max(1, 1.6 * k * 2); ctx.strokeStyle = '#c7ad8b'; ctx.stroke();
    const ins = Math.max(2.2, h * 0.12);
    u.roundRect(ctx, cx - w / 2 + ins, cy - h / 2 + ins, w - 2 * ins, h - 2 * ins, (h - 2 * ins) / 2);
    ctx.setLineDash([Math.max(2, font * 0.25), Math.max(1.5, font * 0.18)]);
    ctx.lineWidth = Math.max(0.8, font * 0.07); ctx.strokeStyle = 'rgba(196, 160, 118, 0.75)'; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#4b2817';
    ctx.fillText(text, cx, cy + font * 0.04);
    ctx.restore();
  }

  WW.render.features = { CUE: CUE, stitchFor: stitchFor, stitchEntry: stitchEntry, drawCue: drawCue };
})(globalThis.WW = globalThis.WW || {});
