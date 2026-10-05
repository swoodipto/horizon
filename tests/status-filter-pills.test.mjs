import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { build } = createRequire(import.meta.url)('esbuild');
const mock = `export class Component {
 cleanups=[];register(fn){this.cleanups.push(fn);}
 registerDomEvent(el,type,fn,opts){const options=typeof opts==='boolean'?{capture:opts}:opts;
 el.addEventListener(type,fn,options);this.register(()=>el.removeEventListener(type,fn,options));}
 unload(){this.cleanups.splice(0).forEach(fn=>fn());}
}
export const Platform={isMobile:false,isMacOS:true};
export class Notice {static messages=[];constructor(message){Notice.messages.push(message);}}
export function setIcon(){}`;
const code = (await build({
	stdin: { contents: "export * from './status-filter-pills'; export { Platform, Notice } from 'obsidian';", loader: 'ts',
		resolveDir: fileURLToPath(new URL('../src/ui/', import.meta.url)) },
	bundle: true, write: false, format: 'esm', plugins: [{ name: 'mock-obsidian', setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
		build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: mock, loader: 'js' }));
	} }],
})).outputFiles[0].text;
const { StatusFilterPills, Platform, Notice } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

class Element extends EventTarget {
	constructor(doc, tag = 'DIV') { super(); this.ownerDocument = doc; this.tagName = tag; this.children = []; this.attrs = {}; this.scrollLeft = 0; }
	setAttribute(key, value) { this.attrs[key] = value; }
	getAttribute(key) { return this.attrs[key]; }
	toggleClass(cls, value) {
		const names = new Set((this.className ?? '').split(' '));
		if (value) names.add(cls); else names.delete(cls);
		this.className = [...names].join(' ');
	}
	createEl(tag, { cls = '', attr = {}, text } = {}) {
		const child = new Element(this.ownerDocument, tag.toUpperCase());
		child.className = cls; child.textContent = text; child.parent = this;
		Object.entries(attr).forEach(([key, value]) => child.setAttribute(key, value));
		this.children.push(child); return child;
	}
	createDiv(options) { return this.createEl('div', options); }
	createSpan(options) { return this.createEl('span', options); }
	querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(child => child.tagName === 'BUTTON'); }
	closest() { if (this.tagName === 'BUTTON') return this; return this.parent?.closest(); }
	contains(child) { return child === this || this.children.some(item => item.contains(child)); }
	focus() { this.ownerDocument.activeElement = this; }
	scrollIntoView() { this.scrolled = true; }
	empty() { this.children.forEach(child => child.parent = undefined); this.children = []; }
}
function fixture({ mobile = false, mac = true, initial = 'all' } = {}) {
	Platform.isMobile = mobile; Platform.isMacOS = mac; Notice.messages = [];
	const doc = new EventTarget();
	doc.defaultView = new EventTarget();
	doc.defaultView.setTimeout = (fn, ms) => setTimeout(fn, ms);
	doc.defaultView.clearTimeout = timer => clearTimeout(timer);
	const root = new Element(doc);
	const selections = [];
	let filter = initial;
	const statuses = ['todo', 'backburner', 'waiting', 'doing'].map(tag => ({ tag, icon: 'circle' }));
	const pills = new StatusFilterPills(() => filter, value => {
		filter = value; selections.push(value); redraw();
	});
	function redraw() { pills.beforeRender(); root.empty(); pills.render(root, statuses); }
	pills.bind(root); pills.render(root, statuses);
	const button = tag => root.querySelectorAll().find(item => item.getAttribute('data-status-filter') === tag);
	function event(type, tag, properties = {}, target = root, source) {
		const ev = new Event(type, { cancelable: true });
		Object.defineProperty(ev, 'target', { value: source ?? (tag ? button(tag) : root) });
		Object.assign(ev, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 0, clientY: 0,
			metaKey: false, ctrlKey: false, ...properties });
		target.dispatchEvent(ev); return ev;
	}
	return { root, doc, pills, button, event, selections, redraw, filter: () => filter };
}

test('Mac Command and Windows Control toggle multiple statuses; normal clicks replace them', () => {
	for (const mac of [true, false]) {
		const f = fixture({ mac });
		f.event('click', 'doing');
		f.event('click', 'waiting', mac ? { metaKey: true } : { ctrlKey: true });
		assert.deepEqual(f.filter(), ['waiting', 'doing']);
		f.event('click', 'backburner');
		assert.deepEqual(f.filter(), ['backburner']);
		assert.equal(f.button('backburner').getAttribute('aria-pressed'), 'true');
		assert.equal(f.button('doing').getAttribute('aria-pressed'), 'false');
		f.event('click', 'backburner');
		assert.equal(f.filter(), 'all');
		f.pills.unload();
	}
});

test('mobile requires the full second; long press preserves its status and suppresses the release click', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const f = fixture({ mobile: true, initial: ['doing'] });
	f.event('pointerdown', 'doing');
	t.mock.timers.tick(999);
	assert.equal(Notice.messages.length, 0);
	t.mock.timers.tick(1);
	assert.match(Notice.messages[0], /Multi-select is active/);
	f.event('pointerup', 'doing', {}, f.doc);
	f.event('click', 'doing');
	assert.deepEqual(f.filter(), ['doing']);
	f.event('pointerdown', 'waiting');
	f.event('pointerup', 'waiting', {}, f.doc);
	f.event('click', 'waiting');
	assert.deepEqual(f.filter(), ['waiting', 'doing']);
	f.event('pointerdown', 'waiting');
	t.mock.timers.tick(1000);
	assert.equal(Notice.messages.at(-1), 'Multi-select is off.');
	f.event('click', 'waiting'); // suppressed release click
	f.event('pointerdown', 'backburner');
	f.event('pointerup', 'backburner', {}, f.doc);
	f.event('click', 'backburner');
	assert.deepEqual(f.filter(), ['backburner']);
	f.pills.unload();
});

