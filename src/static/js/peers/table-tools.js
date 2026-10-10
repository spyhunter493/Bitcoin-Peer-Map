import { required } from '../core/dom.js';
import { create as createLifecycle } from '../core/lifecycle.js';
import { toCsv, toJson } from './table-export.js';

/** @typedef {{key: string, label: string}} FilterScope */
/** @typedef {{peers: import('../types').Peer[], total: number,
 * columns: (import('../types').PeerColumn & {label: string})[],
 * sort: {key: string | null, direction: 'ascending' | 'descending' | null},
 * scopes: FilterScope[]}} Snapshot */

/** Owns search, filter summaries and downloads without reading virtualized rows.
 * @param {{document?: Document, onQuery(): void, onClear(key: string): void}} options */
export function create(options) {
    const document = options.document || globalThis.document;
    const clock = document.defaultView || window;
    const lifecycle = createLifecycle(clock);
    /** @type {HTMLInputElement} */
    const input = required('#peer-search', document);
    /** @type {HTMLButtonElement} */
    const clearSearch = required('#peer-search-clear', document);
    const chips = required('#peer-filter-chips', document);
    const count = required('#peer-match-count', document);
    const filterStatus = required('#peer-filter-status', document);
    /** @type {HTMLButtonElement} */
    const clearFilters = required('#peer-clear-filters', document);
    const exportButton = required('#btn-export-peers', document);
    const exportOptions = required('#peer-export-options', document);
    const exportCsv = required('#peer-export-csv', document);
    const exportJson = required('#peer-export-json', document);
    let query = '';
    let chipSignature = '';
    /** @type {Snapshot} */
    let snapshot = { peers: [], total: 0, columns: [], sort: {key: null, direction: null}, scopes: [] };
    /** @type {Set<string>} */
    const downloadUrls = new Set();

    function changeQuery() {
        query = input.value;
        options.onQuery();
    }
    function resetSearch() {
        input.value = '';
        changeQuery();
        input.focus({ preventScroll: true });
    }

    function positionExport() {
        if (exportOptions.hidden) return;
        const anchor = exportButton.getBoundingClientRect();
        const margin = 8;
        const width = document.documentElement.clientWidth;
        const height = document.documentElement.clientHeight;
        exportOptions.style.left = Math.max(margin, Math.min(anchor.right - exportOptions.offsetWidth, width - exportOptions.offsetWidth - margin)) + 'px';
        const above = anchor.top - exportOptions.offsetHeight - margin;
        exportOptions.style.top = Math.max(margin, Math.min(above >= margin ? above : anchor.bottom + margin, height - exportOptions.offsetHeight - margin)) + 'px';
    }

    /** @param {boolean} [restoreFocus] */
    function closeExport(restoreFocus = false) {
        exportOptions.hidden = true;
        exportButton.setAttribute('aria-expanded', 'false');
        if (restoreFocus) exportButton.focus({ preventScroll: true });
    }

    /** @param {'csv'|'json'} format */
    function download(format) {
        const exportedAt = new Date().toISOString();
        const content = format === 'csv' ? toCsv(snapshot.peers, snapshot.columns) : toJson(snapshot.peers, {
            exported_at: exportedAt,
            total: snapshot.total,
            filters: {search: query.trim(), scopes: snapshot.scopes},
            sort: snapshot.sort,
            columns: snapshot.columns.map(({key, label}) => ({key, label})),
        });
        const url = URL.createObjectURL(new Blob([content], {type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8'}));
        downloadUrls.add(url);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `bpm-peers-${exportedAt.replace(/[:.]/g, '-')}.${format}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        closeExport(true);
        // Keep the object URL alive while the browser starts its download.
        lifecycle.timeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000);
    }

    lifecycle.listen(required('#peer-search-tools', document), 'click', event => event.stopPropagation());
    lifecycle.listen(filterStatus, 'click', event => event.stopPropagation());
    lifecycle.listen(input, 'input', changeQuery);
    lifecycle.listen(input, 'keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            resetSearch();
        }
    });
    lifecycle.listen(clearSearch, 'click', resetSearch);
    lifecycle.listen(chips, 'click', event => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest('button[data-filter-key]');
        if (!(button instanceof HTMLElement)) return;
        const key = button.dataset.filterKey;
        if (!key) return;
        if (key === 'search') resetSearch();
        else {
            options.onClear(key);
            input.focus({ preventScroll: true });
        }
    });
    lifecycle.listen(clearFilters, 'click', () => {
        input.value = query = '';
        options.onClear('all');
        options.onQuery();
        input.focus({ preventScroll: true });
    });
    lifecycle.listen(exportButton, 'click', event => {
        event.stopPropagation();
        if (!exportOptions.hidden) { closeExport(true); return; }
        exportOptions.hidden = false;
        exportButton.setAttribute('aria-expanded', 'true');
        positionExport();
        exportCsv.focus({ preventScroll: true });
    });
    lifecycle.listen(exportOptions, 'click', event => event.stopPropagation());
    lifecycle.listen(exportCsv, 'click', () => download('csv'));
    lifecycle.listen(exportJson, 'click', () => download('json'));
    lifecycle.listen(exportOptions, 'keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeExport(true);
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const first = event.key === 'Home' || (event.key !== 'End' && document.activeElement === exportJson);
            (first ? exportCsv : exportJson).focus({ preventScroll: true });
        }
    });
    // Capture outside clicks even when another dashboard control stops bubbling.
    const outsideClick = (/** @type {MouseEvent} */ event) => {
        if (event.target instanceof Node && !exportOptions.contains(event.target) && !exportButton.contains(event.target)) closeExport();
    };
    document.addEventListener('click', outsideClick, true);
    lifecycle.listen(document, 'focusin', event => {
        if (!exportOptions.hidden && event.target instanceof Node && !exportOptions.contains(event.target) && event.target !== exportButton) closeExport();
    });
    lifecycle.listen(clock, 'resize', positionExport);
    lifecycle.listen(document, 'scroll', positionExport);

    /** @param {Snapshot} next */
    function update(next) {
        snapshot = next;
        const text = `${next.peers.length} of ${next.total} peers`;
        if (count.textContent !== text) count.textContent = text;
        clearSearch.hidden = !query;
        const active = query.trim() ? [{key: 'search', label: `Search: ${query.trim()}`}, ...next.scopes] : next.scopes;
        const signature = JSON.stringify(active);
        if (signature !== chipSignature) {
            chipSignature = signature;
            chips.replaceChildren(...active.map(({key, label}) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'peer-filter-chip';
                button.dataset.filterKey = key;
                button.textContent = `${label} ×`;
                button.title = label;
                button.setAttribute('aria-label', `Remove ${label} filter`);
                return button;
            }));
        }
        clearFilters.hidden = active.length === 0;
        filterStatus.hidden = active.length === 0;
        positionExport();
    }

    function dispose() {
        closeExport();
        document.removeEventListener('click', outsideClick, true);
        lifecycle.dispose();
        for (const url of downloadUrls) URL.revokeObjectURL(url);
        downloadUrls.clear();
    }
    return Object.freeze({ get query() { return query; }, update, dispose });
}
