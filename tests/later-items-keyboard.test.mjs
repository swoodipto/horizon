import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const code=(await build({entryPoints:[fileURLToPath(new URL('../src/ui/later-items-keyboard.ts',import.meta.url))],bundle:true,write:false,format:'esm',plugins:[{name:'mock',setup(build){
 build.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));
 build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export class Component {
  cleanups=[];registerDomEvent(el,type,fn,options){const opts=typeof options==='boolean'?{capture:options}:options;el.addEventListener(type,fn,opts);this.cleanups.push(()=>el.removeEventListener(type,fn,opts));}
  unload(){this.cleanups.forEach(fn=>fn());}
 }`,loader:'js'}));
}}]})).outputFiles[0].text;
const {LaterItemsKeyboard}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function fixture(){
 const target=(inside=false,editing=false)=>({inside,isContentEditable:false,closest:()=>editing?{}:null});
 const doc=new EventTarget();doc.body=target();doc.documentElement=target();doc.querySelectorAll=()=>[];
 const root=new EventTarget();root.ownerDocument=doc;root.contains=target=>target.inside;
 const calls=[];let enabled=true;
 const keyboard=new LaterItemsKeyboard(root,()=>enabled,()=>{calls.push('toggle');return true;});
 const press=(target=doc.body,properties={})=>{
  const event=new Event('keydown',{cancelable:true});
  Object.entries({key:'H',shiftKey:true,target,...properties}).forEach(([key,value])=>Object.defineProperty(event,key,{value}));
  doc.dispatchEvent(event);return event;
 };
 return{doc,root,calls,press,target,keyboard,disable:()=>enabled=false};
}
test('Shift+H toggles from the active view or body',()=>{
 const f=fixture();assert.equal(f.press().defaultPrevented,true);f.press(f.target(true));assert.deepEqual(f.calls,['toggle','toggle']);
});
test('editing, other panes, modifiers, repeat and inactive views are untouched',()=>{
 const f=fixture();f.press(f.target());f.press(f.target(true,true));
 for(const props of [{shiftKey:false},{altKey:true},{ctrlKey:true},{metaKey:true},{repeat:true},{isComposing:true},{key:'S'}]) f.press(f.doc.body,props);
 f.disable();f.press();assert.deepEqual(f.calls,[]);
});
test('menus block toggling and unloading removes listeners',()=>{
 const f=fixture();f.doc.querySelectorAll=()=>[{getClientRects:()=>[{}]}];f.press();assert.deepEqual(f.calls,[]);
 f.doc.querySelectorAll=()=>[];f.keyboard.unload();f.press();assert.deepEqual(f.calls,[]);
});
