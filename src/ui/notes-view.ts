import { debounce, ItemView, Notice, parseFrontMatterTags, setIcon, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { SIDEBAR_SECTIONS, SidebarOption } from './sidebar-options';
import { DEPENDENT_ICON, HORIZON_ICON, PARENT_CHILD_ICON } from './icons';
import { findTaggedEntries, iconForNoteTags } from './tagged-notes';
import type { HorizonSettings } from '../settings';
import { openNoteInCurrentTab } from './open-note';
import { parentNotes } from './parent-notes';
import { nestTaggedEntries, visibleEntryRelations } from './entry-tree';
import type { Events, TFile } from 'obsidian';
import type { TaggedEntry } from './tagged-notes';
import {
	availableProjectStatuses, filterProjectEntries, normalizeProjectFilter, projectFilterLabel,
	projectEntryStatus, reconcileProjectFilter, type ProjectFilter,
} from './project-filter';
import { ProjectMenus } from './project-menus';
import { StatusFilterPills } from './status-filter-pills';
import { EscapeActions } from './escape-actions';

export const HORIZON_NOTES_VIEW_TYPE = 'horizon-tagged-notes';

export class HorizonNotesView extends ItemView {
	navigation = false;
	private selectedOption = 'life-areas';
	private resultsEl: HTMLElement | undefined;
	private previewEl: HTMLElement | undefined;
	private renderVersion = 0;
	private statusFilter: ProjectFilter = 'all';
	private menus: ProjectMenus;
	private pills: StatusFilterPills;
	private escapeActions: EscapeActions;

	constructor(leaf: WorkspaceLeaf, private getSettings: () => HorizonSettings) {
		super(leaf);
		this.menus = new ProjectMenus(this.app, () => this.renderNotes());
		this.pills = this.addChild(new StatusFilterPills(() => this.statusFilter, filter => {
			this.statusFilter = filter;
			void this.renderNotes();
			this.app.workspace.requestSaveLayout();
		}));
		this.escapeActions = this.addChild(new EscapeActions(this.contentEl.ownerDocument));
		this.escapeActions.addAction(event => {
			if (this.selectedOption !== 'projects' ||
				!this.contentEl.contains(event.target as Node)) return false;
			return this.pills.clearSelection();
		});
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
	getState(): Record<string, unknown> { return { optionId: this.selectedOption, statusFilter: this.statusFilter }; }

	setState(state: unknown, _result: ViewStateResult): Promise<void> {
		if (state && typeof state === 'object' && 'optionId' in state) {
			const option = SIDEBAR_SECTIONS.flatMap(section => section.options)
				.find(item => item.id === state.optionId && item.tag);
			if (option && option.id !== this.selectedOption) {
				this.selectedOption = option.id;
				this.pills.reset();
			}
		}
		if (state && typeof state === 'object' && 'statusFilter' in state) {
			this.statusFilter = normalizeProjectFilter(state.statusFilter);
		}
		this.menus.close();
		void this.renderNotes();
		return Promise.resolve();
	}

	onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('horizon-notes');
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
			const statusButton = target?.closest<HTMLElement>('button.horizon-project-status');
			if (statusButton) {
				event.preventDefault();
				event.stopPropagation();
				this.menus.openStatus(statusButton, event);
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
		this.register(() => this.menus.close());
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
		this.menus.close();
		this.pills.reset();
		this.renderVersion++;
		this.resultsEl = undefined;
		this.previewEl = undefined;
		this.contentEl.empty();
		return Promise.resolve();
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
				return;
			}
			const names = new Map<string, Set<string>>();
			for (const { file } of entries) {
				const paths = names.get(file.basename) ?? new Set<string>();
				paths.add(file.path);
				names.set(file.basename, paths);
			}
			const list = results.createEl('ul', { cls: 'horizon-note-list' });
			const pending = nestTaggedEntries(entries).map(node => ({ node, list, nested: false })).reverse();
			while (pending.length) {
				const row = pending.pop();
				if (!row) break;
				const entry = row.node.entry;
				const parents = visibleEntryRelations(row.node);
				const { file } = entry;
				const item = row.list.createEl('li', { cls: 'horizon-note-item' });
				const rowEl = isProject ? item.createDiv({ cls: 'horizon-project-row' }) : item;
				if (isProject && row.nested) rowEl.addClass('is-nested');
				const link = rowEl.createEl('a', {
					cls: 'horizon-note-link',
					attr: {
						href: file.path, 'data-note-path': file.path,
						'aria-label': entry.text,
					},
				});
				if (isProject) link.setAttribute('data-tooltip-classes', 'horizon-project-tooltip');
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
							'data-project-status': status.tag,
							'data-tooltip-classes': 'horizon-project-tooltip',
							'aria-haspopup': 'menu', 'aria-expanded': 'false',
						},
					});
					if (entry.line !== undefined) button.setAttribute('data-note-line', String(entry.line));
					if (entry.sourceLine !== undefined) button.setAttribute('data-source-line', entry.sourceLine);
					setIcon(button, status.icon);
				} else setIcon(icon, option.noteIcon ?? 'file-text');
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
				if (row.node.children.length) {
					const children = item.createEl('ul', { cls: 'horizon-note-children' });
					for (const node of [...row.node.children].reverse()) {
						pending.push({ node, list: children, nested: true });
					}
				}
			}
		} catch (error: unknown) {
			if (version !== this.renderVersion || results !== this.resultsEl) return;
			console.error('horizon: could not load tagged entries', error);
			new Notice('Could not load tagged notes.');
		}
	}
}
