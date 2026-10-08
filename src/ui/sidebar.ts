import { debounce, ItemView, Notice, setIcon, WorkspaceLeaf } from 'obsidian';
import { SIDEBAR_SECTIONS, SidebarOption } from './sidebar-options';
import { HORIZON_ICON } from './icons';
import { GOALS_ICON } from './icon-ids';
import { findTaggedEntries, type TaggedEntry } from './tagged-notes';
import { projectEntryStatus } from './project-filter';
import { projectStatusForTags } from './project-status';
import type { TFile } from 'obsidian';
import { OptionKeyboardShortcuts } from './option-keyboard-shortcuts';
import { shortcutForOption } from './option-shortcuts';
import { parentNotes } from './parent-notes';
import { groupEntriesByParent } from './parent-entry-groups';
import { isPlanningOption } from '../planning/option';
import { taggedMetadataReader } from './tagged-metadata';
import { goalProgress, renderGoalProgressIcon } from './goal-progress';
import { projectTaskProgress } from './project-task-progress';
import { activeSubgoalCount, sidebarGoalGroups, sidebarGoals, sidebarProjects } from './sidebar-active-entries';
import type { EntryNode } from './entry-tree';
import { suppressHorizonTooltips } from './tooltips';

export const HORIZON_VIEW_TYPE = 'horizon-sidebar';
const HIDDEN_SIDEBAR_OPTIONS = new Set(['upcoming', 'timeline']);

export class HorizonSidebarView extends ItemView {
	navigation = false;
	private selectedOption = 'life-areas';
	private optionButtons = new Map<string, HTMLElement>();
	private optionToggles = new Map<string, HTMLButtonElement>();
	private goalsEl: HTMLElement | undefined;
	private projectsEl: HTMLElement | undefined;
	private renderVersion = 0;
	private shortcuts: OptionKeyboardShortcuts | undefined;
	private stopTooltips: (() => void) | undefined;

	constructor(
		leaf: WorkspaceLeaf,
		private openNotes: (option: SidebarOption, highlight?: { path: string; line?: number }) => Promise<void>,
		private openEntry: (path: string, line?: number) => Promise<void>,
	) {
		super(leaf);
	}

	getViewType(): string {
		return HORIZON_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'horizon';
	}

	getIcon(): string {
		return HORIZON_ICON;
	}

	selectOption(option: SidebarOption): void {
		this.selectedOption = option.id;
		this.updateSelection();
		if (option.tag || isPlanningOption(option) || option.id === 'insights') void this.openNotes(option);
		else new Notice(`${option.label}: test action.`);
	}

	onOpen(): Promise<void> {
		this.stopTooltips = suppressHorizonTooltips(this.contentEl);
		this.register(() => this.stopTooltips?.());
		this.contentEl.empty();
		this.contentEl.addClass('horizon-sidebar');
		this.optionButtons.clear();
		this.optionToggles.clear();
		this.shortcuts = this.addChild(new OptionKeyboardShortcuts(this.contentEl, {
			isActive: () => this.app.workspace.getActiveViewOfType(HorizonSidebarView) === this,
			activate: option => this.selectOption(option),
		}));

		const menu = this.contentEl.createEl('nav', {
			cls: 'horizon-menu',
			attr: { 'aria-label': 'horizon' },
		});

		for (const section of SIDEBAR_SECTIONS) {
			const visibleOptions = section.options.filter(option => !HIDDEN_SIDEBAR_OPTIONS.has(option.id));
			if (visibleOptions.length === 0) continue;
			let options: HTMLElement;
			if (section.label === 'Horizon') {
				options = menu.createDiv({ cls: 'horizon-options' });
			} else {
				const group = menu.createEl('details', { cls: 'horizon-section' });
				group.open = true;
				const heading = group.createEl('summary', { cls: 'horizon-section-heading horizon-no-select' });
				heading.createSpan({ text: section.label });
				const chevron = heading.createSpan({
					cls: 'horizon-section-chevron',
					attr: { 'aria-hidden': 'true' },
				});
				setIcon(chevron, 'chevron-down');
				options = group.createDiv({ cls: 'horizon-options' });
			}
			for (const option of visibleOptions) {
				if (option.id === 'goals' || option.id === 'projects') this.addExpandableOption(options, option);
				else this.addOption(options, option);
			}
		}

		const refresh = debounce(() => { void this.renderSidebarEntries(); }, 150, true);
		this.register(() => refresh.cancel());
		this.registerEvent(this.app.metadataCache.on('changed', () => refresh()));
		this.registerEvent(this.app.metadataCache.on('resolved', () => refresh()));
		this.registerEvent(this.app.vault.on('delete', () => refresh()));
		this.registerEvent(this.app.vault.on('rename', () => refresh()));
		this.updateSelection();
		void this.renderSidebarEntries();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.stopTooltips?.(); this.stopTooltips = undefined;
		this.optionButtons.clear();
		if (this.shortcuts) this.removeChild(this.shortcuts);
		this.shortcuts = undefined;
		this.optionToggles.clear();
		this.goalsEl = undefined;
		this.projectsEl = undefined;
		this.renderVersion++;
		this.contentEl.empty();
		return Promise.resolve();
	}

