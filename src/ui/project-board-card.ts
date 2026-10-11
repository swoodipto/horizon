import { setIcon } from 'obsidian';
import { entryDates } from './entry-dates';
import { formatDeadline } from './deadline';
import { PROJECT_STATUSES } from './project-status';
import type { BoardCard } from './project-board-model';

export function identifyProjectElement(element: HTMLElement, card: BoardCard): void {
	element.setAttribute('data-note-path', card.entry.file.path);
	if (card.entry.line !== undefined) element.setAttribute('data-note-line', String(card.entry.line));
	if (card.entry.sourceLine !== undefined) element.setAttribute('data-source-line', card.entry.sourceLine);
}

export function renderProjectCard(cell: HTMLElement, card: BoardCard, properties?: Record<string, unknown>, disambiguate = false): HTMLElement {
	const row = cell.createDiv({ cls: 'horizon-kanban-card horizon-note-item horizon-deadline-row horizon-project-row' });
	identifyProjectElement(row, card);
	row.setAttribute('data-board-lane', card.lane.id);
	const status = row.createEl('button', { cls: 'clickable-icon horizon-project-status',
		attr: { type: 'button', 'aria-label': 'Change project status', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'data-project-status': card.status } });
	identifyProjectElement(status, card); setIcon(status, PROJECT_STATUSES.find(item => item.tag === card.status)?.icon ?? 'circle-small');
	const link = row.createEl('a', { cls: 'horizon-note-link', attr: { href: card.entry.file.path, 'aria-label': card.entry.text } });
	identifyProjectElement(link, card);
	const text = link.createDiv({ cls: 'horizon-note-text' });
	text.createSpan({ cls: 'horizon-note-title', text: card.entry.text });
	if (disambiguate) text.createSpan({ cls: 'horizon-note-path', text: `${card.entry.file.path}${card.entry.line !== undefined ? `:${card.entry.line + 1}` : ''}` });
	const relations = card.entry.line !== undefined ? [card.entry.file.basename]
		: [...(card.entry.parents ?? []).map(parent => `Parent: ${parent.name}`), ...(card.entry.dependents ?? []).map(parent => `Depends on: ${parent.name}`)];
	if (relations.length) text.createSpan({ cls: 'horizon-note-subtitle', text: relations.join(' · ') });
	const dates = entryDates(card.entry, properties);
	const pills = row.createDiv({ cls: 'horizon-kanban-dates' });
	for (const property of ['start', 'deadline'] as const) {
		const formatted = formatDeadline(dates[property]); if (!formatted) continue;
		const button = pills.createEl('button', { cls: 'horizon-kanban-date', attr: { type: 'button',
			'aria-label': `Change ${property === 'start' ? 'start date' : 'deadline'}: ${formatted}`, 'data-date-property': property, 'aria-haspopup': 'dialog' } });
		identifyProjectElement(button, card);
		const icon = button.createSpan({ attr: { 'aria-hidden': 'true' } }); setIcon(icon, property === 'start' ? 'calendar' : 'flag-triangle-right');
		button.createSpan({ text: formatted });
	}
	if (dates.issue) pills.createSpan({ cls: 'horizon-kanban-date-issue', text: 'Check dates', attr: { 'aria-label': dates.issue, title: dates.issue } });
	const handle = row.createEl('button', { cls: 'clickable-icon horizon-kanban-handle', attr: { type: 'button',
		'aria-label': `Drag ${card.entry.text}`, 'data-drag-handle': 'true' } });
	setIcon(handle, 'grip-vertical');
	return row;
}
