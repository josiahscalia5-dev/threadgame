/* Wishweave Wonders — small synthesized sound effects (WW.audio). No audio files: each cue is a few Web Audio
   oscillator/noise notes. The context is created on the first player gesture (browsers require that), and the
   on/off choice is remembered on this device. */
(function (WW) {
  'use strict';
  let ctx = null, master = null, enabled = true;
  try { enabled = localStorage.getItem('ww.sound') !== 'off'; } catch (e) { /* storage blocked: default on */ }

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }

  function tone(freq, start, dur, type, vol, slideTo) {
    const t = ctx.currentTime + start;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(start, dur, vol, freq) {
    const t = ctx.currentTime + start;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = 0.8;
    g.gain.value = vol || 0.15;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  const CUES = {
    count: function () { tone(660, 0, 0.16, 'triangle', 0.22); },
    go: function () { tone(880, 0, 0.12, 'triangle', 0.25); tone(1320, 0.08, 0.28, 'triangle', 0.22); },
    jump: function () { tone(340, 0, 0.18, 'sine', 0.16, 720); },
    lane: function () { noise(0, 0.09, 0.08, 2400); },
    pickup: function () { [988, 1319, 1568, 1976].forEach(function (f, i) { tone(f, i * 0.06, 0.22, 'triangle', 0.14); }); },
    recover: function () { [784, 1047, 1319].forEach(function (f, i) { tone(f, i * 0.07, 0.24, 'triangle', 0.15); }); },
    hit: function () { tone(180, 0, 0.3, 'sawtooth', 0.12, 70); noise(0, 0.22, 0.2, 500); },
    drop: function () { tone(520, 0.05, 0.35, 'triangle', 0.12, 260); },
    dodge: function () { noise(0, 0.25, 0.12, 1600); tone(600, 0, 0.15, 'sine', 0.08, 900); },
    reveal: function () { tone(420, 0, 0.1, 'square', 0.06, 520); },
    butterfly: function () { [1568, 1760, 2093].forEach(function (f, i) { tone(f, i * 0.09, 0.3, 'sine', 0.08); }); },
    gate: function () { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, i * 0.05, 0.6, 'sine', 0.09); }); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.13, i === 3 ? 0.7 : 0.2, 'triangle', 0.2); }); },
    second: function () { [523, 659, 784].forEach(function (f, i) { tone(f, i * 0.13, i === 2 ? 0.5 : 0.2, 'triangle', 0.18); }); },
    fail: function () { [392, 330, 262].forEach(function (f, i) { tone(f, i * 0.16, 0.3, 'triangle', 0.16); }); },
    overtake: function () { tone(740, 0, 0.1, 'triangle', 0.12); tone(988, 0.09, 0.16, 'triangle', 0.12); }
  };

  /* Maps race events to cues. */
  function onEvents(events, state) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    events.forEach(function (e) {
      let cue = null;
      switch (e.type) {
        case 'count': cue = 'count'; break;
        case 'go': cue = 'go'; break;
        case 'jump': if (e.who === 'purl') cue = 'jump'; break;
        case 'lane': cue = 'lane'; break;
        case 'pickup': cue = 'pickup'; break;
        case 'recover': cue = 'recover'; break;
        case 'hit': cue = 'hit'; break;
        case 'drop': cue = 'drop'; break;
        case 'dodge': cue = 'dodge'; break;
        case 'reveal': cue = 'reveal'; break;
        case 'butterfly': cue = 'butterfly'; break;
        case 'gate-open': cue = 'gate'; break;
        case 'finish': if (e.who === 'purl') cue = state.purl.rank === 1 ? 'win' : 'second'; break;
        case 'fail': cue = 'fail'; break;
        case 'overtake': cue = 'overtake'; break;
      }
      if (cue) { try { CUES[cue](); } catch (err) { /* audio is best-effort */ } }
    });
  }

  WW.audio = {
    unlock: unlock,
    onEvents: onEvents,
    count: function () { if (enabled && ctx && ctx.state === 'running') CUES.count(); },
    isOn: function () { return enabled; },
    setOn: function (on) {
      enabled = !!on;
      try { localStorage.setItem('ww.sound', enabled ? 'on' : 'off'); } catch (e) { /* ignore */ }
      if (enabled) unlock();
    },
    suspend: function () { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume: function () { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  };
})(globalThis.WW = globalThis.WW || {});
