import { getSearchQuery, searchPanelOpen } from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/**
 * A CodeMirror extension that displays the total number of search matches
 * inside the built-in search panel.
 */
export function searchMatchCount(): Extension {
  return ViewPlugin.fromClass(
    class {
      private countEl: HTMLElement | null = null;

      constructor(private view: EditorView) {
        this.updateCount();
      }

      update(update: ViewUpdate) {
        // Recompute when doc changes, or search state changes
        const query = getSearchQuery(update.state);
        const prevQuery = getSearchQuery(update.startState);
        const open = searchPanelOpen(update.state);
        const prevOpen = searchPanelOpen(update.startState);

        if (update.docChanged || !query.eq(prevQuery) || open !== prevOpen) {
          this.updateCount();
        }
      }

      private updateCount() {
        const state = this.view.state;
        const open = searchPanelOpen(state);
        const query = getSearchQuery(state);

        if (!open || !query.search) {
          this.removeCountEl();
          return;
        }

        let count = 0;
        const MAX_COUNT = 9999;
        const cursor = query.getCursor(state);
        while (!cursor.next().done) {
          count++;
          if (count > MAX_COUNT) break;
        }

        this.ensureCountEl();
        if (this.countEl) {
          this.countEl.textContent =
            count > MAX_COUNT
              ? `${MAX_COUNT}+ matches`
              : count === 1
                ? '1 match'
                : `${count} matches`;
        }
      }

      private ensureCountEl() {
        // Find the search panel in the editor DOM
        const panel = this.view.dom.querySelector('.cm-search');
        if (!panel) {
          this.countEl = null;
          return;
        }

        if (this.countEl && this.countEl.parentElement === panel) {
          return; // Already attached
        }

        this.countEl = document.createElement('span');
        this.countEl.className = 'cm-search-match-count';
        // Insert after the first input (the search input)
        const searchInput = panel.querySelector('input');
        if (searchInput && searchInput.parentElement === panel) {
          searchInput.after(this.countEl);
        } else {
          panel.prepend(this.countEl);
        }
      }

      private removeCountEl() {
        if (this.countEl) {
          this.countEl.remove();
          this.countEl = null;
        }
      }

      destroy() {
        this.removeCountEl();
      }
    },
  );
}
