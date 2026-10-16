/* Verifies the generated portable exports, not gameplay or a native APK. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const kit = path.resolve(__dirname, '..');
const out = path.dirname(kit);
const files = ['Preview-Wishweave-Level1-Complete-Small.html','Wishweave-Level1-Complete-For-Claude.html'];
const ids = ['ribbon','shortcut','tassels','snagged','recovery','butterfly','finish'];
const report = {kind:'Portable HTML export verification',testedAt:new Date().toISOString(),exports:[]};
(async()=>{
 let browser;
 try {
   const mod = process.env.WW_CHROMIUM_MODULE ? require(process.env.WW_CHROMIUM_MODULE) : null;
   browser=await chromium.launch({executablePath:process.env.WW_CHROMIUM_EXECUTABLE,args:mod?(mod.default||mod).args:[],headless:true});
   report.browserVersion=browser.version();
   const page=await browser.newPage({viewport:{width:390,height:866},reducedMotion:'reduce'});
   for(const name of files){
     const errors=[],failed=[],network=[];
     page.on('pageerror',e=>errors.push(e.message));
     page.on('requestfailed',r=>failed.push(r.url()));
     page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
     await page.goto(pathToFileURL(path.join(out,name)).href);
     await page.waitForFunction(()=>window.WishweaveVisual?.getState().rendered);
     assert.equal(await page.evaluate(()=>WishweaveVisual.getState().mode),'approved');
     const cases=[];
     for(const mode of ['approved','scenery','layered']){
       await page.evaluate(m=>WishweaveVisual.setMode(m),mode);
       for(const id of ids){
         const state=await page.evaluate(async id=>{await WishweaveVisual.setScene(id);return WishweaveVisual.getState();},id);
         assert.equal(state.error,null);assert.equal(state.rendered,true);
         cases.push({mode,id,passed:true});
       }
     }
     await page.evaluate(async()=>{await WishweaveVisual.setRoute('dodge');await WishweaveVisual.setScene('tassels');});
     await page.locator('#next').click();
     await page.evaluate(()=>WishweaveVisual.whenReady());
     assert.equal(await page.evaluate(()=>WishweaveVisual.getState().scene),'butterfly');
     await page.evaluate(async()=>{await WishweaveVisual.setRoute('hit');await WishweaveVisual.setScene('tassels');});
     await page.locator('#next').click();
     await page.evaluate(()=>WishweaveVisual.whenReady());
     assert.equal(await page.evaluate(()=>WishweaveVisual.getState().scene),'snagged');
     await page.evaluate(async()=>{await WishweaveVisual.setMode('approved');await WishweaveVisual.setScene('ribbon');scrollTo(0,0);});
     const fit=await page.evaluate(()=>{const r=document.getElementById('stage').getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth};});
     assert.equal(fit.overflow,false);assert.ok(fit.top>=-1 && fit.bottom<=867);
     if(name.includes('Small')){
       assert.ok(fs.statSync(path.join(out,name)).size<5000000);
       fs.mkdirSync(path.join(out,'.complete-export-qa'),{recursive:true});
       await page.locator('#stage').screenshot({path:path.join(out,'.complete-export-qa/mobile-preview.png')});
     }else assert.ok(fs.statSync(path.join(out,name)).size<100000);
     assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(network,[]);
     report.exports.push({name,bytes:fs.statSync(path.join(out,name)).size,cases,branchNavigationPassed:true,mobileFit:fit,errors,failedRequests:failed,networkRequests:network});
     page.removeAllListeners('pageerror');page.removeAllListeners('requestfailed');page.removeAllListeners('request');
   }
   report.passed=true;
 }catch(e){report.passed=false;report.error=e.stack;process.exitCode=1;}
 finally {if(browser)await browser.close();fs.writeFileSync(path.join(kit,'tests/export-checks.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,exports:report.exports.map(x=>({name:x.name,bytes:x.bytes,sceneModes:x.cases.length})),error:report.error},null,2));}
})();
