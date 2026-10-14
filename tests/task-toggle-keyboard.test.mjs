import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({
	entryPoints: [fileURLToPath(new URL('../src/ui/task-toggle-keyboard.ts', import.meta.url))],
	bundle: true, write: false, format: 'esm', plugins: [{ name: 'obsidian', setup(builder) {
		builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
		builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
			export const Platform = { isMacOS: true };
			export class Scope {
				constructor(parent) { this.parent = parent; }
				register(_modifiers, _key, handler) { this.handler = handler; }
			}
			export class Component {
				cleanups = [];
				registerEvent(ref) { this.cleanups.push(() => ref.off()); }
				register(cleanup) { this.cleanups.push(cleanup); }
				unload() { this.cleanups.forEach(cleanup => cleanup()); }
			}
		`, loader: 'js' }));
	} }],
});
const { taskToggleHotkeys, matchesHotkey, TaskToggleKeyboard } = await import(
	`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

const hotkey = { modifiers: ['Mod'], key: 'l' };
const event = (properties = {}) => ({ key: 'l', code: 'KeyL', metaKey: true, ctrlKey: false,
	shiftKey: false, altKey: false, ...properties });

test('task toggle reads a remapped native shortcut and honors an explicit empty override', () => {
	const manager = { getHotkeys: () => [{ modifiers: ['Mod', 'Shift'], key: 'k' }],
		getDefaultHotkeys: () => [hotkey] };
	assert.deepEqual(taskToggleHotkeys({ hotkeyManager: manager }), [{ modifiers: ['Mod', 'Shift'], key: 'k' }]);
	manager.getHotkeys = () => [];
	assert.deepEqual(taskToggleHotkeys({ hotkeyManager: manager }), []);
	manager.getHotkeys = () => undefined;
	assert.deepEqual(taskToggleHotkeys({ hotkeyManager: manager }), [hotkey]);
});

test('task toggle matches the native shortcut with exact platform modifiers', () => {
	assert.equal(matchesHotkey(event(), hotkey), true);
	assert.equal(matchesHotkey(event({ shiftKey: true }), hotkey), false);
	assert.equal(matchesHotkey(event({ altKey: true }), hotkey), false);
	assert.equal(matchesHotkey(event({ key: 'k', code: 'KeyK' }), hotkey), false);
	assert.equal(matchesHotkey(event({ key: 'k', code: 'KeyK', shiftKey: true }),
		{ modifiers: ['Mod', 'Shift'], key: 'KeyK' }), true);
});

test('task toggle uses a native scope for focused or selected rows and leaves other input alone', () => {
	let overlay = false;
	const doc = { body: {}, documentElement: {},
		querySelectorAll: () => overlay ? [{ getClientRects: () => [{}] }] : [] };
	let clicks = 0;
	const checkbox = { disabled: false, click: () => { clicks++; } };
	const row = { querySelector: () => checkbox };
	const selectedLink = { closest: () => row };
	let selected = [];
	const root = { ownerDocument: doc, contains: candidate => candidate === row,
		querySelectorAll: () => selected };
	let enabled = true;
	let activeScope;
	let nativeCalls = 0;
	let leafHandler;
	let currentHotkey = hotkey;
	const app = { scope: {}, keymap: {
		pushScope: scope => { activeScope = scope; },
		popScope: scope => { if (activeScope === scope) activeScope = undefined; },
	}, workspace: { on: (_name, handler) => { leafHandler = handler; return { off: () => { leafHandler = undefined; } }; } } };
	const keyboard = new TaskToggleKeyboard(app, root, () => enabled, () => [currentHotkey]);
	assert.ok(activeScope);
	const target = { isContentEditable: false, closest: selector => selector === '.horizon-task-item' ? row : null };
	const press = (source = target, properties = {}) => {
		const keydown = new Event('keydown', { cancelable: true });
		for (const [key, value] of Object.entries({ ...event(), repeat: false, isComposing: false,
			target: source, ...properties })) Object.defineProperty(keydown, key, { value });
		if (activeScope?.handler(keydown) === false) keydown.preventDefault();
		else nativeCalls++;
		return keydown;
	};
	assert.equal(press().defaultPrevented, true);
	assert.equal(clicks, 1);
	assert.equal(nativeCalls, 0);
	currentHotkey = { modifiers: ['Mod', 'Shift'], key: 'k' };
	press(target, { key: 'k', code: 'KeyK', shiftKey: true });
	assert.equal(clicks, 2);
	currentHotkey = hotkey;
	selected = [selectedLink];
	press({ isContentEditable: false, closest: () => null, ...doc.body });
	assert.equal(clicks, 2);
	const body = Object.assign(doc.body, { isContentEditable: false, closest: () => null });
	press(body);
	assert.equal(clicks, 3);
	checkbox.disabled = true; press(); checkbox.disabled = false;
	enabled = false; keyboard.sync(); assert.equal(activeScope, undefined);
	press(); enabled = true; leafHandler(); assert.ok(activeScope);
	overlay = true; press(); overlay = false;
	press(target, { repeat: true });
	press({ ...target, isContentEditable: true });
	press({ ...target, closest: selector => selector === '.horizon-task-item' ? row : selector.startsWith('textarea') ? {} : null });
	press({ ...target, closest: () => null });
	assert.equal(clicks, 3);
	keyboard.unload(); press();
	assert.equal(clicks, 3);
	assert.equal(activeScope, undefined);
});
