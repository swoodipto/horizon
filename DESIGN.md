# Horizon design system

This is the UI and UX decision reference for Horizon. It describes the current working-tree implementation in `styles.css` and `src/` as inspected on 2026-10-14. **Established** means implemented behavior to reuse. **Review later** marks an observed inconsistency or a possible improvement, not approval to restyle it. Read the relevant source before editing: this document records the pattern, while the code supplies its current details. The Tasks surface is implemented locally but not yet delivered in Git; Upcoming and Timeline are hidden, unfinished planning surfaces.

## Design approach — established

1. **Belong to Obsidian.** Use native `ItemView`, `Menu`, `Modal`, `FuzzySuggestModal`, `Setting`, `Notice`, `setIcon`, `clickable-icon`, and theme CSS variables. Horizon has no separate global palette, font, or reset. Keep selectors under Horizon roots so themes and other views remain untouched.
2. **One visual hierarchy.** Normal text is `--text-normal`; supporting controls and labels are `--text-muted`; tertiary metadata is `--text-faint`. Use the theme accent for selection, completion, today, and drop targets. Error/warning roles use Obsidian's semantic colors. The one fixed product color is the due/behind accent `#F54370`.
3. **Reuse the surface's existing structure.** Sidebar entries, category rows, Kanban cards, Insights cards, and planning canvases have distinct jobs. Reuse their CSS classes and rendering helpers before adding a variant. A new surface does not inherit hidden planning UI by default.
4. **Let content and the theme size the interface.** Prefer Obsidian `--size-*`, `--radius-*`, `--font-*`, `--icon-*`, logical properties, and `min-width: 0` for truncation. Existing fixed measurements below are local exceptions, not a new scale.
5. **Keep navigation and mutation separate.** Full list rows or card surfaces open notes; status, date, filter, disclosure, checkbox, and drag controls take their own action. Hover, focus, selection, touch, and keyboard paths must agree with the same state.

## Surface and source map

| Surface | Established structure and owner | Styles |
| --- | --- | --- |
| Sidebar | One leaf; option registry and current-entry state in `src/ui/sidebar.ts`, `sidebar-options.ts`, `sidebar-current-entry.ts`; native `details` only for nonempty secondary sections; separate category button and disclosure arrow | `.horizon-sidebar`, `.horizon-option`, `.horizon-sidebar-entry`, `.horizon-sidebar-project-group` |
| Category lists and Tasks | Obsidian reading-view DOM (`markdown-reading-view` → `markdown-preview-view` → `markdown-preview-sizer` → `.horizon-note-results`); title, rows, badges and actions in `src/ui/notes-view.ts`; Tasks markup in `tasks-render.ts` | `.horizon-notes`, `.horizon-results-heading`, `.horizon-note-list`, `.horizon-note-link`, `.horizon-task-*` |
| Project filters and menus | Reusable status order in `src/ui/project-status.ts`; filter interactions in `status-filter-pills.ts`; native status menus in `project-menus.ts`; view menu in `project-view-controls.ts` | `.horizon-status-pills`, `.horizon-status-pill`, `.horizon-status-menu-*` |
| Kanban | Shared board model and lane/card rendering in `src/ui/project-board.ts`, `project-board-card.ts`; List/Kanban share the results view | `.horizon-kanban-*` under `.horizon-kanban-view` |
| Insights | Separate `ItemView` and responsive sections/cards/graph in `src/insights/view.ts`, `pace-card.ts`, `pace-graph.ts` | `.horizon-insights-*`, `.horizon-pace-*` |
| Settings and editors | Native `Setting` in `src/ui/settings-tab.ts`; native `Modal`/`FuzzySuggestModal` in `note-date-editor.ts`, `relation-picker.ts`, `src/planning/editor.ts` | Small scoped `.horizon-planning-*` form helpers |
| Hidden planning | `src/planning/`, `src/calendar/`, `src/timeline/` have native-form chrome around custom all-day canvases. They remain unfinished and hidden from sidebar navigation. | `.horizon-planning`, `.horizon-calendar-*`, `.horizon-timeline-*` |

`src/ui/icons.ts` registers the custom artwork once; `styles.css` contains all first-party styling. View state and settings are coordinated by `src/main.ts` and the view classes. Do not create parallel component or token registries for existing roles.

## Tokens and visual language

### Color and surfaces — established

