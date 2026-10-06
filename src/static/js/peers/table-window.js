/** Keep small tables intact; large tables mount only the viewport and a buffer. */
const VIRTUAL_THRESHOLD = 80;
const OVERSCAN = 6;

/** @param {number} count
 * @param {number} scrollTop
 * @param {number} viewportHeight
 * @param {number} rowHeight */
export function rowRange(count, scrollTop, viewportHeight, rowHeight) {
    if (count <= VIRTUAL_THRESHOLD) return { start: 0, end: count };
    const first = Math.min(count - 1, Math.max(0, Math.floor(scrollTop / rowHeight)));
    return {
        start: Math.max(0, first - OVERSCAN),
        end: Math.min(count, first + Math.max(1, Math.ceil(viewportHeight / rowHeight)) + OVERSCAN),
    };
}

/** @param {{
 * tbody: HTMLTableSectionElement;
 * thead: HTMLTableSectionElement;
 * viewport: HTMLElement;
 * updateRow(row: HTMLTableRowElement, peer: import('../types').Peer, rebuildCells: boolean): void;
 * }} options */
export function create({ tbody, thead, viewport, updateRow }) {
    /** @type {readonly import('../types').Peer[]} */
    let peers = [];
    let columns = '';
    let columnCount = 1;
    let rowHeight = 22;
    let start = -1, end = -1;

    function spacer() {
        const row = document.createElement('tr');
        row.className = 'peer-table-spacer';
        row.setAttribute('aria-hidden', 'true');
        const cell = row.insertCell();
        cell.appendChild(document.createElement('div'));
        return row;
    }
    const before = spacer(), after = spacer();

    /** @param {HTMLTableRowElement} row @param {number} height */
    function sizeSpacer(row, height) {
        const cell = row.cells[0];
        if (cell.colSpan !== columnCount) cell.colSpan = columnCount;
        const size = `${height}px`;
        // Content height gives table layout an exact minimum for the spacer.
        const content = /** @type {HTMLElement} */ (cell.firstElementChild);
        if (content.style.height !== size) content.style.height = size;
    }

    /** @param {boolean} [update] @param {boolean} [rebuildCells] */
    function render(update = false, rebuildCells = false) {
        const height = Math.max(rowHeight, viewport.clientHeight - thead.offsetHeight);
        const range = rowRange(peers.length, viewport.scrollTop, height, rowHeight);
        if (!update && start === range.start && end === range.end) return;
        start = range.start; end = range.end;
        const visible = peers.slice(start, end);
        const rows = new Map(Array.from(tbody.rows)
            .filter(row => row.dataset.id !== undefined).map(row => [Number(row.dataset.id), row]));
        const ids = new Set(visible.map(peer => peer.id));
        for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }

        const virtual = peers.length > VIRTUAL_THRESHOLD;
        if (virtual) {
            sizeSpacer(before, start * rowHeight);
            sizeSpacer(after, (peers.length - end) * rowHeight);
            if (before.parentNode !== tbody) tbody.prepend(before);
            if (after.parentNode !== tbody) tbody.append(after);
        } else { before.remove(); after.remove(); }

        /** @type {HTMLTableRowElement | null} */
        let next = virtual ? after : null;
        for (let i = visible.length - 1; i >= 0; i--) {
            const peer = visible[i];
            let row = rows.get(peer.id);
            if (!row) {
                row = document.createElement('tr');
                row.dataset.id = String(peer.id);
            }
            updateRow(row, peer, rebuildCells);
            const index = String(start + i + 2); // Header occupies row 1.
            if (row.getAttribute('aria-rowindex') !== index) row.setAttribute('aria-rowindex', index);
            if (row.parentNode !== tbody || row.nextSibling !== next) tbody.insertBefore(row, next);
            next = row;
        }
        // The first row shares a collapsed border with the spacer/header and
        // can be half a pixel shorter. Measure an interior row for the stride.
        const sample = tbody.querySelectorAll('tr[data-id]')[1] || next;
        const measured = sample?.getBoundingClientRect().height;
        if (measured && Math.abs(measured - rowHeight) > 0.1) {
            rowHeight = measured;
            render(true);
        }
    }

    viewport.addEventListener('scroll', () => render(), { passive: true });
    new ResizeObserver(() => render()).observe(viewport);

    return Object.freeze({
        /** @param {readonly import('../types').Peer[]} sorted
         * @param {string} signature @param {number} count */
        update(sorted, signature, count) {
            const rebuild = columns !== signature;
            columns = signature; columnCount = count; peers = sorted;
            const total = String(peers.length);
            if (tbody.dataset.peerCount !== total) tbody.dataset.peerCount = total;
            const table = tbody.closest('table');
            const ariaCount = String(peers.length + 1);
            if (table?.getAttribute('aria-rowcount') !== ariaCount) table?.setAttribute('aria-rowcount', ariaCount);
            // Clamp an old scroll position before rendering a smaller filtered result.
            const maxScroll = Math.max(0, peers.length * rowHeight + thead.offsetHeight - viewport.clientHeight);
            if (viewport.scrollTop > maxScroll) viewport.scrollTop = maxScroll;
            render(true, rebuild);
        },
        /** @param {number} peerId @param {boolean} smooth */
        reveal(peerId, smooth) {
            const index = peers.findIndex(peer => peer.id === peerId);
            if (index < 0) return;
            const top = index * rowHeight;
            const height = Math.max(rowHeight, viewport.clientHeight - thead.offsetHeight);
            let target = viewport.scrollTop;
            if (top < target) target = top;
            else if (top + rowHeight > target + height) target = top + rowHeight - height;
            viewport.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'instant' });
            render(true);
            if (!smooth) {
                // Collapsed table borders and fractional row heights can shift
                // the estimated edge slightly. Finish using the mounted row.
                const row = tbody.querySelector(`tr[data-id="${peerId}"]`);
                const rect = row?.getBoundingClientRect();
                const bounds = viewport.getBoundingClientRect();
                if (rect && rect.bottom > bounds.bottom) viewport.scrollTop += rect.bottom - bounds.bottom;
                else if (rect && rect.top < bounds.top + thead.offsetHeight) {
                    viewport.scrollTop -= bounds.top + thead.offsetHeight - rect.top;
                }
                render();
            }
        },
    });
}
