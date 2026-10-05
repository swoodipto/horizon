import { Component } from 'obsidian';

/** Animate the existing section so focus and list state survive the toggle. */
export class LaterItemsAnimation extends Component {
	private animation: Animation | undefined;
	private section: HTMLElement | undefined;

	constructor() {
		super();
		this.register(() => this.reset());
	}

	reset(): void {
		this.animation?.cancel();
		this.animation = undefined;
		this.section?.removeClass('is-animating');
		this.section = undefined;
	}

	toggle(section: HTMLElement, show: boolean): void {
		const win = section.ownerDocument.defaultView;
		const height = section.hidden ? 0 : section.getBoundingClientRect().height;
		const opacity = section.hidden ? 0 : Number(win?.getComputedStyle(section).opacity ?? 1);
		const margin = section.hidden ? '0px' : win?.getComputedStyle(section).marginBlockStart ?? '0px';
		this.reset();
		section.hidden = false;
		section.toggleAttribute('inert', !show);
		section.setAttribute('aria-hidden', String(!show));
		if (!win || win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			section.hidden = !show;
			return;
		}
		const fullHeight = section.getBoundingClientRect().height;
		const fullMargin = win.getComputedStyle(section).marginBlockStart;
		this.section = section;
		section.addClass('is-animating');
		const animation = section.animate([
			{ height: `${height}px`, opacity, marginBlockStart: margin },
			{ height: `${show ? fullHeight : 0}px`, opacity: show ? 1 : 0, marginBlockStart: show ? fullMargin : '0px' },
		], { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
		this.animation = animation;
		animation.onfinish = () => {
			if (this.animation !== animation) return;
			section.hidden = !show;
			this.reset();
		};
	}
}
