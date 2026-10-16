/* Wishweave Wonders — the 3D renderer (three.js r147, game/vendor/three.min.js, classic script, offline).

   Same public API main.js has always used, now drawing one continuous 3D course:
     const r = WW.render.createRenderer({ canvas, level, debug })
     r.resize(w, h, dpr)          CSS px; device pixel ratio capped for phones
     r.render(state, dtReal)      draws the race state (dtReal 0 while paused: nothing moves, the frame is stable)
     r.handleEvents(events)       pickups, jumps, landings, brake, stumble, finish → effects; pickups fly to the HUD
     r.getTapTargets()            [] (no tap targets on the course in Milestone 1)
     r.getLayout()                {purl:{x,y,w,h}, loop:{…}, camera:{…}} in CSS px (tests, e2e)
     r.worldToScreen([x,y,z])     → {x, y, visible} in CSS px
     r.reset(state)               a new race: camera snaps behind Purl, effects cleared
     r.setDebug(on)               toggles the ground-contact / walkable-geometry view (also ?debug=geom)

   Scene: sky dome + warm fog, hemisphere + sun lighting, the course (render/course.js), Purl and Loop drawn with the
   approved character art (render/racers.js, render/sprites.js) with contact shadows, spools and effects (render/props.js), and the chase camera
   (render/chase.js). A screen-space layer carries pickup fly-ups to the HUD counters.
   WebGL context loss (Android backgrounding, GPU resets) is handled: drawing pauses and resumes on restore. */
