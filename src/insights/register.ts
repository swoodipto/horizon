import type { Plugin } from 'obsidian';
import type { HorizonSettings } from '../settings';
import type { SidebarOption } from '../ui/sidebar-options';
import type { InsightsService } from './service';
import { HorizonInsightsView, HORIZON_INSIGHTS_VIEW_TYPE } from './view';

export function registerInsights(plugin: Plugin, service: InsightsService,
	settings: () => HorizonSettings, select: (option: SidebarOption) => void): void {
	plugin.registerView(HORIZON_INSIGHTS_VIEW_TYPE, leaf => new HorizonInsightsView(leaf, service, settings, select));
}
