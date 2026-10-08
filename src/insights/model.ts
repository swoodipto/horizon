import type { ListItemCache, TFile } from 'obsidian';
import { DATE_PROPERTIES } from '../planning/dates';
import { evaluateGoalProgress, projectProgress } from '../ui/goal-progress';
import type { ProjectStatusTag } from '../ui/project-filter';
import type { TaggedEntry } from '../ui/tagged-notes';
import { projectTaskProgress } from '../ui/project-task-progress';
import { entryIdentity, type GoalSnapshot, type PaceSnapshot, type WorkState } from './types';

export function workState(progress: number): WorkState {
	return progress >= 100 ? 'completed' : progress > 0 ? 'started' : 'unstarted';
}

/** Whole-note project cards are independent of parent or dependency relationships. */
export function projectPaceSnapshots(
	goals: readonly GoalSnapshot[], projects: readonly TaggedEntry<TFile>[],
	status: (entry: TaggedEntry<TFile>) => ProjectStatusTag,
	properties: (file: TFile) => Record<string, unknown> | undefined,
	tasks: (file: TFile) => readonly ListItemCache[] | undefined,
): PaceSnapshot[] {
	const goalPaths = new Set(goals.filter(goal => goal.entry.line === undefined).map(goal => goal.identity.path));
	return projects.filter(entry => entry.line === undefined && !goalPaths.has(entry.file.path)).map(entry => {
		const values = properties(entry.file);
		return {
			kind: 'project', entry, identity: entryIdentity(entry), progress: projectProgress(status(entry), projectTaskProgress(entry, tasks(entry.file))),
			start: values?.[DATE_PROPERTIES.start], deadline: values?.[DATE_PROPERTIES.deadline],
		};
	});
}

export function goalSnapshots(
	goals: readonly TaggedEntry<TFile>[], projects: readonly TaggedEntry<TFile>[],
	status: (entry: TaggedEntry<TFile>) => ProjectStatusTag,
	properties: (file: TFile) => Record<string, unknown> | undefined,
	tasks: (file: TFile) => readonly ListItemCache[] | undefined,
): GoalSnapshot[] {
	const evaluated = evaluateGoalProgress(goals, projects, status, entry => projectTaskProgress(entry, tasks(entry.file)));
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
