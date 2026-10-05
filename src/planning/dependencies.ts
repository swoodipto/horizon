import { parseDate, projectRange } from './dates';
import type { PlanningProject, PlanningWarning } from './types';

/** Dependencies never change dates; every conflict stays available for review. */
export function planningWarnings(projects: readonly PlanningProject[]): PlanningWarning[] {
	const warnings: PlanningWarning[] = [];
	const byPath = new Map(projects.filter(project => !project.inline).map(project => [project.path, project]));
	const graph = new Map<string, string[]>();
	const warn = (project: PlanningProject, kind: PlanningWarning['kind'], message: string) => {
		warnings.push({ projectId: project.id, kind, message });
	};
	for (const project of projects) {
		for (const field of project.invalidDates ?? []) warn(project, 'dates', `Invalid ${field}. Use YYYY-MM-DD.`);
		for (const field of ['start', 'deadline'] as const) {
			if (project[field] && !parseDate(project[field]) && !project.invalidDates?.includes(field)) {
				warn(project, 'dates', `Invalid ${field}. Use YYYY-MM-DD.`);
			}
		}
		const range = projectRange(project);
		if (range && range.end < range.start) warn(project, 'dates', 'Deadline is before the start date.');
		const edges: string[] = [];
		for (const dependency of project.dependencies) {
			const target = dependency.path ? byPath.get(dependency.path) : undefined;
			if (!target) {
				warn(project, 'dependency', `Dependency “${dependency.title}” is missing or is not a project note.`);
				continue;
			}
			edges.push(target.id);
			if (target.status === 'completed') continue;
			const preceding = projectRange(target);
			if (!preceding) warn(project, 'dependency', `Plan “${target.title}” before checking this dependency.`);
			else if (!range) warn(project, 'dependency', `Plan this project after “${target.title}” finishes.`);
			else if (range.start <= preceding.end) {
				warn(project, 'dependency', `Start after “${target.title}” finishes on ${preceding.end}.`);
			}
		}
		graph.set(project.id, edges);
	}
	// Strongly connected components catch branching cycles as well as simple loops.
	const indices = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: string[] = [];
	const active = new Set<string>();
	const cyclic = new Set<string>();
	function visit(id: string): void {
		indices.set(id, indices.size);
		low.set(id, indices.get(id)!);
		stack.push(id);
		active.add(id);
		for (const edge of graph.get(id) ?? []) {
			if (!indices.has(edge)) { visit(edge); low.set(id, Math.min(low.get(id)!, low.get(edge)!)); }
			else if (active.has(edge)) low.set(id, Math.min(low.get(id)!, indices.get(edge)!));
		}
		if (indices.get(id) !== low.get(id)) return;
		const members: string[] = [];
		let member: string;
		do { member = stack.pop()!; active.delete(member); members.push(member); } while (member !== id);
		if (members.length > 1 || graph.get(id)?.includes(id)) for (const entry of members) cyclic.add(entry);
	}
	for (const project of projects) if (!indices.has(project.id)) visit(project.id);
	for (const project of projects) if (cyclic.has(project.id)) {
		warn(project, 'cycle', 'This project belongs to a dependency cycle.');
	}
	return warnings;
}
