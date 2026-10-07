import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
const { transformSync } = createRequire(import.meta.url)('esbuild');
const code = transformSync(fs.readFileSync(new URL('../src/ui/open-notes.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'esm' }).code;
const { openNotesInCenter } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const TYPE = 'horizon-tagged-notes';
const leaf = type => ({ type, calls: [], getViewState() { return { type: this.type }; }, async setViewState(state) { this.calls.push(state); this.type = state.type; } });
function workspace(roots, recent) {
	return { roots, recent, created: 0, iterateRootLeaves(fn) { this.roots.forEach(fn); },
		getMostRecentLeaf() { return this.recent; }, getLeaf(mode) { assert.equal(mode, 'tab'); this.created++; const next = leaf('empty'); this.roots.push(next); return next; },
		async revealLeaf(target) { this.revealed = target; }, setActiveLeaf(target) { this.active = target; } };
}
test('uses the center blank tab and reveals the selected tag category', async () => {
	const blank = leaf('empty'); const ws = workspace([blank], blank);
	assert.equal(await openNotesInCenter(ws, TYPE, 'life-areas'), blank);
	assert.equal(ws.created, 0); assert.equal(ws.active, blank);
	assert.deepEqual(blank.calls[0].state, { optionId: 'life-areas' });
});
test('reuses the results tab when switching categories', async () => {
	const results = leaf(TYPE); const note = leaf('markdown'); const ws = workspace([note, results], note);
	await openNotesInCenter(ws, TYPE, 'goals'); await openNotesInCenter(ws, TYPE, 'life-areas'); await openNotesInCenter(ws, TYPE, 'projects');
	assert.equal(ws.created, 0); assert.equal(ws.active, results);
	assert.deepEqual(results.calls.map(call => call.state.optionId), ['goals', 'life-areas', 'projects']);
	assert.equal(note.calls.length, 0);
});
test('creates a center tab instead of replacing an open note', async () => {
	const note = leaf('markdown'); const ws = workspace([note], note);
	await openNotesInCenter(ws, TYPE, 'life-areas');
	assert.equal(ws.created, 1); assert.equal(note.type, 'markdown'); assert.notEqual(ws.active, note);
});
