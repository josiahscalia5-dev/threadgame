/* The kit's touch-input tests (kit/connected/.../code/touch-input.test.mjs), unchanged except for loading: they run
   against the ported classic script game/src/core/gesture.js (WW.gesture). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

delete globalThis.WW;
const FILE = path.resolve(__dirname, '../../game/src/core/gesture.js');
vm.runInThisContext(fs.readFileSync(FILE, 'utf8'), { filename: FILE });
const G = globalThis.WW.gesture;
const DEFAULTS = G.DEFAULTS, INTENTS = G.INTENTS, swipeThreshold = G.swipeThreshold;
const classifyGesture = G.classify, createGestureMachine = G.createMachine, attachTouchInput = G.attach;


const sample = (pointerId, time, x = 100, y = 100, extra = {}) =>
  ({ pointerId, time, x, y, viewportWidth: 400, ...extra });
function tap(machine, start, x = 100, y = 100, id = 1) {
  machine.down(sample(id, start, x, y));
  return machine.up(sample(id, start + 40, x, y));
}
function swipe(machine, start, dx, dy) {
  machine.down(sample(1, start));
  machine.move(sample(1, start + 40, 100 + dx / 2, 100 + dy / 2));
  return machine.up(sample(1, start + 100, 100 + dx, 100 + dy));
}

test('threshold scales with viewport CSS width and is clamped', () => {
  assert.equal(swipeThreshold(200), 24);
  assert.equal(swipeThreshold(500), 40);
  assert.equal(swipeThreshold(2400), 72);
  assert.equal(swipeThreshold(0), 25.6);
});

const cases = [
  ['short stationary tap', 0, 0, 100, 0, 'tap'],
  ['small tap jitter', 3, 2, 100, 5, 'tap'],
  ['long press', 0, 0, 400, 0, 'none'],
  ['drag then return', 0, 0, 100, 50, 'none'],
  ['subthreshold movement', 20, 0, 100, 20, 'none'],
  ['right at threshold', 32, 0, 300, 32, 'right'],
  ['left', -60, 10, 100, 61, 'left'],
  ['up', 5, -70, 100, 71, 'jump'],
  ['down remains reserved', 0, 70, 100, 70, 'reserved'],
  ['ambiguous diagonal', 60, -60, 100, 85, 'none'],
  ['mostly horizontal', 70, -30, 100, 77, 'right'],
];
for (const [name, dx, dy, duration, maxDistance, expected] of cases) {
  test(`classifier: ${name}`, () => {
    assert.equal(classifyGesture({ dx, dy, duration, maxDistance, viewportWidth: 400 }), expected);
  });
}

test('a swipe emits once on release; upward swipe only jumps', () => {
  const machine = createGestureMachine();
  assert.deepEqual(machine.down(sample(1, 0)), []);
  assert.deepEqual(machine.move(sample(1, 40, 100, 0)), []);
  assert.deepEqual(machine.move(sample(1, 80, 100, -20)), []);
  assert.deepEqual(machine.up(sample(1, 120, 100, -40)), [INTENTS.jump]);
  assert.deepEqual(machine.up(sample(1, 121, 100, -40)), []);
});

test('two nearby short taps toggle only player brake; a third starts a fresh pair', () => {
  const machine = createGestureMachine();
  assert.deepEqual(tap(machine, 0), []);
  assert.deepEqual(tap(machine, 150, 106, 102), [INTENTS.togglePlayerBrake]);
  assert.deepEqual(tap(machine, 230), []);
  assert.deepEqual(tap(machine, 300), [INTENTS.togglePlayerBrake]);
  assert.notEqual(INTENTS.togglePlayerBrake.type, INTENTS.toggleGlobalPause.type);
});

test('distant or delayed taps do not form a double tap', () => {
  const machine = createGestureMachine();
  tap(machine, 0);
  assert.deepEqual(tap(machine, 150, 180), []);
  assert.deepEqual(tap(machine, 1000, 180), []);
});

test('swipes cannot count as either tap and invalidate a pending tap', () => {
  const machine = createGestureMachine();
  tap(machine, 0);
  assert.deepEqual(swipe(machine, 90, -60, 0), [INTENTS.left]);
  assert.deepEqual(tap(machine, 200), []);
  assert.deepEqual(swipe(machine, 270, 60, 0), [INTENTS.right]);
  assert.deepEqual(tap(machine, 380), []);
});

test('down swipe emits nothing and clears a pending tap', () => {
  const machine = createGestureMachine();
  tap(machine, 0);
  assert.deepEqual(swipe(machine, 60, 0, 80), []);
  assert.deepEqual(tap(machine, 190), []);
});

test('a drag-return and a long press never complete a double tap', () => {
  for (const longPress of [false, true]) {
    const machine = createGestureMachine();
    tap(machine, 0);
    machine.down(sample(1, 70));
    if (!longPress) machine.move(sample(1, 80, 150));
    assert.deepEqual(machine.up(sample(1, longPress ? 300 : 100)), []);
    assert.deepEqual(tap(machine, 320), []);
  }
});

test('ignored UI input invalidates pending taps', () => {
  const machine = createGestureMachine();
  tap(machine, 0);
  machine.down(sample(2, 80, 100, 100, { ignored: true }));
  assert.deepEqual(machine.up(sample(2, 100)), []);
  assert.deepEqual(tap(machine, 140), []);
});

test('multi-touch cancels all contacts until lifted, including a UI contact', () => {
  for (const ignored of [false, true]) {
    const machine = createGestureMachine();
    tap(machine, 0);
    machine.down(sample(1, 60));
    machine.down(sample(2, 70, 200, 100, { ignored }));
    assert.deepEqual(machine.up(sample(1, 90, 10)), []);
    // A third finger while another remains must also stay blocked.
    machine.down(sample(3, 95));
    assert.deepEqual(machine.up(sample(2, 100)), []);
    assert.deepEqual(machine.up(sample(3, 110, 200)), []);
    assert.deepEqual(tap(machine, 130), []);
    assert.deepEqual(tap(machine, 200), [INTENTS.togglePlayerBrake]);
  }
});

test('pointer cancellation clears tap history; post-up capture loss does not', () => {
  const machine = createGestureMachine();
  tap(machine, 0);
  machine.down(sample(1, 70));
  machine.cancel(1);
  assert.deepEqual(machine.up(sample(1, 100, 200)), []);
  assert.deepEqual(tap(machine, 130), []);
  machine.cancel(1); // Browsers release capture after pointerup.
  assert.deepEqual(tap(machine, 200), [INTENTS.togglePlayerBrake]);
});

test('reset removes any armed double tap; timestamps require one finite clock', () => {
  const machine = createGestureMachine();
  tap(machine, 0); machine.reset();
  assert.deepEqual(tap(machine, 100), []);
  assert.throws(() => machine.down(sample(1, NaN)), TypeError);
  assert.equal(DEFAULTS.tapDuration, 200);
});

class EventHub {
  handlers = new Map();
  addEventListener(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); }
  dispatch(name, event = {}) { for (const fn of this.handlers.get(name) ?? []) fn(event); }
}

test('DOM adapter ignores buttons, routes intents, resets on blur, and disposes', () => {
  const doc = new EventHub(), win = new EventHub();
  doc.defaultView = win; doc.documentElement = { clientWidth: 400 };
  const button = { matches: () => true, closest: () => button };
  const surface = { ownerDocument: doc, contains: node => node === surface || node === button,
    setPointerCapture() {}, matches: () => false };
  let clock = 0, prevented = 0;
  const received = [];
  const input = attachTouchInput(surface, intent => received.push(intent), { now: () => clock++ });
  const dispatch = (name, target = surface, x = 100, y = 100) => doc.dispatch(name, {
    target, pointerId: 1, clientX: x, clientY: y, button: 0, cancelable: true,
    composedPath: () => target === button ? [button, surface, doc] : [surface, doc],
    preventDefault: () => prevented++,
  });
  const doTap = (target = surface) => { dispatch('pointerdown', target); dispatch('pointerup', target); };
  doTap(); doTap(button); doTap();
  assert.deepEqual(received, []);
  doTap();
  assert.deepEqual(received, [INTENTS.togglePlayerBrake]);
  assert.equal(prevented, 3); // The button keeps native pointer/click behavior.
  doTap(); win.dispatch('blur'); doTap();
  assert.equal(received.length, 1);
  dispatch('pointerdown'); dispatch('pointerup', surface, 100, 0);
  assert.deepEqual(received.at(-1), INTENTS.jump);
  input.dispose(); doTap(); doTap();
  assert.equal(received.length, 2);
  assert.equal([...doc.handlers.values()].reduce((n, set) => n + set.size, 0), 0);
});

test('coalesced excursion samples prevent a drag-return from becoming a tap', () => {
  const doc = new EventHub(), win = new EventHub();
  doc.defaultView = win; doc.documentElement = { clientWidth: 400 };
  const surface = { ownerDocument: doc, contains: () => true, setPointerCapture() {} };
  let time = 0;
  const received = [];
  const input = attachTouchInput(surface, item => received.push(item), { now: () => time++ });
  const event = x => ({ target: surface, pointerId: 1, clientX: x, clientY: 100,
    button: 0, composedPath: () => [surface, doc] });
  doc.dispatch('pointerdown', event(100)); doc.dispatch('pointerup', event(100));
  doc.dispatch('pointerdown', event(100));
  doc.dispatch('pointermove', { ...event(100), getCoalescedEvents: () => [event(150)] });
  doc.dispatch('pointerup', event(100));
  assert.deepEqual(received, []);
  input.dispose();
});

test('a secondary touch cannot start a gesture after an explicit mode reset', () => {
  const doc = new EventHub(), win = new EventHub();
  doc.defaultView = win; doc.documentElement = { clientWidth: 400 };
  const surface = { ownerDocument: doc, contains: () => true, setPointerCapture() {} };
  let time = 0;
  const received = [];
  const input = attachTouchInput(surface, item => received.push(item), { now: () => time++ });
  const event = (id, isPrimary, x = 100) => ({ target: surface, pointerId: id,
    clientX: x, clientY: 100, button: 0, pointerType: 'touch', isPrimary,
    composedPath: () => [surface, doc] });
  doc.dispatch('pointerdown', event(1, true));
  input.reset();
  doc.dispatch('pointerdown', event(2, false));
  doc.dispatch('pointerup', event(2, false, 200));
  doc.dispatch('pointerup', event(1, true));
  assert.deepEqual(received, []);
  input.dispose();
});

test('capture loss retains a live contact until its actual release', () => {
  const doc = new EventHub(), win = new EventHub();
  doc.defaultView = win; doc.documentElement = { clientWidth: 400 };
  const surface = { ownerDocument: doc, contains: () => true, setPointerCapture() {} };
  let time = 0;
  const received = [];
  const input = attachTouchInput(surface, item => received.push(item), { now: () => time++ });
  const event = (id, x = 100) => ({ target: surface, pointerId: id,
    clientX: x, clientY: 100, button: 0, composedPath: () => [surface, doc] });
  doc.dispatch('pointerdown', event(1));
  doc.dispatch('lostpointercapture', event(1));
  doc.dispatch('pointerdown', event(2));
  doc.dispatch('pointerup', event(2, 200));
  assert.deepEqual(received, []);
  doc.dispatch('pointerup', event(1));
  doc.dispatch('pointerdown', event(3));
  doc.dispatch('pointerup', event(3, 200));
  assert.deepEqual(received, [INTENTS.right]);
  input.dispose();
});
