/* Offline visual authoring viewer. There is deliberately no gameplay simulation,
   collision system, reward accrual, player account, or payment integration here. */
(function () {
  'use strict';
  const W = 841, H = 1870;
  const scenes = window.WW_SCENES || [];
  const manifest = window.WW_ASSET_MANIFEST || {images:{}};
  const $ = id => document.getElementById(id);
  const stage = $('stage'), image = $('scene-image'), canvas = $('scene-canvas');
  const ctx = canvas.getContext('2d');
  const state = {index:0,mode:'approved',route:'hit',layers:{actors:true,props:true,hud:true},loading:false,error:null,autoplay:false,rendered:false};
  const cache = new Map();
  let version = 0, timer = null, latestRender = Promise.resolve();
  const modeCopy = {
    approved: ['APPROVED ART','Your approved screen, shown unchanged and fully visible.'],
    scenery: ['CLEAN SCENERY','A derived plate with actors and interface removed. Carpet routes and attached scenery stay in the artwork.'],
    layered: ['EDITABLE LAYERS','Separate sprites, props, and live interface over a clean plate. Use the approved view as the visual target.']
  };
  function source(path) { return window.WW_EMBEDDED_ASSETS?.[path] || path; }
  function loadImage(path) {
    if (cache.has(path)) return cache.get(path);
    const promise = new Promise((resolve,reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load '+path+'. Keep the scene, approved, and assets folders together, then reload.'));
      img.src = source(path);
    });
    cache.set(path,promise);
    promise.catch(() => cache.delete(path));
    return promise;
  }
  function atlasPath(name) {
    const spec = manifest.images?.[name];
    if (!spec?.file) throw new Error('The asset manifest is missing “'+name+'”. Check that asset-data.js and the asset pack are complete.');
    return '../assets/'+spec.file;
  }
  function roundRect(x,y,w,h,r) {
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
  }
  function text(label,x,y,size=23,color='#552916',weight=700,align='center') {
    ctx.font=weight+' '+size+'px Arial, Helvetica, sans-serif';ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(label,x,y);
  }
  function pill(x,y,w,h,r=26) {
    ctx.save();ctx.shadowColor='#4b231c66';ctx.shadowBlur=9;ctx.shadowOffsetY=4;
    const gradient=ctx.createLinearGradient(x,y,x,y+h);gradient.addColorStop(0,'#fff8e8');gradient.addColorStop(1,'#f8e6ca');
    ctx.fillStyle=gradient;roundRect(x,y,w,h,r);ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;ctx.lineWidth=4;ctx.strokeStyle='#fff6df';ctx.stroke();ctx.lineWidth=1.5;ctx.strokeStyle='#c7a480';roundRect(x+5,y+5,w-10,h-10,Math.max(r-5,4));ctx.stroke();ctx.restore();
  }
  function cropDraw(asset,frame,x,y,width,anchor='bottom',rotation=0) {
    const spec=manifest.images?.[asset], frames=spec?.frames;
    if (!frames?.[frame]) throw new Error('The frame '+frame+' for “'+asset+'” is missing from the manifest.');
    const raw=frames[frame];
    const a=Array.isArray(raw)?raw:[raw.x,raw.y,raw.w ?? raw.width,raw.h ?? raw.height];
    const img=loaded[asset];
    if (!img) return;
    const height=width*a[3]/a[2];
    ctx.save();ctx.translate(x,y);if(rotation)ctx.rotate(rotation);
    ctx.drawImage(img,a[0],a[1],a[2],a[3],-width/2,anchor==='bottom'?-height:0,width,height);ctx.restore();
  }
  let loaded={};
  function glow(x,y,r,color='#ffd566') {
    ctx.save();const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color+'80');g.addColorStop(1,color+'00');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function drawSnagLoop() {
    ctx.save();ctx.strokeStyle='#912b74';ctx.lineWidth=11;ctx.lineCap='round';ctx.shadowColor='#2c173b88';ctx.shadowBlur=4;ctx.beginPath();ctx.moveTo(257,1256);ctx.bezierCurveTo(306,1300,316,1390,437,1411);ctx.bezierCurveTo(546,1425,537,1450,477,1442);ctx.bezierCurveTo(412,1428,402,1395,346,1391);ctx.stroke();ctx.strokeStyle='#d46bb5';ctx.lineWidth=2;ctx.stroke();ctx.restore();
  }
  function drawRecoveryGlow(){
    ctx.save();ctx.strokeStyle='#ffe7a2';ctx.shadowColor='#ffbc24';ctx.shadowBlur=20;ctx.lineWidth=5;ctx.beginPath();ctx.ellipse(443,1320,176,66,-.2,0,Math.PI*2);ctx.stroke();ctx.restore();
  }
  function drawCallout(callout){
    const {text:label,x,y,width,point}=callout;
    if(point){
      ctx.save();ctx.strokeStyle='#fff2ce';ctx.lineWidth=9;ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor='#59321b88';ctx.shadowBlur=4;ctx.beginPath();ctx.moveTo(x,y+17);ctx.lineTo(point[0],point[1]-12);ctx.stroke();const a=Math.atan2(point[1]-(y+17),point[0]-x);ctx.translate(point[0],point[1]);ctx.rotate(a);ctx.fillStyle='#fff2ce';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-23,-10);ctx.lineTo(-23,10);ctx.closePath();ctx.fill();ctx.restore();
    }
    pill(x-width/2,y-25,width,50,22);
    ctx.font='700 23px Arial, Helvetica, sans-serif';
    const labelSize=Math.min(23,23*(width-24)/ctx.measureText(label).width);
    text(label,x,y,labelSize,label.includes('THREAD')?'#b52248':'#552916');
  }
  function drawHUD(scene) {
    cropDraw('ui-atlas',0,419,15,466,'top');
    const phaseWidth=scene.phase==='LEVEL 1'?210:282;
    pill(421-phaseWidth/2,166,phaseWidth,46,23);text(scene.phase||'LEVEL 1',421,190,24);
    pill(191,219,223,55,25);pill(432,219,223,55,25);
    text('✿',218,247,36,'#d99a24');text('PURL',278,247,22,'#c51640');text(scene.counts[0]+' / 3',361,247,24);
    text('✿',458,247,36,'#d99a24');text('LOOP',519,247,22,'#067e8d');text(scene.counts[1]+' / 3',603,247,24);
    const wide=scene.id==='finish';pill(wide?195:245,285,wide?451:354,52,24);
    text(scene.objective,421,312,wide?29:19);
    if(scene.id==='finish'){pill(269,350,306,42,21);text('1st PURL',354,371,21,'#c51640');text('·',422,371,21);text('2nd LOOP',492,371,21,'#067e8d');}
    pill(750,43,67,73,28);ctx.fillStyle='#643419';roundRect(770,64,7,31,3);ctx.fill();roundRect(785,64,7,31,3);ctx.fill();
    if(scene.action){
      const y=1637,h=100;
      pill(205,y,435,h,33);const g=ctx.createLinearGradient(0,y,0,y+h);g.addColorStop(0,'#03a7ae');g.addColorStop(1,'#007685');ctx.fillStyle=g;roundRect(224,y+16,397,h-31,27);ctx.fill();ctx.strokeStyle='#83dfd1';ctx.lineWidth=2;ctx.stroke();
      text(scene.action,423,y+48,32,'#fff8e5');
    }
    if(scene.callout)drawCallout(scene.callout);
    pill(55,1741,732,73,27);text('SAVED REWARDS',87,1778,17,'#603319',700,'left');
    ctx.fillStyle='#e8ceb2';roundRect(251,1763,172,29,14);ctx.fill();ctx.fillStyle='#f24c7d';roundRect(253,1765,91,25,12);ctx.fill();ctx.strokeStyle='#ff9db0';ctx.lineWidth=2;ctx.stroke();
    for(const x of [463,519]){ctx.fillStyle='#e8ceb2';ctx.beginPath();ctx.arc(x,1777,18,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#aaa398';roundRect(570,1753,194,48,22);ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#cdc5b7';ctx.stroke();
    ctx.strokeStyle='#fffaf0';ctx.lineWidth=3;ctx.beginPath();ctx.arc(602,1771,6,Math.PI,0);ctx.stroke();ctx.fillStyle='#fffaf0';roundRect(592,1773,20,18,3);ctx.fill();text('CASH OUT',682,1779,19,'#fffaf0',600);
    text('VISUAL FOUNDATION · NO LIVE REWARDS',785,1844,11,'#fff8df',500,'right');
  }
  async function paint() {
    const ticket=++version, scene=scenes[state.index];
    if(!scene)return;
    state.loading=true;state.error=null;state.rendered=false;
    stage.setAttribute('aria-busy','true');$('stage-message').hidden=false;$('stage-message').className='stage-message';$('stage-message').textContent='Loading this scene…';
    updateLabels();
    try {
      const path=state.mode==='approved'?scene.approved:scene.background;
      const base=await loadImage(path);
      if(ticket!==version)return;
      if(state.mode!=='layered'){
        image.src=base.src;image.alt=scene.title+' — '+(state.mode==='approved'?'unchanged approved artwork':'clean scenery plate');image.hidden=false;canvas.hidden=true;
      }else{
        const names=new Set(scene.entities.filter(e=>state.layers[e.kind]).map(e=>e.asset));
        if(state.layers.hud)names.add('ui-atlas');
        const pairs=await Promise.all([...names].map(async name=>[name,await loadImage(atlasPath(name))]));
        if(ticket!==version)return;
        loaded=Object.fromEntries(pairs);ctx.clearRect(0,0,W,H);ctx.drawImage(base,0,0,W,H);
        if(scene.id==='recovery'&&state.layers.actors)drawRecoveryGlow();
        for(const e of [...scene.entities].sort((a,b)=>(a.z||0)-(b.z||0))){
          if(!state.layers[e.kind])continue;
          if(e.id.includes('thread'))glow(e.x,e.y-e.width*.5,e.width*1.25);
          cropDraw(e.asset,e.frame,e.x,e.y,e.width,'bottom',e.rotation||0);
        }
        if(scene.id==='snagged'&&state.layers.actors)drawSnagLoop();
        if(state.layers.hud)drawHUD(scene);
        canvas.setAttribute('aria-label',scene.title+' — layered composition with '+Object.keys(state.layers).filter(k=>state.layers[k]).join(', '));canvas.hidden=false;image.hidden=true;
      }
      state.rendered=true;state.loading=false;$('stage-message').hidden=true;stage.setAttribute('aria-busy','false');
      stage.classList.remove('scene-enter');void stage.offsetWidth;stage.classList.add('scene-enter');
    }catch(error){
      if(ticket!==version)return;
      state.error=error.message;state.loading=false;stopWalkthrough();image.hidden=true;canvas.hidden=true;$('stage-message').textContent=error.message;$('stage-message').className='stage-message error';$('stage-message').hidden=false;stage.setAttribute('aria-busy','false');
    }
    window.dispatchEvent(new CustomEvent('wishweave:render',{detail:getState()}));
  }
  function render(){latestRender=paint();return latestRender;}
  function updateLabels(){
    const s=scenes[state.index],n=String(state.index+1).padStart(2,'0');
    $('stage-kicker').textContent=n+' / '+s.location.toUpperCase();$('mode-badge').textContent=modeCopy[state.mode][0];$('mode-help').textContent=modeCopy[state.mode][1];$('page-count').textContent=n+' / '+String(scenes.length).padStart(2,'0');
    $('scene-location').textContent=n+' · '+s.location.toUpperCase();$('scene-title').textContent=s.title;$('scene-description').textContent=s.description;$('scene-direction').textContent=s.direction;
    $('beat-before').textContent=s.before;$('beat-after').textContent=s.after;
    $('purl-count').textContent=s.counts[0]+' / 3 threads';$('loop-count').textContent=s.counts[1]+' / 3 threads';
    $('previous').disabled=previousIndex()<0;$('next').disabled=nextIndex()<0;
    for(const b of document.querySelectorAll('[data-scene]')){const on=Number(b.dataset.scene)===state.index;if(on)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');}
    for(const b of document.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===state.mode));
    $('layer-toggles').hidden=state.mode!=='layered';
    for(const b of document.querySelectorAll('[data-route]'))b.setAttribute('aria-pressed',String(b.dataset.route===state.route));
    $('route-help').textContent=state.route==='hit'?'The approved example shows one lost thread, then a safe recovery.':'A successful dodge keeps Purl at 2 / 3. The guided tour skips the hit and recovery images and continues to the butterfly.';
    $('dodge-next').hidden=!(s.id==='tassels'&&state.route==='dodge');
  }
  function routeIndices(){return state.route==='dodge'?[0,1,2,5,6]:scenes.map((_,i)=>i);}
  function nextIndex(){return routeIndices().find(i=>i>state.index)??-1;}
  function previousIndex(){return routeIndices().filter(i=>i<state.index).at(-1)??-1;}
  function setScene(value){
    const index=typeof value==='string'?scenes.findIndex(s=>s.id===value):Number(value);
    if(!Number.isInteger(index)||index<0||index>=scenes.length)throw new Error('Unknown scene: '+value);
    if(index===3||index===4)state.route='hit';
    state.index=index;return render();
  }
  function setRoute(route){if(!['hit','dodge'].includes(route))throw new Error('Unknown story route: '+route);state.route=route;if(route==='dodge'&&(state.index===3||state.index===4))state.index=5;return render();}
  function setMode(mode){if(!modeCopy[mode])throw new Error('Unknown mode: '+mode);state.mode=mode;return render();}
  function setLayer(layer,enabled){if(!(layer in state.layers))throw new Error('Unknown layer: '+layer);state.layers[layer]=Boolean(enabled);const checkbox=document.querySelector('[name="'+layer+'"]');if(checkbox)checkbox.checked=state.layers[layer];return render();}
  async function revealUserSelection(pending){
    await pending;
    // The mobile controls sit below the artwork. Bring a user's new selection
    // into view without changing the scroll position for programmatic authoring.
    if(window.innerWidth<=620&&state.rendered){
      stage.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    }
  }
  function stopWalkthrough(){
    clearInterval(timer);timer=null;state.autoplay=false;$('autoplay').setAttribute('aria-pressed','false');$('autoplay').innerHTML='<span aria-hidden="true">▷</span> Start guided visual tour';
  }
  function startWalkthrough(){
    stopWalkthrough();if(state.index===scenes.length-1)setScene(0);
    state.autoplay=true;$('autoplay').setAttribute('aria-pressed','true');$('autoplay').innerHTML='<span aria-hidden="true">Ⅱ</span> Pause guided visual tour';
    timer=setInterval(()=>{if(state.loading)return;const next=nextIndex();if(next<0){stopWalkthrough();return;}setScene(next);},8000);
  }
  function getState(){return {...state,layers:{...state.layers},scene:scenes[state.index]?.id,routeScenes:routeIndices().map(i=>scenes[i].id),designSize:[W,H],gameplayImplemented:false,payoutsEnabled:false};}
  function fitStage(){
    const wrap=stage.parentElement;
    const scale=Math.min(wrap.clientWidth/W,wrap.clientHeight/H);
    stage.style.width=(W*scale)+'px';stage.style.height=(H*scale)+'px';
  }
  scenes.forEach((s,i)=>{const b=document.createElement('button');b.type='button';b.className='scene-tab';b.dataset.scene=i;b.innerHTML='<span class="tab-index">'+String(i+1).padStart(2,'0')+'</span><span class="tab-name">'+s.label+'</span><span class="tab-arrow" aria-hidden="true">↗</span>';b.addEventListener('click',()=>{stopWalkthrough();revealUserSelection(setScene(i));});$('scene-tabs').append(b);});
  $('previous').addEventListener('click',()=>{stopWalkthrough();const previous=previousIndex();if(previous>=0)revealUserSelection(setScene(previous));});
  $('next').addEventListener('click',()=>{stopWalkthrough();const next=nextIndex();if(next>=0)revealUserSelection(setScene(next));});
  for(const b of document.querySelectorAll('[data-mode]'))b.addEventListener('click',()=>revealUserSelection(setMode(b.dataset.mode)));
  for(const input of document.querySelectorAll('.layer-toggles input'))input.addEventListener('change',()=>setLayer(input.name,input.checked));
  for(const b of document.querySelectorAll('[data-route]'))b.addEventListener('click',()=>{stopWalkthrough();revealUserSelection(setRoute(b.dataset.route));});
  $('dodge-next').addEventListener('click',()=>{stopWalkthrough();revealUserSelection(setScene('butterfly'));});
  $('autoplay').addEventListener('click',()=>{if(state.autoplay)stopWalkthrough();else{startWalkthrough();revealUserSelection(latestRender);}});
  document.addEventListener('keydown',event=>{
    if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)||event.altKey||event.ctrlKey||event.metaKey)return;
    if(event.key==='ArrowRight'&&nextIndex()>=0){event.preventDefault();stopWalkthrough();revealUserSelection(setScene(nextIndex()));}
    if(event.key==='ArrowLeft'&&previousIndex()>=0){event.preventDefault();stopWalkthrough();revealUserSelection(setScene(previousIndex()));}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopWalkthrough();});
  if(window.ResizeObserver)new ResizeObserver(fitStage).observe(stage.parentElement);
  window.addEventListener('resize',fitStage);fitStage();
  window.WishweaveVisual={setScene,setMode,setLayer,setRoute,getState,startWalkthrough,stopWalkthrough,pause:stopWalkthrough,whenReady:()=>latestRender,scenes,designSize:[W,H]};
  if(!scenes.length){$('stage-message').textContent='No scene data found. Check that scene-data.js is next to index.html.';return;}
  render();
})();
