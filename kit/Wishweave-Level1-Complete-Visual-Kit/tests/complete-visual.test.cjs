/* Run: node tests/complete-visual.test.cjs
   Requires Playwright and a Chromium install. Optional: WW_CHROMIUM_EXECUTABLE.
   Optional WW_CHROMIUM_MODULE may name a module exporting Chromium launch args.
   This checks the delivered file:// viewer, not gameplay or an Android APK. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const root = path.resolve(__dirname,'..');
const report = {checkedAt:new Date().toISOString(),kind:'Complete Level 1 offline visual viewer verification',cases:[],limitations:['No native Android build or physical Android device was tested.','The layered scenes are editable assemblies, not pixel-identical recreations of the approved screenshots.','Gameplay, collisions, payouts, and seamless navigation through the environment are not implemented.']};
const ids = ['ribbon','shortcut','tassels','snagged','recovery','butterfly','finish'];
let browser;
async function main(){
  const executablePath = process.env.WW_CHROMIUM_EXECUTABLE;
  let args = [];
  if(process.env.WW_CHROMIUM_MODULE){
    const launchModule=require(process.env.WW_CHROMIUM_MODULE);
    args=(launchModule.default||launchModule).args||[];
  }
  browser=await chromium.launch({headless:true,executablePath,args});
  report.browserVersion=browser.version();
  const page=await browser.newPage({viewport:{width:390,height:866},reducedMotion:'reduce'});
  const errors=[];
  const network=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',req=>{if(/^https?:/.test(req.url()))network.push(req.url());});
  await page.goto(pathToFileURL(path.join(root,'scene/index.html')).href);
  await page.waitForFunction(()=>window.WishweaveVisual?.getState().rendered);
  assert.equal(await page.evaluate(()=>WishweaveVisual.getState().mode),'approved');
  assert.equal(await page.evaluate(()=>WishweaveVisual.scenes.every(s=>s.before&&s.after)),true,'Every screen explains the beats between images');
  fs.mkdirSync(path.join(root,'tests/captures'),{recursive:true});
  for(const mode of ['approved','scenery','layered']){
    await page.evaluate(mode=>WishweaveVisual.setMode(mode),mode);
    for(let i=0;i<ids.length;i++){
      const id=ids[i];
      await page.evaluate(id=>WishweaveVisual.setScene(id),id);
      const state=await page.evaluate(()=>WishweaveVisual.getState());
      assert.equal(state.error,null,mode+' '+id);
      assert.equal(state.rendered,true,mode+' '+id);
      assert.equal(state.loading,false);
      report.cases.push({check:'scene loads',mode,scene:id,passed:true});
      if(mode==='layered'){
        // Browser screenshot preserves file:// security; no canvas pixel export is required.
        await page.setViewportSize({width:1440,height:2090});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const png=await page.locator('#scene-canvas').screenshot();
        fs.writeFileSync(path.join(root,'tests/captures',String(i+1).padStart(2,'0')+'-layered-'+id+'.png'),png);
        await page.setViewportSize({width:390,height:866});
      }
    }
  }
  await page.evaluate(()=>WishweaveVisual.setScene('snagged'));
  for(const name of ['actors','props','hud']){
    const before=await page.locator('#scene-canvas').screenshot();
    await page.locator('input[name="'+name+'"]').uncheck();
    await page.evaluate(()=>WishweaveVisual.whenReady());
    assert.equal(await page.evaluate(n=>WishweaveVisual.getState().layers[n],name),false);
    const after=await page.locator('#scene-canvas').screenshot();
    assert.notDeepEqual(before,after,'Toggling '+name+' must change the rendered image');
    await page.locator('input[name="'+name+'"]').check();
    await page.evaluate(()=>WishweaveVisual.whenReady());
    report.cases.push({check:'layer toggle changes rendered output',layer:name,passed:true});
  }
  for(const [width,height] of [[320,568],[390,866],[412,915],[600,960],[800,412],[1365,950]]){
    await page.setViewportSize({width,height});
    await page.evaluate(()=>scrollTo(0,0));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const layout=await page.evaluate(()=>{
      const r=document.getElementById('stage').getBoundingClientRect();
      return {viewport:[innerWidth,innerHeight],documentWidth:document.documentElement.scrollWidth,stage:{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom},smallControls:[...document.querySelectorAll('button')].filter(e=>{const box=e.getBoundingClientRect();return box.width>0&&box.height>0&&box.height<43.9;}).map(e=>e.textContent.trim())};
    });
    assert.ok(layout.documentWidth<=width+1,'No horizontal overflow');
    assert.ok(Math.abs(layout.stage.width/layout.stage.height-841/1870)<.002,'Portrait ratio retained');
    assert.ok(layout.stage.width<=width+1&&layout.stage.height<=height,'Whole portrait stage fits viewport');
    assert.ok(layout.stage.top>=0&&layout.stage.bottom<=height,'Whole stage is visibly inside the initial viewport');
    assert.equal(layout.smallControls.length,0,'All buttons at least 44px high');
    report.cases.push({check:'responsive layout',...layout,passed:true});
  }
  await page.setViewportSize({width:390,height:866});
  await page.evaluate(()=>WishweaveVisual.setScene('ribbon'));
  await page.locator('#next').click();
  await page.evaluate(()=>WishweaveVisual.whenReady());
  assert.equal(await page.evaluate(()=>WishweaveVisual.getState().scene),'shortcut');
  await page.locator('[data-scene="5"]').click();
  await page.evaluate(()=>WishweaveVisual.whenReady());
  assert.equal(await page.evaluate(()=>WishweaveVisual.getState().scene),'butterfly');
  await page.waitForFunction(()=>{const r=document.getElementById('stage').getBoundingClientRect();return r.top>=-1&&r.bottom<=innerHeight+1;});
  await page.locator('[data-mode="approved"]').click();
  await page.evaluate(()=>WishweaveVisual.whenReady());
  assert.equal(await page.evaluate(()=>WishweaveVisual.getState().mode),'approved');
  await page.waitForFunction(()=>{const r=document.getElementById('stage').getBoundingClientRect();return r.top>=-1&&r.bottom<=innerHeight+1;});
  await page.evaluate(()=>{WishweaveVisual.startWalkthrough();WishweaveVisual.pause();});
  assert.equal(await page.evaluate(()=>WishweaveVisual.getState().autoplay),false);
  report.cases.push({check:'next button, scene tabs, mobile selection scrolls preview into view, mode buttons and native pause API',passed:true});
  await page.evaluate(async()=>{await WishweaveVisual.setScene('tassels');await WishweaveVisual.setRoute('dodge');});
  await page.locator('#next').click();
  await page.evaluate(()=>WishweaveVisual.whenReady());
  assert.equal(await page.evaluate(()=>WishweaveVisual.getState().scene),'butterfly');
  assert.deepEqual(await page.evaluate(()=>WishweaveVisual.scenes[WishweaveVisual.getState().index].counts),[2,2]);
  await page.evaluate(async()=>{await WishweaveVisual.setRoute('hit');await WishweaveVisual.setScene('tassels');});
  await page.locator('#next').click();
  await page.evaluate(()=>WishweaveVisual.whenReady());
  assert.equal(await page.evaluate(()=>WishweaveVisual.getState().scene),'snagged');
  await page.locator('#next').click();
  await page.evaluate(()=>WishweaveVisual.whenReady());
  assert.equal(await page.evaluate(()=>WishweaveVisual.getState().scene),'recovery');
  assert.deepEqual(await page.evaluate(()=>WishweaveVisual.scenes[WishweaveVisual.getState().index].counts),[2,2]);
  report.cases.push({check:'guided route branches preserve thread counts: successful dodge skips hit and recovery; shown hit restores the dropped thread',passed:true});
  const props=fs.readFileSync(path.join(root,'assets/props-atlas.png')).toString('base64');
  const alpha=await page.evaluate(async data=>{
    const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
    const x=c.getContext('2d');x.fillStyle='#21b7cc';x.fillRect(0,0,c.width,c.height);x.drawImage(img,0,0);
    const points=[[0,0],[700,10],[1535,1023]];
    return points.map(([a,b])=>({point:[a,b],pixel:[...x.getImageData(a,b,1,1).data]}));
  },props);
  for(const p of alpha)assert.deepEqual(p.pixel,[33,183,204,255],'Transparent padding reveals the backdrop, not hidden RGB');
  report.cases.push({check:'RGBA props transparency composites correctly in Chromium',samples:alpha,passed:true});
  const standalone=process.env.WW_STANDALONE_PATH;
  if(standalone&&fs.existsSync(standalone)){
    await page.goto(pathToFileURL(standalone).href);
    await page.waitForFunction(()=>window.WishweaveVisual?.getState().rendered);
    for(const mode of ['approved','scenery','layered']){
      await page.evaluate(mode=>WishweaveVisual.setMode(mode),mode);
      for(const id of ids){await page.evaluate(id=>WishweaveVisual.setScene(id),id);const state=await page.evaluate(()=>WishweaveVisual.getState());assert.equal(state.error,null);assert.equal(state.rendered,true);}
    }
    report.cases.push({check:'self-contained HTML loads all seven scenes in all three modes via file://',passed:true});
  }else report.standalone='Not present at test time; requires separate verification after build.';
  assert.equal(errors.length,0,'No uncaught browser errors');
  assert.equal(network.length,0,'No network requests');
  report.cases.push({check:'no uncaught browser errors or network requests',passed:true});
  report.passed=true;
  fs.writeFileSync(path.join(root,'tests/browser-checks.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:true,cases:report.cases.length,standalone:report.standalone||'verified',browserVersion:report.browserVersion},null,2));
}
main().catch(e=>{report.passed=false;report.error=e.stack;fs.writeFileSync(path.join(root,'tests/browser-checks.json'),JSON.stringify(report,null,2)+'\n');console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
