import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),baseURL=process.env.TEST_URL||'http://127.0.0.1:6162';
const output=resolve(root,'test-results','section-media');mkdirSync(output,{recursive:true});
const server=await readFile(resolve(root,'server/api.mjs'),'utf8');
const password=process.env.PORTAL_PASSWORD||server.match(/const DEFAULT_PASSWORD = ['"]([^'"]+)['"]/)[1];
const followup=process.argv.includes('--followup');
const report={baseURL,checks:[],screenshots:[],pageErrors:[],requestFailures:[],oldMediaRequests:[],failures:[]};
function save(){writeFileSync(resolve(output,followup?'section-media-followup.json':'section-media-qa.json'),JSON.stringify(report,null,2));}
function check(name,data={}){report.checks.push({name,...data});save();console.log(`PASS ${name}`);}
async function shot(page,name){await page.screenshot({path:resolve(output,name),animations:'disabled',timeout:20000});report.screenshots.push(name);save();console.log(`SCREENSHOT ${name}`);}
async function top(page,selector){await page.locator(selector).evaluate(element=>window.scrollTo({top:scrollY+element.getBoundingClientRect().top,behavior:'instant'}));}
async function section(page,name,muted=false){
  await page.waitForFunction(({name,muted})=>{const audio=document.querySelector(`audio[data-section-track="${name}"]`),button=document.querySelector('#audio-toggle');return document.body.dataset.audioSection===name&&button.dataset.musicSection===name&&audio?.readyState>=2&&!audio.paused&&audio.muted===muted;},{name,muted},{timeout:18000});
  const state=await page.locator('audio[data-section-track]').evaluateAll(audios=>audios.map(audio=>({name:audio.dataset.sectionTrack,src:audio.currentSrc,paused:audio.paused,muted:audio.muted,time:audio.currentTime,duration:audio.duration,controls:audio.controls})));
  assert.equal(state.filter(audio=>!audio.paused).length,1);return state;
}
async function advancingClock(page,name){
  const selector=`audio[data-section-track="${name}"]`;
  const before=await page.locator(selector).evaluate(audio=>({time:audio.currentTime,duration:audio.duration}));
  let after,delta;
  await expect.poll(async()=>{after=await page.locator(selector).evaluate(audio=>audio.currentTime);delta=(after-before.time+before.duration)%before.duration;return delta>.15&&delta<3;},{timeout:3500}).toBe(true);
  return{before:before.time,after,delta,duration:before.duration};
}
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
async function run(viewport,label){
  const context=await browser.newContext({viewport,reducedMotion:'reduce',deviceScaleFactor:1});
  await context.addInitScript(()=>{
    window.__qaAudioContexts=0;window.__qaAudioSamples=[];
    const Native=window.AudioContext||window.webkitAudioContext;
    if(Native){class CountedContext extends Native{constructor(...args){super(...args);window.__qaAudioContexts++;}}window.AudioContext=CountedContext;if(window.webkitAudioContext)window.webkitAudioContext=CountedContext;}
    setInterval(()=>{const audio=[...document.querySelectorAll('audio[data-section-track]')];if(audio.length&&window.__qaAudioSamples.length<20000)window.__qaAudioSamples.push({playing:audio.filter(item=>!item.paused).map(item=>item.dataset.sectionTrack),section:document.body?.dataset.audioSection});},35);
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>{report.pageErrors.push({label,message:error.message});save();});
  page.on('requestfailed',request=>{const message=request.failure()?.errorText||'';if(!message.includes('ERR_ABORTED')){report.requestFailures.push({label,url:request.url(),message});save();}});
  page.on('request',request=>{if(/(?:the-first-time\.mp3|media8-1080\.mp4|\/src\/audio\.js)(?:\?|$)/.test(request.url())){report.oldMediaRequests.push({label,url:request.url()});save();}});
  try{
    await page.goto(baseURL,{waitUntil:'domcontentloaded',timeout:25000});
    await expect(page.locator('audio[data-section-track]')).toHaveCount(3);await expect(page.locator('#music')).toHaveCount(0);
    const sources=await page.locator('audio[data-section-track]').evaluateAll(audios=>audios.map(audio=>({name:audio.dataset.sectionTrack,src:audio.getAttribute('src'),controls:audio.controls,hidden:audio.hidden,loop:audio.loop})));
    assert.deepEqual(sources.map(item=>item.name),['journey','archive','celebration']);
    for(const item of sources){assert.equal(item.controls,false);assert.equal(item.hidden,true);assert.equal(item.loop,true);}
    assert.deepEqual(sources.map(item=>item.src),['/media/audio/journey-avengers.mp3','/media/audio/first-time.mp3','/media/audio/call-this-love.mp3']);check(`${label} has exactly three distinct native section tracks and mute-only controls`,{sources});
    await page.locator('#hero-title').click();let state=await section(page,'journey');
    const journey=state.find(item=>item.name==='journey');assert.ok(Math.abs(journey.duration-54)<.15,`Journey duration ${journey.duration}`);check(`${label} journey starts after a gesture and uses the 54-second excerpt`,{duration:journey.duration});
    await top(page,'#archive');state=await section(page,'archive');await expect(page.locator('#archive-locked')).toBeVisible();check(`${label} archive soundtrack covers its locked introduction`,{state});
    await page.locator('[data-open-login]').click();await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click();await expect(page.locator('#login-dialog')).not.toBeVisible();await expect(page.locator('#portrait-grid figure')).toHaveCount(3);
    await section(page,'archive');await top(page,'#message-section');await page.waitForFunction(()=>document.querySelector('#message-video').readyState>=2&&!document.querySelector('#message-video').paused,null,{timeout:25000});await section(page,'archive');
    const video=await page.locator('#message-video').evaluate(element=>({src:element.currentSrc,duration:element.duration,width:element.videoWidth,height:element.videoHeight,muted:element.muted,inline:element.playsInline}));assert.ok(video.src.endsWith('/private-media/seed/message-current.mp4'));assert.ok(Math.abs(video.duration-85.9)<.3);assert.equal(video.width,720);assert.equal(video.height,1280);assert.equal(video.inline,true);assert.equal(video.muted,true);await expect(page.locator('#film-dialog')).not.toBeVisible();check(`${label} replacement video plays inline with the requested private source`,video);
    await shot(page,`01-message-${label}.png`);
    await page.locator('#message-video').evaluate(video=>video.pause());await section(page,'archive');check(`${label} pausing the inline video does not pause section music`,await advancingClock(page,'archive'));
    await top(page,'#celebration');await section(page,'celebration');await page.waitForFunction(()=>document.querySelector('#heart-stage').classList.contains('has-webgl'),null,{timeout:20000});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);await shot(page,`02-heart-${label}.png`);
    const position=await page.locator('#heart-stage').evaluate(element=>{const rect=element.getBoundingClientRect(),word=document.querySelector('#birthday-word').getBoundingClientRect(),canvas=element.querySelector('canvas'),gl=canvas.getContext('webgl2')||canvas.getContext('webgl');return{heart:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},word:{x:word.x,y:word.y,width:word.width,height:word.height},alpha:gl.getContextAttributes().alpha};});assert.equal(position.alpha,true);assert.ok(position.heart.width<=240&&position.heart.height<=260);check(`${label} small heart retains transparency near the birthday word`,position);
    await top(page,'footer');await section(page,'celebration');check(`${label} celebration soundtrack continues into the footer`);
    await top(page,'#home');await section(page,'journey');await page.locator('#audio-toggle').click();await expect(page.locator('#audio-toggle')).toHaveAttribute('aria-pressed','true');await section(page,'journey',true);
    await top(page,'.journey-intro');await section(page,'journey',true);check(`${label} journey mute persists through the first section`);
    await top(page,'#archive');await section(page,'archive');await expect(page.locator('#audio-toggle')).toHaveAttribute('aria-pressed','false');await page.locator('#audio-toggle').click();await section(page,'archive',true);
    await top(page,'#celebration');await section(page,'celebration');await expect(page.locator('#audio-toggle')).toHaveAttribute('aria-pressed','false');await page.locator('#audio-toggle').click();await section(page,'celebration',true);
    await top(page,'#archive');await section(page,'archive',true);await top(page,'#home');await section(page,'journey',true);check(`${label} independent mute preferences restore without leaking across sections`);
    await page.locator('#audio-toggle').click();await section(page,'journey');await page.locator('#play-intro').click();await page.waitForFunction(()=>document.querySelector('#film-dialog').dataset.moment==='intro'&&!document.querySelector('.cinema-video.is-active').paused,null,{timeout:25000});await section(page,'journey');
    await page.locator('#cinema-home').focus();await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('.cinema-video.is-active').paused);await section(page,'journey');check(`${label} pausing fullscreen film leaves journey music playing`,await advancingClock(page,'journey'));
    await page.keyboard.press('Space');await page.locator('.cinema-video.is-active').evaluate(async video=>{video.currentTime=video.duration-.12;await video.play();});await page.waitForFunction(()=>document.querySelector('#film-dialog').dataset.moment==='touch'&&!document.querySelector('.cinema-video.is-active').paused,null,{timeout:25000});await section(page,'journey');await page.keyboard.press('Escape');check(`${label} basic cinema progression retains the journey soundtrack`);
    for(const selector of ['#archive','#celebration','#home','#archive','footer','#home']){await top(page,selector);await page.waitForTimeout(180);}
    await section(page,'journey');
    const samples=await page.evaluate(()=>({contexts:window.__qaAudioContexts,maxPlaying:Math.max(0,...window.__qaAudioSamples.map(sample=>sample.playing.length)),overlaps:window.__qaAudioSamples.filter(sample=>sample.playing.length>1)}));assert.equal(samples.contexts,0);assert.ok(samples.maxPlaying<=1);check(`${label} rapid navigation never overlaps tracks and creates no synthetic score`,{maxPlaying:samples.maxPlaying,audioContexts:samples.contexts});
    const size=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert.ok(size.width<=size.viewport+1);check(`${label} has no horizontal overflow`,size);
  }finally{await context.close();}
}
async function followupStage(viewport,label){
  const context=await browser.newContext({viewport,reducedMotion:'reduce',deviceScaleFactor:1});const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>{report.pageErrors.push({label,message:error.message});save();});
  try{
    await page.goto(baseURL,{waitUntil:'domcontentloaded',timeout:25000});await top(page,'#archive');await page.locator('[data-open-login]').click();await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click();await expect(page.locator('#portrait-grid figure')).toHaveCount(3);
    await top(page,'#message-section');await page.waitForFunction(()=>document.querySelector('#message-video').readyState>=2&&!document.querySelector('#message-video').paused,null,{timeout:25000});await page.locator('#message-video').evaluate(video=>video.currentTime=5);await page.waitForFunction(()=>document.querySelector('#message-video').currentTime>=5.08&&document.querySelector('#message-video').readyState>=2);await shot(page,`01-message-${label}.png`);check(`${label} replacement message captured after its opening black frame`);
    await page.locator('#message-video').evaluate(video=>video.pause());await section(page,'archive');check(`${label} paused inline video leaves archive audio clock advancing`,await advancingClock(page,'archive'));
    await top(page,'#home');await section(page,'journey');await page.locator('#play-intro').click();await page.waitForFunction(()=>document.querySelector('#film-dialog').dataset.moment==='intro'&&!document.querySelector('.cinema-video.is-active').paused,null,{timeout:25000});await expect(page.locator('#film-dialog #audio-toggle')).toHaveCount(1);
    await page.locator('#cinema-home').focus();await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('.cinema-video.is-active').paused);await section(page,'journey');check(`${label} paused cinema leaves journey audio clock advancing`,await advancingClock(page,'journey'));
    await page.locator('#film-dialog #audio-toggle').click();await section(page,'journey',true);await expect(page.locator('#audio-toggle')).toHaveAttribute('aria-pressed','true');check(`${label} small fullscreen mute is clickable and mutes only journey`,await advancingClock(page,'journey'));
    await page.locator('#film-dialog #audio-toggle').click();await section(page,'journey');await page.keyboard.press('Escape');await expect(page.locator('body > #audio-toggle')).toHaveCount(1);check(`${label} fullscreen unmute works and control returns to the page`);
    await top(page,'#celebration');await section(page,'celebration');await expect(page.locator('#audio-toggle')).toHaveAttribute('aria-pressed','false');check(`${label} cinema mute changes do not leak into celebration`);
    await page.waitForFunction(()=>document.querySelector('#heart-stage').classList.contains('has-webgl'),null,{timeout:20000});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);await shot(page,`02-heart-${label}.png`);check(`${label} latest flame heart and lower placement captured`);
  }finally{await context.close();}
}
try{for(const[viewport,label]of[[{width:1440,height:960},'desktop'],[{width:390,height:844},'mobile']]){try{await(followup?followupStage:run)(viewport,label);}catch(error){report.failures.push({label,message:error.message});save();console.error(`FAIL ${label}: ${error.message}`);}}}finally{await browser.close();save();}
console.log(`Completed ${report.checks.length} checks; ${report.screenshots.length} screenshots; ${report.pageErrors.length} JS errors; ${report.requestFailures.length} unexpected request failures; ${report.oldMediaRequests.length} old media requests; ${report.failures.length} failed stages.`);
if(report.failures.length||report.pageErrors.length||report.requestFailures.length||report.oldMediaRequests.length)process.exitCode=1;
