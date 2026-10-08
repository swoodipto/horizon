import { Component } from 'obsidian';
import { renderGoalProgressIcon } from '../ui/goal-progress';
import { percentagePace } from './pace';
import { PaceGraph } from './pace-graph';
import { progressLabel, type PaceSnapshot } from './types';

export class PaceCard extends Component {
	readonly container: HTMLElement;
	private link: HTMLAnchorElement;
	private percentage: HTMLElement;
	private progressIcon: HTMLElement;
	private graph: PaceGraph;
	private item: PaceSnapshot;

	constructor(root: HTMLElement, item: PaceSnapshot, open: (item: PaceSnapshot) => void) {
		super(); this.item = item;
		this.container = root.createEl('article', { cls: 'horizon-insights-goal' });
		const heading = this.container.createDiv({ cls: 'horizon-insights-goal-heading' });
		this.link = heading.createEl('a', { cls: 'horizon-insights-goal-link', attr: { href: item.entry.file.path } });
		this.link.dataset.focusRole = 'title';
		this.registerDomEvent(this.link, 'click', event => { event.preventDefault(); open(this.item); });
		const completion = heading.createSpan({ cls: 'horizon-insights-completion' });
		this.progressIcon = completion.createSpan({ cls: 'horizon-insights-progress-icon', attr: { 'aria-hidden': 'true' } });
		this.percentage = completion.createSpan({ cls: 'horizon-insights-percentage' });
		const panel = this.container.createDiv({ cls: 'horizon-insights-card' });
		this.graph = this.addChild(new PaceGraph(panel.createDiv()));
	}

	update(item: PaceSnapshot): void {
		this.item = item;
		this.link.textContent = item.entry.text; this.link.href = item.entry.file.path;
		this.link.setAttribute('aria-label', `Open ${item.entry.text}`);
		this.percentage.textContent = progressLabel(item.progress);
		this.progressIcon.empty();
		renderGoalProgressIcon(this.progressIcon, item.progress);
		this.graph.update(percentagePace(item));
	}
}
