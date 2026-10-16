/* Wishweave Wonders — shared namespace, tuning values and small utilities.
   Loaded first. Every game script attaches to globalThis.WW so the same files
   run in the browser, the Android WebView and Node unit tests. */
(function (WW) {
  'use strict';

  WW.VERSION = '1.0.0';
  WW.DESIGN = { w: 841, h: 1870 };
  WW.PLATES = WW.PLATES || {};

  /* Gameplay timing in seconds and speeds in metres/second. The values marked
     "spec" come from docs/LEVEL1-GAMEPLAY-SPEC.md; the rest are tuning targets
     checked by tests/unit and tests/e2e. */
  WW.TUNING = {
    countdown: 3,

    /* Connected course (metres, seconds). Character scale: Purl/Loop are ~2.0 m tall, ~2.0 m wide (render/racers.js,
       matching their size against the carpet in the approved screens);
       speed, stride and the chase camera (render/chase.js) are calibrated together against recordings. */
    purlSpeed: 5.5,               // m/s auto-run
    accelTime: 0.35,              // s from standstill to run speed (kit advanceRun accelerationTime)
    brakeTime: 0.22,              // s from run speed to standstill (kit: 0.18–0.25)
    strideLength: 1.75,           // m per full gait cycle (two steps)
    bodyRadius: 0.95,             // m of body/rail clearance inside the walkable width (half a racer's width)
    laneStep: 2.0,                // m per steering swipe (one racer's width: left · centre · right)
    steerSpeed: 5.6,              // m/s max sideways speed while changing line (a side-step, never a pop)
    steerAccel: 36,               // m/s² sideways acceleration
    steerGain: 10,                // 1/s: sideways speed eases off in proportion to the remaining distance
    jumpHeight: 1.2,              // m
    sideLoopBoost: 1.45,          // speed ribbon on the side loop: 19.5 m at ×1.45 beats 16.0 m of main by ~0.45 s
    branchWindow: 12,             // m before the fork in which the side loop is announced
    branchLock: 1.5,              // m before the fork: a runner in the left lane is committed to the side loop
    pickupReach: 1.5,             // m lateral reach to a thread spool as it is passed
    respawnAhead: 18,             // m: a missed thread is offered again this far ahead
    finishRunout: 10,             // m of plaza beyond the flower-gate finish line (runners slow to a stop there)

    purlAccel: 9,                 // (plate-era value, kept for the Snagling/stitch modules re-integrated after review)
    laneChangeTime: 0.22,
    jumpTime: 0.68,
    jumpAirborneAbove: 0.3,       // jump height fraction that clears Snagling's contact
    inputBufferTime: 0.15,        // swipe-up within this time before landing is replayed

    snagRevealToContact: 0.55,    // spec: visible reveal to possible contact
    snagContactWindow: 0.10,      // contact is tested for this long after the hop lands
    snagTangle: 0.5,              // spec: ankle tangle duration
    hitImmunity: 1.6,             // spec: post-hit damage immunity
    slowAfterHit: 0.6,            // speed multiplier while recovering footing
    slowAfterHitTime: 1.2,
    snagRetreat: 1.4,
    dropAheadF: 0.10,             // dropped thread lands this far ahead (path fraction)
    dropSpacingF: 0.07,
    recoveryLoopTime: 2.6,        // local loop that returns Purl to the landing entry
    failDelay: 1.2,

    ribbonUnfurl: 1.3,
    shortcutUnroll: 1.5,
    tasselLift: 0.45,
    tasselStagger: 0.3,
    butterflyEmerge: 0.7,
    butterflyFly: 1.7,
    butterflyPlace: 0.45,
    routeSettle: 0.25,            // pause after an opening completes before Purl moves

    pickupRadiusF: 0.035,         // path-fraction tolerance for collecting a thread
    dropPickupLane: 0.6,          // |lane - dropLane| must be below this to recover a drop
    cueRepeatAfter: 4,

    loopSpeed: 5.5,
    loopSpeedJitter: 0.04,        // per course section
    loopBranchChance: 0.5,        // chance Loop takes the side loop
    loopStumbleChance: 0.5,       // chance of one visible stumble somewhere in the race
    loopStumbleSpeed: 0.3,        // speed multiplier while stumbling (loopStumble s)
    loopLine: [0.6, 1.9],         // his preferred lateral line (right half; he starts right of Purl), rolled per race
    loopReact: [0.45, 1.3],
    loopHesitateChance: 0.22,
    loopHesitate: [0.5, 1.2],
    loopHopMissChance: 0.3,
    loopStumble: 0.9,
    loopDropOnStumbleChance: 0.35,
    loopRecover: 1.4,

    finishWaitForLoop: 25
  };

  /* Deterministic PRNG (mulberry32). Only the race simulation consumes it. */
  WW.rng = function (seed) {
    let a = (seed >>> 0) || 1;
    const next = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next: next,
      range: function (lo, hi) { return lo + (hi - lo) * next(); },
      chance: function (p) { return next() < p; },
      pick: function (list) { return list[Math.floor(next() * list.length)]; }
    };
  };

  WW.util = {
    clamp: function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    smooth: function (t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); },
    easeOutBack: function (t) { const c = 1.70158; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; },
    approach: function (value, target, maxDelta) {
      return value < target ? Math.min(value + maxDelta, target) : Math.max(value - maxDelta, target);
    },
    /* Critically damped follow, frame-rate independent. */
    damp: function (value, target, halfLife, dt) {
      return target + (value - target) * Math.pow(2, -dt / Math.max(halfLife, 1e-4));
    }
  };
})(globalThis.WW = globalThis.WW || {});
