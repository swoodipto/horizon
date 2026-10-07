import { Notice, Plugin } from 'obsidian';
import { HorizonSidebarView, HORIZON_VIEW_TYPE } from './ui/sidebar';
import { SidebarManager } from './ui/sidebar-manager';
import { HorizonNotesView, HORIZON_NOTES_VIEW_TYPE } from './ui/notes-view';
import { SidebarOption } from './ui/sidebar-options';
import { openNotesInCenter } from './ui/open-notes';
import { openNoteInCurrentTab } from './ui/open-note';
import { DEFAULT_SETTINGS, HorizonSettings } from './settings';
import { HorizonSettingsTab } from './ui/settings-tab';
import { registerIcons } from './ui/icons';
import { isPlanningOption } from './planning/option';
import { registerPlanning } from './planning/register';
import { HORIZON_PLANNING_VIEW_TYPE } from './planning/view';
import { GoalProgressSync } from './ui/goal-progress-sync';
import { PluginDataStore } from './plugin-data';
import { InsightsService } from './insights/service';
import { registerInsights } from './insights/register';
import { HorizonInsightsView, HORIZON_INSIGHTS_VIEW_TYPE } from './insights/view';

export default class HorizonPlugin extends Plugin {
	settings: HorizonSettings = { ...DEFAULT_SETTINGS };
	private sidebar!: SidebarManager;
	private notesOperation = Promise.resolve();
	private dataStore!: PluginDataStore;

	async onload(): Promise<void> {
		registerIcons(this);
		this.dataStore = new PluginDataStore(await this.loadData(), data => this.saveData(data));
		this.settings = this.dataStore.settings;
		const insights = new InsightsService(this.dataStore);
		const progress = new GoalProgressSync(this.app, goals => insights.accept(goals));
		insights.start(this, () => progress.refresh());
		this.sidebar = new SidebarManager(
			this.app.workspace,
			HORIZON_VIEW_TYPE,
			(leaf) => new HorizonSidebarView(leaf, (option, highlight) => this.openNotes(option, highlight),
				(path, line) => this.openProject(path, line)),
			(view) => view instanceof HorizonSidebarView,
		);
		this.register(() => this.sidebar.dispose());

		this.registerView(
			HORIZON_VIEW_TYPE,
			(leaf) => new HorizonSidebarView(leaf, (option, highlight) => this.openNotes(option, highlight),
				(path, line) => this.openProject(path, line)),
		);
		this.registerView(HORIZON_NOTES_VIEW_TYPE, (leaf) => new HorizonNotesView(
			leaf, () => this.settings, option => this.selectOption(option),
		));
		registerPlanning(this, option => this.selectOption(option));
		registerInsights(this, insights, () => this.settings, option => this.selectOption(option));
		progress.start(this);
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
		for (const leaf of this.app.workspace.getLeavesOfType(HORIZON_INSIGHTS_VIEW_TYPE)) {
			if (leaf.view instanceof HorizonInsightsView) leaf.view.applySettings();
		}
		await this.dataStore.save(this.settings);
	}

	private selectOption(option: SidebarOption): void {
		const sidebar = this.app.workspace.getLeavesOfType(HORIZON_VIEW_TYPE)
			.map(leaf => leaf.view).find(view => view instanceof HorizonSidebarView);
		if (sidebar) sidebar.selectOption(option);
		else if (option.tag || isPlanningOption(option) || option.id === 'insights') void this.openNotes(option);
		else new Notice(`${option.label}: test action.`);
	}

	private openNotes(option: SidebarOption, highlight?: { path: string; line?: number }): Promise<void> {
		this.notesOperation = this.notesOperation.then(async () => {
			const leaf = await openNotesInCenter(this.app.workspace,
				isPlanningOption(option) ? HORIZON_PLANNING_VIEW_TYPE
					: option.id === 'insights' ? HORIZON_INSIGHTS_VIEW_TYPE : HORIZON_NOTES_VIEW_TYPE, option.id);
			if (highlight && leaf.view instanceof HorizonNotesView) leaf.view.highlightEntry(highlight.path, highlight.line);
		}).catch((error: unknown) => {
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
