/* Wishweave Wonders — overlays (docs/ARCHITECTURE.md §9).

   const ov = WW.ui.createOverlays(els, handlers);
     handlers: { onStart, onResume, onRestart, onRetry, onPlayAgain, onPause, onLoadRetry }
   ov.loading(fraction, text) / ov.loadFailed(text) / ov.loaded()
   ov.drawPortraits(images, assets)   Purl vs Loop portraits (front poses from the atlases) + the fail portrait
   ov.update(state, ctx)              which overlay is visible is a pure function of state:
                                      intro → start, paused → pause (menu or help), failed → fail,
                                      finished → PLAY AGAIN (after ctx.finishedFor ≥ 1 s); pause button otherwise
   ov.modalOpen()                     true while any overlay that owns the screen is visible (blocks game input)
   ov.helpOpen() / ov.closeHelp()
   ov.showError(text)
   The SAVED REWARDS strip is a fixed placeholder: CASH OUT is locked and only shows an explanatory note. */
(function (WW) {
  'use strict';

  const ui = WW.ui = WW.ui || {};
  const PLAY_AGAIN_DELAY = 1.0;

  const PAUSE_TEXT = {
    background: 'Paused while you were away — Loop and Snagling waited too.',
    blur: 'Paused while you were away — Loop and Snagling waited too.',
    back: 'Paused. Press Back again to leave the game.',
    default: 'The race is on hold — Loop and Snagling wait too.'
  };

  /* Draws one atlas frame contain-fitted into a canvas (bottom-aligned, optional mirror). */
  function drawFrame(canvas, images, assets, frameName, opts) {
    if (!canvas || !assets || !assets.frames) return false;
    const fr = assets.frames[frameName];
    const img = fr && images[fr.img];
    if (!img) return false;
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    const pad = opts.pad == null ? 0.04 : opts.pad;
    const s = Math.min(cw * (1 - 2 * pad) / fr.w, ch * (1 - pad) / fr.h);
    const w = fr.w * s, h = fr.h * s;
    const x = (cw - w) / 2, y = ch - h - ch * pad * 0.5;
    ctx.save();
    // soft ground shadow
    ctx.fillStyle = 'rgba(70, 30, 10, 0.22)';
    ctx.beginPath();
    ctx.ellipse(cw / 2, y + h * 0.97, w * 0.34, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    if (opts.mirror) { ctx.translate(cw, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, fr.x, fr.y, fr.w, fr.h, opts.mirror ? cw - x - w : x, y, w, h);
    ctx.restore();
    return true;
  }

  function createOverlays(els, handlers) {
    const dom = ui.dom;
    const H = handlers || {};
    let helpVisible = false;
    let isLoading = true;
    let errorShown = false;
    let noteTimer = null;
    let lastModal = null;

    function on(el, fn) {
      if (el) el.addEventListener('click', function (e) { e.preventDefault(); fn(e); });
    }
    on(els.startBtn, function () { H.onStart && H.onStart(); });
    on(els.pauseBtn, function () { H.onPause && H.onPause(); });
    on(els.resumeBtn, function () { closeHelp(); H.onResume && H.onResume(); });
    on(els.restartBtn, function () { closeHelp(); H.onRestart && H.onRestart(); });
    on(els.helpBtn, function () { helpVisible = true; syncHelp(); focus(els.helpBack); });
    on(els.helpBack, function () { closeHelp(); focus(els.resumeBtn); });
    on(els.retryBtn, function () { H.onRetry && H.onRetry(); });
    on(els.playAgain, function () { H.onPlayAgain && H.onPlayAgain(); });
    on(els.loadRetry, function () { H.onLoadRetry && H.onLoadRetry(); });
    on(els.cashout, showCashNote);

    /* Overlay buttons take focus automatically only for keyboard players; on touch a focus ring would just be noise. */
    let keyboardUser = false;
    window.addEventListener('keydown', function () { keyboardUser = true; }, true);
    window.addEventListener('pointerdown', function () { keyboardUser = false; }, true);

    function focus(el) {
      if (!el || !el.focus || !keyboardUser) return;
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }

    function showCashNote() {
      dom.show(els.cashNote, true);
      if (els.cashNote) dom.restartClass(els.cashNote, 'in');
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () { dom.show(els.cashNote, false); }, 3600);
    }

    function syncHelp() {
      dom.show(els.pauseMenu, !helpVisible);
      dom.show(els.pauseHelp, helpVisible);
    }

    function closeHelp() {
      helpVisible = false;
      syncHelp();
    }

    function loading(fraction, text) {
      isLoading = true;
      dom.show(els.ovLoading, true);
      if (els.loadFill) els.loadFill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
      dom.setText(els.loadText, text != null ? text : 'Unrolling the loom city… ' + Math.round(fraction * 100) + '%');
      dom.show(els.loadRetry, false);
    }

    function loadFailed(text) {
      dom.setText(els.loadText, text || 'Some pictures did not load.');
      dom.show(els.loadRetry, true);
      focus(els.loadRetry);
    }

    function loaded() {
      isLoading = false;
      dom.show(els.ovLoading, false);
      dom.show(els.hud, true);
      dom.show(els.rewards, true);
    }

    function showError(text) {
      errorShown = true;
      dom.setText(els.errorText, text || 'The game hit a problem. Please restart the app.');
      dom.show(els.ovError, true);
    }

    function drawPortraits(images, assets) {
      drawFrame(els.startPurl, images, assets, 'purlFront.f2', { mirror: true });
      drawFrame(els.startLoop, images, assets, 'loopFront.f2');
      drawFrame(els.failPurl, images, assets, 'purlFront.f7');
    }

    /* ctx: { finishedFor } */
    function update(state, ctx) {
      if (isLoading || errorShown || !state) {
        dom.show(els.pauseBtn, false);
        return;
      }
      const mode = state.mode;
      const paused = !!state.paused && mode !== 'intro';
      const showStart = mode === 'intro';
      const showFail = mode === 'failed' && !paused;
      const showPause = paused;
      dom.show(els.ovStart, showStart);
      dom.show(els.ovPause, showPause);
      dom.show(els.ovFail, showFail);
      if (showPause) {
        syncHelp();
        const sub = PAUSE_TEXT[state.pauseReason] || PAUSE_TEXT.default;
        dom.setText(els.pauseSub, sub);
      } else if (helpVisible) {
        closeHelp();
      }
      const finishedFor = (ctx && ctx.finishedFor) || 0;
      dom.show(els.playAgain, mode === 'finished' && !paused && finishedFor >= PLAY_AGAIN_DELAY);
      dom.show(els.pauseBtn, !showStart && !showPause && !showFail);

      const modal = showStart ? 'start' : showPause ? 'pause' : showFail ? 'fail' : null;
      if (modal !== lastModal) {
        lastModal = modal;
        if (modal === 'start') focus(els.startBtn);
        else if (modal === 'pause') focus(helpVisible ? els.helpBack : els.resumeBtn);
        else if (modal === 'fail') focus(els.retryBtn);
        else if (document.activeElement && document.activeElement !== document.body && els.game.contains(document.activeElement)) {
          document.activeElement.blur();
        }
      }
    }

    function modalOpen() {
      return isLoading || errorShown || lastModal != null;
    }

    return {
      loading: loading, loadFailed: loadFailed, loaded: loaded, showError: showError,
      drawPortraits: drawPortraits, update: update, modalOpen: modalOpen,
      helpOpen: function () { return helpVisible && lastModal === 'pause'; }, closeHelp: closeHelp,
      showCashNote: showCashNote
    };
  }

  ui.createOverlays = createOverlays;
  ui.drawFrame = drawFrame;
})(globalThis.WW = globalThis.WW || {});
