/* Wishweave Wonders — image loader (docs/ARCHITECTURE.md §9).

   const loader = WW.ui.createLoader(WW.ASSETS);
   loader.run(onProgress)   loads + decodes every WW.ASSETS.images entry that is not loaded yet; each image gets
                            up to 3 automatic attempts. Resolves with the {key: HTMLImageElement} map, or rejects
                            with {failed: [keys]} — calling run() again retries only the missing images.
   onProgress(fraction 0..1, loadedCount, totalCount) — weighted by pixel area so the big plates dominate. */
(function (WW) {
  'use strict';

  const ui = WW.ui = WW.ui || {};
  const ATTEMPTS = 3;
  const TIMEOUT_MS = 30000;

  function loadOnce(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      let done = false;
      const timer = setTimeout(function () { finish(new Error('timeout ' + src)); }, TIMEOUT_MS);
      function finish(err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve(img);
      }
      img.decoding = 'async';
      img.onload = function () {
        // decode() keeps the first frame that draws the image from stalling; a decode failure after a
        // successful load still leaves a drawable image, so it is not fatal.
        if (img.decode) img.decode().then(function () { finish(); }, function () { finish(); });
        else finish();
      };
      img.onerror = function () { finish(new Error('failed ' + src)); };
      img.src = src;
    });
  }

  function createLoader(assets) {
    const specs = (assets && assets.images) || {};
    const keys = Object.keys(specs);
    const images = {};
    const weight = {};
    let total = 0;
    keys.forEach(function (k) {
      const s = specs[k];
      weight[k] = Math.max(1, (s.w || 256) * (s.h || 256));
      total += weight[k];
    });

    function progress() {
      let got = 0, n = 0;
      keys.forEach(function (k) { if (images[k]) { got += weight[k]; n++; } });
      return { fraction: total ? got / total : 1, loaded: n, total: keys.length };
    }

    function loadKey(key, onDone) {
      const file = specs[key].file;
      let attempt = 0;
      function tryLoad() {
        const src = attempt === 0 ? file : file + (file.indexOf('?') < 0 ? '?' : '&') + 'retry=' + Date.now() + '-' + attempt;
        return loadOnce(src).then(function (img) {
          images[key] = img;
          onDone();
          return img;
        }, function (err) {
          attempt++;
          if (attempt < ATTEMPTS) {
            return new Promise(function (r) { setTimeout(r, 250 * attempt); }).then(tryLoad);
          }
          throw err;
        });
      }
      return tryLoad();
    }

    function run(onProgress) {
      const report = function () {
        if (!onProgress) return;
        const p = progress();
        try { onProgress(p.fraction, p.loaded, p.total); } catch (e) { /* UI errors must not break loading */ }
      };
      report();
      const pending = keys.filter(function (k) { return !images[k]; });
      const failed = [];
      return Promise.all(pending.map(function (k) {
        return loadKey(k, report).catch(function () { failed.push(k); });
      })).then(function () {
        report();
        if (failed.length) {
          const err = new Error('Could not load ' + failed.join(', '));
          err.failed = failed;
          throw err;
        }
        return images;
      });
    }

    return { images: images, run: run, progress: progress, keys: keys };
  }

  ui.createLoader = createLoader;
})(globalThis.WW = globalThis.WW || {});
