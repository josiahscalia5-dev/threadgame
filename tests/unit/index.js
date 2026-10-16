/* `node --test tests/unit/` resolves the directory to this file: run every *.test.cjs suite in it. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
fs.readdirSync(__dirname).filter(function (f) { return /\.test\.cjs$/.test(f); }).sort()
  .forEach(function (f) { require(path.join(__dirname, f)); });
