/* Wishweave Wonders — 3D renderer: crochet materials.

   Every texture is drawn at load time on a canvas (no extra art files, works offline and from file://), seeded so it
   is identical every run. Stitch textures come with a normal map computed from their height field, so the yarn
   bumps catch the light. Colours follow the approved art (kit references 01/02 and the legacy paintings):
   crimson carpet with gold/cream/teal flowers, braided gold rope, warm wood, purple tassels, teal tapestries.

     const M = WW.render.materials.create(THREE, { anisotropy })
     M.carpet / M.sideLoop / M.rope / M.roseRope / M.wood / M.woodDark / M.knitBands / M.tassel / M.tapestry
     M.trim / M.deckSide / M.lantern / M.cityWall / M.sky / M.purlYarn / M.loopYarn / M.sole / M.spool(color) …
     M.textures.glow / M.textures.cloud / M.textures.spark   (sprite textures)
     M.dispose() */
(function (WW) {
  'use strict';
  const R = WW.render = WW.render || {};

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function hex(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round); }
  function shade(c, k) { return c.map(function (v) { return Math.max(0, Math.min(255, Math.round(v * k))); }); }

  const COL = {
    crimson: [176, 24, 58], crimsonDark: [128, 14, 44], rose: [214, 64, 104],
    gold: [244, 178, 52], goldLight: [255, 214, 120], cream: [250, 226, 170],
    teal: [28, 140, 150], tealDark: [14, 92, 104], tealLight: [80, 196, 196],
    purple: [124, 30, 96], purpleDark: [84, 16, 66], leaf: [46, 132, 96],
    wood: [190, 120, 62], woodDark: [128, 74, 36], woodLight: [222, 160, 96],
    mauve: [118, 74, 108]
  };

  /* Height field → tangent-space normal map canvas. */
  function normalMap(hc, strength) {
    const w = hc.width, h = hc.height;
    const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
    const out = canvas(w, h), octx = out.getContext('2d');
    const img = octx.createImageData(w, h), d = img.data;
    function H(x, y) { x = (x + w) % w; y = (y + h) % h; return src[(y * w + x) * 4] / 255; }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
        const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
        const n = Math.hypot(dx, dy, 1);
        const i = (y * w + x) * 4;
        d[i] = Math.round((-dx / n * 0.5 + 0.5) * 255);
        d[i + 1] = Math.round((dy / n * 0.5 + 0.5) * 255);
        d[i + 2] = Math.round((1 / n * 0.5 + 0.5) * 255);
        d[i + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  /* A grid of crochet bobbles: colour from colorAt(u, v) (cell centre, 0..1), height as a soft dome per stitch. */
  function bobbles(w, h, cols, rows, colorAt, rnd, opts) {
    opts = opts || {};
    const c = canvas(w, h), ctx = c.getContext('2d');
    const hc = canvas(w, h), hx = hc.getContext('2d');
    hx.fillStyle = '#000'; hx.fillRect(0, 0, w, h);
    const cw = w / cols, ch = h / rows;
    ctx.fillStyle = hex(shade(colorAt(0.5, 0.5), 0.45)); ctx.fillRect(0, 0, w, h);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const off = opts.brick && (j % 2) ? cw / 2 : 0;
        const u = ((i + 0.5) * cw + off) / w, v = (j + 0.5) * ch / h;
        const base = colorAt(u % 1, v);
        const k = 0.9 + rnd.next() * 0.2;
        const cx = (i + 0.5) * cw + off, cy = (j + 0.5) * ch;
        const rx = cw * 0.56, ry = ch * 0.6;
        for (let wrap = -1; wrap <= 1; wrap++) {      // draw wrapped copies so the tile is seamless
          const x = cx + wrap * w;
          if (x < -cw || x > w + cw) continue;
          const g = ctx.createRadialGradient(x - rx * 0.3, cy - ry * 0.35, 1, x, cy, Math.max(rx, ry));
          g.addColorStop(0, hex(shade(base, 1.25 * k)));
          g.addColorStop(0.55, hex(shade(base, 1.0 * k)));
          g.addColorStop(1, hex(shade(base, 0.62 * k)));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.ellipse(x, cy, rx, ry, (rnd.next() - 0.5) * 0.5, 0, Math.PI * 2); ctx.fill();
          // the yarn twist line across the bobble
          ctx.strokeStyle = hex(shade(base, 0.7 * k)); ctx.lineWidth = Math.max(1, cw * 0.08);
          ctx.beginPath(); ctx.moveTo(x - rx * 0.5, cy - ry * 0.2); ctx.quadraticCurveTo(x, cy + ry * 0.25, x + rx * 0.5, cy - ry * 0.15); ctx.stroke();
          const hg = hx.createRadialGradient(x, cy, 0, x, cy, Math.max(rx, ry));
          hg.addColorStop(0, '#fff'); hg.addColorStop(0.6, '#999'); hg.addColorStop(1, '#000');
          hx.fillStyle = hg;
          hx.beginPath(); hx.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2); hx.fill();
        }
      }
    }
    return { color: c, height: hc };
  }

  /* V-stitch knitting (rows of interlocking Vs), for towers, tassels and characters' limbs. */
  function knit(w, h, cols, rows, colorAt, rnd) {
    const c = canvas(w, h), ctx = c.getContext('2d');
    const hc = canvas(w, h), hx = hc.getContext('2d');
    hx.fillStyle = '#000'; hx.fillRect(0, 0, w, h);
    const cw = w / cols, ch = h / rows;
    ctx.fillStyle = hex(shade(colorAt(0.5, 0.5), 0.5)); ctx.fillRect(0, 0, w, h);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const base = colorAt((i + 0.5) / cols, (j + 0.5) / rows);
        const k = 0.9 + rnd.next() * 0.2;
        const x = i * cw, y = j * ch;
        [[-1, 0.25], [1, 0.75]].forEach(function (s) {
          const lx = x + cw * s[1];
          const g = ctx.createLinearGradient(lx - cw * 0.25, y, lx + cw * 0.25, y + ch);
          g.addColorStop(0, hex(shade(base, 1.2 * k))); g.addColorStop(1, hex(shade(base, 0.7 * k)));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.ellipse(lx, y + ch * 0.55, cw * 0.27, ch * 0.62, s[0] * 0.5, 0, Math.PI * 2); ctx.fill();
          hx.fillStyle = '#ddd';
          hx.beginPath(); hx.ellipse(lx, y + ch * 0.55, cw * 0.22, ch * 0.55, s[0] * 0.5, 0, Math.PI * 2); hx.fill();
        });
      }
    }
    return { color: c, height: hc };
  }

  /* ---------- pattern functions (u, v in 0..1 of one tile) ---------- */

  function flower(u, v, cx, cy, r, petals, petal, centre, ring) {
    const dx = u - cx, dy = v - cy;
    const d = Math.hypot(dx, dy) / r;
    if (d > 1.05) return null;
    const a = Math.atan2(dy, dx);
    const edge = 0.55 + 0.45 * Math.abs(Math.cos(a * petals / 2));
    if (d < 0.22) return centre;
    if (ring && d < 0.32) return ring;
    if (d < edge) return d < edge - 0.12 ? petal : shade(petal, 0.8);
    return null;
  }

  function carpetAt(u, v) {
    // big central medallion
    let c = flower(u, v, 0.5, 0.5, 0.3, 8, COL.gold, COL.crimsonDark, COL.cream);
    if (c) return c;
    const r2 = Math.hypot(u - 0.5, v - 0.5);
    if (r2 > 0.3 && r2 < 0.335) return COL.goldLight;
    // quarter flowers at the corners (seamless) in teal/gold
    for (let i = 0; i < 4; i++) {
      const cx = i % 2, cy = i < 2 ? 0 : 1;
      c = flower(u, v, cx, cy, 0.2, 6, COL.teal, COL.gold, COL.cream);
      if (c) return c;
    }
    // small cream/teal leaves between
    const lu = (u * 2) % 1, lv = (v * 2 + 0.5) % 1;
    const leaf = Math.hypot((lu - 0.5) * 1.8, (lv - 0.5)) < 0.12;
    if (leaf && r2 > 0.36) return COL.tealLight;
    // stitched border dots along v
    return (Math.floor(v * 24) + Math.floor(u * 24)) % 7 === 0 ? COL.rose : COL.crimson;
  }

  function sideLoopAt(u, v) {
    // teal speed ribbon: gold chevrons pointing forward (+v), cream edges
    if (u < 0.08 || u > 0.92) return COL.cream;
    if (u < 0.12 || u > 0.88) return COL.gold;
    const cu = Math.abs(u - 0.5);
    const p = (v * 3 + cu * 1.4) % 1;
    if (p < 0.18) return COL.goldLight;
    if (p < 0.26) return COL.gold;
    return (Math.floor(v * 30) + Math.floor(u * 20)) % 5 === 0 ? COL.tealLight : COL.teal;
  }

  /* ---------- build ---------- */

  function create(THREE, opts) {
    opts = opts || {};
    const rnd = WW.rng(20261016);
    const aniso = opts.anisotropy || 4;
    const owned = [];
    function tex(cnv, repeat, srgb) {
      const t = new THREE.CanvasTexture(cnv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if (repeat) t.repeat.set(repeat[0], repeat[1]);
      t.anisotropy = aniso;
      if (srgb !== false) t.encoding = THREE.sRGBEncoding;
      owned.push(t);
      return t;
    }
    function stitchMat(pair, o) {
      o = o || {};
      const map = tex(pair.color, o.repeat);
      const nmap = tex(normalMap(pair.height, o.bump || 2.2), o.repeat, false);
      const m = new THREE.MeshStandardMaterial({
        map: map, normalMap: nmap, roughness: o.roughness == null ? 0.92 : o.roughness, metalness: 0,
        color: o.tint ? new THREE.Color(o.tint) : 0xffffff
      });
      if (o.normalScale) m.normalScale.set(o.normalScale, o.normalScale);
      owned.push(m);
      return m;
    }

    const M = { THREE: THREE, COL: COL, textures: {} };

    // carpet: one 6 m × 6 m tile, 48 × 48 bobbles
    M.carpet = stitchMat(bobbles(768, 768, 48, 48, carpetAt, rnd, { brick: true }), { bump: 2.6 });
    M.sideLoop = stitchMat(bobbles(384, 768, 22, 48, sideLoopAt, rnd, { brick: true }), { bump: 2.4 });
    M.sideLoop.polygonOffset = true; M.sideLoop.polygonOffsetFactor = -2; M.sideLoop.polygonOffsetUnits = -2;

    // braided gold rope (u around, v along)
    const ropeC = canvas(128, 256), rc = ropeC.getContext('2d');
    const ropeH = canvas(128, 256), rh = ropeH.getContext('2d');
    rc.fillStyle = hex(COL.gold); rc.fillRect(0, 0, 128, 256);
    rh.fillStyle = '#000'; rh.fillRect(0, 0, 128, 256);
    for (let k = -8; k < 16; k++) {
      const y0 = k * 32;
      [rc, rh].forEach(function (cx, which) {
        const g = cx.createLinearGradient(0, y0, 0, y0 + 40);
        if (which === 0) { g.addColorStop(0, hex(COL.goldLight)); g.addColorStop(0.5, hex(COL.gold)); g.addColorStop(1, hex(shade(COL.gold, 0.6))); }
        else { g.addColorStop(0, '#333'); g.addColorStop(0.45, '#fff'); g.addColorStop(1, '#000'); }
        cx.fillStyle = g;
        cx.beginPath(); cx.moveTo(0, y0); cx.lineTo(128, y0 + 48); cx.lineTo(128, y0 + 76); cx.lineTo(0, y0 + 28); cx.closePath(); cx.fill();
      });
    }
    M.rope = stitchMat({ color: ropeC, height: ropeH }, { bump: 3, roughness: 0.75 });
    M.roseRope = M.rope.clone(); M.roseRope.color = new THREE.Color(0xff8fa8); owned.push(M.roseRope);
    M.trim = M.rope;

    // wood (vertical planks + grain)
    function woodCanvas(base, dark, light) {
      const c = canvas(256, 256), x = c.getContext('2d');
      const hc = canvas(256, 256), hx = hc.getContext('2d');
      for (let i = 0; i < 8; i++) {
        const col = mix(base, i % 2 ? dark : light, 0.25 + rnd.next() * 0.2);
        x.fillStyle = hex(col); x.fillRect(i * 32, 0, 32, 256);
        hx.fillStyle = '#ccc'; hx.fillRect(i * 32 + 2, 0, 28, 256);
        hx.fillStyle = '#222'; hx.fillRect(i * 32, 0, 2, 256);
        x.fillStyle = hex(shade(dark, 0.7)); x.fillRect(i * 32, 0, 2, 256);
        for (let g = 0; g < 9; g++) {
          x.strokeStyle = 'rgba(80,40,10,' + (0.15 + rnd.next() * 0.2).toFixed(2) + ')';
          x.lineWidth = 1 + rnd.next();
          const gx = i * 32 + 4 + rnd.next() * 24;
          x.beginPath(); x.moveTo(gx, 0);
          for (let y = 0; y <= 256; y += 32) x.lineTo(gx + Math.sin(y * 0.05 + g) * 2, y);
          x.stroke();
        }
      }
      return { color: c, height: hc };
    }
    M.wood = stitchMat(woodCanvas(COL.wood, COL.woodDark, COL.woodLight), { bump: 1.6, roughness: 0.8 });
    M.woodDark = stitchMat(woodCanvas(COL.woodDark, shade(COL.woodDark, 0.7), COL.wood), { bump: 1.6, roughness: 0.85 });

    // knit bands for towers: stripes of gold / teal / rose / cream
    const bandColors = [COL.gold, COL.teal, COL.rose, COL.cream, COL.purple, COL.gold];
    M.knitBands = stitchMat(knit(256, 192, 16, 12, function (u, v) {
      return bandColors[Math.floor(v * 6) % 6];
    }, rnd), { bump: 2.4 });
    M.knitGold = stitchMat(knit(128, 64, 8, 4, function () { return COL.gold; }, rnd), { bump: 2.4 });
    M.tassel = stitchMat(knit(64, 128, 4, 12, function () { return COL.purple; }, rnd), { bump: 2.0 });
    M.tasselCap = stitchMat(knit(64, 32, 6, 3, function () { return COL.gold; }, rnd), { bump: 2.0 });

    // teal tapestry with a gold border and an embroidered flower
    const tp = canvas(256, 512), tx = tp.getContext('2d');
    tx.fillStyle = hex(COL.tealDark); tx.fillRect(0, 0, 256, 512);
    tx.strokeStyle = hex(COL.gold); tx.lineWidth = 14; tx.strokeRect(10, 10, 236, 492);
    tx.strokeStyle = hex(COL.goldLight); tx.lineWidth = 4; tx.strokeRect(24, 24, 208, 464);
    for (let i = 0; i < 26; i++) { tx.fillStyle = hex(i % 2 ? COL.gold : COL.cream); tx.beginPath(); tx.arc(10 + (i % 13) * 19, i < 13 ? 10 : 502, 6, 0, 7); tx.fill(); }
    function petal(cx, cy, r, a, col) {
      tx.save(); tx.translate(cx, cy); tx.rotate(a);
      tx.fillStyle = hex(col); tx.beginPath(); tx.ellipse(0, -r * 0.55, r * 0.32, r * 0.55, 0, 0, 7); tx.fill(); tx.restore();
    }
    tx.strokeStyle = hex(COL.leaf); tx.lineWidth = 6;
    tx.beginPath(); tx.moveTo(128, 470); tx.bezierCurveTo(110, 360, 150, 300, 128, 200); tx.stroke();
    [[96, 380, -0.8], [160, 330, 0.8], [100, 270, -0.6]].forEach(function (l) {
      tx.save(); tx.translate(l[0], l[1]); tx.rotate(l[2]); tx.fillStyle = hex(COL.leaf);
      tx.beginPath(); tx.ellipse(0, 0, 14, 32, 0, 0, 7); tx.fill(); tx.restore();
    });
    for (let i = 0; i < 8; i++) petal(128, 170, 70, i * Math.PI / 4, i % 2 ? COL.rose : COL.crimson);
    tx.fillStyle = hex(COL.gold); tx.beginPath(); tx.arc(128, 170, 18, 0, 7); tx.fill();
    for (let i = 0; i < 6; i++) petal(128, 410, 30, i * Math.PI / 3, COL.goldLight);
    M.tapestry = new THREE.MeshStandardMaterial({ map: tex(tp), roughness: 0.95, side: THREE.DoubleSide });
    owned.push(M.tapestry);

    M.deckSide = stitchMat(knit(128, 64, 12, 4, function (u, v) { return v < 0.5 ? COL.mauve : shade(COL.mauve, 0.8); }, rnd), { bump: 2 });
    M.deckSide.side = THREE.DoubleSide;
    M.lantern = new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffb84a, emissiveIntensity: 1.6, roughness: 0.5 });
    M.lanternFrame = new THREE.MeshStandardMaterial({ color: 0x8a5426, roughness: 0.6, metalness: 0.2 });
    M.gold = new THREE.MeshStandardMaterial({ color: 0xf2b53c, roughness: 0.45, metalness: 0.35 });
    M.petal = new THREE.MeshStandardMaterial({ color: 0xff7aa8, emissive: 0xff4f86, emissiveIntensity: 0.55, roughness: 0.6, side: THREE.DoubleSide });
    M.petalGold = new THREE.MeshStandardMaterial({ color: 0xffd36e, emissive: 0xffa630, emissiveIntensity: 0.6, roughness: 0.6, side: THREE.DoubleSide });
    M.finishBand = stitchMat(bobbles(256, 64, 16, 4, function (u, v) {
      return (Math.floor(u * 16) + Math.floor(v * 4)) % 2 ? COL.cream : COL.gold;
    }, rnd), { bump: 2 });
    M.finishBand.polygonOffset = true; M.finishBand.polygonOffsetFactor = -3; M.finishBand.polygonOffsetUnits = -3;
    owned.push(M.lantern, M.lanternFrame, M.gold, M.petal, M.petalGold);

    // distant city: warm walls with lit windows (Lambert: cheap)
    // loom-city tower walls: golden planks, coloured knit bands, warm arched windows
    const cw = canvas(128, 512), cx = cw.getContext('2d');
    for (let i = 0; i < 8; i++) { cx.fillStyle = hex(mix(COL.woodLight, COL.wood, rnd.next() * 0.6)); cx.fillRect(i * 16, 0, 16, 512); }
    for (let i = 0; i < 8; i++) { cx.fillStyle = 'rgba(110,55,20,0.35)'; cx.fillRect(i * 16, 0, 2, 512); }
    const bands = [COL.teal, COL.rose, COL.gold, COL.purple, COL.cream];
    for (let y = 0; y < 512; y += 64) {
      cx.fillStyle = hex(bands[(y / 64) % bands.length]); cx.fillRect(0, y, 128, 10);
      cx.fillStyle = hex(COL.goldLight); cx.fillRect(0, y + 10, 128, 3);
      for (let x = 8; x < 128; x += 32) {
        const lit = rnd.next() < 0.75;
        cx.fillStyle = lit ? '#ffe7a0' : '#6a3c22';
        cx.beginPath(); cx.moveTo(x, y + 52); cx.lineTo(x, y + 30); cx.arc(x + 7, y + 30, 7, Math.PI, 0); cx.lineTo(x + 14, y + 52); cx.fill();
        if (lit) { cx.fillStyle = 'rgba(255,200,90,0.35)'; cx.fillRect(x - 3, y + 50, 20, 4); }
      }
    }
    M.cityWall = new THREE.MeshLambertMaterial({ map: tex(cw), emissive: 0x7a4418, emissiveIntensity: 0.3 });
    M.cityRoof = new THREE.MeshLambertMaterial({ color: 0xd8738f, emissive: 0x5a1a30, emissiveIntensity: 0.2 });
    M.cityRoofGold = new THREE.MeshLambertMaterial({ color: 0xf0b850, emissive: 0x6a4010, emissiveIntensity: 0.25 });
    M.cityBanner = new THREE.MeshLambertMaterial({ color: 0x1f8a8f, side: THREE.DoubleSide });
    M.island = new THREE.MeshLambertMaterial({ color: 0xc78a58 });
    owned.push(M.cityWall, M.cityRoof, M.cityRoofGold, M.cityBanner, M.island);

    // waterfall: vertical white streaks fading down
    const wf = canvas(64, 256), wx = wf.getContext('2d');
    const wg = wx.createLinearGradient(0, 0, 0, 256);
    wg.addColorStop(0, 'rgba(255,255,255,0.95)'); wg.addColorStop(1, 'rgba(255,255,255,0)');
    wx.fillStyle = wg; wx.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 24; i++) { wx.fillStyle = 'rgba(190,220,255,0.35)'; wx.fillRect(rnd.next() * 64, 0, 2, 256); }
    M.waterfall = new THREE.MeshBasicMaterial({ map: tex(wf), transparent: true, depthWrite: false, fog: true });
    owned.push(M.waterfall);

    // characters' yarn: single-crochet rows
    function yarn(col) {
      return stitchMat(bobbles(256, 256, 16, 16, function () { return col; }, rnd, { brick: true }), { bump: 2.8, repeat: [4, 2] });
    }
    M.purlYarn = yarn([226, 46, 62]);
    M.loopYarn = yarn([22, 178, 176]);
    M.purlYarnDark = yarn([196, 30, 50]);
    M.loopYarnDark = yarn([14, 142, 142]);
    M.sole = stitchMat(bobbles(64, 64, 6, 6, function () { return [150, 90, 50]; }, rnd), { bump: 2 });
    M.eye = new THREE.MeshStandardMaterial({ color: 0x2a1a1a, roughness: 0.3 });
    owned.push(M.eye);

    // thread spools: wound thread in the thread colour
    const spoolCache = {};
    M.spool = function (color) {
      if (spoolCache[color]) return spoolCache[color];
      const base = { coral: [226, 40, 60], red: [226, 40, 60], teal: [26, 170, 170], gold: [246, 190, 60] }[color] || [200, 200, 200];
      const c = canvas(64, 128), x = c.getContext('2d');
      x.fillStyle = hex(base); x.fillRect(0, 0, 64, 128);
      for (let y = 0; y < 128; y += 3) { x.fillStyle = 'rgba(255,255,255,' + (0.1 + rnd.next() * 0.2).toFixed(2) + ')'; x.fillRect(0, y, 64, 1); }
      const m = new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.6, emissive: new THREE.Color(hex(base)), emissiveIntensity: 0.25 });
      owned.push(m);
      spoolCache[color] = m;
      return m;
    };

    // sprite textures
    function radial(size, stops) {
      const c = canvas(size, size), x = c.getContext('2d');
      const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
      x.fillStyle = g; x.fillRect(0, 0, size, size);
      return tex(c);
    }
    M.textures.glow = radial(64, [[0, 'rgba(255,230,160,1)'], [0.35, 'rgba(255,190,90,0.5)'], [1, 'rgba(255,170,60,0)']]);
    M.textures.spark = radial(32, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,240,180,0.8)'], [1, 'rgba(255,220,120,0)']]);
    M.textures.shadow = radial(64, [[0, 'rgba(40,10,20,0.55)'], [0.55, 'rgba(40,10,20,0.3)'], [1, 'rgba(40,10,20,0)']]);
    const cl = canvas(256, 128), clx = cl.getContext('2d');
    for (let i = 0; i < 14; i++) {
      const x = 40 + rnd.next() * 176, y = 50 + rnd.next() * 40, r = 22 + rnd.next() * 36;
      const g = clx.createRadialGradient(x, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.7, 'rgba(255,240,235,0.6)'); g.addColorStop(1, 'rgba(255,230,225,0)');
      clx.fillStyle = g; clx.beginPath(); clx.arc(x, y, r, 0, 7); clx.fill();
    }
    M.textures.cloud = tex(cl);

    M.dispose = function () { owned.forEach(function (o) { if (o && o.dispose) o.dispose(); }); };
    return M;
  }

  R.materials = { create: create, COL: COL };
})(globalThis.WW = globalThis.WW || {});
