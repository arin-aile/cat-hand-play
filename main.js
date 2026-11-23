import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TIP_IDS, videoToScreen, contactTips, GestureTracker, ContactGate, FingerContactTracker } from './interaction.mjs?v=7';

const el = Object.fromEntries(['camera','hands','stage','emotion','begin','status'].map(id => [id, document.getElementById(id)]));
const ctx = el.hands.getContext('2d');
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
el.stage.appendChild(renderer.domElement);
const camera = new THREE.OrthographicCamera(-8,8,5,-5,.1,100);
camera.position.set(0,0,12); camera.lookAt(0,0,0);
scene.add(new THREE.HemisphereLight(0xffffff,0xded8d0,2.8));
const key = new THREE.DirectionalLight(0xffffff,2.8); key.position.set(-3,6,5); scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff,1.35); rim.position.set(4,4,-4); scene.add(rim);
// Movement, facing and model normalization have separate transforms.
const anchor = new THREE.Group(), facing = new THREE.Group(), normalized = new THREE.Group();
scene.add(anchor); anchor.add(facing); facing.add(normalized);
facing.rotation.x = .22;
let cat, mixer, current, landmarker, stream;
const actions = {}, meshes = [], bounds = new THREE.Box3(), raycaster = new THREE.Raycaster();
const fingerContacts = new FingerContactTracker(), gestures = new GestureTracker();
let interactionHold = 0;
const feedback = document.getElementById("handFeedback");
const guideRows = [...document.querySelectorAll("#guide li")];
const gate = new ContactGate(), clock = new THREE.Clock();
let width = innerWidth, height = innerHeight, mode = 'rest', special = false, elapsed = 0, duration = 2;
let started = false, starting = false, lastVideoTime = -1, lastDetection = 0, lastAttempt = 0;
let target = new THREE.Vector2(), position = new THREE.Vector2(), heading = -.35;
let catPixels = 140, lastContact = null;
const clamp = THREE.MathUtils.clamp, damp = THREE.MathUtils.damp;
const random = (min,max) => min + Math.random() * (max-min);

function fit() {
  width = innerWidth; height = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1,2);
  renderer.setPixelRatio(dpr);
  // Also set CSS size: a DPR-sized drawing buffer must never become the layout size.
  renderer.setSize(width,height);
  camera.left = -5 * width/height; camera.right = -camera.left;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  el.hands.width = Math.round(width*dpr); el.hands.height = Math.round(height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  // Visible size: about 1.5x the previous rendered cat, with portrait safety.
  catPixels = Math.min(height * .15, width * .38);
  facing.scale.setScalar(catPixels / height * 10);
  limitPosition(position); limitPosition(target);
}
function limitPosition(p) {
  const margin = catPixels * .75 + 20;
  p.x = clamp(p.x, -Math.max(0,width/2-margin), Math.max(0,width/2-margin));
  p.y = clamp(p.y, -Math.max(0,height/2-margin), Math.max(0,height/2-margin));
}
window.addEventListener('resize',fit); fit();

