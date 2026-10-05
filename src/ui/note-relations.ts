import type { App } from 'obsidian';

export type RelationProperty = 'parent' | 'dependent';

/** Preserve unresolved links and existing selections when adding a relation. */
export function relationValues(value: unknown): string[] {
	if (value == null || value === '') return [];
	const values: unknown[] = Array.isArray(value) ? value : [value];
	if (values.some(item => typeof item !== 'string')) throw new Error('This relation property must contain note links.');
	return values.flatMap(item => {
		const text = (item as string).trim();
		return [...text.matchAll(/\[\[[^\]]+\]\]/g)].map(match => match[0]).length
			? [...text.matchAll(/\[\[[^\]]+\]\]/g)].map(match => match[0]) : text ? [text] : [];
	});
}

export async function addNoteRelation(app: Pick<App, 'vault' | 'fileManager' | 'metadataCache'>,
	path: string, property: RelationProperty, destination: string): Promise<void> {
	const file = app.vault.getFileByPath(path);
	const related = app.vault.getFileByPath(destination);
	if (!file || !related) throw new Error('The note no longer exists.');
	if (path === destination) throw new Error('Select a different note.');
	await app.fileManager.processFrontMatter(file, (properties: Record<string, unknown>) => {
		const values = relationValues(properties[property]);
		const exists = values.some(value => {
			const link = value.replace(/^\[\[|\]\]$/g, '').split('|')[0]?.split('#')[0]?.trim() ?? '';
			return app.metadataCache.getFirstLinkpathDest(link, path)?.path === destination;
		});
		if (!exists) properties[property] = [...values, `[[${destination.replace(/\.md$/i, '')}]]`];
	});
}
