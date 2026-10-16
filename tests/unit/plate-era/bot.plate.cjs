#!/usr/bin/env node
/* Headless bot: plays a full Level 1 race with the shipped data and prints a timeline.

     node tests/unit/bot.cjs [--seed=N] [--react=S] [--profile=competent|first] [--quiet]
     node tests/unit/bot.cjs --sweep=N [--profile=...]      # seeds 1..N, finish times and win share

   Profiles (options can override any field, e.g. --react=1.5 --dodge=lane --dodgeDelay=0.4):
     competent  taps each stitch `react` = 1.0 s after its cue appears (stitch state 'ready'; the opening ribbon is
                pulled instead, once Purl stands at it, and that reaction time is outside the race clock); dodges Snagling
                with a jump (`dodge`: 'jump' | 'lane') started `dodgeDelay` = 0.3 s after the reveal
     first      react 2.0 s; does not react to Snagling (one hit), then steers into the dropped thread's lane
                `steerDelay` = 0.4 s after the drop and recovers it on the same pass
     none       like competent but never swipes (for rule tests)
   Timeline rows: race clock, racer, event. */
'use strict';
const { load, newRace } = require('./load.cjs');
const { activate } = require('./helpers.cjs');

const PROFILES = {
  competent: { react: 1.0, snag: 'dodge', dodge: 'jump', dodgeDelay: 0.3, steerDelay: 0.4 },
  first: { react: 2.0, snag: 'hit', dodge: 'jump', dodgeDelay: 0.3, steerDelay: 0.4 },
  none: { react: 1.0, snag: 'ignore', dodge: 'jump', dodgeDelay: 0.3, steerDelay: 0.4 }
};

function runBot(opts) {
  opts = opts || {};
  const prof = Object.assign({}, PROFILES[opts.profile || 'competent'], opts);
  const WW = opts.WW || load();
  const race = newRace(WW, opts.seed == null ? 1 : opts.seed, opts.tuning);
  const st = race.state;
  const dt = 1 / 60;
  const timeline = [];
  const readyAt = {};
  const add = function (who, what) { timeline.push({ t: st.time, who: who, what: what }); };
  const held = { purl: 0, loop: 0 };   // counted from the events so a row shows the count at that moment
  const log = function (evs) {
    evs.forEach(function (e) {
      const owner = e.item ? e.item.split('.')[0] : null;
      if (e.type === 'pickup' || e.type === 'recover' || e.type === 'loop-recover') held[owner] += 1;
      if (e.type === 'drop' || e.type === 'loop-drop') held[owner] -= 1;
      switch (e.type) {
        case 'go': add('race', 'GO'); break;
        case 'segment': add(e.who, 'enter ' + e.segId); break;
        case 'stitch-tap': add('purl', 'tap ' + e.id); break;
        case 'stitch-open': add('purl', 'open ' + e.id + ' (held ' + held.purl + '/3)'); break;
        case 'pickup': add(owner, 'pickup ' + e.item + ' → ' + held[owner] + '/3'); break;
        case 'drop': add('purl', 'drop ' + e.item); break;
        case 'recover': add('purl', 'recover ' + e.item); break;
        case 'reveal': add('snag', 'reveal'); break;
        case 'hit': add('snag', 'hit'); break;
        case 'dodge': add('snag', 'dodge'); break;
        case 'fail': add('purl', 'FAIL'); break;
        case 'loop-task': add('loop', 'task ' + e.kind); break;
        case 'loop-stumble': add('loop', 'stumble'); break;
        case 'loop-drop': add('loop', 'drop ' + e.item); break;
        case 'loop-recover': add('loop', 'recover ' + e.item); break;
        case 'gate-blocked': add('purl', 'gate blocked'); break;
        case 'finish': timeline.push({ t: e.time, who: e.who, what: 'FINISH ' + e.time.toFixed(2) + ' s' }); break;
        default: break;
      }
    });
  };
  race.start();
  const policy = opts.policy || null;   // optional hook(race, events, bot) for rule tests
  const p = st.purl;
  const todo = [];                      // scheduled reactions {at, fn}
  let steerLane = null;
  const swipe = function (dir) { log(race.input({ type: 'swipe', dir: dir })); };
  const react = function (evs) {
    evs.forEach(function (e) {
      if (e.type === 'reveal' && prof.snag === 'dodge') {
        todo.push({ at: st.time + prof.dodgeDelay, fn: function () {
          if (prof.dodge === 'lane') swipe(p.lane >= 1 ? 'left' : 'right');
          else swipe('up');
          add('purl', 'dodge by ' + prof.dodge);
        } });
      }
      if (e.type === 'drop' && prof.snag !== 'ignore') {
        todo.push({ at: st.time + prof.steerDelay, fn: function () { steerLane = e.lane; add('purl', 'steer to lane ' + e.lane); } });
      }
      if (e.type === 'recover') steerLane = null;
    });
  };
  const maxSteps = Math.round((opts.maxTime || 400) / dt);
  let clock = 0;                        // the player's own clock: reactions take real time even while the
                                        // first-lesson tutorial hold freezes the race clock
  for (let i = 0; i < maxSteps; i++) {
    const evs = race.step(dt);
    clock += dt;
    log(evs);
    react(evs);
    for (let k = todo.length - 1; k >= 0; k--) {
      if (st.time >= todo[k].at - 1e-9) { const job = todo[k]; todo.splice(k, 1); job.fn(); }
    }
    if (steerLane !== null && p.lane !== steerLane) swipe(p.lane < steerLane ? 'right' : 'left');
    Object.keys(st.stitches).forEach(function (id) {
      const s = st.stitches[id];
      const cue = s.state === 'ready' && (s.interaction !== 'pull' || p.waitingFor === id);
      if (cue && readyAt[id] === undefined) { readyAt[id] = clock; add('purl', 'cue ' + id); }
      if (cue && clock >= readyAt[id] + prof.react - 1e-9) log(activate(race, id));
    });
    if (policy) log(policy(race, evs, { prof: prof, add: add }) || []);
    if (st.mode === 'failed') break;
    if (st.mode === 'finished' && !st.result.loopStillRacing) break;
  }
  return {
    seed: opts.seed == null ? 1 : opts.seed, profile: opts.profile || 'competent', react: prof.react,
    timeline: timeline, result: st.result, mode: st.mode, held: Object.assign({}, st.held),
    purlTime: st.purl.finishTime, loopTime: st.loop.finishTime, stats: Object.assign({}, st.stats), race: race
  };
}

