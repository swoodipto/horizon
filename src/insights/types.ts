import type { TFile } from 'obsidian';
import type { TaggedEntry } from '../ui/tagged-notes';

export interface EntryIdentity { path: string; line?: number; sourceLine?: string }
export type WorkState = 'unstarted' | 'started' | 'completed';
export interface Contributor { identity: EntryIdentity; state: WorkState }
export interface GoalSnapshot {
	entry: TaggedEntry<TFile>;
	identity: EntryIdentity;
	progress: number;
	scope: number;
	unstarted: number;
	started: number;
	completed: number;
	start?: unknown;
	deadline?: unknown;
	contributors: Contributor[];
}

export function entryIdentity(entry: TaggedEntry<{ path: string }>): EntryIdentity {
	return { path: entry.file.path, line: entry.line, sourceLine: entry.sourceLine };
}

export function progressLabel(progress: number): string {
	return progress > 0 && progress < 1 ? '<1%' : `${Math.round(progress)}%`;
}
