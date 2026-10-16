/* Wishweave Wonders (connected preview) — the course, dressed ONLY with the user's own art.

   The walkable road is built from the same route graph the simulation uses (WW.route.createCourse), so the carpet
   the racers stand on is the surface they move on. Everything visible comes from the approved art and the
   Connected World kit (tools/build-world-art.py cuts it; WW.WORLD_ART lists it) — nothing invented:
     carpet         the painted carpet of plate 03 (rectified); the side loop: plate 02's teal carpet
     ropes          the thick gold bobble rope (plate 02 patch) along the carpet edges and between the posts
     posts/tassels  the kit's cover-post and swinging-tassel sprites (props atlas), lanterns from target 01
     towers         wooden trunk with knit bands (plate 04), teal tapestry + lantern (target 01), purple tassels
     city           four cards of the golden loom city with its lotus gate (target 01, plates 03/04/06), soft-edged,
                    standing far around the course; the flower gate at the finish is the kit's flower-gate sprite
   Billboards (posts, tassels, lanterns, flower gate) turn to face the camera each frame (update(t, camPos)).

     const W = WW.render.course.build(THREE, course, M, { art, images, debug })
     W.group, W.debugGroup, W.landmarks, W.update(t, camPos), W.dispose() */
(function (WW) {
  'use strict';
  const R = WW.render = WW.render || {};
  const S = function (road, s, lat) { return WW.route.sample(road, s, lat, null); };

  /* A visual copy of the main road extended backwards under the start (sim never goes there). */
  function visualMain(course, back) {
    const m = course.main, p0 = m.points[0];
    const th = Math.hypot(p0.tangent[0], p0.tangent[2]);
    const t = [p0.tangent[0] / th, 0, p0.tangent[2] / th];
    const pts = [];
    for (let d = back; d > 0; d -= 0.5) {
      pts.push({ s: -d, x: p0.x - t[0] * d, y: p0.y, z: p0.z - t[2] * d, width: p0.width, tangent: t });
    }
    return { id: 'main-visual', width: m.width, length: m.length, points: pts.concat(m.points) };
  }

  /* Deck top: rows along the road × cols across, crowned, UV u across / v along (tile metres). */
  function deckTop(THREE, road, from, to, opts) {
    const cols = opts.cols || 13, tile = opts.tile || 6, lift = opts.lift || 0, crown = opts.crown == null ? 0.02 : opts.crown;
    const rows = road.points.filter(function (p) { return p.s >= from - 1e-9 && p.s <= to + 1e-9; }).map(function (p) { return p.s; });
    const pos = [], uv = [], idx = [];
    rows.forEach(function (s) {
      const q = S(road, s, 0);
      for (let j = 0; j < cols; j++) {
        const u = j / (cols - 1), l = (u - 0.5) * q.width;
        const c = crown * (1 - Math.pow(2 * l / q.width, 2)) + lift;
        pos.push(q.center[0] + q.right[0] * l + q.normal[0] * c, q.center[1] + q.right[1] * l + q.normal[1] * c,
                 q.center[2] + q.right[2] * l + q.normal[2] * c);
        uv.push(u * (opts.uScale || 1), s / tile);
      }
    });
    for (let i = 0; i < rows.length - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
        idx.push(a, b, c, b, d, c);          // counter-clockwise seen from above: the carpet faces up
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* Deck sides + underside: the carpet hanging over each edge, then under the deck. */
  function deckSkirt(THREE, road, from, to, depth) {
    const rows = road.points.filter(function (p) { return p.s >= from - 1e-9 && p.s <= to + 1e-9; }).map(function (p) { return p.s; });
    const prof = [[0, 0], [0.1, -0.08], [0.14, -0.2], [0.06, -depth * 0.7], [-0.25, -depth]];
    const pos = [], uv = [], idx = [];
    const n = prof.length * 2 + 2;
    rows.forEach(function (s) {
      const q = S(road, s, 0), h = q.width / 2;
      const ring = [];
      prof.forEach(function (p) { ring.push([-(h + p[0]), p[1]]); });
      ring.push([-h + 0.25, -depth], [h - 0.25, -depth]);
      prof.slice().reverse().forEach(function (p) { ring.push([h + p[0], p[1]]); });
      ring.forEach(function (rp, k) {
        pos.push(q.center[0] + q.right[0] * rp[0] + q.normal[0] * rp[1], q.center[1] + q.right[1] * rp[0] + q.normal[1] * rp[1],
                 q.center[2] + q.right[2] * rp[0] + q.normal[2] * rp[1]);
        uv.push(k / (n - 1), s / 6);
      });
    });
    for (let i = 0; i < rows.length - 1; i++) {
      for (let k = 0; k < n - 1; k++) {
        const a = i * n + k, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function tubeAlong(THREE, points, radius, segPerPoint) {
    if (points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(points.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }));
    return new THREE.TubeGeometry(curve, Math.max(4, points.length * (segPerPoint || 3)), radius, 10, false);
  }

  function build(THREE, course, M, opts) {
    opts = opts || {};
    const art = opts.art, images = opts.images || {};
    const group = new THREE.Group(); group.name = 'course';
    const debugGroup = new THREE.Group(); debugGroup.name = 'debug-geometry'; debugGroup.visible = !!opts.debug;
    const owned = [], anim = [], billboards = [];
    function add(mesh, parent) { (parent || group).add(mesh); if (mesh.geometry) owned.push(mesh.geometry); return mesh; }
    const main = course.main, vis = visualMain(course, 9);
    const b = course.branchList[0];

    /* art textures (unlit: they keep their painted colours) */
    function artTex(key, wrapS, wrapT) {
      const img = images[key];
      if (!img) throw new Error('Course art "' + key + '" is not loaded.');
      const t = new THREE.Texture(img);
      t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
      t.wrapS = wrapS || THREE.ClampToEdgeWrapping; t.wrapT = wrapT || THREE.ClampToEdgeWrapping;
      t.needsUpdate = true; owned.push(t);
      return t;
    }
    function basic(map, o) {
      const m = new THREE.MeshBasicMaterial(Object.assign({ map: map, toneMapped: false }, o || {}));
      owned.push(m);
      return m;
    }
    const MR = THREE.MirroredRepeatWrapping;
    const ropeMat = basic(artTex('world.rope-gold', MR, MR));
    const trunkMat = basic(artTex('world.tower-trunk', MR, MR));
    const skirtMat = basic(M.carpet.map, { color: 0xa98a8e, side: THREE.DoubleSide });
    const tapestryMat = basic(artTex('world.tapestry'), { side: THREE.DoubleSide, transparent: false });
    const lanternTex = artTex('world.lantern');

    /* a camera-facing upright card for an atlas frame (posts, tassels, gate) */
    function sprite(frame, height, x, y, z) {
      const f = art.frame(frame);
      const m = new THREE.Mesh(art.geometry(frame, height / f.h), art.material(f.img, { alphaTest: 0.08, depthWrite: true }));
      m.position.set(x, y, z);
      group.add(m);
      billboards.push(m);
      return m;
    }
    function lanternCard(h, x, y, z) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(h * 88 / 196, h), basic(lanternTex, { side: THREE.DoubleSide }));
      m.position.set(x, y + h / 2, z);
      add(m); billboards.push(m);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.textures.glow, transparent: true, depthWrite: false,
                                                               blending: THREE.AdditiveBlending, opacity: 0.75, toneMapped: false }));
      glow.position.set(x, y + h * 0.45, z); glow.scale.set(h * 1.4, h * 1.4, 1);
      group.add(glow); owned.push(glow.material);
      return m;
    }

    /* ---- roads ---- */
    add(new THREE.Mesh(deckTop(THREE, vis, vis.points[0].s, main.length, { tile: 6 }), M.carpet)).name = 'Road_Main_Top';
    add(new THREE.Mesh(deckSkirt(THREE, vis, vis.points[0].s, main.length, 0.6), skirtMat)).name = 'Road_Main_Skirt';
    if (b) {
      add(new THREE.Mesh(deckTop(THREE, b, 0, b.length, { tile: b.width, lift: 0.012, crown: 0.012 }), M.sideLoop)).name = 'Road_SideLoop_Top';
      add(new THREE.Mesh(deckSkirt(THREE, b, 0, b.length, 0.5), skirtMat)).name = 'Road_SideLoop_Skirt';
    }
    // the thick gold rope along every carpet edge (as in the approved screens)
    function edgeRopes(road, from, to, lift) {
      [-1, 1].forEach(function (side) {
        const pts = [];
        for (let s = from; s <= to + 1e-6; s += 1) {
          const q = S(road, Math.min(s, to), side * (road.width / 2 + 0.02));
          pts.push([q.position[0] + q.normal[0] * (0.12 + lift), q.position[1] + q.normal[1] * (0.12 + lift), q.position[2] + q.normal[2] * (0.12 + lift)]);
        }
        const g = tubeAlong(THREE, pts, 0.17, 3);
        if (g) { add(new THREE.Mesh(g, ropeMat)); g.attributes.uv && scaleTubeUV(g, (to - from) / 0.7); }
      });
    }
    /* repeat the rope patch along the tube about every `period` metres */
    function scaleTubeUV(g, reps) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 2, uv.getX(i) * reps);
      uv.needsUpdate = true;
    }
    edgeRopes(vis, vis.points[0].s, main.length, 0);
    if (b) edgeRopes(b, 0, b.length, 0.012);

    /* ---- rails: the kit's posts and tassels, gold ropes between them, a lantern on every fifth post ---- */
    const onBranchDeck = function (x, z, sHint) {
      if (!b) return false;
      const p = course.project(b, x, z, sHint - b.startS, 6);
      return !p.before && !p.after && Math.abs(p.lateral) <= b.width / 2 + 0.3;
    };
    const onMainDeck = function (x, z, sHint) {
      const p = course.project(main, x, z, sHint, 6);
      return Math.abs(p.lateral) <= main.width / 2 + 0.3 && p.s > 0.2 && p.s < main.length - 0.2;
    };
    const POST_H = 2.1, ROPE_Y = 1.45;
    const ropeRuns = [];
    function railSide(road, from, to, side, skip, sOff) {
      let run = [], k = 0;
      for (let s = from; s <= to + 1e-6; s += 4.0) {
        const q = S(road, s, side * (road.width / 2 + 0.28));
        if (skip(q.position[0], q.position[2], s + (sOff || 0))) { if (run.length > 1) ropeRuns.push(run); run = []; k++; continue; }
        sprite('prop.cover-post', POST_H, q.position[0], q.position[1] - 0.05, q.position[2]);
        if (k % 5 === 2) lanternCard(0.75, q.position[0], q.position[1] + POST_H - 0.12, q.position[2]);
        else if (k % 2 === 1) sprite('prop.swinging-tassel', 1.05, q.position[0] + q.right[0] * side * 0.32, q.position[1] + ROPE_Y + 0.05, q.position[2] + q.right[2] * side * 0.32);
        run.push(q);
        k++;
      }
      if (run.length > 1) ropeRuns.push(run);
    }
    railSide(vis, vis.points[0].s + 0.5, main.length - 0.3, -1, function (x, z, s) { return onBranchDeck(x, z, s); });
    railSide(vis, vis.points[0].s + 0.5, main.length - 0.3, 1, function () { return false; });
    if (b) {
      railSide(b, 0.6, b.length - 0.6, -1, function (x, z, s) { return onMainDeck(x, z, b.startS + s); });
      railSide(b, 0.6, b.length - 0.6, 1, function (x, z, s) { return onMainDeck(x, z, b.startS + s); });
    }
    ropeRuns.forEach(function (run) {
      const pts = [];
      for (let i = 0; i < run.length; i++) {
        const q = run[i];
        pts.push([q.position[0], q.position[1] + ROPE_Y, q.position[2]]);
        if (i < run.length - 1) {
          const n = run[i + 1];
          pts.push([(q.position[0] + n.position[0]) / 2, (q.position[1] + n.position[1]) / 2 + ROPE_Y - 0.28, (q.position[2] + n.position[2]) / 2]);
        }
      }
      const g = tubeAlong(THREE, pts, 0.13, 4);
      if (g) { scaleTubeUV(g, run.length * 4 / 0.55); add(new THREE.Mesh(g, ropeMat)); }
    });

    /* ---- finish band (1.2 m deep, ending on the finish plane) ---- */
    const fin = deckTop(THREE, main, course.finishS - 1.2, course.finishS, { tile: 1.2, lift: 0.024, uScale: 4 });
    add(new THREE.Mesh(fin, M.finishBand)).name = 'Finish_Band';

    /* ---- towers: trunk with knit bands, gold rope rings, teal tapestry, lantern, purple tassels ---- */
    const L = (course.data.landmarks || []);
    const landmarks = [];
    function landmark(id) { return L.filter(function (l) { return l.id === id; })[0]; }
    function facingTo(pos, mainS) {
      const q = S(main, mainS, 0);
      return Math.atan2(q.center[0] - pos[0], q.center[2] - pos[2]);
    }
    function tower(spec) {
      const g = new THREE.Group();
      const r = spec.radius, h = spec.height, base = -spec.depth;
      const geo = new THREE.CylinderGeometry(r, r * 1.04, h - base, 36, 1, true);
      const uv = geo.attributes.uv;
      const around = Math.max(2, Math.round(2 * Math.PI * r / 2.2)), up = (h - base) / 6.5;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * up);
      const trunk = new THREE.Mesh(geo, trunkMat);
      trunk.position.y = (h + base) / 2;
      owned.push(geo); g.add(trunk);
      for (let y = 2.4; y < h - 1; y += 5.2) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.03, 0.22, 10, 48), ropeMat);
        ring.rotation.x = Math.PI / 2; ring.position.y = y; owned.push(ring.geometry); g.add(ring);
      }
      // tapestry and lantern on the side facing the road
      const tw = r * 1.15, th = tw * 340 / 175;
      const tap = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), tapestryMat);
      tap.rotation.y = spec.facing; tap.position.set(0, spec.tapestryY || 9, 0); tap.translateZ(r * 1.02);
      owned.push(tap.geometry); g.add(tap);
      const lan = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.45), basic(lanternTex, { side: THREE.DoubleSide }));
      lan.rotation.y = spec.facing - 0.55; lan.position.set(0, 2.6, 0); lan.translateZ(r * 1.06);
      owned.push(lan.geometry); g.add(lan);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.textures.glow, transparent: true, depthWrite: false,
                                                               blending: THREE.AdditiveBlending, opacity: 0.8, toneMapped: false }));
      glow.position.copy(lan.position); glow.scale.set(3.2, 3.2, 1); owned.push(glow.material); g.add(glow);
      g.position.set(spec.position[0], spec.position[1], spec.position[2]);
      group.add(g);
      // purple tassels hanging from the rope rings (camera-facing sprites)
      [7.6, 12.8].forEach(function (y) {
        for (let i = 0; i < 9; i++) {
          const a = spec.facing + (i - 4) * 0.42;
          sprite('prop.swinging-tassel', 1.9, spec.position[0] + Math.sin(a) * r * 1.12, spec.position[1] + y - 0.1, spec.position[2] + Math.cos(a) * r * 1.12);
        }
      });
      landmarks.push({ id: spec.id, position: spec.position, radius: r * 1.2 });
      return g;
    }
    // the tower beside the opening rug (right of the road, as in the opening screen) and the kit's two towers
    const qs = S(main, 11, 7.2);
    tower({ id: 'tower-spoolwake', position: qs.position, radius: 3.4, height: 52, depth: 40, facing: facingTo(qs.position, 6), tapestryY: 8.5 });
    ['tower-a', 'tower-b'].forEach(function (id) {
      const l = landmark(id);
      if (l) tower({ id: id, position: l.position, radius: l.radius, height: 40, depth: 40, facing: facingTo(l.position, l.mainS) });
    });

    // tassel arch: two posts outside the deck, a gold rope overhead, tassels high above a jumping runner
    const ta = landmark('tassel-arch');
    if (ta) {
      const pl = S(main, ta.mainS, -4.4), pr = S(main, ta.mainS, 4.4), qc = S(main, ta.mainS, 0);
      [pl, pr].forEach(function (p) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 7.2, 20, 1, true), trunkMat);
        col.position.set(p.position[0], p.position[1] + 3.0, p.position[2]); owned.push(col.geometry); group.add(col);
      });
      const bar = tubeAlong(THREE, [[pl.position[0], pl.position[1] + 6.2, pl.position[2]], [qc.center[0], qc.center[1] + 6.7, qc.center[2]],
                                    [pr.position[0], pr.position[1] + 6.2, pr.position[2]]], 0.3, 12);
      scaleTubeUV(bar, 14); add(new THREE.Mesh(bar, ropeMat));
      [-2.6, -1.3, 0, 1.3, 2.6].forEach(function (l) {
        const p = S(main, ta.mainS, l);
        sprite('prop.swinging-tassel', 2.2, p.position[0], p.position[1] + 6.4 - Math.abs(l) * 0.1, p.position[2]);
      });
      landmarks.push({ id: 'tassel-arch-l', position: pl.position, radius: 0.6 }, { id: 'tassel-arch-r', position: pr.position, radius: 0.6 });
    }
    // Snagling Landing: a round wooden platform off the right edge (no creature in this preview)
    const sl = landmark('snagling-landing');
    if (sl) {
      const plat = new THREE.Mesh(new THREE.CylinderGeometry(sl.radius, sl.radius * 0.85, 0.6, 32), trunkMat);
      plat.position.set(sl.position[0], sl.position[1] - 0.3, sl.position[2]); owned.push(plat.geometry); group.add(plat);
      const top = new THREE.Mesh(new THREE.CircleGeometry(sl.radius * 0.97, 32), M.carpet);
      top.rotation.x = -Math.PI / 2; top.position.set(sl.position[0], sl.position[1] + 0.01, sl.position[2]); owned.push(top.geometry); group.add(top);
      landmarks.push({ id: 'snagling-landing', position: sl.position, radius: sl.radius });
    }
    // Butterfly banner: the teal tapestry on a wooden pole
    const bb = landmark('butterfly-banner');
    if (bb) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 7, 12), trunkMat);
      pole.position.set(bb.position[0], bb.position[1] + 3.5, bb.position[2]); owned.push(pole.geometry); group.add(pole);
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.3), tapestryMat);
      ban.position.set(bb.position[0], bb.position[1] + 4.4, bb.position[2]); ban.rotation.y = facingTo(bb.position, bb.mainS); ban.translateZ(0.3);
      owned.push(ban.geometry); group.add(ban);
      landmarks.push({ id: 'butterfly-banner', position: bb.position, radius: 0.5 });
    }
    // Flower gate at the finish: the kit's flower-gate art, standing over the finish line
    const fq = S(main, course.finishS + 0.6, 0);
    sprite('prop.flower-gate', 9.5, fq.center[0], fq.center[1] - 0.2, fq.center[2]);
    [-1, 1].forEach(function (side) {
      const p = S(main, course.finishS, side * 4.5);
      landmarks.push({ id: 'flowergate-' + (side < 0 ? 'l' : 'r'), position: p.position, radius: 0.8 });
    });

    /* ---- the loom city: soft-edged cards of the painted city, far around the course ---- */
    const CARDS = ['world.city-opening', 'world.city-gate', 'world.city-bridges', 'world.city-tall'];
    const cardTex = {};
    CARDS.forEach(function (k) { cardTex[k] = artTex(k); });
    const city = new THREE.Group(); city.name = 'loom-city';
    // From the start the opening card stands ahead-left, where the opening screen shows the lotus gate; the others
    // ring the course so every view along it looks out over the city.
    const centre = [0, 3, 95];
    function card(key, bearingDeg, dist, width, yCentre, flip, from) {
      const img = images[key], aspect = img.height / img.width;
      const a = bearingDeg * Math.PI / 180;
      const o = from || centre;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width * aspect),
        basic(cardTex[key], { transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
      m.position.set(o[0] + Math.sin(a) * dist, yCentre, o[2] + Math.cos(a) * dist);
      m.lookAt(o[0], yCentre, o[2]);
      if (flip) m.scale.x = -1;
      m.renderOrder = -5;
      owned.push(m.geometry); city.add(m);
      return m;
    }
    const start = S(main, 2, 0).position;
    card('world.city-opening', -24, 330, 160, 50, false, start);
    card('world.city-tall', -8, 300, 95, 92, true, start);
    const ring = [
      ['world.city-bridges', -95, false], ['world.city-tall', -72, false], ['world.city-gate', -50, false],
      ['world.city-bridges', -28, true], ['world.city-opening', -8, true], ['world.city-tall', 12, true],
      ['world.city-gate', 36, true], ['world.city-bridges', 58, false], ['world.city-tall', 80, false],
      ['world.city-opening', 104, false], ['world.city-gate', 128, false], ['world.city-bridges', 160, true],
      ['world.city-tall', 190, true], ['world.city-gate', 222, false], ['world.city-opening', 250, true]
    ];
    ring.forEach(function (c, i) {
      const tall = c[0] === 'world.city-tall';
      card(c[0], c[1], 360 + (i % 3) * 25, tall ? 100 : 160, tall ? 58 : 48 + (i % 2) * 6, c[2]);
      // a higher, nearer layer between them so towers and bridges rise to the top of the view, as in the screens
      const up = ring[(i + 2) % ring.length];
      card(up[0], c[1] + 11, 300, up[0] === 'world.city-tall' ? 80 : 125, 104, !up[2]);
    });
    group.add(city);

    /* ---- the sea of clouds below the floating city ---- */
    const cloudMat = new THREE.MeshBasicMaterial({ map: M.textures.cloud, transparent: true, depthWrite: false, fog: false,
                                                   opacity: 0.95, toneMapped: false });
    owned.push(cloudMat);
    const clouds = new THREE.Group(); clouds.name = 'clouds';
    const rnd = WW.rng(9187);
    for (let i = 0; i < 70; i++) {
      const a = rnd.next() * Math.PI * 2, d = 40 + rnd.next() * 300;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.textures.cloud, transparent: true, depthWrite: false, fog: false,
                                                             opacity: 0.9, toneMapped: false }));
      sp.position.set(centre[0] + Math.sin(a) * d, -14 - rnd.next() * 16, centre[2] + Math.cos(a) * d);
      const k = 50 + rnd.next() * 60; sp.scale.set(k, k * 0.45, 1);
      owned.push(sp.material); clouds.add(sp);
    }
    group.add(clouds);

    /* ---- debug geometry: the walkable surface the sim uses, drawn in the same camera ---- */
    function line(points, color) {
      const g = new THREE.BufferGeometry().setFromPoints(points.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }));
      const m = new THREE.Line(g, new THREE.LineBasicMaterial({ color: color, depthTest: false, transparent: true, opacity: 0.95 }));
      m.renderOrder = 999; owned.push(g, m.material);
      debugGroup.add(m);
    }
    function roadLines(road, from, to, limit) {
      const rows = road.points.filter(function (p) { return p.s >= from && p.s <= to; }).map(function (p) { return p.s; });
      const at = function (l) { return rows.map(function (s) { const q = S(road, s, l); return [q.position[0], q.position[1] + 0.06, q.position[2]]; }); };
      line(at(-road.width / 2), 0xff3355); line(at(road.width / 2), 0xff3355);
      line(at(-limit), 0xffdd33); line(at(limit), 0xffdd33);
      line(at(0), 0xffffff);
    }
    const T = WW.TUNING || {};
    roadLines(main, 0, main.length, main.width / 2 - (T.bodyRadius || 0.5));
    if (b) roadLines(b, 0, b.length, b.width / 2 - (T.bodyRadius || 0.5));
    landmarks.forEach(function (l) {
      const pts = [];
      for (let a = 0; a <= 32; a++) pts.push([l.position[0] + Math.cos(a / 32 * Math.PI * 2) * l.radius, l.position[1] + 0.12, l.position[2] + Math.sin(a / 32 * Math.PI * 2) * l.radius]);
      line(pts, 0xff44ff);
    });

    const wp = new THREE.Vector3();
    return {
      group: group, debugGroup: debugGroup, landmarks: landmarks, visualMain: vis,
      update: function (t, camPos) {
        for (let i = 0; i < anim.length; i++) anim[i](t);
        if (!camPos) return;
        for (let i = 0; i < billboards.length; i++) {
          const m = billboards[i];
          m.getWorldPosition(wp);
          m.rotation.y = Math.atan2(camPos.x - wp.x, camPos.z - wp.z) - (m.parent && m.parent !== group ? m.parent.rotation.y : 0);
        }
      },
      dispose: function () { owned.forEach(function (o) { if (o && o.dispose) o.dispose(); }); }
    };
  }

  R.course = { build: build };
})(globalThis.WW = globalThis.WW || {});
