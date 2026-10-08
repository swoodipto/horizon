import { ItemView, Notice, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { HorizonSettings } from '../settings';
import { OptionKeyboardShortcuts } from '../ui/option-keyboard-shortcuts';
import { openNoteInCurrentTab } from '../ui/open-note';
import { INSIGHTS_ICON } from '../ui/icons';
import { suppressHorizonTooltips } from '../ui/tooltips';
import type { SidebarOption } from '../ui/sidebar-options';
import { PaceCard } from './pace-card';
import type { InsightsService } from './service';
import { visiblePaceEntry, type PaceSnapshot } from './types';

export const HORIZON_INSIGHTS_VIEW_TYPE = 'horizon-insights';

export class HorizonInsightsView extends ItemView {
	navigation = false;
	private opened = false;
	private empty: HTMLElement | undefined;
	private sections = new Map<PaceSnapshot['kind'], { container: HTMLElement; grid: HTMLElement }>();
	private cards = new Map<string, PaceCard>();
	private unsubscribe: (() => void) | undefined;
	private shortcuts: OptionKeyboardShortcuts | undefined;
	private stopTooltips: (() => void) | undefined;

	constructor(leaf: WorkspaceLeaf, private service: InsightsService,
		_settings: () => HorizonSettings, private selectOption: (option: SidebarOption) => void) { super(leaf); }

	getViewType(): string { return HORIZON_INSIGHTS_VIEW_TYPE; }
	getDisplayText(): string { return 'Insights'; }
	getIcon(): string { return INSIGHTS_ICON; }
	focus(): void { this.contentEl.focus({ preventScroll: true }); }
	getState(): Record<string, unknown> { return { optionId: 'insights' }; }
	setState(_state: unknown, _result: ViewStateResult): Promise<void> {
		this.render(); return Promise.resolve();
	}

	applySettings(): void {
		// Insights has an independent responsive width; note-list width settings do not apply.
	}

	onOpen(): Promise<void> {
		this.stopTooltips = suppressHorizonTooltips(this.contentEl);
		this.register(() => this.stopTooltips?.());
		this.opened = true;
		this.contentEl.empty();
		this.contentEl.removeClass('horizon-notes', 'horizon-custom-width');
		this.contentEl.addClass('horizon-insights');
		this.contentEl.tabIndex = -1;
		const results = this.contentEl.createDiv({ cls: 'horizon-insights-content' });
		results.createEl('h1', { text: 'Insights', cls: 'horizon-insights-title' });
		this.empty = results.createDiv({ cls: 'horizon-insights-empty', attr: { role: 'status' } });
		for (const [kind, label] of [['goal', 'Goals'], ['project', 'Projects']] as const) {
			const container = results.createEl('section', { cls: 'horizon-insights-section', attr: { 'aria-label': label } });
			container.createEl('h2', { text: label, cls: 'horizon-insights-section-title' });
			this.sections.set(kind, { container, grid: container.createDiv({ cls: 'horizon-insights-grid' }) });
		}
		const title = this.contentEl.closest('.workspace-leaf-content')?.querySelector('.view-header-title');
		if (title) title.textContent = 'Insights';
		this.unsubscribe = this.service.subscribe(() => this.render());
		this.shortcuts = this.addChild(new OptionKeyboardShortcuts(this.contentEl, {
			isActive: () => this.app.workspace.getActiveViewOfType(HorizonInsightsView) === this,
			activate: option => this.selectOption(option),
		}));
		this.render(); return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.stopTooltips?.(); this.stopTooltips = undefined;
		this.opened = false;
		this.unsubscribe?.(); this.unsubscribe = undefined;
		for (const card of this.cards.values()) this.removeChild(card);
		this.cards.clear();
		this.sections.clear();
		this.empty = undefined;
		if (this.shortcuts) this.removeChild(this.shortcuts);
		this.shortcuts = undefined;
		this.contentEl.empty(); return Promise.resolve();
	}

	private render(): void {
		if (!this.opened || !this.empty) return;
		const items: PaceSnapshot[] = [
			...this.service.goals.map(goal => ({ ...goal, kind: 'goal' as const })), ...this.service.projects,
		].filter(visiblePaceEntry);
		this.empty.textContent = this.service.ready ? 'No eligible goals or projects. Add a start date; goals also need progress.' : 'Loading progress…';
		this.empty.hidden = items.length > 0;
		const keys = new Set<string>();
		const positions = new Map<PaceSnapshot['kind'], number>();
		for (const item of items) {
			const section = this.sections.get(item.kind);
			if (!section) continue;
			const index = positions.get(item.kind) ?? 0;
			positions.set(item.kind, index + 1);
			const history = item.kind === 'goal' ? this.service.history(item) : undefined;
			// Persistent observation identity keeps focus through safe renames and line moves.
			const key = history ? `goal:${history.id}` : JSON.stringify([item.kind, item.identity.path, item.identity.line ?? -1]); keys.add(key);
			let card = this.cards.get(key);
			if (!card) {
				card = this.addChild(new PaceCard(section.grid, item, entry => { void this.openEntry(entry); }));
				this.cards.set(key, card);
			}
			card.update(item);
			if (section.grid.children[index] !== card.container) {
				const focused = card.container.ownerDocument.activeElement as HTMLElement | null;
				const restoreFocus = focused !== null && card.container.contains(focused);
				section.grid.insertBefore(card.container, section.grid.children[index] ?? null);
				if (restoreFocus) focused.focus({ preventScroll: true });
			}
		}
		for (const [kind, section] of this.sections) section.container.hidden = !positions.get(kind);
		for (const [key, card] of this.cards) if (!keys.has(key)) {
			this.removeChild(card); card.container.remove(); this.cards.delete(key);
		}
	}

	private async openEntry(item: PaceSnapshot): Promise<void> {
		try { await openNoteInCurrentTab(this.app.vault, this.leaf, item.entry.file.path, item.entry.line); }
		catch (error: unknown) { console.error('horizon: could not open insights note', error); new Notice('Could not open the note.'); }
	}
}
