import { debounce, ItemView, Notice, parseFrontMatterTags, setIcon, WorkspaceLeaf } from 'obsidian';
import { SIDEBAR_SECTIONS, SidebarOption } from './sidebar-options';
import { HORIZON_ICON } from './icons';
import { findTaggedEntries, type TaggedEntry } from './tagged-notes';
import { projectEntryStatus } from './project-filter';
import type { TFile } from 'obsidian';

export const HORIZON_VIEW_TYPE = 'horizon-sidebar';

export class HorizonSidebarView extends ItemView {
	navigation = false;
	private selectedOption = 'life-areas';
	private optionButtons = new Map<string, HTMLElement>();
	private doingProjectsEl: HTMLElement | undefined;
	private renderVersion = 0;

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

	onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('horizon-sidebar');
		this.optionButtons.clear();

		const menu = this.contentEl.createEl('nav', {
			cls: 'horizon-menu',
			attr: { 'aria-label': 'horizon' },
		});

		for (const section of SIDEBAR_SECTIONS) {
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
			for (const option of section.options) {
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
			this.selectedOption = option.id;
			this.updateSelection();
			void this.openNotes(option);
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
			for (const entry of doing) {
				const button = container.createEl('button', {
					cls: 'horizon-doing-project',
					attr: {
						type: 'button',
						'data-note-path': entry.file.path,
						...(entry.line === undefined ? {} : { 'data-note-line': String(entry.line) }),
					},
				});
				const icon = button.createSpan({ cls: 'horizon-option-icon', attr: { 'aria-hidden': 'true' } });
				setIcon(icon, 'circle-slash');
				button.createSpan({ cls: 'horizon-doing-project-label', text: entry.text });
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

		this.registerDomEvent(button, 'click', () => {
			this.selectedOption = option.id;
			this.updateSelection();
			if (option.tag) void this.openNotes(option);
			else new Notice(`${option.label}: test action.`);
		});
	}

	private updateSelection(): void {
		for (const [id, button] of this.optionButtons) {
			const selected = id === this.selectedOption;
			button.toggleClass('is-active', selected);
			button.setAttribute('aria-pressed', String(selected));
		}
	}

}
