import { debounce, ItemView, Notice, parseFrontMatterTags, setIcon, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { SIDEBAR_SECTIONS, SidebarOption } from './sidebar-options';
import { DEPENDENT_ICON, HORIZON_ICON, PARENT_CHILD_ICON } from './icons';
import { findTaggedEntries, iconForNoteTags } from './tagged-notes';
import type { HorizonSettings } from '../settings';
import { openNoteInCurrentTab } from './open-note';
import { parentNotes } from './parent-notes';
import { nestTaggedEntries, visibleEntryRelations, type EntryNode } from './entry-tree';
import type { Events, TFile } from 'obsidian';
import type { TaggedEntry } from './tagged-notes';
import {
	availableProjectStatuses, filterProjectEntries, normalizeProjectFilter, projectFilterLabel,
	projectEntryStatus, reconcileProjectFilter, type ProjectFilter,
} from './project-filter';
import { ProjectMenus } from './project-menus';
import { StatusFilterPills } from './status-filter-pills';
import { EscapeActions } from './escape-actions';
import { ListKeyboardNavigation } from './list-keyboard-navigation';
import { OptionKeyboardShortcuts } from './option-keyboard-shortcuts';
import { ProjectStatusKeyboard } from './project-status-keyboard';
import { NoteDateEditor } from './note-date-editor';
import { renderDeadlineControl } from './deadline-control';
import { DATE_PROPERTIES, today } from '../planning/dates';
import { RowActionKeyboard } from './row-action-keyboard';
import { NOTE_ACTION_SHORTCUTS, noteActionShortcut } from './note-action-shortcuts';
import { RelationPicker } from './relation-picker';
import { formatDeadline, formatStartDate } from './deadline';
import { groupEntriesByDate, type DateEntryGroup } from './date-entry-groups';
import { FilterKeyboardNavigation } from './filter-keyboard-navigation';
import { LaterItemsKeyboard } from './later-items-keyboard';
import { NoteActionHistory } from './note-action-history';
import { HistoryKeyboard } from './history-keyboard';
import { LaterItemsAnimation } from './later-items-animation';

export const HORIZON_NOTES_VIEW_TYPE = 'horizon-tagged-notes';

export class HorizonNotesView extends ItemView {
	navigation = false;
	private selectedOption = 'life-areas';
	private resultsEl: HTMLElement | undefined;
	private previewEl: HTMLElement | undefined;
	private renderVersion = 0;
	private statusFilter: ProjectFilter = 'all';
	private showLaterItems = true;
	private laterAnimation = this.addChild(new LaterItemsAnimation());
	private menus: ProjectMenus;
	private pills: StatusFilterPills;
	private escapeActions: EscapeActions;
	private keyboardNavigation: ListKeyboardNavigation | undefined;
	private shortcuts: OptionKeyboardShortcuts | undefined;
	private statusKeyboard: ProjectStatusKeyboard | undefined;
	private deadlineEditor: NoteDateEditor | undefined;
	private deadlineKeyboard: RowActionKeyboard | undefined;
	private startKeyboard: RowActionKeyboard | undefined;
	private relationKeyboards: RowActionKeyboard[] = [];
	private relationPicker: RelationPicker | undefined;
	private filterKeyboard: FilterKeyboardNavigation | undefined;
	private laterKeyboard: LaterItemsKeyboard | undefined;
	private history: NoteActionHistory;
	private historyKeyboard: HistoryKeyboard | undefined;

	constructor(
		leaf: WorkspaceLeaf,
		private getSettings: () => HorizonSettings,
		private selectOption: (option: SidebarOption) => void,
	) {
		super(leaf);
		this.history = new NoteActionHistory(this.app);
		this.menus = new ProjectMenus(this.app, () => this.renderNotes(), this.history);
		this.pills = this.addChild(new StatusFilterPills(() => this.statusFilter, filter => {
			this.statusFilter = filter;
			void this.renderNotes();
			this.app.workspace.requestSaveLayout();
		}));
		this.escapeActions = this.addChild(new EscapeActions(this.contentEl.ownerDocument));
		this.escapeActions.addAction(event => {
			if (this.selectedOption !== 'projects' || this.menus.isOpen ||
				!this.contentEl.contains(event.target as Node)) return false;
			return this.pills.clearSelection();
		});
		this.escapeActions.addAction(() => this.keyboardNavigation?.escape() ?? false);
	}

	applySettings(): void {
		const settings = this.getSettings();
		this.contentEl.toggleClass('horizon-custom-width', !settings.useThemeContentWidth);
		this.contentEl.setCssProps({ '--horizon-content-width': `${settings.customContentWidth}px` });
		// Obsidian exposes this preference through Vault at runtime.
		const vault = this.app.vault as typeof this.app.vault & { getConfig?: (key: string) => unknown };
		this.previewEl?.toggleClass('is-readable-line-width',
			settings.useThemeContentWidth && vault.getConfig?.('readableLineLength') !== false);
	}

	private option(): SidebarOption | undefined {
		return SIDEBAR_SECTIONS.flatMap(section => section.options).find(option => option.id === this.selectedOption);
	}

	getViewType(): string { return HORIZON_NOTES_VIEW_TYPE; }
	getDisplayText(): string { return this.option()?.label ?? 'horizon'; }
	getIcon(): string { return this.option()?.icon ?? HORIZON_ICON; }
	getState(): Record<string, unknown> {
		return { optionId: this.selectedOption, statusFilter: this.statusFilter, showLaterItems: this.showLaterItems };
	}
	focus(): void { this.contentEl.focus({ preventScroll: true }); }

	setState(state: unknown, _result: ViewStateResult): Promise<void> {
		if (state && typeof state === 'object' && 'optionId' in state) {
			const option = SIDEBAR_SECTIONS.flatMap(section => section.options)
				.find(item => item.id === state.optionId && item.tag);
			if (option && option.id !== this.selectedOption) {
				this.selectedOption = option.id;
				this.pills.reset();
				this.keyboardNavigation?.reset();
				if (this.contentEl.contains(this.contentEl.ownerDocument.activeElement)) this.focus();
			}
		}
		if (state && typeof state === 'object' && 'statusFilter' in state) {
			this.statusFilter = normalizeProjectFilter(state.statusFilter);
		}
		if (state && typeof state === 'object' && 'showLaterItems' in state && typeof state.showLaterItems === 'boolean') {
			this.showLaterItems = state.showLaterItems;
		}
		this.menus.close();
		this.deadlineEditor?.close();
		this.relationPicker?.close();
		void this.renderNotes();
		return Promise.resolve();
	}

	onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('horizon-notes');
		this.contentEl.setAttribute('tabindex', '-1');
		this.historyKeyboard = this.addChild(new HistoryKeyboard(this.contentEl,
			() => !this.menus.isOpen && this.app.workspace.getActiveViewOfType(HorizonNotesView) === this,
			redo => { void this.replayHistory(redo); },
		));
		this.filterKeyboard = this.addChild(new FilterKeyboardNavigation(this.contentEl,
			() => this.selectedOption === 'projects' && !this.menus.isOpen &&
				this.app.workspace.getActiveViewOfType(HorizonNotesView) === this,
			(direction, multiple) => this.pills.step(direction, multiple),
		));
		this.laterKeyboard = this.addChild(new LaterItemsKeyboard(this.contentEl,
			() => this.selectedOption === 'projects' && !this.menus.isOpen &&
				this.app.workspace.getActiveViewOfType(HorizonNotesView) === this,
			() => this.toggleLaterItems(),
		));
		this.statusKeyboard = this.addChild(new ProjectStatusKeyboard(
			this.contentEl, () => this.selectedOption === 'projects' && !this.menus.isOpen,
			button => this.openStatus(button),
		));
		this.deadlineKeyboard = this.addChild(new RowActionKeyboard(this.contentEl, {
			...NOTE_ACTION_SHORTCUTS.deadline, row: '.horizon-deadline-row', button: 'a.horizon-note-link',
			enabled: () => (this.selectedOption === 'projects' || this.selectedOption === 'goals') && !this.menus.isOpen,
			open: button => this.openDeadline(button),
		}));
		this.startKeyboard = this.addChild(new RowActionKeyboard(this.contentEl, {
			...NOTE_ACTION_SHORTCUTS.start, row: '.horizon-deadline-row', button: 'a.horizon-note-link',
			enabled: () => (this.selectedOption === 'projects' || this.selectedOption === 'goals') && !this.menus.isOpen,
			open: link => this.openDeadline(link, 'start'),
		}));
		for (const property of ['parent', 'dependent'] as const) {
			this.relationKeyboards.push(this.addChild(new RowActionKeyboard(this.contentEl, {
				...NOTE_ACTION_SHORTCUTS[property], row: '.horizon-note-item', button: 'a.horizon-note-link',
				enabled: () => !this.menus.isOpen,
				open: link => {
					const path = link.getAttribute('data-note-path');
					if (!path) return;
					this.relationPicker?.close();
					this.relationPicker = new RelationPicker(this.app, path, property, () => this.renderNotes(), this.actionPaths(link), this.history);
					this.relationPicker.open();
				},
			})));
		}
		this.shortcuts = this.addChild(new OptionKeyboardShortcuts(this.contentEl, {
			isActive: () => this.app.workspace.getActiveViewOfType(HorizonNotesView) === this,
			isBlocked: () => this.menus.isOpen,
			activate: option => this.selectOption(option),
		}));
		this.keyboardNavigation = this.addChild(new ListKeyboardNavigation(
			this.contentEl, 'a.horizon-note-link',
			() => this.app.workspace.getActiveViewOfType(HorizonNotesView) === this && !this.menus.isOpen,
		));
		// Use the reading view's structure so theme-specific widths and margins
		// apply to the same elements as they do in native notes.
		const reading = this.contentEl.createDiv({ cls: 'markdown-reading-view' });
		this.previewEl = reading.createDiv({ cls: 'markdown-preview-view markdown-rendered' });
		const sizer = this.previewEl.createDiv({ cls: 'markdown-preview-sizer' });
		this.applySettings();
		this.resultsEl = sizer.createDiv({
			cls: 'horizon-note-results', attr: { 'aria-live': 'polite' },
		});
		this.pills.bind(this.resultsEl);
		// Delegate clicks so metadata refreshes do not accumulate link listeners.
		this.registerDomEvent(this.resultsEl, 'click', (event) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest('button.horizon-later-toggle')) {
				event.preventDefault();
				event.stopPropagation();
				this.toggleLaterItems();
				return;
			}
			const deadlineButton = target?.closest<HTMLElement>('button.horizon-note-deadline');
			if (deadlineButton) {
				event.preventDefault();
				event.stopPropagation();
				this.openDeadline(deadlineButton);
				return;
			}
			const statusButton = target?.closest<HTMLElement>('button.horizon-project-status');
			if (statusButton) {
				event.preventDefault();
				event.stopPropagation();
				this.openStatus(statusButton, event);
				return;
			}
			const link = target?.closest?.('a.horizon-note-link');
			const path = link?.getAttribute('data-note-path');
			if (!path) return;
			const lineValue = link?.getAttribute('data-note-line');
			const line = lineValue == null ? undefined : Number(lineValue);
			event.preventDefault();
			void openNoteInCurrentTab(this.app.vault, this.leaf, path, line).catch((error: unknown) => {
				console.error('horizon: could not open the note', error);
				new Notice('Could not open the note.');
			});
		});
		const refresh = debounce(() => { void this.renderNotes(); }, 150, true);
		let currentDay = today();
		this.registerInterval(window.setInterval(() => {
			const day = today();
			if (day !== currentDay) {
				currentDay = day;
				if (this.selectedOption === 'projects' || this.selectedOption === 'goals') refresh();
			}
		}, 60_000));
		this.register(() => this.menus.close());
		this.register(() => this.deadlineEditor?.close());
		this.register(() => this.relationPicker?.close());
		this.register(() => refresh.cancel());
		this.registerEvent(this.app.metadataCache.on('changed', () => refresh()));
		this.registerEvent(this.app.metadataCache.on('resolved', () => refresh()));
		this.registerEvent(this.app.vault.on('delete', () => refresh()));
		this.registerEvent(this.app.vault.on('rename', () => refresh()));
		const vaultEvents: Events = this.app.vault;
		this.registerEvent(vaultEvents.on('config-changed', () => this.applySettings()));
		void this.renderNotes();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.laterAnimation.reset();
		this.history.clear();
		if (this.historyKeyboard) this.removeChild(this.historyKeyboard);
		this.historyKeyboard = undefined;
		this.menus.close();
		this.deadlineEditor?.close();
		this.deadlineEditor = undefined;
		this.relationPicker?.close();
		this.relationPicker = undefined;
		for (const keyboard of this.relationKeyboards) this.removeChild(keyboard);
		this.relationKeyboards = [];
		this.pills.reset();
		if (this.keyboardNavigation) this.removeChild(this.keyboardNavigation);
		this.keyboardNavigation = undefined;
		if (this.shortcuts) this.removeChild(this.shortcuts);
		this.shortcuts = undefined;
		if (this.statusKeyboard) this.removeChild(this.statusKeyboard);
		this.statusKeyboard = undefined;
		if (this.deadlineKeyboard) this.removeChild(this.deadlineKeyboard);
		this.deadlineKeyboard = undefined;
		if (this.startKeyboard) this.removeChild(this.startKeyboard);
		this.startKeyboard = undefined;
		if (this.filterKeyboard) this.removeChild(this.filterKeyboard);
		this.filterKeyboard = undefined;
		if (this.laterKeyboard) this.removeChild(this.laterKeyboard);
		this.laterKeyboard = undefined;
		this.renderVersion++;
		this.resultsEl = undefined;
		this.previewEl = undefined;
		this.contentEl.empty();
		return Promise.resolve();
	}

	private toggleLaterItems(): boolean {
		const section = this.resultsEl?.querySelector<HTMLElement>('.horizon-later-section');
		const toggle = this.resultsEl?.querySelector<HTMLButtonElement>('button.horizon-later-toggle');
		if (!section || !toggle) return false;
		this.showLaterItems = !this.showLaterItems;
		if (!this.showLaterItems && section.contains(section.ownerDocument.activeElement)) {
			toggle.focus({ preventScroll: true });
		}
		this.laterAnimation.toggle(section, this.showLaterItems);
		toggle.setText(this.showLaterItems ? 'Hide later items' : 'Show later items');
		toggle.setAttribute('aria-expanded', String(this.showLaterItems));
		this.app.workspace.requestSaveLayout();
		return true;
	}

	private async replayHistory(redo: boolean): Promise<void> {
		try {
			const changed = await (redo ? this.history.redo() : this.history.undo());
			if (changed) await this.renderNotes();
		} catch (error: unknown) {
			new Notice(error instanceof Error ? error.message : 'Could not replay the change.');
			await this.renderNotes();
		}
	}

	private actionPaths(target: HTMLElement): string[] {
		return [...new Set((this.keyboardNavigation?.actionRows(target) ?? [target])
			.map(row => row.getAttribute('data-note-path')).filter((path): path is string => !!path))];
	}

	private openStatus(button: HTMLElement, event?: MouseEvent): void {
		const buttons = (this.keyboardNavigation?.actionRows(button) ?? [])
			.map(row => row.parentElement?.querySelector<HTMLElement>('button.horizon-project-status'))
			.filter((item): item is HTMLElement => !!item);
		this.menus.openStatus(button, event, buttons.length ? buttons : [button]);
	}

	private openDeadline(button: HTMLElement, property: 'start' | 'deadline' = 'deadline'): void {
		const path = button.getAttribute('data-note-path');
		if (!path) return;
		this.deadlineEditor?.close();
		this.deadlineEditor = new NoteDateEditor(this.app, path, () => this.renderNotes(), property, this.actionPaths(button), this.history);
		this.deadlineEditor.open();
	}

	private projectStatus(entry: TaggedEntry<TFile>) {
		const cache = this.app.metadataCache.getFileCache(entry.file);
		return projectEntryStatus(entry, {
			noteTags: cache?.frontmatter ? parseFrontMatterTags(cache.frontmatter) ?? [] : [],
			lineTags: cache?.tags ?? [],
		});
	}

	private async renderNotes(): Promise<void> {
		const version = ++this.renderVersion;
		const results = this.resultsEl;
		if (!results) return;
		const option = this.option();
		if (!option?.tag) {
			results.hidden = true;
			return;
		}
		results.hidden = false;
		const tag = option.tag;
		try {
			let entries = await findTaggedEntries(this.app.vault.getMarkdownFiles(), (file) => {
				const cache = this.app.metadataCache.getFileCache(file);
				if (!cache) return null;
				const resolveRelation = (linkpath: string) => {
					const linked = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
					if (!linked) return undefined;
					const frontmatter = this.app.metadataCache.getFileCache(linked)?.frontmatter;
					return {
						name: linked.basename,
						path: linked.path,
						icon: iconForNoteTags(frontmatter ? parseFrontMatterTags(frontmatter) ?? [] : []),
					};
				};
				return {
					noteTags: cache.frontmatter ? parseFrontMatterTags(cache.frontmatter) ?? [] : [],
					lineTags: cache.tags ?? [],
					parents: parentNotes(cache.frontmatter?.parent, resolveRelation),
					dependents: parentNotes(cache.frontmatter?.dependent, resolveRelation),
				};
			}, file => this.app.vault.cachedRead(file), tag);
			// A category change, metadata refresh, or close supersedes pending reads.
			if (version !== this.renderVersion || results !== this.resultsEl) return;
			const isProject = option.id === 'projects';
			const hasDeadlines = isProject || option.id === 'goals';
			const statuses = isProject ? availableProjectStatuses(entries, entry => this.projectStatus(entry)) : [];
			if (isProject) {
				const filter = reconcileProjectFilter(this.statusFilter, statuses);
				if (projectFilterLabel(filter) !== projectFilterLabel(this.statusFilter)) {
					this.statusFilter = filter;
					this.app.workspace.requestSaveLayout();
				}
				entries = filterProjectEntries(entries, this.statusFilter, entry => this.projectStatus(entry));
			}
			this.pills.beforeRender();
			this.keyboardNavigation?.beforeRender();
			const laterToggleFocused = results.querySelector('button.horizon-later-toggle') === results.ownerDocument.activeElement;
			this.laterAnimation.reset();
			results.empty();

			// The complete row inherits native title spacing, including theme padding.
			const heading = results.createDiv({ cls: 'inline-title horizon-results-heading' });
			heading.createEl('h3', { cls: 'horizon-inline-title horizon-no-select', text: option.label });
			heading.createSpan({ cls: 'horizon-note-count', text: String(entries.length) });
			if (isProject) this.pills.render(results, statuses);
			if (!entries.length) {
				results.createEl('p', { cls: 'horizon-empty-state', text: isProject && this.statusFilter !== 'all'
					? `No projects with ${this.statusFilter.length > 1 ? 'statuses' : 'status'} ${projectFilterLabel(this.statusFilter)}.`
					: `No notes tagged ${tag}.` });
				this.keyboardNavigation?.afterRender();
				return;
			}
			const names = new Map<string, Set<string>>();
			for (const { file } of entries) {
				const paths = names.get(file.basename) ?? new Set<string>();
				paths.add(file.path);
				names.set(file.basename, paths);
			}
			const groups: DateEntryGroup<TaggedEntry<TFile>>[] = isProject
				? groupEntriesByDate(entries, entry => {
					const properties = this.app.metadataCache.getFileCache(entry.file)?.frontmatter;
					return { status: this.projectStatus(entry).tag, start: properties?.[DATE_PROPERTIES.start], deadline: properties?.deadline };
				}) : [{ entries, nest: true }];
			const filteredList = isProject && this.statusFilter !== 'all'
				? results.createEl('ul', { cls: 'horizon-note-list' }) : undefined;
			const hasLaterItems = isProject && !filteredList && groups.some(group => group.label === 'Someday');
			const pending = groups.flatMap(group => {
				let container: HTMLElement = results;
				if (group.label && !filteredList) {
					const label = group.label;
					container = results.createEl('section', { cls: 'horizon-status-group', attr: { 'aria-label': label } });
					if (label === 'Someday') {
						container.addClass('horizon-later-section');
						container.hidden = !this.showLaterItems;
						container.toggleAttribute('inert', !this.showLaterItems);
						container.setAttribute('aria-hidden', String(!this.showLaterItems));
					}
					const heading = container.createEl('h4', { cls: 'horizon-status-heading' });
					heading.createSpan({ text: label });
				}
				const list = filteredList ?? container.createEl('ul', { cls: 'horizon-note-list' });
				const nodes: EntryNode<TFile>[] = group.nest ? nestTaggedEntries(group.entries)
					: group.entries.map(entry => ({ entry, children: [] }));
				return nodes.map(node => ({ node, list, nested: false }));
			}).reverse();
			while (pending.length) {
				const row = pending.pop();
				if (!row) break;
				const entry = row.node.entry;
				const parents = visibleEntryRelations(row.node);
				const { file } = entry;
				const item = row.list.createEl('li', { cls: 'horizon-note-item' });
				const rowEl = hasDeadlines ? item.createDiv({ cls: 'horizon-deadline-row' }) : item;
				if (isProject) rowEl.addClass('horizon-project-row');
				if (isProject && row.nested) rowEl.addClass('is-nested');
				const link = rowEl.createEl('a', {
					cls: 'horizon-note-link',
					attr: {
						href: file.path, 'data-note-path': file.path,
						'aria-label': entry.text,
					},
				});
				if (isProject) link.setAttribute('data-tooltip-classes', 'horizon-project-tooltip');
				link.setAttribute('aria-keyshortcuts', [noteActionShortcut('parent'), noteActionShortcut('dependent'),
					...(hasDeadlines ? [noteActionShortcut('start'), noteActionShortcut('deadline')] : []),
					...(isProject ? [noteActionShortcut('status')] : [])].join(' '));
				if (entry.line !== undefined) link.setAttribute('data-note-line', String(entry.line));
				if (row.nested) {
					const branch = link.createSpan({ cls: 'horizon-note-branch', attr: { 'aria-hidden': 'true' } });
					setIcon(branch, row.node.relationship === 'dependent' ? DEPENDENT_ICON : PARENT_CHILD_ICON);
				}
				const icon = link.createSpan({ cls: 'horizon-note-icon', attr: { 'aria-hidden': 'true' } });
				if (isProject) {
					icon.addClass('horizon-project-icon-placeholder');
					const status = this.projectStatus(entry);
					const button = rowEl.createEl('button', {
						cls: 'clickable-icon horizon-note-icon horizon-project-status',
						attr: {
							type: 'button', 'data-note-path': file.path,
							'aria-label': 'Change project status',
							'aria-keyshortcuts': noteActionShortcut('status'),
							'data-project-status': status.tag,
							'data-tooltip-classes': 'horizon-project-tooltip',
							'aria-haspopup': 'menu', 'aria-expanded': 'false',
						},
					});
					if (entry.line !== undefined) button.setAttribute('data-note-line', String(entry.line));
					if (entry.sourceLine !== undefined) button.setAttribute('data-source-line', entry.sourceLine);
					setIcon(button, status.icon);
				} else setIcon(icon, option.noteIcon ?? 'file-text');
				if (hasDeadlines) {
					const start: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[DATE_PROPERTIES.start];
					const formatted = formatStartDate(start);
					if (formatted) {
						const badge = link.createSpan({ cls: 'horizon-note-start',
							attr: { 'aria-label': `Start date: ${formatDeadline(start) ?? formatted}` } });
						badge.createSpan({ cls: 'horizon-note-start-label', text: formatted });
					}
				}
				const text = link.createDiv({ cls: 'horizon-note-text' });
				text.createSpan({ cls: 'horizon-note-title', text: entry.text });
				if (parents.length) {
					const subtitle = text.createSpan({ cls: 'horizon-note-subtitle' });
					subtitle.addClass('horizon-note-parents');
					for (const parent of parents) {
						const relation = subtitle.createSpan({ cls: 'horizon-note-parent' });
						const parentIcon = relation.createSpan({
							cls: 'horizon-note-parent-icon', attr: { 'aria-hidden': 'true' },
						});
						setIcon(parentIcon, parent.icon);
						relation.createSpan({ cls: 'horizon-note-parent-name', text: parent.name });
					}
				}
				if ((names.get(file.basename)?.size ?? 0) > 1) {
					text.createSpan({ cls: 'horizon-note-path', text: file.path });
				}
				if (hasDeadlines) renderDeadlineControl(rowEl, file.path,
					this.app.metadataCache.getFileCache(file)?.frontmatter?.deadline, entry.line);
				if (row.node.children.length) {
					const children = item.createEl('ul', { cls: 'horizon-note-children' });
					for (const node of [...row.node.children].reverse()) {
						pending.push({ node, list: children, nested: true });
					}
				}
			}
			if (hasLaterItems) {
				const toggle = results.createEl('button', { cls: 'horizon-later-toggle',
					text: this.showLaterItems ? 'Hide later items' : 'Show later items',
					attr: { type: 'button', 'aria-expanded': String(this.showLaterItems),
						'aria-keyshortcuts': noteActionShortcut('later') } });
				if (laterToggleFocused) toggle.focus({ preventScroll: true });
			}
			this.keyboardNavigation?.afterRender();
		} catch (error: unknown) {
			if (version !== this.renderVersion || results !== this.resultsEl) return;
			console.error('horizon: could not load tagged entries', error);
			new Notice('Could not load tagged notes.');
		}
	}
}
