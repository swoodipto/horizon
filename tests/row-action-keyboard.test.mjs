import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const code = (await build({
 entryPoints: [fileURLToPath(new URL('../src/ui/row-action-keyboard.ts', import.meta.url))], bundle: true, write: false, format: 'esm',
 plugins: [{ name: 'mock', setup(build) {
  build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
  build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export class Component {
   cleanups=[]; registerDomEvent(el,type,fn) { el.addEventListener(type,fn); this.cleanups.push(()=>el.removeEventListener(type,fn)); }
   unload() { this.cleanups.forEach(fn=>fn()); }
  }`, loader:'js' }));
 } }],
})).outputFiles[0].text;
const { RowActionKeyboard } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function fixture(modifier = 'shift') {
 const doc = new EventTarget(); const button = {}; const calls = [];
 let enabled = true; let overlays = [];
 doc.querySelectorAll = () => overlays;
 const root = { ownerDocument:doc, contains:target=>target.inside };
 const target = { inside:true, isContentEditable:false, editing:false, row:true,
  closest(selector) { return selector==='.row' ? this.row ? { querySelector:()=>button } : null : this.editing ? {} : null; }
 };
 const keyboard = new RowActionKeyboard(root, { key:'d', modifier, row:'.row', button:'.deadline', enabled:()=>enabled, open:b=>calls.push(b) });
 function press(options={}) {
  const event = new Event('keydown', { cancelable:true });
  Object.entries({key:'D', shiftKey:true, target, ...options}).forEach(([key,value])=>Object.defineProperty(event,key,{value}));
  doc.dispatchEvent(event); return event;
 }
 return { target, button, calls, press, keyboard, disable:()=>enabled=false,
  overlay:visible=>overlays=[{getClientRects:()=>visible ? [{}] : []}] };
}
test('Shift+D opens the focused row deadline and consumes the event', () => {
 const f=fixture(); assert.equal(f.press().defaultPrevented,true); assert.deepEqual(f.calls,[f.button]);
});
test('typing and modified shortcuts are untouched', () => {
 for(const options of [{shiftKey:false},{ctrlKey:true},{metaKey:true},{altKey:true},{repeat:true},{isComposing:true},{key:'S'}]) {
  const f=fixture(); assert.equal(f.press(options).defaultPrevented,false); assert.deepEqual(f.calls,[]);
 }
});
test('note editing, inputs and focus outside a list row do not open deadlines', () => {
 for(const options of [{inside:false},{isContentEditable:true},{editing:true},{row:false}]) {
  const f=fixture(); Object.assign(f.target,options); assert.equal(f.press().defaultPrevented,false); assert.deepEqual(f.calls,[]);
 }
});
test('disabled views and visible menus or dialogs block the shortcut', () => {
 const f=fixture(); f.disable(); f.press(); assert.deepEqual(f.calls,[]);
 const g=fixture(); g.overlay(true); g.press(); assert.deepEqual(g.calls,[]);
 g.overlay(false); g.press(); assert.equal(g.calls.length,1);
});
test('unloading removes the keyboard listener', () => {
 const f=fixture(); f.keyboard.unload(); assert.equal(f.press().defaultPrevented,false); assert.deepEqual(f.calls,[]);
});

test('macOS Option alternate characters match physical keys, as does Windows Alt', () => {
 const mac=fixture('alt'); mac.press({key:'∂',code:'KeyD',altKey:true,shiftKey:false}); assert.equal(mac.calls.length,1);
 const win=fixture('alt'); win.press({key:'d',code:'KeyD',altKey:true,shiftKey:false}); assert.equal(win.calls.length,1);
 const shifted=fixture('alt'); shifted.press({altKey:true,shiftKey:true}); assert.equal(shifted.calls.length,0);
});
