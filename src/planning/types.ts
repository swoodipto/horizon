/** Calendar dates stay as local YYYY-MM-DD strings, never UTC timestamps. */
export type DateKey = string;
export type CalendarMode = 'day' | 'four-days' | 'week' | 'month' | 'year';
export type TimelineScale = 'month' | 'quarter' | 'year' | 'five-years';

export interface ProjectDates {
	start?: DateKey;
	deadline?: DateKey;
}

export interface ProjectDependency {
	title: string;
	path?: string;
	/** Original unresolved linkpath, retained when editing dates. */
	linkpath?: string;
}

export interface PlanningProject extends ProjectDates {
	id: string;
	path: string;
	title: string;
	status: string;
	color?: string;
	dependencies: ProjectDependency[];
	inline?: { line: number; sourceLine: string };
	invalidDates?: string[];
}

export interface PlanningWarning {
	projectId: string;
	kind: 'dates' | 'dependency' | 'cycle';
	message: string;
}

export interface PlanningActions {
	edit: (project: PlanningProject, dates?: ProjectDates) => void;
	open: (project: PlanningProject) => void;
	saveDates: (project: PlanningProject, dates: ProjectDates) => Promise<void>;
}

export interface PlanningRenderContext extends PlanningActions {
	projects: readonly PlanningProject[];
	warnings: readonly PlanningWarning[];
	date: DateKey;
	create: (date: DateKey, deadline?: DateKey) => void;
	navigate: (date: DateKey, mode?: CalendarMode) => void;
}
