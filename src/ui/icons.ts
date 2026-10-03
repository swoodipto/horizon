import { addIcon, Plugin, removeIcon } from 'obsidian';
import { GOALS_ICON } from './icon-ids';

export const HORIZON_ICON = 'horizon-logo';
export const PROJECTS_ICON = 'horizon-layout-grid-circles';
export const PARENT_CHILD_ICON = 'horizon-parent-child';
export const DEPENDENT_ICON = 'horizon-dependent';

// Define the supplied Goal artwork once; all content lists reuse its icon ID.
const GOALS_SVG = `
<g transform="scale(4.1666666667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" />
	<path d="M12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18Z" />
</g>`;

/*!
 * Lucide layout-grid-circles — ISC License
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

// Restore the previous Lucide Projects icon in Obsidian's 100×100 view box.
const PROJECTS_SVG = `
<g transform="scale(4.1666666667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<circle cx="17.5" cy="17.5" r="3.5" />
	<circle cx="17.5" cy="6.5" r="3.5" />
	<circle cx="6.5" cy="17.5" r="3.5" />
	<circle cx="6.5" cy="6.5" r="3.5" />
</g>`;

// Center the supplied 22×16 connector in Obsidian's 100×100 icon view box.
// Define it once; views reuse its registered icon ID.
const PARENT_CHILD_SVG = `
<g transform="translate(0 13.6363636364) scale(4.5454545455)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
	<path d="M1 1L1 9.38284C1 11.9159 3.0463 13.9731 5.57931 13.9865L20.4281 14.0654" />
</g>`;

// Register the supplied dependent connector once for all category views.
const DEPENDENT_SVG = `
<g transform="scale(4.1666666667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
	<path d="M2.30998 1.96022L2.30998 10.3431C2.30998 12.8761 4.35628 14.9333 6.88929 14.9467L21.738 15.0256" />
	<path d="M15.0592 8L22.0592 15L15.0592 22" stroke-linejoin="round" />
</g>`;

// Preserve the supplied 24×24 geometry within Obsidian's 100×100 icon view box.
const HORIZON_SVG = `
<g transform="scale(4.1666666667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
	<path d="M19.5174 13.6172C21.4158 7.48554 16.3927 3.22387 11.9219 3.22387C7.45104 3.22387 2.63171 7.63542 4.44251 13.6172" stroke-linejoin="round" />
	<path d="M2.33195 20.7761L10.3415 15.4622C11.3466 14.7953 12.6534 14.7953 13.6585 15.4622L21.668 20.7761" />
</g>`;

export function registerIcons(plugin: Plugin): void {
	addIcon(GOALS_ICON, GOALS_SVG);
	addIcon(HORIZON_ICON, HORIZON_SVG);
	addIcon(PROJECTS_ICON, PROJECTS_SVG);
	addIcon(PARENT_CHILD_ICON, PARENT_CHILD_SVG);
	addIcon(DEPENDENT_ICON, DEPENDENT_SVG);
	plugin.register(() => removeIcon(HORIZON_ICON));
	plugin.register(() => removeIcon(GOALS_ICON));
	plugin.register(() => removeIcon(PROJECTS_ICON));
	plugin.register(() => removeIcon(PARENT_CHILD_ICON));
	plugin.register(() => removeIcon(DEPENDENT_ICON));
}