new GLTFLoader().load('./cat.glb', gltf => {
  // Measure in model space BEFORE attaching to scaled/rotated display groups.
  cat = gltf.scene;
  cat.updateMatrixWorld(true);
  bounds.setFromObject(cat,true);
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const scale = 1 / Math.max(size.x,size.y,size.z);
  normalized.scale.setScalar(scale);
  cat.position.sub(center);
  normalized.add(cat);
  cat.traverse(o => { if (o.isMesh) { o.frustumCulled = false; meshes.push(o); } });
  mixer = new THREE.AnimationMixer(cat);
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  // The source has no sleep/lie clips. Create skeletal poses from its Idle pose,
  // preserving the real mesh proportions instead of flattening the whole cat.
  const idle = gltf.animations.find(c => c.name === 'Idle');
  for (const [name, depth] of [['RestPose',.35],['LiePose',.85],['SleepPose',1]]) {
    const tracks = idle.tracks.map(track => {
      const n = track.getValueSize(), value = Array.from(track.values.slice(0,n));
      if (track.name === 'All.position') value[1] -= .34*depth;
      if (track.name.endsWith('.quaternion')) {
        const q = new THREE.Quaternion().fromArray(value);
        let angle = 0;
        if (/FrontLeg/.test(track.name)) angle = -1.25*depth;
        if (/BackLeg/.test(track.name)) angle = 1.15*depth;
        if (/Head\./.test(track.name)) angle = .12*depth;
        if (/Tail\./.test(track.name)) angle = .8*depth;
        if (angle) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle));
        q.toArray(value);
      }
      const end = [...value];
      if (track.name === 'All.position') end[1] += .018;
      return new track.constructor(track.name,[0,1.7,3.4],[...value,...end,...value]);
    });
    actions[name] = mixer.clipAction(new THREE.AnimationClip(name,3.4,tracks));
  }
  setMode('rest',false);
},undefined,error => { console.error(error); showStatus('3D 모델을 불러오지 못했어요. 새로고침해 주세요.'); });

