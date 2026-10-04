import { Notice, Plugin } from 'obsidian';
import { HorizonSidebarView, HORIZON_VIEW_TYPE } from './ui/sidebar';
import { SidebarManager } from './ui/sidebar-manager';
import { HorizonNotesView, HORIZON_NOTES_VIEW_TYPE } from './ui/notes-view';
import { SidebarOption } from './ui/sidebar-options';
import { openNotesInCenter } from './ui/open-notes';
import { openNoteInCurrentTab } from './ui/open-note';
import { DEFAULT_SETTINGS, HorizonSettings, normalizeSettings } from './settings';
import { HorizonSettingsTab } from './ui/settings-tab';
import { registerIcons } from './ui/icons';

export default class HorizonPlugin extends Plugin {
	settings: HorizonSettings = { ...DEFAULT_SETTINGS };
	private sidebar!: SidebarManager;
	private notesOperation = Promise.resolve();

	async onload(): Promise<void> {
		registerIcons(this);
		this.settings = normalizeSettings(await this.loadData());
		this.sidebar = new SidebarManager(
			this.app.workspace,
			HORIZON_VIEW_TYPE,
			(leaf) => new HorizonSidebarView(leaf, (option) => this.openNotes(option),
				(path, line) => this.openProject(path, line)),
			(view) => view instanceof HorizonSidebarView,
		);
		this.register(() => this.sidebar.dispose());

		this.registerView(
			HORIZON_VIEW_TYPE,
			(leaf) => new HorizonSidebarView(leaf, (option) => this.openNotes(option),
				(path, line) => this.openProject(path, line)),
		);
		this.registerView(HORIZON_NOTES_VIEW_TYPE, (leaf) => new HorizonNotesView(leaf, () => this.settings));
		this.addSettingTab(new HorizonSettingsTab(this.app, this));

		this.addCommand({
			id: 'open-sidebar',
			name: 'Open sidebar',
			callback: () => this.openSidebar(true),
		});

		// Add a native tab beside Files, Search, and Bookmarks without selecting it.
		this.app.workspace.onLayoutReady(() => {
			this.sidebar.start();
			void this.openSidebar(false);
		});
	}

	private async openSidebar(reveal: boolean): Promise<void> {
		try {
			await this.sidebar.open(reveal);
		} catch (error) {
			console.error('horizon: could not open the sidebar', error);
			new Notice('Could not open the horizon sidebar.');
		}
	}

	async saveSettings(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(HORIZON_NOTES_VIEW_TYPE)) {
			if (leaf.view instanceof HorizonNotesView) leaf.view.applySettings();
		}
		await this.saveData(this.settings);
	}

	private openNotes(option: SidebarOption): Promise<void> {
		this.notesOperation = this.notesOperation.then(() =>
			openNotesInCenter(this.app.workspace, HORIZON_NOTES_VIEW_TYPE, option.id),
		).catch((error: unknown) => {
			console.error('horizon: could not open the note list', error);
			new Notice('Could not open the note list.');
		});
		return this.notesOperation;
	}

	private async openProject(path: string, line?: number): Promise<void> {
		const leaf = this.app.workspace.getLeavesOfType(HORIZON_NOTES_VIEW_TYPE)[0]
			?? this.app.workspace.getLeaf('tab');
		await openNoteInCurrentTab(this.app.vault, leaf, path, line);
		await this.app.workspace.revealLeaf(leaf);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}
}
