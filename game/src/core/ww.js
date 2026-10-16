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
    purlSpeed: 5.0,
    purlAccel: 9,                 // m/s² when starting/stopping
    metresPerWidth: 7,            // route metres per racer width of painted path (sets the on-screen pace)
    connectorTime: 1.25,          // seconds to run "around the tower" between two scenes
    minLane: 26,                  // plate px between lanes below which the path is single file
    laneChangeTime: 0.2,
    jumpTime: 0.62,
    jumpAirborneAbove: 0.3,       // jump height fraction that clears Snagling's contact
    inputBufferTime: 0.15,        // swipe-up within this time before landing is replayed

    snagRevealToContact: 0.7,     // visible reveal to possible contact (spec starts at 0.55; tuned for touch)
    snagContactWindow: 0.12,      // contact is tested for this long when the hop lands
    snagTangle: 0.5,              // spec: ankle tangle duration
    hitImmunity: 1.6,             // spec: post-hit damage immunity
    slowAfterHit: 0.6,            // speed multiplier while recovering footing
    slowAfterHitTime: 1.0,
    snagRetreat: 1.1,
    dropAheadM: 3.2,              // a dropped thread lands this many metres ahead of Purl
    dropLandTime: 0.45,           // its arc onto the carpet; it can be recovered once it has landed
    recoveryLoopTime: 2.4,        // local loop that returns Purl to the landing entry
    failDelay: 1.2,

    tasselLift: 0.5,
    tasselStagger: 0.28,
    butterflyEmerge: 0.35,
    butterflyFly: 1.3,
    butterflyPlace: 0.3,
    butterflyExit: 1.2,

    pickupRadiusM: 1.0,           // a thread is collected within this many metres of it
    dropPickupLane: 0.6,          // |lane - dropLane| must be below this to recover a drop

    loopSpeed: 5.0,
    loopSpeedJitter: 0.04,
    loopForm: [0.94, 1.06],       // whole-race pace multiplier, independent of the player
    loopHesitateChance: 0.3,
    loopHesitate: [0.4, 1.0],
    loopHopMissChance: 0.3,
    loopStumble: 0.9,
    loopDropOnStumbleChance: 0.4,
    loopRecover: 1.2,

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
