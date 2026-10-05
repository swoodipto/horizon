import type { App, TFile } from 'obsidian';
import { DATE_PROPERTIES, parseDate } from '../planning/dates';

type WriteApp = Pick<App, 'vault' | 'fileManager' | 'metadataCache'>;
type Value = { present: boolean; value?: unknown };
type PropertyChange = { key: string; before: Value; after: Value };
type LineChange = { index: number; before: string; after: string };
type Change = { path: string } & (
	{ kind: 'properties'; changes: PropertyChange[] } | { kind: 'lines'; changes: LineChange[] }
);
const PROPERTIES = ['tags', 'parent', 'dependent', DATE_PROPERTIES.start, 'deadline'];
const snapshot = (properties: Record<string, unknown>, key: string): Value => ({
	present: Object.prototype.hasOwnProperty.call(properties, key), value: structuredClone(properties[key]),
});
const equal = (left: Value, right: Value): boolean => left.present === right.present &&
	JSON.stringify(left.value) === JSON.stringify(right.value);

/** In-memory history of Horizon writes; replay changes only the fields/lines it owns. */
export class NoteActionHistory {
	private undoStack: Change[][] = [];
	private redoStack: Change[][] = [];
	private busy = false;
	private generation = 0;

	constructor(private app: WriteApp) {}

	clear(): void { this.generation++; this.undoStack = []; this.redoStack = []; }

	async record(action: (app: WriteApp) => Promise<void>): Promise<void> {
		if (this.busy) throw new Error('Wait for the current change to finish.');
		this.busy = true;
		const generation = this.generation;
		const changes: Change[] = [];
		try { await action(this.trackedApp(changes)); }
		finally {
			// A bulk action can succeed for some items even if others fail.
			if (changes.length && generation === this.generation) {
				this.undoStack.push(changes);
				this.undoStack = this.undoStack.slice(-50);
				this.redoStack = [];
			}
			this.busy = false;
		}
	}

	undo(): Promise<boolean> { return this.move(this.undoStack, this.redoStack, true); }
	redo(): Promise<boolean> { return this.move(this.redoStack, this.undoStack, false); }

	private async move(from: Change[][], to: Change[][], undo: boolean): Promise<boolean> {
		if (this.busy) throw new Error('Wait for the current change to finish.');
		const pending = from.at(-1);
		if (!pending?.length) return false;
		this.busy = true;
		const generation = this.generation;
		const completed: Change[] = [];
		const total = pending.length;
		try {
			while (pending.length && generation === this.generation) {
				const change = undo ? pending.at(-1) : pending[0];
				if (!change) break;
				await this.replay(change, undo);
				if (undo) { pending.pop(); completed.unshift(change); }
				else { pending.shift(); completed.push(change); }
			}
			return true;
		} catch (error: unknown) {
			throw new Error(`${undo ? 'Undo' : 'Redo'} stopped after ${completed.length} of ${total} changes. ${error instanceof Error ? error.message : 'The note changed.'}`);
		} finally {
			if (generation === this.generation) {
				if (!pending.length) from.pop();
				if (completed.length) to.push(completed);
			}
			this.busy = false;
		}
	}

	private trackedApp(changes: Change[]): WriteApp {
		const app = this.app;
		const properties = async (file: TFile, apply: (properties: Record<string, unknown>) => void): Promise<void> => {
			let delta: PropertyChange[] = [];
			await app.fileManager.processFrontMatter(file, (current: Record<string, unknown>) => {
				const before = PROPERTIES.map(key => snapshot(current, key));
				apply(current);
				delta = PROPERTIES.flatMap((key, index) => {
					const previous = before[index];
					const after = snapshot(current, key);
					return previous && !equal(previous, after) ? [{ key, before: previous, after }] : [];
				});
			});
			if (delta.length) changes.push({ path: file.path, kind: 'properties', changes: delta });
		};
		const lines = async (file: TFile, apply: (content: string) => string): Promise<string> => {
			let delta: LineChange[] = [];
			const result = await app.vault.process(file, current => {
				const next = apply(current);
				const before = current.split(/(\r?\n)/);
				const after = next.split(/(\r?\n)/);
				if (before.length !== after.length) throw new Error('This change cannot be recorded for undo.');
				delta = before.flatMap((value, index) => value !== after[index]
					? [{ index, before: value, after: after[index] ?? '' }] : []);
				return next;
			});
			if (delta.length) changes.push({ path: file.path, kind: 'lines', changes: delta });
			return result;
		};
		return {
			metadataCache: app.metadataCache,
			fileManager: new Proxy(app.fileManager, { get: (target, key) => key === 'processFrontMatter'
				? properties : this.bound(target, key) }),
			vault: new Proxy(app.vault, { get: (target, key) => key === 'process' ? lines : this.bound(target, key) }),
		};
	}

	private bound(target: object, key: string | symbol): unknown {
		const value: unknown = Reflect.get(target, key);
		return typeof value === 'function' ? value.bind(target) : value;
	}

	private async replay(change: Change, undo: boolean): Promise<void> {
		const file = this.app.vault.getFileByPath(change.path);
		if (!file) throw new Error('The note no longer exists.');
		if (change.kind === 'properties') {
			await this.app.fileManager.processFrontMatter(file, (current: Record<string, unknown>) => {
				for (const item of change.changes) {
					if (!equal(snapshot(current, item.key), undo ? item.after : item.before)) {
						throw new Error(`${file.basename}: ${item.key} changed since this action.`);
					}
				}
				const next = { ...current };
				for (const item of change.changes) {
					const value = undo ? item.before : item.after;
					if (value.present) next[item.key] = structuredClone(value.value);
					else delete next[item.key];
				}
				if (change.changes.some(item => item.key === DATE_PROPERTIES.start || item.key === 'deadline')) {
					const start = parseDate(next[DATE_PROPERTIES.start]);
					const deadline = parseDate(next.deadline);
					if (start && deadline && start > deadline) throw new Error('The deadline cannot be before the start date.');
				}
				for (const item of change.changes) {
					if (Object.prototype.hasOwnProperty.call(next, item.key)) current[item.key] = next[item.key];
					else delete current[item.key];
				}
			});
		} else {
			await this.app.vault.process(file, current => {
				const parts = current.split(/(\r?\n)/);
				for (const item of change.changes) {
					const expected = undo ? item.after : item.before;
					let index = item.index;
					if (parts[index] !== expected) {
						const matches = parts.flatMap((part, position) => position % 2 === 0 && part === expected ? [position] : []);
						if (matches.length !== 1) throw new Error(`${file.basename}: the source line changed or is ambiguous.`);
						index = matches[0] ?? index;
					}
					parts[index] = undo ? item.before : item.after;
				}
				return parts.join('');
			});
		}
	}
}
