import type { TaggedEntry } from './tagged-notes';
import type { ProjectStatusTag } from './project-filter';
import { nestTaggedEntries, type EntryNode } from './entry-tree';
import { groupEntriesByParent, type ParentEntryGroup } from './parent-entry-groups';
import type { ParentNote } from './parent-notes';

/** Sidebar projects have entered preparation or active work. */
export function sidebarProjects<T>(
	entries: readonly TaggedEntry<T>[], statusFor: (entry: TaggedEntry<T>) => ProjectStatusTag,
): TaggedEntry<T>[] {
	return entries.filter(entry => {
		const status = statusFor(entry);
		return status === 'discuss' || status === 'ready' || status === 'doing';
	});
}

/** Only goals with measured, unfinished progress appear below Goals. */
export function sidebarGoals<T>(
	entries: readonly TaggedEntry<T>[], progress: ReadonlyMap<TaggedEntry<T>, number>,
): TaggedEntry<T>[] {
	return entries.filter(entry => {
		const value = Math.round(progress.get(entry) ?? 0);
		return value > 0 && value < 100;
	});
}

/** Nest visible goal parents once; retain a heading when the parent is outside the partial list. */
export function sidebarGoalGroups<T extends { path: string; basename: string }>(
	allGoals: readonly TaggedEntry<T>[], partialGoals: readonly TaggedEntry<T>[],
): ParentEntryGroup<EntryNode<T>>[] {
	const goalPaths = new Set(allGoals.filter(entry => entry.line === undefined).map(entry => entry.file.path));
	const visiblePaths = new Set(partialGoals.filter(entry => entry.line === undefined).map(entry => entry.file.path));
	const roots = nestTaggedEntries(partialGoals, { includeDependents: false });
	return groupEntriesByParent(roots, node => {
		const entry = node.entry;
		const firstParent = entry.line === undefined
			? entry.parents?.[0]
			: goalPaths.has(entry.file.path)
				? { name: entry.file.basename, path: entry.file.path, icon: 'horizon-goal' } satisfies ParentNote
				: undefined;
		return firstParent && (!firstParent.path || !visiblePaths.has(firstParent.path)) ? [firstParent] : [];
	});
}

/** Count every active descendant hidden below the first displayed sub-goal level. */
export function activeSubgoalCount<T>(node: EntryNode<T>): number {
	let count = 0;
	const pending = [...node.children];
	while (pending.length) {
		const child = pending.pop();
		if (!child) continue;
		count++;
		pending.push(...child.children);
	}
	return count;
}
