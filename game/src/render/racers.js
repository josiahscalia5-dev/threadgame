/* Wishweave Wonders — 3D renderer: Purl and Loop (crochet rigs + distance-driven locomotion).

   Identities fixed by the kit: Purl = coral/red yarn ball with ONE curled tuft; Loop = teal yarn ball with TWO loop
   ears. Both: round crochet body, stubby arms, short legs, feet with brown crochet soles. ~1.35 m tall, ~1.3 m wide
   (arms included) on the 6 m road — matching their size against the road in references 01/02.

   Rig: root (feet on the road top, yaw = route heading + steering) → body pivot (bob, lean, sway, breathing) → body,
   face, tuft/ears, shoulder pivots → arms; hip pivots → legs → feet (simple two-point leg: hip → foot target, the
   crochet leg stretches a little like yarn does).

   Locomotion is driven by the simulation's gait phase, which advances with DISTANCE travelled (kit advanceRun):
     per leg p ∈ [0,1): stance p < DUTY — the foot is planted and slides back under the body exactly as far as the
     body moves forward (no skating); swing — it lifts, kicks back and reaches forward to land. Both feet are off the
     ground between stances (a real run's flight phase). Body lowest at mid-stance, highest mid-flight; arms oppose
     legs; forward lean grows with speed; a quick lean back while braking. Stopped → the gait amplitude blends to
     zero and an idle breathing pose takes over (no jogging in place). Jump: launch stretch, tucked air pose, landing
     squash. Stumble (Loop's mistake): pitch forward and flail. Finished: arms up wave.

     const rig = WW.render.racers.create(THREE, M, 'purl'|'loop')
     rig.group (add to scene), rig.shadow (add to scene), rig.update(racerState, dt, t, extra), rig.dispose() */
