// Optional deployment preparation. Requires a local ffmpeg executable.
// node scripts/prepare-hls.mjs --ffmpeg C:/tools/ffmpeg.exe
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const executable = option('--ffmpeg', 'ffmpeg');
const input = resolve(option('--input', 'public/media/opening-person-landscape-seek-1080.mp4'));
const output = resolve(option('--output', 'public/media/hls/intro'));
await mkdir(output, { recursive:true });
const renditions = [ {height:360,bandwidth:650000,bitrate:'550k'}, {height:720,bandwidth:1800000,bitrate:'1600k'}, {height:1080,bandwidth:3700000,bitrate:'3300k'} ];
for (const {height,bitrate} of renditions) {
  const directory = join(output,String(height)); await mkdir(directory,{recursive:true});
  const result = spawnSync(executable, ['-hide_banner','-loglevel','error','-nostdin','-y','-i',input,'-an','-vf',`scale=-2:${height}`,'-c:v','libx264','-pix_fmt','yuv420p','-b:v',bitrate,'-maxrate',bitrate,'-bufsize',`${parseInt(bitrate) * 2}k`,'-force_key_frames','expr:gte(t,n_forced*2)','-sc_threshold','0','-hls_time','2','-hls_playlist_type','vod','-hls_flags','independent_segments','-hls_segment_filename',join(directory,'segment-%03d.ts'),join(directory,'index.m3u8')], { stdio:'inherit',windowsHide:true });
  if (result.error || result.status !== 0) throw new Error('HLS generation failed. Install ffmpeg or pass its executable with --ffmpeg.');
}
const manifest = '#EXTM3U\n#EXT-X-VERSION:3\n' + renditions.map(({height,bandwidth}) => `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth}\n${height}/index.m3u8\n`).join('');
await writeFile(join(output,'master.m3u8'),manifest);
console.log(`Prepared HLS renditions in ${output}. Test every variant before deployment.`);
