/* Complete Level 1 visual storyboard. Coordinates are fixed 841 × 1870 design
   pixels. Entity x is center; y is bottom anchor; width retains atlas aspect.
   The approved PNGs are immutable appearance targets. The background plates
   retain route geometry; loose characters and specified props are separate.
   before/after describe implementation beats, not implemented gameplay. */
window.WW_SCENES = [
  {
    id:'ribbon',label:'Ribbon',title:'Unfurl the first path',location:'The ribbon gate',phase:'LEVEL 1 · START',
    approved:'../approved/01-ribbon.png',background:'../assets/backgrounds/01-ribbon.png',
    objective:'UNFURL THE RIBBON',counts:[0,0],
    description:'Purl reaches a curled coral ribbon. One glowing stitch opens the route toward the first coral thread while Loop runs along a separate teal ribbon.',
    direction:'The camera stays behind Purl. A single tap is the first gentle task. Loop is computer-controlled with independent progress; matched counters are sample race states, not synchronized scoring.',
    before:'Begin on a safe straight carpet with a short countdown. Purl and Loop set off, and the first stitch comes into view before any damaging enemy appears.',
    after:'Tap the stitch. The curled ribbon unfurls into a stable path; Purl runs up it and collects the coral thread. Loop collects a separate thread on the parallel route. Both reach the shortcut at 1 / 3.',
    callout:{text:'Tap the stitch',x:449,y:1295,width:175,point:[417,1405]},
    entities:[
      {id:'coral-thread',kind:'props',asset:'props-atlas',frame:0,x:315,y:575,width:62,z:1},
      {id:'loop',kind:'actors',asset:'loop-rear',frame:3,x:726,y:1068,width:145,z:2},
      {id:'purl',kind:'actors',asset:'purl-rear',frame:1,x:274,y:1518,width:289,z:4}
    ]
  },
  {
    id:'shortcut',label:'Shortcut',title:'Open the carpet shortcut',location:'The rolled crossing',phase:'LEVEL 1 · MIDDLE',
    approved:'../approved/02-shortcut.png',background:'../assets/backgrounds/02-shortcut.png',
    objective:'OPEN THE SHORTCUT',counts:[1,1],
    description:'A rolled carpet blocks Purl’s short route. The next stitch releases it across the gap. Loop continues on the longer upper bypass.',
    direction:'This is a one-tap unfolding shortcut. The visible Snagling peek is harmless foreshadowing, with no attack during the stitch task. The visible teal thread is ahead; it has not been collected yet.',
    before:'After the coral pickup, the path bends around the first tower. The camera follows Purl without reversing direction, revealing a broad safe approach to the rolled crossing.',
    after:'Tap the stitch and let the carpet fully open. Purl crosses onto the next broad platform and approaches the tassel gate. Loop remains visible on the independent upper route.',
    callout:{text:'Tap the stitch',x:603,y:1314,width:174,point:[490,1328]},
    entities:[
      {id:'snagling',kind:'actors',asset:'snagling-atlas',frame:0,x:211,y:742,width:130,z:1},
      {id:'teal-thread-ahead',kind:'props',asset:'props-atlas',frame:1,x:405,y:724,width:65,z:2},
      {id:'loop',kind:'actors',asset:'loop-rear',frame:1,x:717,y:687,width:111,z:2},
      {id:'purl',kind:'actors',asset:'purl-rear',frame:3,x:346,y:1530,width:292,z:5}
    ]
  },
  {
    id:'tassels',label:'Tassels',title:'Lift a path through the tassels',location:'The tassel gate',phase:'LEVEL 1',
    approved:'../approved/03-tassels.png',background:'../assets/backgrounds/03-tassels.png',
    objective:'LIFT THE TASSELS',counts:[1,1],
    description:'Three plum tassels hang across the approach to the teal thread. Tapping the stitch sends a wave up their cords and lifts them in sequence.',
    direction:'Hold the opening long enough for a comfortable crossing, with a safe waiting pocket before it. This required task opens access to the teal thread. Snagling attacks only later, after the pickup, on the broad landing.',
    before:'Purl has one coral thread and reaches the next raised landing. The teal pickup is visible beyond the three tassels; its counter has not increased yet.',
    after:'Tap once, watch the tassels rise, then pass through and collect the teal thread: 2 / 3. Loop reaches its own second pickup. On the next broad landing, Purl can dodge the Snagling; the approved example shows the missed-dodge and recovery branch.',
    callout:{text:'Tap the stitch',x:625,y:1275,width:184,point:[571,1365]},
    entities:[
      {id:'teal-thread',kind:'props',asset:'props-atlas',frame:1,x:359,y:886,width:71,z:1},
      {id:'tassel-left',kind:'props',asset:'props-atlas',frame:3,x:221,y:660,width:173,z:2},
      {id:'tassel-middle',kind:'props',asset:'props-atlas',frame:3,x:386,y:756,width:177,z:2},
      {id:'tassel-right',kind:'props',asset:'props-atlas',frame:3,x:555,y:858,width:176,z:2},
      {id:'loop',kind:'actors',asset:'loop-rear',frame:3,x:722,y:972,width:117,z:3},
      {id:'purl',kind:'actors',asset:'purl-rear',frame:3,x:411,y:1514,width:294,z:5}
    ]
  },
  {
    id:'snagged',label:'Snagged',title:'One hit, one dropped thread',location:'The wide landing',phase:'LEVEL 1',
    approved:'../approved/04-snagged.png',background:'../assets/backgrounds/04-snagged.png',
    objective:'SNAGGED!',counts:[1,2],
    description:'This is the missed-dodge example. Snagling catches Purl’s ankles for a brief stumble and knocks one teal thread onto safe, reachable carpet.',
    direction:'Purl had two threads before this hit and now has one. The enemy never carries Purl away. Loop continues racing and saved rewards stay untouched.',
    before:'The tassel section is complete and Purl carries 2 / 3. Snagling hops visibly from behind the post on this wide landing; a successful dodge keeps both threads and skips the two recovery screens.',
    after:'The loose ankle wrap releases after the short stumble. Brief hit protection prevents repeated damage from this attack. Purl turns toward the dropped spool, which stays reachable instead of falling into the gap.',
    callout:{text:'−1 THREAD',x:696,y:1158,width:159,point:[709,1251]},
    entities:[
      {id:'loop',kind:'actors',asset:'loop-rear',frame:1,x:649,y:561,width:111,z:1},
      {id:'snagling',kind:'actors',asset:'snagling-atlas',frame:1,x:205,y:1270,width:202,z:3},
      {id:'dropped-thread',kind:'props',asset:'props-atlas',frame:1,x:702,y:1325,width:108,rotation:.28,z:4},
      {id:'purl',kind:'actors',asset:'purl-rear',frame:7,x:450,y:1455,width:312,z:5}
    ]
  },
  {
    id:'recovery',label:'Recovery',title:'Collect it back and catch up',location:'The safe recovery',phase:'LEVEL 1',
    approved:'../approved/05-recovery.png',background:'../assets/backgrounds/05-recovery.png',
    objective:'THREAD RECOVERED',counts:[2,2],
    description:'Purl reaches the dropped teal spool and recovers the same thread. The counter returns from 1 / 3 to 2 / 3 as a brief protective glow fades.',
    direction:'This restores the lost collectible; it is not a fourth item or a bonus payout. A later hit while already carrying zero threads ends the attempt.',
    before:'Purl has broken free of the loose yarn and moved toward the dropped spool on the wide carpet. No new stitch task appears in the recovery area.',
    after:'The recovered thread returns to Purl’s inventory. Snagling falls behind, the protective glow clears, and Purl follows the carpet bend toward the embroidered butterfly alcove.',
    callout:{text:'+1 THREAD',x:707,y:1260,width:156,point:null},
    entities:[
      {id:'loop',kind:'actors',asset:'loop-rear',frame:1,x:634,y:531,width:95,z:1},
      {id:'snagling',kind:'actors',asset:'snagling-atlas',frame:0,x:159,y:1222,width:172,z:3},
      {id:'recovering-thread',kind:'props',asset:'props-atlas',frame:1,x:622,y:1265,width:94,rotation:.25,z:4},
      {id:'purl',kind:'actors',asset:'purl-rear',frame:1,x:435,y:1408,width:301,z:5}
    ]
  },
  {
    id:'butterfly',label:'Butterfly',title:'Wake the embroidery',location:'The butterfly alcove',phase:'LEVEL 1',
    approved:'../approved/06-butterfly.png',background:'../assets/backgrounds/06-butterfly.png',
    objective:'WAKE THE EMBROIDERY',counts:[2,2],
    description:'A butterfly peels out of the embroidered wall hanging and carries the golden thread down toward Purl’s reachable landing.',
    direction:'The shown counter is still 2 / 3 because the butterfly is delivering the item. The thread stays on the landing until collected; there is no precision chase.',
    before:'Purl arrives carrying two threads, either after dodging successfully or after recovering the dropped teal spool. The stitch on the left tapestry invites the next action.',
    after:'Tap the tapestry stitch. The butterfly lifts from the cloth, delivers the golden thread, and Purl collects it for 3 / 3. Loop completes its own third pickup. Both take the short final sprint toward the flower gate.',
    callout:{text:'Tap the stitch',x:137,y:903,width:190,point:[135,990]},
    entities:[
      {id:'butterfly-carrying-thread',kind:'props',asset:'feature-atlas',frame:5,x:443,y:1051,width:286,z:1},
      {id:'loop',kind:'actors',asset:'loop-rear',frame:3,x:715,y:990,width:117,z:3},
      {id:'purl',kind:'actors',asset:'purl-rear',frame:3,x:404,y:1482,width:307,z:5}
    ]
  },
  {
    id:'finish',label:'Finish',title:'Race through the flower gate',location:'The finish terrace',phase:'LEVEL 1',
    approved:'../approved/07-finish.png',background:'../assets/backgrounds/07-finish.png',
    objective:'LEVEL 1 COMPLETE',counts:[3,3],action:'PLAY AGAIN',
    description:'The final sprint ends on the flower-gate terrace. This approved result shows Purl first and Loop second, each with their own three threads.',
    direction:'Finish order must come from actual arrival times in the playable version. Loop can genuinely win; this artwork is one possible result.',
    before:'After the golden pickup, the camera follows the final stretch into the glowing flower gate. The two routes meet at the broad finish terrace; crossing the finish records each racer’s time.',
    after:'Show the true finishing order and level completion. A future reward service may validate eligible earnings; the current savings bar is a visual placeholder. Play again returns to the safe opening for another attempt.',
    entities:[
      {id:'purl',kind:'actors',asset:'purl-rear',frame:5,x:409,y:1236,width:216,z:3},
      {id:'loop',kind:'actors',asset:'loop-rear',frame:1,x:648,y:1336,width:240,z:4}
    ]
  }
];