(function (WW) {
  'use strict';
  const R = WW.render = WW.render || {};

  const DIM = {
    bodyR: 0.5, bodyY: 0.86,       // body sphere radius / centre height above the feet
    hipY: 0.38, hipX: 0.2,         // hip pivots
    leg: 0.3,                      // hip → ankle
    shoulderY: 0.98, shoulderX: 0.47,
    stance: 0.22                   // half of the stance sweep (m): front contact +0.22 → push-off -0.22
  };
  const DUTY = 0.3;                // fraction of each leg's cycle on the ground (rest = swing; overlap = flight)

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  function create(THREE, M, who) {
    const isPurl = who === 'purl';
    const yarn = isPurl ? M.purlYarn : M.loopYarn;
    const yarnDark = isPurl ? M.purlYarnDark : M.loopYarnDark;
    const owned = [];
    function mesh(geo, mat) { owned.push(geo); return new THREE.Mesh(geo, mat); }

    const group = new THREE.Group(); group.name = who;
    const pivot = new THREE.Group(); pivot.position.y = DIM.hipY; group.add(pivot);

    const body = mesh(new THREE.SphereGeometry(DIM.bodyR, 36, 26), yarn);
    body.scale.set(1, 0.97, 0.95);
    body.position.y = DIM.bodyY - DIM.hipY;
    pivot.add(body);

    // face (front = +z): eyes with highlights, rosy cheeks, a small smile
    const face = new THREE.Group(); face.position.copy(body.position); pivot.add(face);
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }); owned.push(white);
    const cheekMat = new THREE.MeshStandardMaterial({ color: isPurl ? 0xff8fa0 : 0x7fe0d8, roughness: 0.9 }); owned.push(cheekMat);
    [-1, 1].forEach(function (s) {
      const eye = mesh(new THREE.SphereGeometry(0.075, 14, 10), M.eye);
      eye.position.set(s * 0.17, 0.08, 0.44); eye.scale.set(0.85, 1.1, 0.6); face.add(eye);
      const hl = mesh(new THREE.SphereGeometry(0.022, 8, 6), white);
      hl.position.set(s * 0.17 + 0.02, 0.12, 0.49); face.add(hl);
      const ck = mesh(new THREE.SphereGeometry(0.07, 10, 8), cheekMat);
      ck.position.set(s * 0.29, -0.06, 0.39); ck.scale.set(1, 0.6, 0.4); face.add(ck);
    });
    const smile = mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), M.eye);
    smile.position.set(0, -0.06, 0.47); smile.rotation.z = Math.PI; face.add(smile);

    // tuft (Purl: one curl) / ears (Loop: two loops)
    const top = new THREE.Group(); top.position.set(0, body.position.y + DIM.bodyR * 0.93, -0.02); pivot.add(top);
    if (isPurl) {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40, a = t * Math.PI * 1.75, r = 0.16 * (1 - t * 0.55);
        pts.push(new THREE.Vector3(Math.sin(a) * r * 0.25, 0.05 + Math.sin(a) * r + t * 0.14, -Math.cos(a) * r + r));
      }
      const tuft = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.052, 10, false), yarnDark);
      top.add(tuft);
      const knob = mesh(new THREE.SphereGeometry(0.06, 10, 8), yarnDark); knob.position.copy(pts[pts.length - 1]); top.add(knob);
    } else {
      [-1, 1].forEach(function (s) {
        const ear = mesh(new THREE.TorusGeometry(0.13, 0.05, 10, 24), yarnDark);
        ear.position.set(s * 0.2, 0.1, 0); ear.rotation.set(0, Math.PI / 2 + s * 0.35, s * 0.3);
        top.add(ear);
      });
    }

    // arms
    const arms = [-1, 1].map(function (s) {
      const sh = new THREE.Group(); sh.position.set(s * DIM.shoulderX, DIM.shoulderY - DIM.hipY - 0.22, 0);
      const arm = mesh(new THREE.SphereGeometry(0.14, 16, 12), yarn);
      arm.scale.set(0.95, 1.15, 0.95); arm.position.set(s * 0.06, -0.08, 0);
      sh.add(arm);
      pivot.add(sh);
      return sh;
    });

    // legs + feet (in the group, not the pivot: feet must stay on the ground while the body bobs)
    const legs = [-1, 1].map(function (s) {
      const hip = new THREE.Group(); hip.position.set(s * DIM.hipX, DIM.hipY, 0); group.add(hip);
      const leg = mesh(new THREE.CylinderGeometry(0.105, 0.095, 1, 12), yarnDark);
      leg.geometry.translate(0, -0.5, 0);
      hip.add(leg);
      const foot = new THREE.Group(); group.add(foot);
      const top = mesh(new THREE.SphereGeometry(0.15, 14, 10), yarn);
      top.scale.set(0.95, 0.62, 1.3); top.position.set(0, 0.075, 0.03); foot.add(top);
      const sole = mesh(new THREE.CylinderGeometry(0.135, 0.14, 0.05, 16), M.sole);
      sole.scale.set(0.95, 1, 1.32); sole.position.set(0, 0.026, 0.03); foot.add(sole);
      return { side: s, hip: hip, leg: leg, foot: foot };
    });

    // contact shadow on the road (added to the scene by the renderer, not to the rig)
    const shadowMat = new THREE.MeshBasicMaterial({ map: M.textures.shadow, transparent: true, depthWrite: false,
                                                    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    owned.push(shadowMat);
    const shadow = mesh(new THREE.PlaneGeometry(1.35, 1.2), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 2;

    const st = { yaw: null, landT: 10, prevAir: false, prevSpeed: 0, w: 0, lean: 0, wave: 0, t: 0, latV: 0 };

    /* Foot target for a leg at phase p (0..1, 0 = touch-down in front), scaled by gait weight w. */
    function footTarget(p, w) {
      if (p < DUTY) {
        const k = p / DUTY;
        return { z: (DIM.stance - 2 * DIM.stance * k) * w, y: 0, pitch: 0 };
      }
      const k = (p - DUTY) / (1 - DUTY);
      const z = (-DIM.stance + 2 * DIM.stance * smooth(k)) * w;
      const lift = Math.sin(Math.PI * k) * 0.2 * w;
      const kick = Math.sin(Math.PI * clamp(k * 1.6, 0, 1)) * 0.07 * w;   // heel kicks back early in the swing
      return { z: z - kick, y: lift, pitch: (-0.9 * Math.sin(Math.PI * k) + 0.25 * Math.sin(2 * Math.PI * k)) * w };
    }

    function placeLeg(L, foot, extraY) {
      const hx = L.hip.position.x, hy = L.hip.position.y, hz = L.hip.position.z;
      const fx = hx, fy = foot.y + 0.1 + extraY, fz = foot.z;      // ankle point
      const dy = hy - fy, dz = fz - hz;
      const len = Math.max(0.12, Math.hypot(dy, dz));
      L.hip.rotation.set(Math.atan2(dz, dy) * -1 * -1, 0, 0);
      L.hip.rotation.x = -Math.atan2(dz, dy);
      L.leg.scale.set(1, len, 1);
      L.leg.rotation.x = Math.PI;                                 // cylinder hangs from the hip down to the ankle
      L.leg.rotation.x = 0;
      L.foot.position.set(fx, foot.y + extraY, fz);
      L.foot.rotation.set(foot.pitch, 0, 0);
      return len;
    }

    function update(r, dt, t, extra) {
      extra = extra || {};
      st.t = t;
      const runSpeed = extra.runSpeed || 5.5;
      // root on the road top (+ jump), facing the route heading turned slightly toward sideways motion
      group.position.set(r.pos[0], r.pos[1], r.pos[2]);
      const latV = r.latV || 0;
      const steerYaw = Math.atan2(-latV, Math.max(1.2, r.speed)) * 0.85;
      const yaw = r.heading + steerYaw;
      if (st.yaw === null || dt <= 0) st.yaw = yaw;
      else st.yaw += (yaw - st.yaw) * (1 - Math.pow(2, -dt / 0.06));
      group.rotation.set(0, st.yaw, 0);

      // gait weight: blends run ↔ idle with speed (no jogging in place)
      const w = clamp(r.speed / 1.6, 0, 1);
      st.w = w;
      const air = !!r.airborne;
      if (st.prevAir && !air) st.landT = 0;
      st.prevAir = air;
      st.landT += dt;
      const decel = dt > 0 ? (st.prevSpeed - r.speed) / dt : 0;
      st.prevSpeed = r.speed;

      const phase = r.gait || 0;
      let bob = 0, sway = 0, twist = 0;
      if (!air) {
        legs.forEach(function (L) {
          const p = (phase + (L.side < 0 ? 0 : 0.5)) % 1;
          const ft = footTarget(p, w);
          // idle stance: feet a little apart
          ft.z = ft.z; ft.pitch = ft.pitch;
          placeLeg(L, ft, 0);
        });
        bob = -0.05 * Math.cos(4 * Math.PI * (phase - DUTY / 2)) * w;
        sway = 0.06 * Math.sin(2 * Math.PI * phase) * w;
        twist = 0.1 * Math.sin(2 * Math.PI * phase) * w;
      } else {
        // tucked jump pose: knees up, feet under the body
        const k = Math.sin(Math.PI * clamp(r.jumpT / 0.68, 0, 1));
        legs.forEach(function (L) {
          placeLeg(L, { z: 0.08 * L.side * 0 + 0.06, y: 0.12 * k + 0.02, pitch: -0.35 * k }, 0);
        });
      }

      // body: bob, lean, sway, breathing, squash & stretch
      const breathe = (1 - w) * 0.018 * Math.sin(t * 2 * Math.PI / 2.4);
      let leanTarget = 0.16 * (r.speed / runSpeed);
      if (r.braked && r.speed > 0.05) leanTarget = -0.22;                       // lean back into the brake
      if (r.action === 'stumble') leanTarget = 0.55 + 0.12 * Math.sin(t * 22);
      st.lean += (leanTarget - st.lean) * (1 - Math.pow(2, -Math.max(dt, 0) / 0.07));
      let sy = 1 + breathe, sxz = 1 - breathe * 0.5;
      if (air) { const k = clamp(r.jumpT / 0.12, 0, 1); sy *= 1 + 0.08 * (1 - k); sxz *= 1 - 0.04 * (1 - k); }
      if (st.landT < 0.16) { const k = Math.sin(Math.PI * st.landT / 0.16); sy *= 1 - 0.12 * k; sxz *= 1 + 0.07 * k; }
      pivot.position.y = DIM.hipY + bob;
      pivot.rotation.set(st.lean, twist, sway);
      pivot.scale.set(sxz, sy, sxz);

      // arms oppose the legs; up in the air, flailing when stumbling, waving at the finish
      const swing = Math.sin(2 * Math.PI * phase) * 0.9 * w;
      const finished = r.action === 'finished' && r.speed < 0.3;
      st.wave = finished ? Math.min(1, st.wave + dt * 2) : Math.max(0, st.wave - dt * 3);
      arms.forEach(function (sh, i) {
        const s = i === 0 ? -1 : 1;
        let rx = (s < 0 ? swing : -swing), rz = s * (0.15 + 0.08 * w);
        if (air) { rx = -0.4; rz = s * 1.0; }
        if (r.action === 'stumble') { rx = Math.sin(t * 18 + s) * 1.2; rz = s * 1.3; }
        if (st.wave > 0) { rz = rz * (1 - st.wave) + s * (2.3 + 0.25 * Math.sin(t * 9 + s)) * st.wave; rx *= 1 - st.wave; }
        if (!air && w < 0.05 && st.wave === 0) rz += s * 0.05 * Math.sin(t * 2.6);   // idle sway
        sh.rotation.set(rx, 0, rz);
      });
      // tuft / ears lag the bob and lean (secondary motion)
      top.rotation.set(-st.lean * 0.6 - bob * 3 + (air ? -0.3 : 0), 0, -sway * 1.5);

      // contact shadow on the road top under the feet, fading with height
      const gy = r.pos[1] - (r.jumpY || 0) * (r.normal ? r.normal[1] : 1);
      shadow.position.set(r.pos[0], gy + 0.015, r.pos[2]);
      shadow.rotation.set(-Math.PI / 2, 0, st.yaw);
      const h = r.jumpY || 0;
      shadow.scale.setScalar(1 - h * 0.3);
      shadowMat.opacity = 0.85 - h * 0.45;
    }

    return {
      group: group, shadow: shadow, update: update, DIM: DIM,
      dispose: function () { owned.forEach(function (o) { if (o && o.dispose) o.dispose(); }); },
      state: st
    };
  }

  R.racers = { create: create, DIM: DIM, DUTY: DUTY };
})(globalThis.WW = globalThis.WW || {});
