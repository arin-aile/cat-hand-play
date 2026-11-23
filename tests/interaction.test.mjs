import test from 'node:test';
import assert from 'node:assert/strict';
import { contactTips, videoToScreen, ContactGate, FingerContactTracker } from '../interaction.mjs';
test('one hand independently detects 0–4 fingertips, excluding thumb',()=>{
 for(let n=0;n<=4;n++){
  const lm=Array.from({length:21},()=>({x:-100,y:-100}));lm[4]={x:10,y:10};
  for(const id of [8,12,16,20].slice(0,n))lm[id]={x:10,y:10};
  assert.equal(contactTips(lm,p=>p,p=>p.x===10).length,n);
 }
});
test('cover crop and mirror align in landscape and portrait',()=>{
 assert.deepEqual(videoToScreen({x:.5,y:.5},1200,800,1280,720),{x:600,y:400});
 assert.deepEqual(videoToScreen({x:.5,y:.5},390,844,1280,720),{x:195,y:422});
 assert.equal(videoToScreen({x:0,y:0},1280,720,1280,720).x,1280);
 assert.ok(videoToScreen({x:0,y:0},390,844,1280,720).x>390);
});
test('stable contacts select all four reactions; held contact does not repeat',()=>{
 const gate=new ContactGate();
 for(const [n,mode] of [[1,'pet'],[2,'run'],[3,'angry'],[4,'sleep']]){
  assert.equal(gate.update(n,n*1000),null);
  assert.equal(gate.update(n,n*1000+150),mode);
  assert.equal(gate.update(n,n*1000+900),null);
 }
 gate.update(0,5000);gate.update(0,5210);
 gate.update(4,5300);assert.equal(gate.update(4,5450),'sleep');
});
test('brief jitter and lost hands do not trigger a reaction',()=>{
 const gate=new ContactGate();gate.update(1,0);gate.update(3,50);gate.update(0,100);
 assert.equal(gate.update(0,400),null);gate.reset();assert.equal(gate.committed,0);
 assert.deepEqual(contactTips([],p=>p,()=>true),[]);
});

test('independent contacts survive brief gaps and expire after release',()=>{
 const tracker=new FingerContactTracker();
 assert.deepEqual(tracker.update([8,12,16,20],0),[8,12,16,20]);
 assert.equal(tracker.update([8,12,16],70).length,4);
 assert.equal(tracker.update([8,12,16],130).length,3);
 assert.equal(tracker.update([],251).length,0);
 tracker.update([8],300);tracker.reset();assert.equal(tracker.update([],301).length,0);
});
