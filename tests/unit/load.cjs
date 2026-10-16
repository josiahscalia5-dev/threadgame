/* Loads the game's core, asset data, plates, level and simulation scripts into Node, in game/index.html order.
   Each call gives a fresh WW (the previous globalThis.WW is replaced), so tests cannot leak state into each other. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GAME = path.resolve(__dirname, '../../game');
const FALLBACK = [
  'src/core/ww.js', 'src/core/route.js', 'src/core/gesture.js', 'src/data/route.js', 'src/data/asset-data.js',
  'src/data/level.js', 'src/sim/inventory.js', 'src/sim/loop-ai.js', 'src/sim/race.js'
];
const OLD_FALLBACK = [
  'src/core/ww.js', 'src/core/path.js', 'src/data/asset-data.js',
  'src/data/plates/p01.js', 'src/data/plates/p02.js', 'src/data/plates/p03.js', 'src/data/plates/p04.js',
  'src/data/plates/p06.js', 'src/data/plates/p07.js', 'src/data/level.js',
  'src/sim/inventory.js', 'src/sim/stitches.js', 'src/sim/snagling.js', 'src/sim/loop-ai.js', 'src/sim/race.js'
];

function scriptList() {
  let html = '';
  try { html = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8'); } catch (e) { return FALLBACK; }
  const out = [];
  const re = /<script[^>]*\ssrc="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (/^src\/(core|data|sim)\//.test(m[1])) out.push(m[1]);
  }
  return out.length ? out : FALLBACK;
}

function load() {
  delete globalThis.WW;
  for (const rel of scriptList()) {
    const file = path.join(GAME, rel);
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  }
  return globalThis.WW;
}

/* A race with the shipped data; `tuning` patches WW.TUNING for this race only. */
function newRace(WW, seed, tuning) {
  return WW.sim.createRace({ seed: seed, level: WW.LEVEL, plates: WW.PLATES,
                             tuning: Object.assign({}, WW.TUNING, tuning || {}) });
}

module.exports = { load: load, newRace: newRace, scriptList: scriptList, GAME: GAME };
