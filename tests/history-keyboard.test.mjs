import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const code=(await build({stdin:{contents:"export * from './history-keyboard'; export { Platform } from 'obsidian';",loader:'ts',resolveDir:fileURLToPath(new URL('../src/ui',import.meta.url))},bundle:true,write:false,format:'esm',plugins:[{name:'mock',setup(build){
 build.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));
 build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const Platform={isMacOS:true}; export class Component {
  cleanups=[];registerDomEvent(el,type,fn,options){const opts=typeof options==='boolean'?{capture:options}:options;el.addEventListener(type,fn,opts);this.cleanups.push(()=>el.removeEventListener(type,fn,opts));}
  unload(){this.cleanups.forEach(fn=>fn());}
 }`,loader:'js'}));
}}]})).outputFiles[0].text;
const {HistoryKeyboard,Platform}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function fixture(){
 const target=(inside=false,editing=false)=>({inside,isContentEditable:false,closest:()=>editing?{}:null});
 const doc=new EventTarget();doc.body=target();doc.documentElement=target();doc.querySelectorAll=()=>[];
 const root=new EventTarget();root.ownerDocument=doc;root.contains=target=>target.inside;
 const calls=[];let enabled=true;
 const keyboard=new HistoryKeyboard(root,()=>enabled,redo=>{calls.push(redo);});
 const press=(target=doc.body,properties={})=>{
  const event=new Event('keydown',{cancelable:true});
  Object.entries({key:'z',metaKey:true,shiftKey:false,target,...properties}).forEach(([key,value])=>Object.defineProperty(event,key,{value}));
  doc.dispatchEvent(event);return event;
 };
 return{doc,root,calls,press,target,keyboard,disable:()=>enabled=false};
}
test('Command+Z undoes and Command+Shift+Z redoes',()=>{
 const f=fixture();assert.equal(f.press().defaultPrevented,true);f.press(f.target(true),{shiftKey:true});assert.deepEqual(f.calls,[false,true]);f.keyboard.unload();
});
test('history leaves editors, other panes, menus and inactive views untouched and cleans up',()=>{
 const f=fixture();f.press(f.target());f.press(f.target(true,true));
 for(const props of [{metaKey:false},{altKey:true},{ctrlKey:true},{repeat:true},{isComposing:true},{key:'a'}])f.press(f.doc.body,props);
 f.doc.querySelectorAll=()=>[{getClientRects:()=>[{}]}];f.press();f.doc.querySelectorAll=()=>[];
 f.disable();f.press();assert.deepEqual(f.calls,[]);f.keyboard.unload();
});

test('Windows Control+Z and Control+Shift+Z work and listener unload removes them',()=>{
 Platform.isMacOS=false;const f=fixture();f.press(f.doc.body,{metaKey:false,ctrlKey:true});f.press(f.doc.body,{metaKey:false,ctrlKey:true,shiftKey:true});
 assert.deepEqual(f.calls,[false,true]);f.keyboard.unload();f.press(f.doc.body,{metaKey:false,ctrlKey:true});assert.deepEqual(f.calls,[false,true]);Platform.isMacOS=true;
});
