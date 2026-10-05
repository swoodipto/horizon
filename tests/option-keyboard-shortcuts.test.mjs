import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { build } = createRequire(import.meta.url)('esbuild');
const code = (await build({
	stdin: { contents: "export * from './option-keyboard-shortcuts'; export * from './sidebar-options';", loader: 'ts',
		resolveDir: fileURLToPath(new URL('../src/ui/', import.meta.url)) },
	bundle: true, write: false, format: 'esm', plugins: [{ name: 'mock-obsidian', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
		build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export class Component {
			cleanups=[];
			register(fn){this.cleanups.push(fn);}
			registerDomEvent(el,type,fn,options){el.addEventListener(type,fn,options);this.register(()=>el.removeEventListener(type,fn,options));}
			unload(){this.cleanups.splice(0).forEach(fn=>fn());}
		}
		export function addIcon() {}
		export function removeIcon() {}`, loader: 'js' }));
	} }],
})).outputFiles[0].text;
const { OptionKeyboardShortcuts, SIDEBAR_SECTIONS } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const options = SIDEBAR_SECTIONS.flatMap(section => section.options);

class Element {
	constructor(doc, tag = 'div', attrs = {}) {
		this.ownerDocument = doc; this.tagName = tag.toUpperCase(); this.children = [];
		this.attrs = new Map(Object.entries(attrs)); this.hidden = false;
	}
	append(tag, attrs = {}) {
		const child = new Element(this.ownerDocument, tag, attrs);
		child.parentElement = this; this.children.push(child); return child;
	}
	getAttribute(name) { return this.attrs.get(name) ?? null; }
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
				attrs.every(([, name, expected]) => expected === undefined
					? this.attrs.has(name) : this.getAttribute(name) === expected);
		});
	}
	closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
	querySelectorAll(selector) {
		return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
	}
	contains(child) { return child === this || this.children.some(element => element.contains(child)); }
	getClientRects() {
		for (let current = this; current; current = current.parentElement) if (current.hidden) return [];
		return this.ownerDocument.documentElement.contains(this) ? [{}] : [];
	}
	focus() { this.ownerDocument.activeElement = this; }
}

function fixture() {
	const doc = new EventTarget();
	doc.documentElement = new Element(doc, 'html');
	doc.body = doc.documentElement.append('body');
	doc.querySelectorAll = selector => doc.documentElement.querySelectorAll(selector);
	doc.activeElement = doc.body;
	const root = doc.body.append('div', { class: 'horizon' });
	const outside = doc.body.append('button');
	const activations = [];
	let active = true;
	let blocked = false;
	const shortcuts = new OptionKeyboardShortcuts(root, {
		isActive: () => active, isBlocked: () => blocked, activate: option => activations.push(option),
	});
	function key(key, { target = doc.activeElement, ...properties } = {}) {
		const event = new Event('keydown', { cancelable: true, bubbles: true });
		Object.defineProperty(event, 'target', { value: target });
		Object.assign(event, { key, isComposing: false, repeat: false, altKey: false,
			ctrlKey: false, metaKey: false, shiftKey: false, ...properties });
		if (properties.prevented) event.preventDefault();
		doc.dispatchEvent(event);
		return event;
	}
	return { doc, root, outside, activations, shortcuts, key,
		setActive: value => { active = value; }, setBlocked: value => { blocked = value; } };
}

test('all six letters use the shared option objects while focused inside Horizon', () => {
	const f = fixture();
	const title = f.root.append('button').append('span');
	title.focus();
	const expected = [['a', 'life-areas'], ['g', 'goals'], ['p', 'projects'],
		['i', 'insights'], ['u', 'upcoming'], ['t', 'timeline']];
	for (const [key, id] of expected) {
		assert.equal(f.key(key).defaultPrevented, true, key);
		assert.equal(f.activations.at(-1), options.find(option => option.id === id), id);
		assert.equal(f.doc.activeElement, title, 'controller leaves focus changes to the activation handler');
	}
	assert.equal(f.activations.length, expected.length);
	assert.equal(f.key('A').defaultPrevented, true, 'case-normalized key with no Shift modifier');
	assert.equal(f.activations.at(-1).label, 'Areas');
	f.shortcuts.unload();
});

test('sidebar focus works while a Markdown center view is active; document fallback requires an active Horizon view', () => {
	const f = fixture();
	f.setActive(false);
	for (const target of [f.root, f.root.append('button').append('span')]) {
		target.focus(); assert.equal(f.key('p').defaultPrevented, true);
	}
	for (const target of [f.doc.body, f.doc.documentElement]) {
		target.focus(); assert.equal(f.key('p').defaultPrevented, false);
		f.setActive(true); assert.equal(f.key('p').defaultPrevented, true);
		f.setActive(false);
	}
	f.outside.focus(); f.setActive(true);
	assert.equal(f.key('p').defaultPrevented, false, 'outside controls retain their keys');
	assert.equal(f.key('p', { target: null }).defaultPrevented, false);
	assert.equal(f.activations.length, 4);
	f.shortcuts.unload();
});

test('inputs, note editors and semantic textboxes keep typing inside and outside Horizon', () => {
	const f = fixture();
	for (const parent of [f.root, f.doc.body]) {
		const targets = ['input', 'textarea', 'select'].map(tag => parent.append(tag));
		targets.push(parent.append('div', { contenteditable: 'true' }).append('span'));
		targets.push(parent.append('div', { contenteditable: '' }).append('span'));
		targets.push(parent.append('div', { role: 'textbox' }).append('span'));
		for (const target of targets) {
			target.focus(); assert.equal(f.key('a').defaultPrevented, false, target.tagName);
			assert.equal(f.doc.activeElement, target);
		}
	}
	assert.equal(f.activations.length, 0);
	f.shortcuts.unload();
});

test('visible native menus and modals block shortcuts even when focus stays on the Horizon trigger', () => {
	const f = fixture();
	const trigger = f.root.append('button');
	for (const className of ['menu', 'modal-container']) {
		const overlay = f.doc.body.append('div', { class: className });
		for (const target of [trigger, f.doc.body]) {
			target.focus(); assert.equal(f.key('g').defaultPrevented, false, className);
		}
		overlay.hidden = true;
		trigger.focus(); assert.equal(f.key('g').defaultPrevented, true, 'hidden overlays do not block');
	}
	assert.equal(f.activations.length, 2);
	f.shortcuts.unload();
});

test('semantic menus and dialogs within Horizon and the view blocked gate retain their keys', () => {
	const f = fixture();
	for (const role of ['menu', 'dialog']) {
		const target = f.root.append('div', { role }).append('button');
		target.focus(); assert.equal(f.key('t').defaultPrevented, false, role);
	}
	f.root.focus(); f.setBlocked(true);
	assert.equal(f.key('t').defaultPrevented, false, 'open status menu gate');
	f.setBlocked(false); assert.equal(f.key('t').defaultPrevented, true);
	assert.equal(f.activations.length, 1);
	f.shortcuts.unload();
});

test('modified, repeated, composing, already handled and unmapped keys are untouched', () => {
	const f = fixture();
	f.root.focus();
	for (const properties of [{ altKey: true }, { ctrlKey: true }, { metaKey: true },
		{ shiftKey: true }, { repeat: true }, { isComposing: true }]) {
		assert.equal(f.key('p', properties).defaultPrevented, false, JSON.stringify(properties));
	}
	assert.equal(f.key('p', { prevented: true }).defaultPrevented, true);
	for (const key of ['x', 'ArrowDown', 'Escape', 'Enter', 'Tab', 'Process', 'Dead', '1']) {
		assert.equal(f.key(key).defaultPrevented, false, key);
	}
	assert.equal(f.activations.length, 0);
	f.shortcuts.unload();
});

test('multiple Horizon instances consume an event once and each scoped root selects its own handler', () => {
	const f = fixture();
	const otherRoot = f.doc.body.append('div');
	const otherActivations = [];
	const other = new OptionKeyboardShortcuts(otherRoot, {
		isActive: () => true, activate: option => otherActivations.push(option.id),
	});
	f.doc.body.focus(); assert.equal(f.key('p').defaultPrevented, true);
	assert.equal(f.activations.length, 1); assert.deepEqual(otherActivations, []);
	otherRoot.focus(); assert.equal(f.key('a').defaultPrevented, true);
	assert.equal(f.activations.length, 1); assert.deepEqual(otherActivations, ['life-areas']);
	f.root.focus(); assert.equal(f.key('g').defaultPrevented, true);
	assert.equal(f.activations.length, 2); assert.deepEqual(otherActivations, ['life-areas']);
	f.shortcuts.unload(); other.unload();
});

test('unloading removes the document listener and reopening has exactly one handler', () => {
	const f = fixture();
	f.root.focus(); f.shortcuts.unload();
	assert.equal(f.key('u').defaultPrevented, false);
	assert.equal(f.activations.length, 0);
	const reopened = new OptionKeyboardShortcuts(f.root, {
		isActive: () => true, activate: option => f.activations.push(option),
	});
	assert.equal(f.key('u').defaultPrevented, true);
	assert.equal(f.activations.length, 1);
	reopened.unload(); assert.equal(f.key('u').defaultPrevented, false);
	assert.equal(f.activations.length, 1);
});
