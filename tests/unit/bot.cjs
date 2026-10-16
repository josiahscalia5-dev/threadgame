/* Loads the game's simulation into Node and plays races with simple scripted players.

     const { load, play } = require('./bot.cjs');
     const WW = load();
     const out = play(WW, seed, 'dodge');   // { result, events, held, state, timeline }

   Strategies:
     dodge   changes lane `react` s after Snagling appears (default 0.3 s)
     jump    jumps `react` s after he appears
     hit     lets him hit, then steers into the dropped thread
     miss    lets him hit, ignores the dropped thread once (recovery loop), then dodges and recovers it
     passive never touches the screen (hit three times on the landing -> gentle fail)
   Run directly for a balance table:  node tests/unit/bot.cjs [races] */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'game', 'src');
const FILES = ['core/ww.js', 'core/path.js', 'data/asset-data.js', 'data/plates/p01.js', 'data/plates/p02.js',
  'data/plates/p03.js', 'data/plates/p04.js', 'data/plates/p06.js', 'data/plates/p07.js', 'data/level.js', 'sim/race.js'];

function load() {
  for (const f of FILES) delete require.cache[require.resolve(path.join(ROOT, f))];
  globalThis.WW = {};
  for (const f of FILES) require(path.join(ROOT, f));
  return globalThis.WW;
}

function play(WW, seed, strategy, opts) {
  opts = opts || {};
  const react = opts.react === undefined ? 0.3 : opts.react;
  const race = WW.sim.createRace({ seed });
  const events = [], timeline = [];
  let ignoredOnce = false, actedPass = 0;
  race.start();
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 180; i++) {
    const s = race.state;
    if (s.mode === 'running') {
      const sn = s.snagling, p = s.purl;
      if (sn.state === 'hop' && sn.t >= react && actedPass !== sn.pass) {
        const dodgeNow = strategy === 'dodge' || strategy === 'jump' || (strategy === 'miss' && ignoredOnce);
        if (dodgeNow) {
          actedPass = sn.pass;
          const cmd = strategy === 'jump' ? { type: 'swipe', dir: 'up' } : { type: 'swipe', dir: p.lane >= 0 ? 'left' : 'right' };
          race.input(cmd).forEach(e => events.push([s.time, e]));
        }
      }
      for (const id in s.items) {
        const it = s.items[id];
        if (it.owner !== 'purl' || it.status !== 'dropped' || s.time < p.tangledUntil) continue;
        const want = strategy === 'hit' || (strategy === 'miss' && ignoredOnce) ||
                     (strategy === 'dodge' || strategy === 'jump');
        if (want && it.lane !== p.lane && s.time > it.dropTime + 0.4) {
          race.input({ type: 'swipe', dir: it.lane > p.lane ? 'right' : 'left' }).forEach(e => events.push([s.time, e]));
        }
      }
      if (p.trans && p.trans.kind === 'loop') ignoredOnce = true;
    }
    const before = { p: s.purl.progress, l: s.loop.progress };
    race.step(dt).forEach(e => events.push([race.state.time, e]));
    timeline.push({ t: race.state.time, p: race.state.purl.progress, l: race.state.loop.progress, lf: race.state.loop.f, lseg: race.state.loop.seg, held: Object.assign({}, race.state.held) });
    if (race.state.mode === 'failed') break;
    if (race.state.result && !race.state.result.loopStillRacing) break;
  }
  return { race, result: race.state.result, events, state: race.state, timeline };
}

module.exports = { load, play };

if (require.main === module) {
  const WW = load();
  const n = +(process.argv[2] || 300);
  const table = {};
  for (const strat of ['dodge', 'jump', 'hit', 'miss', 'passive']) {
    let wins = 0, fails = 0, pt = [], lt = [];
    for (let seed = 1; seed <= n; seed++) {
      const out = play(WW, seed, strat);
      if (!out.result) { fails++; continue; }
      if (out.result.winner === 'purl') wins++;
      pt.push(out.result.purlTime); if (out.result.loopTime !== null) lt.push(out.result.loopTime);
    }
    const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-';
    table[strat] = { purlWins: (100 * wins / n).toFixed(0) + '%', fails, purlAvg: avg(pt), loopAvg: avg(lt),
                     loopRange: lt.length ? Math.min(...lt).toFixed(1) + '-' + Math.max(...lt).toFixed(1) : '-' };
  }
  console.table(table);
}
