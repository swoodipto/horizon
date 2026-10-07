import { parseFrontMatterTags, type App, type TFile } from 'obsidian';
import { parentNotes } from './parent-notes';
import { iconForNoteTags, type TaggedMetadata } from './tagged-notes';

/** Reuse one metadata snapshot for both category reads in a render or sync pass. */
export function taggedMetadataReader(app: Pick<App, 'metadataCache'>): (file: TFile) => TaggedMetadata | null {
	const byPath = new Map<string, TaggedMetadata | null>();
	return file => {
		if (byPath.has(file.path)) return byPath.get(file.path) ?? null;
		const cache = app.metadataCache.getFileCache(file);
		if (!cache) {
			byPath.set(file.path, null);
			return null;
		}
		const resolveRelation = (linkpath: string) => {
			const linked = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
			if (!linked) return undefined;
			const frontmatter = app.metadataCache.getFileCache(linked)?.frontmatter;
			return {
				name: linked.basename,
				path: linked.path,
				icon: iconForNoteTags(frontmatter ? parseFrontMatterTags(frontmatter) ?? [] : []),
			};
		};
		const metadata: TaggedMetadata = {
			noteTags: cache.frontmatter ? parseFrontMatterTags(cache.frontmatter) ?? [] : [],
			lineTags: cache.tags ?? [],
			parents: parentNotes(cache.frontmatter?.parent, resolveRelation),
			dependents: parentNotes(cache.frontmatter?.dependent, resolveRelation),
		};
		byPath.set(file.path, metadata);
		return metadata;
	};
}
