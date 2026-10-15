import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const baseURL=process.env.TEST_URL||'http://127.0.0.1:6162';
const output=resolve(root,'test-results','continuity');
const source=await readFile(resolve(root,'server/api.mjs'),'utf8');
const password=process.env.PORTAL_PASSWORD||source.match(/const DEFAULT_PASSWORD = ['"]([^'"]+)['"]/)[1];
const report={baseURL,checks:[],screenshots:[],pageErrors:[],requestFailures:[],failures:[]};
mkdirSync(output,{recursive:true});
function save(){writeFileSync(resolve(output,'continuity-qa.json'),JSON.stringify(report,null,2));}
function check(name,data={}){report.checks.push({name,...data});save();console.log(`PASS ${name}`);}
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function shot(page,name){await page.screenshot({path:resolve(output,name),animations:'disabled',timeout:20000});report.screenshots.push(name);save();console.log(`SCREENSHOT ${name}`);}
function observe(page,label){page.on('pageerror',error=>{report.pageErrors.push({label,message:error.message});save();});page.on('requestfailed',request=>{const message=request.failure()?.errorText||'';if(!message.includes('ERR_ABORTED')){report.requestFailures.push({label,url:request.url(),message});save();}});}
async function topAlign(page,selector){await page.locator(selector).evaluate(element=>window.scrollTo({top:scrollY+element.getBoundingClientRect().top,behavior:'instant'}));}
async function activeMoment(page,moment,timeout=30000){await page.waitForFunction(moment=>{const d=document.querySelector('#film-dialog'),v=document.querySelector('.cinema-video.is-active');return d.open&&d.dataset.moment===moment&&v?.readyState>=2&&!v.paused;},moment,{timeout});}
async function endCurrent(page){await page.locator('.cinema-video.is-active').evaluate(async video=>{video.currentTime=Math.max(0,video.duration-.15);await video.play();});}
async function login(page){await expect(page.locator('#login-dialog')).toBeVisible();await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click();await expect(page.locator('#login-dialog')).not.toBeVisible();await expect(page.locator('#portrait-grid figure')).toHaveCount(3);}
async function assertBackdrop(page,label){
  const coverage=await page.evaluate(()=>{const world=document.querySelector('#story-world'),canvas=document.querySelector('#universe'),archive=document.querySelector('#archive'),w=world.getBoundingClientRect(),c=canvas.getBoundingClientRect(),a=archive.getBoundingClientRect();return{canvas:{x:c.x,y:c.y,width:c.width,height:c.height,bottom:c.bottom},archive:{y:a.y,bottom:a.bottom},worldBottom:w.bottom,viewport:[innerWidth,innerHeight],opacity:getComputedStyle(canvas).opacity,hidden:canvas.hidden,archiveBackground:getComputedStyle(archive).backgroundColor,position:getComputedStyle(canvas).position};});
  assert.equal(coverage.hidden,false);assert.ok(Number(coverage.opacity)>0);assert.ok(coverage.canvas.width>=coverage.viewport[0]-1);assert.ok(coverage.canvas.y<=Math.max(0,coverage.archive.y)+1);assert.ok(coverage.canvas.bottom>=Math.min(coverage.viewport[1],coverage.archive.bottom)-1);assert.ok(Math.abs(coverage.worldBottom-coverage.archive.bottom)<2);check(`${label} particle canvas covers the archive through its end`,coverage);
}
async function visualAndNormal(viewport,label){
  const context=await browser.newContext({viewport,reducedMotion:'reduce',deviceScaleFactor:1});const page=await context.newPage();page.setDefaultTimeout(15000);observe(page,label);
  try{
    await page.goto(baseURL,{waitUntil:'domcontentloaded',timeout:25000});await page.locator('#play-intro').click();
    for(const moment of ['intro','touch','warp','platform']){
      await activeMoment(page,moment);await expect(page.locator('#film-loading')).not.toBeVisible();
      if(label==='mobile')await endCurrent(page);
      const next={intro:'touch',touch:'warp',warp:'platform'}[moment];
      if(next)await activeMoment(page,next,35000);else await expect(page.locator('#login-dialog')).toBeVisible({timeout:35000});
      check(`${label} normal ${moment} ends and advances`,{playback:label==='desktop'?'uninterrupted natural duration':'natural ended event after seek'});
    }
    await login(page);check(`${label} full opening sequence reaches a working archive sign in`);
    await topAlign(page,'#archive');await page.waitForFunction(()=>document.querySelector('#universe').width>0);await assertBackdrop(page,`${label} archive top`);await shot(page,`01-archive-top-${label}.png`);
    await page.locator('.source-copy summary').click();
    await page.locator('#archive').evaluate(element=>window.scrollTo({top:scrollY+element.getBoundingClientRect().bottom-innerHeight,behavior:'instant'}));
    await assertBackdrop(page,`${label} expanded archive bottom`);await shot(page,`02-archive-bottom-${label}.png`);
    await topAlign(page,'#message-section');await page.waitForFunction(()=>!document.querySelector('#message-video').paused&&!document.querySelector('#music').paused,null,{timeout:25000});check(`${label} inline message and soundtrack still start together`);
    await topAlign(page,'#celebration');await page.waitForFunction(()=>document.querySelector('#heart-stage').classList.contains('has-webgl'));await page.waitForTimeout(250);await shot(page,`03-heart-${label}.png`);
    const heart=await page.locator('#heart-stage').boundingBox();assert.ok(heart.width<=240&&heart.height<=260);const alpha=await page.locator('#heart-canvas').evaluate(canvas=>(canvas.getContext('webgl2')||canvas.getContext('webgl')).getContextAttributes().alpha);assert.equal(alpha,true);check(`${label} miniature heart remains transparent and correctly sized`,heart);
    if(label==='desktop'){
      for(let attempt=0;attempt<3;attempt++){
        await topAlign(page,'#home');await page.locator('#play-intro').click();if(attempt===0){await activeMoment(page,'intro');}await page.keyboard.press('Escape');await expect(page.locator('#film-dialog')).not.toBeVisible();
      }
      await page.locator('#play-intro').click();await activeMoment(page,'intro');await page.waitForTimeout(250);assert.ok((await page.locator('.cinema-video.is-active').evaluate(video=>video.currentSrc)).includes('/stream/intro-'));await page.keyboard.press('Escape');check('repeated open and close cannot commit an old scene');
    }
    const widths=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert.ok(widths.document<=widths.viewport+1&&widths.body<=widths.viewport+1);check(`${label} has no horizontal overflow`,widths);
  }finally{await context.close();}
}
async function delayedHandoff(){
  const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});const page=await context.newPage();page.setDefaultTimeout(15000);observe(page,'delayed handoff');
  let release;const gate=new Promise(resolve=>release=resolve);let requested=false;
  await page.route('**/media/stream/touch.mp4',async route=>{requested=true;await gate;await route.continue().catch(()=>{});});
  try{
    await page.goto(baseURL,{waitUntil:'domcontentloaded'});await page.locator('#play-intro').click();await activeMoment(page,'intro');await endCurrent(page);
    await expect.poll(()=>requested,{timeout:15000}).toBe(true);await page.waitForTimeout(1100);
    const held=await page.locator('.cinema-video.is-active').evaluate(video=>({src:video.currentSrc,time:video.currentTime,duration:video.duration,readyState:video.readyState,ended:video.ended}));
    assert.ok(held.src.includes('/stream/intro-'));assert.ok(held.readyState>=2);assert.ok(held.time>=held.duration-.3);check('delayed incoming clip retains the outgoing decoded ending',held);await shot(page,'04-delayed-last-frame-desktop.png');
    release();await activeMoment(page,'touch',30000);await expect(page.locator('#film-loading')).not.toBeVisible();check('delayed incoming clip eventually advances and clears buffering state');
  }finally{release();await context.close();}
}
async function failedClipRecovery(){
  for(const action of ['retry','skip']){
    const context=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'});const page=await context.newPage();page.setDefaultTimeout(15000);observe(page,`clip recovery ${action}`);
    const pattern='**/media/stream/crossing.mp4';let failed=0;
    const failRoute=async route=>{failed++;await route.fulfill({status:404,contentType:'text/plain',body:'Deliberate QA missing clip'});};
    await page.route(pattern,failRoute);
    try{
      await page.goto(baseURL,{waitUntil:'domcontentloaded'});await page.locator('[data-film=warp]').click();
      await expect(page.locator('#film-recovery')).toBeVisible({timeout:30000});await expect(page.locator('#film-retry')).toBeVisible();await expect(page.locator('#film-skip')).toBeVisible();await expect(page.locator('#film-loading')).not.toBeVisible();assert.ok(failed>0);
      if(action==='retry'){
        check('failed clip exposes visible retry and continue without an endless loader');await shot(page,'05-visible-error-recovery-desktop.png');
        await page.unroute(pattern,failRoute);await page.locator('#film-retry').click();await activeMoment(page,'warp',30000);await expect(page.locator('#film-recovery')).not.toBeVisible();check('visible retry restores playback after a failed clip');
      }else{
        await page.locator('#film-skip').click();await activeMoment(page,'platform',30000);await expect(page.locator('#film-recovery')).not.toBeVisible();check('visible continue skips a failed clip to a playable moment');
      }
    }finally{await context.close();}
  }
}
async function stage(name,work){try{await work();}catch(error){report.failures.push({stage:name,message:error.message});save();console.error(`FAIL ${name}: ${error.message}`);}}
try{
  await stage('desktop normal flow and visual coverage',()=>visualAndNormal({width:1440,height:960},'desktop'));
  await stage('mobile normal flow and visual coverage',()=>visualAndNormal({width:390,height:844},'mobile'));
  await stage('delayed handoff',delayedHandoff);
  await stage('failed clip recovery',failedClipRecovery);
}finally{await browser.close();save();}
console.log(`Completed ${report.checks.length} checks; ${report.screenshots.length} screenshots; ${report.pageErrors.length} JS errors; ${report.requestFailures.length} unexpected request failures; ${report.failures.length} failed stages.`);
if(report.failures.length||report.pageErrors.length||report.requestFailures.length)process.exitCode=1;
