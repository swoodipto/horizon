import type { TaggedEntry } from './tagged-notes';
import type { ParentNote } from './parent-notes';

export interface EntryNode<T> {
	entry: TaggedEntry<T>;
	children: EntryNode<T>[];
	parentPath?: string;
	relationship?: 'parent' | 'dependent';
}

/** Omit the relationship already represented by nesting; keep other references. */
export function visibleEntryRelations<T extends { path: string }>(node: EntryNode<T>): readonly ParentNote[] {
	const entry = node.entry;
	const relations = entry.parents || entry.dependents
		? [...entry.parents ?? [], ...entry.dependents ?? []]
		: (entry.subtitle ? [{
		name: entry.subtitle, icon: 'sticky-note',
		path: entry.line === undefined ? undefined : entry.file.path,
	}] : []);
	const visible = new Map<string, ParentNote>();
	for (const relation of relations) {
		if (node.parentPath && relation.path === node.parentPath) continue;
		visible.set(relation.path ?? `${relation.name}:${relation.icon}`, relation);
	}
	return [...visible.values()];
}

/** Nest each entry once, only beneath a resolved whole note in this list. */
export function nestTaggedEntries<T extends { path: string }>(entries: readonly TaggedEntry<T>[]): EntryNode<T>[] {
	const nodes = entries.map((entry): EntryNode<T> => ({ entry, children: [] }));
	const notes = new Map(nodes.filter(node => node.entry.line === undefined)
		.map(node => [node.entry.file.path, node]));
	const parents = new Map<EntryNode<T>, EntryNode<T>>();
	for (const node of nodes) {
		const relations = node.entry.line !== undefined
			? [{ path: node.entry.file.path, relationship: 'parent' as const }]
			: [
				...(node.entry.parents ?? []).map(parent => ({ path: parent.path, relationship: 'parent' as const })),
				...(node.entry.dependents ?? []).map(dependent => ({ path: dependent.path, relationship: 'dependent' as const })),
			];
		for (const { path, relationship } of relations) {
			if (!path) continue;
			const parent = notes.get(path);
			if (!parent) continue;
			// Self-links and cycles remain visible without infinite nesting.
			let ancestor: EntryNode<T> | undefined = parent;
			while (ancestor && ancestor !== node) ancestor = parents.get(ancestor);
			if (ancestor === node) continue;
			parents.set(node, parent);
			node.parentPath = parent.entry.file.path;
			node.relationship = relationship;
			parent.children.push(node);
			break;
		}
	}
	return nodes.filter(node => !parents.has(node));
}
