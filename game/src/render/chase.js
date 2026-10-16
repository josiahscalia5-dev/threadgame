/* Wishweave Wonders — 3D renderer: the chase camera.

   Behind and above Purl, aimed a little ahead along his actual route (it crosses the fork/rejoin and runs past the
   finish), smoothed with time-based damping so it swings naturally round bends instead of snapping. It follows his
   ground point, plus only part of a jump, so the horizon does not bob. There is no cut, fade or reset between areas:
   the same camera follows the same continuous road from start to finish.

   Framing (portrait phone, calibrated against kit references 01/02): Purl's feet sit at ~70 % of the screen height
   and he is ~15–20 % of the screen tall. A narrow screen widens the vertical field of view a little so the road
   keeps its width on screen.

     const cam = WW.render.chase.create(THREE, course, landmarks)
     cam.resize(aspect)  cam.snap(purl)  cam.update(purl, dt)  cam.camera (THREE.PerspectiveCamera) */
(function (WW) {
  'use strict';
  const R = WW.render = WW.render || {};

  const CAM = {
    behind: 5.6,         // m behind Purl along his route
    height: 2.6,         // m above his ground point
    lookAhead: 6.5,      // m ahead along the route
    lookHeight: 0.55,    // m above the road at the look point
    jumpFollow: 0.3,     // fraction of a jump the camera follows
    lateralFollow: 0.55, // fraction of Purl's sideways offset the camera follows (keeps the road framed)
    posHalfLife: 0.16,   // s
    lookHalfLife: 0.1,   // s
    vfov: 66,            // degrees at the reference aspect 720/1602
    refAspect: 720 / 1602
  };

  function create(THREE, course, landmarks) {
    const camera = new THREE.PerspectiveCamera(CAM.vfov, CAM.refAspect, 0.1, 900);
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
    let ready = false;

    /* A point d metres along the racer's route (negative = behind), crossing the fork/rejoin and extrapolating
       straight beyond either end of the main road. */
    function along(r, d, lateral) {
      const main = course.main;
      let road = course.road(r.road), s = r.s + d;
      if (road !== main && s < 0) { s = road.startS + s; road = main; }
      if (road !== main && s > road.length) { s = road.endS + (s - road.length); road = main; }
      if (road === main && s < 0) {
        const q = WW.route.sample(main, 0, lateral, null);
        const f = [q.forward[0], 0, q.forward[2]], fl = Math.hypot(f[0], f[2]);
        q.position = q.position.map(function (v, i) { return v + f[i] / fl * s; });
        return q;
      }
      if (road === main && s > main.length) return course.sampleAhead({ road: 'main', s: main.length, lateral: lateral }, s - main.length, lateral);
      return WW.route.sample(road, s, lateral, null);
    }

    function targets(r) {
      const lat = r.lateral * CAM.lateralFollow;
      const behind = along(r, -CAM.behind, lat);
      const ahead = along(r, CAM.lookAhead, lat * 0.6);
      const up = r.jumpY * CAM.jumpFollow;
      wantPos.set(behind.position[0], behind.position[1] + CAM.height + up, behind.position[2]);
      wantLook.set(ahead.position[0], ahead.position[1] + CAM.lookHeight + up, ahead.position[2]);
      // keep the camera out of solid landmarks (it never needs to be inside one on this course; this is a guard)
      for (let i = 0; i < landmarks.length; i++) {
        const l = landmarks[i], dx = wantPos.x - l.position[0], dz = wantPos.z - l.position[2], d = Math.hypot(dx, dz);
        const min = l.radius + 0.6;
        if (d < min && d > 1e-6) { wantPos.x = l.position[0] + dx / d * min; wantPos.z = l.position[2] + dz / d * min; }
      }
    }

    function damp(cur, want, halfLife, dt) {
      const k = 1 - Math.pow(2, -dt / Math.max(halfLife, 1e-4));
      cur.lerp(want, k);
    }

    /* The damping works on the camera's OFFSET from Purl's ground point, not on its absolute position: at a steady
       run along a straight the offset is constant, so the camera never trails further behind as he speeds up
       (no shrinking Purl); bends and side-steps change the offset and are eased in smoothly. */
    const anchor = new THREE.Vector3(), off = new THREE.Vector3(), lookOff = new THREE.Vector3();
    const wantOff = new THREE.Vector3(), wantLookOff = new THREE.Vector3();
    function setAnchor(r) {
      const n = r.normal || [0, 1, 0], j = r.jumpY || 0;
      anchor.set(r.pos[0] - n[0] * j, r.pos[1] - n[1] * j, r.pos[2] - n[2] * j);
    }

    return {
      camera: camera,
      CAM: CAM,
      resize: function (aspect) {
        camera.aspect = aspect;
        // narrower than the reference → a slightly taller field of view so the road keeps its on-screen width
        const k = Math.min(1.25, Math.max(0.85, CAM.refAspect / aspect));
        camera.fov = CAM.vfov * (1 + (k - 1) * 0.6);
        camera.updateProjectionMatrix();
      },
      snap: function (r) {
        targets(r); setAnchor(r);
        off.copy(wantPos).sub(anchor); lookOff.copy(wantLook).sub(anchor);
        ready = true; this.apply();
      },
      update: function (r, dt) {
        targets(r); setAnchor(r);
        wantOff.copy(wantPos).sub(anchor); wantLookOff.copy(wantLook).sub(anchor);
        if (!ready) { off.copy(wantOff); lookOff.copy(wantLookOff); ready = true; }
        else if (dt > 0) { damp(off, wantOff, CAM.posHalfLife, dt); damp(lookOff, wantLookOff, CAM.lookHalfLife, dt); }
        this.apply();
      },
      apply: function () {
        pos.copy(anchor).add(off); look.copy(anchor).add(lookOff);
        camera.position.copy(pos); camera.lookAt(look); camera.updateMatrixWorld();
      },
      reset: function () { ready = false; }
    };
  }

  R.chase = { create: create, CAM: CAM };
})(globalThis.WW = globalThis.WW || {});
