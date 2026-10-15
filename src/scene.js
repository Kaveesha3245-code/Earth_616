import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// The supplied tunnel's simplex noise, palette, displacement and pointer response.
const SNOISE = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
 const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
 vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
 vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;
 vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
 vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+2.0*C.xxx;vec3 x3=x0-1.0+3.0*C.xxx;
 i=mod(i,289.0);
 vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
 float n_=1.0/7.0;vec3 ns=n_*D.wyz-D.xzx;
 vec4 j=p-49.0*floor(p*ns.z*ns.z);
 vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
 vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
 vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
 vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
 vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
 vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
 vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
 p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
 vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m*=m;
 return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const TUNNEL_VERTEX = `
uniform float uTime,uSize,uSwirl,uScale;
uniform vec3 uColLow,uColHigh,uCursor;
uniform float uRepelRadius,uRepelStrength,uActivity;
varying float vFade;varying vec3 vColor;
${SNOISE}
void main(){
 vec3 wp=vec3(position.x*7.0,0.0,position.z*25.0);wp.x+=position.y*6.0;
 float wn=snoise(vec3(wp.x*.08,wp.z*.08,uTime*.15))*2.0;
 wn+=snoise(vec3(wp.x*.16,wp.z*.16,uTime*.3))*.8;
 float currentSliceRadius=sqrt(max(0.0,17.64-position.z*position.z));
 float normalizedX=wp.x/(9.2195*currentSliceRadius+.001);
 float tunnelAngle=normalizedX*3.14159265;
 float jitterAngle=snoise(vec3(position.x*15.0,position.y*15.0,uTime*.1))*.35;
 float jitterZ=snoise(vec3(position.y*15.0,position.z*15.0,uTime*.1))*4.0;
 float ambientSwirl=snoise(vec3(position.x*5.0,position.y*5.0,uTime*.2))*3.0;
 tunnelAngle+=jitterAngle+ambientSwirl*uSwirl;
 float dynamicR=12.0-wn;
 vec3 tunnelPos=vec3(dynamicR*sin(tunnelAngle),-dynamicR*cos(tunnelAngle),wp.z+jitterZ);
 vec4 modelPosition=modelMatrix*vec4(tunnelPos*uScale,1.0);
 vec3 toP=modelPosition.xyz-uCursor;float cd=length(toP);
 float fall=1.0-smoothstep(0.0,uRepelRadius,cd);
 modelPosition.xyz+=normalize(toP+vec3(.0001))*fall*uRepelStrength*uActivity;
 vec4 mvPosition=viewMatrix*modelPosition;
 float colMix=smoothstep(-3.0,3.0,position.y+position.x*.5);
 vColor=mix(uColLow,uColHigh,clamp(colMix,0.0,1.0));
 vFade=smoothstep(.1,1.5,-mvPosition.z);
 gl_PointSize=clamp(uSize*(10.0/max(.1,-mvPosition.z)),1.5,24.0);
 gl_Position=projectionMatrix*mvPosition;
}`;

const TUNNEL_FRAGMENT = `
uniform float uOpacity,uBrightness,uAppear;
varying float vFade;varying vec3 vColor;
void main(){
 float ll=length(gl_PointCoord-.5);if(ll>.5)discard;
 float a=1.0-smoothstep(.1,.5,ll);
 gl_FragColor=vec4(vColor*uBrightness,vFade*a*uOpacity*uAppear);
}`;

const ATMOSPHERE_VERTEX = `
attribute float size;attribute float seed;uniform float uTime;uniform vec2 uRes;
varying float vA;
vec3 warp(vec3 p,float t){float c=.9,a=1.9,b=.02,s=.05;p*=2.0;
 p.x+=c*sin(s*t+a*p.y)+t*b;p.y+=c*cos(s*t+a*p.x);p.y+=c*sin(s*t+a*p.z)+t*b;
 p.z+=c*cos(s*t+a*p.y);p.z+=c*sin(s*t+a*p.x)+t*b;p.x+=c*cos(s*t+a*p.z);
 return cos(p+vec3(1,2,4));}
void main(){
 vec3 v=position*4.0+warp(position,uTime)*1.2;
 vec4 mv=modelViewMatrix*vec4(v,1.0);
 float r=length(v);float farF=1.0-smoothstep(5.0,6.5,r);float nearF=smoothstep(.0,.5,-mv.z);
 vA=farF*nearF;gl_PointSize=clamp(size*uRes.y/900.0/max(.1,-mv.z),1.0,18.0);
 gl_Position=projectionMatrix*mv;
}`;

