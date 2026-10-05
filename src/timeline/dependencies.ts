import { projectRange } from '../planning/dates';
import type { PlanningRenderContext } from '../planning/types';
import { barGeometry, dateToPixel, TIMELINE_ROW_HEIGHT, type TimelineLayout } from './scale';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A depends on B: draw the arrow from B's deadline to A's start. */
export function renderDependencies(svg: SVGSVGElement, context: PlanningRenderContext, layout: TimelineLayout): void {
	svg.replaceChildren();
	svg.setAttribute('width', String(layout.width));
	svg.setAttribute('height', String(context.projects.length * TIMELINE_ROW_HEIGHT));
	const rows = new Map(context.projects.map((project, index) => ({ project, index }))
		.filter(row => !row.project.inline).map(row => [row.project.path, row]));
	for (const [index, project] of context.projects.entries()) {
		const targetRange = projectRange(project);
		if (!targetRange || targetRange.end < targetRange.start || !barGeometry(targetRange, layout)) continue;
		for (const dependency of project.dependencies) {
			const source = dependency.path ? rows.get(dependency.path) : undefined;
			if (!source || source.index === index) continue;
			const range = projectRange(source.project);
			if (!range || range.end < range.start || !barGeometry(range, layout)) continue;
			const x1 = Math.max(0, Math.min(layout.width, dateToPixel(range.end, layout) + layout.pixelsPerDay));
			const x2 = Math.max(0, Math.min(layout.width, dateToPixel(targetRange.start, layout)));
			const y1 = source.index * TIMELINE_ROW_HEIGHT + TIMELINE_ROW_HEIGHT / 2;
			const y2 = index * TIMELINE_ROW_HEIGHT + TIMELINE_ROW_HEIGHT / 2;
			const bend = Math.min(layout.width - 4, Math.max(x1 + 12, x2 - 12));
			const path = svg.ownerDocument.createElementNS(SVG_NS, 'path');
			path.setAttribute('d', `M ${x1} ${y1} H ${bend} V ${y2} H ${x2}`);
			path.classList.add('horizon-timeline-dependency');
			if (source.project.status !== 'completed' && range.end >= targetRange.start) path.classList.add('is-conflict');
			const title = svg.ownerDocument.createElementNS(SVG_NS, 'title');
			title.textContent = `${project.title} depends on ${source.project.title}`;
			path.appendChild(title);
			svg.appendChild(path);
			const arrow = svg.ownerDocument.createElementNS(SVG_NS, 'path');
			const direction = x2 >= bend ? 1 : -1;
			arrow.setAttribute('d', `M ${x2 - direction * 5} ${y2 - 4} L ${x2} ${y2} L ${x2 - direction * 5} ${y2 + 4}`);
			arrow.classList.add('horizon-timeline-dependency');
			if (source.project.status !== 'completed' && range.end >= targetRange.start) arrow.classList.add('is-conflict');
			svg.appendChild(arrow);
		}
	}
}
