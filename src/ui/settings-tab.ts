import { App, PluginSettingTab, Setting } from 'obsidian';
import type HorizonPlugin from '../main';
import { validContentWidth } from '../settings';
import { suppressHorizonTooltips } from './tooltips';

export class HorizonSettingsTab extends PluginSettingTab {
	private stopTooltips: (() => void) | undefined;
	constructor(app: App, private plugin: HorizonPlugin) {
		super(app, plugin);
		this.plugin.register(() => this.hide());
	}

	display(): void {
		this.stopTooltips?.();
		this.stopTooltips = suppressHorizonTooltips(this.containerEl);
		this.containerEl.empty();
		new Setting(this.containerEl)
			.setName('Use theme content width')
			.setDesc('Match the theme’s reading-mode content width.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.useThemeContentWidth)
				.onChange(async (value) => {
					this.plugin.settings.useThemeContentWidth = value;
					await this.plugin.saveSettings();
					this.display();
				}));
		new Setting(this.containerEl)
			.setName('Custom content width')
			.setDesc('Width in pixels (200–4000). Turn off theme content width to use this value.')
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '200';
				text.inputEl.max = '4000';
				text.inputEl.step = '1';
				text.setValue(String(this.plugin.settings.customContentWidth))
					.setDisabled(this.plugin.settings.useThemeContentWidth)
					.onChange(async (value) => {
						const width = Number(value);
						if (!validContentWidth(width)) return;
						this.plugin.settings.customContentWidth = width;
						await this.plugin.saveSettings();
					});
			});
	}

	hide(): void {
		this.stopTooltips?.(); this.stopTooltips = undefined;
	}
}
