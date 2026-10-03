import { PROJECTS_ICON } from './icons';
import { GOALS_ICON } from './icon-ids';

export interface SidebarOption {
	id: string;
	label: string;
	icon: string;
	tag?: string;
	noteIcon?: string;
}

export interface SidebarSection {
	label: string;
	options: SidebarOption[];
}

export const SIDEBAR_SECTIONS: SidebarSection[] = [
	{
		label: 'Horizon',
		options: [
			{ id: 'life-areas', label: 'Life Areas', icon: 'layers-2', tag: '#area', noteIcon: 'layers-2' },
			{ id: 'goals', label: 'Goals', icon: 'target', tag: '#goal', noteIcon: GOALS_ICON },
			{ id: 'projects', label: 'Projects', icon: PROJECTS_ICON, tag: '#project', noteIcon: 'circle-small' },
			{ id: 'insights', label: 'Insights', icon: 'bar-chart-3' },
		],
	},
	{
		label: 'Plan',
		options: [
			{ id: 'upcoming', label: 'Upcoming', icon: 'calendar-days' },
			{ id: 'timeline', label: 'Timeline', icon: 'square-chart-gantt' },
		],
	},
];