function fmt(run) {
  const lines = run.timeline.map(function (r) {
    return ('      ' + r.t.toFixed(2)).slice(-7) + '  ' + (r.who + '     ').slice(0, 5) + ' ' + r.what;
  });
  const r = run.result;
  lines.push('result: ' + (r ? 'Purl ' + r.purlTime.toFixed(2) + ' s (#' + r.purlRank + '), Loop ' +
    (r.loopTime === null ? 'did not finish' : r.loopTime.toFixed(2) + ' s (#' + r.loopRank + ')') +
    ', winner ' + r.winner : run.mode));
  return lines.join('\n');
}

function sweep(n, opts) {
  const WW = load();
  const rows = [];
  for (let seed = 1; seed <= n; seed++) rows.push(runBot(Object.assign({}, opts, { seed: seed, WW: WW })));
  const wins = rows.filter(function (r) { return r.result && r.result.winner === 'purl'; }).length;
  const avg = function (k) { return rows.reduce(function (a, r) { return a + (r[k] || 0); }, 0) / rows.length; };
  const lt = rows.map(function (r) { return r.loopTime; }).filter(function (x) { return x !== null; });
  return { rows: rows, purlWins: wins, n: n, purlAvg: avg('purlTime'),
           loopMin: Math.min.apply(null, lt), loopMax: Math.max.apply(null, lt), loopAvg: avg('loopTime') };
}

if (require.main === module) {
  const args = {};
  process.argv.slice(2).forEach(function (a) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  });
  const opts = { profile: args.profile || 'competent' };
  ['react', 'dodgeDelay', 'steerDelay'].forEach(function (k) { if (args[k] !== undefined) opts[k] = Number(args[k]); });
  if (args.dodge) opts.dodge = args.dodge;
  if (args.sweep) {
    const s = sweep(Number(args.sweep), opts);
    s.rows.forEach(function (r) {
      console.log('seed ' + String(r.seed).padStart(3) + '  purl ' + (r.purlTime || 0).toFixed(2) + '  loop ' +
        (r.loopTime === null ? '  dnf ' : r.loopTime.toFixed(2)) + '  ' + (r.result ? r.result.winner : r.mode));
    });
    console.log(opts.profile + ': Purl wins ' + s.purlWins + '/' + s.n + ', Purl avg ' + s.purlAvg.toFixed(2) +
      ' s, Loop ' + s.loopMin.toFixed(2) + '–' + s.loopMax.toFixed(2) + ' (avg ' + s.loopAvg.toFixed(2) + ')');
  } else {
    opts.seed = args.seed === undefined ? 1 : Number(args.seed);
    const run = runBot(opts);
    if (!args.quiet) console.log('seed ' + run.seed + ', profile ' + run.profile + ', react ' + run.react + ' s');
    console.log(args.quiet ? fmt(run).split('\n').pop() : fmt(run));
  }
}

module.exports = { runBot: runBot, sweep: sweep, fmt: fmt, PROFILES: PROFILES };
