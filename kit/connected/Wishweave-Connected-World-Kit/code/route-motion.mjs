// Reference math, not a complete character controller or animation system.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const unit = v => { const n = Math.hypot(...v); if (!n) throw new Error('Zero tangent'); return v.map(x => x / n); };
const lerp = (a, b, t) => a + (b - a) * t;

export function sampleRoad(route, distance, lateral = 0, bodyRadius = 0.35) {
  const p = route.points;
  if (!p || p.length < 2 || !Number.isFinite(distance) || !Number.isFinite(lateral) || !Number.isFinite(bodyRadius) || bodyRadius < 0) throw new TypeError('Valid route, distance and body radius required');
  const s = clamp(distance, p[0].s, p.at(-1).s);
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].s <= s) lo = m; else hi = m; }
  const a = p[lo], b = p[hi], span = b.s - a.s;
  if (span <= 0) throw new Error('Route distances must strictly increase');
  const t = (s - a.s) / span;
  const center = ['x', 'y', 'z'].map(k => lerp(a[k], b[k], t));
  const forward = unit(a.tangent && b.tangent ? a.tangent.map((v, i) => lerp(v, b.tangent[i], t)) : [b.x-a.x, b.y-a.y, b.z-a.z]);
  const right = unit([forward[2], 0, -forward[0]]);
  const normal = unit([forward[1] * right[2], forward[2] * right[0] - forward[0] * right[2], -forward[1] * right[0]]);
  const width = lerp(a.width ?? route.width, b.width ?? route.width, t);
  const limit = Math.max(0, width / 2 - bodyRadius);
  const offset = clamp(lateral, -limit, limit);
  return {s, center, position: center.map((v,i) => v + right[i] * offset), forward, right, normal, width, lateral: offset, heading: Math.atan2(forward[0], forward[2]), mainS: a.mainS !== undefined && b.mainS !== undefined ? lerp(a.mainS,b.mainS,t) : s};
}

export function advanceRun(state, dt, options) {
  // Specify a speed calibrated to the production character scale and camera.
  const {runSpeed, accelerationTime = 0.3, brakingTime = 0.22, strideLength = 1.4, paused = false, routeLength = Infinity} = options;
  if (![dt,runSpeed,accelerationTime,brakingTime,strideLength,state.speed,state.s,state.phase].every(Number.isFinite) || dt < 0 || runSpeed <= 0 || accelerationTime <= 0 || brakingTime <= 0 || strideLength <= 0 || state.speed < 0 || state.s < 0 || Number.isNaN(routeLength) || routeLength < state.s) throw new TypeError('Invalid motion state/options');
  if (paused || dt === 0) return {...state, distanceMoved: 0};
  const target = state.braked ? 0 : runSpeed;
  const direction = Math.sign(target - state.speed);
  const acceleration = direction * runSpeed / (direction < 0 ? brakingTime : accelerationTime);
  const changingTime = direction ? Math.min(dt, Math.abs((target - state.speed) / acceleration)) : 0;
  const speed = state.speed + acceleration * changingTime;
  const proposed = state.speed * changingTime + 0.5 * acceleration * changingTime ** 2 + speed * (dt - changingTime);
  const distanceMoved = Math.max(0, Math.min(proposed, routeLength - state.s));
  return {...state, s: state.s + distanceMoved, speed: state.s + distanceMoved >= routeLength ? 0 : Math.max(0,speed), phase: ((state.phase + distanceMoved / strideLength) % 1 + 1) % 1, distanceMoved};
}

export function chaseTargets(route, distance, lateral = 0, options = {}) {
  const {behind = 5.5, height = 3.2, lookAhead = 7, targetHeight = 0.8} = options;
  const player = sampleRoad(route,distance,lateral);
  const ahead = sampleRoad(route,distance + lookAhead,lateral);
  return {position: player.position.map((v,i) => v - player.forward[i] * behind + (i === 1 ? height : 0)), target: ahead.position.map((v,i) => v + (i === 1 ? targetHeight : 0))};
  // Host must add time-based damping, camera collision and framing calibration.
}
