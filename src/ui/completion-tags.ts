/** Read tag properties without dropping malformed user data during writes. */
export function propertyTags(value: unknown): string[] {
	if (value == null) return [];
	if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
	if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) return [...value];
	throw new Error('The note tags property is not a text value or list.');
}
const normalize = (tag: string): string => tag.replace(/^#/, '').toLowerCase();
export const hasCompletionTag = (tags: readonly string[]): boolean => tags.some(tag => normalize(tag) === 'completed');
export const hasCategoryTag = (tags: readonly string[], category: string): boolean => tags.some(tag => normalize(tag) === category || normalize(tag).startsWith(`${category}/`));

/** Used only inside an exact-line guarded write; discovery still uses Obsidian's cache. */
export function sourceTags(line: string): string[] {
	return [...visibleTagText(line).matchAll(/(^|[^\p{L}\p{N}_/#-])#([\p{L}\p{N}_/-]+)/gu)].map(match => `#${match[2]}`);
}
export function visibleTagText(line: string): string {
	return line.replace(/(`+).*?\1|<!--.*?(?:-->|$)|%%.*?(?:%%|$)|\\./g, match => ' '.repeat(match.length));
}