	private addExpandableOption(container: HTMLElement, option: SidebarOption): void {
		const group = container.createDiv({ cls: 'horizon-sidebar-expandable' });
		const header = group.createDiv({ cls: 'horizon-sidebar-expandable-header' });
		const button = header.createEl('button', {
			cls: 'horizon-option horizon-no-select',
			attr: { type: 'button', 'data-option': option.id },
		});
		const icon = button.createSpan({ cls: 'horizon-option-icon', attr: { 'aria-hidden': 'true' } });
		setIcon(icon, option.icon);
		button.createSpan({ cls: 'horizon-option-label', text: option.label });
		const toggle = header.createEl('button', {
			cls: 'horizon-sidebar-toggle',
			attr: { type: 'button', 'aria-expanded': 'true' },
		});
		const toggleLabel = toggle.createSpan({ cls: 'horizon-sr-only', text: `Collapse ${option.label.toLowerCase()}` });
		const chevron = toggle.createSpan({ cls: 'horizon-sidebar-chevron', attr: { 'aria-hidden': 'true' } });
		setIcon(chevron, 'chevron-down');
		this.optionButtons.set(option.id, button);
		this.labelShortcut(button, option);
		this.optionToggles.set(option.id, toggle);
		const list = group.createDiv({ cls: 'horizon-sidebar-entries' });
		if (option.id === 'goals') this.goalsEl = list;
		else this.projectsEl = list;
		this.registerDomEvent(list, 'click', event => {
			const target = event.target as HTMLElement | null;
			const more = option.id === 'goals' ? target?.closest<HTMLElement>('button.horizon-active-subgoals') : null;
			if (more && list.contains(more)) {
				const path = more.getAttribute('data-note-path');
				if (path) {
					const lineValue = more.getAttribute('data-note-line');
					this.selectedOption = option.id;
					this.updateSelection();
					void this.openNotes(option, { path, line: lineValue === null ? undefined : Number(lineValue) });
				}
				return;
			}
			const entryButton = target?.closest<HTMLElement>('button.horizon-sidebar-entry');
			const path = entryButton?.getAttribute('data-note-path');
			if (!entryButton || !path || !list.contains(entryButton)) return;
			const value = entryButton.getAttribute('data-note-line');
			const line = value === null ? undefined : Number(value);
			void this.openEntry(path, line).catch((error: unknown) => {
				console.error('horizon: could not open the entry', error);
				new Notice('Could not open the entry.');
			});
		});

		this.registerDomEvent(button, 'click', () => {
			this.selectOption(option);
		});
		this.registerDomEvent(toggle, 'click', () => {
			const collapsed = !group.hasClass('is-collapsed');
			group.toggleClass('is-collapsed', collapsed);
			toggle.setAttribute('aria-expanded', String(!collapsed));
			toggleLabel.setText(`${collapsed ? 'Expand' : 'Collapse'} ${option.label.toLowerCase()}`);
		});
	}

