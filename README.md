# horizon

A planning sidebar for Obsidian.

The sunrise tab appears in the top-left sidebar beside Files, Search, and Bookmarks. Select it to open horizon, or run **horizon: Open sidebar** from the command palette.

- **Horizon:** Life Areas, Goals, Projects, Insights.
- **Plan:** Upcoming, Timeline.

Select a section heading to collapse or expand it. Category clicks display entries in a center results tab. Life Areas matches `#area`, Goals matches `#goal`, and Projects matches `#project`. A tag in note properties lists the note name with its `parent` property (if present) on a muted second line, with an icon based on the parent note’s property tags: `layers-2` for areas, `goal` for goals, the current status icon for projects, `sticky-note` for other pages; a tag on a body line lists its text with the parent note name on a muted second line. Clicking a line entry opens its parent note at that line in the same tab, in either reading or editing mode. Bullet markers, task checkboxes, and matching tags are omitted from line labels. Nested tags are supported. Lists refresh when metadata or note names change. Other options show a test notice.

In **Settings → horizon**, **Use theme content width** follows the theme’s reading-mode width by default. Turn it off to set **Custom content width** in pixels. Width changes apply immediately and are saved.

In Projects, select a circle to open Obsidian’s native menu: **todo**, **backburner**, **waiting**, **discuss**, **ready**, **doing**, **completed**. Choosing a status updates the list icon and replaces the previous status tag in a whole note’s `tags` property or on the specific inline project line. Other tags are preserved. Todo is the default, shown as `circle-small` without a status tag; choosing todo clears status tags. Backburner uses `circle-dashed`, waiting `clock`, discuss `at-sign`, ready `circle`, doing `circle-slash`, and completed `circle-check-big`. Selecting the rest of the row still opens the note in the same tab.

Projects show status pills above the list when at least two statuses are assigned to its entries. Pills stay available while filtering, and overflow scrolls horizontally on desktop and mobile. Selected pills use the theme accent color.

The **Projects** item in the sidebar expands to show projects with the Doing status. Select a nested project to open its note directly; select **Projects** to open the complete project list.

- Select a pill to show one status. Select the sole active pill again to show all projects.
- On macOS, hold **Command** while selecting pills to toggle multiple statuses. On Windows and Linux, hold **Ctrl**.
- On mobile, hold a pill for **1 second** to activate multi-select. A notice confirms the mode; subsequent taps toggle statuses. Hold a pill for 1 second again to return to single selection. Swiping cancels the hold so the pill row can scroll.
- Press **Escape** while focused in the Projects view to clear the selected statuses and exit multi-select.

Filters are saved with the view and never change note contents. If a selected status disappears from the complete project list, it is removed from the filter; clearing the last selection shows all projects.

When a parent note appears in the same category list, its child notes and tagged lines nest underneath it with the supplied curved parent-child icon in a muted color. Multiple levels are supported. Each entry appears once, under the first available parent in its property order. The parent represented by indentation is omitted from the child’s subtitle; other parent references remain. Links to parents outside the list remain subtitles without indentation.

Icons use Obsidian’s `setIcon()` API. The Projects sidebar uses the previous four-circle Lucide grid, registered with `addIcon()`; project entry and parent-reference icons follow their status.

The `dependent` property supports the same note-link forms as `parent`. A note with `dependent: "[[Another note]]"` nests beneath Another note when both appear in the category, using the supplied arrow connector. References outside the current list remain in the subtitle. If both properties have available links, `parent` takes precedence, followed by `dependent`; each entry is listed once. Tagged lines stay beneath their source note with the parent connector. Both connectors are registered once and reused with native icon sizing, spacing, and muted colors.

## Development

Requires Node.js and npm, and Obsidian 1.7.2 or later.

```sh
npm ci
npm run dev
```

The development build watches `src/` and writes `main.js` in the plugin folder. Reload the plugin in Obsidian to load source changes.

```sh
npm run build
npm run lint
npm run test
```

Keep `main.js`, `manifest.json`, and `styles.css` together in `.obsidian/plugins/horizon/` when installing the plugin. Restart Obsidian after editing the manifest.