| Role | Current implementation | Use |
| --- | --- | --- |
| Main and inset surfaces | `--background-primary`, `--background-secondary` | Reading area/cards; sidebar, Insights section, board cells and planning axis |
| Borders and hover | `--background-modifier-border`, `--background-modifier-hover`, `--nav-item-background-hover`, `--nav-item-color-hover` | Separators, native-like row/card boundaries, sidebar/list hover |
| Text hierarchy | `--text-normal`, `--text-muted`, `--text-faint` | Primary labels, supporting labels, subtitles/counts |
| Selection and active | `--interactive-accent`, `--interactive-accent-hover`, `--text-on-accent`, `--text-accent` | Active filter pill, focus/drop ring, today, links and progress |
| Feedback | `--text-warning`, `--text-error` | Planning warnings/errors and graph deadline role |
| Due or behind pace | `--horizon-deadline-urgent-color: #F54370` on notes/Insights roots | Today/overdue deadline text and behind-schedule pace line, markers and gradient |

Insights defines local graph aliases on `.horizon-insights-card`: `--horizon-graph-scope: var(--text-faint)`, `--horizon-graph-started: var(--text-warning)`, `--horizon-graph-completed: var(--text-accent)`, and `--horizon-graph-deadline: var(--text-error)`. `.horizon-pace-behind` changes `--horizon-pace-color` from completion accent to `#F54370`. Neutral chips use `color-mix(in srgb, var(--text-normal) 8%, transparent)`; hover on Insights/Tasks title pills mixes `--text-accent` at 14% with transparent. These are existing component treatments, not general colors to apply everywhere. Calendar/timeline project bars accept per-project `--horizon-project-color`, defaulting to `--interactive-accent`.

Do not replace semantic variables with fixed light/dark hex values. CSS `currentColor` drives native and registered SVGs, so the active theme supplies icon color. No separate `.theme-dark` / `.theme-light` overrides exist.

### Type and icons — established

| Context | Current typography |
| --- | --- |
| Category title | `.inline-title.horizon-results-heading`; inner title inherits theme title font, size, weight and line height. The whole heading/count/control row stays inside the reading width wrapper. |
| List rows and Tasks | `--font-text`, `--font-text-size`, `--line-height-normal`; title/subtitle use `--line-height-tight`, ellipsis, and `min-width: 0` in flex containers. |
| Sidebar | `--font-ui-small` for options and grouped headings; `--font-ui-smaller` for section labels and empty copy; active option `--font-semibold`, group heading `--font-medium`. |
| Insights | `--font-interface`; view title uses `--inline-title-size`/`--inline-title-weight`, section title `--font-ui-large`, card heading `--font-ui-medium`, metrics `--font-ui-smaller` and tabular numerals. |
| Planning and Kanban | Mostly `--font-ui-small` and `--font-ui-smaller`; warnings and secondary metadata stay theme-colored. |

The sidebar Goals option uses native `target`; Goal entries and Insights completion pies render a progress ring based on the `horizon-goal` artwork, while Goal references use the registered `horizon-goal` ID. Projects sidebar uses `horizon-layout-grid-circles`; Insights uses `horizon-insights`; parent/dependency connectors reuse `horizon-parent-child`/`horizon-dependent`. `horizon-logo` is the plugin tab icon. Registered artwork uses `currentColor`; native status icons and their order come from `PROJECT_STATUSES` in `src/ui/project-status.ts`. Use `setIcon()` and the existing IDs. CSS sizes them with `--icon-m` for list entries, `--icon-s` for sidebar/branches/filter pills, and `--icon-xs` for relation subtitles; mobile list icons shrink to `--icon-s`.

### Spacing, shape and width — established

| Context | Current measurements |
| --- | --- |
| General spacing | Obsidian `--size-2-*` and `--size-4-*` variables. Category list and nested-list vertical gap is `calc(var(--size-2-1) * 4)`; row padding is `var(--size-4-1) var(--size-4-2)`. |
| Sidebar | Pane padding `--size-4-3`; option min height `34px`, padding `--size-4-1 --size-4-3`; active project groups separated by `--size-4-3`, while sibling rows retain the 2px list gap. |
| Category width | Theme mode follows Obsidian's `is-readable-line-width` setting and its native sizer. Custom mode sets `--horizon-content-width` from Settings (default `760px`, valid `200–4000px`) and centers the same sizer. |
| Insights and Kanban | Independent centered maximum width `1480px`. Insights uses pane padding `--size-4-6`; Kanban results use inline padding `--size-4-6`. |
| Kanban geometry | Shared header/lane `grid-template-columns` and `--horizon-board-columns`; minimum column width `280px` (`250px` at ≤600px), gap `--size-4-3`, horizontal scrolling. |
| Corners | Native `--radius-s`, `--radius-m`, `--radius-xl`; circular count badge, 999px status/lane/project pills. Insights section radius is a local fixed `16px` (`13px` in narrow container). |
| Bottom clearance | Desktop Horizon scroll surfaces leave `--size-4-8` (32px in the current theme) after the last item. Mobile uses the larger native navbar/toolbar height plus safe-area inset and `--size-4-6`. |

