import type { NoteActionHistory } from './note-action-history';
import { App, FuzzySuggestModal, Notice, TFile } from 'obsidian';
import { applyToItems } from './bulk-note-actions';
import { addNoteRelation, type RelationProperty } from './note-relations';
import { suppressHorizonTooltips } from './tooltips';

/** Native keyboard-searchable note selection, preserving other relations. */
export class RelationPicker extends FuzzySuggestModal<TFile> {
	private stopTooltips: (() => void) | undefined;
	constructor(app: App, private property: RelationProperty,
		private refresh: () => Promise<void>, private paths: string[], private history: NoteActionHistory) {
		super(app);
		this.setPlaceholder(`Select ${property}`);
	}

	getItems(): TFile[] { return this.app.vault.getMarkdownFiles().filter(file => !this.paths.includes(file.path)); }
	onOpen(): Promise<void> | void {
		const opened = super.onOpen();
		this.stopTooltips = suppressHorizonTooltips(this.modalEl);
		return opened;
	}
	onClose(): void {
		this.stopTooltips?.(); this.stopTooltips = undefined;
		super.onClose();
	}
	getItemText(file: TFile): string { return file.path.replace(/\.md$/i, ''); }
	onChooseItem(file: TFile): void {
		void this.history.record(app => applyToItems(this.paths, path => addNoteRelation(app, path, this.property, file.path))).then(this.refresh).catch((error: unknown) => {
			void this.refresh();
			new Notice(error instanceof Error ? error.message : `Could not set ${this.property}.`);
		});
	}
}
