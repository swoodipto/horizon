import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function moduleAt(relative, mock = '') {
	const output = await build({ entryPoints: [fileURLToPath(new URL(relative, import.meta.url))], bundle: true, write: false, format: 'esm', plugins: mock ? [{
		name: 'obsidian', setup(builder) {
			builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'mock', namespace: 'test' }));
			builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: mock, loader: 'js' }));
		},
	}] : [] });
	return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}
const { completionBuckets, completionBarGeometry } = await moduleAt('../src/insights/completion-bars.ts');
const { GoalGraph } = await moduleAt('../src/insights/graph.ts', `export class Component {
	cleanups = []; register(fn) { this.cleanups.push(fn); }
	registerDomEvent(el, name, fn) { el.listeners.set(name, fn); this.register(() => el.listeners.delete(name)); }
	unload() { for (const fn of this.cleanups) fn(); }
}`);
const { graphLayout } = await moduleAt('../src/insights/graph-layout.ts');

const completion = (bucket, contributorId) => ({ bucket, contributorId, date: bucket, at: 1 });
test('bars count distinct observed children per bucket, not aggregate count differences', () => {
	assert.deepEqual(completionBuckets([completion('2026-10-01', 1), completion('2026-10-01', 1),
		completion('2026-10-01', 2), completion('2026-10-08', 1)]), [
		{ date: '2026-10-01', count: 2 }, { date: '2026-10-08', count: 1 },
	]);
	assert.deepEqual(completionBarGeometry([], '2026-10-08', () => 0, 100, 120), []);
});
test('bar geometry remains finite for current buckets and the civil-date boundary', () => {
	for (const date of ['2026-10-08', '9999-12-31']) {
		const bars = completionBarGeometry([completion(date, 1)], date, () => 90, 100, 120);
		assert.equal(bars.length, 1);
		for (const property of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(bars[0][property]));
		assert.ok(bars[0].height > 0 && bars[0].width > 0);
	}
});
test('a same-day gap survives aggregation in the keyboard-readable sample', () => {
	const p = (date, at, gap) => ({ date, at, scope: 1, started: 1, completed: 0, progress: 50, ...(gap ? { gap } : {}) });
	const layout = graphLayout([p('2026-10-01', 1), p('2026-10-02', 2, true), p('2026-10-02', 3)],
		{ kind: 'unavailable', message: '' }, '2026-10-02');
	assert.equal(layout.samples[1].gap, true);
});

class Element {
	constructor(tag = 'div') {
		this.tag = tag; this.children = []; this.listeners = new Map(); this.attributes = {}; this.dataset = {};
		this.classList = { add() {} }; this.ownerDocument = { createElementNS: (_ns, tag) => new Element(tag) };
		this.clientWidth = 409; this.hidden = false;
	}
	setAttribute(key, value) { this.attributes[key] = value; }
	appendChild(el) { this.children.push(el); return el; }
	createDiv() { return this.appendChild(new Element()); }
	replaceChildren() { this.children = []; }
	getBoundingClientRect() { return { left: 0 }; }
	trigger(name, props = {}) {
		const event = { target: this, prevented: false, stopped: false,
			preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...props };
		this.listeners.get(name)?.(event); return event;
	}
}
function graph(t) {
	let disconnected = false;
	t.mock.method(globalThis, 'ResizeObserver', function () { return { observe() {}, disconnect() { disconnected = true; } }; });
	const root = new Element(); const component = new GoalGraph(root);
	component.update(['2026-10-01', '2026-10-07'].map((date, index) => ({ at: index, date, scope: 10, started: 2,
		completed: index * 5, progress: index * 60 })), { kind: 'unavailable', message: '' });
	return { root, component, tooltip: root.children[1], disconnected: () => disconnected };
}
// Node has no observers; temporarily define one so mock.method can restore each test safely.
globalThis.ResizeObserver = class {};
test('keyboard inspection exposes actual counts, clears on Escape, and leaves other keys alone', t => {
	const { root, tooltip, component, disconnected } = graph(t);
	assert.equal(root.children[0].attributes['aria-hidden'], 'true');
	assert.equal(root.trigger('keydown', { key: 'Home' }).prevented, true);
	assert.match(tooltip.textContent, /Completed 0/);
	root.trigger('keydown', { key: 'ArrowRight' }); assert.match(tooltip.textContent, /Completed 5/);
	root.trigger('keydown', { key: 'Escape' }); assert.equal(tooltip.hidden, true);
	assert.equal(root.trigger('keydown', { key: 'g' }).prevented, false);
	assert.equal(root.trigger('keydown', { key: 'ArrowRight', ctrlKey: true }).prevented, false);
	assert.equal(root.trigger('keydown', { key: 'ArrowRight', target: {} }).prevented, false);
	component.unload(); assert.equal(root.listeners.size, 0); assert.equal(disconnected(), true);
});
test('touch taps select, scrolling cancels, pointer cancellation and blur clear selection', t => {
	const { root, tooltip } = graph(t);
	root.trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 20 });
	root.trigger('pointerup', { pointerType: 'touch', clientX: 10, clientY: 20 }); assert.equal(tooltip.hidden, false);
	root.trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 20 });
	root.trigger('pointermove', { pointerType: 'touch', clientX: 10, clientY: 40 });
	root.trigger('pointerup', { pointerType: 'touch', clientX: 10, clientY: 40 }); assert.equal(tooltip.hidden, true);
	root.trigger('pointermove', { pointerType: 'mouse', clientX: 10 }); assert.equal(tooltip.hidden, false);
	root.trigger('pointercancel'); assert.equal(tooltip.hidden, true);
	root.trigger('keydown', { key: 'End' }); root.trigger('blur'); assert.equal(tooltip.hidden, true);
});
