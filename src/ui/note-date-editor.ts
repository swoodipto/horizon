import type { NoteActionHistory } from './note-action-history';
import { App, Component, Modal } from 'obsidian';
import { parseDate } from '../planning/dates';
import { applyToItems } from './bulk-note-actions';
import { entryDates, setEntryDate } from './entry-dates';
import type { ProjectStatusTarget } from './project-status';
import { suppressHorizonTooltips } from './tooltips';

export class NoteDateEditor extends Modal {
	private bindings = new Component();
	private saving = false;

	constructor(app: App, private refresh: () => Promise<void>, private property: 'start' | 'deadline' | 'completed' = 'deadline', private targets: ProjectStatusTarget[], private history: NoteActionHistory) { super(app); }

	onOpen(): void {
		this.bindings.load();
		this.bindings.register(suppressHorizonTooltips(this.modalEl));
		const title = this.property === 'start' ? 'Start date' : this.property === 'completed' ? 'Completed date' : 'Deadline';
		this.setTitle(`Set ${title.toLowerCase()}`);
		const dates = this.targets.map(target => {
			const note = this.app.vault.getFileByPath(target.path);
			return entryDates(target, note ? this.app.metadataCache.getFileCache(note)?.frontmatter : undefined);
		});
		const form = this.contentEl.createEl('form');
		const label = form.createEl('label', { cls: 'horizon-planning-field' });
		label.createSpan({ text: title });
		const date = label.createEl('input', { type: 'date' });
		const values = dates.map(value => value[this.property] ?? '');
		date.value = values.every(value => value === values[0]) ? values[0] ?? '' : '';
		if (this.property === 'deadline') date.min = dates.map(value => value.start ?? '').sort().at(-1) ?? '';
		else if (this.property === 'start') date.max = dates.map(value => value.deadline).filter((value): value is string => !!value).sort()[0] ?? '';
		form.createEl('p', { cls: 'horizon-planning-hint', text: 'Clear the date to remove it.' });
		const error = form.createEl('p', { cls: 'horizon-planning-error', attr: { role: 'alert' } });
		const actions = form.createDiv({ cls: 'horizon-planning-editor-actions' });
		const clear = actions.createEl('button', { text: 'Clear date', attr: { type: 'button' } });
		actions.createEl('button', { text: `Save ${title.toLowerCase()}`, cls: 'mod-cta', attr: { type: 'submit' } });
		this.bindings.registerDomEvent(clear, 'click', () => { date.value = ''; date.focus(); });
		this.bindings.registerDomEvent(form, 'submit', event => {
			event.preventDefault();
			if (this.saving) return;
			if (date.validity.badInput || (date.value && !parseDate(date.value))) {
				error.setText('Enter a valid calendar date.'); return;
			}
			this.saving = true;
			const controls = Array.from(form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button'));
			for (const control of controls) control.disabled = true;
			void this.history.record(app => applyToItems(this.targets, target => setEntryDate(app, target, this.property, date.value))).then(async () => {
				this.close();
				await this.refresh();
			}).catch((cause: unknown) => {
				void this.refresh();
				this.saving = false;
				for (const control of controls) control.disabled = false;
				error.setText(cause instanceof Error ? cause.message : 'Could not save the date.');
			});
		});
		date.focus();
	}

	onClose(): void {
		this.bindings.unload();
		this.contentEl.empty();
	}
}