	private async renderSidebarEntries(): Promise<void> {
		const version = ++this.renderVersion;
		const goalsEl = this.goalsEl;
		const projectsEl = this.projectsEl;
		if (!goalsEl || !projectsEl) return;
		try {
			const files = this.app.vault.getMarkdownFiles();
			const metadata = taggedMetadataReader(this.app);
			const read = (file: TFile) => this.app.vault.cachedRead(file);
			const [goals, projects] = await Promise.all([
				findTaggedEntries(files, metadata, read, '#goal'),
				findTaggedEntries(files, metadata, read, '#project'),
			]);
			if (version !== this.renderVersion || goalsEl !== this.goalsEl || projectsEl !== this.projectsEl) return;
			const status = (entry: TaggedEntry<TFile>) =>
				projectEntryStatus(entry, metadata(entry.file) ?? { noteTags: [], lineTags: [] }).tag;
			const progress = goalProgress(goals, projects, status,
				entry => projectTaskProgress(entry, this.app.metadataCache.getFileCache(entry.file)?.listItems));
			goalsEl.empty();
			for (const group of sidebarGoalGroups(goals, sidebarGoals(goals, progress))) {
				const section = goalsEl.createDiv({ cls: 'horizon-sidebar-project-group' });
				if (group.parent) {
					const heading = section.createDiv({ cls: 'horizon-sidebar-project-heading' });
					const icon = heading.createSpan({ cls: 'horizon-sidebar-project-heading-icon', attr: { 'aria-hidden': 'true' } });
					setIcon(icon, group.parent.icon);
					heading.createSpan({ cls: 'horizon-sidebar-project-heading-label', text: group.parent.name });
				}
				for (const node of group.entries) this.addGoalNode(section, node, progress, 0);
			}
			goalsEl.parentElement?.toggleClass('has-entries', goalsEl.childElementCount > 0);
			projectsEl.empty();
			const groups = groupEntriesByParent(sidebarProjects(projects, status), entry => {
				const cache = this.app.metadataCache.getFileCache(entry.file);
				return parentNotes(cache?.frontmatter?.parent, linkpath => {
					const parent = this.app.metadataCache.getFirstLinkpathDest(linkpath, entry.file.path);
					return parent ? { name: parent.basename, path: parent.path, icon: 'sticky-note' } : undefined;
				});
			});
			for (const group of groups) {
				const section = projectsEl.createDiv({ cls: 'horizon-sidebar-project-group' });
				if (group.parent) {
					const heading = section.createDiv({ cls: 'horizon-sidebar-project-heading' });
					const icon = heading.createSpan({ cls: 'horizon-sidebar-project-heading-icon', attr: { 'aria-hidden': 'true' } });
					setIcon(icon, GOALS_ICON);
					heading.createSpan({ cls: 'horizon-sidebar-project-heading-label', text: group.parent.name });
				}
				for (const entry of group.entries) {
					const icon = this.addEntry(section, entry);
					setIcon(icon, projectStatusForTags([status(entry)]).icon);
				}
			}
			projectsEl.parentElement?.toggleClass('has-entries', projectsEl.childElementCount > 0);
		} catch (error) {
			console.error('horizon: could not load sidebar entries', error);
			if (version === this.renderVersion) {
				goalsEl.empty();
				projectsEl.empty();
				goalsEl.parentElement?.removeClass('has-entries');
				projectsEl.parentElement?.removeClass('has-entries');
				projectsEl.createDiv({ cls: 'horizon-projects-empty', text: 'Could not load entries' });
			}
		}
	}

	private addGoalNode(
		container: HTMLElement, node: EntryNode<TFile>, progress: ReadonlyMap<TaggedEntry<TFile>, number>, depth: number,
	): void {
		const icon = this.addEntry(container, node.entry);
		renderGoalProgressIcon(icon, progress.get(node.entry) ?? 0);
		if (!node.children.length) return;
		const children = container.createDiv({ cls: 'horizon-sidebar-goal-children' });
		if (depth >= 1) {
			const count = activeSubgoalCount(node);
			children.createEl('button', {
				cls: 'horizon-active-subgoals',
				text: `${count} more active subgoal${count === 1 ? '' : 's'}`,
				attr: {
					type: 'button', 'data-note-path': node.entry.file.path,
					...(node.entry.line === undefined ? {} : { 'data-note-line': String(node.entry.line) }),
				},
			});
			return;
		}
		for (const child of node.children) this.addGoalNode(children, child, progress, depth + 1);
	}

	private addEntry(container: HTMLElement, entry: TaggedEntry<TFile>): HTMLElement {
		const button = container.createEl('button', {
			cls: 'horizon-sidebar-entry',
			attr: {
				type: 'button',
				'data-note-path': entry.file.path,
				...(entry.line === undefined ? {} : { 'data-note-line': String(entry.line) }),
			},
		});
		const icon = button.createSpan({ cls: 'horizon-option-icon', attr: { 'aria-hidden': 'true' } });
		button.createSpan({ cls: 'horizon-sidebar-entry-label', text: entry.text });
		return icon;
	}

	private addOption(container: HTMLElement, option: SidebarOption): void {
		const button = container.createEl('button', {
			cls: 'horizon-option',
			attr: { type: 'button', 'data-option': option.id },
		});
		const icon = button.createSpan({
			cls: 'horizon-option-icon',
			attr: { 'aria-hidden': 'true' },
		});
		setIcon(icon, option.icon);
		button.createSpan({ cls: 'horizon-option-label', text: option.label });
		this.optionButtons.set(option.id, button);
		this.labelShortcut(button, option);

		this.registerDomEvent(button, 'click', () => {
			this.selectOption(option);
		});
	}

	private labelShortcut(button: HTMLElement, option: SidebarOption): void {
		const key = shortcutForOption(option.id);
		if (key) button.setAttribute('aria-keyshortcuts', key.toUpperCase());
	}

	private updateSelection(): void {
		for (const [id, button] of this.optionButtons) {
			const selected = id === this.selectedOption;
			button.toggleClass('is-active', selected);
			button.setAttribute('aria-pressed', String(selected));
		}
		for (const [id, toggle] of this.optionToggles) toggle.toggleClass('is-active', id === this.selectedOption);
	}

}
