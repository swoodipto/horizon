import { Component } from 'obsidian';
import { today } from '../planning/dates';
import { goalForecast } from './forecast';
import { formatInsightDate, localDateAt } from './format';
import { GoalGraph } from './graph';
import { graphLayout, type GraphPoint } from './graph-layout';
import type { GoalHistory } from './history';
import { completionBuckets } from './completion-bars';
import { progressLabel, type GoalSnapshot } from './types';

export class GoalGraphCard extends Component {
	readonly container: HTMLElement;
	private link: HTMLAnchorElement;
	private percentage: HTMLElement;
	private metrics: HTMLElement[];
	private graph: GoalGraph;
	private status: HTMLElement;
	private dates: HTMLElement;
	private historyLabel: HTMLElement;
	private table: HTMLElement;
	private detail: HTMLDetailsElement;
	private goal: GoalSnapshot;

	constructor(root: HTMLElement, goal: GoalSnapshot, open: (goal: GoalSnapshot) => void,
		private saveExpanded: (expanded: boolean) => void, expanded: boolean) {
		super(); this.goal = goal;
		this.container = root.createEl('article', { cls: 'horizon-insights-goal' });
		const heading = this.container.createDiv({ cls: 'horizon-insights-goal-heading' });
		this.link = heading.createEl('a', { cls: 'horizon-insights-goal-link', attr: { href: goal.entry.file.path } });
		this.link.dataset.focusRole = 'title';
		this.registerDomEvent(this.link, 'click', event => { event.preventDefault(); open(this.goal); });
		this.percentage = heading.createSpan({ cls: 'horizon-insights-percentage' });
		this.percentage.setAttribute('title', 'Weighted goal progress. Each direct child contributes equally; chart metrics count whole items.');
		const panel = this.container.createDiv({ cls: 'horizon-insights-card' });
		panel.createDiv({ text: 'Progress', cls: 'horizon-insights-card-title' });
		const metrics = panel.createDiv({ cls: 'horizon-insights-metrics' });
		this.metrics = ['Scope', 'Started', 'Completed'].map(label => {
			const metric = metrics.createDiv({ cls: `horizon-insights-metric horizon-insights-${label.toLowerCase()}` });
			metric.createSpan({ text: label });
			return metric.createEl('strong');
		});
		const plot = panel.createDiv();
		this.graph = this.addChild(new GoalGraph(plot));
		this.dates = panel.createDiv({ cls: 'horizon-insights-axis' });
		this.status = panel.createDiv({ cls: 'horizon-insights-estimate' });
		this.historyLabel = panel.createDiv({ cls: 'horizon-insights-history-label' });
		this.detail = this.container.createEl('details', { cls: 'horizon-insights-values' });
		this.detail.open = expanded;
		this.detail.createEl('summary', { text: 'View values', attr: { 'data-focus-role': 'values' } });
		this.table = this.detail.createDiv();
		this.registerDomEvent(this.detail, 'toggle', () => this.saveExpanded(this.detail.open));
	}

	setExpanded(expanded: boolean): void { this.detail.open = expanded; }

	update(goal: GoalSnapshot, history: GoalHistory | undefined, observedAt: number): void {
		this.goal = goal;
		this.link.textContent = goal.entry.text;
		this.link.href = goal.entry.file.path;
		this.link.setAttribute('aria-label', `Open ${goal.entry.text}`);
		this.percentage.textContent = progressLabel(goal.progress);
		for (const [index, value] of [goal.scope, goal.started, goal.completed].entries()) {
			const metric = this.metrics[index]; if (metric) metric.textContent = String(value);
		}
		const forecast = goalForecast(goal);
		const points: GraphPoint[] = [...history?.points ?? []];
		if (!points.length || (points[points.length - 1]?.at ?? 0) < observedAt) points.push({
			at: observedAt, date: localDateAt(observedAt), scope: goal.scope,
			started: goal.started, completed: goal.completed, progress: goal.progress,
		});
		this.graph.update(points, forecast, history?.completions);
		const layout = graphLayout(points, forecast, today());
		this.dates.empty();
		this.dates.createSpan({ text: formatInsightDate(layout.from) });
		this.dates.createSpan({ text: formatInsightDate(layout.to) });
		this.status.textContent = forecast.kind === 'estimate'
			? `Plan-based estimate · ${formatInsightDate(forecast.finish)}` : forecast.message;
		this.status.setAttribute('title', forecast.kind === 'estimate'
			? `${forecast.velocity.toLocaleString(undefined, { maximumFractionDigits: 2 })} items/week from ${formatInsightDate(forecast.start)} to ${formatInsightDate(forecast.deadline)}. Started work counts as one-quarter remaining. Scenario range ${formatInsightDate(forecast.earlier)}–${formatInsightDate(forecast.later)}.`
			: forecast.message);
		this.historyLabel.textContent = `History starts ${formatInsightDate(localDateAt(history?.firstObserved ?? observedAt))}`;
		this.table.empty();
		this.table.createDiv({ cls: 'horizon-insights-metric-explanation', text: 'Goal % averages child progress. Chart metrics count whole items; Started excludes Completed.' });
		const table = this.table.createEl('table');
		const head = table.createEl('thead').createEl('tr');
		for (const label of ['Date', 'Scope', 'Started', 'Completed']) head.createEl('th', { text: label, attr: { scope: 'col' } });
		const body = table.createEl('tbody');
		for (const { point, gap } of layout.samples) {
			const row = body.createEl('tr');
			row.createEl('td', { text: `${formatInsightDate(point.date)}${gap ? ' · gap before observation' : ''}` });
			for (const value of [point.scope, point.started, point.completed]) row.createEl('td', { text: String(value) });
		}
		const buckets = completionBuckets(history?.completions ?? []);
		if (buckets.length) {
			this.table.createDiv({ cls: 'horizon-insights-metric-explanation', text: 'Observed completions per seven-day bucket. Missing bars mean no recorded transitions, not measured zero activity.' });
			const bars = this.table.createEl('table');
			const header = bars.createEl('thead').createEl('tr');
			for (const label of ['Week starting', 'Observed completions']) header.createEl('th', { text: label, attr: { scope: 'col' } });
			const values = bars.createEl('tbody');
			for (const bucket of buckets) {
				const row = values.createEl('tr');
				row.createEl('td', { text: formatInsightDate(bucket.date) });
				row.createEl('td', { text: String(bucket.count) });
			}
		}
		if (forecast.kind === 'estimate') this.table.createDiv({ cls: 'horizon-insights-metric-explanation',
			text: `Plan-based estimate: ${forecast.velocity.toLocaleString(undefined, { maximumFractionDigits: 2 })} items/week. Start ${formatInsightDate(forecast.start)}, deadline ${formatInsightDate(forecast.deadline)}. Started items count as one-quarter remaining work. ${formatInsightDate(forecast.earlier)}–${formatInsightDate(forecast.later)} is a scenario range, not measured confidence.` });
	}
}
