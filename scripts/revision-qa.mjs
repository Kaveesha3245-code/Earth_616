import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const baseURL=process.env.TEST_URL||'http://127.0.0.1:6162';
const output=resolve(root,'test-results','revision');
const source=await readFile(resolve(root,'server/api.mjs'),'utf8');
const password=process.env.PORTAL_PASSWORD||source.match(/const DEFAULT_PASSWORD = ['"]([^'"]+)['"]/)[1];
const report={baseURL,checks:[],screenshots:[],pageErrors:[],requestFailures:[],failures:[]};
mkdirSync(output,{recursive:true});
function save(){writeFileSync(resolve(output,'revision-qa.json'),JSON.stringify(report,null,2));}
function check(name,data={}){report.checks.push({name,...data});save();console.log(`PASS ${name}`);}
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function screenshot(page,name){await page.screenshot({path:resolve(output,name),animations:'disabled',timeout:20000});report.screenshots.push(name);save();console.log(`SCREENSHOT ${name}`);}
async function topAlign(page,selector){await page.locator(selector).evaluate(element=>window.scrollTo({top:scrollY+element.getBoundingClientRect().top,behavior:'instant'}));}
async function noOverflow(page,label){const size=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert.ok(size.document<=size.viewport+1&&size.body<=size.viewport+1,JSON.stringify(size));check(`${label} has no horizontal overflow`,size);}
async function darkBackgrounds(page,selectors,label){
  const result=await page.evaluate(selectors=>selectors.map(selector=>{let element=document.querySelector(selector),background='';while(element){background=getComputedStyle(element).backgroundColor;const components=background.match(/[\d.]+/g)?.map(Number)||[];if(components.length===3||components[3]>0)break;element=element.parentElement;}return{selector,background};}),selectors);
  for(const item of result){const rgb=item.background.match(/[\d.]+/g).map(Number);assert.ok(Math.max(...rgb.slice(0,3))<70,`${item.selector}: ${item.background}`);}check(`${label} backgrounds remain dark`,{backgrounds:result});
}
async function roundedVisible(page,label){
  const elements=await page.evaluate(()=>[...document.querySelectorAll('button,input,img')].filter(element=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)>0;}).map(element=>({tag:element.tagName,id:element.id,radius:getComputedStyle(element).borderTopLeftRadius})));
  assert.ok(elements.length);assert.deepEqual(elements.filter(element=>parseFloat(element.radius)<=0),[]);check(`${label} visible buttons, inputs and images have rounded corners`,{elements});
}
async function run(viewport,label){
  const context=await browser.newContext({viewport,reducedMotion:'reduce',deviceScaleFactor:1});
  await context.addInitScript(()=>{
    window.__qaAudioContexts=[];
    const Native=window.AudioContext||window.webkitAudioContext;
    if(Native){class ObservedAudioContext extends Native{constructor(...args){super(...args);this.__qaGains=[];const create=this.createGain.bind(this);this.createGain=(...params)=>{const node=create(...params);this.__qaGains.push(node);return node;};window.__qaAudioContexts.push(this);}}window.AudioContext=ObservedAudioContext;if(window.webkitAudioContext)window.webkitAudioContext=ObservedAudioContext;}
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',error=>{report.pageErrors.push({label,message:error.message});save();});
  page.on('requestfailed',request=>{const message=request.failure()?.errorText||'';if(!message.includes('ERR_ABORTED')){report.requestFailures.push({label,url:request.url(),message});save();}});
  try{
    await page.goto(baseURL,{waitUntil:'domcontentloaded',timeout:25000});
    await expect(page.locator('#hero-title')).toBeVisible();
    await expect(page.locator('#gallery,#upload-dialog,#moderation-dialog,#share-memory,#moderation-toggle')).toHaveCount(0);
    await expect(page.locator('.masthead nav,.masthead .access-button')).toHaveCount(0);
    assert.ok(!(await page.locator('.hero-topline').textContent()).includes('EST. IN EVERY UNIVERSE'));
    await expect(page.locator('#music-button,#watch-message')).toHaveCount(0);check(`${label} marked gallery, navigation, badge and manual message controls removed`);
    await noOverflow(page,`${label} hero`);await roundedVisible(page,`${label} hero`);
    await screenshot(page,`01-hero-${label}.png`);
    await page.locator('#play-intro').click();await expect(page.locator('#film-dialog')).toBeVisible();
    await page.waitForFunction(()=>{const v=document.querySelector('.cinema-video.is-active');return v?.readyState>=2&&!v.paused;},null,{timeout:25000});
    await page.locator('.cinema-video.is-active').evaluate(video=>{video.pause();video.currentTime=1.5;});
    await expect(page.locator('#film-chapter,.cinema-actions,.cinema-progress,.cinema-segments')).toHaveCount(0);
    const bounds=await page.locator('.cinema-video.is-active').boundingBox();assert.ok(Math.abs(bounds.x)<=1&&Math.abs(bounds.y)<=1&&Math.abs(bounds.width-viewport.width)<=1&&Math.abs(bounds.height-viewport.height)<=1);
    const hiddenControls=await page.locator('.cinema-a11y-controls').evaluate(element=>{const r=element.getBoundingClientRect();return r.right<=0||r.left>=innerWidth||r.bottom<=0||r.top>=innerHeight;});assert.equal(hiddenControls,true);
    await expect(page.locator('#film-label')).toContainText('Follow the light');check(`${label} fullscreen film retains only requested visible chrome`,{bounds});
    await screenshot(page,`02-film-${label}.png`);
    await page.locator('.cinema-video.is-active').evaluate(async video=>{video.currentTime=video.duration-.12;await video.play();});
    await page.waitForFunction(()=>document.querySelector('#film-dialog').dataset.moment==='touch'&&document.querySelector('.cinema-video.is-active').currentSrc.includes('media2-1080')&&!document.querySelector('.cinema-video.is-active').paused,null,{timeout:25000});check(`${label} film ending automatically advances to the next moment`);
    await page.keyboard.press('Escape');await expect(page.locator('#film-dialog')).not.toBeVisible();
    await topAlign(page,'#archive');await darkBackgrounds(page,['#archive','#archive-locked'],`${label} locked archive`);
    await page.locator('[data-open-login]').click();await expect(page.locator('#login-dialog')).toBeVisible();await roundedVisible(page,`${label} sign in`);await darkBackgrounds(page,['#login-dialog'],`${label} sign in`);
    await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click();await expect(page.locator('#login-dialog')).not.toBeVisible();await expect(page.locator('#portrait-grid figure')).toHaveCount(3);
    await page.locator('#portrait-grid').scrollIntoViewIfNeeded();await roundedVisible(page,`${label} portraits`);
    await topAlign(page,'#message-section');
    await page.waitForFunction(()=>{const v=document.querySelector('#message-video'),m=document.querySelector('#music');return v.readyState>=2&&!v.paused&&m.readyState>=2&&!m.paused;},null,{timeout:25000});
    const audio=await page.evaluate(()=>({contexts:window.__qaAudioContexts.map(context=>({state:context.state,gains:context.__qaGains.map(node=>node.gain.value)})),videoPaused:document.querySelector('#message-video').paused,musicPaused:document.querySelector('#music').paused,musicMuted:document.querySelector('#music').muted}));assert.ok(audio.contexts.some(context=>context.state==='running'));check(`${label} inline message and soundtrack start automatically after prior gesture`,audio);
    await expect(page.locator('#film-dialog')).not.toBeVisible();await expect(page.locator('#message-resume')).not.toBeVisible();await darkBackgrounds(page,['#archive','#message-section','.message-film'],`${label} message`);await roundedVisible(page,`${label} message`);await noOverflow(page,`${label} message`);
    await screenshot(page,`03-message-${label}.png`);
    await page.locator('#message-video').click({position:{x:20,y:20}});await page.locator('#message-video').evaluate(video=>video.pause());await expect(page.locator('#film-dialog')).not.toBeVisible();await page.waitForFunction(()=>document.querySelector('#music').paused);check(`${label} inline interaction stays in its box and pauses the soundtrack`);
    await topAlign(page,'#home');await page.waitForFunction(()=>document.querySelector('#message-video').paused&&document.querySelector('#music').paused);
    await topAlign(page,'#message-section');await page.waitForFunction(()=>!document.querySelector('#message-video').paused&&!document.querySelector('#music').paused,null,{timeout:20000});check(`${label} message media pauses offscreen and resumes on reentry`);
    await page.locator('#audio-toggle').click();await expect(page.locator('#audio-toggle')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#audio-toggle')).toHaveAttribute('aria-label','Enable audio');await page.waitForFunction(()=>document.querySelector('#music').muted&&document.querySelector('#music').paused);await page.waitForTimeout(1350);
    const mutedGains=await page.evaluate(()=>window.__qaAudioContexts.map(context=>context.__qaGains[0]?.gain.value));assert.ok(mutedGains.every(value=>Math.abs(value)<.001));check(`${label} global mute silences track and procedural master`,{mutedGains});
    await page.locator('#audio-toggle').click();await expect(page.locator('#audio-toggle')).toHaveAttribute('aria-pressed','false');await page.waitForFunction(()=>!document.querySelector('#music').muted&&!document.querySelector('#music').paused);
    await topAlign(page,'#celebration');await expect(page.locator('#birthday-title')).toBeVisible();await page.waitForFunction(()=>document.querySelector('#heart-canvas').width>0);await page.waitForTimeout(200);
    const heart=await page.locator('#heart-stage').evaluate(element=>{const r=element.getBoundingClientRect(),parent=element.closest('section').getBoundingClientRect();return{width:r.width,height:r.height,x:r.x,y:r.y,relativeX:r.x-parent.x,relativeY:r.y-parent.y};});assert.ok(heart.width<=240&&heart.height<=260);assert.ok(heart.relativeY<250);if(viewport.width>760)assert.ok(heart.x+heart.width<viewport.width*.65);check(`${label} heart is small and leaves the flower side clear`,heart);
    await noOverflow(page,`${label} celebration`);await roundedVisible(page,`${label} celebration`);await screenshot(page,`04-celebration-${label}.png`);
    await page.locator('#make-wish').click();await expect(page.locator('#wish-status')).toContainText('Loved beyond every universe');
  }finally{await context.close();}
}
try{
  for(const[viewport,label]of[[{width:1440,height:960},'desktop'],[{width:390,height:844},'mobile']]){try{await run(viewport,label);}catch(error){report.failures.push({label,message:error.message});save();console.error(`FAIL ${label}: ${error.message}`);}}
}finally{await browser.close();save();}
console.log(`Completed ${report.checks.length} checks, ${report.screenshots.length} screenshots; ${report.pageErrors.length} JS errors; ${report.requestFailures.length} request failures; ${report.failures.length} failed stages.`);
if(report.failures.length||report.pageErrors.length||report.requestFailures.length)process.exitCode=1;
