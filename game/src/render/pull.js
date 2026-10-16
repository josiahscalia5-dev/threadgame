/* Wishweave Wonders — the opening TOUCH → PULL → OPEN lesson (WW.render.pull). Lead-owned; see docs/PULL-STITCH.md
   and kit/pull-stitch/ (approved triptych frames + CLAUDIA-PULL-STITCH-PROMPT.txt).

   Reads the sim's pull stitch (stitches[id] with interaction 'pull': state, pull 0..1, gripping, elapsed) and
   state.tutorial; never writes state. Draws, on top of the existing p01 scene:
     • the gold loop on the carpet beside Purl while it is not gripped (glow, rings, "Touch the loop" pill + arrow);
     • while gripped: Purl's grounded reach, then a two-foot braced pull leaning back (synthesised from his rear
       idle/duck frames — no new character art), the gold strand fitted every frame from the roll's fastening to his
       grip, its slack falling to the carpet, small stitch lights at the roll, and the "Pull down" pill + arrow whose
       gold fill tracks the progress;
     • after the knot releases: a burst at the fastening and a short recoil; the prompt is gone.
   The roll is the one world.js already draws: openProgress() moves it up to PARTIAL of the band with the player's
   progress during the drag (Purl cannot enter — the sim's stop holds him), then the rest of the way in
   ribbonUnfurl s. Loop is drawn idle (breathing) while the lesson holds both racers. */
