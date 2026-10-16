/* Wishweave Wonders — 3D renderer: Purl and Loop, drawn with the approved character art.

   Each racer is the user's own rear-view sprite frames from the visual kit (purl/loop atlases: idle, run-left,
   run-pass-a, run-right, run-pass-b, jump, duck, stumble), standing on the 3D road at its foot pivot and facing the
   chase camera (which is always behind the runners). Sizes keep the art's own proportions: 1 px of the atlas =
   K metres, so Purl's idle frame is 1.35 m tall on the 6 m road.

   Frame choice follows the simulation:
     running   the four run frames in the art's order (run-left → run-pass-a → run-right → run-pass-b), advanced by
               the gait phase, which the simulation drives by DISTANCE travelled (a faster runner cycles faster, a
               stopped one does not run on the spot);
     stopped   idle, with a gentle breathing scale;
     jump      the jump frame for the whole arc (the sim lifts the root; the contact shadow stays on the road);
     landing   the duck frame for 0.1 s (the squash on touch-down);
     stumble   the stumble frame (Loop's mistake);
     steering  a slight lean into the side-step.

     const rig = WW.render.racers.create(THREE, art, 'purl'|'loop', M)
     rig.group, rig.shadow (add both to the scene), rig.update(racerState, dt, t, {camPos}), rig.dispose() */
(function (WW) {
  'use strict';
  const R = WW.render = WW.render || {};

  const K = 1.35 / 335;           // metres per atlas pixel (Purl's idle frame is 335 px tall → 1.35 m)
  const RUN = ['run-left', 'run-pass-a', 'run-right', 'run-pass-b'];

  function create(THREE, art, who, M) {
    const group = new THREE.Group(); group.name = who;
    const mat = art.material(who, { alphaTest: 0.05 });
    const geos = {};
    ['idle', 'jump', 'duck', 'stumble'].concat(RUN).forEach(function (f) { geos[f] = art.geometry(who + '.' + f, K); });
    const quad = new THREE.Mesh(geos.idle, mat);
    quad.renderOrder = 5;
    group.add(quad);

    const shadowMat = new THREE.MeshBasicMaterial({ map: M.textures.shadow, transparent: true, depthWrite: false, toneMapped: false,
                                                    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.9), shadowMat);
    shadow.renderOrder = 2;
    const st = { landT: 10, prevAir: false, lean: 0, frame: 'idle' };

    function pick(r) {
      if (r.airborne) return 'jump';
      if (st.landT < 0.1) return 'duck';
      if (r.action === 'stumble') return 'stumble';
      if (r.speed > 0.3) return RUN[Math.floor(((r.gait || 0) % 1) * 4) % 4];
      return 'idle';
    }

    function update(r, dt, t, extra) {
      const cam = extra && extra.camPos;
      if (st.prevAir && !r.airborne) st.landT = 0;
      st.prevAir = !!r.airborne;
      st.landT += dt;
      const f = pick(r);
      if (f !== st.frame) { quad.geometry = geos[f]; st.frame = f; }
      group.position.set(r.pos[0], r.pos[1], r.pos[2]);
      if (cam) group.rotation.y = Math.atan2(cam.x - group.position.x, cam.z - group.position.z);
      // lean into a side-step (screen-space roll), breathe when standing
      const leanTarget = -(r.latV || 0) * 0.05;
      st.lean += (leanTarget - st.lean) * (1 - Math.pow(2, -Math.max(dt, 0) / 0.06));
      quad.rotation.z = st.lean;
      const breathe = f === 'idle' ? 0.015 * Math.sin(t * 2 * Math.PI / 2.4) : 0;
      quad.scale.set(1 - breathe * 0.4, 1 + breathe, 1);
      // contact shadow on the road under the feet, smaller and lighter in the air
      const n = r.normal || [0, 1, 0], j = r.jumpY || 0;
      shadow.position.set(r.pos[0] - n[0] * j, r.pos[1] - n[1] * j + 0.02, r.pos[2] - n[2] * j);
      shadow.rotation.set(-Math.PI / 2, 0, -(r.heading || 0));
      shadow.scale.setScalar(1 - j * 0.3);
      shadowMat.opacity = 0.8 - j * 0.45;
    }

    return {
      group: group, shadow: shadow, update: update, state: st, K: K,
      dispose: function () { shadow.geometry.dispose(); shadowMat.dispose(); }
    };
  }

  R.racers = { create: create, K: K, RUN: RUN };
})(globalThis.WW = globalThis.WW || {});
