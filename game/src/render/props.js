/* Wishweave Wonders — 3D renderer: thread spools and world effects.

   Spools: each thread type has one big spool station on the road (WW.LEVEL.threads, from the kit's collectibles:
   red 15 %, teal 52 %, gold 80 % of the course), hovering 0.9 m over its lateral position, spinning and bobbing.
   Each racer pulls his own thread from it as he passes (sim/inventory.js), so the station stays; a pickup shows as
   a stream of sparks from the spool to that racer. A missed thread that is offered again ahead is drawn as a
   smaller spool ringed in its owner's colour (coral = Purl, teal = Loop).

   Effects (pooled sprites, all in world space): pickup sparks, jump/land dust, brake scuff, Loop's stumble stars,
   finish confetti.

     const P = WW.render.props.create(THREE, M, course, level)
     P.group, P.update(state, dt, t), P.handleEvents(events, state), P.reset(), P.dispose() */
(function (WW) {
  'use strict';
  const R = WW.render = WW.render || {};
  const TYPE_COLOR = { coral: 'red', teal: 'teal', gold: 'gold' };
  const HEX = { coral: 0xff4466, red: 0xff4466, teal: 0x29d6cf, gold: 0xffc94d, purl: 0xff5a6e, loop: 0x2fd3cc,
                dust: 0xf3d6b4, star: 0xfff2a0, confetti: [0xff5a8a, 0xffd34d, 0x35d3c8, 0xffffff] };

  function create(THREE, M, course, level) {
    const group = new THREE.Group(); group.name = 'props';
    const owned = [];
    const main = course.main;
    const S = function (s, lat) { return WW.route.sample(main, s, lat, null); };

    function spoolMesh(color, scale) {
      const g = new THREE.Group();
      const wood = M.gold;
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.46, 24), M.spool(color));
      const rimA = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.07, 28), wood);
      const rimB = rimA.clone();
      rimA.position.y = 0.26; rimB.position.y = -0.26;
      const bead = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 8, 28), M.rope);
      bead.rotation.x = Math.PI / 2; bead.position.y = 0.26;
      const beadB = bead.clone(); beadB.position.y = -0.26;
      owned.push(core.geometry, rimA.geometry, bead.geometry);
      g.add(core, rimA, rimB, bead, beadB);
      g.scale.setScalar(scale || 1);
      return g;
    }
    function glowSprite(color, size) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.textures.glow, color: color, transparent: true, depthWrite: false,
                                                             blending: THREE.AdditiveBlending, opacity: 0.7 }));
      sp.scale.set(size, size, 1); owned.push(sp.material);
      return sp;
    }
    function ringDecal(color, radius) {
      const m = new THREE.Mesh(new THREE.RingGeometry(radius * 0.7, radius, 32),
        new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.55, depthWrite: false,
                                      polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
      owned.push(m.geometry, m.material);
      return m;
    }

    /* ---- the three spool stations ---- */
    const stations = (level.threads || []).map(function (th) {
      const sp = th.spool, q = S(sp.mainS, sp.lateral);
      const g = new THREE.Group();
      const spool = spoolMesh(th.color, 1.15);
      const glow = glowSprite(HEX[th.color], 2.4);
      const ring = ringDecal(HEX[th.color], 0.75);
      g.add(spool, glow);
      g.position.set(q.position[0], q.position[1] + sp.hover, q.position[2]);
      ring.position.set(q.position[0], q.position[1] + 0.03, q.position[2]); ring.rotation.x = -Math.PI / 2;
      group.add(g, ring);
      return { color: th.color, group: g, spool: spool, glow: glow, base: g.position.clone(), q: q };
    });

    /* ---- re-offered (missed) threads: pooled small spools ---- */
    const offers = {};
    function offerFor(item) {
      if (offers[item.id]) return offers[item.id];
      const g = new THREE.Group();
      g.add(spoolMesh(item.color, 0.8), glowSprite(HEX[item.color], 1.6));
      const ring = ringDecal(HEX[item.owner], 0.55);
      group.add(g, ring);
      offers[item.id] = { group: g, ring: ring };
      return offers[item.id];
    }

    /* ---- particles ---- */
    const parts = [];
    const pool = [];
    function particle(map, color, additive) {
      let p = pool.pop();
      if (!p) {
        p = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.textures.spark, transparent: true, depthWrite: false }));
        owned.push(p.material);
      }
      p.material.map = map || M.textures.spark;
      p.material.color.setHex(color);
      p.material.blending = additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
      p.material.needsUpdate = true;
      p.visible = true;
      group.add(p);
      return p;
    }
    function burst(pos, n, opts) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, up = opts.up || 1.5;
        const sp = opts.speed || 1.5;
        const col = Array.isArray(opts.color) ? opts.color[i % opts.color.length] : opts.color;
        const p = particle(opts.map, col, opts.additive);
        p.position.set(pos[0], pos[1] + (opts.y || 0), pos[2]);
        const size = (opts.size || 0.25) * (0.7 + Math.random() * 0.6);
        p.scale.set(size, size, 1);
        parts.push({ s: p, v: [Math.cos(a) * sp * (0.5 + Math.random()), up * (0.5 + Math.random()), Math.sin(a) * sp * (0.5 + Math.random())],
                     life: opts.life || 0.7, age: 0, g: opts.gravity == null ? 4 : opts.gravity, size: size, target: null });
      }
    }
    /* sparks that fly from `from` to a moving target (a racer) */
    function stream(from, who, color, n) {
      for (let i = 0; i < n; i++) {
        const p = particle(M.textures.spark, color);
        p.position.set(from[0], from[1], from[2]);
        const size = 0.22 + Math.random() * 0.12;
        p.scale.set(size, size, 1);
        parts.push({ s: p, v: [(Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2],
                     life: 0.55 + i * 0.02, age: -i * 0.015, g: 0, size: size, target: who });
      }
    }
    let lastState = null;

    function update(state, dt, t) {
      lastState = state;
      stations.forEach(function (st, i) {
        st.spool.rotation.y = t * 1.6 + i;
        st.group.position.y = st.base.y + Math.sin(t * 2.2 + i) * 0.08;
        st.glow.material.opacity = 0.55 + 0.2 * Math.sin(t * 3 + i);
      });
      // re-offered threads
      const seen = {};
      Object.keys(state.items || {}).forEach(function (id) {
        const it = state.items[id];
        if (it.offers > 0 && it.status !== 'held') {
          const o = offerFor(it);
          const q = S(it.mainS, it.lateral);
          o.group.visible = o.ring.visible = true;
          o.group.position.set(q.position[0], q.position[1] + 0.75 + Math.sin(t * 2.5) * 0.06, q.position[2]);
          o.group.children[0].rotation.y = t * 2;
          o.ring.position.set(q.position[0], q.position[1] + 0.03, q.position[2]); o.ring.rotation.x = -Math.PI / 2;
          seen[id] = true;
        }
      });
      Object.keys(offers).forEach(function (id) { if (!seen[id]) offers[id].group.visible = offers[id].ring.visible = false; });
      // particles
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age < 0) continue;
        const k = p.age / p.life;
        if (k >= 1) { p.s.visible = false; group.remove(p.s); pool.push(p.s); parts.splice(i, 1); continue; }
        if (p.target && state[p.target]) {
          const tp = state[p.target].pos;
          const e = Math.min(1, dt * (4 + 14 * k));
          p.s.position.x += (tp[0] - p.s.position.x) * e + p.v[0] * dt * (1 - k);
          p.s.position.y += (tp[1] + 0.9 - p.s.position.y) * e + p.v[1] * dt * (1 - k);
          p.s.position.z += (tp[2] - p.s.position.z) * e + p.v[2] * dt * (1 - k);
        } else {
          p.v[1] -= p.g * dt;
          p.s.position.x += p.v[0] * dt; p.s.position.y += p.v[1] * dt; p.s.position.z += p.v[2] * dt;
        }
        p.s.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        const sc = p.size * (p.target ? 1 - k * 0.5 : 1);
        p.s.scale.set(sc, sc, 1);
      }
    }

    function handleEvents(events, state) {
      state = state || lastState;
      if (!state) return;
      events.forEach(function (e) {
        const r = e.who ? state[e.who] : null;
        if (e.type === 'pickup' && r) {
          const st = stations.filter(function (x) { return x.color === e.color; })[0];
          const it = state.items[e.item];
          let from = st ? [st.group.position.x, st.group.position.y, st.group.position.z] : r.pos;
          if (it && it.offers > 0) { const q = S(it.mainS, it.lateral); from = [q.position[0], q.position[1] + 0.75, q.position[2]]; }
          stream(from, e.who, HEX[e.color] || 0xffffff, 14);
          burst([r.pos[0], r.pos[1], r.pos[2]], 10, { color: HEX[e.color], y: 0.9, speed: 1.6, up: 2, life: 0.6, size: 0.22 });
        } else if ((e.type === 'jump' || e.type === 'land') && r) {
          burst([r.pos[0], r.pos[1] - (r.jumpY || 0), r.pos[2]], e.type === 'land' ? 10 : 6,
                { color: HEX.dust, map: M.textures.cloud, additive: false, y: 0.05, speed: 1.2, up: 0.5, life: 0.45, size: 0.35, gravity: 1 });
        } else if (e.type === 'brake' && e.on && r) {
          burst([r.pos[0], r.pos[1], r.pos[2]], 8, { color: HEX.dust, map: M.textures.cloud, additive: false, y: 0.05, speed: 0.9, up: 0.3, life: 0.5, size: 0.3, gravity: 0.5 });
        } else if (e.type === 'stumble' && r) {
          burst([r.pos[0], r.pos[1], r.pos[2]], 7, { color: HEX.star, y: 1.5, speed: 1.0, up: 0.6, life: 0.9, size: 0.26, gravity: 0 });
        } else if (e.type === 'finish' && r) {
          burst([r.pos[0], r.pos[1], r.pos[2]], 40, { color: HEX.confetti, y: 1.6, speed: 3, up: 4, life: 1.6, size: 0.2, gravity: 5 });
        }
      });
    }

    function reset() {
      parts.forEach(function (p) { p.s.visible = false; group.remove(p.s); pool.push(p.s); });
      parts.length = 0;
      Object.keys(offers).forEach(function (id) { offers[id].group.visible = offers[id].ring.visible = false; });
    }

    return { group: group, update: update, handleEvents: handleEvents, reset: reset, stations: stations,
             dispose: function () { owned.forEach(function (o) { if (o && o.dispose) o.dispose(); }); } };
  }

  R.props = { create: create, TYPE_COLOR: TYPE_COLOR };
})(globalThis.WW = globalThis.WW || {});
