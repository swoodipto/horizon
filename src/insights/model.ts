import type { TFile } from 'obsidian';
import { DATE_PROPERTIES } from '../planning/dates';
import { evaluateGoalProgress } from '../ui/goal-progress';
import type { ProjectStatusTag } from '../ui/project-filter';
import type { TaggedEntry } from '../ui/tagged-notes';
import { entryIdentity, type GoalSnapshot, type WorkState } from './types';

export function workState(progress: number): WorkState {
	return progress >= 100 ? 'completed' : progress > 0 ? 'started' : 'unstarted';
}

export function goalSnapshots(
	goals: readonly TaggedEntry<TFile>[], projects: readonly TaggedEntry<TFile>[],
	status: (entry: TaggedEntry<TFile>) => ProjectStatusTag,
	properties: (file: TFile) => Record<string, unknown> | undefined,
): GoalSnapshot[] {
	const evaluated = evaluateGoalProgress(goals, projects, status, entry => properties(entry.file)?.progress);
	return goals.map(entry => {
		const contributors = (evaluated.contributors.get(entry) ?? []).map(child => ({
			identity: entryIdentity(child.entry), state: workState(child.progress),
		}));
		const dates = properties(entry.file);
		return {
			entry, identity: entryIdentity(entry), progress: evaluated.progress.get(entry) ?? 0,
			contributors, scope: contributors.length,
			unstarted: contributors.filter(child => child.state === 'unstarted').length,
			started: contributors.filter(child => child.state === 'started').length,
			completed: contributors.filter(child => child.state === 'completed').length,
			start: dates?.[DATE_PROPERTIES.start], deadline: dates?.[DATE_PROPERTIES.deadline],
		};
	});
}