test('long press from an unfiltered list selects the held pill exactly once', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const f = fixture({ mobile: true });
	f.event('pointerdown', 'waiting');
	t.mock.timers.tick(1000);
	f.event('click', 'waiting');
	assert.deepEqual(f.selections, [['waiting']]);
	f.pills.unload();
});

test('swiping, releasing outside, cancellation and view cleanup cancel pending holds', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	for (const cancel of ['move', 'release', 'cancel', 'scroll', 'redraw', 'unload']) {
		const f = fixture({ mobile: true });
		f.event('pointerdown', 'doing');
		if (cancel === 'move') f.event('pointermove', undefined, { clientX: 20 }, f.doc);
		if (cancel === 'release') f.event('pointerup', undefined, {}, f.doc);
		if (cancel === 'cancel') f.event('pointercancel', undefined, {}, f.doc);
		if (cancel === 'scroll') f.event('scroll');
		if (cancel === 'redraw') f.redraw();
		if (cancel === 'unload') f.pills.unload();
		t.mock.timers.tick(2500);
		assert.deepEqual(f.selections, [], cancel);
		assert.deepEqual(Notice.messages, [], cancel);
		if (cancel !== 'unload') f.pills.unload();
	}
});

test('redraw preserves horizontal scroll and keyboard focus across a selection', () => {
	const f = fixture();
	f.root.children[0].scrollLeft = 180;
	f.button('waiting').focus();
	f.event('click', 'waiting');
	assert.equal(f.root.children[0].scrollLeft, 180);
	assert.equal(f.doc.activeElement, f.button('waiting'));
	f.pills.unload();
});

test('edge fades follow hidden content and disappear when the row fits', () => {
	const f = fixture();
	const row = f.root.children[0];
	row.clientWidth = 160;
	row.scrollWidth = 400;
	f.event('scroll', undefined, {}, f.root, row);
	assert.ok(row.className.includes('can-scroll-right'));
	assert.ok(!row.className.includes('can-scroll-left'));
	row.scrollLeft = 120;
	f.event('scroll', undefined, {}, f.root, row);
	assert.ok(row.className.includes('can-scroll-right'));
	assert.ok(row.className.includes('can-scroll-left'));
	row.scrollLeft = 240;
	f.event('scroll', undefined, {}, f.root, row);
	assert.ok(!row.className.includes('can-scroll-right'));
	assert.ok(row.className.includes('can-scroll-left'));
	row.scrollWidth = 160;
	f.event('scroll', undefined, {}, f.root, row);
	assert.ok(!row.className.includes('can-scroll-right'));
	assert.ok(!row.className.includes('can-scroll-left'));
	f.pills.unload();
});

test('clearing selection removes the filter and exits mobile multi-select', t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const f = fixture({ mobile: true, initial: ['doing'] });
	f.event('pointerdown', 'doing');
	t.mock.timers.tick(1000);
	assert.equal(f.root.children[0].getAttribute('aria-label'), 'Project status filters, multi-select active');
	assert.equal(f.pills.clearSelection(), true);
	assert.equal(f.filter(), 'all');
	assert.equal(f.root.children[0].getAttribute('aria-label'), 'Project status filters');
	assert.equal(f.pills.clearSelection(), false);
	f.pills.unload();
});

test('a single available status does not render a filter row', () => {
	const f = fixture();
	f.pills.beforeRender();
	f.root.empty();
	f.pills.render(f.root, [{ tag: 'doing', icon: 'circle' }]);
	assert.equal(f.root.children.length, 0);
	f.pills.unload();
});

test('arrow stepping selects filters, scrolls the pill and preserves pill focus through redraw', () => {
 const f=fixture(); const first=f.button('todo'); first.focus();
 assert.equal(f.pills.step(1),true); assert.deepEqual(f.filter(),['todo']);
 assert.equal(first.scrolled,true);assert.equal(f.doc.activeElement,f.button('todo'));
 f.pills.step(1);assert.deepEqual(f.filter(),['backburner']);assert.equal(f.doc.activeElement,f.button('backburner'));
 f.pills.step(-1);f.pills.step(-1);assert.equal(f.filter(),'all');
 f.pills.reset();assert.equal(f.pills.step(1),false);
});

test('Shift arrows add filters in either direction and plain arrows resume single selection', () => {
 const f=fixture({initial:['backburner']});f.button('backburner').focus();
 f.pills.step(1,true);assert.deepEqual(f.filter(),['backburner','waiting']);
 assert.equal(f.doc.activeElement,f.button('waiting'));
 f.pills.step(1,true);assert.deepEqual(f.filter(),['backburner','waiting','doing']);
 f.pills.step(1,true);assert.deepEqual(f.filter(),['backburner','waiting','doing']);
 f.pills.step(-1,true);assert.deepEqual(f.filter(),['todo','backburner','waiting','doing']);
 assert.equal(f.doc.activeElement,f.button('todo'));
 f.pills.step(-1,true);assert.deepEqual(f.filter(),['todo','backburner','waiting','doing']);
 f.pills.step(1);assert.equal(f.filter(),'all');
 f.pills.step(-1,true);assert.deepEqual(f.filter(),['doing']);
 f.pills.step(-1,true);assert.deepEqual(f.filter(),['waiting','doing']);
 f.pills.step(-1);assert.deepEqual(f.filter(),['backburner']);
 f.pills.step(1);assert.deepEqual(f.filter(),['waiting']);
 f.pills.unload();
});
