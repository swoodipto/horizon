export interface ParentNote {
	name: string;
	icon: string;
	path?: string;
}

/** Normalize Obsidian parent links, including list-valued YAML properties. */
export function parentNotes(value: unknown, resolve: (linkpath: string) => ParentNote | undefined): ParentNote[] {
	const values: unknown[] = Array.isArray(value) ? (value as unknown[]).flat(2) : [value];
	const parents = new Map<string, ParentNote>();
	for (const item of values) {
		if (typeof item !== 'string' || !item.trim()) continue;
		const links = [...item.matchAll(/\[\[([^\]]+)\]\]/g)].map(match => match[1] ?? '');
		for (const link of links.length ? links : [item]) {
			const path = (link.split('|')[0] ?? '').split('#')[0]?.trim();
			if (!path) continue;
			const parent = resolve(path) ?? {
				name: path.split('/').pop()?.replace(/\.md$/i, '') ?? '', icon: 'sticky-note',
			};
			if (parent.name) parents.set(parent.path ?? `${parent.name}:${parent.icon}`, parent);
		}
	}
	return [...parents.values()];
}
