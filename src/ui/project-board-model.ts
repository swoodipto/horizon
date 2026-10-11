import type { TFile } from 'obsidian';
import type { TaggedEntry } from './tagged-notes';
import { PROJECT_STATUSES } from './project-status';
export type BoardStatus = typeof PROJECT_STATUSES[number]['tag'];
export type ProjectEntry = TaggedEntry<TFile>;
export interface BoardLane { id: string; name: string; path?: string }
export interface BoardCard { entry: ProjectEntry; status: BoardStatus; lane: BoardLane }
export interface BoardPreferences { mode: 'list' | 'kanban'; swimlanes: boolean; hideEmpty: boolean }
export const NO_PARENT = 'no-parent';
export const FLAT_LANE = 'flat';
export const boardEntryKey = (entry: ProjectEntry): string => JSON.stringify([entry.file.path, entry.line ?? null]);

export function boardPreferences(value: unknown, previous: BoardPreferences = { mode: 'list', swimlanes: false, hideEmpty: false }): BoardPreferences {
	const state = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	return { mode: state.mode === 'list' || state.mode === 'kanban' ? state.mode : previous.mode,
		swimlanes: typeof state.swimlanes === 'boolean' ? state.swimlanes : previous.swimlanes,
		hideEmpty: typeof state.hideEmpty === 'boolean' ? state.hideEmpty : previous.hideEmpty };
}

export function projectBoard(entries: ProjectEntry[], status: (entry: ProjectEntry) => BoardStatus,
	preferences: BoardPreferences, retained: Map<string, BoardLane>) {
	const cards: BoardCard[] = [];
	for (const entry of [...entries].sort((a, b) => a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: 'base' }) || a.file.path.localeCompare(b.file.path) || (a.line ?? -1) - (b.line ?? -1))) {
		const parents: BoardLane[] = !preferences.swimlanes ? [{ id: FLAT_LANE, name: 'Projects' }]
			: entry.line !== undefined ? [{ id: entry.file.path, name: entry.file.basename, path: entry.file.path }]
			: entry.parents?.length ? entry.parents.map(parent => ({ id: parent.path ?? `unresolved:${parent.name}`,
				name: parent.name, path: parent.path })) : [{ id: NO_PARENT, name: 'No parent' }];
		for (const lane of new Map(parents.map(parent => [parent.id, parent])).values()) {
			if (preferences.swimlanes) retained.set(lane.id, lane);
			cards.push({ entry, status: status(entry), lane });
		}
	}
	if (preferences.swimlanes) retained.set(NO_PARENT, { id: NO_PARENT, name: 'No parent' });
	const lanes = preferences.swimlanes ? [...retained.values()].sort((a, b) => a.id === NO_PARENT ? -1 : b.id === NO_PARENT ? 1
		: a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id))
		: [{ id: FLAT_LANE, name: 'Projects' }];
	const statuses = PROJECT_STATUSES.filter(item => !preferences.hideEmpty || cards.some(card => card.status === item.tag));
	return { lanes, statuses, cards };
}