The calendar and timeline contain geometry-specific pixel values (for example 30px calendar lanes, 24px bars, 106px week rows, timeline axis and row values set from TypeScript). Treat these as view geometry rather than reusable spacing tokens. Their UI is not yet accepted for general sidebar use.

## Components and interaction states — established

| Component | Anatomy and behavior | State treatment |
| --- | --- | --- |
| Sidebar option | Full-width native button; icon, label, registry shortcut. Goal/Project rows have a separate disclosure button; child entries remain buttons. | `:hover` and `.is-active` use native hover background; `.is-current` highlights an open child entry; `aria-pressed`, `aria-current`, `aria-expanded` mirror state. `:focus-visible` gets a 2px accent outline. |
| Category row | Whole-row `a.horizon-note-link` contains icon, date badge, text and relation subtitle; status/deadline are sibling controls. Completed badge remains inside the link so the full row highlights. | Hover, `.is-selected`, and keyboard focus use `--nav-item-background-hover`; date row applies the same highlight to link and deadline control. The accepted row focus treatment intentionally uses background rather than an outline. |
| Project status | `clickable-icon` status button, placeholder inside link, native Obsidian `Menu`; status shortcut hint precedes icon. | `aria-haspopup="menu"` and `aria-expanded`; exact tooltip label **Change project status**, max width 207px. Status icon comes from the registry. |
| Filter pill | Icon plus label in a horizontally scrollable row; only shown for at least two statuses. | Default muted neutral; `.is-active` is `--interactive-accent` with `--text-on-accent`; desktop hover uses native hover/accent-hover. `aria-pressed` records selection. Focus outline is intentionally disabled in the accepted design. Mobile hold (1 second) enters multi-select; movement/scroll cancels it. |
| Tasks group | Clickable neutral project pill above a native checkbox list; checkbox and title are separate targets; nearest Markdown heading is plain muted subtitle. | Whole task text block and checkbox center together; hover/focus/selection highlights the entire task row. Project pill has a 2px accent focus outline and the Insights title hover. Checking a box removes the task after a guarded write. |
| Kanban card | Bordered primary card in a secondary cell; status button, title/subtitle, date pills, touch drag handle. Header and lane cells share one track definition. | Card hover/focus/selection leaves title background transparent; selection changes border to accent. Drop cell uses 2px inset accent ring; drag preview has accent border and theme shadow; saving uses `aria-busy`. |
| Insights card | Secondary section containing primary cards; title pill, progress ring and %, SVG pace graph with metrics and dates. | Desktop card hover scales `1.02`, rises `8px`, adds small shadow; mobile and reduced-motion modes remove that effect. Graph is keyboard focusable and has its own accessible tooltip and arrow-key inspection. |
| Editors and alerts | Native Obsidian `Setting`, `Modal`, `FuzzySuggestModal`, menu and `Notice`; form helper classes only for field grid, warnings and action alignment. | Invalid inputs show short inline `role="alert"` text; busy forms disable controls; warnings use `--text-warning`. |

Abridged list-row implementation (from `src/ui/notes-view.ts` and `styles.css`):

```ts
const link = rowEl.createEl('a', {
  cls: 'horizon-note-link',
  attr: { href: file.path, 'data-note-path': file.path, 'aria-label': entry.text },
});
```

```css
.horizon-notes a.horizon-note-link {
  display: flex;
  width: 100%;
  padding: var(--size-4-1) var(--size-4-2);
  border-radius: var(--radius-m);
  color: var(--text-normal);
}
```

The full implementation adds icon, date, text and subtitle inside this link, with status/deadline controls beside it. Extend the existing row renderer or `ProjectMenus` for a new action instead of creating another status control.

## Responsive, accessibility and theme contracts

