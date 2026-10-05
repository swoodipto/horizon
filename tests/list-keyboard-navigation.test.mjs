import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { build } = createRequire(import.meta.url)('esbuild');
const code = (await build({
	stdin: { contents: "export * from './list-keyboard-navigation'; export { Platform } from 'obsidian';", loader: 'ts',
		resolveDir: fileURLToPath(new URL('../src/ui/', import.meta.url)) },
	bundle: true, write: false, format: 'esm', plugins: [{ name: 'mock-obsidian', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
		build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export const Platform = { isMacOS: true }; export class Component {
			cleanups=[];
			register(fn){this.cleanups.push(fn);}
			registerDomEvent(el,type,fn,options){const opts=typeof options==='boolean'?{capture:options}:options;el.addEventListener(type,fn,opts);this.register(()=>el.removeEventListener(type,fn,opts));}
			unload(){this.cleanups.splice(0).forEach(fn=>fn());}
		}`, loader: 'js' }));
	} }],
})).outputFiles[0].text;
const { ListKeyboardNavigation, Platform } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

class Element extends EventTarget {
	constructor(doc, tag = 'div', attrs = {}) {
		super(); this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.children = [];
		this.attrs = new Map(Object.entries(attrs)); this.hidden = false; this.cssHidden = false;
		this.focusCalls = []; this.scrollCalls = []; this.clicks = 0;
	}
	append(tag, attrs = {}) {
		const child = new Element(this.ownerDocument, tag, attrs);
		child.parentElement = this; this.children.push(child); return child;
	}
	get classList() { return { toggle: (name, enabled) => {
 const names=new Set((this.getAttribute('class')??'').split(' '));
 if(enabled)names.add(name);else names.delete(name);this.setAttribute('class',[...names].join(' '));
 } }; }
	getAttribute(name) { return this.attrs.get(name) ?? null; }
	setAttribute(name, value) { this.attrs.set(name, String(value)); }
	hasAttribute(name) { return this.attrs.has(name); }
	get isContentEditable() {
		const own = this.getAttribute('contenteditable');
		return own === null ? this.parentElement?.isContentEditable ?? false : own !== 'false';
	}
	matches(selector) {
		return selector.split(',').some(part => {
			const value = part.trim();
			const tag = value.match(/^[a-z]+/i)?.[0];
			const cls = value.match(/\.([\w-]+)/)?.[1];
			const attrs = [...value.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
			return (!tag || this.tagName === tag.toUpperCase()) &&
				(!cls || (this.getAttribute('class') ?? '').split(' ').includes(cls)) &&
				attrs.every(([, name, expected]) => expected === undefined ? this.hasAttribute(name) : this.getAttribute(name) === expected);
		});
	}
	closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
	querySelectorAll(selector) {
		return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
	}
	contains(child) { return child === this || this.children.some(element => element.contains(child)); }
	getClientRects() {
		for (let current = this; current; current = current.parentElement) {
			if (current.hidden || current.cssHidden) return [];
			if (current.tagName === 'DETAILS' && !current.hasAttribute('open')) {
				const summary = current.children.find(child => child.tagName === 'SUMMARY');
				if (!summary?.contains(this)) return [];
			}
		}
		return this.ownerDocument.documentElement.contains(this) ? [{}] : [];
	}
	focus(options) {
		this.focusCalls.push(options);
		if (this.ownerDocument.activeElement === this) return;
		this.ownerDocument.activeElement = this;
		const event = new Event('focusin', { bubbles: true });
		Object.defineProperty(event, 'target', { value: this });
		this.ownerDocument.dispatchEvent(event);
	}
	blur() { if(this.ownerDocument.activeElement===this)this.ownerDocument.activeElement=this.ownerDocument.body; }
	scrollIntoView(options) { this.scrollCalls.push(options); }
	click() { this.clicks++; }
	empty() {
		const losingFocus = this.children.some(child => child.contains(this.ownerDocument.activeElement));
		this.children.forEach(child => { child.parentElement = null; });
		this.children = [];
		// DOM removal falls back to body without dispatching focusin.
		if (losingFocus) this.ownerDocument.activeElement = this.ownerDocument.body;
	}
}

function fixture() {
	const doc = new EventTarget();
	doc.documentElement = new Element(doc, 'html');
	doc.body = doc.documentElement.append('body');
	doc.activeElement = doc.body;
	doc.querySelectorAll = selector => doc.documentElement.querySelectorAll(selector);
	const root = doc.body.append('div');
	const outside = doc.body.append('button');
	let active = true;
	const navigation = new ListKeyboardNavigation(root, 'a.note-row', () => active);
	function row(path, { parent = root, line, status = false } = {}) {
		const item = parent.append('li');
		const attrs = { class: 'note-row', 'data-note-path': path, href: path };
		if (line !== undefined) attrs['data-note-line'] = String(line);
		const link = item.append('a', attrs);
		const title = link.append('span');
		let button;
		if (status) {
			button = item.append('button', { ...attrs, class: 'status-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
		}
		return { item, link, title, button };
	}
	function key(key, { target = doc.activeElement, ...properties } = {}) {
		const event = new Event('keydown', { cancelable: true, bubbles: true });
		Object.defineProperty(event, 'target', { value: target });
		Object.assign(event, { key, isComposing: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...properties });
		if (properties.prevented) event.preventDefault();
		doc.dispatchEvent(event);
		if (key === 'Enter' && !event.defaultPrevented && ['A', 'BUTTON'].includes(target.tagName)) target.click();
		return event;
	}
	function redraw(render) { navigation.beforeRender(); root.empty(); render(); navigation.afterRender(); }
	return { doc, root, outside, navigation, row, key, redraw, setActive: value => { active = value; } };
}

test('arrows visit flattened nested rows, clamp at ends and reveal the focused link without opening it', () => {
	const f = fixture();
	const parent = f.row('parent.md');
	const children = parent.item.append('ul');
	const child = f.row('child.md', { parent: children });
	const last = f.row('last.md');
	parent.link.focus();
	assert.equal(f.key('ArrowUp').defaultPrevented, true);
	assert.equal(f.doc.activeElement, parent.link);
	f.key('ArrowDown'); assert.equal(f.doc.activeElement, child.link);
	f.key('ArrowDown'); assert.equal(f.doc.activeElement, last.link);
	f.key('ArrowDown'); assert.equal(f.doc.activeElement, last.link);
	f.key('ArrowUp'); assert.equal(f.doc.activeElement, child.link);
	assert.deepEqual(child.link.focusCalls.at(-1), { preventScroll: true });
	assert.deepEqual(child.link.scrollCalls.at(-1), { block: 'nearest', inline: 'nearest' });
	assert.equal(parent.link.clicks + child.link.clicks + last.link.clicks, 0);
	f.navigation.unload();
});

test('an active root, heading or document body starts at the first or last row', () => {
	const f = fixture();
	const heading = f.root.append('h3');
	const first = f.row('first.md').link;
	const last = f.row('last.md').link;
	for (const target of [f.root, heading, f.doc.body, f.doc.documentElement]) {
		target.focus(); f.key('ArrowDown'); assert.equal(f.doc.activeElement, first);
		target.focus(); f.key('ArrowUp'); assert.equal(f.doc.activeElement, last);
	}
	f.outside.focus();
	assert.equal(f.key('ArrowDown').defaultPrevented, false);
	assert.equal(f.doc.activeElement, f.outside);
	f.setActive(false); f.root.focus();
	assert.equal(f.key('ArrowDown').defaultPrevented, false);
	assert.equal(f.doc.activeElement, f.root);
	f.navigation.unload();
});

test('nested link content and sibling status buttons navigate the same row; open menus retain arrows', () => {
	const f = fixture();
	const note = f.row('shared.md');
	const task = f.row('shared.md', { line: 12, status: true });
	const last = f.row('last.md');
	note.link.focus();
	f.key('ArrowDown', { target: note.title }); assert.equal(f.doc.activeElement, task.link);
	task.button.focus();
	f.key('ArrowDown'); assert.equal(f.doc.activeElement, last.link);
	task.button.focus(); task.button.setAttribute('aria-expanded', 'true');
	assert.equal(f.key('ArrowUp').defaultPrevented, false);
	assert.equal(f.doc.activeElement, task.button);
	f.navigation.unload();
});

test('hidden rows, hidden parents and closed details are skipped while summary links remain visible', () => {
	const f = fixture();
	const first = f.row('first.md').link;
	f.row('hidden.md').link.hidden = true;
	const hiddenParent = f.root.append('ul'); hiddenParent.hidden = true;
	f.row('hidden-parent.md', { parent: hiddenParent });
	const cssParent = f.root.append('ul'); cssParent.cssHidden = true;
	f.row('css-hidden.md', { parent: cssParent });
	const details = f.root.append('details');
	const summary = details.append('summary');
	const summaryRow = f.row('summary.md', { parent: summary }).link;
	const collapsed = f.row('collapsed.md', { parent: details }).link;
	const last = f.row('last.md').link;
	first.focus(); f.key('ArrowDown'); assert.equal(f.doc.activeElement, summaryRow);
	f.key('ArrowDown'); assert.equal(f.doc.activeElement, last);
	details.setAttribute('open', '');
	summaryRow.focus(); f.key('ArrowDown'); assert.equal(f.doc.activeElement, collapsed);
	f.root.empty();
	assert.equal(f.key('ArrowDown').defaultPrevented, false);
	f.navigation.unload();
});

test('editing, composition, modified arrows and previously handled keys keep their normal behavior', () => {
	const f = fixture();
	const first = f.row('first.md').link;
	f.row('last.md');
	for (const tag of ['input', 'textarea', 'select']) {
		const input = f.root.append(tag); input.focus();
		assert.equal(f.key('ArrowDown').defaultPrevented, false, tag);
		assert.equal(f.doc.activeElement, input);
	}
	const editor = f.root.append('div', { contenteditable: 'true' }).append('span');
	editor.focus(); assert.equal(f.key('ArrowDown').defaultPrevented, false);
	assert.equal(f.doc.activeElement, editor);
	for (const properties of [{ isComposing: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { prevented: true }]) {
		first.focus(); f.key('ArrowDown', properties); assert.equal(f.doc.activeElement, first);
	}
	assert.equal(f.key('Enter').defaultPrevented, false);
	assert.equal(first.clicks, 1);
	assert.equal(f.key('Escape').defaultPrevented, false);
	f.navigation.unload();
});

test('redraw preserves path and exact line identity even when rows reorder', () => {
	const f = fixture();
	f.row('shared.md');
	const original = f.row('shared.md', { line: 8 });
	f.row('shared.md', { line: 20 });
	original.link.focus();
	let restored;
	f.redraw(() => {
		f.row('shared.md', { line: 20 });
		f.row('shared.md');
		restored = f.row('shared.md', { line: 8 }).link;
	});
	assert.equal(f.doc.activeElement, restored);
	assert.deepEqual(restored.focusCalls.at(-1), { preventScroll: true });
	f.navigation.unload();
});

test('removed focused rows fall back to the closest remaining index and empty results keep body focus', () => {
	for (const removedIndex of [1, 2]) {
		const f = fixture();
		const rows = ['first.md', 'middle.md', 'last.md'].map(path => f.row(path).link);
		rows[removedIndex].focus();
		let replacement;
		f.redraw(() => { f.row('first.md'); replacement = f.row('remaining.md').link; });
		assert.equal(f.doc.activeElement, replacement);
		f.redraw(() => {});
		assert.equal(f.doc.activeElement, f.doc.body);
		f.navigation.unload();
	}
});

test('refresh never steals deliberate focus moved outside the root or onto another control', () => {
	for (const destination of ['outside', 'body', 'pill']) {
		const f = fixture();
		f.row('first.md').link.focus();
		f.navigation.beforeRender(); f.root.empty(); f.row('first.md');
		const target = destination === 'outside' ? f.outside : destination === 'body'
			? f.doc.body : f.root.append('button');
		// Body is already active after removal; focus outside first to simulate a real focusin.
		if (destination === 'body') f.outside.focus();
		target.focus(); f.navigation.afterRender();
		assert.equal(f.doc.activeElement, target, destination);
		f.navigation.unload();
	}
	const f = fixture();
	f.outside.focus();
	f.redraw(() => { f.row('first.md'); });
	assert.equal(f.doc.activeElement, f.outside);
	f.navigation.unload();
});

test('reset, inactive redraw and component unload discard restoration and remove delegated listeners', () => {
	for (const operation of ['reset', 'inactive', 'unload']) {
		const f = fixture(); f.row('first.md').link.focus();
		f.navigation.beforeRender();
		if (operation === 'reset') f.navigation.reset();
		if (operation === 'inactive') f.setActive(false);
		if (operation === 'unload') f.navigation.unload();
		f.root.empty(); const next = f.row('first.md').link;
		f.navigation.afterRender();
		assert.equal(f.doc.activeElement, f.doc.body, operation);
		if (operation === 'unload') {
			assert.equal(f.key('ArrowDown').defaultPrevented, false);
			assert.equal(next.focusCalls.length, 0);
		} else f.navigation.unload();
	}
});

test('escaping leaves row navigation, cancels restoration and prevents Enter from opening the old row', () => {
	const f = fixture();
	const first = f.row('first.md').link;
	first.focus();
	f.navigation.beforeRender();
	assert.equal(f.navigation.escape(), true);
	assert.equal(f.doc.activeElement, f.root);
	assert.deepEqual(f.root.focusCalls.at(-1), { preventScroll: true });
	f.key('Enter');
	assert.equal(first.clicks, 0);
	f.root.empty();
	const replacement = f.row('first.md').link;
	f.navigation.afterRender();
	assert.equal(f.doc.activeElement, f.root);
	assert.equal(f.navigation.escape(), false);
	f.key('ArrowDown');
	assert.equal(f.doc.activeElement, replacement);
	f.outside.focus();
	assert.equal(f.navigation.escape(), false);
	replacement.focus();
	f.setActive(false);
	assert.equal(f.navigation.escape(), false);
	assert.equal(f.doc.activeElement, replacement);
	f.navigation.unload();
});

test('Shift arrows select a range, reverse it and plain arrows resume one-item selection',()=>{
 const f=fixture();const rows=['a.md','b.md','c.md','d.md'].map(path=>f.row(path).link);
 rows[0].focus();f.key('ArrowDown',{shiftKey:true});
 assert.deepEqual(f.navigation.actionRows(rows[1]),rows.slice(0,2));
 assert.ok(rows[0].matches('.is-selected'));assert.ok(rows[1].matches('.is-selected'));
 f.key('ArrowDown',{shiftKey:true});assert.deepEqual(f.navigation.actionRows(rows[2]),rows.slice(0,3));
 f.key('ArrowUp',{shiftKey:true});assert.deepEqual(f.navigation.actionRows(rows[1]),rows.slice(0,2));
 f.key('ArrowDown');assert.deepEqual(f.navigation.actionRows(rows[2]),[rows[2]]);
 assert.ok(!rows[0].matches('.is-selected'));
 f.navigation.unload();
});
test('Shift click selects without opening, and selection includes exact inline identities after refresh',()=>{
 const f=fixture();const a=f.row('same.md');const b=f.row('same.md',{line:2,status:true});const c=f.row('same.md',{line:4});
 a.link.focus();const event=new Event('click',{cancelable:true});Object.defineProperty(event,'target',{value:c.title});Object.assign(event,{shiftKey:true});f.root.dispatchEvent(event);
 assert.equal(event.defaultPrevented,true);assert.deepEqual(f.navigation.actionRows(b.button),[a.link,b.link,c.link]);
 let newRows;f.redraw(()=>{newRows=[f.row('same.md').link,f.row('same.md',{line:2}).link,f.row('same.md',{line:4}).link];});
 assert.deepEqual(f.navigation.actionRows(newRows[1]),newRows);
 newRows[0].hidden=true;assert.deepEqual(f.navigation.actionRows(newRows[1]),newRows.slice(1));
 f.navigation.escape();assert.ok(newRows.every(row=>!row.matches('.is-selected')));
 f.navigation.unload();
});
test('actions on an unselected control affect only that item and filtered-out selection is dropped',()=>{
 const f=fixture();const a=f.row('a.md').link;const b=f.row('b.md').link;const c=f.row('c.md',{status:true});
 a.focus();f.key('ArrowDown',{shiftKey:true});assert.deepEqual(f.navigation.actionRows(c.button),[c.link]);
 let fresh;f.redraw(()=>{fresh=f.row('c.md').link;});assert.deepEqual(f.navigation.actionRows(fresh),[fresh]);
 f.navigation.unload();
});

test('Shift click anchors before the browser moves focus on pointer down',()=>{
 const f=fixture();const first=f.row('first.md').link;const last=f.row('last.md').link;
 first.focus();const pointer=new Event('pointerdown',{cancelable:true});Object.defineProperty(pointer,'target',{value:last});Object.assign(pointer,{shiftKey:true});f.root.dispatchEvent(pointer);
 last.focus();const click=new Event('click',{cancelable:true});Object.defineProperty(click,'target',{value:last});Object.assign(click,{shiftKey:true});f.root.dispatchEvent(click);
 assert.deepEqual(f.navigation.actionRows(last),[first,last]);f.navigation.unload();
});

test('Command on Mac and Control on Windows toggle discontiguous items without navigating',()=>{
 for(const mac of [true,false]) {
  Platform.isMacOS=mac;
  const f=fixture();const a=f.row('a.md').link;const b=f.row('b.md').link;const c=f.row('c.md',{status:true});
  const click=target=>{const event=new Event('click',{cancelable:true});Object.defineProperty(event,'target',{value:target});Object.assign(event,mac?{metaKey:true}:{ctrlKey:true});f.root.dispatchEvent(event);return event;};
  assert.equal(click(a).defaultPrevented,true);click(c.link);
  assert.deepEqual(f.navigation.actionRows(c.button),[a,c.link]);assert.ok(!b.matches('.is-selected'));
  click(c.button);assert.ok(!c.link.matches('.is-selected'));assert.equal(f.doc.activeElement,a);
  click(a);assert.equal(f.doc.activeElement,f.root);assert.ok(!a.matches('.is-selected'));
  assert.equal(a.clicks+b.clicks+c.link.clicks,0);f.navigation.unload();
 }
 Platform.isMacOS=true;
});

test('Command+A and Control+A select every visible entry and preserve the focused item for actions',()=>{
 for(const mac of [true,false]) {
  Platform.isMacOS=mac;const f=fixture();const a=f.row('same.md').link;const b=f.row('same.md',{line:3,status:true});const hidden=f.row('hidden.md').link;hidden.hidden=true;
  const modifiers=mac?{metaKey:true}:{ctrlKey:true};b.button.focus();
  assert.equal(f.key('a',modifiers).defaultPrevented,true);
  assert.deepEqual(f.navigation.actionRows(b.button),[a,b.link]);assert.equal(f.doc.activeElement,b.link);
  assert.ok(!hidden.matches('.is-selected'));
  f.navigation.escape();f.root.focus();f.key('a',modifiers);assert.equal(f.doc.activeElement,a);
  f.navigation.unload();
 }
 Platform.isMacOS=true;
});
test('Select All preserves text editing, other panes, overlays and inactive views',()=>{
 const f=fixture();f.row('first.md');
 for(const target of [f.root.append('input'),f.root.append('textarea'),f.root.append('div',{contenteditable:'true'}),f.outside]) {
  target.focus();assert.equal(f.key('a',{metaKey:true}).defaultPrevented,false);
 }
 f.root.focus();assert.equal(f.key('a',{ctrlKey:true}).defaultPrevented,false);
 assert.equal(f.key('a',{metaKey:true,shiftKey:true}).defaultPrevented,false);
 const menu=f.doc.body.append('div',{class:'menu'});assert.equal(f.key('a',{metaKey:true}).defaultPrevented,false);menu.hidden=true;
 f.setActive(false);assert.equal(f.key('a',{metaKey:true}).defaultPrevented,false);
 f.navigation.unload();
});

test('clicking empty space or another pane clears selection and row focus',()=>{
 for(const where of ['root','heading','outside']) {
  const f=fixture();const a=f.row('a.md').link;const b=f.row('b.md').link;a.focus();f.key('ArrowDown',{shiftKey:true});
  const target=where==='root'?f.root:where==='heading'?f.root.append('h3'):f.outside;
  const event=new Event('click',{cancelable:true});Object.defineProperty(event,'target',{value:target});f.doc.dispatchEvent(event);
  assert.ok(!a.matches('.is-selected'));assert.ok(!b.matches('.is-selected'));assert.equal(f.doc.activeElement,f.doc.body);assert.equal(event.defaultPrevented,false);
  f.navigation.unload();
 }
});
test('clicks inside rows, status controls and action overlays retain the selection',()=>{
 const f=fixture();const a=f.row('a.md').link;const b=f.row('b.md',{status:true});a.focus();f.key('ArrowDown',{shiftKey:true});
 for(const target of [b.title,b.button,f.doc.body.append('div',{class:'menu'}).append('button'),f.doc.body.append('div',{class:'modal-container'}).append('input')]) {
  const event=new Event('click');Object.defineProperty(event,'target',{value:target});f.doc.dispatchEvent(event);assert.deepEqual(f.navigation.actionRows(b.link),[a,b.link]);
 }
 f.navigation.unload();
});
