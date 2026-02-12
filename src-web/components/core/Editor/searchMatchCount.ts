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
        // Recompute when doc changes, search state changes, or selection moves
        const query = getSearchQuery(update.state);
        const prevQuery = getSearchQuery(update.startState);
        const open = searchPanelOpen(update.state);
        const prevOpen = searchPanelOpen(update.startState);

        if (update.docChanged || update.selectionSet || !query.eq(prevQuery) || open !== prevOpen) {
          this.updateCount();
        }
      }

      private updateCount() {
        const state = this.view.state;
        const open = searchPanelOpen(state);
        const query = getSearchQuery(state);

        if (!open) {
          this.removeCountEl();
          return;
        }

        this.ensureCountEl();

        if (!query.search) {
          if (this.countEl) {
            this.countEl.textContent = '0/0';
          }
          return;
        }

        const selection = state.selection.main;
        let count = 0;
        let currentIndex = 0;
        const MAX_COUNT = 9999;
        const cursor = query.getCursor(state);
        for (let result = cursor.next(); !result.done; result = cursor.next()) {
          count++;
          const match = result.value;
          if (match.from <= selection.from && match.to >= selection.to) {
            currentIndex = count;
          }
          if (count > MAX_COUNT) break;
        }

        if (this.countEl) {
          if (count > MAX_COUNT) {
            this.countEl.textContent = `${MAX_COUNT}+`;
          } else if (count === 0) {
            this.countEl.textContent = '0/0';
          } else if (currentIndex > 0) {
            this.countEl.textContent = `${currentIndex}/${count}`;
          } else {
            this.countEl.textContent = `0/${count}`;
          }
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

        // Reorder: insert prev button, then next button, then count after the search input
        const searchInput = panel.querySelector('input');
        const prevBtn = panel.querySelector('button[name="prev"]');
        const nextBtn = panel.querySelector('button[name="next"]');
        if (searchInput && searchInput.parentElement === panel) {
          searchInput.after(this.countEl);
          if (prevBtn) this.countEl.after(prevBtn);
          if (nextBtn && prevBtn) prevBtn.after(nextBtn);
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