(function (WW) {
  'use strict';
  const R = WW.render = WW.render || {};

  function createRenderer(opts) {
    opts = opts || {};
    const THREE = globalThis.THREE;
    if (!THREE) throw new Error('three.js (game/vendor/three.min.js) is missing.');
    const canvas = opts.canvas;
    const level = opts.level || WW.LEVEL;
    const T = WW.TUNING || {};
    let debugGeom = !!opts.debug || /[?&]debug=geom(&|$)/.test((globalThis.location && location.search) || '');

    const gl = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    gl.outputEncoding = THREE.sRGBEncoding;
    gl.toneMapping = THREE.NoToneMapping;          // the approved art keeps its exact colours
    gl.setClearColor(0xffd9c2, 1);

    const scene = new THREE.Scene();
    const FOG = 0xf9d6c4;
    scene.fog = new THREE.Fog(FOG, 55, 320);

    // sky: blue zenith → warm peach horizon, soft sun glow (no fog)
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x5fa8ec) }, mid: { value: new THREE.Color(0xbfdcf7) },
                  horizon: { value: new THREE.Color(FOG) }, sunDir: { value: new THREE.Vector3(-0.35, 0.32, 0.88).normalize() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;' +
        'void main(){ float h = clamp(vDir.y, -1.0, 1.0);' +
        ' vec3 c = h > 0.18 ? mix(mid, top, smoothstep(0.18, 0.75, h)) : mix(horizon, mid, smoothstep(-0.05, 0.18, h));' +
        ' float sun = pow(max(dot(normalize(vDir), sunDir), 0.0), 18.0);' +
        ' c += vec3(1.0, 0.86, 0.6) * sun * 0.55; gl_FragColor = vec4(c, 1.0); }'
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), skyMat);
    sky.renderOrder = -10;
    scene.add(sky);

    scene.add(new THREE.HemisphereLight(0xfff3e4, 0xb4706a, 0.95));
    const sun = new THREE.DirectionalLight(0xfff0d6, 1.55);
    sun.position.set(-30, 55, 70);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffe8e0, 0.12));

    const art = R.sprites.atlas(THREE, opts.images || {}, opts.assets || WW.ASSETS);
    const M = R.materials.create(THREE, { anisotropy: Math.min(8, gl.capabilities.getMaxAnisotropy()), images: opts.images });
    const course = WW.route.createCourse(level.course || WW.ROUTE, { runout: T.finishRunout || 0 });
    const world = R.course.build(THREE, course, M, { debug: debugGeom });
    scene.add(world.group, world.debugGroup);

    const rigs = { purl: R.racers.create(THREE, art, 'purl', M), loop: R.racers.create(THREE, art, 'loop', M) };
    ['purl', 'loop'].forEach(function (k) { scene.add(rigs[k].group, rigs[k].shadow); });
    const props = R.props.create(THREE, M, course, level, art);
    scene.add(props.group);
    const cam = R.chase.create(THREE, course, world.landmarks);

    // debug markers: root contact crosshair + the racer's walkable limit at his position (updated per frame)
    const debugMarks = new THREE.Group(); debugMarks.visible = debugGeom; scene.add(debugMarks);
    function cross(color) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.35, 0, 0), new THREE.Vector3(0.35, 0, 0), new THREE.Vector3(0, 0, -0.35), new THREE.Vector3(0, 0, 0.35),
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.4, 0)]);
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: color, depthTest: false }));
      l.renderOrder = 1000;
      debugMarks.add(l);
      return l;
    }
    const marks = { purl: cross(0x00ff66), loop: cross(0x33aaff) };

    // screen-space layer (pickup fly-ups to the HUD counters)
    const hudScene = new THREE.Scene();
    const hudCam = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
    const flyers = [];

    let W = 1, H = 1, dprUsed = 1, t = 0, lost = false, snapNext = true, lastState = null;
    const layout = { purl: null, loop: null, camera: null };
    const v3 = new THREE.Vector3();

    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); lost = true; }, false);
    canvas.addEventListener('webglcontextrestored', function () {
      lost = false;
      scene.traverse(function (o) {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        mats.forEach(function (m) { m.needsUpdate = true; ['map', 'normalMap'].forEach(function (k) { if (m[k]) m[k].needsUpdate = true; }); });
      });
    }, false);

    function project(p, out) {
      v3.set(p[0], p[1], p[2]).project(cam.camera);
      out = out || {};
      out.x = (v3.x * 0.5 + 0.5) * W; out.y = (-v3.y * 0.5 + 0.5) * H;
      out.visible = v3.z > -1 && v3.z < 1;
      return out;
    }

    function racerBox(r) {
      const top = project([r.pos[0], r.pos[1] + 1.38, r.pos[2]]);
      const feet = project([r.pos[0], r.pos[1], r.pos[2]]);
      const side = project([r.pos[0] + r.right[0] * 0.65, r.pos[1] + 0.8, r.pos[2] + r.right[2] * 0.65]);
      const mid = project([r.pos[0], r.pos[1] + 0.8, r.pos[2]]);
      const w = Math.abs(side.x - mid.x) * 2;
      return { x: feet.x, y: feet.y, w: w, h: feet.y - top.y, top: top.y, visible: feet.visible };
    }

    function hudTarget(who) {
      const el = document.getElementById(who === 'loop' ? 'hud-loop' : 'hud-purl');
      if (!el || !canvas.getBoundingClientRect) return null;
      const a = el.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      return { x: a.left - c.left + a.width * 0.2, y: a.top - c.top + a.height / 2 };
    }

    function flyToHud(who, color, from) {
      const to = hudTarget(who);
      if (!to || !from) return;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: M.textures.spark, color: color, transparent: true, depthTest: false }));
      sp.scale.set(26, 26, 1);
      hudScene.add(sp);
      flyers.push({ s: sp, from: { x: from.x, y: from.y }, to: to, age: 0, life: 0.65 });
    }

    function updateFlyers(dt) {
      for (let i = flyers.length - 1; i >= 0; i--) {
        const f = flyers[i];
        f.age += dt;
        const k = Math.min(1, f.age / f.life), e = k * k * (3 - 2 * k);
        const x = f.from.x + (f.to.x - f.from.x) * e, y = f.from.y + (f.to.y - f.from.y) * e - Math.sin(Math.PI * k) * 60;
        f.s.position.set(x, y, 0);
        const sc = 26 + 18 * Math.sin(Math.PI * k);
        f.s.scale.set(sc, sc, 1);
        f.s.material.opacity = k < 0.85 ? 1 : (1 - k) / 0.15;
        if (k >= 1) { hudScene.remove(f.s); f.s.material.dispose(); flyers.splice(i, 1); }
      }
    }

    const api = {
      three: THREE, scene: scene, course: course, world: world, rigs: rigs, cam: cam,

      resize: function (w, h, dpr) {
        W = Math.max(1, w); H = Math.max(1, h);
        dprUsed = Math.min(dpr || 1, 2);
        gl.setPixelRatio(dprUsed);
        gl.setSize(W, H, false);
        cam.resize(W / H);
        hudCam.left = 0; hudCam.right = W; hudCam.top = 0; hudCam.bottom = H;
        hudCam.updateProjectionMatrix();
      },

      render: function (state, dtReal) {
        if (!state || lost) return;
        lastState = state;
        const dt = state.paused ? 0 : Math.max(0, Math.min(dtReal || 0, 0.25));
        t += dt;
        if (snapNext) { cam.snap(state.purl); snapNext = false; } else cam.update(state.purl, dt);
        const camPos = cam.camera.position;
        ['purl', 'loop'].forEach(function (k) { rigs[k].update(state[k], dt, t, { camPos: camPos }); });
        props.update(state, dt, t, camPos);
        world.update(t, camPos);
        sky.position.copy(cam.camera.position);
        if (debugGeom) {
          ['purl', 'loop'].forEach(function (k) {
            const r = state[k];
            marks[k].position.set(r.pos[0], r.pos[1] - (r.jumpY || 0) + 0.02, r.pos[2]);
            marks[k].rotation.y = r.heading;
          });
        }
        updateFlyers(dt);
        gl.autoClear = true;
        gl.render(scene, cam.camera);
        if (flyers.length) { gl.autoClear = false; gl.clearDepth(); gl.render(hudScene, hudCam); gl.autoClear = true; }
        layout.purl = racerBox(state.purl);
        layout.loop = racerBox(state.loop);
        layout.camera = { x: cam.camera.position.x, y: cam.camera.position.y, z: cam.camera.position.z, fov: cam.camera.fov };
      },

      handleEvents: function (events) {
        if (!Array.isArray(events) || !events.length) return;   // main.js also dispatches race.start()'s mode string
        props.handleEvents(events, lastState);
        events.forEach(function (e) {
          if (e.type === 'pickup' && e.who === 'purl' && lastState) {
            const p = project([lastState.purl.pos[0], lastState.purl.pos[1] + 1, lastState.purl.pos[2]]);
            flyToHud('purl', { coral: 0xff4466, teal: 0x29d6cf, gold: 0xffc94d }[e.color] || 0xffffff, p);
          }
        });
      },

      getTapTargets: function () { return []; },
      getLayout: function () { return { w: W, h: H, dpr: dprUsed, purl: layout.purl, loop: layout.loop, camera: layout.camera }; },
      worldToScreen: function (p) { return project(p); },
      reset: function () { snapNext = true; t = 0; props.reset(); cam.reset(); },
      setDebug: function (on) { debugGeom = !!on; world.debugGroup.visible = debugGeom; debugMarks.visible = debugGeom; },
      info: function () { return { calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures }; },
      dispose: function () {
        world.dispose(); props.dispose(); rigs.purl.dispose(); rigs.loop.dispose(); M.dispose(); art.dispose(); gl.dispose();
      }
    };
    return api;
  }

  R.createRenderer = createRenderer;
})(globalThis.WW = globalThis.WW || {});
