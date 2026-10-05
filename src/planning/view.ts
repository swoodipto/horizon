import { Component, debounce, ItemView, Notice, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { CalendarRenderer } from '../calendar/calendar';
import { TimelineRenderer } from '../timeline/timeline';
import { OptionKeyboardShortcuts } from '../ui/option-keyboard-shortcuts';
import { openNoteInCurrentTab } from '../ui/open-note';
import type { SidebarOption } from '../ui/sidebar-options';
import { planningWarnings } from './dependencies';
import { PlanningEditor } from './editor';
import { planningState, type PlanningState } from './state';
import { PlanningStore } from './store';
import { PlanningToolbar } from './toolbar';
import { UnscheduledProjects } from './unscheduled';
import type { PlanningProject, PlanningRenderContext, ProjectDates } from './types';

export const HORIZON_PLANNING_VIEW_TYPE = 'horizon-planning';

export class HorizonPlanningView extends ItemView {
	navigation = false;
	private state: PlanningState = planningState(undefined);
	private store: PlanningStore;
	private projects: PlanningProject[] = [];
	private generation = 0;
	private opened = false;
	private components: Component[] = [];
	private timeline: TimelineRenderer | undefined;
	private editor: PlanningEditor | undefined;
	private shortcuts: OptionKeyboardShortcuts | undefined;
	private operations: Promise<unknown> = Promise.resolve();

	constructor(leaf: WorkspaceLeaf, private selectOption: (option: SidebarOption) => void) {
		super(leaf);
		this.store = new PlanningStore(this.app);
	}

	getViewType(): string { return HORIZON_PLANNING_VIEW_TYPE; }
	getDisplayText(): string { return this.state.optionId === 'timeline' ? 'Timeline' : 'Upcoming'; }
	getIcon(): string { return this.state.optionId === 'timeline' ? 'square-chart-gantt' : 'calendar-days'; }
	getState(): Record<string, unknown> { return { ...this.state }; }
	focus(): void { this.contentEl.focus({ preventScroll: true }); }

	setState(value: unknown, _result: ViewStateResult): Promise<void> {
		this.state = planningState(value, this.state);
		this.render();
		return Promise.resolve();
	}

	onOpen(): Promise<void> {
		this.opened = true;
		this.contentEl.addClass('horizon-planning');
		this.contentEl.setAttribute('tabindex', '-1');
		this.shortcuts = this.addChild(new OptionKeyboardShortcuts(this.contentEl, {
			isActive: () => this.app.workspace.getActiveViewOfType(HorizonPlanningView) === this,
			isBlocked: () => this.editor !== undefined,
			activate: option => this.selectOption(option),
		}));
		const refresh = debounce(() => { void this.read(); }, 150, true);
		this.register(() => refresh.cancel());
		this.registerEvent(this.app.metadataCache.on('changed', () => refresh()));
		this.registerEvent(this.app.metadataCache.on('resolved', () => refresh()));
		this.registerEvent(this.app.vault.on('delete', () => refresh()));
		this.registerEvent(this.app.vault.on('rename', () => refresh()));
		return this.read();
	}

	onClose(): Promise<void> {
		this.opened = false;
		this.generation++;
		this.editor?.close();
		if (this.shortcuts) this.removeChild(this.shortcuts);
		this.shortcuts = undefined;
		this.clearComponents();
		this.contentEl.empty();
		return Promise.resolve();
	}

	private async read(): Promise<void> {
		const generation = ++this.generation;
		try {
			const projects = await this.store.load();
			if (!this.opened || generation !== this.generation) return;
			this.projects = projects;
			this.render();
		} catch (cause) {
			console.error('horizon: could not load project plans', cause);
			if (this.opened) new Notice('Could not load project plans.');
		}
	}

	private render(): void {
		if (!this.opened) return;
		const focused = this.contentEl.contains(this.contentEl.ownerDocument.activeElement);
		this.clearComponents();
		this.contentEl.empty();
		const header = this.contentEl.createDiv();
		this.mount(new PlanningToolbar(header, this.state, {
			change: state => this.change(state),
			zoom: delta => this.timeline?.setZoom(this.state.zoom * (delta > 0 ? 1.25 : 0.8)),
			create: () => this.edit(undefined),
		}));
		const warnings = planningWarnings(this.projects);
		if (warnings.length) {
			const details = this.contentEl.createEl('details', { cls: 'horizon-planning-warnings' });
			details.createEl('summary', { text: `Planning warnings (${warnings.length})` });
			const list = details.createEl('ul');
			for (const warning of warnings) {
				const item = list.createEl('li');
				const project = this.projects.find(candidate => candidate.id === warning.projectId);
				const button = item.createEl('button', { text: `${project?.title ?? 'Project'}: ${warning.message}`, attr: { type: 'button' } });
				const events = this.mount(new Component());
				events.registerDomEvent(button, 'click', () => { if (project) this.edit(project); });
			}
		}
		const context: PlanningRenderContext = {
			projects: this.projects, warnings, date: this.state.date,
			edit: (project, dates) => this.edit(project, dates),
			open: project => this.openProject(project),
			saveDates: async (project, dates) => {
				try {
					await this.commit(project, () => this.store.saveDates(project, dates));
				} catch (cause) {
					new Notice(cause instanceof Error ? cause.message : 'Could not save the project dates.');
					await this.read();
				}
			},
			create: (date, deadline) => this.edit(undefined, { start: date, deadline }),
			navigate: (date, mode) => this.change({ ...this.state, date, mode: mode ?? this.state.mode }),
		};
		const canvas = this.contentEl.createDiv({ cls: 'horizon-planning-canvas' });
		if (this.state.optionId === 'timeline') {
			this.timeline = this.mount(new TimelineRenderer(canvas, context, this.state.scale, this.state.zoom, zoom => {
				this.state.zoom = zoom;
				this.app.workspace.requestSaveLayout();
			}));
		} else this.mount(new CalendarRenderer(canvas, context, this.state.mode));
		this.mount(new UnscheduledProjects(this.contentEl, context));
		if (!this.projects.length) this.contentEl.createEl('p', {
			cls: 'horizon-planning-hint', text: 'No projects yet. Create a project or add #project to a note’s tags property.',
		});
		if (focused) this.focus();
	}

	private edit(project: PlanningProject | undefined, dates?: ProjectDates): void {
		this.editor?.close();
		const editor = new PlanningEditor(this.app, {
			project, dates, projects: this.projects,
			save: async (title, plan, dependencies) => {
				await this.commit(project, () => project
					? this.store.savePlan(project, plan, dependencies)
					: this.store.create(title, plan, dependencies));
			},
			closed: () => { if (this.editor === editor) this.editor = undefined; },
		});
		this.editor = editor;
		editor.open();
	}

	private async commit(project: PlanningProject | undefined, write: () => Promise<PlanningProject>): Promise<void> {
		const operation = this.operations.then(write);
		this.operations = operation.catch(() => undefined);
		const saved = await operation;
		this.generation++;
		this.projects = [...this.projects.filter(item => item.id !== project?.id && item.id !== saved.id), saved]
			.sort((a, b) => a.title.localeCompare(b.title));
		this.render();
	}

	private openProject(project: PlanningProject): void {
		const leaf = this.app.workspace.getLeaf('tab');
		void openNoteInCurrentTab(this.app.vault, leaf, project.path, project.inline?.line)
			.then(() => this.app.workspace.revealLeaf(leaf)).catch((cause: unknown) => {
				console.error('horizon: could not open a project', cause);
				new Notice('Could not open the project note.');
			});
	}

	private change(state: PlanningState): void {
		this.state = planningState(state, this.state);
		this.render();
		this.app.workspace.requestSaveLayout();
	}

	private mount<T extends Component>(component: T): T {
		this.components.push(component);
		return this.addChild(component);
	}

	private clearComponents(): void {
		for (const component of this.components) this.removeChild(component);
		this.components = [];
		this.timeline = undefined;
	}
}
