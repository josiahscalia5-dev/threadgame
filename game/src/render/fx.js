/* Wishweave Wonders — cosmetic effects (WW.render.fx): sparkles, petals and dust in plate space, pickup fly-ups and
   callouts in screen space. Driven only by the renderer's cosmetic clock (dtReal); never touches sim state.
   Randomness comes from a private seeded generator so captures are repeatable. */
(function (WW) {
  'use strict';
  WW.render = WW.render || {};
  const U = function () { return WW.render.util; };

  function create() {
    return { parts: [], flyups: [], callouts: [], rng: WW.rng(20261016) };
  }

  function rnd(F, lo, hi) { return lo + (hi - lo) * F.rng.next(); }

  /* Burst of gold sparkles at a plate point. */
  function sparkle(F, plate, x, y, n, spread, color) {
    for (let i = 0; i < n; i++) {
      const a = rnd(F, 0, Math.PI * 2), sp = rnd(F, 0.25, 1) * spread;
      F.parts.push({ kind: 'spark', plate: plate, x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - spread * 0.35,
        g: spread * 0.6, life: 0, max: rnd(F, 0.45, 0.9), size: rnd(F, 6, 13), rot: rnd(F, 0, 3), vr: rnd(F, -4, 4),
        color: color || (i % 3 ? '#ffe7a0' : '#fffbe8') });
    }
  }

  function petals(F, plate, x, y, n, spread) {
    const cols = ['#f45d8a', '#ffb3c9', '#ffd36e', '#ff8a5c', '#fff1d0'];
    for (let i = 0; i < n; i++) {
      const a = rnd(F, -Math.PI, 0), sp = rnd(F, 0.3, 1) * spread;
      F.parts.push({ kind: 'petal', plate: plate, x: x + rnd(F, -40, 40), y: y + rnd(F, -40, 40), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: spread * 0.35, drag: 0.6, life: 0, max: rnd(F, 1.6, 2.8), size: rnd(F, 10, 20), rot: rnd(F, 0, 6), vr: rnd(F, -5, 5),
        color: cols[i % cols.length] });
    }
  }

  function dust(F, plate, x, y, w) {
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 ? 1 : -1;
      F.parts.push({ kind: 'dust', plate: plate, x: x + dir * rnd(F, 0, w * 0.2), y: y, vx: dir * rnd(F, 0.2, 0.6) * w, vy: -rnd(F, 0.05, 0.2) * w,
        g: 0, drag: 3, life: 0, max: rnd(F, 0.3, 0.5), size: w * rnd(F, 0.045, 0.08), rot: 0, vr: 0, color: 'rgba(250,226,200,' });
    }
  }

  /* A spool flying from a screen point to the HUD target (screen px). */
  function flyup(F, frameName, from, to, size) {
    F.flyups.push({ frame: frameName, x0: from.x, y0: from.y, x1: to.x, y1: to.y, size0: size, life: 0, max: 0.75 });
  }

  /* World-anchored callout pill (bubble art) above a plate point. */
  function callout(F, plate, x, y, text, kind) {
    F.callouts.push({ plate: plate, x: x, y: y, text: text, kind: kind, life: 0, max: 1.6 });
  }

  function update(F, dt) {
    if (!(dt > 0)) return;
    const P = F.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life += dt;
      if (p.life >= p.max) { P.splice(i, 1); continue; }
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
    for (let i = F.flyups.length - 1; i >= 0; i--) { const f = F.flyups[i]; f.life += dt; if (f.life >= f.max) F.flyups.splice(i, 1); }
    for (let i = F.callouts.length - 1; i >= 0; i--) { const c = F.callouts[i]; c.life += dt; if (c.life >= c.max) F.callouts.splice(i, 1); }
  }

  /* Plate-space particles for one view (world transform already set). */
  function drawWorld(F, ctx, plate) {
    const u = U();
    for (let i = 0; i < F.parts.length; i++) {
      const p = F.parts[i];
      if (p.plate !== plate) continue;
      const k = p.life / p.max;
      if (p.kind === 'spark') {
        ctx.globalAlpha = (1 - k) * (k < 0.15 ? k / 0.15 : 1);
        ctx.fillStyle = p.color;
        u.star(ctx, p.x, p.y, p.size * (1 - 0.5 * k), p.rot);
      } else if (p.kind === 'petal') {
        ctx.globalAlpha = Math.min(1, (1 - k) * 2);
        ctx.fillStyle = p.color;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, 0.55 + 0.45 * Math.sin(p.rot * 1.7));
        ctx.beginPath(); ctx.ellipse(0, 0, p.size * 0.6, p.size * 0.32, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (p.kind === 'dust') {
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.color + (0.3 * (1 - k)).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + k), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* Screen-space fly-ups (CSS px transform set). */
  function drawScreen(F, ctx, R) {
    const u = U();
    for (let i = 0; i < F.flyups.length; i++) {
      const f = F.flyups[i], k = f.life / f.max;
      const e = u.easeInOut(k);
      const fr = R.assets.frames[f.frame];
      if (!fr) continue;
      const x = u.lerp(f.x0, f.x1, e), y = u.lerp(f.y0, f.y1, e) - Math.sin(k * Math.PI) * 60;
      const size = u.lerp(f.size0, Math.max(14, f.size0 * 0.45), e) * (1 + 0.25 * Math.sin(Math.min(1, k * 4) * Math.PI));
      const glow = u.glowSprite(R.cache, 'rgba(255,226,150,0.85)', 0.15);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6 * (1 - k * 0.6);
      ctx.drawImage(glow, x - size, y - size, size * 2, size * 2);
      ctx.restore();
      ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
      u.drawFrame(ctx, R.images[fr.img], fr, x, y + size * fr.h / fr.w * 0.5, size / fr.w);
      ctx.globalAlpha = 1;
    }
  }

  WW.render.fx = { create: create, sparkle: sparkle, petals: petals, dust: dust, flyup: flyup, callout: callout,
    update: update, drawWorld: drawWorld, drawScreen: drawScreen };
})(globalThis.WW = globalThis.WW || {});
