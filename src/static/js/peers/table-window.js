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
    let active = true;

    function spacer() {
        const row = document.createElement('tr');
        row.className = 'peer-table-spacer';
        row.setAttribute('aria-hidden', 'true');
        const cell = row.insertCell();
        cell.appendChild(document.createElement('div'));
        return row;
    }
    const before = spacer(), after = spacer(), focusGap = spacer();

    function focusedAction() {
        const active = document.activeElement;
        if (!(active instanceof HTMLButtonElement) || !tbody.contains(active)) return null;
        const row = active.closest('tr');
        if (!row || !active.dataset.action) return null;
        return { peerId: Number(row.dataset.id), action: active.dataset.action };
    }

    /** @param {number} peerId @param {string} action */
    function actionButton(peerId, action) {
        return tbody.querySelector(`tr[data-id="${peerId}"] button[data-action="${action}"]`);
    }

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
        if (!active) return;
        const focused = focusedAction();
        const height = Math.max(rowHeight, viewport.clientHeight - thead.offsetHeight);
        const range = rowRange(peers.length, viewport.scrollTop, height, rowHeight);
        if (!update && start === range.start && end === range.end) return;
        start = range.start; end = range.end;
        const visible = peers.slice(start, end).map((peer, offset) => ({ peer, index: start + offset }));
        const focusIndex = focused ? peers.findIndex(peer => peer.id === focused.peerId) : -1;
        const focusOutside = focusIndex >= 0 && (focusIndex < start || focusIndex >= end);
        // Keep one focused row at its logical position while the viewport scrolls.
        // An extra spacer retains geometry without mounting the intervening peers.
        if (focusOutside) {
            visible.push({ peer: peers[focusIndex], index: focusIndex });
            visible.sort((a, b) => a.index - b.index);
        }
        const rows = new Map(Array.from(tbody.rows)
            .filter(row => row.dataset.id !== undefined).map(row => [Number(row.dataset.id), row]));
        const ids = new Set(visible.map(item => item.peer.id));
        for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); }

        const virtual = peers.length > VIRTUAL_THRESHOLD;
        if (virtual) {
            sizeSpacer(before, Math.min(start, focusIndex >= 0 ? focusIndex : start) * rowHeight);
            sizeSpacer(after, (peers.length - Math.max(end, focusIndex + 1)) * rowHeight);
            if (focusOutside) sizeSpacer(focusGap, (focusIndex < start ? start - focusIndex - 1 : focusIndex - end) * rowHeight);
        } else { before.remove(); after.remove(); }
        if (!focusOutside) focusGap.remove();

        /** @type {HTMLTableRowElement[]} */
        const mounted = virtual ? [before] : [];
        for (let i = 0; i < visible.length; i++) {
            const { peer, index: logicalIndex } = visible[i];
            if (focusOutside && i > 0 && logicalIndex !== visible[i - 1].index + 1) mounted.push(focusGap);
            let row = rows.get(peer.id);
            if (!row) {
                row = document.createElement('tr');
                row.dataset.id = String(peer.id);
            }
            updateRow(row, peer, rebuildCells);
            const index = String(logicalIndex + 2); // Header occupies row 1.
            if (row.getAttribute('aria-rowindex') !== index) row.setAttribute('aria-rowindex', index);
            mounted.push(row);
        }
        if (virtual) mounted.push(after);
        /** @type {HTMLTableRowElement | null} */
        let next = null;
        for (let i = mounted.length - 1; i >= 0; i--) {
            const row = mounted[i];
            if (row.parentNode !== tbody || row.nextSibling !== next) tbody.insertBefore(row, next);
            next = row;
        }
        if (focused) {
            const target = actionButton(focused.peerId, focused.action);
            if (target instanceof HTMLElement && document.activeElement !== target) target.focus({ preventScroll: true });
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

    const handleScroll = () => render();
    const handleFocusOut = () => queueMicrotask(() => render(true));
    const observer = new ResizeObserver(handleScroll);
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    observer.observe(viewport);
    tbody.addEventListener('focusout', handleFocusOut);

    /** @param {number} peerId @param {boolean} smooth */
    function reveal(peerId, smooth) {
        if (!active) return;
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
            const row = tbody.querySelector(`tr[data-id="${peerId}"]`);
            const rect = row?.getBoundingClientRect();
            const bounds = viewport.getBoundingClientRect();
            if (rect && rect.bottom > bounds.bottom) viewport.scrollTop += rect.bottom - bounds.bottom;
            else if (rect && rect.top < bounds.top + thead.offsetHeight) {
                viewport.scrollTop -= bounds.top + thead.offsetHeight - rect.top;
            }
            render();
        }
    }

    // Traverse the complete logical peer list, including unmounted rows.
    /** @param {KeyboardEvent} event */
    function handleKeydown(event) {
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
        const focused = focusedAction();
        if (!focused) return;
        const index = peers.findIndex(peer => peer.id === focused.peerId);
        const actions = ['details', 'disconnect'];
        const offset = actions.indexOf(focused.action);
        if (index < 0 || offset < 0) return;
        const next = index * actions.length + offset + (event.shiftKey ? -1 : 1);
        if (next < 0 || next >= peers.length * actions.length) return;
        event.preventDefault();
        const peer = peers[Math.floor(next / actions.length)];
        reveal(peer.id, false);
        const button = actionButton(peer.id, actions[next % actions.length]);
        if (button instanceof HTMLElement) button.focus();
        render(true);
    }
    tbody.addEventListener('keydown', handleKeydown);

    return Object.freeze({
        /** @param {readonly import('../types').Peer[]} sorted
         * @param {string} signature @param {number} count */
        update(sorted, signature, count) {
            if (!active) return;
            const focused = focusedAction();
            const oldIndex = focused ? peers.findIndex(peer => peer.id === focused.peerId) : -1;
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
            if (focused && !peers.some(peer => peer.id === focused.peerId)) {
                const fallback = peers[Math.min(Math.max(oldIndex, 0), peers.length - 1)];
                if (fallback) {
                    reveal(fallback.id, false);
                    const button = actionButton(fallback.id, focused.action);
                    if (button instanceof HTMLElement) button.focus({ preventScroll: true });
                } else viewport.focus({ preventScroll: true });
            }
        },
        /** @param {number} peerId @param {boolean} smooth */
        reveal,
        dispose() {
            active = false;
            observer.disconnect();
            viewport.removeEventListener('scroll', handleScroll);
            tbody.removeEventListener('focusout', handleFocusOut);
            tbody.removeEventListener('keydown', handleKeydown);
        },
    });
}
