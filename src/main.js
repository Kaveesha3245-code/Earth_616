import { installCinema } from './cinema.js';
import { createSectionAudio } from './section-audio.js';
import './cinema.css';
import './refinements.css';

document.body.classList.add('has-js');
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const preference=matchMedia('(prefers-reduced-motion: reduce)');
const sectionAudio=createSectionAudio({button:$('#audio-toggle'),tracks:{
  journey:'/media/audio/journey-avengers.mp3',
  archive:'/media/audio/first-time.mp3',
  celebration:'/media/audio/call-this-love.mp3',
}});
const messageVideo=$('#message-video');
let motionPaused=preference.matches;
let authenticated=false,sourceLoaded=false,pendingAfterLogin;
let messageVisible=false,messagePausedByUser=false,messageUpdate=0;
let toastTimer,tunnel,heart,sceneModule,cinema,activeBackdrop;
const sceneVisible=new Map(),videoVisible=new WeakMap();

function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),5000);}
async function api(path,body){const response=await fetch(path,{credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const result=await response.json().catch(()=>({}));if(!response.ok){if(response.status===401&&path!=='/api/auth')applySession(false);throw new Error(result.message||'The request could not be completed.');}return result;}
function openDialog(dialog){if(!dialog.open)dialog.showModal();}
$$('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$$('dialog').forEach(dialog=>{
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
  dialog.addEventListener('close',()=>{dialog.querySelectorAll('video').forEach(video=>video.pause());if(dialog.id==='lightbox')$('#lightbox-content').replaceChildren();});
});

function unlockAudio(){void sectionAudio.unlock();}
document.addEventListener('pointerdown',unlockAudio,{passive:true,capture:true});
document.addEventListener('keydown',unlockAudio,{capture:true});
function selectSectionMusic(){
  const anchor=innerHeight*.4;
  const celebration=$('#celebration').getBoundingClientRect();
  const archive=$('#archive').getBoundingClientRect();
  const section=$('#film-dialog').open?'journey':celebration.top<=anchor?'celebration':archive.top<=anchor&&archive.bottom>anchor?'archive':'journey';
  document.body.dataset.audioSection=section;sectionAudio.setSection(section);
}
async function syncMessagePlayback(){
  const update=++messageUpdate;const visible=authenticated&&sourceLoaded&&messageVisible&&!document.hidden&&!$('#film-dialog').open;
  if(!visible){messageVideo.pause();return;}
  if(!messagePausedByUser){try{await messageVideo.play();if(update===messageUpdate)$('#message-resume').hidden=true;}catch{if(update===messageUpdate)$('#message-resume').hidden=false;}}
}
messageVideo.addEventListener('pause',()=>{if(messageVisible&&authenticated&&!document.hidden&&!$('#film-dialog').open&&!messageVideo.ended)messagePausedByUser=true;});
messageVideo.addEventListener('play',()=>{messagePausedByUser=false;});
$('#message-resume').addEventListener('click',()=>{messagePausedByUser=false;unlockAudio();void syncMessagePlayback();});
const messageObserver=new IntersectionObserver(entries=>{for(const entry of entries){const wasVisible=messageVisible;messageVisible=entry.isIntersecting&&entry.intersectionRatio>=.22;if(messageVisible&&!wasVisible)messagePausedByUser=false;}void syncMessagePlayback();},{threshold:[0,.22,.5]});
messageObserver.observe($('#message-section'));

function showLogin(after){pendingAfterLogin=after;$('#login-error').textContent='';openDialog($('#login-dialog'));}
$$('[data-open-login]').forEach(button=>button.addEventListener('click',()=>showLogin(()=>$('#archive').scrollIntoView({behavior:motionPaused?'instant':'smooth'}))));
$('#show-password').addEventListener('click',event=>{const show=$('#password').type==='password';$('#password').type=show?'text':'password';event.currentTarget.textContent=show?'HIDE':'SHOW';event.currentTarget.setAttribute('aria-label',show?'Hide password':'Show password');event.currentTarget.setAttribute('aria-pressed',String(show));});
$('#login-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;$('#login-error').textContent='';try{await api('/api/auth',{password:$('#password').value});$('#password').value='';applySession(true);$('#login-dialog').close();await loadArchive();const after=pendingAfterLogin;pendingAfterLogin=null;after?.();}catch(error){$('#login-error').textContent=error.message;}finally{button.disabled=false;}});
function applySession(value){authenticated=value;$('#archive-locked').hidden=value;$('#archive-open').hidden=!value;$('#logout').hidden=!value;if(!value){sourceLoaded=false;messageVisible=false;++messageUpdate;messageVideo.pause();messageVideo.removeAttribute('src');messageVideo.load();$('#portrait-grid').replaceChildren();$('#source-copy').replaceChildren();}selectSectionMusic();}
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout',{});applySession(false);toast('Your archive is locked.');}catch(error){toast(error.message);}});
async function loadArchive(){
  if(!authenticated||sourceLoaded)return;
  try{
    const response=await fetch('/private-media/seed/birthday-message.txt',{credentials:'same-origin'});if(!response.ok)throw new Error('The birthday message could not be loaded. Please sign in again.');const message=await response.text();if(!authenticated)return;
    const labels=['THE SPARK','THE STRENGTH','THE STORY'];
    [12,14,13].forEach((number,index)=>{
      const figure=document.createElement('figure');figure.className='portrait-card';const button=document.createElement('button');button.setAttribute('aria-label',`View portrait ${index+1}: ${labels[index].toLowerCase()}`);
      const image=document.createElement('img');image.src=`/private-media/seed/portrait-${number}.webp`;image.alt=`LordX — ${labels[index].toLowerCase()}`;image.loading='lazy';image.width=720;image.height=960;
      image.addEventListener('error',()=>toast(`Unable to load portrait-${number}.webp. Refresh to retry.`),{once:true});button.append(image);button.addEventListener('click',()=>{const copy=new Image();copy.src=image.src;copy.alt=image.alt;$('#lightbox-content').replaceChildren(copy);openDialog($('#lightbox'));});
      const caption=document.createElement('figcaption');caption.append(document.createTextNode(labels[index]));const count=document.createElement('span');count.textContent=`0${index+1} / 03`;caption.append(count);figure.append(button,caption);$('#portrait-grid').append(figure);
    });
    const letter=document.createElement('p');letter.textContent=message.trim();$('#source-copy').replaceChildren(letter);
    messageVideo.src='/private-media/seed/message-current.mp4';sourceLoaded=true;await syncMessagePlayback();selectSectionMusic();
  }catch(error){toast(error.message);}
}

cinema=installCinema({toast,
  onOpen(){$$('.lazy-video').forEach(video=>video.pause());tunnel?.setPaused(true);heart?.setPaused(true);messageVideo.pause();$('#film-dialog').append($('#audio-toggle'));sectionAudio.setSection('journey');unlockAudio();},
  onScene(){sectionAudio.setSection('journey');},
  onToggleMute(){return sectionAudio.toggleMute();},
  onClose(){document.body.append($('#audio-toggle'));updateMotion();selectSectionMusic();void syncMessagePlayback();},
  onComplete(){if(authenticated)$('#archive').scrollIntoView({behavior:motionPaused?'instant':'smooth'});else showLogin(()=>$('#archive').scrollIntoView({behavior:motionPaused?'instant':'smooth'}));},
});
$('#play-intro').addEventListener('click',()=>cinema.open('intro'));$$('[data-film]').forEach(button=>button.addEventListener('click',()=>cinema.open(button.dataset.film)));
function warmOpening(){if(!navigator.connection?.saveData)void cinema.warmup?.();}
$('#play-intro').addEventListener('pointerenter',warmOpening,{passive:true});
$('#play-intro').addEventListener('focus',warmOpening);
if('requestIdleCallback' in window)requestIdleCallback(warmOpening,{timeout:1500});else setTimeout(warmOpening,700);
messageVideo.addEventListener('error',()=>{if(authenticated&&messageVideo.getAttribute('src'))toast('The message film could not load. Refresh the page to retry.');});
const reveals=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');reveals.unobserve(entry.target);}}),{threshold:.08});$$('.reveal').forEach(element=>reveals.observe(element));
function syncBackgroundVideos(){
  const videos=$$('.lazy-video');let candidate;
  for(const video of videos){
    if(!videoVisible.get(video))continue;
    const rect=video.getBoundingClientRect();
    if(rect.top<=innerHeight*.5&&rect.bottom>=innerHeight*.5)candidate=video;
  }
  activeBackdrop=candidate;
  for(const video of videos){
    if(video!==candidate||motionPaused||document.hidden||$('#film-dialog').open||navigator.connection?.saveData){video.pause();continue;}
    if(!video.src)video.src=video.dataset.src;
    if(video.paused)video.play().catch(()=>{});
  }
}
function updateScenePauses(){
  const rect=activeBackdrop?.closest('.chapter')?.getBoundingClientRect();
  const covered=Boolean(rect&&rect.top<=1&&rect.bottom>=innerHeight-1);
  tunnel?.setPaused(motionPaused||$('#film-dialog').open||!sceneVisible.get('tunnel')||covered);
  heart?.setPaused(motionPaused||$('#film-dialog').open||!sceneVisible.get('heart'));
}
const videoObserver=new IntersectionObserver(entries=>{for(const entry of entries)videoVisible.set(entry.target,entry.isIntersecting);syncBackgroundVideos();updateScenePauses();},{threshold:[0,.05,.25,.5,.75,1]});
$$('.lazy-video').forEach(video=>{videoObserver.observe(video);video.addEventListener('error',()=>toast(`The ${video.dataset.src?.split('/').pop()} film is unavailable. Its still image remains visible.`),{once:true});});
function updateMotion(){document.body.classList.toggle('motion-paused',motionPaused);$('#pause-visuals').setAttribute('aria-pressed',String(motionPaused));$('#pause-visuals').innerHTML=motionPaused?'Resume motion <span aria-hidden="true">▷</span>':'Pause motion <span aria-hidden="true">Ⅱ</span>';
  syncBackgroundVideos();updateScenePauses();
}
$('#pause-visuals').addEventListener('click',()=>{motionPaused=!motionPaused;updateMotion();});preference.addEventListener('change',event=>{motionPaused=event.matches;updateMotion();});
document.addEventListener('visibilitychange',()=>{sectionAudio.setActive(!document.hidden);updateMotion();void syncMessagePlayback();});updateMotion();
const sceneObserver=new IntersectionObserver(async entries=>{for(const entry of entries){const mode=entry.target.id==='story-world'?'tunnel':'heart';sceneVisible.set(mode,entry.isIntersecting);let controller=mode==='tunnel'?tunnel:heart;
  if(entry.isIntersecting&&!controller&&!entry.target.dataset.sceneLoading){entry.target.dataset.sceneLoading='true';const canvas=mode==='tunnel'?$('#universe'):$('#heart-canvas');try{sceneModule||=import('./scene.js');const{createUniverse}=await sceneModule;controller=createUniverse(canvas,{reducedMotion:preference.matches,initialMode:mode,onError(){canvas.hidden=true;if(mode==='heart')$('#heart-stage').classList.remove('has-webgl');}});controller.setMode(mode);if(mode==='tunnel')tunnel=controller;else{heart=controller;$('#heart-stage').classList.toggle('has-webgl',!canvas.hidden);}}catch{canvas.hidden=true;}}
  updateScenePauses();
}},{rootMargin:'100px 0px',threshold:0});sceneObserver.observe($('#story-world'));sceneObserver.observe($('#celebration'));
let scrollQueued=false;function updateScroll(){scrollQueued=false;const max=document.documentElement.scrollHeight-innerHeight;$('.reading-progress i').style.width=`${Math.max(0,Math.min(100,scrollY/max*100))}%`;const world=$('#story-world');tunnel?.setProgress(Math.max(0,Math.min(1,-world.getBoundingClientRect().top/(world.offsetHeight-innerHeight))));syncBackgroundVideos();updateScenePauses();selectSectionMusic();}
addEventListener('scroll',()=>{if(!scrollQueued){scrollQueued=true;requestAnimationFrame(updateScroll);}},{passive:true});addEventListener('resize',updateScroll,{passive:true});updateScroll();
function positionHeart(){
  const stage=$('#heart-stage'),word=$('#birthday-word'),section=$('#celebration');
  if(!stage||!word)return;
  const text=word.getBoundingClientRect(),area=section.getBoundingClientRect();
  const targetX=text.left-area.left+text.width*.87;
  const targetY=text.top-area.top;
  const left=Math.max(8,Math.min(area.width-stage.offsetWidth-8,targetX-stage.offsetWidth*.30));
  const top=Math.max(95,targetY-stage.offsetHeight*.66);
  stage.style.left=`${left}px`;stage.style.right='auto';stage.style.top=`${top}px`;
}
addEventListener('resize',positionHeart,{passive:true});document.fonts.ready.then(positionHeart);positionHeart();
let wishFlareAnimation;
$('#make-wish').addEventListener('click',()=>{
  $('#celebration').classList.add('wishing');
  $('#wish-status').textContent='Your wish is among the stars, LordX.';
  heart?.ignite();
  // Cancel the previous flare so even rapid wishes begin with a fresh ignition.
  // This glass-blue flash also works when the illustrated fallback is showing.
  wishFlareAnimation?.cancel();
  const quiet=preference.matches;
  wishFlareAnimation=$('#wish-ignition').animate([
    {opacity:0,transform:quiet?'scale(.98)':'translateY(12px) scale(.62)',offset:0},
    {opacity:quiet?.35:.8,transform:'translateY(0) scale(1)',offset:.18},
    {opacity:quiet?.2:.5,transform:quiet?'scale(1.01)':'translateY(-8px) scale(1.14)',offset:.45},
    {opacity:0,transform:quiet?'scale(1.02)':'translateY(-30px) scale(1.5)',offset:1},
  ],{duration:quiet?600:1450,easing:'ease-out'});
});
addEventListener('pagehide',()=>sectionAudio.setActive(false));
api('/api/session').then(async session=>{applySession(Boolean(session.authenticated));if(session.authenticated)await loadArchive();}).catch(()=>toast('The archive service is unavailable. The public story is still open.'));
