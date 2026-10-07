import type { NoteActionHistory } from './note-action-history';
import { App, Component, Modal } from 'obsidian';
import { DATE_PROPERTIES, parseDate } from '../planning/dates';
import { applyToItems } from './bulk-note-actions';
import { setNoteDate } from './deadline';

export class NoteDateEditor extends Modal {
	private bindings = new Component();
	private saving = false;

	constructor(app: App, private refresh: () => Promise<void>, private property: 'start' | 'deadline' = 'deadline', private paths: string[], private history: NoteActionHistory) { super(app); }

	onOpen(): void {
		this.bindings.load();
		const title = this.property === 'start' ? 'Start date' : 'Deadline';
		this.setTitle(this.property === 'start' ? 'Set start date' : 'Set deadline');
		const properties = this.paths.map(path => {
			const note = this.app.vault.getFileByPath(path);
			return note ? this.app.metadataCache.getFileCache(note)?.frontmatter : undefined;
		});
		const form = this.contentEl.createEl('form');
		const label = form.createEl('label', { cls: 'horizon-planning-field' });
		label.createSpan({ text: title });
		const date = label.createEl('input', { type: 'date' });
		const values = properties.map(value => parseDate(value?.[DATE_PROPERTIES[this.property]]) ?? '');
		date.value = values.every(value => value === values[0]) ? values[0] ?? '' : '';
		if (this.property === 'deadline') date.min = properties.map(value => parseDate(value?.[DATE_PROPERTIES.start]) ?? '').sort().at(-1) ?? '';
		else date.max = properties.map(value => parseDate(value?.deadline)).filter((value): value is string => !!value).sort()[0] ?? '';
		form.createEl('p', { cls: 'horizon-planning-hint', text: `Saved to ${this.paths.length > 1 ? 'all selected notes’' : 'this note’s'} ${DATE_PROPERTIES[this.property]} property. Clear the date to remove it.` });
		const error = form.createEl('p', { cls: 'horizon-planning-error', attr: { role: 'alert' } });
		const actions = form.createDiv({ cls: 'horizon-planning-editor-actions' });
		const clear = actions.createEl('button', { text: 'Clear date', attr: { type: 'button' } });
		actions.createEl('button', { text: `Save ${this.property === 'start' ? 'start date' : 'deadline'}`, cls: 'mod-cta', attr: { type: 'submit' } });
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
			void this.history.record(app => applyToItems(this.paths, path => setNoteDate(app, path, this.property, date.value))).then(async () => {
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
