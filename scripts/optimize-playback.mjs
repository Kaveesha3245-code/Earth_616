import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const flag=process.argv.indexOf('--ffmpeg');
const executable=flag>=0?process.argv[flag+1]:'ffmpeg';
const output=resolve('public/media/stream');
await mkdir(output,{recursive:true});
const profiles=[
  ['opening-person-landscape-seek-1080.mp4','intro-landscape.mp4','1920:-2','4500k',20],
  ['opening-person-portrait-seek-1080.mp4','intro-portrait.mp4','720:-2','3000k',20],
  ['media2-1080.mp4','touch.mp4','864:-2','3000k',20],
  ['universal-travel.mp4','crossing.mp4','720:-2','4000k',20],
  ['media4-1080.mp4','arrival.mp4','720:-2','4000k',20],
  ['charcoal/charcoal-silk-folds.mp4','silk.mp4','1280:-2','1800k',22],
  ['flower/flower-arc/flower-arc.mp4','flowers.mp4','-2:1080','3500k',21],
];
const report=[];
for(const [source,name,size,rate,crf]of profiles){
  const input=resolve('public/media',source),destination=resolve(output,name);
  await new Promise((done,fail)=>{
    const task=spawn(executable,['-hide_banner','-loglevel','error','-nostdin','-y','-i',input,'-map','0:v:0','-an','-vf',`scale=${size}:flags=lanczos,setsar=1`,'-c:v','libx264','-preset','fast','-crf',String(crf),'-maxrate',rate,'-bufsize',`${parseInt(rate)*2}k`,'-pix_fmt','yuv420p','-g','24','-keyint_min','12','-movflags','+faststart','-threads','2',destination],{stdio:'inherit',windowsHide:true});
    task.on('error',fail);task.on('exit',code=>code===0?done():fail(new Error(`Encoding ${name} failed (${code}).`)));
  });
  const original=(await stat(input)).size,bytes=(await stat(destination)).size;
  const entry={source,name,originalBytes:original,playbackBytes:bytes,savedPercent:Math.round((1-bytes/original)*100)};
  report.push(entry);console.log(`${name}: ${bytes} bytes (${entry.savedPercent}% smaller)`);
}
await writeFile(resolve(output,'manifest.json'),JSON.stringify(report,null,2)+'\n');
