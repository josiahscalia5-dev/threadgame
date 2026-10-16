/* Wishweave Wonders — connected-world renderer (WW.render3d), three.js r149 (game/vendor/three.min.js).

   One continuous 3D course (WW.world.build). Every painted scene is projected from its own camera position onto
   real 3D surfaces rebuilt from Purl's route data: the walkable road, low walls along its edges (rails and posts)
   and a backdrop for the rest of the painting. Standing where the painting's camera stood, the screen shows the
   painting exactly; moving along the road gives real perspective. Between scenes the connecting roads are real
   meshes dressed with carpet, gold braid and knit cut from the same paintings (tools/bake-world.cjs). A chase
   camera follows Purl and arrives at each painting's own camera position as he reaches that scene, so nothing
   swaps, fades or teleports. Purl, Loop, spools and posts are the game's existing sprites, drawn as billboards.

     const r = WW.render3d.createRenderer({ canvas, images, assets: WW.ASSETS, world, debug });
     r.resize(cssW, cssH, dpr); r.render(state, dtReal); r.getCameraPose(); r.getLayout(); */
(function (WW) {
  'use strict';
  const U = WW.util;

  const PROJ_VS = [
    'uniform mat4 projVP;',
    'varying vec4 vProj; varying vec2 vMeshUv;',
    'void main() {',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vProj = projVP * wp; vMeshUv = uv;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'].join('\n');
  const PROJ_FS = [
    'uniform sampler2D map;',
    'uniform vec4 feather;',      // fade widths at the painting's left, right, top and bottom edges (uv units)
    'uniform float opacity; uniform vec4 meshFade; uniform float featherScale;',   // fade at the mesh's own left, right, top, bottom (mesh uv)
    'varying vec4 vProj; varying vec2 vMeshUv;',
    'void main() {',
    '  if (vProj.w <= 0.0) discard;',
    '  vec2 uv = vProj.xy / vProj.w * 0.5 + 0.5;',
    '  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;',
    '  float a = opacity; vec4 fe = feather * featherScale;',
    '  if (fe.x > 0.0) a *= smoothstep(0.0, fe.x, uv.x);',
    '  if (fe.y > 0.0) a *= smoothstep(0.0, fe.y, 1.0 - uv.x);',
    '  if (fe.z > 0.0) a *= smoothstep(0.0, fe.z, 1.0 - uv.y);',
    '  if (fe.w > 0.0) a *= smoothstep(0.0, fe.w, uv.y);',
    '  if (meshFade.x > 0.0) a *= smoothstep(0.0, meshFade.x, vMeshUv.x);',
    '  if (meshFade.y > 0.0) a *= smoothstep(0.0, meshFade.y, 1.0 - vMeshUv.x);',
    '  if (meshFade.z > 0.0) a *= smoothstep(0.0, meshFade.z, 1.0 - vMeshUv.y);',
    '  if (meshFade.w > 0.0) a *= smoothstep(0.0, meshFade.w, vMeshUv.y);',
    '  if (a < 0.004) discard;',
    '  gl_FragColor = vec4(texture2D(map, uv).rgb, a);',
    '}'].join('\n');

  /* Connector deck: tiles of the two scenes' carpets, blended along the road, with the neighbouring paintings
     projected over its first and last metres so the road meets each painted scene without a seam. */
  const DECK_VS = [
    'uniform mat4 projA; uniform mat4 projB;',
    'attribute float dist;',
    'varying vec2 vUv; varying float vD; varying vec4 vPA; varying vec4 vPB;',
    'void main() {',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vUv = uv; vD = dist; vPA = projA * wp; vPB = projB * wp;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'].join('\n');
  const DECK_FS = [
    'uniform sampler2D tileA; uniform sampler2D tileB; uniform sampler2D paintA; uniform sampler2D paintB;',
    'uniform float len; uniform float blendA; uniform float blendB; uniform float shade;',
    'varying vec2 vUv; varying float vD; varying vec4 vPA; varying vec4 vPB;',
    'float inside(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }',
    'void main() {',
    '  vec3 c = mix(texture2D(tileA, vUv).rgb, texture2D(tileB, vUv).rgb, smoothstep(0.3 * len, 0.7 * len, vD));',
    '  if (vPA.w > 0.0) { vec2 ua = vPA.xy / vPA.w * 0.5 + 0.5; float w = (1.0 - smoothstep(0.0, blendA, vD)) * inside(ua);',
    '    c = mix(c, texture2D(paintA, ua).rgb, w); }',
    '  if (vPB.w > 0.0) { vec2 ub = vPB.xy / vPB.w * 0.5 + 0.5; float w = smoothstep(len - blendB, len, vD) * inside(ub);',
    '    c = mix(c, texture2D(paintB, ub).rgb, w); }',
    '  float edge = abs(vUv.x - 0.5) * 2.0;',
    '  c *= 1.0 - shade * smoothstep(0.55, 1.0, edge);',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'].join('\n');

  const SKY_VS = 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
  /* Sky: the paintings' blue overhead, pale pink haze at the horizon, and soft clouds far below the walkways
     (only an atmosphere fill for where no painting looks; every object in the world comes from the paintings). */
  const SKY_FS = [
    'uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 cloud; uniform vec3 cloudShade; varying vec3 vDir;',
    'float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
    'float n3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),',
    '             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }',
    'float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * n3(p); p *= 2.03; a *= 0.5; } return s; }',
    'void main(){ vec3 d = normalize(vDir); float y = d.y; vec3 c;',
    '  if (y > 0.0) { c = mix(mid, top, smoothstep(0.0, 0.55, y));',
    '    float n = fbm(vec3(d.x * 3.0, y * 6.0, d.z * 3.0)); c = mix(c, cloud, smoothstep(0.55, 0.85, n) * 0.55 * (1.0 - smoothstep(0.05, 0.5, y))); }',
    '  else { c = mix(mid, low, smoothstep(0.0, 0.22, -y));',
    '    vec3 q = d / max(0.08, -y);',          // project onto a cloud layer far below
    '    float n = fbm(vec3(q.x * 0.9, 0.0, q.z * 0.9)) * 0.7 + fbm(vec3(q.x * 2.7, 1.0, q.z * 2.7)) * 0.3;',
    '    float puff = smoothstep(0.38, 0.62, n);',
    '    c = mix(c, mix(cloudShade, cloud, smoothstep(0.45, 0.8, n)), puff * (0.35 + 0.65 * smoothstep(0.0, 0.1, -y))); }',
    '  gl_FragColor = vec4(c, 1.0); }'].join('\n');

  function createRenderer(opts) {
    const THREE = globalThis.THREE;
    const canvas = opts.canvas, images = opts.images, F = opts.assets.frames, world = opts.world;
    const debug = !!opts.debug;
    const gl = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    gl.setClearColor(0xf2dfe8, 1);
    gl.sortObjects = true;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 0.46, 0.05, 3000);
    camera.rotation.order = 'YXZ';
    let W = 1, H = 1;
    const texCache = {};
    function tex(key, image, wrap) {
      if (texCache[key]) return texCache[key];
      const t = new THREE.Texture(image);
      t.needsUpdate = true;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      if (wrap) { t.wrapS = wrap[0]; t.wrapT = wrap[1]; }
      return (texCache[key] = t);
    }
    function frameTex(name) {
      if (texCache['f:' + name]) return texCache['f:' + name];
      const fr = F[name], img = images[fr.img];
      const t = new THREE.Texture(img);
      t.needsUpdate = true;
      t.repeat.set(fr.w / img.width, fr.h / img.height);
      t.offset.set(fr.x / img.width, 1 - (fr.y + fr.h) / img.height);
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return (texCache['f:' + name] = t);
    }

    // ------------------------------------------------------------------ sky and far panorama
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x7eaeea) }, mid: { value: new THREE.Color(0xf0e2ec) }, low: { value: new THREE.Color(0x9fbbec) },
                  cloud: { value: new THREE.Color(0xffffff) }, cloudShade: { value: new THREE.Color(0xd8cbe6) } }
    }));
    sky.renderOrder = -2;
    scene.add(sky);
    const pano = new THREE.Group();
    (function () {
      // 12 painted sky bands around the horizon (tools/bake-world.cjs), horizon row at 620/(620+90) of a band
      const R = 1800, fBand = 2005 * (680 / 841);
      const topEl = Math.atan(620 * (680 / 841) / fBand), botEl = -Math.atan(90 * (680 / 841) / fBand);
      const yTop = R * Math.tan(topEl), yBot = R * Math.tan(botEl);
      for (let t = 0; t < 2; t++) {
        const img = images['world.sky-' + t];
        if (!img) continue;
        const geo = new THREE.CylinderGeometry(R, R, yTop - yBot, 96, 1, true, t * Math.PI, Math.PI);
        const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
          side: THREE.BackSide, depthWrite: false, transparent: true,
          uniforms: { map: { value: tex('sky' + t, img) } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main(){ vec3 c = texture2D(map, vUv).rgb;' +
            ' float a = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y)); gl_FragColor = vec4(c, a); }'
        }));
        m.position.y = (yTop + yBot) / 2;
        m.renderOrder = -1;
        pano.add(m);
      }
    })();
    scene.add(pano);

    // ------------------------------------------------------------------ painted scenes on their 3D proxies
    const areaObjs = {};
    function projCamera(area) {
      const c = new THREE.PerspectiveCamera(area.cam.vfov, area.cam.aspect, 0.1, 4000);
      c.rotation.order = 'YXZ';
      c.position.set(area.camPos[0], area.camPos[1], area.camPos[2]);
      c.rotation.set(-area.cam.theta, -area.camPhi, 0);
      c.updateMatrixWorld(true);
      c.updateProjectionMatrix();
      const m = new THREE.Matrix4();
      m.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
      return m;
    }
    function projMaterial(area, feather, transparent, meshFade) {
      meshFade = meshFade || [0, 0, 0, 0];
      return new THREE.ShaderMaterial({
        vertexShader: PROJ_VS, fragmentShader: PROJ_FS, transparent: !!transparent, depthWrite: !transparent,
        side: THREE.DoubleSide,
        uniforms: { map: { value: tex('plate:' + area.id, images[area.image]) }, projVP: { value: area.projVP },
                    feather: { value: new THREE.Vector4(feather[0], feather[1], feather[2], feather[3]) }, opacity: { value: 1 }, featherScale: { value: 0 },
                    meshFade: { value: new THREE.Vector4(meshFade[0], meshFade[1], meshFade[2], meshFade[3]) } }
      });
    }
    function stripGeometry(rows, getA, getB) {
      const pos = [], idx = [];
      rows.forEach(function (r, i) {
        const a = getA(r), b = getB(r);
        pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0.5), 2));
      g.setIndex(idx);
      return g;
    }
    Object.keys(world.areas).forEach(function (id) {
      const A = world.areas[id];
      if (!A.camPos) return;                                  // not placed in this world (later scenes)
      A.projVP = projCamera(A);
      const group = new THREE.Group();
      // the road: painted floor rows nearer than Purl's start, then his route to just past the scene's exit
      const rows = A.floor.concat(A.samples.slice(0, Math.min(A.samples.length, A.exitIdx + 2)));
      const road = new THREE.Mesh(stripGeometry(rows, function (r) { return r.lw; }, function (r) { return r.rw; }),
                                  projMaterial(A, [0.05, 0.05, 0, 0], false));
      road.material.polygonOffset = true; road.material.polygonOffsetFactor = -1; road.material.polygonOffsetUnits = -2;
      group.add(road);
      // low walls along both edges carry the painted rails and posts
      const WALL = A.wall || 1.2;
      ['lw', 'rw'].forEach(function (k) {
        const wall = new THREE.Mesh(stripGeometry(rows, function (r) { return r[k]; }, function (r) { return [r[k][0], r[k][1] + WALL, r[k][2]]; }),
                                    projMaterial(A, [0.1, 0.1, 0, 0], true));
        wall.renderOrder = 2;
        group.add(wall);
      });
      // backdrop: everything else in the painting, on a surface just beyond the end of the scene's road
      const D = A.backdrop, hf = Math.tan(A.cam.vfov / 2 * Math.PI / 180), hfH = hf * A.cam.aspect;
      const bw = 2 * D * hfH * 1.25, bTop = D * Math.tan(A.cam.vfov / 2 * Math.PI / 180 + 0.05 - A.cam.theta) * 1.15,
            bBot = D * Math.tan(A.cam.vfov / 2 * Math.PI / 180 + A.cam.theta) * 1.6;
      // the plane's lower part fades out, so seen from the side it never shows a hard bottom edge
      const back = new THREE.Mesh(new THREE.PlaneGeometry(bw, bTop + bBot), projMaterial(A, [0.14, 0.14, 0.06, 0.0], true, [0, 0, 0, 0.42]));
      const fw = WW.world.fwd(A.camPhi);
      back.position.set(A.camPos[0] + fw[0] * D, A.camPos[1] + (bTop - bBot) / 2, A.camPos[2] + fw[2] * D);
      back.rotation.y = -A.camPhi;
      back.renderOrder = 1;
      group.add(back);
      const mats = [];
      group.traverse(function (o) { if (o.material && o.material.uniforms && o.material.uniforms.featherScale) mats.push(o.material); });
      areaObjs[id] = { group: group, road: road, back: back, mats: mats, area: A };
      scene.add(group);
    });

    // ------------------------------------------------------------------ connecting roads
    const RS = THREE.RepeatWrapping, MR = THREE.MirroredRepeatWrapping;
    world.segs.forEach(function (seg, si) {
      if (seg.kind !== 'connector') return;
      const A = world.segs[si - 1].area, B = world.segs[si + 1] && world.segs[si + 1].area;
      if (!A || !B) return;
      const tr = seg.track;
      // the deck ends where the next scene's painted floor begins (that floor is part of the painting)
      const bFloor = B.floor.length ? B.floor[0].cw : B.samples[0].cw;
      let endIdx = tr.length - 1, best = 1e9;
      tr.forEach(function (t, i) { const dd = Math.hypot(t.p[0] - bFloor[0], t.p[2] - bFloor[2]); if (dd < best) { best = dd; endIdx = i; } });
      endIdx = Math.min(tr.length - 1, endIdx + 2);
      const pts = tr.slice(0, endIdx + 1);
      const texA = images['world.carpet-' + A.id], texB = images['world.carpet-' + B.id];
      const tA = tex('carpet:' + A.id, texA, [RS, MR]), tB = tex('carpet:' + B.id, texB, [RS, MR]);
      const tileLen = 2.1 * (texA.height / texA.width);
      const pos = [], uv = [], dist = [], idx = [];
      pts.forEach(function (t, i) {
        const R = WW.world.right(t.phi);
        const l = [t.p[0] + R[0] * t.latL, t.p[1], t.p[2] + R[2] * t.latL], r = [t.p[0] + R[0] * t.latR, t.p[1], t.p[2] + R[2] * t.latR];
        pos.push(l[0], l[1], l[2], r[0], r[1], r[2]);
        uv.push(0, t.d / tileLen, 1, t.d / tileLen);
        dist.push(t.d, t.d);
        if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('dist', new THREE.Float32BufferAttribute(dist, 1));
      g.setIndex(idx);
      const deck = new THREE.Mesh(g, new THREE.ShaderMaterial({
        vertexShader: DECK_VS, fragmentShader: DECK_FS, side: THREE.DoubleSide,
        uniforms: { tileA: { value: tA }, tileB: { value: tB }, paintA: { value: tex('plate:' + A.id, images[A.image]) },
                    paintB: { value: tex('plate:' + B.id, images[B.image]) }, projA: { value: A.projVP }, projB: { value: B.projVP },
                    len: { value: pts[pts.length - 1].d }, blendA: { value: 0.9 }, blendB: { value: 1.2 }, shade: { value: 0.18 } }
      }));
      scene.add(deck);
      // deck sides and underside: the cream crochet knit of the ribbon's underside
      const knit = tex('knit', images['world.knit'], [RS, RS]);
      const T = 0.32;
      ['latL', 'latR'].forEach(function (k) {
        const sp = [], su = [], si2 = [];
        pts.forEach(function (t, i) {
          const R = WW.world.right(t.phi);
          const e = [t.p[0] + R[0] * t[k], t.p[1], t.p[2] + R[2] * t[k]];
          sp.push(e[0], e[1], e[2], e[0], e[1] - T, e[2]);
          su.push(t.d / 0.9, 0, t.d / 0.9, T / 0.9);
          if (i) { const q = i * 2; si2.push(q - 2, q - 1, q, q - 1, q + 1, q); }
        });
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
        sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
        sg.setIndex(si2);
        scene.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: knit, side: THREE.DoubleSide, color: 0xe8d6bd })));
      });
      // gold braid rails along both edges
      const braid = tex('braid', images['world.braid'], [RS, RS]);
      ['latL', 'latR'].forEach(function (k, side) {
        const curvePts = pts.filter(function (t, i) { return i % 3 === 0 || i === pts.length - 1; }).map(function (t) {
          const R = WW.world.right(t.phi), inset = side ? -0.06 : 0.06;
          return new THREE.Vector3(t.p[0] + R[0] * (t[k] + inset), t.p[1] + 0.1, t.p[2] + R[2] * (t[k] + inset));
        });
        const curve = new THREE.CatmullRomCurve3(curvePts);
        const len = curve.getLength();
        const tube = new THREE.TubeGeometry(curve, Math.max(16, Math.round(len * 6)), 0.11, 8, false);
        const bt = braid.clone(); bt.needsUpdate = true; bt.wrapS = RS; bt.wrapT = RS; bt.repeat.set(len / 1.05, 1);
        scene.add(new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ map: bt })));
      });
      // wooden posts along the rails (the game's own post sprite)
      const postTex = frameTex('prop.cover-post'), pf = F['prop.cover-post'];
      for (let d = 1.2; d < pts[pts.length - 1].d - 0.5; d += 2.4) {
        const t = sampleTrack(pts, d);
        ['latL', 'latR'].forEach(function (k) {
          const R = WW.world.right(t.phi);
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: postTex, transparent: true, alphaTest: 0.35 }));
          s.center.set(pf.px / pf.w, 1 - pf.py / pf.h);
          const hgt = 1.05;
          s.scale.set(hgt * pf.w / pf.h, hgt, 1);
          s.position.set(t.p[0] + R[0] * t[k], t.p[1], t.p[2] + R[2] * t[k]);
          scene.add(s);
        });
      }
    });
    function sampleTrack(tr, d) {
      let i = 1;
      while (i < tr.length - 1 && tr[i].d < d) i++;
      const a = tr[i - 1], b = tr[i], k = (d - a.d) / Math.max(1e-9, b.d - a.d);
      return { p: [U.lerp(a.p[0], b.p[0], k), U.lerp(a.p[1], b.p[1], k), U.lerp(a.p[2], b.p[2], k)], phi: a.phi + WW.world.wrapAngle(b.phi - a.phi) * k,
               latL: U.lerp(a.latL, b.latL, k), latR: U.lerp(a.latR, b.latR, k) };
    }

    // ------------------------------------------------------------------ racers, items (existing sprites)
    function makeSprite() {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.4, depthWrite: true }));
      s.renderOrder = 5;
      scene.add(s);
      return s;
    }
    function setFrame(sprite, name, widthRef) {
      const fr = F[name];
      if (sprite.userData.frame !== name) {
        sprite.material.map = frameTex(name);
        sprite.material.needsUpdate = true;
        sprite.center.set(fr.px / fr.w, 1 - fr.py / fr.h);
        sprite.userData.frame = name;
      }
      sprite.scale.set(fr.w / widthRef, fr.h / widthRef, 1);
    }
    function makeShadow() {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), new THREE.MeshBasicMaterial({ color: 0x2a0f08, transparent: true, opacity: 0.32, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.scale.set(1, 0.42, 1);
      m.renderOrder = 4;
      scene.add(m);
      return m;
    }
    const racers = { purl: { sprite: makeSprite(), shadow: makeShadow() }, loop: { sprite: makeSprite(), shadow: makeShadow() } };
    const RUN = ['run-left', 'run-pass-a', 'run-right', 'run-pass-b'];
    const STRIDE = 1.35;

    // ------------------------------------------------------------------ debug geometry
    if (debug) {
      world.segs.forEach(function (seg) {
        const c = [], l = [], r = [];
        seg.track.forEach(function (t) {
          const R = WW.world.right(t.phi);
          c.push(new THREE.Vector3(t.p[0], t.p[1] + 0.03, t.p[2]));
          l.push(new THREE.Vector3(t.p[0] + R[0] * t.latL, t.p[1] + 0.03, t.p[2] + R[2] * t.latL));
          r.push(new THREE.Vector3(t.p[0] + R[0] * t.latR, t.p[1] + 0.03, t.p[2] + R[2] * t.latR));
        });
        const col = seg.kind === 'connector' ? 0x00e5ff : 0x39ff14;
        [c, l, r].forEach(function (pts, i) {
          scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: i ? 0xffff00 : col, depthTest: false })));
        });
      });
    }
    const contact = debug ? new THREE.Mesh(new THREE.RingGeometry(0.12, 0.2, 20), new THREE.MeshBasicMaterial({ color: 0xff2266, depthTest: false })) : null;
    if (contact) { contact.rotation.x = -Math.PI / 2; contact.renderOrder = 20; scene.add(contact); }

    // ------------------------------------------------------------------ chase camera
    /* Camera pose for a racer position. A function of where Purl is on the course (plus a gentle follow of his
       lane), so it is continuous everywhere: it starts each scene exactly at that painting's camera and blends
       between scenes along the connecting road. */
    function rigAt(segIndex, f) {
      const seg = world.segs[segIndex];
      const ahead = function (dd) { return world.sample(segIndex, Math.min(1, f + dd / seg.length)); };
      if (seg.kind === 'plate') {
        const A = seg.area, q = f;
        const road = ahead(1.6).phi;
        const wy = 0.5 * U.smooth(q / 0.45);
        return { back: A.rig.back, up: A.rig.up, pitch: A.rig.pitch, lat: A.rig.lat * (1 - U.smooth(q / 0.4)),
                 yaw: A.camPhi + wy * WW.world.wrapAngle(road - A.camPhi) };
      }
      const A = world.segs[segIndex - 1].area, B = world.segs[segIndex + 1].area;
      const exitRig = rigAt(segIndex - 1, 1);
      const road = ahead(2.2).phi;
      const t = f, k = U.smooth(t);
      let yaw = exitRig.yaw + WW.world.wrapAngle(road - exitRig.yaw) * U.smooth(t / 0.22);
      yaw = yaw + WW.world.wrapAngle(B.camPhi - yaw) * U.smooth((t - 0.55) / 0.45);
      const slope = world.sample(segIndex, Math.min(1, f + 1.5 / seg.length)).slope;
      const dip = Math.sin(Math.PI * U.clamp(t, 0, 1));
      return { back: U.lerp(A.rig.back, B.rig.back, k), up: U.lerp(A.rig.up, B.rig.up, k),
               pitch: U.lerp(A.rig.pitch, B.rig.pitch, k) - Math.atan(Math.min(0, slope)) * 0.45 * dip,
               lat: U.lerp(0, B.rig.lat, U.smooth((t - 0.5) / 0.5)), yaw: yaw };
    }
    function groundPoint(segIndex, f, laneX) {
      const s = world.sample(segIndex, f);
      const R = WW.world.right(s.phi);
      const lat = U.clamp((laneX || 0) * s.lane, s.latL + 0.45, s.latR - 0.45);
      return { p: [s.p[0] + R[0] * lat, s.p[1], s.p[2] + R[2] * lat], phi: s.phi, s: s, lat: lat };
    }
    let camPose = null;
    function placeCamera(state) {
      const P = state.purl;
      const rig = rigAt(P.seg, P.f);
      const g = groundPoint(P.seg, P.f, 0);
      const follow = groundPoint(P.seg, P.f, P.laneX);
      const R = WW.world.right(rig.yaw), Fw = WW.world.fwd(rig.yaw);
      const cx = g.p[0] + (follow.p[0] - g.p[0]) * 0.35, cz = g.p[2] + (follow.p[2] - g.p[2]) * 0.35;
      camera.position.set(cx + R[0] * rig.lat - Fw[0] * rig.back, g.p[1] + rig.up, cz + R[2] * rig.lat - Fw[2] * rig.back);
      camera.rotation.set(-rig.pitch, -rig.yaw, 0);
      camera.updateMatrixWorld(true);
      camPose = { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: rig.yaw, pitch: rig.pitch };
      pano.position.set(camera.position.x, camera.position.y, camera.position.z);
      sky.position.copy(camera.position);
    }

    // ------------------------------------------------------------------ per-frame
    let anim = 0;
    function poseRacer(who, r, state, laneX) {
      const o = racers[who];
      if (!r || r.seg === undefined || r.seg >= world.segs.length) { o.sprite.visible = false; o.shadow.visible = false; return null; }
      const g = groundPoint(r.seg, r.f, laneX);
      const ref = F[who + '.idle'].w;
      let name = who + '.idle', bob = 0;
      const mode = state.mode;
      if (mode === 'running' || mode === 'finished') {
        if (r.action === 'tangled' || r.action === 'stumble' || r.action === 'failed') name = who + '.stumble';
        else if ((r.jumpH || 0) > 0.02) name = who + '.jump';
        else if (r.action === 'finished') { const hop = Math.max(0, Math.sin(anim * 5.5)); name = hop > 0.25 ? who + '.jump' : who + '.idle'; bob = hop * 0.22; }
        else if (r.speed > 0.3) { const ph = r.distance / STRIDE; name = who + '.' + RUN[Math.floor(ph * 4) % 4]; bob = Math.abs(Math.sin(ph * Math.PI * 2)) * 0.035; }
      } else bob = Math.sin(anim * 2.4) * 0.008;
      setFrame(o.sprite, name, ref);
      const lift = (r.jumpH || 0) * 0.6 + bob;
      o.sprite.position.set(g.p[0], g.p[1] + 0.015 + lift, g.p[2]);
      o.sprite.material.rotation = U.clamp(((r.lane || 0) - (laneX || 0)) * 0.2, -0.2, 0.2);
      o.sprite.visible = true;
      o.shadow.position.set(g.p[0], g.p[1] + 0.012, g.p[2]);
      o.shadow.rotation.z = -g.phi;
      const k = 1 - U.clamp((r.jumpH || 0) * 0.6, 0, 0.6);
      o.shadow.scale.set(k, 0.42 * k, 1);
      o.shadow.visible = true;
      return g;
    }

    function updateFeather() {
      for (const id in areaObjs) {
        const o = areaObjs[id], A = o.area;
        const d = Math.hypot(camera.position.x - A.camPos[0], camera.position.y - A.camPos[1], camera.position.z - A.camPos[2]);
        const k = U.smooth(d / 2.5);
        for (let i = 0; i < o.mats.length; i++) o.mats[i].uniforms.featherScale.value = k;
      }
    }
    function render(state, dtReal) {
      anim += Math.min(0.1, Math.max(0, dtReal || 0));
      placeCamera(state);
      updateFeather();
      const g = poseRacer('purl', state.purl, state, state.purl.laneX);
      if (contact && g) contact.position.set(g.p[0], g.p[1] + 0.02, g.p[2]);
      poseRacer('loop', state.loop, state, state.loop ? (state.loop.laneX !== undefined ? state.loop.laneX : 1.6) : 0);
      gl.render(scene, camera);
    }

    function resize(cssW, cssH, dpr) {
      W = Math.max(1, cssW); H = Math.max(1, cssH);
      gl.setPixelRatio(Math.min(2, dpr || 1));
      gl.setSize(W, H, false);
      // Cover-fit the painting: same horizontal view as the painting on phones wider than it, same vertical
      // view on taller phones; very wide screens see more of the world at the sides instead of a cropped view.
      const pa = 841 / 1870, aspect = W / H, eff = Math.min(aspect, 0.6);
      const half = Math.tan(25 * Math.PI / 180);
      camera.fov = eff <= pa ? 50 : 2 * Math.atan(half * pa / eff) * 180 / Math.PI;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }

    return {
      resize: resize,
      render: render,
      onEvents: function () {},
      setHudAnchors: function () {},
      getLayout: function () { return { col: { x: 0, w: W } }; },
      getTapTargets: function () { return []; },
      getCameraPose: function () { return camPose; },
      /* Overhead view of the whole course (debug/preview only). */
      renderOverhead: function (state) {
        placeCamera(state);
        poseRacer('purl', state.purl, state, state.purl.laneX);
        poseRacer('loop', state.loop, state, 1.7);
        let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
        world.segs.forEach(function (sg) { sg.track.forEach(function (t) { minx = Math.min(minx, t.p[0]); maxx = Math.max(maxx, t.p[0]); minz = Math.min(minz, t.p[2]); maxz = Math.max(maxz, t.p[2]); }); });
        const cxm = (minx + maxx) / 2, czm = (minz + maxz) / 2, span = Math.max(maxx - minx, (maxz - minz) * camera.aspect) * 0.75 + 6;
        updateFeather();
        const top = new THREE.OrthographicCamera(-span, span, span / camera.aspect, -span / camera.aspect, 0.1, 500);
        top.position.set(cxm, 120, czm); top.up.set(0, 0, -1); top.lookAt(cxm, 0, czm);
        gl.render(scene, top);
      },
      worldToScreen: function (x, y, z) {
        const v = new THREE.Vector3(x, y, z).project(camera);
        return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H, visible: v.z < 1 };
      },
      three: { scene: scene, camera: camera, renderer: gl },
      drawFrame: function (c2, name, x, y, width) {
        const fr = F[name]; if (!fr) return;
        const sc = width / fr.w;
        c2.drawImage(images[fr.img], fr.x, fr.y, fr.w, fr.h, x - fr.px * sc, y - fr.py * sc, fr.w * sc, fr.h * sc);
      }
    };
  }

  WW.render3d = { createRenderer: createRenderer };
})(globalThis.WW = globalThis.WW || {});
