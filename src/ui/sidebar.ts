import { debounce, ItemView, Notice, parseFrontMatterTags, setIcon, WorkspaceLeaf } from 'obsidian';
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

export const HORIZON_VIEW_TYPE = 'horizon-sidebar';
const HIDDEN_SIDEBAR_OPTIONS = new Set(['insights', 'upcoming', 'timeline']);

export class HorizonSidebarView extends ItemView {
	navigation = false;
	private selectedOption = 'life-areas';
	private optionButtons = new Map<string, HTMLElement>();
	private projectsToggle: HTMLButtonElement | undefined;
	private doingProjectsEl: HTMLElement | undefined;
	private renderVersion = 0;
	private shortcuts: OptionKeyboardShortcuts | undefined;

	constructor(
		leaf: WorkspaceLeaf,
		private openNotes: (option: SidebarOption) => Promise<void>,
		private openProject: (path: string, line?: number) => Promise<void>,
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
		if (option.tag || isPlanningOption(option)) void this.openNotes(option);
		else new Notice(`${option.label}: test action.`);
	}

	onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('horizon-sidebar');
		this.optionButtons.clear();
		this.projectsToggle = undefined;
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
				if (option.id === 'projects') this.addProjects(options, option);
				else this.addOption(options, option);
			}
		}

		const refresh = debounce(() => { void this.renderDoingProjects(); }, 150, true);
		this.register(() => refresh.cancel());
		this.registerEvent(this.app.metadataCache.on('changed', () => refresh()));
		this.registerEvent(this.app.metadataCache.on('resolved', () => refresh()));
		this.registerEvent(this.app.vault.on('delete', () => refresh()));
		this.registerEvent(this.app.vault.on('rename', () => refresh()));
		this.updateSelection();
		void this.renderDoingProjects();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.optionButtons.clear();
		if (this.shortcuts) this.removeChild(this.shortcuts);
		this.shortcuts = undefined;
		this.projectsToggle = undefined;
		this.doingProjectsEl = undefined;
		this.renderVersion++;
		this.contentEl.empty();
		return Promise.resolve();
	}

	private addProjects(container: HTMLElement, option: SidebarOption): void {
		const group = container.createDiv({ cls: 'horizon-projects-menu' });
		const header = group.createDiv({ cls: 'horizon-projects-header' });
		const button = header.createEl('button', {
			cls: 'horizon-option horizon-no-select',
			attr: { type: 'button', 'data-option': option.id },
		});
		const icon = button.createSpan({ cls: 'horizon-option-icon', attr: { 'aria-hidden': 'true' } });
		setIcon(icon, option.icon);
		button.createSpan({ cls: 'horizon-option-label', text: option.label });
		const toggle = header.createEl('button', {
			cls: 'horizon-projects-toggle',
			attr: { type: 'button', 'aria-expanded': 'true' },
		});
		const toggleLabel = toggle.createSpan({ cls: 'horizon-sr-only', text: 'Collapse projects' });
		const chevron = toggle.createSpan({ cls: 'horizon-projects-chevron', attr: { 'aria-hidden': 'true' } });
		setIcon(chevron, 'chevron-down');
		this.optionButtons.set(option.id, button);
		this.labelShortcut(button, option);
		this.projectsToggle = toggle;
		this.doingProjectsEl = group.createDiv({ cls: 'horizon-doing-projects' });
		this.registerDomEvent(this.doingProjectsEl, 'click', event => {
			const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('button.horizon-doing-project');
			const path = button?.getAttribute('data-note-path');
			if (!button || !path || !this.doingProjectsEl?.contains(button)) return;
			const value = button.getAttribute('data-note-line');
			const line = value === null ? undefined : Number(value);
			void this.openProject(path, line).catch((error: unknown) => {
				console.error('horizon: could not open the project', error);
				new Notice('Could not open the project.');
			});
		});

		this.registerDomEvent(button, 'click', () => {
			this.selectOption(option);
		});
		this.registerDomEvent(toggle, 'click', () => {
			const collapsed = !group.hasClass('is-collapsed');
			group.toggleClass('is-collapsed', collapsed);
			toggle.setAttribute('aria-expanded', String(!collapsed));
			toggleLabel.setText(collapsed ? 'Expand projects' : 'Collapse projects');
		});
	}

	private async renderDoingProjects(): Promise<void> {
		const version = ++this.renderVersion;
		const container = this.doingProjectsEl;
		if (!container) return;
		try {
			const entries = await findTaggedEntries(this.app.vault.getMarkdownFiles(), file => {
				const cache = this.app.metadataCache.getFileCache(file);
				return cache ? {
					noteTags: cache.frontmatter ? parseFrontMatterTags(cache.frontmatter) ?? [] : [],
					lineTags: cache.tags ?? [],
				} : null;
			}, file => this.app.vault.cachedRead(file), '#project');
			if (version !== this.renderVersion || container !== this.doingProjectsEl) return;
			const doing = entries.filter(entry => this.projectStatus(entry) === 'doing');
			container.empty();
			const groups = groupEntriesByParent(doing, entry => {
				const cache = this.app.metadataCache.getFileCache(entry.file);
				return parentNotes(cache?.frontmatter?.parent, linkpath => {
					const parent = this.app.metadataCache.getFirstLinkpathDest(linkpath, entry.file.path);
					return parent ? { name: parent.basename, path: parent.path, icon: 'sticky-note' } : undefined;
				});
			});
			for (const group of groups) {
				const section = container.createDiv({ cls: 'horizon-sidebar-project-group' });
				if (group.parent) {
					const heading = section.createDiv({ cls: 'horizon-sidebar-project-heading' });
					const icon = heading.createSpan({ cls: 'horizon-sidebar-project-heading-icon', attr: { 'aria-hidden': 'true' } });
					setIcon(icon, GOALS_ICON);
					heading.createSpan({ cls: 'horizon-sidebar-project-heading-label', text: group.parent.name });
				}
				for (const entry of group.entries) {
					const button = section.createEl('button', {
						cls: 'horizon-doing-project',
						attr: {
							type: 'button',
							'data-note-path': entry.file.path,
							...(entry.line === undefined ? {} : { 'data-note-line': String(entry.line) }),
						},
					});
					const icon = button.createSpan({ cls: 'horizon-option-icon', attr: { 'aria-hidden': 'true' } });
					setIcon(icon, projectStatusForTags(['doing']).icon);
					button.createSpan({ cls: 'horizon-doing-project-label', text: entry.text });
				}
			}
		} catch (error) {
			console.error('horizon: could not load projects', error);
			if (version === this.renderVersion) {
				container.empty();
				container.createDiv({ cls: 'horizon-projects-empty', text: 'Could not load projects' });
			}
		}
	}

	private projectStatus(entry: TaggedEntry<TFile>): string {
		const cache = this.app.metadataCache.getFileCache(entry.file);
		return projectEntryStatus(entry, {
			noteTags: cache?.frontmatter ? parseFrontMatterTags(cache.frontmatter) ?? [] : [],
			lineTags: cache?.tags ?? [],
		}).tag;
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
		this.projectsToggle?.toggleClass('is-active', this.selectedOption === 'projects');
	}

}
