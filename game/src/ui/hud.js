/* Wishweave Wonders — HUD driven only by race state (docs/ARCHITECTURE.md §9, §7.1).

   const hud = WW.ui.createHud(els, { level: WW.LEVEL });
   hud.handleEvents(events)   pickup/recover → pop, drop → shake (Purl or Loop by item owner), hit → soft flash
   hud.update(state)          phase, PURL/LOOP n/3 (state.held only), objective or state.message, hint, countdown,
                              race-progress thread, results block (true ranks and times; "Loop is still racing…")
   hud.reset()                clears per-race memory (count diffs, message animation) for a new race */
(function (WW) {
  'use strict';

  const ui = WW.ui = WW.ui || {};
  const D = function () { return ui.dom; };

  function cumulative(route) {
    const c = [0];
    (route || []).forEach(function (s, i) { c.push(c[i] + Math.max(0, +s.length || 0)); });
    return c;
  }

  function segIndex(route, racer) {
    if (typeof racer.seg === 'number' && isFinite(racer.seg)) return racer.seg;
    if (racer.segId && route) {
      for (let i = 0; i < route.length; i++) if (route[i].id === racer.segId) return i;
    }
    return 0;
  }

  function progressOf(cum, route, racer) {
    if (!racer) return 0;
    const total = cum[cum.length - 1];
    if (!total) return 0;
    if (racer.finishTime != null || racer.action === 'finished') return 1;
    const n = cum.length - 1;
    const seg = Math.max(0, Math.min(n - 1, segIndex(route, racer)));
    const f = Math.max(0, Math.min(1, +racer.f || 0));
    return Math.max(0, Math.min(1, (cum[seg] + f * (cum[seg + 1] - cum[seg])) / total));
  }

  function fmtTime(t) {
    if (t == null || !isFinite(t)) return '—';
    t = Math.round(Math.max(0, t) * 10) / 10;
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    const ss = s.toFixed(1);
    return m + ':' + (s < 10 ? '0' : '') + ss;
  }

  function ordinal(n) {
    return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';
  }

  function ownerOf(item) {
    item = String(item || '');
    return item.indexOf('loop.') === 0 ? 'loop' : item.indexOf('purl.') === 0 ? 'purl' : null;
  }

  function messageActive(state) {
    const m = state.message;
    if (!m || !m.text) return null;
    if (m.until != null && state.time != null && state.time > m.until) return null;
    return m;
  }

  function hintActive(state) {
    const h = state.hint;
    if (!h || !h.text) return null;
    if (h.until != null && state.time != null && state.time > h.until) return null;
    return h;
  }

  function createHud(els, opts) {
    const dom = D();
    const level = (opts && opts.level) || WW.LEVEL || {};
    const purlCum = cumulative(level.route);
    const loopCum = cumulative(level.loopRoute || level.route);
    let prevHeld = { purl: null, loop: null };
    let flags = { purl: null, loop: null, hit: false };
    let lastObjectiveKey = '';
    let lastCount = '';
    let beadP = -1, beadL = -1;

    function reset() {
      prevHeld = { purl: null, loop: null };
      flags = { purl: null, loop: null, hit: false };
      lastObjectiveKey = '';
      lastCount = '';
      beadP = beadL = -1;
      ['up', 'down'].forEach(function (c) {
        if (els.purl) els.purl.classList.remove(c);
        if (els.loop) els.loop.classList.remove(c);
      });
      if (els.objective) els.objective.classList.remove('is-message', 'kind-hit', 'kind-recover', 'kind-dodge', 'kind-info');
    }

    function handleEvents(events) {
      if (!events || !events.length) return;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (!e) continue;
        switch (e.type) {
          case 'pickup': case 'recover': {
            const who = ownerOf(e.item) || 'purl';
            flags[who] = 'up';
            break;
          }
          case 'loop-recover': case 'loop-pickup': flags.loop = 'up'; break;
          case 'drop': flags[ownerOf(e.item) || 'purl'] = 'down'; break;
          case 'loop-drop': flags.loop = 'down'; break;
          case 'hit': flags.hit = true; break;
          default: break;
        }
      }
    }

    function applyCount(who, el, numEl, value) {
      dom.setText(numEl, value);
      if (el && el.__aria !== value) {
        el.__aria = value;
        el.setAttribute('aria-label', (who === 'purl' ? 'Purl' : 'Loop (computer rival)') + ' holds ' + value + ' of 3 wish threads');
      }
      const prev = prevHeld[who];
      let fx = flags[who];
      // Fallback when a count changed without an event in this frame (e.g. a module that reports fewer events).
      if (!fx && prev != null && value !== prev) fx = value > prev ? 'up' : 'down';
      if (fx && el) {
        el.classList.remove(fx === 'up' ? 'down' : 'up');
        dom.restartClass(el, fx);
      }
      flags[who] = null;
      prevHeld[who] = value;
    }

    function updateObjective(state, finished) {
      const msg = finished ? null : messageActive(state);
      const text = msg ? msg.text : (state.objective || '');
      const kind = msg ? (msg.kind || 'info') : '';
      const key = (msg ? 'm:' : 'o:') + kind + ':' + text;
      if (key === lastObjectiveKey) return;
      lastObjectiveKey = key;
      dom.setText(els.objectiveText, text);
      const o = els.objective;
      if (!o) return;
      o.classList.remove('kind-hit', 'kind-recover', 'kind-dodge', 'kind-info');
      if (msg) {
        o.classList.add('kind-' + kind);
        dom.restartClass(o, 'is-message');
      } else {
        o.classList.remove('is-message');
      }
    }

    function updateCountdown(state) {
      let txt = '';
      if (state.mode === 'countdown' && !state.paused) {
        const c = state.countdown == null ? 3 : state.countdown;
        txt = String(Math.max(1, Math.min(9, Math.ceil(c - 1e-6))));
      } else if (state.mode === 'running' && state.time != null && state.time < 0.8) {
        txt = 'GO!';
      }
      if (txt !== lastCount) {
        lastCount = txt;
        dom.setText(els.countdownText, txt);
        dom.show(els.countdown, !!txt);
        if (els.countdown) els.countdown.classList.toggle('go', txt === 'GO!');
        if (txt && els.countdownText) dom.restartClass(els.countdownText, 'tick');
      }
    }

    function updateThread(state, visible) {
      dom.show(els.thread, visible);
      if (!visible) return;
      const p = progressOf(purlCum, level.route, state.purl);
      const l = progressOf(loopCum, level.loopRoute || level.route, state.loop);
      if (Math.abs(p - beadP) > 0.0005 && els.beadPurl) { beadP = p; els.beadPurl.style.left = (p * 100).toFixed(2) + '%'; }
      if (Math.abs(l - beadL) > 0.0005 && els.beadLoop) { beadL = l; els.beadLoop.style.left = (l * 100).toFixed(2) + '%'; }
    }

    function resultInfo(state) {
      const r = state.result || {};
      const pick = function (a, b) { return a != null ? a : b; };
      const purlTime = pick(r.purlTime, state.purl && state.purl.finishTime);
      const loopTime = pick(r.loopTime, state.loop && state.loop.finishTime);
      const purlRank = pick(r.purlRank, state.purl && state.purl.rank);
      const loopRank = pick(r.loopRank, state.loop && state.loop.rank);
      const still = r.loopStillRacing != null ? !!r.loopStillRacing : loopTime == null;
      return { purlTime: purlTime, loopTime: loopTime, purlRank: purlRank, loopRank: loopRank, loopStillRacing: still };
    }

    function updateResults(state) {
      const R = resultInfo(state);
      const esc = dom.escapeHTML;
      const P = function (rank) { return '<span class="p">' + esc(ordinal(rank)) + ' PURL</span>'; };
      const Lp = function (rank) { return '<span class="l">' + esc(ordinal(rank)) + ' LOOP</span>'; };
      const dot = '<span class="dot">•</span>';
      let ranks;
      const purlRank = R.purlRank || (R.loopRank === 1 ? 2 : 1);
      if (R.loopRank != null) {
        ranks = purlRank <= R.loopRank ? P(purlRank) + dot + Lp(R.loopRank) : Lp(R.loopRank) + dot + P(purlRank);
      } else {
        ranks = P(purlRank);   // Loop still racing (chip below) or out of time (times pill shows "LOOP —")
      }
      dom.setHTML(els.ranks, ranks);
      const waiting = R.loopStillRacing && R.loopTime == null;
      const times = '<span class="p">PURL ' + esc(fmtTime(R.purlTime)) + '</span>' +
        (waiting ? '' : dot + '<span class="l">LOOP ' + esc(fmtTime(R.loopTime)) + '</span>');
      dom.setHTML(els.times, times);
      dom.show(els.wait, waiting);
      if (els.ranks && els.ranks.__label !== ranks) {
        els.ranks.__label = ranks;
        els.ranks.setAttribute('aria-label', els.ranks.textContent);
      }
    }

    function update(state) {
      if (!state) return;
      const finished = state.mode === 'finished';
      dom.setText(els.phase, state.phase || 'LEVEL 1');
      const held = state.held || {};
      applyCount('purl', els.purl, els.purlNum, String(held.purl | 0));
      applyCount('loop', els.loop, els.loopNum, String(held.loop | 0));
      if (flags.hit) { flags.hit = false; dom.restartClass(els.game, 'fx-hit'); }

      dom.show(els.objective, !finished);
      updateObjective(state, finished);

      const hint = finished ? null : hintActive(state);
      dom.show(els.hint, !!hint && state.mode === 'running');
      if (hint) dom.setText(els.hint, hint.text);

      updateCountdown(state);
      updateThread(state, !finished && state.mode !== 'intro');

      dom.show(els.results, finished);
      if (finished) updateResults(state);
    }

    return { update: update, handleEvents: handleEvents, reset: reset, progressOf: progressOf, fmtTime: fmtTime };
  }

  ui.createHud = createHud;
  ui.hudUtil = { fmtTime: fmtTime, ordinal: ordinal, cumulative: cumulative, progressOf: progressOf };
})(globalThis.WW = globalThis.WW || {});