- **Responsive:** Use `.is-mobile` for Obsidian's mobile app behavior and `.is-phone` only for the phone reading-view inset. Insights uses a named pane container query: two columns by default (including narrow panes), three at ≥1000px, four at ≥1320px; at ≤600px it reduces padding, hides the redundant title and stacks card heading contents. Kanban uses its own container query at 600px and scrolls columns horizontally. Calendar/timeline have separate 600/700/650px viewport adjustments; they remain hidden planning work.
- **Keyboard and touch:** Navigation shortcuts come from `src/ui/option-shortcuts.ts`, status shortcuts from the status registry, and list actions from `note-action-shortcuts.ts`. Do not intercept editing, inputs, contenteditable, menus, dialogs, or inactive views. Preserve the existing Escape stack and focus after redraw/menu close. Dragging must have a touch/keyboard path; mobile filter holds must not block horizontal scrolling.
- **Semantics:** Use real buttons, links and checkboxes; label icon-only controls with `aria-label`; mark decorative SVGs `aria-hidden`; expose pressed, expanded, current and busy state. List results use `aria-live="polite"`; graph/alert feedback has its own status/alert semantics. The visually hidden `.horizon-sr-only` class is available for labels.
- **Text selection and tooltips:** Horizon roots are nonselectable except native editable fields. `src/ui/tooltips.ts` currently suppresses non-graph native hover popups only inside Horizon and retains accessible labels; Insights graph tooltips remain. Do not expand that suppression outside Horizon.
- **Motion:** `src/ui/later-items-animation.ts` measures current geometry, reverses safely, cancels on redraw/close, and skips animation for `prefers-reduced-motion`. Insights hover transitions are also removed for reduced motion and on mobile. Apply the same lifecycle rules before adding motion.
- **Light/dark themes:** Rely on inherited Obsidian typography, surfaces, accent and semantic variables. Check both light and dark plus a nondefault theme when changing styles; token use supports compatibility but does not prove every theme's layout or contrast.

## UI change checklist

Before a UI or UX change, read this file and inspect the target component plus its CSS selectors. Reuse the existing renderer, state classes, icon/status/shortcut registries and Obsidian tokens. If a new component or token is necessary, state which existing pattern cannot serve it. Keep the change scoped to its Horizon root. Check hover, focus, active/selected, empty, busy/error, mobile/touch, reduced motion, theme width/custom width, light/dark themes and keyboard scope as relevant. Verify the whole rendered row/card/container, not only individual CSS declarations. Update this document in the same change when an intentional design-system rule changes; update README for user-facing behavior. Report which native/device checks were actually run.

## Inconsistencies and future review — no UI change authorized here

| Observation | Evidence | Future decision |
| --- | --- | --- |
| Some established spacing and radii are fixed pixels while most UI uses Obsidian tokens. | Sidebar `12px`/`10px`/`34px`, Insights section `16px`/`13px`, and planning canvas geometry in `styles.css`. | Keep the current rendering. If revisiting these surfaces, decide which are intentional geometry and which can adopt existing theme tokens. |
| Insights cards have a desktop hover lift, but no equivalent card-level focus treatment; the title link and graph have their own focus paths. | `.horizon-insights-goal:hover` and related focus styles in `styles.css`. | Review keyboard visual parity during a future Insights interaction pass, without changing the accepted mobile no-hover behavior. |
| The fixed black Insights hover shadow and white timeline-handle hover color are exceptions to theme-derived color. | `rgba(0,0,0,0.08)` and `rgb(255 255 255 / 25%)` in `styles.css`. | Check both themes before deciding whether semantic theme colors improve consistency. |
| `--horizon-status-icon-size` is declared for list/mobile project rows but no rule currently consumes it. | `.horizon-project-row` declarations in `styles.css`. | Remove or use it only as part of a deliberate status-icon layout change; do not copy it into new work. |
| Non-graph tooltips are temporarily suppressed while graph tooltips remain active. | `src/ui/tooltips.ts`, `styles.css`. | Make a product-level tooltip decision before using tooltip behavior as a pattern for new controls. Preserve accessible labels. |
| Hidden calendar/timeline styles contain their own fixed geometry and project colors. | `src/calendar/`, `src/timeline/`, `.horizon-calendar-*`, `.horizon-timeline-*`. | Review theme contrast, touch and narrow layout during their separate readiness work; do not expose them as finished design examples. |

The list-row background focus treatment and disabled status-pill outline are accepted choices, not accidental inconsistencies. Do not silently replace them during unrelated work.
