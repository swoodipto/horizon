import { setIcon } from 'obsidian';
import { deadlineDaysLeft, formatDeadline } from './deadline';
import { parseDate, today } from '../planning/dates';
import { noteActionShortcut } from './note-action-shortcuts';

export function renderDeadlineControl(row: HTMLElement, path: string, value: unknown, line?: number): void {
	const formatted = formatDeadline(value);
	if (!formatted) return;
	const remaining = deadlineDaysLeft(value);
	const date = parseDate(value);
	const isDue = date !== undefined && date <= today();
	const button = row.createEl('button', {
		cls: `horizon-note-deadline${isDue ? ' is-due' : ''}`,
		attr: { type: 'button', 'data-note-path': path,
			'aria-label': `Change deadline: ${formatted}${line === undefined ? '' : ' for source note'}`,
			'aria-haspopup': 'dialog', 'aria-keyshortcuts': noteActionShortcut('deadline') },
	});
	if (line !== undefined) button.setAttribute('data-note-line', String(line));
	const label = button.createSpan({ cls: 'horizon-deadline-label' });
	const icon = label.createSpan({ attr: { 'aria-hidden': 'true' } });
	setIcon(icon, 'flag-triangle-right');
	if (remaining) label.createSpan({ text: remaining });
}
