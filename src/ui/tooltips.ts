/** Restore non-graph tooltips by changing this switch and reloading Horizon. */
export const NON_GRAPH_TOOLTIPS_ENABLED = false;
export const DISABLED_TOOLTIP_CLASS = 'horizon-tooltip-disabled';

/** Hide native popups without removing accessible names or existing tooltip classes. */
export function suppressTooltip(element: Element): void {
	if (element.closest('.horizon-insights-tooltip')) return;
	const title = element.getAttribute('title');
	if (title !== null) {
		if (!element.hasAttribute('aria-label')) element.setAttribute('aria-label', title);
		element.removeAttribute('title');
	}
	if (!element.hasAttribute('aria-label')) return;
	const classes = (element.getAttribute('data-tooltip-classes') ?? '').split(/\s+/).filter(Boolean);
	if (!classes.includes(DISABLED_TOOLTIP_CLASS)) {
		element.setAttribute('data-tooltip-classes', [...classes, DISABLED_TOOLTIP_CLASS].join(' '));
	}
}

/** Observe only Horizon's own UI, including controls added by later redraws. */
export function suppressHorizonTooltips(root: HTMLElement): () => void {
	if (NON_GRAPH_TOOLTIPS_ENABLED) return () => {};
	const scan = (element: Element): void => {
		suppressTooltip(element);
		for (const target of Array.from(element.querySelectorAll('[aria-label], [title]'))) suppressTooltip(target);
	};
	scan(root);
	const Observer = root.ownerDocument.defaultView?.MutationObserver;
	if (!Observer) return () => {};
	const observer = new Observer(records => {
		for (const record of records) {
			if (record.type === 'attributes') suppressTooltip(record.target as Element);
			else for (const node of Array.from(record.addedNodes)) {
				if (node.nodeType === 1) scan(node as Element);
			}
		}
	});
	observer.observe(root, { subtree: true, childList: true, attributes: true,
		attributeFilter: ['aria-label', 'title', 'data-tooltip-classes'] });
	return () => observer.disconnect();
}
