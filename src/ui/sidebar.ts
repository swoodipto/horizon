import { ItemView, Notice, setIcon, WorkspaceLeaf } from 'obsidian';
import { SIDEBAR_SECTIONS, SidebarOption } from './sidebar-options';
import { HORIZON_ICON } from './icons';

export const HORIZON_VIEW_TYPE = 'horizon-sidebar';

export class HorizonSidebarView extends ItemView {
	navigation = false;
	private selectedOption = 'life-areas';
	private optionButtons = new Map<string, HTMLButtonElement>();

	constructor(leaf: WorkspaceLeaf, private openNotes: (option: SidebarOption) => Promise<void>) {
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
			const group = menu.createEl('details', { cls: 'horizon-section' });
			group.open = true;
			const heading = group.createEl('summary', { cls: 'horizon-section-heading' });
			heading.createSpan({ text: section.label });
			const chevron = heading.createSpan({
				cls: 'horizon-section-chevron',
				attr: { 'aria-hidden': 'true' },
			});
			setIcon(chevron, 'chevron-down');

			const options = group.createDiv({ cls: 'horizon-options' });
			for (const option of section.options) {
				this.addOption(options, option);
			}
		}

		this.updateSelection();
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.optionButtons.clear();
		this.contentEl.empty();
		return Promise.resolve();
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
