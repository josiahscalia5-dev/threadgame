/* Wishweave Wonders — HUD and overlays (WW.ui.createHud).

   Reads the race state every frame and updates the DOM only when something changed: phase pill, PURL n/3 and
   LOOP n/3 (from state.held only), the objective/message pill, the race-progress thread (coral bead = Purl,
   teal bead = Loop), hints, the countdown, and the start / pause / fail / results screens. */
(function (WW) {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };

  function fmtTime(t) {
    if (t === null || t === undefined) return '—';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  function ordinal(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n + 'th'; }

  function createHud(opts) {
    const el = {
      game: $('game'), hud: $('hud'), phase: $('hud-phase'),
      purl: $('hud-purl'), loop: $('hud-loop'),
      purlNum: $('hud-purl').querySelector('b'), loopNum: $('hud-loop').querySelector('b'),
      objective: $('hud-objective'), objectiveTxt: $('hud-objective').querySelector('.txt'),
      thread: $('race-thread'), beadPurl: $('race-thread').querySelector('.bead.purl'), beadLoop: $('race-thread').querySelector('.bead.loop'),
      results: $('hud-results'), ranks: $('result-ranks'), times: $('result-times'), wait: $('result-wait'),
      hint: $('hud-hint'), pause: $('btn-pause'), countdown: $('countdown'), countdownTxt: $('countdown').querySelector('span'),
      again: $('btn-play-again'), rewards: $('rewards'), cashout: $('btn-cashout'), note: $('cashout-note'),
      loading: $('ov-loading'), loadFill: $('load-fill'), loadText: $('load-text'), loadRetry: $('btn-load-retry'),
      start: $('ov-start'), btnStart: $('btn-start'),
      pauseOv: $('ov-pause'), pauseMenu: $('pause-menu'), pauseHelp: $('pause-help'), pauseSub: $('pause-sub'),
      btnResume: $('btn-resume'), btnRestart: $('btn-restart'), btnHelp: $('btn-help'), btnHelpBack: $('btn-help-back'),
      fail: $('ov-fail'), btnRetry: $('btn-retry'), error: $('ov-error'), errorText: $('error-text')
    };
    const cb = opts.callbacks || {};
    const last = {};
    let noteTimer = null;

    function set(key, value, apply) { if (last[key] !== value) { last[key] = value; apply(value); } }
    function show(node, on) { if (node.hidden === !!on) node.hidden = !on; }
    function bump(node, cls) {
      node.classList.remove('up', 'down');
      void node.offsetWidth;          // restart the CSS animation
      node.classList.add(cls);
    }

    // ---------------------------------------------------------------- buttons
    function tapButton(node, fn) {
      node.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
      ['pointerdown', 'pointerup'].forEach(function (t) { node.addEventListener(t, function (e) { e.stopPropagation(); }); });
    }
    tapButton(el.btnStart, function () { cb.start && cb.start(); });
    tapButton(el.pause, function () { cb.pause && cb.pause('user'); });
    tapButton(el.btnResume, function () { cb.resume && cb.resume(); });
    tapButton(el.btnRestart, function () { cb.restart && cb.restart(); });
    tapButton(el.btnHelp, function () { show(el.pauseMenu, false); show(el.pauseHelp, true); });
    tapButton(el.btnHelpBack, function () { show(el.pauseHelp, false); show(el.pauseMenu, true); });
    tapButton(el.btnRetry, function () { cb.restart && cb.restart(); });
    tapButton(el.again, function () { cb.restart && cb.restart(); });
    tapButton(el.loadRetry, function () { cb.retryLoad && cb.retryLoad(); });
    tapButton(el.cashout, function () {
      show(el.note, true);
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () { show(el.note, false); }, 3200);
    });
    // Overlays swallow pointer input so a tap on a menu never reaches the race.
    [el.start, el.pauseOv, el.fail, el.loading, el.error].forEach(function (ov) {
      ['pointerdown', 'pointerup', 'pointermove'].forEach(function (t) { ov.addEventListener(t, function (e) { e.stopPropagation(); }); });
    });

    // ---------------------------------------------------------------- loading / errors
    function loading(fraction, text) {
      show(el.loading, true);
      el.loadFill.style.width = Math.round(fraction * 100) + '%';
      el.loadText.textContent = text || ('Unrolling the loom city… ' + Math.round(fraction * 100) + '%');
    }
    function loadFailed(message) {
      el.loadText.textContent = message;
      show(el.loadRetry, true);
    }
    function error(message) { el.errorText.textContent = message; show(el.error, true); }

    // ---------------------------------------------------------------- per-frame update
    function update(state, screen) {
      const mode = state.mode;
      show(el.loading, false);
      const playing = mode === 'countdown' || mode === 'running' || mode === 'finished';
      show(el.hud, mode !== 'intro');
      show(el.rewards, mode !== 'intro');
      show(el.start, mode === 'intro');
      show(el.pause, (mode === 'countdown' || mode === 'running') && !state.paused);
      show(el.pauseOv, state.paused && playing);
      show(el.fail, mode === 'failed');

      set('phase', state.phase, function (v) { el.phase.textContent = v; });
      set('purl', state.held.purl, function (v) {
        const before = last.purlShown;
        el.purlNum.textContent = v;
        if (before !== undefined) bump(el.purl, v > before ? 'up' : 'down');
        last.purlShown = v;
      });
      set('loop', state.held.loop, function (v) {
        const before = last.loopShown;
        el.loopNum.textContent = v;
        if (before !== undefined) bump(el.loop, v > before ? 'up' : 'down');
        last.loopShown = v;
      });

      // Objective pill shows the current goal, or a short message (SNAGGED!, THREAD RECOVERED, ...).
      const msg = state.message;
      const text = msg ? msg.text : state.objective;
      set('objective', text + '|' + (msg ? msg.kind : ''), function () {
        el.objectiveTxt.textContent = text;
        el.objective.classList.toggle('is-message', !!msg);
        el.objective.classList.toggle('kind-hit', !!msg && msg.kind === 'hit');
      });

      // Race thread: bead positions from each racer's share of his own route.
      const w = el.thread.clientWidth || 200;
      set('bp', Math.round(state.purl.progress * w), function (v) { el.beadPurl.style.transform = 'translateX(' + v + 'px)'; });
      set('bl', Math.round(state.loop.progress * w), function (v) { el.beadLoop.style.transform = 'translateX(' + v + 'px)'; });

      const hint = state.hint && mode === 'running' ? state.hint.text : '';
      set('hint', hint, function (v) {
        show(el.hint, !!v);
        el.hint.textContent = v;
        el.hint.classList.toggle('kind-urgent', /thread/i.test(v));
      });

      // Countdown 3-2-1-GO (GO lingers for a moment after the race starts).
      let cd = '';
      if (mode === 'countdown') cd = String(Math.max(1, Math.ceil(state.countdown)));
      else if (mode === 'running' && state.time < 0.7) cd = 'GO!';
      set('cd', cd, function (v) {
        show(el.countdown, !!v);
        el.countdown.classList.toggle('go', v === 'GO!');
        el.countdownTxt.textContent = v;
        // restart the pop animation for each number
        el.countdownTxt.style.animation = 'none'; void el.countdownTxt.offsetWidth; el.countdownTxt.style.animation = '';
      });

      // Results (approved 07): LEVEL 1 COMPLETE, the real ranks and times, Loop still racing, PLAY AGAIN.
      const r = state.result;
      show(el.results, !!r);
      show(el.thread, !r);
      show(el.objective, !r);
      show(el.again, !!r && state.time - state.purl.finishTime > 1.2);
      if (r) {
        const ranks = r.loopStillRacing
          ? '<span class="p">' + ordinal(r.purlRank) + ' PURL</span>'
          : (r.purlRank === 1
            ? '<span class="p">1st PURL</span><span class="dot">·</span><span class="l">2nd LOOP</span>'
            : '<span class="l">1st LOOP</span><span class="dot">·</span><span class="p">2nd PURL</span>');
        set('ranks', ranks, function (v) { el.ranks.innerHTML = v; });
        const times = '<span class="p">PURL ' + fmtTime(r.purlTime) + '</span><span class="dot">·</span><span class="l">LOOP ' +
          (r.loopTime !== null ? fmtTime(r.loopTime) : (r.loopStillRacing ? 'racing…' : 'did not finish')) + '</span>';
        set('times', times, function (v) { el.times.innerHTML = v; });
        show(el.wait, r.loopStillRacing);
      }
      if (state.paused) {
        set('pauseSub', state.pauseReason, function (v) {
          el.pauseSub.textContent = v === 'background'
            ? 'Paused while the app was in the background — Loop and Snagling waited too.'
            : 'The race is on hold — Loop and Snagling wait too.';
        });
      } else if (!el.pauseHelp.hidden) { show(el.pauseHelp, false); show(el.pauseMenu, true); }

      // Spool flyers in the renderer aim at the counters.
      if (screen) {
        const g = screen.getBoundingClientRect();
        const a = el.purl.getBoundingClientRect(), b = el.loop.getBoundingClientRect();
        if (a.width) opts.renderer.setHudAnchors({
          purl: { x: a.left - g.left + a.height * 0.6, y: a.top - g.top + a.height * 0.85 },
          loop: { x: b.left - g.left + b.height * 0.6, y: b.top - g.top + b.height * 0.85 }
        });
      }
    }

    function reset() {
      for (const k in last) delete last[k];
      el.purl.classList.remove('up', 'down');
      el.loop.classList.remove('up', 'down');
      show(el.pauseHelp, false); show(el.pauseMenu, true);
    }

    function drawPortraits(drawFrame) {
      [['start-purl', 'purlFront.f1'], ['start-loop', 'loopFront.f1'], ['fail-purl', 'purl.stumble']].forEach(function (pair) {
        const c = $(pair[0]);
        if (!c) return;
        const g = c.getContext('2d');
        g.clearRect(0, 0, c.width, c.height);
        drawFrame(g, pair[1], c.width / 2, c.height * 0.94, c.width * 0.86);
      });
    }

    return { update: update, loading: loading, loadFailed: loadFailed, error: error, reset: reset, drawPortraits: drawPortraits, el: el };
  }

  WW.ui = WW.ui || {};
  WW.ui.createHud = createHud;
})(globalThis.WW = globalThis.WW || {});
