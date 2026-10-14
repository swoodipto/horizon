import { INSIGHTS_ICON, PROJECTS_ICON } from './icons';
import { GOALS_ICON } from './icon-ids';

export interface SidebarOption {
	id: string;
	label: string;
	icon: string;
	tag?: string;
	noteIcon?: string;
	shortcut?: string;
}

export interface SidebarSection {
	label: string;
	options: SidebarOption[];
}

export const SIDEBAR_SECTIONS: SidebarSection[] = [
	{
		label: 'Horizon',
		options: [
			{ id: 'life-areas', label: 'Areas', icon: 'layers-2', tag: '#area', noteIcon: 'layers-2', shortcut: 'a' },
			{ id: 'goals', label: 'Goals', icon: 'target', tag: '#goal', noteIcon: GOALS_ICON, shortcut: 'g' },
			{ id: 'projects', label: 'Projects', icon: PROJECTS_ICON, tag: '#project', noteIcon: 'circle-small', shortcut: 'p' },
			{ id: 'tasks', label: 'Tasks', icon: 'square-check', shortcut: 't' },
			{ id: 'insights', label: 'Insights', icon: INSIGHTS_ICON, shortcut: 'i' },
			{ id: 'completed', label: 'Completed', icon: 'circle-check-big', shortcut: 'o' },
		],
	},
	{
		label: 'Plan',
		options: [
			{ id: 'upcoming', label: 'Calendar', icon: 'calendar-days', shortcut: 'c' },
			{ id: 'timeline', label: 'Timeline', icon: 'square-chart-gantt', shortcut: 'm' },
		],
	},
];
