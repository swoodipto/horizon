export interface HorizonSettings {
	useThemeContentWidth: boolean;
	customContentWidth: number;
}

export const DEFAULT_SETTINGS: HorizonSettings = {
	useThemeContentWidth: true,
	customContentWidth: 760,
};

export function validContentWidth(width: number): boolean {
	return Number.isFinite(width) && width >= 200 && width <= 4000;
}

export function normalizeSettings(data: unknown): HorizonSettings {
	if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
	const saved = data as Partial<HorizonSettings>;
	return {
		useThemeContentWidth: typeof saved.useThemeContentWidth === 'boolean'
			? saved.useThemeContentWidth : DEFAULT_SETTINGS.useThemeContentWidth,
		customContentWidth: typeof saved.customContentWidth === 'number' && validContentWidth(saved.customContentWidth)
			? saved.customContentWidth : DEFAULT_SETTINGS.customContentWidth,
	};
}
