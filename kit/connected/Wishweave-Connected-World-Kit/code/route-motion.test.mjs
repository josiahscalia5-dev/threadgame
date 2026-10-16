import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sampleRoad,advanceRun,chaseTargets} from './route-motion.mjs';
const data=JSON.parse(readFileSync(new URL('../scenery/route.json',import.meta.url)));
const road=data.mainRoute;
const near=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('route sampler reaches the actual spawn and finish and clamps road edges',()=>{
  const p=sampleRoad(road,road.spawn.s); p.position.forEach((v,i)=>near(v,road.spawn.position[i],0.002));
  const f=sampleRoad(road,1e6);f.position.forEach((v,i)=>near(v,road.finish.position[i],0.002));
  near(sampleRoad(road,50,500,0.5).lateral,2.5);near(sampleRoad(road,50,-500,0.5).lateral,-2.5);
});
test('sampled surface frame remains orthonormal and upward on the whole route',()=>{
  for(let s=0;s<road.length;s+=0.3){const a=sampleRoad(road,s);near(Math.hypot(...a.forward),1);near(Math.hypot(...a.normal),1);near(a.forward.reduce((v,x,i)=>v+x*a.normal[i],0),0);near(a.right.reduce((v,x,i)=>v+x*a.normal[i],0),0);assert.ok(a.normal[1]>.98);}
});
test('braking travels the same distance at different frame rates and stops the gait',()=>{
  const opt={runSpeed:4,brakingTime:0.22};
  function sim(hz){let s={s:0,speed:4,phase:0,braked:true};for(let i=0;i<hz;i++)s=advanceRun(s,1/hz,opt);return s;}
  const a=sim(30),b=sim(120);near(a.s,b.s);near(a.s,0.44);near(a.speed,0);near(advanceRun(a,1,opt).phase,a.phase);
});
test('player brake does not affect an independently advanced rival',()=>{
  const options={runSpeed:4};const p=advanceRun({s:10,speed:4,phase:0,braked:true},1,options);const l=advanceRun({s:9,speed:4,phase:0,braked:false},1,options);assert.ok(l.s>p.s);
});
test('global pause freezes progress and gait while preserving brake state',()=>{
  const s={s:5,speed:2,phase:.5,braked:true};assert.deepEqual(advanceRun(s,40,{runSpeed:4,paused:true}),{...s,distanceMoved:0});
});
test('distance and gait clamp to route endpoint without extra foot cycling',()=>{
  const s=advanceRun({s:road.length-.1,speed:4,phase:.1,braked:false},1,{runSpeed:4,routeLength:road.length});near(s.s,road.length);near(s.speed,0);near(s.distanceMoved,.1);near(advanceRun(s,1,{runSpeed:4,routeLength:road.length}).phase,s.phase);
});
test('branch endpoints coincide with main route and comparable progress',()=>{
 for(const b of data.branches){for(const [s,m] of [[0,b.startS],[b.points.at(-1).s,b.endS]]){const p=sampleRoad(b,s),q=sampleRoad(road,m);p.position.forEach((v,i)=>near(v,q.position[i],0.002));near(p.mainS,m,0.002);}}
});
test('camera aims forward along the continuous route with finite positions',()=>{
 for(let s=0;s<road.length;s+=2){const c=chaseTargets(road,s);assert.ok(c.position.every(Number.isFinite));assert.ok(c.target.every(Number.isFinite));assert.ok(c.target[2]>c.position[2]);}
});
