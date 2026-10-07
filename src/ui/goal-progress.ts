import { nestTaggedEntries, type EntryNode } from './entry-tree';
import type { TaggedEntry } from './tagged-notes';
import type { ProjectStatusTag } from './project-filter';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function projectProgress(status: ProjectStatusTag, saved: unknown, inline = false): number {
	if (status === 'completed') return 100;
	// Inline projects have no independent frontmatter; retain their existing behavior for now.
	if (inline) return status === 'doing' ? 50 : status === 'discuss' || status === 'ready' ? 25 : 0;
	return typeof saved === 'number' && Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : 0;
}

/** Each direct sub-goal or project has one equal share of its parent goal. */
export function goalProgress<T extends { path: string }>(
	goals: readonly TaggedEntry<T>[], projects: readonly TaggedEntry<T>[],
	statusForProject: (entry: TaggedEntry<T>) => ProjectStatusTag,
	progressForProject: (entry: TaggedEntry<T>) => unknown,
): Map<TaggedEntry<T>, number> {
	return evaluateGoalProgress(goals, projects, statusForProject, progressForProject).progress;
}

/** One evaluation supplies both canonical percentages and direct graph contributors. */
export function evaluateGoalProgress<T extends { path: string }>(
	goals: readonly TaggedEntry<T>[], projects: readonly TaggedEntry<T>[],
	statusForProject: (entry: TaggedEntry<T>) => ProjectStatusTag,
	progressForProject: (entry: TaggedEntry<T>) => unknown,
): { progress: Map<TaggedEntry<T>, number>; contributors: Map<TaggedEntry<T>, { entry: TaggedEntry<T>; progress: number }[]> } {
	const roots = nestTaggedEntries(goals);
	const ordered: EntryNode<T>[] = [];
	const pending = [...roots].reverse();
	const noteGoals = new Map<string, EntryNode<T>>();
	while (pending.length) {
		const node = pending.pop();
		if (!node) break;
		ordered.push(node);
		if (node.entry.line === undefined) noteGoals.set(node.entry.file.path, node);
		pending.push(...[...node.children].reverse());
	}

	const goalIdentities = new Set(goals.map(entry => `${entry.file.path}\0${entry.line ?? -1}`));
	const directProjects = new Map<EntryNode<T>, { entry: TaggedEntry<T>; progress: number }[]>();
	for (const project of projects) {
		// A note or line tagged as both a goal and a project is one outcome, not its own child.
		if (goalIdentities.has(`${project.file.path}\0${project.line ?? -1}`)) continue;
		const parentPaths = project.line === undefined
			? (project.parents ?? []).map(parent => parent.path)
			: [project.file.path];
		for (const path of parentPaths) {
			const parent = path ? noteGoals.get(path) : undefined;
			if (!parent) continue;
			const values = directProjects.get(parent) ?? [];
			values.push({ entry: project, progress: projectProgress(
				statusForProject(project), progressForProject(project), project.line !== undefined,
			) });
			directProjects.set(parent, values);
			break;
		}
	}

	const progress = new Map<TaggedEntry<T>, number>();
	const contributors = new Map<TaggedEntry<T>, { entry: TaggedEntry<T>; progress: number }[]>();
	for (const node of ordered.reverse()) {
		const values = [...directProjects.get(node) ?? []];
		for (const child of node.children) {
			if (child.relationship === 'parent') values.push({ entry: child.entry, progress: progress.get(child.entry) ?? 0 });
		}
		contributors.set(node.entry, values);
		progress.set(node.entry, values.length
			? values.reduce((total, value) => total + value.progress, 0) / values.length : 0);
	}
	return { progress, contributors };
}

/** Draw one outer ring and fill a center wedge clockwise. */
export function renderGoalProgressIcon(container: HTMLElement, progress: number): void {
	const svg = container.ownerDocument.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('class', 'svg-icon');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	const outer = container.ownerDocument.createElementNS(SVG_NS, 'circle');
	outer.setAttribute('cx', '12');
	outer.setAttribute('cy', '12');
	outer.setAttribute('r', '10');
	svg.appendChild(outer);
	const amount = Math.max(0, Math.min(100, progress));
	if (amount >= 100) {
		const fill = container.ownerDocument.createElementNS(SVG_NS, 'circle');
		fill.setAttribute('cx', '12');
		fill.setAttribute('cy', '12');
		fill.setAttribute('r', '6');
		fill.setAttribute('fill', 'currentColor');
		svg.appendChild(fill);
	} else if (amount > 0) {
		const angle = Math.PI * 2 * amount / 100;
		const x = (12 + 6 * Math.sin(angle)).toFixed(3);
		const y = (12 - 6 * Math.cos(angle)).toFixed(3);
		const wedge = container.ownerDocument.createElementNS(SVG_NS, 'path');
		wedge.setAttribute('d', `M 12 12 L 12 6 A 6 6 0 ${amount > 50 ? 1 : 0} 1 ${x} ${y} Z`);
		wedge.setAttribute('fill', 'currentColor');
		wedge.setAttribute('stroke', 'none');
		svg.appendChild(wedge);
	}
	container.appendChild(svg);
}
