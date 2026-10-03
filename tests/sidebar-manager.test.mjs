import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('esbuild');
const source = fs.readFileSync(new URL('../src/ui/sidebar-manager.ts', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'ts', format: 'esm' }).code;
const { SidebarManager } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const TYPE = 'horizon-sidebar';
const liveView = () => ({ type: TYPE, kind: 'live' });
globalThis.window = { setTimeout, clearTimeout };

class Leaf {
	constructor(workspace, type, kind = 'live', state = {}) {
		this.workspace = workspace;
		this.view = { type, kind };
		this.state = state;
		this.detached = false;
		this.working = false;
		workspace.leaves.push(this);
	}
	getViewState() { return { type: this.view.type, state: this.state }; }
	async open(view) { this.view = view; await Promise.resolve(); }
	async setViewState(state) {
		// Obsidian drops competing setViewState calls instead of queueing them.
		if (this.working) return;
		this.working = true;
		await Promise.resolve();
		this.view = state.type === TYPE ? liveView() : { type: state.type, kind: 'empty' };
		this.state = state.state ?? {};
		this.working = false;
	}
	async loadIfDeferred() {
		if (this.view.kind === 'deferred') { await Promise.resolve(); this.view = liveView(); }
	}
	detach() {
		this.detached = true;
		this.workspace.leaves = this.workspace.leaves.filter(leaf => leaf !== this);
	}
}

function workspace() {
	return {
		leaves: [], leftSplit: {}, created: 0, revealed: [], recent: null, saves: 0,
		getLeavesOfType(type) { return this.leaves.filter(leaf => leaf.view.type === type); },
		iterateAllLeaves(fn) { [...this.leaves].forEach(fn); },
		getMostRecentLeaf() { return this.recent; },
		getLeftLeaf() { this.created++; return new Leaf(this, 'empty', 'empty'); },
		async revealLeaf(leaf) { this.revealed.push(leaf); },
		setActiveLeaf(leaf) { this.recent = leaf; },
		requestSaveLayout() { this.saves++; },
	};
}

function manager(ws) {
	return new SidebarManager(ws, TYPE, liveView, view => view.kind === 'live' && view.type === TYPE);
}

function registerViews(ws) {
	return Promise.all(ws.getLeavesOfType(TYPE).map(async leaf => {
		const state = leaf.getViewState();
		await leaf.open({ type: 'empty', kind: 'empty' });
		await leaf.setViewState(state);
	}));
}

test('reload reuses the captured pane while registration temporarily makes it empty', async () => {
	const ws = workspace();
	const original = new Leaf(ws, TYPE, 'ghost');
	const sidebar = manager(ws);
	const reconstruction = registerViews(ws);
	assert.equal(ws.getLeavesOfType(TYPE).length, 0, 'reproduces the native registration race');
	sidebar.start();
	await sidebar.open(false);
	await reconstruction;
	assert.deepEqual(ws.getLeavesOfType(TYPE), [original]);
	assert.equal(ws.created, 0);
	assert.equal(ws.revealed.length, 0);
});

test('cleans the four saved copies, preserves the current pane and other plugin tabs', async () => {
	const ws = workspace();
	const unrelated = new Leaf(ws, 'other-plugin', 'ghost');
	new Leaf(ws, TYPE);
	new Leaf(ws, TYPE, 'ghost');
	new Leaf(ws, TYPE, 'ghost');
	const selected = new Leaf(ws, TYPE);
	ws.recent = selected;
	const sidebar = manager(ws);
	sidebar.start();
	await sidebar.open(false);
	assert.deepEqual(ws.getLeavesOfType(TYPE), [selected]);
	assert.equal(unrelated.detached, false);
	assert.equal(ws.recent, selected);
	assert.equal(ws.created, 0);
});

test('repairs a ghost even though its view type already matches', async () => {
	const ws = workspace();
	const ghost = new Leaf(ws, TYPE, 'ghost', { customState: 'kept' });
	const sidebar = manager(ws);
	sidebar.start();
	await sidebar.open(false);
	assert.equal(ghost.view.kind, 'live');
	assert.deepEqual(ghost.state, { customState: 'kept' });
	assert.equal(ws.created, 0);
});

test('simultaneous startup and command requests create exactly one pane', async () => {
	const ws = workspace();
	const sidebar = manager(ws);
	sidebar.start();
	await Promise.all([sidebar.open(false), sidebar.open(true), sidebar.open(true)]);
	assert.equal(ws.created, 1);
	assert.equal(ws.getLeavesOfType(TYPE).length, 1);
	assert.equal(ws.revealed.length, 2);
});

test('deferred panes are loaded and reused', async () => {
	const ws = workspace();
	const deferred = new Leaf(ws, TYPE, 'deferred');
	const sidebar = manager(ws);
	sidebar.start();
	await sidebar.open(true);
	assert.equal(deferred.view.kind, 'live');
	assert.equal(ws.created, 0);
	assert.deepEqual(ws.revealed, [deferred]);
});

test('disabling before initialization prevents a late pane creation', async () => {
	const ws = workspace();
	const sidebar = manager(ws);
	const pending = sidebar.open(false);
	sidebar.dispose();
	sidebar.start();
	await pending;
	assert.equal(ws.created, 0);
});

test('a captured leaf changed to a different view is never removed', async () => {
	const ws = workspace();
	const former = new Leaf(ws, TYPE);
	const sidebar = manager(ws);
	former.view = { type: 'markdown', kind: 'live' };
	sidebar.start();
	await sidebar.open(false);
	assert.equal(former.detached, false);
	assert.equal(former.view.type, 'markdown');
	assert.equal(ws.getLeavesOfType(TYPE).length, 1);
});