(function (WW) {
  'use strict';
  WW.render = WW.render || {};
  const U = function () { return WW.render.util; };

  const PARTIAL = 0.045;                                 // band fraction the roll travels during the drag (stays
                                                         // on the straight ramp base, horizontal, as in approved PULL)
  const HAND = { idle: [136, -165], duck: [132, -92] };  // Purl's right hand, frame px from the foot pivot
  const LABEL = { touch: 'Touch the loop', pull: 'Pull down' };
  /* Pill centre relative to the loop (plate px at zoom 1), from the approved TOUCH / PULL frames. */
  const PILL = { touch: { dx: 83, dy: -141 }, pull: { dx: 83, dy: -111 } };
  const LOOP_W = 58;                                     // gold loop sprite width (as the other stitches)
  const LABEL_K = 1.5;                                   // lesson pills/arrows are 1.5× the later "Tap the stitch" cue (approved triptych)
  const FONT = '800 {s}px Nunito, "Baloo 2", "Trebuchet MS", "Segoe UI", Roboto, Arial, sans-serif';

  const metas = new WeakMap();
  function isPull(st) { return !!st && st.interaction === 'pull'; }
  function meta(st) {
    let k = metas.get(st);
    if (!k) {
      k = { shown: st.pull || 0, grip: st.gripping ? 1 : 0, tug: 0, last: st.pull || 0, wasGrip: !!st.gripping,
            wasState: st.state, hand: null, fasten: null, plate: null };
      metas.set(st, k);
    }
    return k;
  }

  /* Roll position along the band for a pull stitch (world.js asks this instead of its tap timing). */
  function openProgress(st) {
    const u = U();
    if (st.state === 'open') return 1;
    if (st.state === 'animating') return u.lerp(PARTIAL, 1, u.easeInOut(st.t || 0));
    return PARTIAL * u.easeOutCubic(u.clamp(meta(st).shown, 0, 1));
  }

  /* Per-frame cosmetic smoothing and one-shot effects (dt is 0 while paused). */
  function update(R, state, dt) {
    const sts = state && state.stitches;
    if (!sts || !(dt > 0)) return;
    const fx = WW.render.fx;
    Object.keys(sts).forEach(function (id) {
      const st = sts[id];
      if (!isPull(st)) return;
      const k = meta(st);
      const target = st.state === 'ready' ? (st.pull || 0) : 1;
      const big = dt >= 0.5;                             // one manual advance of a whole second: settle at once
      k.shown = big ? target : k.shown + (target - k.shown) * (1 - Math.exp(-dt / 0.06));
      if (Math.abs(target - k.shown) < 1e-3) k.shown = target;
      const g = st.gripping ? 1 : 0;
      k.grip = big ? g : k.grip + (g - k.grip) * (1 - Math.exp(-dt / 0.07));
      const gain = (st.pull || 0) - k.last;
      if (gain > 0) k.tug = Math.min(1, k.tug + gain * 5);
      k.last = st.pull || 0;
      k.tug *= Math.exp(-dt / 0.14);
      if (st.gripping && !k.wasGrip && k.hand) fx.sparkle(R.fx, k.plate, k.hand.x, k.hand.y, 5, 50);
      if (st.state === 'animating' && k.wasState === 'ready' && k.fasten) {
        fx.sparkle(R.fx, k.plate, k.fasten.x, k.fasten.y, 24, 170);       // the knot pops open
      }
      k.wasGrip = !!st.gripping;
      k.wasState = st.state;
    });
  }

  /* Purl's lesson pose (frame + lean about his feet). */
  function poseFor(st, k, clock) {
    const u = U();
    if (st.state === 'ready') {
      if (k.grip > 0.05) {
        if ((st.pull || 0) < 0.03) return { pose: 'idle', rot: 0.1 * k.grip, sx: 1, sy: 1 - 0.035 * k.grip };   // reach
        return { pose: 'duck', rot: -(0.05 + 0.06 * k.shown) - 0.05 * k.tug,                                      // brace
                 sx: 1 + 0.02 * k.tug, sy: 1 - 0.03 * k.tug };
      }
      return { pose: 'idle', rot: k.shown > 0 ? -0.025 : 0.02 * Math.sin(clock * 1.3), sx: 1, sy: 1 };
    }
    if (st.state === 'animating') {                                  // knot release: falls back, then recovers
      const e = st.elapsed || 0;
      if (e < 0.16) return { pose: 'duck', rot: -0.11 - 0.06 * (e / 0.16), sx: 1, sy: 1 };
      const q = Math.min(1, (e - 0.16) / 0.45);
      return { pose: 'idle', rot: -0.15 * (1 - u.easeOutCubic(q)) + 0.03 * Math.sin(q * Math.PI), sx: 1, sy: 1 };
    }
    return { pose: 'idle', rot: 0, sx: 1, sy: 1 };
  }

  function handPoint(pe, pose) {
    const actors = WW.render.actors;
    const h = HAND[pose.pose] || HAND.idle, s = actors.scaleFor('purl', pe.w);
    const hx = h[0] * s * pose.sx, hy = h[1] * s * pose.sy, r = pose.rot || 0;
    return { x: pe.x + hx * Math.cos(r) - hy * Math.sin(r), y: pe.y + hx * Math.sin(r) + hy * Math.cos(r) };
  }

  /* The fastening on the roll's face (where the gold strand is tied). */
  function fastening(R, plateId, s) {
    const g = WW.render.world.rollGeom && WW.render.world.rollGeom(R, plateId, s);
    if (!g) return null;
    const lx = 0.1 * g.w, ly = -0.36 * g.h, c = Math.cos(g.ang), sn = Math.sin(g.ang);
    return { x: g.x + lx * c - ly * sn, y: g.y + lx * sn + ly * c, w: g.w, s: s };
  }

  /* Twisted gold yarn along a quadratic/cubic curve given as sampled points. */
  function yarn(ctx, pts, width, alpha) {
    const u = U();
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(96, 52, 8, 0.85)'; ctx.lineWidth = width * 1.45; u.polyline(ctx, pts); ctx.stroke();
    ctx.strokeStyle = '#e2a93a'; ctx.lineWidth = width; u.polyline(ctx, pts); ctx.stroke();
    ctx.setLineDash([width * 0.55, width * 0.75]);
    ctx.strokeStyle = 'rgba(150, 92, 18, 0.9)'; ctx.lineWidth = width * 0.8; u.polyline(ctx, pts); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255, 238, 170, 0.85)'; ctx.lineWidth = width * 0.28;
    ctx.translate(-width * 0.18, -width * 0.18); u.polyline(ctx, pts); ctx.stroke();
    ctx.restore();
  }

  function quad(a, c, b, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, m = 1 - t;
      out.push([m * m * a.x + 2 * m * t * c.x + t * t * b.x, m * m * a.y + 2 * m * t * c.y + t * t * b.y]);
    }
    return out;
  }
  function cubic(a, c1, c2, b, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, m = 1 - t;
      out.push([m * m * m * a.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t * t * t * b.x,
                m * m * m * a.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t * t * t * b.y]);
    }
    return out;
  }

  /* World entries for the lesson (depth-sorted with the actors by renderer.js). */
  function entries(R, v, P, state, list) {
    const S = P && P.stitch, st = S && state.stitches && state.stitches[S.id];
    if (!isPull(st)) return;
    const u = U(), k = meta(st), clock = R.clock;
    k.plate = v.plate;
    const lesson = !!(state.tutorial && state.tutorial.id === S.id);
    if (lesson) list.forEach(function (e) { if (e.who === 'loop' && e.opt) e.opt.pose = 'idle'; });
    const s = openProgress(st);
    const F = st.state === 'open' ? null : fastening(R, v.plate, s);
    k.fasten = F;
    const pe = list.filter(function (e) { return e.who === 'purl'; })[0];
    let hand = null;
    if (pe && lesson && pe.opt) {
      const pose = poseFor(st, k, clock);
      pe.opt.pose = pose.pose; pe.opt.rot = pose.rot; pe.opt.sx = pose.sx; pe.opt.sy = pose.sy;
      hand = handPoint(pe, pose);
      k.hand = hand;
    }
    const nobox = { x0: -9, y0: -9, x1: -8, y1: -8 };
    const pw = pe ? pe.w : 190;
    const width = Math.max(6, pw * 0.055);
    // the gold loop on the carpet (in Purl's hand while gripped)
    const fr = R.assets.frames['feat.stitch-loop'];
    if (fr && st.state === 'ready' && k.grip < 0.6) {
      const w = LOOP_W * (S.r || 70) / 70, h = w * fr.h / fr.w;
      const bottom = S.y + 0.73 * h;
      list.push({ y: bottom - 4, box: { x0: S.x - w, y0: bottom - h, x1: S.x + w, y1: bottom },
        draw: function (c) {
          U().drawFrame(c, R.images[fr.img], fr, S.x, bottom, w / fr.w, 1, 1, 1 - k.grip / 0.6);
        } });
    }
    if (!F || st.state !== 'ready') return;
    if (hand && k.grip > 0.05) {
      // taut strand fastening → grip, slack from the grip down to the carpet
      const tension = k.grip * (0.55 + 0.45 * Math.min(1, k.shown * 3 + k.tug));
      const mid = { x: (F.x + hand.x) / 2, y: (F.y + hand.y) / 2 + (1 - tension) * 60 + 12 };
      const G = { x: S.x + 30, y: S.y + 34 };
      const sl = { x: hand.x + (G.x - hand.x) * 0.25, y: Math.max(hand.y, G.y) + 26 };
      list.push({ y: pe.y - 0.5, box: nobox, draw: function (c) {
        yarn(c, quad(hand, sl, G, 14), width * 0.9, 0.95);
        yarn(c, quad(F, mid, hand, 18), width, 1);
        stitchLights(R, c, v.plate, s, k, clock);
      } });
    } else if (k.shown > 0.005) {
      // released with progress kept: the strand lies from the fastening to the loop on the carpet
      const L = { x: S.x - 4, y: S.y + 6 };
      const mid = { x: (F.x + L.x) / 2 + 20, y: (F.y + L.y) / 2 + 70 };
      list.push({ y: S.y - 2, box: nobox, draw: function (c) { yarn(c, quad(F, mid, L, 18), width * 0.9, 0.95); } });
    }
  }

  /* Small stitch lights along the roll's front while the drag moves it. */
  function stitchLights(R, ctx, plateId, s, k, clock) {
    const info = WW.render.world.routeInfo(R, plateId);
    if (!info) return;
    const u = U();
    const a = Math.min(1, k.grip * (0.35 + 0.65 * Math.min(1, k.shown * 2 + k.tug)));
    if (a <= 0.02) return;
    ctx.save();
    ctx.fillStyle = '#fff2b8';
    for (let i = 0; i < 6; i++) {
      const p = u.bandAt(info.band, Math.max(0, s - 0.02 - 0.03 * (i >> 1)));
      const side = i % 2 ? 1 : -1;
      const tw = 0.5 + 0.5 * Math.sin(clock * 7 + i * 1.9);
      ctx.globalAlpha = a * tw;
      u.star(ctx, p.x + side * p.nx * p.hw * 0.95, p.y + side * p.ny * p.hw * 0.95, 7 + 6 * tw, clock + i);
    }
    ctx.restore();
  }

  /* Screen-space cue (ctx in CSS px): glow + rings on the loop, the pill and its arrow. */
  function drawCue(R, ctx, v, S, st, opts) {
    const u = U(), k = meta(st), clock = R.clock;
    const z = v.s, x = v.ox + S.x * z, y = v.oy + S.y * z;
    const fade = u.smooth((opts.age || 0) / 0.35);
    const mode = st.gripping ? 'pull' : 'touch';
    if (mode === 'touch' && WW.render.features) {
      WW.render.features.drawCue(R, ctx, v, S, { clock: clock, age: opts.age || 0, text: false });
    }
    const cfg = PILL[mode];
    const bob = mode === 'touch' ? Math.sin(clock * 2.4) * 2.5 * z : 0;
    const cx = x + cfg.dx * z, cy = y + cfg.dy * z + bob;
    const zl = z * LABEL_K;
    ctx.save();
    ctx.globalAlpha = fade;
    const font = Math.max(13, 24 * zl);
    ctx.font = FONT.replace('{s}', font.toFixed(1));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const text = LABEL[mode];
    const tw = ctx.measureText(text).width;
    const h = font * 2.0, w = tw + font * 1.35;
    // arrow (behind the pill's lower edge)
    let pts;
    if (mode === 'touch') {
      const a = { x: cx - w * 0.2, y: cy + h * 0.4 }, b = { x: x + 14 * z, y: y - 42 * z };
      pts = quad(a, { x: a.x - 8 * z, y: a.y + (b.y - a.y) * 0.75 }, b, 12);
    } else {
      const a = { x: cx - w * 0.24, y: cy + h * 0.42 }, b = { x: cx - w * 0.04, y: cy + h * 0.42 + 210 * z };
      pts = cubic(a, { x: a.x - 50 * z, y: a.y + 90 * z }, { x: b.x - 30 * z, y: b.y - 70 * z }, b, 20);
    }
    arrow(ctx, pts, zl, mode === 'pull' ? k.shown : 0);
    // pill
    ctx.shadowColor = 'rgba(60, 25, 10, 0.35)'; ctx.shadowBlur = 6 * Math.max(1, zl * 2); ctx.shadowOffsetY = 2;
    u.roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fillStyle = '#fbf3e4'; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.lineWidth = Math.max(1, 1.6 * zl * 2); ctx.strokeStyle = '#c7ad8b'; ctx.stroke();
    const ins = Math.max(2.2, h * 0.12);
    u.roundRect(ctx, cx - w / 2 + ins, cy - h / 2 + ins, w - 2 * ins, h - 2 * ins, (h - 2 * ins) / 2);
    ctx.setLineDash([Math.max(2, font * 0.25), Math.max(1.5, font * 0.18)]);
    ctx.lineWidth = Math.max(0.8, font * 0.07); ctx.strokeStyle = 'rgba(196, 160, 118, 0.75)'; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#4b2817';
    ctx.fillText(text, cx, cy + font * 0.04);
    ctx.restore();
  }

  /* Dark-outlined cream arrow along pts with a head at the end; `fill` 0..1 paints it gold from the root
     (continuous progress feedback while pulling). */
  function arrow(ctx, pts, z, fill) {
    const u = U();
    const n = pts.length - 1, e = pts[n], p = pts[n - 1];
    const ang = Math.atan2(e[1] - p[1], e[0] - p[0]);
    const hs = Math.max(6.5, 15 * z);
    const head = function () {
      ctx.beginPath();
      ctx.moveTo(e[0] + Math.cos(ang) * hs * 0.75, e[1] + Math.sin(ang) * hs * 0.75);
      ctx.lineTo(e[0] + Math.cos(ang + 2.3) * hs, e[1] + Math.sin(ang + 2.3) * hs);
      ctx.lineTo(e[0] + Math.cos(ang - 2.3) * hs, e[1] + Math.sin(ang - 2.3) * hs);
      ctx.closePath();
    };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#4a2716'; ctx.lineWidth = Math.max(5, 11.5 * z);
    u.polyline(ctx, pts); ctx.stroke();
    ctx.fillStyle = '#4a2716'; ctx.lineWidth = Math.max(3, 5 * z); head(); ctx.stroke(); ctx.fill();
    ctx.strokeStyle = '#fff8ea'; ctx.lineWidth = Math.max(2.5, 5.5 * z);
    u.polyline(ctx, pts); ctx.stroke();
    ctx.fillStyle = '#fff8ea'; head(); ctx.fill();
    if (fill > 0.01) {
      const m = Math.max(1, Math.round(n * Math.min(1, fill)));
      ctx.strokeStyle = '#f2b638'; ctx.lineWidth = Math.max(2.5, 5.5 * z);
      u.polyline(ctx, pts.slice(0, m + 1)); ctx.stroke();
      if (fill >= 0.999) { ctx.fillStyle = '#f2b638'; head(); ctx.fill(); }
    }
  }

  WW.render.pull = { PARTIAL: PARTIAL, isPull: isPull, openProgress: openProgress, update: update, entries: entries,
                     drawCue: drawCue, poseFor: poseFor };
})(globalThis.WW = globalThis.WW || {});
