import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const code=(await build({entryPoints:[fileURLToPath(new URL('../src/ui/filter-keyboard-navigation.ts',import.meta.url))],bundle:true,write:false,format:'esm',plugins:[{name:'mock',setup(build){
 build.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));
 build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export class Component {
  cleanups=[];registerDomEvent(el,type,fn,options){const opts=typeof options==='boolean'?{capture:options}:options;el.addEventListener(type,fn,opts);this.cleanups.push(()=>el.removeEventListener(type,fn,opts));}
  unload(){this.cleanups.forEach(fn=>fn());}
 }`,loader:'js'}));
}}]})).outputFiles[0].text;
const {FilterKeyboardNavigation}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function fixture(){
 const target=(inside=false,editing=false)=>({inside,isContentEditable:false,closest:()=>editing?{}:null});
 const doc=new EventTarget();doc.body=target();doc.documentElement=target();doc.querySelectorAll=()=>[];
 const root=new EventTarget();root.ownerDocument=doc;root.contains=target=>target.inside;
 const calls=[];let enabled=true;
 const keyboard=new FilterKeyboardNavigation(root,()=>enabled,direction=>{calls.push(direction);return true;});
 const press=(target=doc.body,properties={})=>{
  const event=new Event('keydown',{cancelable:true});
  Object.entries({key:'ArrowRight',target,...properties}).forEach(([key,value])=>Object.defineProperty(event,key,{value}));
  doc.dispatchEvent(event);return event;
 };
 return{doc,root,calls,press,target,keyboard,disable:()=>enabled=false};
}
test('active Projects view handles arrows when DOM focus rests on the document body',()=>{
 const f=fixture();assert.equal(f.press().defaultPrevented,true);assert.deepEqual(f.calls,[1]);
});
test('focused Horizon entries handle both horizontal directions',()=>{
 const f=fixture();f.press(f.target(true),{key:'ArrowLeft'});assert.deepEqual(f.calls,[-1]);
});
test('other panes, editors, modifier keys and inactive views are untouched',()=>{
 const f=fixture();f.press(f.target());f.press(f.target(true,true));f.press(f.doc.body,{ctrlKey:true});f.disable();f.press();assert.deepEqual(f.calls,[]);
});
test('menus block filtering and unloading removes listeners',()=>{
 const f=fixture();f.doc.querySelectorAll=()=>[{getClientRects:()=>[{}]}];f.press();assert.deepEqual(f.calls,[]);
 f.doc.querySelectorAll=()=>[];f.keyboard.unload();f.press();assert.deepEqual(f.calls,[]);
});

test('Shift is passed to stepping for progressive selection',()=>{
 const f=fixture();f.keyboard.unload();const calls=[];
 const keyboard=new FilterKeyboardNavigation(f.root,()=>true,(direction,multiple)=>{calls.push([direction,multiple]);return true;});
 f.press(f.doc.body,{shiftKey:true});f.press(f.doc.body,{key:'ArrowLeft',shiftKey:true});f.press();
 assert.deepEqual(calls,[[1,true],[-1,true],[1,undefined]]);keyboard.unload();
});
