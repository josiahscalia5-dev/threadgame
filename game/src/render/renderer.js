/* Wishweave Wonders — renderer entry point (WW.render.createRenderer), docs/ARCHITECTURE.md §8 and §12.

   const r = WW.render.createRenderer({ canvas, images, assets, plates, level, debug });
   r.resize(cssW, cssH, dpr)   backing store capped at DPR 2; drawing happens in CSS px
   r.render(state, dtReal)     one frame from read-only sim state; dtReal only drives cosmetic animation
   r.handleEvents(events)      sim events → cosmetic effects (§12.5); pickups/drops/recoveries are also diffed from state
   r.getTapTargets()           [{id, x, y, r}] CSS px for stitches currently 'ready' on screen (r ≥ 44)
   r.worldToScreen(plate, x, y), r.getLayout(), r.setDebug(on)

   Layers per plate view: framing → plate → unopened-route ghost (+roll) → depth-sorted actors/items (by ground y) with
   occluder redraws → effects → world cues; a connector/loop/return transition draws two views split at a sweeping
   tower column (the outgoing plate's `wipe` strip) with Purl running at his interpolated screen anchor. */
(function (WW) {
  'use strict';
  WW.render = WW.render || {};

  const PW = 841, PH = 1870;

  function createRenderer(opts) {
    const u = WW.render.util, cam = WW.render.camera, world = WW.render.world, actors = WW.render.actors,
      feats = WW.render.features, fx = WW.render.fx;
    const canvas = opts.canvas;
    const R = {
      canvas: canvas, ctx: canvas.getContext('2d'), images: opts.images || {}, assets: opts.assets || WW.ASSETS,
      plates: opts.plates || WW.PLATES, level: opts.level || WW.LEVEL, debug: !!opts.debug, tuning: opts.tuning || WW.TUNING || {},
      cache: {}, clock: 0, dpr: 1, fit: null, cam: null, views: [], fx: fx.create(),
      prev: null, itemScreen: {}, readySince: {}, dropAnim: {}, trSnap: null, events: [],
      tapTargets: [], purlScreen: null, lastPurlPose: null, sceneKey: ''
    };
    const ctx = R.ctx;

    /* ---------------- helpers ---------------- */
    const route = function () { return R.level.route || []; };
    function segIndex(x) {
      const rt = route();
      if (typeof x === 'number') return rt[x] ? x : -1;
      for (let i = 0; i < rt.length; i++) if (rt[i].id === x) return i;
      for (let i = 0; i < rt.length; i++) if (rt[i].kind === 'plate' && rt[i].plate === x) return i;
      return -1;
    }
    function platePos(seg) { const s = route()[seg]; return s && s.kind === 'plate' ? s.plate : null; }

    function resolveScene(state) {
      const rt = route(), purl = state.purl || {};
      let idx = purl.seg | 0;
      if (!rt[idx]) idx = 0;
      const seg = rt[idx] || { kind: 'plate', plate: 'p01' };
      const tr = state.transition;
      if (tr && (tr.kind === 'loop' || tr.kind === 'return')) {
        const fi = segIndex(tr.from), ti = segIndex(tr.to);
        if (fi >= 0 && ti >= 0 && platePos(fi) && platePos(ti)) {
          return { kind: 'transition', tkind: tr.kind, fromIdx: fi, toIdx: ti, from: platePos(fi), to: platePos(ti),
            t: u.clamp(tr.t || 0, 0, 1), style: tr.style || 'right' };
        }
      }
      if (seg.kind === 'connector') {
        let fi = idx - 1, ti = idx + 1;
        if (!(rt[fi] && rt[fi].plate === seg.from)) fi = segIndex(seg.from);
        if (!(rt[ti] && rt[ti].plate === seg.to)) ti = segIndex(seg.to);
        const t = tr && tr.kind === 'connector' && typeof tr.t === 'number' ? tr.t : (purl.f || 0);
        return { kind: 'transition', tkind: 'connector', fromIdx: fi, toIdx: ti, from: seg.from, to: seg.to,
          t: u.clamp(t, 0, 1), style: (tr && tr.style) || seg.style || 'right' };
      }
      return { kind: 'plate', idx: idx, plate: seg.plate };
    }

    function pathFor(P, owner) { return P && P[owner] && P[owner].path; }

    function hudTarget(who) {
      try {
        const el = document.getElementById(who === 'loop' ? 'hud-loop' : 'hud-purl');
        if (el && el.offsetParent !== null) {
          const a = el.getBoundingClientRect(), c = canvas.getBoundingClientRect();
          if (a.width > 0) return { x: a.left - c.left + a.width * 0.2, y: a.top - c.top + a.height * 0.5 };
        }
      } catch (e) { /* no DOM HUD (harness) */ }
      return { x: R.fit.W * (who === 'loop' ? 0.66 : 0.33), y: R.fit.H * 0.125 };
    }

    /* ---------------- state diffs → cosmetic effects ---------------- */
    function diffState(state) {
      const prev = R.prev || { items: {}, stitches: {} };
      const next = { items: {}, stitches: {} };
      const items = state.items || {};
      for (const id in items) {
        const it = items[id], was = prev.items[id];
        next.items[id] = it.status;
        if (!R.prev || was === undefined || was === it.status) continue;
        const color = it.color || (id.split('.')[1] || 'coral');
        const who = it.owner || (id.indexOf('loop.') === 0 ? 'loop' : 'purl');
        const seen = R.itemScreen[id];
        if (it.status === 'held') {
          if (seen && R.clock - seen.at < 0.5) {
            fx.flyup(R.fx, actors.SPOOL[color] || actors.SPOOL.coral, seen, hudTarget(who), seen.size);
            fx.sparkle(R.fx, seen.plate, seen.wx, seen.wy, 12, 140);
          }
          if (was === 'dropped' && seen) fx.callout(R.fx, seen.plate, seen.wx, seen.wy - 90, '+1 THREAD', who === 'loop' ? 'teal' : 'coral');
          delete R.dropAnim[id];
        } else if (it.status === 'dropped') {
          const from = R.lastPurlPose && who === 'purl' ? R.lastPurlPose : null;
          R.dropAnim[id] = { at: R.clock, from: from };
          if (from) fx.callout(R.fx, from.plate, from.x, from.y - from.w * 1.25, '−1 THREAD', who === 'loop' ? 'teal' : 'coral');
        }
      }
      const sts = state.stitches || {};
      for (const id in sts) {
        const s = sts[id], was = prev.stitches[id];
        next.stitches[id] = s.state;
        if (s.state === 'ready' && was !== 'ready') R.readySince[id] = R.clock;
        if (R.prev && s.state === 'animating' && was !== 'animating') {
          const pl = stitchPlate(id), S = pl && R.plates[pl].stitch;
          if (S) fx.sparkle(R.fx, pl, S.x, S.y, 18, 220);
        }
      }
      R.prev = next;
    }

    function stitchPlate(id) {
      const def = R.level.stitches && R.level.stitches[id];
      const idx = def ? segIndex(def.seg) : -1;
      return idx >= 0 ? platePos(idx) : null;
    }

    function processEvents(state) {
      const evs = R.events; R.events = [];
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (!e || !e.type) continue;
        if (e.type === 'jump' && e.who !== 'loop' && R.lastPurlPose) {
          const p = R.lastPurlPose; fx.dust(R.fx, p.plate, p.x, p.y, p.w);
        } else if (e.type === 'stitch-open') {
          const pl = stitchPlate(e.id), S = pl && R.plates[pl].stitch;
          if (S) fx.sparkle(R.fx, pl, S.x, S.y - 20, 10, 160);
        }
      }
    }

    /* ---------------- world drawing ---------------- */
    function setWorld(v) { const d = R.dpr; ctx.setTransform(d * v.s, 0, 0, d * v.s, d * v.ox, d * v.oy); }
    function setScreen() { const d = R.dpr; ctx.setTransform(d, 0, 0, d, 0, 0); }

    function occluderList(P) {
      const key = 'occ:' + P.id;
      if (R.cache[key]) return R.cache[key];
      const list = (P.occluders || []).map(function (o) { return { id: o.id, poly: o.poly, behindY: o.behindY, box: u.polyBox(o.poly) }; });
      R.cache[key] = list;
      return list;
    }

    function racerEntry(v, P, who, st, state) {
      const path = pathFor(P, who);
      if (!path) return null;
      const f = u.clamp(st.f || 0, 0, 1);
      const p = WW.path.racerPoint(path, f, st.laneX || 0, st.jumpH || 0);
      const lift = p.groundY - p.y;
      const w = p.w;
      const opt = { clock: R.clock + (who === 'loop' ? 0.37 : 0) };
      if (who === 'purl') {
        const t = state.time || 0;
        if (st.immuneUntil && t < st.immuneUntil) opt.rim = 0.35 + 0.2 * Math.sin(R.clock * 9);
        R.purlScreen = { x: v.ox + p.x * v.s, y: v.oy + p.groundY * v.s, w: w * v.s };
        R.lastPurlPose = { plate: v.plate, x: p.x, y: p.groundY, w: w };
      }
      return {
        y: p.groundY, who: who,
        box: { x0: p.x - w * 0.6, y0: p.y - w * 1.15, x1: p.x + w * 0.6, y1: p.groundY + 4 },
        draw: function (c) { actors.drawRacer(R, c, who, st, p.x, p.groundY, lift, w, opt); }
      };
    }

    function itemEntries(v, P, state, out) {
      const items = state.items || {};
      let n = 0;
      for (const id in items) {
        const it = items[id];
        n++;
        if (!it || it.status === 'held' || it.available === false) continue;
        const owner = it.owner || (id.indexOf('loop.') === 0 ? 'loop' : 'purl');
        const idx = segIndex(it.seg);
        if (idx !== v.segIdx) continue;
        const path = pathFor(P, owner);
        if (!path) continue;
        const color = it.color || id.split('.')[1] || 'coral';
        const size = actors.itemSize(P, owner, color);
        const pt = WW.path.racerPoint(path, u.clamp(it.f || 0, 0, 1), owner === 'purl' ? (it.lane || 0) : 0, 0);
        let x = pt.x, y = pt.groundY, hover;
        const da = R.dropAnim[id];
        let ring = 0;
        if (it.status === 'dropped') {
          const age = da ? R.clock - da.at : 9;
          if (da && da.from && da.from.plate === v.plate && age < 0.6) {
            const k = age / 0.6, e = u.easeOutCubic(k);
            x = u.lerp(da.from.x, pt.x, e); y = u.lerp(da.from.y, pt.groundY, e);
            hover = Math.sin(k * Math.PI) * da.from.w * 0.9 + Math.abs(Math.sin(k * Math.PI * 2)) * 0;
          } else {
            const b = age - 0.6;
            hover = Math.abs(Math.sin(b * 3.4)) * size * 0.16 * Math.exp(-Math.max(0, b) * 0.25) + 3;
            ring = 1;
          }
        }
        const phase = n * 1.7;
        const wx = x, wy = y;
        R.itemScreen[id] = { x: v.ox + x * v.s, y: v.oy + (y - size * 0.6) * v.s, size: size * v.s, plate: v.plate, wx: wx, wy: wy - size * 0.6, at: R.clock };
        out.push({
          y: wy, box: { x0: x - size, y0: y - size * 2.2, x1: x + size, y1: y + 6 },
          draw: function (c) {
            if (ring) drawDropRing(c, wx, wy, size);
            actors.drawSpool(R, c, color, wx, wy, size, { clock: R.clock, phase: phase, hover: hover });
          }
        });
      }
    }

    function drawDropRing(c, x, y, size) {
      const ph = (R.clock * 0.9) % 1;
      c.save();
      for (let i = 0; i < 2; i++) {
        const p = (ph + i * 0.5) % 1;
        const r = size * (0.55 + 0.6 * p);
        c.globalAlpha = (1 - p) * 0.85;
        c.strokeStyle = '#ffe08a'; c.lineWidth = 3.5 * (1 - p * 0.5);
        c.beginPath(); c.ellipse(x, y, r, r * 0.34, 0, 0, Math.PI * 2); c.stroke();
      }
      c.restore();
    }

    function loopTaskFx(v, P, st) {
      if (st.action !== 'task' && st.action !== 'hesitate') return;
      const ev = (P.loop && P.loop.events) || [];
      let best = null, bd = 1e9;
      for (let i = 0; i < ev.length; i++) {
        if (ev[i].type !== 'task' || ev[i].x === undefined) continue;
        if (st.task && st.task.kind && ev[i].kind !== st.task.kind) continue;
        const d = Math.abs((ev[i].f || 0) - (st.f || 0));
        if (d < bd) { bd = d; best = ev[i]; }
      }
      if (!best || best.kind === 'bypass') return;
      const s = WW.path.sample(P.loop.path, u.clamp(st.f || 0, 0, 1)).w * 0.55;
      const glow = u.glowSprite(R.cache, 'rgba(255,214,120,0.9)', 0.15);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45 + 0.2 * Math.sin(R.clock * 6);
      ctx.drawImage(glow, best.x - s, best.y - s, 2 * s, 2 * s);
      ctx.restore();
      ctx.fillStyle = '#fff2c0';
      for (let i = 0; i < 3; i++) {
        const a = R.clock * 2 + i * 2.1;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(R.clock * 7 + i);
        u.star(ctx, best.x + Math.cos(a) * s * 0.5, best.y + Math.sin(a) * s * 0.3, s * 0.22, a);
      }
      ctx.globalAlpha = 1;
    }

    /* One plate view. opts: {purl: bool, rect: {x,y,w,h}} */
    function drawWorld(v, state, opts) {
      const P = R.plates[v.plate];
      if (!P) return;
      setScreen();
      world.drawFraming(R, ctx, v, opts.rect);
      setWorld(v);
      world.drawBackground(R, ctx, v, state, R.clock, null);
      // depth-sorted actors
      const list = [];
      const purl = state.purl || {}, loop = state.loop || {};
      if (opts.purl && (purl.seg | 0) === v.segIdx) { const e = racerEntry(v, P, 'purl', purl, state); if (e) list.push(e); }
      if (loop && typeof loop.seg === 'number' && loop.seg === v.segIdx && route()[loop.seg] && route()[loop.seg].kind === 'plate') {
        const e = racerEntry(v, P, 'loop', loop, state); if (e) list.push(e);
      }
      itemEntries(v, P, state, list);
      const se = feats.stitchEntry(R, v.plate, state); if (se) list.push(se);
      list.sort(function (a, b) { return a.y - b.y; });
      const occ = occluderList(P);
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        e.draw(ctx);
        for (let k = 0; k < occ.length; k++) {
          const o = occ[k];
          if (e.y < o.behindY && u.boxHit(e.box, o.box)) world.drawBackground(R, ctx, v, state, R.clock, o.poly);
        }
      }
      if (loop && loop.seg === v.segIdx) loopTaskFx(v, P, loop);
      fx.drawWorld(R.fx, ctx, v.plate);
      if (R.debug) drawDebugWorld(v, P);
      setScreen();
      // world cues
      if (opts.cues !== false && P.stitch) {
        const S = P.stitch, st = state.stitches && state.stitches[S.id];
        const def = R.level.stitches && R.level.stitches[S.id];
        if (st && st.state === 'ready' && (!def || segIndex(def.seg) === v.segIdx)) {
          const age = R.clock - (R.readySince[S.id] === undefined ? R.clock : R.readySince[S.id]);
          const order = Object.keys(R.level.stitches || {}).indexOf(S.id);
          const text = order < 2 || age >= (R.tuning.cueRepeatAfter || 4);
          feats.drawCue(R, ctx, v, S, { clock: R.clock, age: age, text: text });
          R.tapTargets.push({ id: S.id, x: v.ox + S.x * v.s, y: v.oy + S.y * v.s, r: Math.max(44, (S.r || 70) * v.s) });
        }
      }
      drawCallouts(v);
    }

    function drawCallouts(v) {
      for (let i = 0; i < R.fx.callouts.length; i++) {
        const c = R.fx.callouts[i];
        if (c.plate !== v.plate) continue;
        const k = c.life / c.max;
        const img = R.images[c.kind === 'teal' ? 'ui.bubble-teal' : 'ui.bubble-coral'];
        const x = v.ox + c.x * v.s, y = v.oy + c.y * v.s - u.easeOutCubic(k) * 26;
        const w = Math.max(96, 230 * v.s), h = img && img.naturalWidth ? w * img.naturalHeight / img.naturalWidth : w * 0.3;
        const pop = k < 0.15 ? u.easeOutBack(k / 0.15) : 1;
        ctx.save();
        ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
        ctx.translate(x, y); ctx.scale(pop, pop);
        if (u.imgReady(img)) ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.font = '900 ' + (h * 0.4).toFixed(1) + 'px Nunito, "Baloo 2", "Trebuchet MS", Roboto, Arial, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fffaf0';
        ctx.fillText(c.text, 0, h * 0.02);
        ctx.restore();
      }
    }

    /* ---------------- scenes ---------------- */
    function drawPlateScene(state, sc, dt) {
      const P = R.plates[sc.plate];
      const purl = state.purl || {};
      const tgt = cam.target(R.fit, P, u.clamp(purl.f || 0, 0, 1));
      if (!R.cam || R.cam.plate !== sc.plate || R.snapNext) { R.cam = { plate: tgt.plate, z: tgt.z, fx: tgt.fx, fy: tgt.fy }; R.snapNext = false; }
      else cam.follow(R.cam, tgt, dt);
      cam.clampCam(R.fit, R.cam);
      const v = cam.view(R.fit, R.cam); v.segIdx = sc.idx;
      R.views = [v];
      R.trSnap = null;
      drawWorld(v, state, { purl: true, rect: { x: 0, y: 0, w: R.fit.W, h: R.fit.H } });
    }

    function drawTransitionScene(state, sc) {
      const Pf = R.plates[sc.from], Pt = R.plates[sc.to];
      if (!Pf || !Pt) return;
      const W = R.fit.W, H = R.fit.H;
      const key = sc.tkind + ':' + sc.fromIdx + '>' + sc.toIdx;
      let snap = R.trSnap && R.trSnap.key === key ? R.trSnap : null;
      if (!snap) {
        const outF = cam.exitF(Pf);
        const live = R.cam && R.cam.plate === sc.from && sc.t < 0.25;
        const c0 = live ? { plate: R.cam.plate, z: R.cam.z, fx: R.cam.fx, fy: R.cam.fy } : cam.target(R.fit, Pf, outF);
        const v0 = cam.view(R.fit, c0);
        let pose = live && R.lastPurlPose && R.lastPurlPose.plate === sc.from ? R.lastPurlPose : null;
        if (!pose) { const p = WW.path.racerPoint(Pf.purl.path, outF, 0, 0); pose = { x: p.x, y: p.groundY, w: p.w }; }
        snap = R.trSnap = { key: key, cam: c0, purl: { x: v0.ox + pose.x * v0.s, y: v0.oy + pose.y * v0.s, w: pose.w * v0.s } };
      }
      const inF = (sc.tkind === 'loop' || sc.tkind === 'return') ? cam.eventF(Pt, 'loopReturn', 0) : 0;
      const cIn = cam.target(R.fit, Pt, inF);
      const e = u.easeInOut(sc.t);
      const dir = sc.style === 'left' ? -1 : 1;
      const vOut = cam.view(R.fit, snap.cam, -dir * e * W * 0.32); vOut.segIdx = sc.fromIdx;
      const vIn = cam.view(R.fit, cIn, dir * (1 - e) * W * 0.32); vIn.segIdx = sc.toIdx;
      // the sweeping tower column (outgoing plate's wipe strip, a little nearer than the plate)
      const wipe = Pf.wipe || { x0: 380, x1: 470 };
      const kc = Math.max(vOut.s, H / PH) * 1.12;
      const cw = (wipe.x1 - wipe.x0) * kc;
      const cx = dir > 0 ? u.lerp(W + cw * 0.5, -cw * 0.5, e) : u.lerp(-cw * 0.5, W + cw * 0.5, e);
      const outRect = dir > 0 ? { x: 0, y: 0, w: Math.max(0, cx), h: H } : { x: cx, y: 0, w: Math.max(0, W - cx), h: H };
      const inRect = dir > 0 ? { x: cx, y: 0, w: Math.max(0, W - cx), h: H } : { x: 0, y: 0, w: Math.max(0, cx), h: H };
      R.views = [vIn, vOut];
      if (outRect.w > 0) { setScreen(); ctx.save(); ctx.beginPath(); ctx.rect(outRect.x, outRect.y, outRect.w, outRect.h); ctx.clip(); drawWorld(vOut, state, { purl: false, rect: outRect, cues: false }); ctx.restore(); }
      if (inRect.w > 0) { setScreen(); ctx.save(); ctx.beginPath(); ctx.rect(inRect.x, inRect.y, inRect.w, inRect.h); ctx.clip(); drawWorld(vIn, state, { purl: false, rect: inRect, cues: false }); ctx.restore(); }
      setScreen();
      drawColumn(Pf, wipe, snap.cam, cx, cw, kc);
      // Purl keeps running at his (interpolated) screen anchor
      const pIn = WW.path.racerPoint(Pt.purl.path, inF, 0, 0);
      const a = snap.purl, b = { x: vIn.ox - dir * (1 - e) * W * 0.32 + pIn.x * vIn.s, y: vIn.oy + pIn.groundY * vIn.s, w: pIn.w * vIn.s };
      const x = u.lerp(a.x, b.x, e), y = u.lerp(a.y, b.y, e), w = u.lerp(a.w, b.w, e);
      const purl = state.purl || {};
      const st = { action: 'transition', distance: purl.distance || 0, jumpH: purl.jumpH || 0, speed: purl.speed };
      actors.drawRacer(R, ctx, 'purl', st, x, y, (purl.jumpH || 0) * 0.42 * w, w, { clock: R.clock });
      R.purlScreen = { x: x, y: y, w: w };
      R.cam = { plate: cIn.plate, z: cIn.z, fx: cIn.fx, fy: cIn.fy };
    }

    function drawColumn(Pf, wipe, c0, cx, cw, kc) {
      const img = world.plateImg(R, Pf.id);
      if (!u.imgReady(img) || cx < -cw || cx > R.fit.W + cw) return;
      const H = R.fit.H;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const srcH = Math.min(PH, H / kc);
      const srcY = u.clamp(c0.fy - srcH / 2, 0, PH - srcH);
      const dh = srcH * kc, dy = (H - dh) / 2;
      const x0 = cx - cw / 2;
      // contact shadows on both sides
      for (let s = -1; s <= 1; s += 2) {
        const ex = s < 0 ? x0 : x0 + cw;
        const gw = Math.max(18, cw * 0.22);
        const g = ctx.createLinearGradient(ex, 0, ex + s * gw, 0);
        g.addColorStop(0, 'rgba(30, 12, 4, 0.5)'); g.addColorStop(1, 'rgba(30, 12, 4, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(s < 0 ? ex - gw : ex, 0, gw, H);
      }
      ctx.drawImage(img, wipe.x0 * iw / PW, srcY * ih / PH, (wipe.x1 - wipe.x0) * iw / PW, srcH * ih / PH, x0, dy, cw, dh);
      // near-camera shading so the column reads as foreground
      const g2 = ctx.createLinearGradient(x0, 0, x0 + cw, 0);
      g2.addColorStop(0, 'rgba(40, 16, 6, 0.42)'); g2.addColorStop(0.35, 'rgba(40, 16, 6, 0.08)');
      g2.addColorStop(0.65, 'rgba(40, 16, 6, 0.08)'); g2.addColorStop(1, 'rgba(40, 16, 6, 0.42)');
      ctx.fillStyle = g2;
      ctx.fillRect(x0, dy, cw, dh);
    }

    /* ---------------- debug ---------------- */
    function drawDebugWorld(v, P) {
      const lw = 2 / v.s;
      ctx.save();
      ctx.lineWidth = lw;
      const drawPath = function (path, color, lanes) {
        const d = WW.path.prepare(path).dense;
        ctx.strokeStyle = color;
        ctx.beginPath(); d.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke();
        if (lanes) {
          ctx.setLineDash([6 / v.s, 6 / v.s]);
          [-1, 1].forEach(function (s) { ctx.beginPath(); d.forEach(function (q, i) { const x = q[0] + s * q[3]; if (i) ctx.lineTo(x, q[1]); else ctx.moveTo(x, q[1]); }); ctx.stroke(); });
          ctx.setLineDash([]);
        }
      };
      if (P.purl) drawPath(P.purl.path, '#ff3070', true);
      if (P.loop) drawPath(P.loop.path, '#10e0e0', false);
      const mark = function (path, evs, color) {
        (evs || []).forEach(function (ev) {
          if (typeof ev.f !== 'number') return;
          const s = WW.path.sample(path, ev.f);
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.fill();
          ctx.font = (12 / Math.max(0.5, v.s * 1.4)).toFixed(0) + 'px monospace'; ctx.fillStyle = '#fff';
          ctx.fillText(ev.type + (ev.item ? ':' + ev.item : '') + (ev.kind ? ':' + ev.kind : '') + ' ' + ev.f, s.x + 9, s.y - 4);
          if (ev.x !== undefined) { ctx.strokeStyle = color; ctx.strokeRect(ev.x - 8, ev.y - 8, 16, 16); }
        });
      };
      if (P.purl) mark(P.purl.path, P.purl.events, '#ff3070');
      if (P.loop) mark(P.loop.path, P.loop.events, '#10e0e0');
      (P.occluders || []).forEach(function (o) {
        ctx.strokeStyle = '#ffee00'; ctx.setLineDash([8 / v.s, 5 / v.s]); WW.render.util.polyPath(ctx, o.poly); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,238,0,0.12)'; ctx.fill();
        ctx.beginPath(); ctx.moveTo(o.box ? o.box.x0 : o.poly[0][0], o.behindY); ctx.lineTo(PW, o.behindY); ctx.stroke();
      });
      const info = world.routeInfo(R, P.id);
      if (info) { ctx.strokeStyle = '#ffffff'; const ed = u.bandEdges(info.band, 0, 1); u.polyline(ctx, ed[0]); ctx.stroke(); u.polyline(ctx, ed[1]); ctx.stroke(); }
      if (P.stitch) { ctx.strokeStyle = '#ffd000'; ctx.beginPath(); ctx.arc(P.stitch.x, P.stitch.y, P.stitch.r, 0, Math.PI * 2); ctx.stroke(); }
      if (P.wipe) { ctx.strokeStyle = 'rgba(255,128,0,0.8)'; ctx.strokeRect(P.wipe.x0, 0, P.wipe.x1 - P.wipe.x0, PH); }
      ctx.restore();
    }

    function drawDebugScreen(state, sc) {
      setScreen();
      ctx.save();
      R.tapTargets.forEach(function (t) { ctx.strokeStyle = '#00ff66'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2); ctx.stroke(); });
      const p = state.purl || {}, c = R.cam || {};
      ctx.font = '11px monospace'; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(4, R.fit.H - 34, 300, 30);
      ctx.fillStyle = '#fff';
      ctx.fillText((sc.kind === 'plate' ? sc.plate : sc.tkind + ' ' + sc.from + '>' + sc.to + ' t=' + sc.t.toFixed(2)) +
        ' f=' + (p.f || 0).toFixed(3) + ' lane=' + (p.laneX || 0).toFixed(2) + ' ' + (p.action || ''), 8, R.fit.H - 22);
      ctx.fillText('z=' + (c.z || 0).toFixed(2) + ' fx=' + (c.fx || 0).toFixed(0) + ' fy=' + (c.fy || 0).toFixed(0) + ' t=' + (state.time || 0).toFixed(2), 8, R.fit.H - 9);
      ctx.restore();
    }

    /* ---------------- public API ---------------- */
    function resize(cssW, cssH, dpr) {
      const d = Math.min(Math.max(dpr || 1, 1), 2);
      cssW = Math.max(1, cssW || canvas.clientWidth || 360); cssH = Math.max(1, cssH || canvas.clientHeight || 800);
      R.dpr = d;
      const bw = Math.round(cssW * d), bh = Math.round(cssH * d);
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      R.fit = cam.fit(cssW, cssH);
      R.snapNext = true;
      R.trSnap = null;
    }

    function render(state, dtReal) {
      if (!R.fit) resize(canvas.clientWidth, canvas.clientHeight, (typeof devicePixelRatio === 'number') ? devicePixelRatio : 1);
      state = state || {};
      const dt = state.paused ? 0 : u.clamp(dtReal || 0, 0, 0.1);
      R.clock += dt;
      fx.update(R.fx, dt);
      diffState(state);
      processEvents(state);
      R.tapTargets = [];
      setScreen();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#2b150c';
      ctx.fillRect(0, 0, R.fit.W, R.fit.H);
      const sc = resolveScene(state);
      if (sc.kind === 'plate' && R.plates[sc.plate]) drawPlateScene(state, sc, dt);
      else if (sc.kind === 'transition') { R.tapTargets = []; drawTransitionScene(state, sc); }
      setScreen();
      fx.drawScreen(R.fx, ctx, R);
      if (R.debug) drawDebugScreen(state, sc);
    }

    function getTapTargets() { return R.tapTargets.map(function (t) { return { id: t.id, x: t.x, y: t.y, r: t.r }; }); }

    function worldToScreen(plateId, x, y) {
      for (let i = 0; i < R.views.length; i++) {
        const v = R.views[i];
        if (v.plate === plateId) return { x: v.ox + x * v.s, y: v.oy + y * v.s };
      }
      return null;
    }

    function getLayout() {
      const f = R.fit || cam.fit(canvas.clientWidth || 360, canvas.clientHeight || 800);
      return { view: { x: f.x0, y: f.y0, w: PW * f.s0, h: PH * f.s0 },
        purl: R.purlScreen ? { x: R.purlScreen.x, y: R.purlScreen.y, w: R.purlScreen.w } : null };
    }

    function handleEvents(events) {
      if (!events || !events.length) return;
      for (let i = 0; i < events.length; i++) R.events.push(events[i]);
      if (R.events.length > 64) R.events.splice(0, R.events.length - 64);
    }

    return {
      resize: resize, render: render, getTapTargets: getTapTargets, worldToScreen: worldToScreen, getLayout: getLayout,
      handleEvents: handleEvents, setDebug: function (on) { R.debug = !!on; }, _R: R
    };
  }

  WW.render.createRenderer = createRenderer;
})(globalThis.WW = globalThis.WW || {});
