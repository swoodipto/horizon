import { Component, Notice, Platform, setIcon } from 'obsidian';
import { PROJECT_STATUSES } from './project-status';
import { normalizeProjectFilter, selectProjectFilter, type ProjectFilter, type ProjectStatusTag } from './project-filter';

const HOLD_DURATION = 1000;
const MOVE_TOLERANCE = 10;

/** One delegated interaction owner survives list redraws and cleans up holds. */
export class StatusFilterPills extends Component {
	private root: HTMLElement | undefined;
	private row: HTMLElement | undefined;
	private resizeObserver: ResizeObserver | undefined;
	private scrollLeft = 0;
	private focusTag: string | undefined;
	private mobileMultiSelect = false;
	private suppressClick: string | undefined;
	private hold: { pointerId: number; tag: ProjectStatusTag; x: number; y: number; timer: number; win: Window } | undefined;

	constructor(private getFilter: () => ProjectFilter, private select: (filter: ProjectFilter) => void) {
		super();
		this.register(() => this.reset());
	}

	bind(root: HTMLElement): void {
		this.root = root;
		this.registerDomEvent(root, 'click', event => {
			const tag = this.tagFor(event.target);
			if (!tag) return;
			event.preventDefault();
			event.stopPropagation();
			if (this.suppressClick === tag) { this.suppressClick = undefined; return; }
			const multiple = Platform.isMobile ? this.mobileMultiSelect
				: Platform.isMacOS ? event.metaKey : event.ctrlKey;
			this.select(selectProjectFilter(this.getFilter(), tag, multiple));
		});
		this.registerDomEvent(root, 'pointerdown', event => this.startHold(event));
		this.registerDomEvent(root.ownerDocument, 'pointermove', event => {
			if (this.hold?.pointerId === event.pointerId &&
				Math.hypot(event.clientX - this.hold.x, event.clientY - this.hold.y) > MOVE_TOLERANCE) {
				this.suppressClick = this.hold.tag;
				this.cancelHold();
			}
		});
		this.registerDomEvent(root.ownerDocument, 'pointerup', event => {
			if (this.hold?.pointerId === event.pointerId) this.cancelHold();
		});
		this.registerDomEvent(root.ownerDocument, 'pointercancel', () => this.cancelHold());
		this.registerDomEvent(root.ownerDocument, 'visibilitychange', () => {
			if (root.ownerDocument.hidden) this.cancelHold();
		});
		if (root.ownerDocument.defaultView) {
			this.registerDomEvent(root.ownerDocument.defaultView, 'blur', () => this.cancelHold());
		}
		this.registerDomEvent(root, 'scroll', event => {
			this.cancelHold();
			if (event.target === this.row) this.updateOverflow();
		}, true);
		this.registerDomEvent(root, 'contextmenu', event => {
			if (Platform.isMobile && this.tagFor(event.target)) event.preventDefault();
		});
	}

	beforeRender(): void {
		this.cancelHold();
		this.scrollLeft = this.row?.scrollLeft ?? 0;
		const focused = this.row?.ownerDocument.activeElement;
		this.focusTag = focused && this.row?.contains(focused) ? this.tagFor(focused) : undefined;
	}

	render(container: HTMLElement, statuses: typeof PROJECT_STATUSES[number][]): void {
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		this.row = undefined;
		if (statuses.length < 2) {
			this.mobileMultiSelect = false;
			return;
		}
		const row = container.createDiv({ cls: 'horizon-status-pills', attr: {
			role: 'group', 'aria-label': 'Project status filters',
			'aria-description': Platform.isMobile
				? 'Hold a status for one second to toggle multi-select.'
				: `Select one status, or hold ${Platform.isMacOS ? 'Command' : 'Control'} to toggle multiple statuses.`,
		} });
		this.row = row;
		for (const status of statuses) {
			const button = row.createEl('button', { cls: 'horizon-status-pill horizon-no-select', attr: {
				type: 'button', 'data-status-filter': status.tag,
			} });
			setIcon(button.createSpan({ cls: 'horizon-status-pill-icon', attr: { 'aria-hidden': 'true' } }), status.icon);
			button.createSpan({ text: status.tag });
			if (status.tag === this.focusTag) button.focus({ preventScroll: true });
		}
		this.syncSelection();
		row.scrollLeft = this.scrollLeft;
		this.updateOverflow();
		if (typeof ResizeObserver !== 'undefined') {
			this.resizeObserver = new ResizeObserver(() => this.updateOverflow());
			this.resizeObserver.observe(row);
		}
	}

	reset(): void {
		this.cancelHold();
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		this.mobileMultiSelect = false;
		this.suppressClick = undefined;
		this.scrollLeft = 0;
		this.focusTag = undefined;
		this.row = undefined;
	}

	clearSelection(): boolean {
		const active = this.getFilter() !== 'all' || this.mobileMultiSelect || !!this.hold;
		if (!active) return false;
		if (this.hold) this.suppressClick = this.hold.tag;
		this.cancelHold();
		this.mobileMultiSelect = false;
		if (this.getFilter() !== 'all') this.select('all');
		else this.syncSelection();
		return true;
	}

	private tagFor(target: EventTarget | null): ProjectStatusTag | undefined {
		const pill = (target as HTMLElement | null)?.closest?.<HTMLElement>('button.horizon-status-pill');
		if (!pill || !this.root?.contains(pill)) return undefined;
		return PROJECT_STATUSES.find(status => status.tag === pill.getAttribute('data-status-filter'))?.tag;
	}

	private syncSelection(): void {
		const filter = this.getFilter();
		for (const button of Array.from(this.row?.querySelectorAll<HTMLElement>('button.horizon-status-pill') ?? [])) {
			const tag = this.tagFor(button);
			const selected = filter !== 'all' && tag !== undefined && filter.includes(tag);
			button.toggleClass('is-active', selected);
			button.setAttribute('aria-pressed', String(selected));
		}
		this.row?.setAttribute('aria-label', this.mobileMultiSelect
			? 'Project status filters, multi-select active' : 'Project status filters');
	}

	private updateOverflow(): void {
		const row = this.row;
		if (!row) return;
		const remaining = row.scrollWidth - row.clientWidth;
		row.toggleClass('can-scroll-left', remaining > 1 && row.scrollLeft > 1);
		row.toggleClass('can-scroll-right', remaining > 1 && row.scrollLeft < remaining - 1);
	}

	private startHold(event: PointerEvent): void {
		if (!Platform.isMobile || event.pointerType !== 'touch') return;
		this.suppressClick = undefined;
		this.cancelHold();
		const tag = this.tagFor(event.target);
		const win = this.root?.ownerDocument.defaultView;
		if (!tag || !win || !event.isPrimary) return;
		const timer = win.setTimeout(() => {
			this.hold = undefined;
			this.suppressClick = tag;
			this.mobileMultiSelect = !this.mobileMultiSelect;
			if (this.mobileMultiSelect) {
				new Notice('Multi-select is active. Tap statuses to toggle. Hold a pill again to exit.');
				const filter = this.getFilter();
				if (filter === 'all' || !filter.includes(tag)) {
					this.select(normalizeProjectFilter([...(filter === 'all' ? [] : filter), tag]));
				}
			} else new Notice('Multi-select is off.');
			this.syncSelection();
		}, HOLD_DURATION);
		this.hold = { pointerId: event.pointerId, tag, x: event.clientX, y: event.clientY, timer, win };
	}

	private cancelHold(): void {
		if (this.hold) this.hold.win.clearTimeout(this.hold.timer);
		this.hold = undefined;
	}
}
