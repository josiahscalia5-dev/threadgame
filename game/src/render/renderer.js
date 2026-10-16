/* Wishweave Wonders — Canvas 2D renderer (WW.render).

     const r = WW.render.createRenderer({ canvas, images, assets: WW.ASSETS, plates: WW.PLATES, level: WW.LEVEL });
     r.resize(cssW, cssH, dpr);  r.render(race.state, dtReal);  r.onEvents(events);

   The painted scene ("plate", 841 × 1870) always covers the play column: it is cover-fitted, so there are never
   empty bars, and on screens wider than a phone the sides show a soft blurred copy of the same scene. A camera
   dollies into the plate as Purl runs so he stays lower-centre at an almost constant size while the scenery flows
   toward the viewer; between scenes the view whips round a tower to the next plate while both keep running.
   Depth: actors, spools and occluder polygons (plate pixels that are in front of a character) are painter-sorted
   by their ground y. Everything cosmetic (run cycles, particles, bobbing) uses dtReal; game state is read-only. */
(function (WW) {
  'use strict';
  const U = WW.util;
  const DW = WW.DESIGN.w, DH = WW.DESIGN.h;
  const COLUMN_ASPECT = 0.6;          // widest play column (w/h); beyond it the sides show the blurred scene
  const STRIDE_M = 2.0;               // metres per full four-frame run cycle
  const RUN = ['run-left', 'run-pass-a', 'run-right', 'run-pass-b'];
  const SPOOL = { coral: 'prop.coral-thread', teal: 'prop.teal-thread', gold: 'prop.golden-thread' };
  const GLOW = { coral: '255,120,140', teal: '90,230,225', gold: '255,215,110' };

  function easeInOut(t) { t = U.clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { t = U.clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); }

  function createRenderer(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    const images = opts.images, F = opts.assets.frames, PLATES = opts.plates, level = opts.level;
    const course = WW.sim.buildCourse(level, PLATES);
    const PS = course.purl, LS = course.loop;
    const debug = !!opts.debug;

    let W = 1, H = 1, dpr = 1;
    const col = { x: 0, w: 1 };
    let s0 = 1;                          // cover scale of a plate in the column at zoom 1
    let anim = 0;
    const cams = {};                     // per-plate damped camera {z, vx, vy}
    let viewKey = null, tr = null;       // current view and the active transition record
    const blurCache = {};
    let vignette = null;
    const fx = { motes: [], puffs: [], sparks: [], texts: [], flyers: [], petals: [] };
    let shake = 0, flash = 0, lastStep = { purl: -1, loop: -1 };
    let hud = { purl: null, loop: null };
    let last = null;                     // last frame's screen geometry (for events and layout queries)

    // ---------------------------------------------------------------- sizing
    function resize(cssW, cssH, ratio) {
      W = Math.max(1, cssW); H = Math.max(1, cssH);
      dpr = Math.min(2, ratio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      col.w = Math.min(W, Math.round(H * COLUMN_ASPECT));
      col.x = Math.round((W - col.w) / 2);
      s0 = Math.max(col.w / DW, H / DH);
      vignette = null;
      for (const k in cams) delete cams[k];
      viewKey = null; tr = null;
    }

    // ---------------------------------------------------------------- camera
    /* Camera for Purl at f on a plate: zoom keeps him near his entry size, his feet at anchorY. When Loop is on the
       same plate (`other`, his plate point), the zoom is limited so both racers stay in frame (a two-shot). */
    function camTarget(plateId, path, f, laneX, other) {
      const P = PLATES[plateId];
      const g = WW.path.racerPoint(path, f, (laneX || 0) * 0.35, 0);
      const anchorY = P.camera.anchorY || 0.8;
      let z = U.clamp(path[0][2] / g.w, 1, P.camera.zMax || 1.8);
      let cx = g.x;
      if (other) {
        const span = Math.abs(other.x - g.x) + (other.w + g.w) * 0.55;
        z = Math.max(1, Math.min(z, col.w * 0.86 / (s0 * span)));
        const vspan = g.y - (other.y - other.w * 1.15);          // Loop's head stays below the HUD band
        if (vspan > 0) z = Math.max(1, Math.min(z, H * (anchorY - 0.26) / (s0 * vspan)));
        cx = g.x * 0.55 + other.x * 0.45;
      }
      const s = s0 * z;
      const vx = cx - (col.w / 2) / s, vy = g.y - (H * anchorY) / s;
      return clampCam({ z: z, vx: vx, vy: vy });
    }
    function loopPoint(plateId, state) {
      const L = state.loop, ls = LS[L.seg];
      if (ls.kind !== 'plate' || ls.plate !== plateId) return null;
      const g = ls.toPath(L.f);
      if (g < -0.001 || g > 1.001) return null;
      return WW.path.racerPoint(PLATES[plateId].loop.path, U.clamp(g, 0, 1), 0, 0);
    }
    function clampCam(c) {
      const s = s0 * c.z;
      c.vx = U.clamp(c.vx, 0, Math.max(0, DW - col.w / s));
      c.vy = U.clamp(c.vy, 0, Math.max(0, DH - H / s));
      return c;
    }
    function follow(plateId, target, dt) {
      let c = cams[plateId];
      if (!c) { cams[plateId] = c = { z: target.z, vx: target.vx, vy: target.vy }; return c; }
      c.z = U.damp(c.z, target.z, 0.28, dt);
      c.vx = U.damp(c.vx, target.vx, 0.12, dt);
      c.vy = U.damp(c.vy, target.vy, 0.12, dt);
      return clampCam(c);
    }
    /* A "view" maps plate pixels to screen: X = ox + (x - vx) * s, Y = oy + (y - vy) * s. */
    function viewOf(plateId, c, ox, oy, zoomMul) {
      const s = s0 * c.z * (zoomMul || 1);
      return { plate: plateId, img: images[PLATES[plateId].image], s: s, vx: c.vx, vy: c.vy, ox: ox || 0, oy: oy || 0, z: c.z };
    }
    function toScreen(v, x, y) { return { x: col.x + v.ox + (x - v.vx) * v.s, y: v.oy + (y - v.vy) * v.s }; }

    // ---------------------------------------------------------------- drawing helpers
    function drawPlate(v) {
      // Source rectangle clamped to the image (views are kept inside the plate, so this is a safety net only).
      const sx = Math.max(0, v.vx), sy = Math.max(0, v.vy);
      const ex = Math.min(DW, v.vx + col.w / v.s), ey = Math.min(DH, v.vy + H / v.s);
      if (ex <= sx || ey <= sy) return;
      ctx.drawImage(v.img, sx, sy, ex - sx, ey - sy,
        col.x + v.ox + (sx - v.vx) * v.s, v.oy + (sy - v.vy) * v.s, (ex - sx) * v.s, (ey - sy) * v.s);
    }

    function blurred(plateId) {
      if (blurCache[plateId]) return blurCache[plateId];
      const c = document.createElement('canvas');
      c.width = 60; c.height = 134;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(images[PLATES[plateId].image], 0, 0, 60, 134);
      return (blurCache[plateId] = c);
    }
    function drawBackdrop(plateId) {
      if (col.w >= W - 1) return;
      const c = blurred(plateId);
      const s = Math.max(W / c.width, H / c.height);
      ctx.drawImage(c, (W - c.width * s) / 2, (H - c.height * s) / 2, c.width * s, c.height * s);
      ctx.fillStyle = 'rgba(30, 14, 8, 0.38)';
      ctx.fillRect(0, 0, W, H);
    }

    /* Draws frame `name` with its pivot at (x, y), scaled by `sc` (screen px per atlas px). */
    function sprite(name, x, y, sc, o) {
      const fr = F[name];
      if (!fr) return;
      const img = images[fr.img];
      o = o || {};
      const px = o.center ? fr.w / 2 : fr.px, py = o.center ? fr.h / 2 : fr.py;
      const sx = sc * (o.sx || 1), sy = sc * (o.sy || 1);
      if (o.rot || o.alpha !== undefined || o.flip || o.sx || o.sy) {
        ctx.save();
        if (o.alpha !== undefined) ctx.globalAlpha *= U.clamp(o.alpha, 0, 1);
        ctx.translate(x, y);
        if (o.rot) ctx.rotate(o.rot);
        ctx.scale(o.flip ? -sx : sx, sy);
        ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, -px, -py, fr.w, fr.h);
        ctx.restore();
      } else {
        ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, x - px * sc, y - py * sc, fr.w * sc, fr.h * sc);
      }
    }

    function shadow(x, y, w, k) {
      ctx.save();
      ctx.globalAlpha = 0.34 * k;
      ctx.fillStyle = '#2a0f08';
      ctx.beginPath();
      ctx.ellipse(x, y, w * 0.33 * (0.7 + 0.3 * k), w * 0.075 * (0.7 + 0.3 * k), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function glow(x, y, r, rgb, a) {
      if (r <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(' + rgb + ',' + (0.55 * a) + ')');
      g.addColorStop(0.45, 'rgba(' + rgb + ',' + (0.22 * a) + ')');
      g.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.restore();
    }

    function pill(text, x, y, size, kind, alpha) {
      ctx.save();
      ctx.globalAlpha = U.clamp(alpha, 0, 1);
      ctx.font = '900 ' + Math.round(size) + 'px Nunito, "Trebuchet MS", "Segoe UI", Roboto, Arial, sans-serif';
      const tw = ctx.measureText(text).width;
      const h = size * 1.75, w = tw + size * 1.6, r = h / 2;
      ctx.beginPath();
      ctx.moveTo(x - w / 2 + r, y - h / 2);
      ctx.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, r);
      ctx.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, r);
      ctx.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, r);
      ctx.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, r);
      ctx.closePath();
      ctx.shadowColor = 'rgba(60,25,10,0.45)'; ctx.shadowBlur = size * 0.5; ctx.shadowOffsetY = size * 0.15;
      const team = kind === 'loop' || kind === 'purl';
      ctx.fillStyle = kind === 'loop' ? '#0a8f9a' : kind === 'purl' ? '#e0365a' : '#fff6e4';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = Math.max(1.5, size * 0.12);
      ctx.strokeStyle = kind === 'hit' ? '#c43a55' : kind === 'good' ? '#d9a140' : team ? '#fff3d6' : '#c9a07a';
      ctx.stroke();
      ctx.fillStyle = kind === 'hit' ? '#a3203f' : kind === 'good' ? '#8a4d12' : team ? '#fffaf0' : '#5b2c16';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + size * 0.05);
      ctx.restore();
    }

    // ---------------------------------------------------------------- racers
    function racerPose(r, who, state) {
      const prefix = who + '.';
      if (state.mode === 'intro' || state.mode === 'countdown') return { name: prefix + 'idle', bob: Math.sin(anim * 2.4) * 0.008 };
      if (r.action === 'failed' || (who === 'purl' && r.failAt !== null)) return { name: prefix + 'stumble', bob: 0 };
      if (r.action === 'tangled' || r.action === 'stumble') return { name: prefix + 'stumble', bob: Math.sin(anim * 22) * 0.01 };
      if (r.action === 'finished') {
        const hop = Math.max(0, Math.sin(anim * 5.5));
        return { name: hop > 0.25 ? prefix + 'jump' : prefix + 'idle', bob: -hop * 0.22 };
      }
      if (r.jumpH > 0.02) return { name: prefix + 'jump', bob: 0 };
      if (r.action === 'hesitate' && r.speed < 1.5) return { name: prefix + 'idle', bob: Math.sin(anim * 3) * 0.01 };
      const phase = r.distance / STRIDE_M;
      const i = Math.floor(phase * 4) % 4;
      return { name: prefix + RUN[(i + 4) % 4], bob: -Math.abs(Math.sin(phase * Math.PI * 2)) * 0.035, step: i };
    }

    /* Draws a racer with its foot pivot at screen (x, groundY); w = screen width of the idle frame. */
    function drawRacer(who, r, state, x, gy, w, extra) {
      extra = extra || {};
      const pose = racerPose(r, who, state);
      const ref = F[who + '.idle'].w;
      const sc = w / ref;
      const lift = (r.jumpH || 0) * w * 0.55 - pose.bob * w;
      shadow(x, gy, w, 1 - U.clamp((r.jumpH || 0) * 0.7, 0, 0.7));
      const lean = extra.lean || 0;
      const immune = who === 'purl' && state.time < r.immuneUntil && r.failAt === null;
      const o = { rot: lean };
      if (immune) {
        // Subtle golden rim: a soft additive halo plus a gentle flicker.
        glow(x, gy - lift - w * 0.5, w * 0.75, '255,215,120', 0.55 + 0.25 * Math.sin(anim * 18));
        o.alpha = 0.82 + 0.18 * Math.sin(anim * 20);
      }
      if (pose.name.endsWith('jump') && r.action !== 'finished') {
        o.sy = 1.04; o.sx = 0.97;      // a little stretch in the air
      }
      sprite(pose.name, x, gy - lift, sc, o);
      if (r.action === 'tangled' || (who === 'purl' && r.failAt !== null)) drawTangle(x, gy, w);
      // Foot puffs on each footfall.
      if (pose.step !== undefined && (pose.step === 0 || pose.step === 2) && lastStep[who] !== pose.step && r.speed > 1) {
        fx.puffs.push({ x: x + (pose.step === 0 ? -0.16 : 0.16) * w, y: gy, r: w * 0.07, life: 0, max: 0.45 });
      }
      lastStep[who] = pose.step === undefined ? -1 : pose.step;
    }

    function drawTangle(x, gy, w) {
      ctx.save();
      ctx.strokeStyle = '#8e2a6e';
      ctx.lineWidth = Math.max(1.5, w * 0.025);
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const a = anim * 6 + i * 2.1;
        ctx.beginPath();
        ctx.ellipse(x + Math.sin(a) * w * 0.05, gy - w * (0.06 + i * 0.035), w * (0.3 - i * 0.03), w * 0.07, Math.sin(a * 0.7) * 0.25, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    function spool(color, x, gy, size, t, alpha) {
      const bob = (Math.sin(t * 3.2) * 0.5 + 0.5) * size * 0.1;
      glow(x, gy - size * 0.75 - bob, size * 1.25, GLOW[color], 0.8 + 0.2 * Math.sin(t * 4));
      const fr = F[SPOOL[color]];
      sprite(SPOOL[color], x, gy - bob, size / fr.w, alpha === undefined ? undefined : { alpha: alpha });
      // tiny twinkle
      const tw = (t * 1.3) % 1;
      if (tw < 0.35) star(x + size * 0.32, gy - size * 1.1 - bob, size * 0.22 * Math.sin(tw / 0.35 * Math.PI), '#fff7d0');
    }

    function star(x, y, r, color) {
      if (r <= 0.5) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, rr = i % 2 ? r * 0.28 : r;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // ---------------------------------------------------------------- one plate view with everything on it
    function drawScene(v, state, opts2) {
      opts2 = opts2 || {};
      const P = PLATES[v.plate];
      drawPlate(v);
      const list = [];   // {y, draw}
      const p = state.purl, L = state.loop;
      const pSeg = PS[p.seg];

      // --- Purl
      if (opts2.purl) {
        const q = opts2.purl;
        const youTag = state.mode === 'countdown' || (state.mode === 'running' && state.time < 1.5);
        list.push({ y: q.gy, draw: function () {
          drawRacer('purl', p, state, q.x, q.y, q.w, { lean: q.lean });
          if (youTag) pill('YOU', q.x, q.y - q.w * 1.12, Math.max(11, q.w * 0.075), 'purl', 1);
        } });
      }

      // --- Loop (only on this plate's segment and inside the window where he is on his painted path)
      const lSeg = LS[L.seg];
      if (!opts2.noLoop && lSeg.kind === 'plate' && lSeg.plate === v.plate) {
        const g = lSeg.toPath(L.f);
        if (g >= -0.001 && g <= 1.001) {
          const pt = WW.path.racerPoint(P.loop.path, U.clamp(g, 0, 1), 0, 0);
          const sp = toScreen(v, pt.x, pt.y);
          const lw = pt.w * v.s;
          list.push({ y: pt.y, draw: function () {
            drawRacer('loop', L, state, sp.x, sp.y, lw);
            pill('LOOP', sp.x, sp.y - lw * (1.12 + (L.jumpH || 0) * 0.55), Math.max(10, Math.min(15, lw * 0.11)), 'loop', 0.92);
          } });
        }
      }

      // --- threads lying in the world
      for (const id in state.items) {
        const it = state.items[id];
        if (it.status === 'held') continue;
        if (it.owner === 'purl') {
          const s = PS[it.seg];
          if (s.plate !== v.plate || !it.available) continue;
          if (it.status === 'uncollected' && it.color === 'gold' && state.butterfly.state !== 'gone' && state.butterfly.state !== 'exit') continue;
          const pt = WW.path.racerPoint(s.path, it.f, it.lane, 0);
          let x = pt.x, y = pt.y, w = it.size, up = 0, gy = pt.y;
          if (it.status === 'dropped') {
            const k = U.clamp((state.time - it.dropTime) / WW.TUNING.dropLandTime, 0, 1);
            if (k < 1) {
              const a = WW.path.racerPoint(s.path, it.fromF, it.fromLane, 0);
              x = U.lerp(a.x, pt.x, k); gy = U.lerp(a.y, pt.y, k);
              up = Math.sin(k * Math.PI) * a.w * 0.9;
              y = gy - up;
            }
          }
          if (it.color === 'gold' && it.status === 'uncollected' && state.butterfly.state === 'exit') {
            const k = U.clamp(state.butterfly.t / 0.35, 0, 1);   // the last bounce of the drop
            up = (1 - easeOut(k)) * w * 0.6; y = gy - up;
          }
          const sp = toScreen(v, x, y), sw = w * v.s;
          const dropped = it.status === 'dropped';
          list.push({ y: gy, draw: function () {
            shadow(sp.x, toScreen(v, x, gy).y, sw * 1.2, 0.6);
            if (dropped) ring(sp.x, toScreen(v, x, gy).y, sw);
            spool(it.color, sp.x, sp.y, sw, anim + it.f * 9);
          } });
        } else {
          const s = LS[it.seg];
          if (s.kind !== 'plate' || s.plate !== v.plate || opts2.noLoop) continue;
          const g = it.pathF !== null && it.pathF !== undefined ? it.pathF : s.toPath(it.f);
          if (g < 0 || g > 1) continue;
          const pt = WW.path.racerPoint(P.loop.path, g, 0, 0);
          const sp = toScreen(v, pt.x, pt.y), sw = it.size * v.s;
          list.push({ y: pt.y, draw: function () { spool(it.color, sp.x, sp.y, sw, anim + 2 + it.f * 7); } });
        }
      }

      // --- scene features
      if (P.snagling && pSeg.plate === v.plate) list.push.apply(list, snaglingItems(v, P, state));
      if (P.cameo && pSeg.plate === v.plate) list.push(cameoItem(v, P, state));
      if (P.tassels) list.push.apply(list, tasselItems(v, P, state));
      if (P.gate) list.push({ y: P.gate.arch[0][1] - 2, draw: function () { drawGate(v, P, state); } });   // veil is behind the racers

      // --- occluders as depth items: redraw the plate inside the polygon over anything farther away
      (P.occluders || []).forEach(function (o) {
        list.push({ y: o.behindY - 0.01, occ: true, draw: function () {
          ctx.save();
          ctx.beginPath();
          o.poly.forEach(function (pt, i) { const sp = toScreen(v, pt[0], pt[1]); if (i) ctx.lineTo(sp.x, sp.y); else ctx.moveTo(sp.x, sp.y); });
          ctx.closePath();
          ctx.clip();
          drawPlate(v);
          ctx.restore();
        } });
      });

      list.sort(function (a, b) { return a.y - b.y; });
      list.forEach(function (d) { d.draw(); });

      if (P.butterfly && pSeg.plate === v.plate) drawButterfly(v, P, state);
      if (debug) drawDebug(v, P);
    }

    function ring(x, y, w) {
      const k = (anim * 1.4) % 1;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 236, 160,' + (0.85 * (1 - k)) + ')';
      ctx.lineWidth = Math.max(2, w * 0.06);
      ctx.beginPath();
      ctx.ellipse(x, y, w * (0.5 + k * 0.6), w * (0.16 + k * 0.2), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function snaglingItems(v, P, state) {
      const sn = state.snagling, p = state.purl, seg = PS[p.seg];
      if (sn.state === 'concealed' || seg.kind !== 'plate' || seg.plate !== v.plate) return [];
      const T = WW.TUNING;
      const hide = P.snagling.hide, peek = P.snagling.peek;
      const tgt = WW.path.racerPoint(seg.path, sn.targetF, sn.targetLane, 0);
      const wT = tgt.w * 0.78;
      let x, y, gy, w, name, flip = false, alpha;
      if (sn.state === 'hop') {
        const k = sn.t / T.snagRevealToContact;
        if (k < 0.28) {                      // pops out from behind the tower
          const a = easeOut(k / 0.28);
          x = U.lerp(hide.x, peek.x, a); gy = U.lerp(hide.y, peek.y, a); w = U.lerp(hide.w, peek.w, a);
          y = gy - Math.sin(a * Math.PI) * w * 0.2;
          name = 'snag.alert';
        } else {                             // short readable hop into Purl's lane
          const a = (k - 0.28) / 0.72;
          x = U.lerp(peek.x, tgt.x - tgt.w * 0.05, a); gy = U.lerp(peek.y, tgt.y + 6, a); w = U.lerp(peek.w, wT, a);
          y = gy - Math.sin(a * Math.PI) * w * 0.55;
          name = a < 0.7 ? 'snag.reach' : 'snag.grab';
        }
      } else if (sn.state === 'strike') {
        x = tgt.x - tgt.w * 0.05; gy = y = tgt.y + 6; w = wT; name = 'snag.grab';
      } else if (sn.state === 'tangle') {
        const pp = WW.path.racerPoint(seg.path, p.f, p.laneX, 0);
        x = pp.x - pp.w * 0.32; gy = y = pp.y + 4; w = wT * 0.9; name = 'snag.spin';
      } else {                               // retreat back behind the tower
        const a = U.clamp(sn.t / T.snagRetreat, 0, 1);
        const from = sn.hit ? WW.path.racerPoint(seg.path, Math.max(0, p.f - 0.02), p.laneX - 0.6, 0) : tgt;
        x = U.lerp(from.x - from.w * 0.3, hide.x, easeInOut(a)); gy = U.lerp(from.y, hide.y, easeInOut(a));
        w = U.lerp(wT, hide.w, a);
        y = gy - Math.abs(Math.sin(a * Math.PI * 3)) * w * 0.12;
        name = sn.hit && a < 0.45 ? 'snag.cheer' : 'snag.walk';
        flip = true;
        alpha = 1 - U.clamp((a - 0.8) / 0.2, 0, 1);
      }
      const sp = toScreen(v, x, y), sg = toScreen(v, x, gy), sw = w * v.s;
      return [{ y: gy, draw: function () {
        shadow(sg.x, sg.y, sw, 0.8);
        sprite(name, sp.x, sp.y, sw / F['snag.idle'].w, { flip: flip, alpha: alpha });
      } }];
    }

    function cameoItem(v, P, state) {
      const c = P.cameo, p = state.purl;
      const f = PS[p.seg].plate === v.plate ? p.f : 0;
      const k = U.clamp((f - 0.12) / 0.15, 0, 1) * (1 - U.clamp((f - 0.7) / 0.15, 0, 1));
      const sp = toScreen(v, c.x, c.y), sw = c.w * v.s;
      return { y: c.y, draw: function () {
        if (k <= 0.01) return;
        const bob = Math.abs(Math.sin(anim * 3.1)) * 0.12;
        sprite('snag.peek', sp.x, sp.y + (1 - k) * sw * 0.4 - bob * sw * 0.3, sw / F['snag.idle'].w, { alpha: k });
      } };
    }

    function tasselItems(v, P, state) {
      const T = WW.TUNING;
      return P.tassels.map(function (ts, i) {
        const t = state.tassels.t >= 0 ? state.tassels.t - i * T.tasselStagger : -1;
        const k = t > 0 ? U.easeOutBack(U.clamp(t / T.tasselLift, 0, 1)) : 0;
        const y = ts.y - ts.lift * k;
        const sway = Math.sin(anim * 1.3 + i * 1.7) * 0.05 * (1 - k * 0.6) + (t > 0 && t < T.tasselLift ? Math.sin(t * 30) * 0.03 : 0);
        const sp = toScreen(v, ts.x, y), sw = ts.w * v.s;
        return { y: 880, draw: function () {
          // gold rope from the beam down to the tassel's cap
          ctx.save();
          ctx.strokeStyle = '#e2a43a'; ctx.lineWidth = Math.max(1.5, sw * 0.045);
          ctx.beginPath(); ctx.moveTo(sp.x, toScreen(v, ts.x, 150).y); ctx.lineTo(sp.x, sp.y + sw * 0.05); ctx.stroke();
          ctx.restore();
          if (t > 0 && t < T.tasselLift + 0.3) glow(sp.x, sp.y + sw * 0.4, sw * 0.9, '255,220,140', 1 - U.clamp(t / (T.tasselLift + 0.3), 0, 1));
          sprite('prop.swinging-tassel', sp.x, sp.y, sw / F['prop.swinging-tassel'].w, { rot: sway });
        } };
      });
    }

    function drawButterfly(v, P, state) {
      const b = state.butterfly, T = WW.TUNING, B = P.butterfly;
      const rest = toScreen(v, B.rest.x, B.rest.y);
      if (b.state === 'rest') {
        glow(rest.x, rest.y, B.rest.w * v.s * 0.8, '255,210,120', 0.25 + 0.2 * Math.sin(anim * 3));
        return;
      }
      if (b.state === 'gone') return;
      let x, y, w, name, alpha = 1, flapK = Math.sin(anim * 26);
      if (b.state === 'emerge') {
        const k = easeOut(b.t / T.butterflyEmerge);
        x = B.rest.x; y = B.rest.y - k * 12; w = B.rest.w * (1 + 0.15 * k);
        name = flapK > 0 ? 'feat.butterfly-open' : 'feat.butterfly-closed';
        glow(rest.x, rest.y, B.rest.w * v.s * (0.9 + k), '255,215,120', 1);
      } else if (b.state === 'fly' || b.state === 'place') {
        const k = b.state === 'fly' ? easeInOut(b.t / T.butterflyFly) : 1;
        const pts = B.flight.map(function (q) { return [q[0], q[1], q[2], 0]; });
        const sp = WW.path.sample(pts, k);
        x = sp.x; y = sp.y + (b.state === 'place' ? Math.sin(b.t / T.butterflyPlace * Math.PI) * 14 : 0); w = sp.w;
        name = 'feat.butterfly-carrying-spool';
        // glittering trail
        if (Math.random() < 0.7) {
          const s2 = toScreen(v, x, y);
          fx.sparks.push({ x: s2.x + (Math.random() - 0.5) * w * v.s * 0.4, y: s2.y + w * v.s * 0.1, vx: 0, vy: 20, r: 2 + Math.random() * 3, life: 0, max: 0.7, c: '#ffe7a0' });
        }
      } else {                                // exit
        const k = easeInOut(b.t / T.butterflyExit);
        const pts = B.exit.map(function (q) { return [q[0], q[1], q[2], 0]; });
        const sp = WW.path.sample(pts, k);
        x = sp.x; y = sp.y; w = sp.w;
        name = flapK > 0 ? 'feat.butterfly-open' : 'feat.butterfly-closed';
        alpha = 1 - U.clamp((k - 0.7) / 0.3, 0, 1);
      }
      const s = toScreen(v, x, y), sw = w * v.s, fr = F[name];
      const flap = name === 'feat.butterfly-carrying-spool' ? 0.82 + 0.18 * Math.abs(flapK) : 1;
      glow(s.x, s.y, sw * 0.7, '255,200,120', 0.6 * alpha);
      sprite(name, s.x, s.y, sw / fr.w, { center: true, sx: flap, alpha: alpha, rot: Math.sin(anim * 4) * 0.06 });
    }

    function drawGate(v, P, state) {
      const g = state.gate;
      if (g.state === 'open') return;
      const k = g.state === 'opening' ? U.clamp(g.t / 1.2, 0, 1) : 0;
      const a = (1 - k) * (0.5 + 0.08 * Math.sin(anim * 2.2));
      if (a <= 0.01) return;
      ctx.save();
      ctx.beginPath();
      P.gate.arch.forEach(function (pt, i) { const sp = toScreen(v, pt[0], pt[1]); if (i) ctx.lineTo(sp.x, sp.y); else ctx.moveTo(sp.x, sp.y); });
      ctx.closePath();
      ctx.clip();
      const c = toScreen(v, P.gate.x, P.gate.y);
      const r = 260 * v.s;
      const grd = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      grd.addColorStop(0, 'rgba(255,250,235,' + (a * 1.4) + ')');
      grd.addColorStop(0.6, 'rgba(255,214,226,' + a + ')');
      grd.addColorStop(1, 'rgba(255,190,160,' + (a * 0.8) + ')');
      ctx.fillStyle = grd;
      ctx.fillRect(c.x - r, c.y - r * 1.5, r * 2, r * 3);
      // drifting light threads in the veil
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,240,200,' + (a * 0.6) + ')';
      ctx.lineWidth = Math.max(1, 2 * v.s);
      for (let i = 0; i < 6; i++) {
        const ox = (i - 2.5) * 32 * v.s + Math.sin(anim * 0.9 + i) * 10 * v.s;
        ctx.beginPath();
        ctx.moveTo(c.x + ox, c.y - 220 * v.s);
        ctx.quadraticCurveTo(c.x + ox + 18 * v.s * Math.sin(anim + i), c.y, c.x + ox, c.y + 220 * v.s);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawDebug(v, P) {
      ctx.save();
      ctx.lineWidth = 2;
      [-1, 0, 1].forEach(function (l) {
        ctx.strokeStyle = l ? 'rgba(255,80,80,.7)' : 'rgba(255,40,40,1)';
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) { const q = WW.path.racerPoint(P.purl.path, i / 60, l, 0); const sp = toScreen(v, q.x, q.y); if (i) ctx.lineTo(sp.x, sp.y); else ctx.moveTo(sp.x, sp.y); }
        ctx.stroke();
      });
      ctx.strokeStyle = 'rgba(0,220,220,1)';
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) { const q = WW.path.racerPoint(P.loop.path, i / 60, 0, 0); const sp = toScreen(v, q.x, q.y); if (i) ctx.lineTo(sp.x, sp.y); else ctx.moveTo(sp.x, sp.y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,0,.9)';
      (P.occluders || []).forEach(function (o) {
        ctx.beginPath();
        o.poly.forEach(function (pt, i) { const sp = toScreen(v, pt[0], pt[1]); if (i) ctx.lineTo(sp.x, sp.y); else ctx.moveTo(sp.x, sp.y); });
        ctx.closePath(); ctx.stroke();
      });
      ctx.restore();
    }

    // ---------------------------------------------------------------- effects (screen space)
    function updateFx(dt, state, focus, running) {
      // Forward-motion motes: drift out of the distance ahead of Purl and stream past the camera.
      if (running && focus) {
        const rate = 16;
        if (Math.random() < rate * dt) {
          const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 40;
          fx.motes.push({ x: focus.x + Math.cos(a) * d, y: focus.y + Math.sin(a) * d * 0.6, vx: Math.cos(a) * 30, vy: Math.sin(a) * 18,
                          r: 1 + Math.random() * 1.6, life: 0, max: 1.4 + Math.random() * 0.8 });
        }
      }
      fx.motes = fx.motes.filter(function (m) {
        m.life += dt;
        const acc = 1 + 2.2 * dt;
        m.vx *= acc; m.vy *= acc;
        m.x += m.vx * dt; m.y += m.vy * dt;
        m.r += dt * 2.2;
        return m.life < m.max && m.x > -20 && m.x < W + 20 && m.y > -20 && m.y < H + 20;
      });
      fx.puffs = fx.puffs.filter(function (p) { p.life += dt; return p.life < p.max; });
      fx.sparks = fx.sparks.filter(function (s) { s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 120 * dt; return s.life < s.max; });
      fx.texts = fx.texts.filter(function (t) { t.life += dt; return t.life < t.max; });
      fx.flyers = fx.flyers.filter(function (f) { f.life += dt; return f.life < f.max; });
      fx.petals = fx.petals.filter(function (p) {
        p.life += dt; p.x += (p.vx + Math.sin(p.life * 3 + p.ph) * 30) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        return p.life < p.max && p.y < H + 30;
      });
      shake = Math.max(0, shake - dt * 2.5);
      flash = Math.max(0, flash - dt * 1.8);
    }

    function drawFx() {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      fx.motes.forEach(function (m) {
        const a = Math.min(1, m.life * 3) * (1 - m.life / m.max);
        ctx.fillStyle = 'rgba(255, 236, 190,' + (0.55 * a) + ')';
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
      });
      fx.sparks.forEach(function (s) {
        star(s.x, s.y, s.r * (1 - s.life / s.max) * 1.6, s.c);
      });
      ctx.restore();
      fx.puffs.forEach(function (p) {
        const k = p.life / p.max;
        ctx.fillStyle = 'rgba(255, 238, 205,' + (0.4 * (1 - k)) + ')';
        ctx.beginPath(); ctx.ellipse(p.x, p.y - p.r * k, p.r * (1 + k * 1.5), p.r * 0.55 * (1 + k), 0, 0, Math.PI * 2); ctx.fill();
      });
      fx.petals.forEach(function (p) {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = 1 - U.clamp((p.life - p.max + 0.6) / 0.6, 0, 1);
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
      fx.flyers.forEach(function (f) {
        const k = easeInOut(f.life / f.max);
        const tgt = hud[f.who] || { x: col.x + col.w / 2, y: 60 };
        const x = U.lerp(f.x, tgt.x, k), y = U.lerp(f.y, tgt.y, k) - Math.sin(k * Math.PI) * 60;
        const size = U.lerp(f.size, 22, k);
        glow(x, y - size * 0.6, size * 1.4, GLOW[f.color], 1);
        sprite(SPOOL[f.color], x, y, size / F[SPOOL[f.color]].w);
      });
      fx.texts.forEach(function (t) {
        const k = t.life / t.max;
        const a = Math.min(1, t.life * 6) * (1 - U.clamp((k - 0.75) / 0.25, 0, 1));
        pill(t.text, t.x, t.y - k * 30, t.size, t.kind, a);
      });
    }

    function burst(x, y, color, n, spread) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = (0.4 + Math.random()) * spread;
        fx.sparks.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - spread * 0.6, r: 3 + Math.random() * 4, life: 0, max: 0.6 + Math.random() * 0.5, c: color });
      }
    }
    function confetti(n) {
      const colors = ['#ff5f7e', '#ffd25a', '#1fb7b8', '#ffffff', '#f59a3c'];
      for (let i = 0; i < n; i++) {
        fx.petals.push({ x: col.x + Math.random() * col.w, y: -20 - Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 40, vy: 90 + Math.random() * 90,
          r: 4 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, ph: Math.random() * 6, life: 0, max: 5 + Math.random() * 2,
          c: colors[i % colors.length] });
      }
    }

    function drawVignette() {
      if (!vignette) {
        vignette = ctx.createRadialGradient(col.x + col.w / 2, H * 0.55, Math.min(col.w, H) * 0.45, col.x + col.w / 2, H * 0.55, Math.max(col.w, H) * 0.75);
        vignette.addColorStop(0, 'rgba(40,15,5,0)');
        vignette.addColorStop(1, 'rgba(40,15,5,0.32)');
      }
      ctx.fillStyle = vignette;
      ctx.fillRect(col.x, 0, col.w, H);
    }

    // ---------------------------------------------------------------- main render
    function purlScreen(v, seg, f, laneX) {
      const pt = WW.path.racerPoint(seg.path, f, laneX, 0);
      const sp = toScreen(v, pt.x, pt.y);
      return { x: sp.x, y: sp.y, w: pt.w * v.s, gy: pt.y };
    }

    function render(state, dtReal) {
      const dt = Math.min(0.1, Math.max(0, dtReal || 0));
      if (!state.paused) anim += dt;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const p = state.purl, seg = PS[p.seg];
      const lean = U.clamp((p.lane - p.laneX) * 0.22, -0.2, 0.2);
      let focus = null;

      // Which view? A recovery/return loop, a connector between scenes, or a single scene.
      let key, A = null, B = null, t = 0, dir = 1;
      if (p.trans) {
        const from = PS[p.trans.fromSeg], to = PS[p.trans.toSeg];
        key = 'trans:' + p.trans.kind + ':' + p.trans.fromSeg + ':' + p.trans.toSeg;
        A = { seg: from, f: p.trans.fromF }; B = { seg: to, f: p.trans.toF }; t = p.trans.t; dir = -1;
      } else if (seg.kind === 'connector') {
        const from = PS[p.seg - 1], to = PS[p.seg + 1];
        key = 'conn:' + p.seg;
        A = { seg: from, f: from.exitF }; B = { seg: to, f: 0 }; t = p.f; dir = seg.style === 'left' ? -1 : 1;
      } else {
        key = 'plate:' + p.seg;
      }

      if (key !== viewKey) {
        if (A) {
          const camA = cams[A.seg.plate] ? Object.assign({}, cams[A.seg.plate]) : camTarget(A.seg.plate, A.seg.path, A.f, p.laneX);
          tr = { camA: camA, camB: camTarget(B.seg.plate, B.seg.path, B.f, 0), A: A, B: B };
        } else if (tr) {
          cams[seg.plate] = Object.assign({}, tr.camB);
          tr = null;
        }
        viewKey = key;
      }

      ctx.fillStyle = '#2b1810';
      ctx.fillRect(0, 0, W, H);

      const sx = shake > 0 ? (Math.random() - 0.5) * shake * 14 : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake * 10 : 0;

      if (!A) {
        // ---- single scene
        const cam = follow(seg.plate, camTarget(seg.plate, seg.path, p.f, p.laneX, loopPoint(seg.plate, state)), dt);
        drawBackdrop(seg.plate);
        ctx.save();
        ctx.beginPath(); ctx.rect(col.x, 0, col.w, H); ctx.clip();
        ctx.translate(sx, sy);
        const v = viewOf(seg.plate, cam);
        const q = purlScreen(v, seg, p.f, p.laneX);
        q.lean = lean;
        drawScene(v, state, { purl: q });
        const ahead = WW.path.racerPoint(seg.path, Math.min(1, p.f + 0.3), 0, 0);
        focus = toScreen(v, ahead.x, ahead.y - ahead.w * 0.5);
        last = { v: v, purl: q };
        ctx.restore();
      } else {
        // ---- whip round the tower: scene A slides out, scene B slides in, the tower column wipes the seam
        const e = easeInOut(t);
        const shift = e * col.w * dir;
        drawBackdrop(e < 0.5 ? A.seg.plate : B.seg.plate);
        ctx.save();
        ctx.beginPath(); ctx.rect(col.x, 0, col.w, H); ctx.clip();
        const push = 1 + 0.18 * e;
        const camA = tr.camA, camB = tr.camB;
        // zoom A about Purl's exit point so the scene seems to rush past him
        const exitPt = WW.path.racerPoint(A.seg.path, A.f, 0, 0);
        const vA0 = viewOf(A.seg.plate, camA);
        const exitS = toScreen(vA0, exitPt.x, exitPt.y);
        const vA = viewOf(A.seg.plate, camA, -shift, 0, push);
        vA.vx = exitPt.x - (exitS.x - col.x) / vA.s; vA.vy = exitPt.y - exitS.y / vA.s;
        const vB = viewOf(B.seg.plate, camB, (dir > 0 ? col.w : -col.w) - shift, 0, 1);
        const pull = 1 + 0.12 * (1 - e);   // scene B settles from slightly zoomed in (never out: no empty edges)
        const vB2 = viewOf(B.seg.plate, camB, vB.ox, 0, pull);
        const entryPt = WW.path.racerPoint(B.seg.path, B.f, 0, 0);
        const entryS = toScreen(viewOf(B.seg.plate, camB), entryPt.x, entryPt.y);
        vB2.vx = entryPt.x - (entryS.x - col.x) / vB2.s; vB2.vy = entryPt.y - entryS.y / vB2.s;
        drawScene(vA, state, { noLoop: true });
        drawScene(vB2, state, { noLoop: true });
        // the tower column passing in front of the camera covers the seam
        const P = PLATES[A.seg.plate], wipe = P.wipe || { x0: 380, x1: 470 };
        const seamX = col.x + (dir > 0 ? col.w - shift : -col.w - shift + col.w);
        const sxW = (wipe.x1 - wipe.x0);
        const colW = Math.max(col.w * 0.34, sxW * s0 * 1.7);
        if (e > 0.02 && e < 0.98) {
          ctx.save();
          ctx.drawImage(images[P.image], wipe.x0, 0, sxW, DH, seamX - colW / 2, -H * 0.15, colW, H * 1.3);
          const gr = ctx.createLinearGradient(seamX - colW / 2, 0, seamX + colW / 2, 0);
          gr.addColorStop(0, 'rgba(30,12,4,0.55)'); gr.addColorStop(0.5, 'rgba(30,12,4,0.15)'); gr.addColorStop(1, 'rgba(30,12,4,0.55)');
          ctx.fillStyle = gr;
          ctx.fillRect(seamX - colW / 2, 0, colW, H);
          ctx.restore();
        }
        // speed streaks
        ctx.save();
        ctx.globalAlpha = Math.sin(e * Math.PI) * 0.35;
        ctx.strokeStyle = '#fff4dc';
        for (let i = 0; i < 9; i++) {
          const yy = ((i * 97 + anim * 37) % H);
          const len = col.w * (0.15 + ((i * 53) % 10) / 30);
          const xx = col.x + ((i * 211 + anim * 1600 * dir) % (col.w + len)) * (dir > 0 ? -1 : 1) + (dir > 0 ? col.w + len : -len);
          ctx.lineWidth = 1 + (i % 3);
          ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + len * dir, yy); ctx.stroke();
        }
        ctx.restore();
        // Purl keeps running at his screen anchor, scaling smoothly from the exit pose to the entry pose.
        const qa = purlScreen(viewOf(A.seg.plate, camA), A.seg, A.f, 0);
        const qb = purlScreen(viewOf(B.seg.plate, camB), B.seg, B.f, 0);
        const q = { x: U.lerp(qa.x, qb.x, e), y: U.lerp(qa.y, qb.y, e), w: U.lerp(qa.w, qb.w, e), lean: dir * 0.12 * Math.sin(e * Math.PI) };
        drawRacer('purl', p, state, q.x, q.y, q.w, { lean: q.lean });
        last = { v: null, purl: q };
        ctx.restore();
      }

      updateFx(dt, state, focus, state.mode === 'running' && !state.paused && p.speed > 1);
      ctx.save();
      ctx.beginPath(); ctx.rect(col.x, 0, col.w, H); ctx.clip();
      drawVignette();
      drawFx();
      if (flash > 0) {
        ctx.fillStyle = 'rgba(200, 40, 70,' + (flash * 0.25) + ')';
        ctx.fillRect(col.x, 0, col.w, H);
      }
      ctx.restore();
    }

    // ---------------------------------------------------------------- events → effects
    function onEvents(events, state) {
      if (!events || !events.length || !last) return;
      const q = last.purl;
      events.forEach(function (e) {
        if (e.type === 'pickup' || e.type === 'recover') {
          const it = state.items[e.item];
          burst(q.x, q.y - q.w * 0.6, '#fff1b8', 18, q.w * 1.2);
          fx.flyers.push({ who: 'purl', color: it.color, x: q.x, y: q.y - q.w * 0.5, size: q.w * 0.35, life: 0, max: 0.75 });
          if (e.type === 'recover') fx.texts.push({ text: '+1 THREAD', x: q.x + q.w * 0.45, y: q.y - q.w * 1.05, size: Math.max(13, q.w * 0.085), kind: 'good', life: 0, max: 1.4 });
        } else if (e.type === 'drop') {
          shake = 1; flash = 1;
          fx.texts.push({ text: '−1 THREAD', x: q.x + q.w * 0.5, y: q.y - q.w * 1.1, size: Math.max(13, q.w * 0.085), kind: 'hit', life: 0, max: 1.5 });
        } else if (e.type === 'hit') {
          shake = Math.max(shake, 0.8); flash = Math.max(flash, 0.8);
        } else if (e.type === 'dodge') {
          burst(q.x, q.y - q.w * 0.4, '#bff7ff', 10, q.w * 0.8);
        } else if (e.type === 'finish' && e.who === 'purl') {
          confetti(70);
          burst(q.x, q.y - q.w * 1.2, '#ffe9a6', 30, q.w * 1.6);
        } else if (e.type === 'gate-open') {
          burst(col.x + col.w / 2, H * 0.42, '#ffd8e4', 34, col.w * 0.5);
        } else if (e.type === 'gold-placed') {
          // a little sparkle where the golden spool lands
          if (last.v) {
            const it = state.items['purl.gold'], s = PS[it.seg];
            const pt = WW.path.racerPoint(s.path, it.f, 0, 0), sp = toScreen(last.v, pt.x, pt.y);
            burst(sp.x, sp.y - 10, '#ffe58a', 14, 90);
          }
        } else if (e.type === 'loop-pickup' || e.type === 'loop-recover') {
          const it = state.items[e.item];
          const s = LS[it.seg];
          if (last.v && s.plate === last.v.plate) {
            const pt = WW.path.racerPoint(PLATES[s.plate].loop.path, U.clamp(s.toPath(it.f), 0, 1), 0, 0), sp = toScreen(last.v, pt.x, pt.y);
            burst(sp.x, sp.y - 20, '#bdf6f2', 10, 60);
          }
        }
      });
    }

    return {
      resize: resize,
      render: render,
      onEvents: onEvents,
      setHudAnchors: function (a) { hud = a || hud; },
      getLayout: function () { return { col: { x: col.x, w: col.w }, purl: last && last.purl }; },
      getTapTargets: function () { return []; },
      worldToScreen: function (plateId, x, y) { return last && last.v ? toScreen(last.v, x, y) : null; },
      drawFrame: function (c2, name, x, y, width) {
        const fr = F[name]; if (!fr) return;
        const sc = width / fr.w;
        c2.drawImage(images[fr.img], fr.x, fr.y, fr.w, fr.h, x - fr.px * sc, y - fr.py * sc, fr.w * sc, fr.h * sc);
      }
    };
  }

  WW.render = { createRenderer: createRenderer };
})(globalThis.WW = globalThis.WW || {});
