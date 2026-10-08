import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const output = await build({ entryPoints: [fileURLToPath(new URL('../src/ui/tooltips.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm' });
const { suppressTooltip, suppressHorizonTooltips, DISABLED_TOOLTIP_CLASS } = await import(
	`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

class Element {
	constructor(attributes = {}, children = []) {
		this.attributes = { ...attributes }; this.children = children; this.nodeType = 1;
		this.ownerDocument = {}; this.parent = undefined; this.writes = 0;
		for (const child of children) child.parent = this;
	}
	getAttribute(name) { return this.attributes[name] ?? null; }
	hasAttribute(name) { return name in this.attributes; }
	setAttribute(name, value) { this.attributes[name] = value; this.writes++; }
	removeAttribute(name) { delete this.attributes[name]; this.writes++; }
	closest() {
		for (let node = this; node; node = node.parent) {
			if (node.attributes.class === 'horizon-insights-tooltip') return node;
		}
		return null;
	}
	querySelectorAll() {
		return this.children.flatMap(child => [
			...(child.hasAttribute('aria-label') || child.hasAttribute('title') ? [child] : []),
			...child.querySelectorAll(),
		]);
	}
}

test('native tooltips are suppressed while accessible labels and existing classes survive', () => {
	const button = new Element({ 'aria-label': 'Change project status', 'data-tooltip-classes': 'horizon-project-tooltip' });
	suppressTooltip(button);
	assert.equal(button.getAttribute('aria-label'), 'Change project status');
	assert.equal(button.getAttribute('data-tooltip-classes'), `horizon-project-tooltip ${DISABLED_TOOLTIP_CLASS}`);
	const writes = button.writes;
	suppressTooltip(button);
	assert.equal(button.writes, writes, 'observer mutations settle without rewriting their own attributes');
});

test('browser title popups are removed without replacing an existing accessible name', () => {
	const button = new Element({ title: 'Open project note', 'aria-label': 'Open example' });
	suppressTooltip(button);
	assert.equal(button.getAttribute('title'), null);
	assert.equal(button.getAttribute('aria-label'), 'Open example');
	const tick = new Element({ title: '2026-10-08' });
	suppressTooltip(tick);
	assert.equal(tick.getAttribute('title'), null);
	assert.equal(tick.getAttribute('aria-label'), '2026-10-08');
});

test('graph tooltip content is preserved and only marked native popups are hidden by CSS', () => {
	const label = new Element({ 'aria-label': 'Today: 50%' });
	const tooltip = new Element({ class: 'horizon-insights-tooltip', role: 'status', 'aria-live': 'polite' }, [label]);
	suppressTooltip(label); suppressTooltip(tooltip);
	assert.equal(label.getAttribute('data-tooltip-classes'), null);
	assert.equal(tooltip.getAttribute('role'), 'status');
	const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
	assert.match(css, /\.tooltip\.horizon-tooltip-disabled\s*\{\s*display: none;\s*\}/);
});

test('later controls and label updates remain suppressed, unrelated UI stays untouched, close disconnects', () => {
	let observer;
	class Observer {
		constructor(callback) { this.callback = callback; observer = this; }
		observe(root, options) { this.root = root; this.options = options; }
		disconnect() { this.disconnected = true; }
	}
	const existing = new Element({ 'aria-label': 'Existing control' });
	const root = new Element({}, [existing]);
	root.ownerDocument.defaultView = { MutationObserver: Observer };
	const outside = new Element({ 'aria-label': 'Other plugin' });
	const stop = suppressHorizonTooltips(root);
	assert.equal(observer.root, root);
	assert.equal(existing.getAttribute('data-tooltip-classes'), DISABLED_TOOLTIP_CLASS);
	assert.equal(outside.getAttribute('data-tooltip-classes'), null);
	const added = new Element({}, [new Element({ title: 'Later item' })]);
	observer.callback([{ type: 'childList', addedNodes: [added, { nodeType: 3 }] }]);
	assert.equal(added.children[0].getAttribute('data-tooltip-classes'), DISABLED_TOOLTIP_CLASS);
	existing.setAttribute('data-tooltip-classes', 'horizon-project-tooltip');
	observer.callback([{ type: 'attributes', target: existing }]);
	assert.equal(existing.getAttribute('data-tooltip-classes'), `horizon-project-tooltip ${DISABLED_TOOLTIP_CLASS}`);
	stop(); assert.equal(observer.disconnected, true);
});
