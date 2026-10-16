/* Wishweave Wonders — 3D renderer: the connected course (world geometry).

   Built once from the same route graph the simulation uses (WW.route.createCourse(WW.ROUTE, {runout})), so the
   carpet the racers stand on IS the walkable surface they move on: road top = sampled route surface (+ a 2 cm crown
   in the middle, 0 at the edges). Nothing here is a picture of the world.

     const W = WW.render.course.build(THREE, course, M, { debug })
     W.group           everything static (add to the scene)
     W.landmarks       [{id, position, radius}] solid footprints (camera keeps clear of them)
     W.debugGroup      deck edges, steering limits, centre lines, branch outline, footprints (?debug=geom)
     W.update(t)       slow ambient motion (clouds, glows)
     W.dispose()

   Rails stand only where the walkable surface really ends: where the side loop overlaps the main deck there is no
   rail between them. Landmarks keep off the 6 m deck; overhead parts (tassel arch, flower gate) clear a jumping
   runner. The distant city is decoration far from the course (≥ 30 m) and never on the road. */
(function (WW) {
  'use strict';
  const R = WW.render = WW.render || {};
  const S = function (road, s, lat) { return WW.route.sample(road, s, lat, null); };

  /* A visual copy of the main road extended backwards (Spoolwake Pier under the start) — sim never goes there. */
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
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* Deck sides + underside: an outward-rounded skirt below each edge. */
  function deckSkirt(THREE, road, from, to, depth) {
    const rows = road.points.filter(function (p) { return p.s >= from - 1e-9 && p.s <= to + 1e-9; }).map(function (p) { return p.s; });
    const prof = [[0, 0], [0.08, -0.06], [0.1, -0.16], [0.04, -depth * 0.7], [-0.25, -depth]];
    const pos = [], uv = [], idx = [];
    const n = prof.length * 2 + 2;
    rows.forEach(function (s) {
      const q = S(road, s, 0), h = q.width / 2;
      const ring = [];
      [-1, 1].forEach(function (side) {
        const pr = side < 0 ? prof.slice().reverse() : prof;
        pr.forEach(function (p) { ring.push([side * (h + p[0]), p[1]]); });
      });
      ring.push([h - 0.25, -depth], [-h + 0.25, -depth]);
      ring.forEach(function (rp, k) {
        pos.push(q.center[0] + q.right[0] * rp[0] + q.normal[0] * rp[1], q.center[1] + q.right[1] * rp[0] + q.normal[1] * rp[1],
                 q.center[2] + q.right[2] * rp[0] + q.normal[2] * rp[1]);
        uv.push(k / (n - 1) * 4, s / 2);
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
    return new THREE.TubeGeometry(curve, Math.max(4, points.length * (segPerPoint || 3)), radius, 8, false);
  }

  /* Purple yarn tassel (cap at the top, origin at the hanging point), height h. */
  function tasselGeometry(THREE, h) {
    const prof = [[0.001, 0], [0.07, -0.02], [0.09, -0.14], [0.06, -0.2], [0.12, -0.32], [0.16, -h * 0.75], [0.12, -h], [0.001, -h]];
    return new THREE.LatheGeometry(prof.map(function (p) { return new THREE.Vector2(p[0] * h, p[1]); }), 12);
  }

  function build(THREE, course, M, opts) {
    opts = opts || {};
    const rnd = WW.rng(7342);
    const group = new THREE.Group(); group.name = 'course';
    const debugGroup = new THREE.Group(); debugGroup.name = 'debug-geometry'; debugGroup.visible = !!opts.debug;
    const owned = [];
    const anim = [];
    function add(mesh, parent) { (parent || group).add(mesh); if (mesh.geometry) owned.push(mesh.geometry); return mesh; }
    const main = course.main, vis = visualMain(course, 9);
    const b = course.branchList[0];

    /* ---- roads ---- */
    add(new THREE.Mesh(deckTop(THREE, vis, vis.points[0].s, main.length, { tile: 6 }), M.carpet)).name = 'Road_Main_Top';
    add(new THREE.Mesh(deckSkirt(THREE, vis, vis.points[0].s, main.length, 0.55), M.deckSide)).name = 'Road_Main_Skirt';
    if (b) {
      add(new THREE.Mesh(deckTop(THREE, b, 0, b.length, { tile: 6, lift: 0.012, crown: 0.012 }), M.sideLoop)).name = 'Road_SideLoop_Top';
      add(new THREE.Mesh(deckSkirt(THREE, b, 0, b.length, 0.45), M.deckSide)).name = 'Road_SideLoop_Skirt';
    }
    // braided gold trims on every deck edge
    function trims(road, from, to, lift) {
      [-1, 1].forEach(function (side) {
        const pts = [];
        for (let s = from; s <= to + 1e-6; s += 1) {
          const q = S(road, Math.min(s, to), side * (road.width / 2 - 0.05));
          pts.push([q.position[0] + q.normal[0] * (0.07 + lift), q.position[1] + q.normal[1] * (0.07 + lift), q.position[2] + q.normal[2] * (0.07 + lift)]);
        }
        const g = tubeAlong(THREE, pts, 0.11, 3);
        if (g) add(new THREE.Mesh(g, M.rope));
      });
    }
    trims(vis, vis.points[0].s, main.length, 0);
    if (b) trims(b, 0, b.length, 0.012);

    /* ---- rails: posts, ropes, tassels, lanterns (only where the walkable surface really ends) ---- */
    const onBranchDeck = function (x, z, sHint) {
      if (!b) return false;
      const p = course.project(b, x, z, sHint - b.startS, 6);
      return !p.before && !p.after && Math.abs(p.lateral) <= b.width / 2 + 0.3;
    };
    const onMainDeck = function (x, z, sHint) {
      const p = course.project(main, x, z, sHint, 6);
      return Math.abs(p.lateral) <= main.width / 2 + 0.3 && p.s > 0.2 && p.s < main.length - 0.2;
    };
    const posts = [], lanterns = [], tassels = [];
    const ropeRuns = [];
    function railSide(road, from, to, side, skip, sOff) {
      let run = [];
      let k = 0;
      for (let s = from; s <= to + 1e-6; s += 3.2) {
        const q = S(road, s, side * (road.width / 2 + 0.08));
        const blocked = skip(q.position[0], q.position[2], s + (sOff || 0));
        if (blocked) { if (run.length > 1) ropeRuns.push(run); run = []; k++; continue; }
        const lamp = k % 4 === 2;
        posts.push({ q: q, side: side, lamp: lamp });
        if (lamp) lanterns.push({ q: q, side: side });
        else if (k % 2 === 1) tassels.push({ q: q, side: side });
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
    const postGeo = new THREE.CylinderGeometry(0.13, 0.16, 1.05, 10); postGeo.translate(0, 0.52, 0);
    const lampPostGeo = new THREE.CylinderGeometry(0.13, 0.17, 1.7, 10); lampPostGeo.translate(0, 0.85, 0);
    const capGeo = new THREE.SphereGeometry(0.2, 12, 8); capGeo.translate(0, 1.12, 0);
    const bandGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.16, 12, 1, true); bandGeo.translate(0, 0.78, 0);
    owned.push(postGeo, lampPostGeo, capGeo, bandGeo);
    const dummy = new THREE.Object3D();
    function instanced(geo, mat, list, place) {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      im.count = list.length;
      list.forEach(function (it, i) { place(dummy, it); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
      return im;
    }
    function placeAt(d, q, yOff) {
      d.position.set(q.position[0], q.position[1] + (yOff || 0) - 0.04, q.position[2]);
      d.rotation.set(0, q.heading, 0);
      d.scale.set(1, 1, 1);
    }
    const plain = posts.filter(function (p) { return !p.lamp; });
    instanced(postGeo, M.wood, plain, function (d, p) { placeAt(d, p.q); });
    instanced(capGeo, M.knitGold, plain, function (d, p) { placeAt(d, p.q); });
    instanced(bandGeo, M.knitBands, plain, function (d, p) { placeAt(d, p.q); });
    instanced(lampPostGeo, M.wood, lanterns, function (d, p) { placeAt(d, p.q); });
    const lampGeo = new THREE.CylinderGeometry(0.17, 0.2, 0.42, 6); lampGeo.translate(0, 1.92, 0);
    const lampRoof = new THREE.ConeGeometry(0.28, 0.28, 6); lampRoof.translate(0, 2.27, 0);
    owned.push(lampGeo, lampRoof);
    instanced(lampGeo, M.lantern, lanterns, function (d, p) { placeAt(d, p.q); });
    instanced(lampRoof, M.lanternFrame, lanterns, function (d, p) { placeAt(d, p.q); });
    lanterns.forEach(function (p) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.textures.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
      sp.position.set(p.q.position[0], p.q.position[1] + 1.92, p.q.position[2]);
      sp.scale.set(1.5, 1.5, 1);
      group.add(sp); owned.push(sp.material);
    });
    const tGeo = tasselGeometry(THREE, 0.62); owned.push(tGeo);
    instanced(tGeo, M.tassel, tassels, function (d, p) {
      const out = p.side * 0.2;
      d.position.set(p.q.position[0] + p.q.right[0] * out, p.q.position[1] + 0.86, p.q.position[2] + p.q.right[2] * out);
      d.rotation.set(0, p.q.heading, 0); d.scale.set(1, 1, 1);
    });
    // ropes: a sagging braided rope between neighbouring posts, and a thinner rose rope lower down
    ropeRuns.forEach(function (run) {
      [[0.88, 0.075, M.rope, 0.16], [0.48, 0.045, M.roseRope, 0.08]].forEach(function (spec) {
        const pts = [];
        for (let i = 0; i < run.length; i++) {
          const q = run[i];
          pts.push([q.position[0], q.position[1] + spec[0], q.position[2]]);
          if (i < run.length - 1) {
            const n = run[i + 1];
            pts.push([(q.position[0] + n.position[0]) / 2, (q.position[1] + n.position[1]) / 2 + spec[0] - spec[3], (q.position[2] + n.position[2]) / 2]);
          }
        }
        const g = tubeAlong(THREE, pts, spec[1], 4);
        if (g) add(new THREE.Mesh(g, spec[2]));
      });
    });

    /* ---- side-loop announcement: teal chevrons on the left lane before the fork ---- */
    if (b) {
      const ac = document.createElement('canvas'); ac.width = 128; ac.height = 128;
      const ax = ac.getContext('2d');
      ax.strokeStyle = 'rgba(30,190,190,0.95)'; ax.lineWidth = 22; ax.lineCap = 'round'; ax.lineJoin = 'round';
      ax.beginPath(); ax.moveTo(24, 100); ax.lineTo(64, 40); ax.lineTo(104, 100); ax.stroke();
      ax.strokeStyle = 'rgba(255,220,120,0.95)'; ax.lineWidth = 8;
      ax.beginPath(); ax.moveTo(24, 100); ax.lineTo(64, 40); ax.lineTo(104, 100); ax.stroke();
      const at = new THREE.CanvasTexture(ac); at.encoding = THREE.sRGBEncoding;
      const am = new THREE.MeshBasicMaterial({ map: at, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      owned.push(am, at);
      [11, 8, 5, 2.5].forEach(function (d, i) {
        const q = S(main, b.startS - d, -1.6 - i * 0.1);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), am);
        m.position.set(q.position[0] + q.normal[0] * 0.03, q.position[1] + q.normal[1] * 0.03, q.position[2] + q.normal[2] * 0.03);
        m.lookAt(m.position.x + q.normal[0], m.position.y + q.normal[1], m.position.z + q.normal[2]);
        m.rotateZ(-q.heading + Math.PI + 0.25);
        // orient the chevron's tip along the road heading, angled toward the side loop
        m.rotation.set(-Math.PI / 2, 0, 0);
        m.rotateZ(Math.PI + q.heading + 0.22);
        add(m);
      });
    }

    /* ---- finish band (1.2 m deep, ending on the finish plane) ---- */
    const fin = deckTop(THREE, main, course.finishS - 1.2, course.finishS, { tile: 1.2, lift: 0.024, uScale: 4 });
    add(new THREE.Mesh(fin, M.finishBand)).name = 'Finish_Band';

    /* ---- landmarks ---- */
    const L = (course.data.landmarks || []);
    const landmarks = [];
    function landmark(id) { return L.filter(function (l) { return l.id === id; })[0]; }

    function tower(spec) {
      const g = new THREE.Group();
      const r = spec.radius, h = spec.height, base = -spec.depth;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.12, h - base, 28, 1, true), M.wood);
      trunk.position.y = (h + base) / 2;
      owned.push(trunk.geometry);
      g.add(trunk);
      const bandH = 0.8;
      for (let y = 1.5; y < h - 2; y += 3.6) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.07, r * 1.07, bandH, 28, 1, true), M.knitBands);
        band.position.y = y; owned.push(band.geometry); g.add(band);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.09, 0.13, 8, 36), M.rope);
        rim.rotation.x = Math.PI / 2; rim.position.y = y + bandH / 2 + 0.05; owned.push(rim.geometry); g.add(rim);
      }
      // balconies with hanging tassels
      const tassel = tasselGeometry(THREE, 1.4); owned.push(tassel);
      const balc = [h * 0.42, h * 0.78];
      balc.forEach(function (y) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.42, r * 1.3, 0.45, 32), M.woodDark);
        disc.position.y = y; owned.push(disc.geometry); g.add(disc);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.43, 0.16, 8, 40), M.rope);
        rim.rotation.x = Math.PI / 2; rim.position.y = y + 0.2; owned.push(rim.geometry); g.add(rim);
        const n = 10;
        const im = new THREE.InstancedMesh(tassel, M.tassel, n);
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2;
          dummy.position.set(Math.cos(a) * r * 1.42, y - 0.2, Math.sin(a) * r * 1.42);
          dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
        }
        g.add(im);
      });
      // tapestry banner facing the road
      const bh = Math.min(9, h * 0.32), bw = r * 1.15;
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), M.tapestry);
      banner.position.set(0, h * 0.42 - 0.4 - bh / 2, 0);
      banner.rotation.y = spec.facing;
      banner.translateZ(r * 1.13);
      owned.push(banner.geometry); g.add(banner);
      // lanterns around the base ring
      for (let i = 0; i < 4; i++) {
        const a = spec.facing + (i - 1.5) * 0.55;
        const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.7, 6), M.lantern);
        lp.position.set(Math.sin(a) * r * 1.16, 2.6, Math.cos(a) * r * 1.16);
        owned.push(lp.geometry); g.add(lp);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.textures.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
        sp.position.copy(lp.position); sp.scale.set(2.2, 2.2, 1); owned.push(sp.material); g.add(sp);
      }
      // dome, spire, finial
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 1.2, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.knitBands);
      dome.position.y = h; owned.push(dome.geometry); g.add(dome);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, r * 2.6, 16), M.knitGold);
      spire.position.y = h + r * 1.1 + r * 1.2; owned.push(spire.geometry); g.add(spire);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 12, 8), M.gold);
      ball.position.y = h + r * 1.1 + r * 2.6; owned.push(ball.geometry); g.add(ball);
      g.position.set(spec.position[0], spec.position[1], spec.position[2]);
      group.add(g);
      landmarks.push({ id: spec.id, position: spec.position, radius: r * 1.45 });
      return g;
    }

    // facing: rotate the banner toward the road point nearest the tower
    function facingTo(pos, mainS) {
      const q = S(main, mainS, 0);
      return Math.atan2(q.center[0] - pos[0], q.center[2] - pos[2]);
    }
    ['tower-a', 'tower-b'].forEach(function (id, i) {
      const l = landmark(id);
      if (!l) return;
      tower({ id: id, position: l.position, radius: l.radius, height: i === 0 ? 30 : 24, depth: 40, facing: facingTo(l.position, l.mainS) });
    });

    // tassel arch: supports outside the deck, crossbar overhead, five hanging tassels well above a jumping runner
    const ta = landmark('tassel-arch');
    if (ta) {
      const q = S(main, ta.mainS, 0);
      const arch = new THREE.Group();
      [-1, 1].forEach(function (side) {
        const p = S(main, ta.mainS, side * 4.4);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 7.2, 16), M.wood);
        col.position.set(p.position[0], p.position[1] + 3.0, p.position[2]);
        owned.push(col.geometry); arch.add(col);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 16, 1, true), M.knitBands);
        band.position.set(p.position[0], p.position[1] + 2.0, p.position[2]); owned.push(band.geometry); arch.add(band);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 10), M.knitGold);
        cap.position.set(p.position[0], p.position[1] + 6.7, p.position[2]); owned.push(cap.geometry); arch.add(cap);
      });
      const pl = S(main, ta.mainS, -4.4), pr = S(main, ta.mainS, 4.4);
      const bar = tubeAlong(THREE, [[pl.position[0], pl.position[1] + 6.1, pl.position[2]],
        [q.center[0], q.center[1] + 6.6, q.center[2]], [pr.position[0], pr.position[1] + 6.1, pr.position[2]]], 0.32, 12);
      arch.add(new THREE.Mesh(bar, M.rope)); owned.push(bar);
      const big = tasselGeometry(THREE, 1.9); owned.push(big);
      [-2.6, -1.3, 0, 1.3, 2.6].forEach(function (l) {
        const p = S(main, ta.mainS, l);
        const m = new THREE.Mesh(big, M.tassel);
        m.position.set(p.position[0], p.position[1] + 6.3 + (l === 0 ? 0.25 : 0) - Math.abs(l) * 0.1, p.position[2]);
        arch.add(m);
      });
      group.add(arch);
      landmarks.push({ id: 'tassel-arch-l', position: pl.position, radius: 0.6 }, { id: 'tassel-arch-r', position: pr.position, radius: 0.6 });
    }

    // Snagling Landing: a round wooden platform off the right edge with a knit rim (no creature in Milestone 1)
    const sl = landmark('snagling-landing');
    if (sl) {
      const plat = new THREE.Mesh(new THREE.CylinderGeometry(sl.radius, sl.radius * 0.8, 0.6, 32), M.woodDark);
      plat.position.set(sl.position[0], sl.position[1] - 0.3, sl.position[2]); owned.push(plat.geometry); group.add(plat);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(sl.radius, 0.14, 8, 40), M.rope);
      rim.rotation.x = Math.PI / 2; rim.position.set(sl.position[0], sl.position[1] + 0.02, sl.position[2]); owned.push(rim.geometry); group.add(rim);
      const top = new THREE.Mesh(new THREE.CircleGeometry(sl.radius * 0.96, 32), M.carpet);
      top.rotation.x = -Math.PI / 2; top.position.set(sl.position[0], sl.position[1] + 0.005, sl.position[2]); owned.push(top.geometry); group.add(top);
      landmarks.push({ id: 'snagling-landing', position: sl.position, radius: sl.radius });
    }

    // Butterfly banner: a pole with a tapestry (blockout level in Milestone 1)
    const bb = landmark('butterfly-banner');
    if (bb) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 7, 10), M.wood);
      pole.position.set(bb.position[0], bb.position[1] + 3.5, bb.position[2]); owned.push(pole.geometry); group.add(pole);
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4), M.tapestry);
      ban.position.set(bb.position[0], bb.position[1] + 4.6, bb.position[2]);
      ban.rotation.y = facingTo(bb.position, bb.mainS);
      ban.translateZ(0.3);
      owned.push(ban.geometry); group.add(ban);
      landmarks.push({ id: 'butterfly-banner', position: bb.position, radius: 0.5 });
    }

    // Flowergate: lotus petals around the finish, supports outside the deck, glowing heart
    const fg = landmark('flowergate');
    if (fg) {
      const q = S(main, course.finishS, 0);
      const gate = new THREE.Group();
      gate.position.set(q.center[0], q.center[1], q.center[2]);
      gate.rotation.y = q.heading;
      [-1, 1].forEach(function (side) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 8, 16), M.wood);
        col.position.set(side * 4.5, 3.6, 0); owned.push(col.geometry); gate.add(col);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.4, 16, 1, true), M.knitBands);
        band.position.set(side * 4.5, 2.2, 0); owned.push(band.geometry); gate.add(band);
      });
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.bezierCurveTo(1.1, 1.0, 1.0, 3.2, 0, 4.4); shape.bezierCurveTo(-1.0, 3.2, -1.1, 1.0, 0, 0);
      const petalGeo = new THREE.ShapeGeometry(shape, 12); owned.push(petalGeo);
      for (let i = 0; i < 11; i++) {
        const a = (i - 5) * 0.27;
        const m = new THREE.Mesh(petalGeo, i % 2 ? M.petalGold : M.petal);
        m.position.set(Math.sin(a) * 2.2, 5.2 + Math.cos(a) * 0.6, 0.6 + Math.abs(i - 5) * 0.08);
        m.rotation.z = -a;
        m.scale.setScalar(1.15 - Math.abs(i - 5) * 0.05);
        gate.add(m);
      }
      const lintel = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.3, 10, 40, Math.PI), M.rope);
      lintel.position.set(0, 7.4, 0); owned.push(lintel.geometry); gate.add(lintel);
      const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.textures.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 }));
      heart.position.set(0, 7.2, 0.4); heart.scale.set(9, 9, 1); owned.push(heart.material); gate.add(heart);
      anim.push(function (t) { heart.material.opacity = 0.75 + 0.2 * Math.sin(t * 2.1); });
      group.add(gate);
      [-1, 1].forEach(function (side) {
        const p = S(main, course.finishS, side * 4.5);
        landmarks.push({ id: 'flowergate-' + (side < 0 ? 'l' : 'r'), position: p.position, radius: 0.8 });
      });
    }

    /* ---- decorative towers near the course (clear of both decks and every landmark) ---- */
    const nearRoad = function (x, z, clear) {
      for (let i = 0; i < main.points.length; i += 2) {
        const p = main.points[i];
        if (Math.hypot(p.x - x, p.z - z) < clear) return true;
      }
      if (b) for (let i = 0; i < b.points.length; i += 2) if (Math.hypot(b.points[i].x - x, b.points[i].z - z) < clear) return true;
      return false;
    };
    const used = landmarks.slice();
    for (let s = 12; s < main.length; s += 15) {
      const side = rnd.next() < 0.5 ? -1 : 1;
      const off = side * (11 + rnd.next() * 9);
      const q = S(main, s, off);
      const r = 1.4 + rnd.next() * 1.2;
      if (nearRoad(q.position[0], q.position[2], 8.5 + r)) continue;
      if (used.some(function (u) { return Math.hypot(u.position[0] - q.position[0], u.position[2] - q.position[2]) < u.radius + r + 4; })) continue;
      tower({ id: 'deco-' + s, position: [q.position[0], q.position[1] - 0.5 - rnd.next() * 3, q.position[2]],
              radius: r, height: 14 + rnd.next() * 18, depth: 40, facing: facingTo(q.position, s) });
      used.push({ position: q.position, radius: r * 1.45 });
    }

    /* ---- distant loom city: towers, roofs, bridges, islands, waterfalls (instanced, Lambert) ---- */
    const city = new THREE.Group(); city.name = 'distant-city';
    const cyl = new THREE.CylinderGeometry(1, 1.08, 1, 12); cyl.translate(0, 0.5, 0);
    const cone = new THREE.ConeGeometry(1.3, 1, 12); cone.translate(0, 0.5, 0);
    const dome = new THREE.SphereGeometry(1.25, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    owned.push(cyl, cone, dome);
    const cityTowers = [];
    for (let i = 0; i < 140 && cityTowers.length < 90; i++) {
      const s = rnd.next() * main.length, side = rnd.next() < 0.5 ? -1 : 1;
      const off = side * (34 + Math.pow(rnd.next(), 1.4) * 110);
      const q = S(main, s, off);
      if (nearRoad(q.position[0], q.position[2], 28)) continue;
      const r = 1.6 + rnd.next() * 3.2, h = 12 + rnd.next() * 42;
      cityTowers.push({ x: q.position[0], y: q.position[1] - 14 - rnd.next() * 10, z: q.position[2], r: r, h: h, gold: rnd.next() < 0.35, dome: rnd.next() < 0.4 });
    }
    const walls = new THREE.InstancedMesh(cyl, M.cityWall, cityTowers.length);
    const roofs = new THREE.InstancedMesh(cone, M.cityRoof, cityTowers.length);
    const goldRoofs = new THREE.InstancedMesh(dome, M.cityRoofGold, cityTowers.length);
    let nr = 0, ng = 0;
    cityTowers.forEach(function (t, i) {
      dummy.position.set(t.x, t.y, t.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(t.r, t.h + 14, t.r); dummy.updateMatrix();
      walls.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.x, t.y + t.h + 14, t.z);
      if (t.dome) { dummy.scale.set(t.r, t.r * 1.1, t.r); dummy.updateMatrix(); goldRoofs.setMatrixAt(ng++, dummy.matrix); }
      else { dummy.scale.set(t.r, t.r * 2.4, t.r); dummy.updateMatrix(); roofs.setMatrixAt(nr++, dummy.matrix); }
    });
    roofs.count = nr; goldRoofs.count = ng;
    city.add(walls, roofs, goldRoofs);
    // rope bridges between neighbouring city towers
    const bridgeGeo = new THREE.BoxGeometry(1, 0.5, 1.6); owned.push(bridgeGeo);
    const bridges = [];
    for (let i = 0; i < cityTowers.length; i++) {
      for (let j = i + 1; j < cityTowers.length; j++) {
        const a = cityTowers[i], c = cityTowers[j], d = Math.hypot(a.x - c.x, a.z - c.z);
        if (d > 8 && d < 26 && bridges.length < 50 && rnd.next() < 0.5) bridges.push([a, c, d]);
      }
    }
    const bridgeMesh = new THREE.InstancedMesh(bridgeGeo, M.cityRoofGold, Math.max(1, bridges.length));
    bridgeMesh.count = bridges.length;
    bridges.forEach(function (br, i) {
      const a = br[0], c = br[1];
      const y = Math.min(a.y + a.h * 0.6, c.y + c.h * 0.6) + 4;
      dummy.position.set((a.x + c.x) / 2, y, (a.z + c.z) / 2);
      dummy.rotation.set(0, Math.atan2(c.x - a.x, c.z - a.z) + Math.PI / 2, 0);
      dummy.scale.set(br[2], 1, 1); dummy.updateMatrix();
      bridgeMesh.setMatrixAt(i, dummy.matrix);
    });
    city.add(bridgeMesh);
    // floating islands under clusters + waterfalls
    const islandGeo = new THREE.ConeGeometry(1, 1, 10); islandGeo.rotateX(Math.PI); islandGeo.translate(0, -0.5, 0); owned.push(islandGeo);
    const wfGeo = new THREE.PlaneGeometry(1, 1); wfGeo.translate(0, -0.5, 0); owned.push(wfGeo);
    for (let i = 0; i < cityTowers.length; i += 5) {
      const t = cityTowers[i];
      const isl = new THREE.Mesh(islandGeo, M.island);
      isl.position.set(t.x, t.y + 1, t.z); isl.scale.set(t.r * 4, 10 + rnd.next() * 10, t.r * 4);
      city.add(isl);
      if (rnd.next() < 0.6) {
        const wf = new THREE.Mesh(wfGeo, M.waterfall);
        wf.position.set(t.x + t.r * 2.5, t.y + 0.8, t.z);
        wf.scale.set(2 + rnd.next() * 3, 18 + rnd.next() * 14, 1);
        wf.lookAt(0, wf.position.y, 95);
        city.add(wf);
      }
    }
    group.add(city);

    /* ---- clouds (sprites): puffs around the course and a sea of clouds below ---- */
    const clouds = new THREE.Group(); clouds.name = 'clouds';
    for (let i = 0; i < 46; i++) {
      const s = rnd.next() * main.length, side = rnd.next() < 0.5 ? -1 : 1;
      const below = i < 26;
      const q = S(main, s, side * (below ? rnd.next() * 60 : 30 + rnd.next() * 90));
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.textures.cloud, transparent: true, depthWrite: false, opacity: below ? 0.95 : 0.75, fog: true }));
      sp.position.set(q.position[0], q.position[1] + (below ? -16 - rnd.next() * 10 : 6 + rnd.next() * 30), q.position[2]);
      const k = below ? 40 + rnd.next() * 40 : 14 + rnd.next() * 20;
      sp.scale.set(k, k * 0.5, 1);
      owned.push(sp.material);
      clouds.add(sp);
    }
    group.add(clouds);
    anim.push(function (t) { clouds.children.forEach(function (c, i) { c.position.x += Math.sin(t * 0.05 + i) * 0.002; }); });

    /* ---- debug geometry: the walkable surface the sim uses, drawn in the same camera ---- */
    function line(points, color) {
      const g = new THREE.BufferGeometry().setFromPoints(points.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }));
      const m = new THREE.Line(g, new THREE.LineBasicMaterial({ color: color, depthTest: false, transparent: true, opacity: 0.95 }));
      m.renderOrder = 999; owned.push(g, m.material);
      debugGroup.add(m);
    }
    function roadLines(road, from, to, limit) {
      const lift = 0.06;
      const rows = road.points.filter(function (p) { return p.s >= from && p.s <= to; }).map(function (p) { return p.s; });
      const at = function (l) {
        return rows.map(function (s) { const q = S(road, s, l); return [q.position[0], q.position[1] + lift, q.position[2]]; });
      };
      line(at(-road.width / 2), 0xff3355); line(at(road.width / 2), 0xff3355);       // walkable deck edges
      line(at(-limit), 0xffdd33); line(at(limit), 0xffdd33);                         // steering limits (body clearance)
      line(at(0), 0xffffff);                                                         // route centre line
    }
    const T = WW.TUNING || {};
    roadLines(main, 0, main.length, main.width / 2 - (T.bodyRadius || 0.5));
    if (b) {
      roadLines(b, 0, b.length, b.width / 2 - (T.bodyRadius || 0.5));
      // branch outline in cyan
      const out = [];
      for (let s = 0; s <= b.length; s += 0.5) { const q = S(b, s, -b.width / 2); out.push([q.position[0], q.position[1] + 0.09, q.position[2]]); }
      for (let s = b.length; s >= 0; s -= 0.5) { const q = S(b, s, b.width / 2); out.push([q.position[0], q.position[1] + 0.09, q.position[2]]); }
      line(out, 0x33ffff);
    }
    // finish plane + landmark footprints in magenta
    const f0 = S(main, course.finishS, -3), f1 = S(main, course.finishS, 3);
    line([[f0.position[0], f0.position[1] + 0.1, f0.position[2]], [f1.position[0], f1.position[1] + 0.1, f1.position[2]]], 0x66ff66);
    landmarks.forEach(function (l) {
      const pts = [];
      for (let a = 0; a <= 32; a++) pts.push([l.position[0] + Math.cos(a / 32 * Math.PI * 2) * l.radius, l.position[1] + 0.12, l.position[2] + Math.sin(a / 32 * Math.PI * 2) * l.radius]);
      line(pts, 0xff44ff);
    });

    return {
      group: group, debugGroup: debugGroup, landmarks: landmarks, visualMain: vis,
      update: function (t) { for (let i = 0; i < anim.length; i++) anim[i](t); },
      dispose: function () { owned.forEach(function (o) { if (o && o.dispose) o.dispose(); }); }
    };
  }

  R.course = { build: build, tasselGeometry: tasselGeometry };
})(globalThis.WW = globalThis.WW || {});