const COMPOSITE = {
  uniforms: {
    tDiffuse: { value: null }, iTime: { value: 0 }, uHeart: { value: 0 },
    uBg: { value: new THREE.Vector3(10 / 255, 5 / 255, 36 / 255) },
    uFlameA: { value: new THREE.Vector3(43 / 255, 240 / 255, 1) },
    uFlameB: { value: new THREE.Vector3(122 / 255, 60 / 255, 1) },
  },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
  fragmentShader: `
uniform sampler2D tDiffuse;uniform float iTime,uHeart;uniform vec3 uBg,uFlameA,uFlameB;varying vec2 vUv;
vec3 warp3d(vec3 p,float t){float curv=.8,a=1.9,b=.7;p*=2.0;
 p.x+=curv*sin(t+a*p.y)+t*b;p.y+=curv*cos(t+a*p.x);
 p.y+=curv*sin(t+a*p.z)+t*b;p.z+=curv*cos(t+a*p.y);
 p.z+=curv*sin(t+a*p.x)+t*b;p.x+=curv*cos(t+a*p.z);
 return .5+.5*cos(p.xyz+vec3(1,2,4));}
void main(){
 vec2 uv=2.0*vUv-1.0;vec3 w=pow(warp3d(vec3(uv.x,sin(uv.y),uv.y),iTime*.18),vec3(1.5));
 vec3 flame=1.5*uFlameA*w.x*w.y+uFlameB*w.z;
 flame*=smoothstep(.25,1.0,abs(uv.y));float md=smoothstep(-.7,1.0,-uv.y*uv.x);flame*=md*md;
 vec3 bg=mix(uBg,vec3(.025,.008,.023),uHeart)*(1.0-.4*length(uv));
 vec3 glow=mix(flame,flame*vec3(1.1,.1,.4),uHeart)*.12;
 vec3 source=texture2D(tDiffuse,vUv).rgb;
 vec3 color=source+(bg+glow)*(1.0-uHeart);
 float vignette=1.0-smoothstep(.35,1.45,length(uv))*.32;
 // Bloom writes an opaque black background; derive coverage from its lit pixels
 // in heart mode so the supplied flower photograph remains visible underneath.
 float coverage=mix(1.0,smoothstep(.001,.06,max(source.r,max(source.g,source.b))),uHeart);
 gl_FragColor=vec4(color*vignette*coverage,coverage);
}`,
};

const clamp01 = value => Math.min(1, Math.max(0, Number(value) || 0));

