import { ItemView, Notice, type Events, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { HorizonSettings } from '../settings';
import { OptionKeyboardShortcuts } from '../ui/option-keyboard-shortcuts';
import { openNoteInCurrentTab } from '../ui/open-note';
import type { SidebarOption } from '../ui/sidebar-options';
import { GoalGraphCard } from './graph-card';
import type { InsightsService } from './service';
import type { GoalSnapshot } from './types';

export const HORIZON_INSIGHTS_VIEW_TYPE = 'horizon-insights';

export class HorizonInsightsView extends ItemView {
	navigation = false;
	private opened = false;
	private preview: HTMLElement | undefined;
	private grid: HTMLElement | undefined;
	private empty: HTMLElement | undefined;
	private count: HTMLElement | undefined;
	private cards = new Map<string, GoalGraphCard>();
	private expanded = new Set<string>();
	private unsubscribe: (() => void) | undefined;
	private shortcuts: OptionKeyboardShortcuts | undefined;

	constructor(leaf: WorkspaceLeaf, private service: InsightsService,
		private settings: () => HorizonSettings, private selectOption: (option: SidebarOption) => void) { super(leaf); }

	getViewType(): string { return HORIZON_INSIGHTS_VIEW_TYPE; }
	getDisplayText(): string { return 'Insights'; }
	getIcon(): string { return 'chart-spline'; }
	focus(): void { this.contentEl.focus({ preventScroll: true }); }
	getState(): Record<string, unknown> { return { optionId: 'insights', expandedValues: [...this.expanded] }; }
	setState(state: unknown, _result: ViewStateResult): Promise<void> {
		if (state && typeof state === 'object' && 'expandedValues' in state && Array.isArray(state.expandedValues)) {
			this.expanded = new Set(state.expandedValues.filter((key): key is string => typeof key === 'string'));
		}
		for (const [key, card] of this.cards) card.setExpanded(this.expanded.has(key));
		this.render(); return Promise.resolve();
	}

	applySettings(): void {
		const settings = this.settings();
		this.contentEl.toggleClass('horizon-custom-width', !settings.useThemeContentWidth);
		this.contentEl.setCssProps({ '--horizon-content-width': `${settings.customContentWidth}px` });
		const vault = this.app.vault as typeof this.app.vault & { getConfig?: (key: string) => unknown };
		this.preview?.toggleClass('is-readable-line-width', settings.useThemeContentWidth && vault.getConfig?.('readableLineLength') !== false);
	}

	onOpen(): Promise<void> {
		this.opened = true;
		this.contentEl.empty();
		this.contentEl.addClass('horizon-notes', 'horizon-insights');
		this.contentEl.tabIndex = -1;
		const reading = this.contentEl.createDiv({ cls: 'markdown-reading-view' });
		this.preview = reading.createDiv({ cls: 'markdown-preview-view markdown-rendered' });
		const results = this.preview.createDiv({ cls: 'markdown-preview-sizer' }).createDiv({ cls: 'horizon-note-results' });
		const heading = results.createDiv({ cls: 'inline-title horizon-results-heading' });
		heading.createEl('h3', { text: 'Insights', cls: 'horizon-inline-title' });
		this.count = heading.createSpan({ cls: 'horizon-note-count' });
		this.empty = results.createDiv({ cls: 'horizon-insights-empty', attr: { role: 'status' } });
		this.grid = results.createDiv({ cls: 'horizon-insights-grid' });
		this.applySettings();
		const title = this.contentEl.closest('.workspace-leaf-content')?.querySelector('.view-header-title');
		if (title) title.textContent = 'Insights';
		this.unsubscribe = this.service.subscribe(() => this.render());
		this.shortcuts = this.addChild(new OptionKeyboardShortcuts(this.contentEl, {
			isActive: () => this.app.workspace.getActiveViewOfType(HorizonInsightsView) === this,
			activate: option => this.selectOption(option),
		}));
		const events: Events = this.app.vault;
		this.registerEvent(events.on('config-changed', () => this.applySettings()));
		this.render(); return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.opened = false;
		this.unsubscribe?.(); this.unsubscribe = undefined;
		for (const card of this.cards.values()) this.removeChild(card);
		this.cards.clear();
		if (this.shortcuts) this.removeChild(this.shortcuts);
		this.shortcuts = undefined;
		this.contentEl.empty(); return Promise.resolve();
	}

	private render(): void {
		if (!this.opened || !this.grid || !this.empty) return;
		const goals = this.service.goals.filter(goal => goal.progress > 0);
		if (this.count) this.count.textContent = String(goals.length);
		this.empty.textContent = this.service.ready ? 'No goals with progress yet.' : 'Loading goal progress…';
		this.empty.hidden = goals.length > 0;
		const keys = new Set<string>();
		for (const [index, goal] of goals.entries()) {
			const history = this.service.history(goal);
			// Persistent observation identity keeps focus/disclosure state through safe renames and line moves.
			const key = history ? `goal:${history.id}` : JSON.stringify([goal.identity.path, goal.identity.line ?? -1]); keys.add(key);
			let card = this.cards.get(key);
			if (!card) {
				card = this.addChild(new GoalGraphCard(this.grid, goal, item => { void this.openGoal(item); }, expanded => {
					if (expanded) this.expanded.add(key); else this.expanded.delete(key);
					this.app.workspace.requestSaveLayout();
				}, this.expanded.has(key)));
				this.cards.set(key, card);
			}
			card.update(goal, history, this.service.observedAt);
			if (this.grid.children[index] !== card.container) this.grid.insertBefore(card.container, this.grid.children[index] ?? null);
		}
		for (const [key, card] of this.cards) if (!keys.has(key)) {
			this.removeChild(card); card.container.remove(); this.cards.delete(key);
		}
	}

	private async openGoal(goal: GoalSnapshot): Promise<void> {
		try { await openNoteInCurrentTab(this.app.vault, this.leaf, goal.entry.file.path, goal.entry.line); }
		catch (error: unknown) { console.error('horizon: could not open goal', error); new Notice('Could not open the goal.'); }
	}
}
