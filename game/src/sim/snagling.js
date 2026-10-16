/* Wishweave Wonders — simulation: Snagling on the p04 landing (docs/ARCHITECTURE.md §7.5, §12.2).
   Milestone 1: state shape only (Snagling stays concealed); the attack rules arrive in milestone 2. */
(function (WW) {
  'use strict';
  const sim = WW.sim = WW.sim || {};

  function create() {
    return { state: 'concealed', t: 0, targetLane: 0, contactF: null, result: null, pass: 1, armed: true,
             contactConsumed: false };
  }

  function update() {}

  /* A new pass over the landing (recovery loop / gate return) re-arms Snagling. */
  function rearm(ctx) {
    const s = ctx.state.snagling;
    s.state = 'concealed'; s.t = 0; s.result = null; s.contactF = null; s.contactConsumed = false;
    s.armed = true; s.pass += 1;
  }

  sim.snagling = { create: create, update: update, rearm: rearm };
})(globalThis.WW = globalThis.WW || {});
