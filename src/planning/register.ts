import type { Plugin } from 'obsidian';
import { SIDEBAR_SECTIONS, type SidebarOption } from '../ui/sidebar-options';
import { HorizonPlanningView, HORIZON_PLANNING_VIEW_TYPE } from './view';

export function registerPlanning(plugin: Plugin, select: (option: SidebarOption) => void): void {
	plugin.registerView(HORIZON_PLANNING_VIEW_TYPE, leaf => new HorizonPlanningView(leaf, select));
	for (const item of [
		{ id: 'open-calendar', name: 'Open calendar', optionId: 'upcoming' },
		{ id: 'open-timeline', name: 'Open timeline', optionId: 'timeline' },
	]) {
		plugin.addCommand({ id: item.id, name: item.name, callback: () => {
			const option = SIDEBAR_SECTIONS.flatMap(section => section.options).find(option => option.id === item.optionId);
			if (option) select(option);
		} });
	}
}
