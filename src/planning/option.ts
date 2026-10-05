export function isPlanningOption(option: { id: string }): boolean {
	return option.id === 'upcoming' || option.id === 'timeline';
}