/** One owned WebGL canvas; all geometry, textures, listeners and render targets are disposed. */
export function createUniverse(canvas, { reducedMotion = false, initialMode = 'tunnel', onError } = {}) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('A canvas is required.');
  const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const ownGeometry = value => { geometries.add(value); return value; };
  const ownMaterial = value => { materials.add(value); return value; };
  let disposed = false;
  let paused = false;
  let contextLost = false;
  let animationFrame = 0;
  let stillRequested = false;
  let mode = initialMode === 'heart' ? 'heart' : 'tunnel';
  let targetProgress = 0;
  let smoothProgress = 0;
  let progress = 0;
  let time = 0;
  let lastTimestamp = 0;
  let roll = 0;
  let pointerActive = false;
  let pointerLastMove = 0;
  let pointerActivity = 0;
  let ignitionActive = false;
  let ignitionStarted = 0;
  let ignitionCount = 0;
  const pointer = new THREE.Vector2();
  const mouse = new THREE.Vector2();
  const pointerWorld = new THREE.Vector3();
  const pointerRay = new THREE.Vector3();
  const pointerDirection = new THREE.Vector3();
  const target = new THREE.Vector3();
  let renderer;
  let composer;
  let bloom;
  let composite;

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
  } catch (error) {
    onError?.(error);
    return { setProgress() {}, setMode() {}, setPaused() {}, ignite() {}, dispose() {} };
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 400);
  camera.position.set(0, 0, 20);
  const tunnelGroup = new THREE.Group();
  tunnelGroup.visible = mode === 'tunnel';
  scene.add(tunnelGroup);
  const tunnelUniforms = {
    uTime: { value: 0 }, uAppear: { value: 0 },
    uColLow: { value: new THREE.Vector3(24 / 255, 10 / 255, 58 / 255) },
    uColHigh: { value: new THREE.Vector3(43 / 255, 240 / 255, 1) },
    uOpacity: { value: 1.44 }, uSize: { value: 5 }, uBrightness: { value: .4 },
    uSwirl: { value: .39 }, uScale: { value: .17 },
    uCursor: { value: new THREE.Vector3() }, uRepelRadius: { value: 2.4 },
    uRepelStrength: { value: .8 }, uActivity: { value: 0 },
  };
  function initializeTunnel() {
    if (tunnelGroup.children.length) return;
    const tunnel = new THREE.Points(
      ownGeometry(new THREE.SphereGeometry(4.2, mobile ? 48 : 88, mobile ? 100 : 136)),
      ownMaterial(new THREE.ShaderMaterial({
        uniforms: tunnelUniforms, vertexShader: TUNNEL_VERTEX, fragmentShader: TUNNEL_FRAGMENT,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })),
    );
    tunnel.frustumCulled = false;
    tunnelGroup.add(tunnel);
    initializeComposer();
  }

  // Tiny camera-attached lights create depth without large, distracting near-field blobs.
  const atmosphereCount = mobile ? 120 : 300;
  const positions = new Float32Array(atmosphereCount * 3);
  const sizes = new Float32Array(atmosphereCount);
  const seeds = new Float32Array(atmosphereCount);
  for (let i = 0; i < atmosphereCount; i++) {
    positions[i * 3] = Math.random() * 2 - 1;
    positions[i * 3 + 1] = Math.random() * 2 - 1;
    positions[i * 3 + 2] = Math.random() * 2 - 1;
    sizes[i] = 12 * (.4 + Math.random());
    seeds[i] = Math.random();
  }
  const atmoGeometry = ownGeometry(new THREE.BufferGeometry());
  atmoGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  atmoGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  atmoGeometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  const atmoUniforms = {
    uTime: { value: 0 }, uColor: { value: new THREE.Color(0x8fe6ff) }, uRes: { value: new THREE.Vector2() }, uOpacity: { value: .25 },
  };
  const atmosphere = new THREE.Points(atmoGeometry, ownMaterial(new THREE.ShaderMaterial({
    uniforms: atmoUniforms, vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: `uniform vec3 uColor;uniform float uOpacity;varying float vA;
void main(){float l=length(gl_PointCoord-.5);if(l>.5)discard;float tex=1.0-smoothstep(.0,.5,l);gl_FragColor=vec4(uColor*tex,tex*vA*uOpacity);}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  })));
  atmosphere.frustumCulled = false;
  scene.add(atmosphere);

  const heartGroup = new THREE.Group();
  heartGroup.visible = mode === 'heart';
  heartGroup.rotation.z = -Math.PI / 4;
  scene.add(heartGroup);
  const heartCore = new THREE.Group();
  heartGroup.add(heartCore);
  let orbitGroup;
  let heartDust;
  let heartMaterial;
  let heartGlow;
  let ignitionSparks;
  let ignitionPositions;
  let ignitionOrigins;
  let ignitionVelocities;
  const flameTime = { value: 0 };
  const ignitionStrength = { value: 0 };
  const orbits = [];
  function initializeHeart() {
  if (heartCore.children.length) return;
  scene.add(new THREE.AmbientLight(0xa9a7b7, 1.8));
  const key = new THREE.DirectionalLight(0xc7d5e4, 2.7);
  key.position.set(-4, 6, 7);
  scene.add(key);
  const pink = new THREE.PointLight(0xbe8da4, 16, 24, 2);
  pink.position.set(-2, 1, 4);
  scene.add(pink);
  const rim = new THREE.PointLight(0xc0d3ed, 23, 22, 2);
  rim.position.set(5, -1, 3);
  scene.add(rim);

  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, .77);
  heartShape.bezierCurveTo(-.47, 1.56, -1.56, 1.42, -1.56, .52);
  heartShape.bezierCurveTo(-1.56, -.36, -.63, -1.02, -.12, -1.51);
  heartShape.bezierCurveTo(-.04, -1.59, .04, -1.59, .12, -1.51);
  heartShape.bezierCurveTo(.63, -1.02, 1.56, -.36, 1.56, .52);
  heartShape.bezierCurveTo(1.56, 1.42, .47, 1.56, 0, .77);
  const heartGeometry = ownGeometry(new THREE.ExtrudeGeometry(heartShape, {
    depth: .48, bevelEnabled: true, bevelSegments: mobile ? 6 : 12,
    bevelSize: .16, bevelThickness: .24, curveSegments: mobile ? 32 : 56,
  }));
  heartGeometry.translate(0, .06, -.24);
  heartMaterial = ownMaterial(new THREE.MeshPhysicalMaterial({
    color: 0xae3856, metalness: .54, roughness: .32, clearcoat: .65, clearcoatRoughness: .3,
    emissive: 0x38101d, emissiveIntensity: .18,
  }));
  const heart = new THREE.Mesh(heartGeometry, heartMaterial);
  heartCore.add(heart);
  const contourPoints = heartShape.getSpacedPoints(144).slice(0, -1).map(point => new THREE.Vector3(point.x, point.y + .06, .49));
  const heartContour = new THREE.CatmullRomCurve3(contourPoints, true, 'centripetal');
  const contour = new THREE.Mesh(
    ownGeometry(new THREE.TubeGeometry(heartContour, mobile ? 96 : 160, .008, 6, true)),
    ownMaterial(new THREE.MeshBasicMaterial({ color: 0x84cfe6, transparent: true, opacity: .45 })),
  );
  heartCore.add(contour);
  const shell = new THREE.Mesh(heartGeometry, ownMaterial(new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vN;varying vec3 vV;void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
    fragmentShader: `varying vec3 vN;varying vec3 vV;void main(){float rim=pow(1.0-abs(dot(normalize(vN),normalize(vV))),3.2);gl_FragColor=vec4(.4,.67,.88,rim*.12);}`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  })));
  shell.scale.setScalar(1.008);
  heartCore.add(shell);

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 64;
  const context = glowCanvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,.8)');
  gradient.addColorStop(.2, 'rgba(255,255,255,.22)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  textures.add(glowTexture);
  const glow = new THREE.Sprite(ownMaterial(new THREE.SpriteMaterial({
    map: glowTexture, color: 0x6398c3, transparent: true, opacity: .07, blending: THREE.AdditiveBlending, depthWrite: false,
  })));
  glow.position.z = -1.5;
  glow.scale.set(5.8, 5.8, 1);
  heartGroup.add(glow);
  heartGlow = glow;

  const sparkCount = mobile ? 48 : 84;
  ignitionPositions = new Float32Array(sparkCount * 3);
  ignitionOrigins = new Float32Array(sparkCount * 3);
  ignitionVelocities = new Float32Array(sparkCount * 3);
  for (let i = 0; i < sparkCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = .65 + Math.random() * 1.35;
    ignitionOrigins[i * 3] = Math.cos(angle) * radius;
    ignitionOrigins[i * 3 + 1] = -1.9 + Math.random() * 3;
    ignitionOrigins[i * 3 + 2] = Math.sin(angle) * radius * .55;
    ignitionVelocities[i * 3] = Math.cos(angle) * (.2 + Math.random() * .45);
    ignitionVelocities[i * 3 + 1] = 1.2 + Math.random() * 1.8;
    ignitionVelocities[i * 3 + 2] = Math.sin(angle) * .3;
  }
  const ignitionGeometry = ownGeometry(new THREE.BufferGeometry());
  ignitionGeometry.setAttribute('position', new THREE.BufferAttribute(ignitionPositions, 3).setUsage(THREE.DynamicDrawUsage));
  ignitionSparks = new THREE.Points(ignitionGeometry, ownMaterial(new THREE.PointsMaterial({
    color: 0x88eaff, map: glowTexture, size: .12, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  })));
  ignitionSparks.frustumCulled = false;
  ignitionSparks.visible = false;
  heartGroup.add(ignitionSparks);
  canvas.dataset.ignitionCount = String(ignitionCount);
  canvas.dataset.ignitionActive = 'false';

  orbitGroup = new THREE.Group();
  heartGroup.add(orbitGroup);
  const sparkGeometry = ownGeometry(new THREE.SphereGeometry(.025, 8, 6));
  const sparkMaterial = ownMaterial(new THREE.MeshBasicMaterial({ color: 0xbfe9f6, transparent: true, opacity: .8 }));

  // Layered geometry supplies the blue-fire glow directly, preserving canvas
  // transparency without a full-frame bloom pass or large spill over the film.
  function flameMaterial(color, highlight, opacity, phase, ribbon = false) {
    return ownMaterial(new THREE.ShaderMaterial({
      uniforms: {
        uTime: flameTime, uColor: { value: new THREE.Color(color) },
        uHighlight: { value: new THREE.Color(highlight) }, uOpacity: { value: opacity },
        uPhase: { value: phase }, uRibbon: { value: ribbon ? 1 : 0 }, uIgnition: ignitionStrength,
      },
      vertexShader: `varying vec2 vUv;varying vec3 vN;varying vec3 vV;
void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
      fragmentShader: `uniform float uTime,uOpacity,uPhase,uRibbon,uIgnition;uniform vec3 uColor,uHighlight;
varying vec2 vUv;varying vec3 vN;varying vec3 vV;
void main(){
 float facing=pow(abs(dot(normalize(vN),normalize(vV))),1.4);
 float band=pow(max(0.0,1.0-abs(vUv.y*2.0-1.0)),1.5);
 float edge=mix(facing,band,uRibbon);
 float tips=smoothstep(.0,.07,vUv.x)*(1.0-smoothstep(.86,1.0,vUv.x));
 float flow=.5+.5*sin(vUv.x*31.0-uTime*1.45+uPhase+sin(vUv.x*57.0-uTime*.6)*.7);
 float wisps=.65+.35*sin(vUv.x*89.0-uTime*2.2+uPhase);
 vec3 color=mix(uColor,uHighlight,flow*.7);
 gl_FragColor=vec4(color*(1.0+uIgnition*.3),uOpacity*edge*tips*(.64+flow*.36)*wisps*(1.0+uIgnition*.45));
}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, toneMapped: false,
    }));
  }

  function flameBand(path, phase) {
    const count = mobile ? 64 : 96;
    const frames = path.computeFrenetFrames(count, false);
    const vertices = [];
    const uv = [];
    const indices = [];
    const side = new THREE.Vector3();
    const point = new THREE.Vector3();
    for (let sample = 0; sample <= count; sample++) {
      const p = sample / count;
      path.getPointAt(p, point);
      const twist = phase + p * Math.PI * 2.2 + Math.sin(p * Math.PI * 7) * .3;
      side.copy(frames.normals[sample]).multiplyScalar(Math.cos(twist)).addScaledVector(frames.binormals[sample], Math.sin(twist));
      const halfWidth = (.08 + Math.sin(p * Math.PI) ** .7 * .19) * Math.sin(p * Math.PI) ** .35;
      vertices.push(point.x - side.x * halfWidth, point.y - side.y * halfWidth, point.z - side.z * halfWidth);
      vertices.push(point.x + side.x * halfWidth, point.y + side.y * halfWidth, point.z + side.z * halfWidth);
      uv.push(p, 0, p, 1);
      if (sample < count) {
        const offset = sample * 2;
        indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
      }
    }
    const geometry = ownGeometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  const strandCount = 2;
  for (let index = 0; index < strandCount; index++) {
    const phase = index * Math.PI * 2 / strandCount;
    const ribbonPoints = [];
    for (let sample = 0; sample <= 100; sample++) {
      const p = sample / 100;
      const envelope = Math.sin(p * Math.PI);
      const angle = p * Math.PI * 3.4 + phase + Math.sin(p * Math.PI * 7 + phase) * .12;
      const radius = .35 + envelope ** .7 * 1.8 + (1 - p) * .15 + Math.sin(p * Math.PI * 12 + phase) * envelope * .12;
      ribbonPoints.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        (p - .5) * 4.8 + Math.sin(p * Math.PI * 10 + phase) * envelope * .1,
        Math.sin(angle) * radius * .58 + Math.cos(p * Math.PI * 9 + phase) * envelope * .09,
      ));
    }
    const path = new THREE.CatmullRomCurve3(ribbonPoints, false, 'centripetal');
    const strand = new THREE.Group();
    orbitGroup.add(strand);
    const segments = mobile ? 72 : 112;
    strand.add(new THREE.Mesh(flameBand(path, phase), flameMaterial(0x1363e6, 0x61dfff, .48, phase, true)));
    strand.add(new THREE.Mesh(
      ownGeometry(new THREE.TubeGeometry(path, segments, .21, 6, false)),
      flameMaterial(0x1251e0, 0x29aaff, .16, phase),
    ));
    strand.add(new THREE.Mesh(
      ownGeometry(new THREE.TubeGeometry(path, segments, .105, 6, false)),
      flameMaterial(0x168dff, 0x65e7ff, .72, phase),
    ));
    strand.add(new THREE.Mesh(
      ownGeometry(new THREE.TubeGeometry(path, segments, index === 1 ? .045 : .038, 5, false)),
      flameMaterial(0x79dfff, 0xd8fbff, .84, phase),
    ));
    const sparks = [];
    for (let i = 0; i < 3; i++) {
      const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
      sparks.push(spark);
      strand.add(spark);
    }
    orbits.push({ path, sparks, strand, phase: index / strandCount });
  }
  const dustPositions = new Float32Array((mobile ? 140 : 320) * 3);
  for (let i = 0; i < dustPositions.length; i += 3) {
    dustPositions[i] = (Math.random() - .5) * 18;
    dustPositions[i + 1] = (Math.random() - .5) * 13;
    dustPositions[i + 2] = (Math.random() - .5) * 9 - 3;
  }
  const dustGeometry = ownGeometry(new THREE.BufferGeometry());
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  heartDust = new THREE.Points(dustGeometry, ownMaterial(new THREE.PointsMaterial({
    color: 0x94a4bc, size: .012, transparent: true, opacity: .35, depthWrite: false,
  })));
  heartGroup.add(heartDust);
  }

  function initializeComposer() {
  if (composer) return;
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), mobile ? .35 : .5, .5, .22);
    composer.addPass(bloom);
    composite = new ShaderPass(COMPOSITE);
    composer.addPass(composite);
  } catch {
    // Direct rendering keeps the experience available on constrained WebGL devices.
    composer?.dispose();
    composer = null;
  }
  }

  function resize() {
    if (disposed) return;
    const width = Math.max(1, canvas.clientWidth || innerWidth);
    const height = Math.max(1, canvas.clientHeight || innerHeight);
    const dpr = Math.min(devicePixelRatio || 1, mobile ? 1.25 : 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    composer?.setPixelRatio(dpr);
    composer?.setSize(width, height);
    atmoUniforms.uRes.value.set(width * dpr, height * dpr);
    // The host places this miniature canvas beside the dedication; keep the
    // sculpture centered locally so its flower backdrop stays unobstructed.
    heartGroup.position.set(0, 0, 0);
    heartGroup.scale.setScalar(Math.min(1.1, camera.aspect * 1.34));
    requestRender(true);
  }

  function renderFrame(timestamp = performance.now()) {
    animationFrame = 0;
    if (disposed || document.hidden || contextLost || (paused && !stillRequested && !ignitionActive)) return;
    stillRequested = false;
    const dt = Math.min(.05, lastTimestamp ? (timestamp - lastTimestamp) / 1000 : 1 / 60);
    lastTimestamp = timestamp;
    if (!reducedMotion && !paused) time += dt;
    smoothProgress += (targetProgress - smoothProgress) * (reducedMotion ? 1 : .1);
    progress += (smoothProgress - progress) * (reducedMotion ? 1 : .06);
    mouse.lerp(pointer, reducedMotion ? 1 : .06);
    const t = reducedMotion ? 5.5 : time;
    if (mode === 'tunnel') {
      camera.position.set(mouse.x * .12, mouse.y * .12, 20 - progress * 34);
      camera.lookAt(mouse.x * .6, mouse.y * .6, camera.position.z - 12);
      tunnelUniforms.uTime.value = t;
      tunnelUniforms.uSwirl.value = .39 * (1 + progress * 1.5);
      tunnelUniforms.uAppear.value = reducedMotion || paused ? 1 : Math.min(1, time / 1.4);
      if (!reducedMotion && !paused) roll += dt * (.065 + progress * .05);
      tunnelGroup.rotation.z = roll;
      target.set(0, 0, camera.position.z - 4);
      if (pointerActive && !reducedMotion) {
        pointerRay.set(mouse.x, mouse.y, .5).unproject(camera);
        pointerDirection.copy(pointerRay).sub(camera.position).normalize();
        const distance = -4 / pointerDirection.z;
        if (Number.isFinite(distance) && distance > 0) target.copy(camera.position).addScaledVector(pointerDirection, distance);
      }
      pointerWorld.lerp(target, .12);
      const active = pointerActive && timestamp - pointerLastMove < 3000 && !reducedMotion;
      pointerActivity += ((active ? 1 : 0) - pointerActivity) * .06;
      tunnelUniforms.uCursor.value.copy(pointerWorld);
      tunnelUniforms.uActivity.value = pointerActivity;
    } else {
      let burst = 0;
      if (ignitionActive) {
        const duration = reducedMotion ? 600 : 1450;
        const phase = Math.min(1, Math.max(0, (timestamp - ignitionStarted) / duration));
        burst = Math.sin(phase * Math.PI) ** .7 * (reducedMotion ? .32 : 1);
        const travel = phase * (reducedMotion ? .18 : 1.25);
        for (let i = 0; i < ignitionPositions.length; i += 3) {
          ignitionPositions[i] = ignitionOrigins[i] + ignitionVelocities[i] * travel;
          ignitionPositions[i + 1] = ignitionOrigins[i + 1] + ignitionVelocities[i + 1] * travel;
          ignitionPositions[i + 2] = ignitionOrigins[i + 2] + ignitionVelocities[i + 2] * travel;
        }
        ignitionSparks.geometry.attributes.position.needsUpdate = true;
        ignitionSparks.material.opacity = burst * .9;
        ignitionSparks.visible = phase < 1;
        if (phase >= 1) {
          ignitionActive = false;
          canvas.dataset.ignitionActive = 'false';
        }
      }
      ignitionStrength.value = burst;
      heartMaterial.emissiveIntensity = .18 + burst * .2;
      heartGlow.material.opacity = .07 + burst * .13;
      camera.position.set(mouse.x * .08, .15 + mouse.y * .08, 9.7);
      camera.lookAt(0, .1, 0);
      heartCore.rotation.set(-.06 + mouse.y * .06, -.14 + Math.sin(t * .3) * .1 + mouse.x * .12, 0);
      heartCore.position.y = reducedMotion ? 0 : Math.sin(t * .7) * .08;
      const beat = reducedMotion ? 1 : 1 + Math.sin(t * 1.35) * .009;
      heartCore.scale.setScalar(beat * (1 + burst * .075));
      flameTime.value = t;
      orbitGroup.scale.setScalar(1 + burst * .035);
      orbitGroup.rotation.y = reducedMotion ? .15 : t * .075 + Math.sin(t * .16) * .12;
      orbitGroup.rotation.z = 0;
      heartDust.rotation.y = t * .014;
      for (const orbit of orbits) {
        orbit.strand.rotation.z = Math.sin(t * .3 + orbit.phase * Math.PI * 2) * .022;
        orbit.strand.rotation.x = Math.sin(t * .26 + orbit.phase * Math.PI * 2) * .035;
        for (let i = 0; i < orbit.sparks.length; i++) {
          orbit.path.getPointAt((t * .04 + orbit.phase + i / 3) % 1, orbit.sparks[i].position);
        }
      }
    }
    atmoUniforms.uTime.value = t * 8;
    atmoUniforms.uOpacity.value = mode === 'heart' ? .1 : .25;
    atmosphere.position.copy(camera.position);
    if (composite) {
      composite.uniforms.iTime.value = t;
      composite.uniforms.uHeart.value = mode === 'heart' ? 1 : 0;
    }
    try {
      // Render the miniature heart directly to the transparent drawing buffer.
      // Bloom compositing writes alpha across its entire render target, which
      // would leave a dark rectangle over the supplied flower photograph.
      if (mode === 'heart') {
        renderer.setRenderTarget(null);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, camera);
      } else if (composer) composer.render();
      else renderer.render(scene, camera);
    } catch (error) {
      paused = true;
      onError?.(error);
      return;
    }
    if ((!reducedMotion && !paused) || ignitionActive) requestRender();
  }

  function requestRender(still = false) {
    if (still) stillRequested = true;
    if (!animationFrame && !disposed && (!paused || stillRequested || ignitionActive) && !document.hidden && !contextLost) animationFrame = requestAnimationFrame(renderFrame);
  }
  function movePointer(event) {
    if (event.pointerType === 'touch' || reducedMotion) return;
    pointer.set(event.clientX / innerWidth * 2 - 1, -(event.clientY / innerHeight * 2 - 1));
    pointerActive = true;
    pointerLastMove = performance.now();
    requestRender();
  }
  function leavePointer(event) {
    if (event.relatedTarget) return;
    pointerActive = false;
    pointer.set(0, 0);
  }
  function visibilityChange() {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    lastTimestamp = 0;
    requestRender(true);
  }
  function lostContext(event) {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    onError?.(new Error('The 3D context was interrupted. The illustrated fallback remains available.'));
  }
  function restoredContext() {
    contextLost = false;
    lastTimestamp = 0;
    resize();
  }
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  function motionChange(event) {
    reducedMotion = event.matches;
    pointer.set(0, 0);
    requestRender(true);
  }
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', movePointer, { passive: true });
  window.addEventListener('pointerout', leavePointer, { passive: true });
  document.addEventListener('visibilitychange', visibilityChange);
  canvas.addEventListener('webglcontextlost', lostContext);
  canvas.addEventListener('webglcontextrestored', restoredContext);
  motionQuery.addEventListener('change', motionChange);
  if (mode === 'heart') initializeHeart();
  else initializeTunnel();
  resize();

  return {
    setProgress(value) {
      targetProgress = clamp01(value);
      requestRender();
    },
    setMode(value) {
      const nextMode = value === 'heart' ? 'heart' : 'tunnel';
      if (nextMode === mode) return;
      if (nextMode === 'heart') initializeHeart();
      else initializeTunnel();
      mode = nextMode;
      tunnelGroup.visible = mode === 'tunnel';
      heartGroup.visible = mode === 'heart';
      if (mode !== 'heart') {
        ignitionActive = false;
        ignitionStrength.value = 0;
        if (ignitionSparks) ignitionSparks.visible = false;
        if (canvas.dataset.ignitionActive) canvas.dataset.ignitionActive = 'false';
      }
      if (bloom) bloom.strength = mode === 'heart' ? .24 : mobile ? .35 : .5;
      requestRender(true);
    },
    setPaused(value) {
      const nextPaused = Boolean(value);
      if (nextPaused === paused && !stillRequested) return;
      paused = nextPaused;
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      lastTimestamp = 0;
      requestRender(true);
    },
    ignite() {
      if (disposed || mode !== 'heart') return ignitionCount;
      ignitionStarted = performance.now();
      ignitionActive = true;
      ignitionCount += 1;
      ignitionSparks.visible = true;
      canvas.dataset.ignitionCount = String(ignitionCount);
      canvas.dataset.ignitionActive = 'true';
      requestRender(true);
      return ignitionCount;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ignitionActive = false;
      canvas.dataset.ignitionActive = 'false';
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', movePointer);
      window.removeEventListener('pointerout', leavePointer);
      document.removeEventListener('visibilitychange', visibilityChange);
      canvas.removeEventListener('webglcontextlost', lostContext);
      canvas.removeEventListener('webglcontextrestored', restoredContext);
      motionQuery.removeEventListener('change', motionChange);
      composer?.passes.forEach(pass => pass.dispose?.());
      composer?.dispose();
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
      renderer.dispose();
    },
  };
}