function playClip(name,once=false) {
  const next = actions[name] || actions.Idle;
  if (!next || current === next) return;
  next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
  next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
  next.clampWhenFinished = once; next.play();
  if (current) { current.fadeOut(.55); next.fadeIn(.55); }
  current = next;
}
function showStatus(text) { el.status.textContent = text; el.status.style.display = 'block'; }
function setMode(next,isSpecial=false) {
  if (!cat) return;
  mode = next; special = isSpecial; elapsed = 0;
  const config = {
    walk:['Walk',random(4,9)],rest:['RestPose',random(2,5)],
    idle:['Idle',random(2,4)],lie:['LiePose',random(4,8)],
    sleep:['SleepPose',isSpecial ? 5 : random(6,11)],
    groom:['Idle_Eating',random(2,4)],pet:['Headbutt',1.8],run:['Run',1.6],angry:['Jump_Start',1.6]
  }[next];
  duration = config[1]; playClip(config[0],next === 'angry' || next === 'pet');
  el.emotion.textContent = isSpecial ? ({pet:'❤️',run:'❗️',angry:'💢',sleep:'💤'}[next] || '') : '';
  el.emotion.classList.toggle('visible',isSpecial);
  if (next === 'walk') {
    target.set(random(-width*.42,width*.42),random(-height*.4,height*.4)); limitPosition(target);
  }
  if (next === 'run') {
    const away = lastContact ? position.clone().sub(new THREE.Vector2(lastContact.x-width/2,lastContact.y-height/2)) : new THREE.Vector2(1,0);
    if (away.length() < 1) away.set(Math.random()<.5?-1:1,-.3);
    target.copy(position).add(away.normalize().multiplyScalar(catPixels*2.8)); limitPosition(target);
    if (target.distanceTo(position)<catPixels*.4) { target.copy(position).multiplyScalar(-.7); limitPosition(target); }
  }
}
function chooseAutonomy() {
  const choices = mode === 'walk' ? ['idle','rest','lie','sleep','groom'] : ['walk','walk','walk','rest','lie','sleep','groom'];
  setMode(choices[Math.floor(Math.random()*choices.length)]);
}
const bonePairs = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function projectLandmark(p) { return videoToScreen(p,width,height,el.camera.videoWidth||640,el.camera.videoHeight||480); }
function updateBounds() {
  scene.updateMatrixWorld(true);
  for (const mesh of meshes) if (mesh.isSkinnedMesh) { mesh.skeleton.update(); mesh.computeBoundingBox(); mesh.computeBoundingSphere(); }
  bounds.setFromObject(cat,true);
}
function screenRect() {
  const points = [];
  for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) {
    const p = new THREE.Vector3(x,y,z).project(camera);
    points.push({x:(p.x+1)*width/2,y:(1-p.y)*height/2});
  }
  return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
}
// Raycast against the animated skin, with a small fingertip-sized tolerance.
// Empty corners of the projected bounding box do not count as contact.
function hitsCat(p) {
  if (!cat || p.x<0 || p.x>width || p.y<0 || p.y>height) return false;
  const r = screenRect(), pad = clamp(catPixels*.14,16,26);
  if (p.x<r.left-pad || p.x>r.right+pad || p.y<r.top-pad || p.y>r.bottom+pad) return false;
  for (const [dx,dy] of [[0,0],[-pad,0],[pad,0],[0,-pad],[0,pad],[-pad*.7,-pad*.7],[pad*.7,-pad*.7],[-pad*.7,pad*.7],[pad*.7,pad*.7]]) {
    raycaster.setFromCamera(new THREE.Vector2((p.x+dx)/width*2-1,1-(p.y+dy)/height*2),camera);
    if (raycaster.intersectObjects(meshes,false).length) return true;
  }
  return false;
}
function processHands(results, now) {
  ctx.clearRect(0,0,width,height);
  // numHands=1; never sum contacts from unrelated hands.
  const lm = results.landmarks?.[0];
  let contacts = [];
  if (lm && cat) {
    const points = lm.map(projectLandmark);
    contacts = fingerContacts.update(contactTips(lm,projectLandmark,hitsCat),now);
    ctx.lineWidth=1.7; ctx.strokeStyle='rgba(92,104,120,.45)';
    for (const [i,j] of bonePairs) { ctx.beginPath();ctx.moveTo(points[i].x,points[i].y);ctx.lineTo(points[j].x,points[j].y);ctx.stroke(); }
    points.forEach((p,id) => {
      ctx.fillStyle = contacts.includes(id) ? 'rgba(255,150,105,.85)' : 'rgba(92,104,120,.5)';
      ctx.beginPath();ctx.arc(p.x,p.y,contacts.includes(id)?8:TIP_IDS.includes(id)?4:2.5,0,Math.PI*2);ctx.fill();
    });
    if (contacts.length) lastContact = contacts.map(id=>points[id]).reduce((a,p)=>({x:a.x+p.x/contacts.length,y:a.y+p.y/contacts.length}),{x:0,y:0});
  }
  if (!lm) fingerContacts.reset();
  const raised = gestures.update(results.worldLandmarks?.[0] || lm, now);
  const count = contacts.length ? raised : 0;
  if (contacts.length && !special) interactionHold = .35;
  feedback.textContent = lm ? `손가락 ${raised}개 · ${contacts.length ? '닿았어요' : '고양이에 닿아 주세요'}` : '손을 보여 주세요';
  guideRows.forEach(row => row.classList.toggle('active',!!lm && Number(row.dataset.count)===raised));
  const reaction = gate.update(count,now);
  if (reaction) setMode(reaction,true);
  return contacts.length;
}
function tick(dt) {
  if (!cat) return;
  interactionHold = Math.max(0,interactionHold-dt);
  const paused = interactionHold>0 && !special;
  if (!paused) elapsed += dt;
  if (elapsed > duration) chooseAutonomy();
  if (!paused && (mode==='walk' || mode==='run')) {
    const delta = target.clone().sub(position), distance = delta.length();
    if (distance>2) {
      position.addScaledVector(delta.normalize(),Math.min(distance,(mode==='run'?catPixels*1.8:catPixels*.45)*dt));
      heading = Math.atan2(delta.x,delta.y);
    } else if (mode==='walk' && elapsed>.7) chooseAutonomy();
  }
  limitPosition(position);
  const turn = Math.atan2(Math.sin(heading-facing.rotation.y),Math.cos(heading-facing.rotation.y));
  facing.rotation.y += turn*(1-Math.exp(-5*dt));
  if (mode==='angry' && elapsed>.4) playClip('Jump_Loop');
  const jump = mode==='angry' ? Math.sin(Math.min(elapsed/1.6,1)*Math.PI)*catPixels*.5 : 0;
  anchor.position.set(position.x/height*10,(-position.y+jump)/height*10,0);
  mixer.update(paused ? 0 : dt); updateBounds();
  // Clamp the animated silhouette too, including jumps and changed poses.
  let r=screenRect();
  const dx = r.left<12 ? 12-r.left : r.right>width-12 ? width-12-r.right : 0;
  const dy = r.top<18 ? 18-r.top : r.bottom>height-12 ? height-12-r.bottom : 0;
  if (dx || dy) { position.x+=dx;position.y+=dy;anchor.position.x+=dx/height*10;anchor.position.y-=dy/height*10;updateBounds();r=screenRect(); }
  el.emotion.style.left = clamp((r.left+r.right)/2,25,width-25)+'px';
  el.emotion.style.top = clamp(r.top-25,24,height-24)+'px';
}
function animate() {
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05), now=performance.now();
  tick(dt); renderer.render(scene,camera);
  if (started && el.camera.readyState>=2 && el.camera.currentTime!==lastVideoTime && now-lastAttempt>33) {
    lastVideoTime=el.camera.currentTime; lastAttempt=now;
    try { processHands(landmarker.detectForVideo(el.camera,now),now); lastDetection=now; }
    catch (error) { console.error(error); stopCamera();showStatus('손 인식이 중단됐어요. 발바닥을 눌러 다시 시작해 주세요.'); }
  }
  if (started && now-lastDetection>350) { ctx.clearRect(0,0,width,height);gate.reset();fingerContacts.reset();gestures.reset();interactionHold=0;feedback.textContent="손을 보여 주세요";guideRows.forEach(row=>row.classList.remove("active")); }
}
animate();
function stopCamera() {
  started=false; stream?.getTracks().forEach(track=>track.stop());stream=null;
  landmarker?.close();landmarker=null;el.camera.srcObject=null;
  ctx.clearRect(0,0,width,height);gate.reset();fingerContacts.reset();gestures.reset();interactionHold=0;feedback.textContent="손을 보여 주세요";guideRows.forEach(row=>row.classList.remove("active"));el.begin.style.display='block';el.begin.disabled=false;
}
async function start() {
  if (started || starting) return;
  starting=true;el.begin.disabled=true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('secure-origin');
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}}});
    el.camera.srcObject=stream;await el.camera.play();
    // Camera SDK failure must not prevent the autonomous cat from loading.
    const {HandLandmarker,FilesetResolver}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/+esm');
    const fileset=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm');
    const opts={baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',delegate:'GPU'},runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.45,minHandPresenceConfidence:.45,minTrackingConfidence:.45};
    try { landmarker=await HandLandmarker.createFromOptions(fileset,opts); }
    catch { opts.baseOptions.delegate='CPU';landmarker=await HandLandmarker.createFromOptions(fileset,opts); }
    started=true;lastDetection=performance.now();lastVideoTime=-1;
    el.begin.style.display='none';el.status.style.display='none';
  } catch (error) {
    console.error(error);stopCamera();showStatus('카메라 권한과 인터넷 연결을 확인하고 HTTPS 또는 localhost에서 열어 주세요.');
  } finally { starting=false;el.begin.disabled=false; }
}
el.begin.addEventListener('click',start);
window.addEventListener('pagehide',stopCamera);
document.addEventListener('visibilitychange',()=>{clock.getDelta();gate.reset();fingerContacts.reset();gestures.reset();interactionHold=0;feedback.textContent="손을 보여 주세요";guideRows.forEach(row=>row.classList.remove("active"));ctx.clearRect(0,0,width,height);});
// Opt-in test harness; absent during normal use and never enables the camera.
if (new URLSearchParams(location.search).has('test')) window.catTest = {
  get ready(){return !!cat;}, setMode, tick, processHands, hitsCat, screenRect,
  snapshot:()=>({mode,special,position:position.toArray(),rect:screenRect(),clips:Object.keys(actions),canvas:{width:renderer.domElement.clientWidth,height:renderer.domElement.clientHeight}}),
  move:(x,y)=>{position.set(x,y);limitPosition(position);tick(0);}
};
